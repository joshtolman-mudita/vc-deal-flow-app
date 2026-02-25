# AI Scoring Architecture (Current State)

This document describes how AI scoring currently works in production code.

Primary implementation files:
- `app/api/diligence/score/route.ts`
- `app/api/diligence/rescore/route.ts`
- `lib/diligence-scorer.ts`
- `lib/scoring-fingerprint.ts`
- `lib/google-sheets.ts`
- `types/diligence.ts`

Current scorer version:
- `SCORER_VERSION = 2026-02-11-metrics-conservative-v3`

## 0) Canonical "Check Thesis" -> "Full Score" Flow (Exact Runtime Path)

This is the current end-to-end path used by the new diligence UX (`app/diligence/new/page.tsx`).

### Step A: Create/upload in New Diligence
- User creates diligence and uploads documents.
- Upload route writes parsed docs into `record.documents` and stores Drive folder ID.

### Step B: Thesis Check (lightweight pass)
- UI calls `POST /api/diligence/[id]/thesis-first`.
- Route loads record and runs `enrichForThesisFirstPass(...)`:
  - If record already has meaningful context (docs/notes/description/industry), it uses existing data.
  - If context is thin, it optionally adds:
    - website snapshot document,
    - web search synthesis document.
- Route runs `runThesisFitAssessment(...)` and persists `record.thesisFit`.
- No category scoring happens here.

### Step C: User decision after Thesis Check
- User chooses Reject or Score Company.
- If user provided thesis feedback, route `POST /api/diligence/[id]/thesis-fit-feedback` stores it.
- In current flow, when user continues to score from thesis panel, app reuses the same `diligenceId` (no new diligence record creation).

### Step D: Optional HubSpot create flow before full scoring
- UI may call:
  - `POST /api/hubspot/create/preview`
  - `POST /api/hubspot/create/commit`
- Commit route maps selected deal/company properties into `record.metrics` for key terms:
  - `fundingAmount`, `committed`, `valuation`, `dealTerms`, `lead`,
  - `currentRunway`, `postFundingRunway`,
  - and industry sync.

### Step E: Full scoring
- UI calls `POST /api/diligence/score`.
- Route builds scoring context (docs, notes, website/search docs, HubSpot context), then calls `scoreDiligence(...)`.
- Route persists:
  - `record.score`
  - `record.metrics`
  - selected company metadata fields.

### Step F: Re-score path
- UI calls `POST /api/diligence/rescore` for incremental/full rescoring.
- Same scorer core, with re-score-specific doc refresh behavior and fingerprint skip behavior.

## 1) Entry Points and Triggers

### Initial score
- Endpoint: `POST /api/diligence/score`
- Used for first scoring pass on a diligence record.
- Always writes `score.scoringMode = "full"`.

### Re-score
- Endpoint: `POST /api/diligence/rescore`
- Supports:
  - Incremental re-score (default): `forceFull = false`
  - Full re-score: `forceFull = true`
- Writes `score.scoringMode = "incremental"` or `"full"`.

### Auto-rescore on HubSpot deal link
- Path: `PATCH /api/diligence/[id]`
- When a deal is linked and company data is resolved, background rescore is auto-triggered if the record already has a score.
- Trigger is fire-and-forget to avoid blocking UI.

## 2) Input Assembly Before Scoring

Both `/score` and `/rescore` build a `documentTexts[]` array for scoring and then call `scoreDiligence(...)`.

### 2.1 HubSpot company refresh
- If record has `hubspotDealId`, backend refreshes associated company data first.
- Persisted into:
  - `hubspotCompanyId`
  - `hubspotCompanyName`
  - `hubspotCompanyData`

### 2.2 Document sources
- Existing diligence documents with extracted text.
- Google Drive folder scan:
  - `/score`: discovers and parses missing files.
    - Dedupes against existing docs by both Drive file ID and normalized filename.
  - `/rescore`:
    - always discovers newly added files;
    - full mode also re-downloads/re-parses Drive-backed docs.
- Company description, if present.
- Website content fetch (URL-valid records).
- Optional web research document (`Current Web Research & News`) if search is configured.

### 2.3 HubSpot founder pitch deck ingestion
- If `hubspotCompanyData.pitchDeckUrl` exists and is not already linked:
  - attempt to download and parse deck;
  - handles HubSpot HTML redirect pages by extracting direct file URL;
  - if parse/import fails, creates a link-only document so URL still enters context.

### 2.4 Minimal fallback
- If no analyzable docs remain, a minimal `Company Information` synthetic document is created (URL-only analysis path).

## 3) Criteria and Configuration Inputs

### Criteria source
- Loaded from Google Sheets (`loadDiligenceCriteria`).
- Sheet columns map to:
  - category
  - category weight
  - criterion
  - description
  - scoring guidance
  - optional `insufficientEvidenceCap`

### App setting affecting scoring
- `summarizeTranscriptNotesForScoring` (default `false`)
- If true, very long categorized notes are summarized before prompting.

## 4) Metric Precedence and Provenance Rules

Routes build `metricsForScoring` with conservative precedence:

1. Start from persisted `record.metrics`.
2. If ARR missing and HubSpot `annualRevenue` exists, set ARR as:
   - `source: "manual"` (treated as contracted ARR from founder intake)
3. If TAM missing and HubSpot `tamRange` exists, set TAM as:
   - `source: "manual"`
4. Funding amount guard:
   - if funding amount equals "cash on hand" and there is no explicit raise signal, funding amount is dropped for scoring.
5. TAM fallback guard (route-level, score + rescore):
   - if scorer returns empty `metrics.tam` but `score.externalMarketIntelligence` includes TAM,
   - persist TAM into `metrics.tam` using market-intel value (prefer company-claim TAM, fallback independent TAM).

Inside scorer:
- Additional metrics are derived from extracted facts/external intel (`deriveMetricsFromFacts`).
- Final metrics are merged via `mergeMetrics`:
  - manual values win;
  - existing populated values generally win over inferred fallback.

## 5) Core Scoring Pipeline (`scoreDiligence`)

## Pass 1: Structured fact extraction
- Function: `extractCompanyFacts(...)`
- Model extracts normalized JSON facts across:
  - overview, problem/solution, customers, traction, team, market, model, financials, GTM, risks, data quality
- Output is converted into a structured textual fact block for pass 2.
- If extraction fails, scorer falls back to raw document text slices.

## Pass 1.5: External market intelligence
- Function: `deriveExternalMarketIntelligence(...)`
- Produces:
  - TAM/SAM/SOM claim vs independent estimate
  - competitor landscape
  - competitive threat score
- Hard anti-fabrication guard:
  - If no reliable TAM evidence, independent TAM/SAM/SOM are forced to `unknown` and confidence reduced.

## Pass 2: Evidence-based scoring
- Builds criterion evidence snippets with `buildCriterionContexts(...)`.
- Optionally summarizes long transcript-like notes.
- Constructs full scoring prompt with strict JSON schema and evidence instructions.

Prompt includes:
- information hierarchy (notes/thesis/learning context first),
- extracted facts,
- external intelligence,
- source-of-truth metrics,
- founder-provided HubSpot company data (high-trust intake fields),
- resolved/open questions with behavior rules.

Notable prompt rules:
- `companyOneLiner` must not start with company name.
- `industry` should prefer vertical/market sector over business model.
- answered Q&A must be treated as confirmed facts and not re-suggested.
- source-of-truth metrics are authoritative unless explicit stronger contradiction exists.

## 6) Post-Model Normalization and Quality Gates

After model JSON returns:

1. **Name/shape normalization**
   - category and criterion names are mapped back to sheet-defined structure.
   - missing/invalid fields get conservative defaults.

2. **Insufficient evidence policy**
   - per-criterion caps can be applied via `insufficientEvidenceCap`.
   - additional caps for `unknown`, `contradicted`, or weak/no evidence.

3. **Reasoning quality enforcement**
   - rewrites generic reasoning into concrete, evidence-aware prose when needed.

4. **Manual calibration**
   - optional category adjustments from historical override patterns.

5. **External market penalties**
   - market-related categories can be penalized for overstated TAM alignment or high competitive threat.

6. **Thesis specificity enforcement**
   - strengthens "concerning" and founder questions based on weak/material criteria.
   - de-duplicates semantically similar lines.
   - suppresses topics previously marked to suppress by manual overrides.

7. **Follow-up question synthesis**
   - merges top-level, thesis, and criterion-level follow-ups; dedupes and keeps top 5.

8. **Overall score**
   - recalculated from weighted category scores for consistency.

## 7) Token/Rate-Limit Fallback Strategy

If full prompt fails on token/rate constraints:
- scorer falls back to category-by-category scoring:
  - score each category independently,
  - then run synthesis prompt for thesis/dataQuality/follow-ups/metadata.
- Uses retry with backoff for token/rate-limit errors in JSON helper calls.

## 8) Re-score Mode Semantics

In `/api/diligence/rescore`:

### Incremental mode (`forceFull = false`)
- Keeps existing parsed docs.
- Adds only newly discovered Drive docs.
- Does not force website/news refresh.
- Computes scoring fingerprint pre-run; if unchanged and no new docs, returns `skipped: true`.

### Full mode (`forceFull = true`)
- Re-downloads/re-parses Drive-backed docs.
- Refreshes website content and web search context.
- Always re-runs full scoring.

## 9) Fingerprinting and Skip Logic

Fingerprint utility: `buildScoringFingerprint(...)` (SHA-256 over normalized scoring inputs).

Inputs include:
- company identity and description,
- notes/categorized notes,
- normalized metrics and metric sources,
- document names/types/text,
- criteria payload,
- scorer version,
- transcript-summary setting.

Used for:
- skip/no-op optimization in incremental rescore,
- persisted traceability as `score.scoringInputFingerprint`.

## 10) Manual Override and Thesis Preservation Behavior

### Initial score route
- If thesis answers were manually edited previously, those thesis answers are preserved over AI output.

### Re-score route
- Preserves category manual overrides (`manualOverride`, reason, timestamp).
- Recalculates overall score using effective overridden category scores.
- Preserves manually edited thesis answers.
- Appends a structured rescore narrative summarizing:
  - prior vs new AI-only vs final score,
  - biggest category deltas,
  - top material risks,
  - top founder follow-ups.

## 11) Persisted Outputs

Primary persisted fields:
- `record.score`:
  - overall, categories, criteria-level evidence/confidence/status/missingData/followUps,
  - thesis answers,
  - follow-up questions,
  - data quality,
  - external market intelligence,
  - scored timestamp,
  - scoring fingerprint and mode.
- `record.metrics` (resolved metrics after precedence/merge).
- metadata from model:
  - `companyOneLiner`
  - `industry`
  - `founders`

Post-write:
- if linked to HubSpot deal, score sync to HubSpot is attempted.

## 12) Evidence Status and Confidence Model

Each criterion carries:
- `confidence` (0-100)
- `evidenceStatus`:
  - `supported`
  - `weakly_supported`
  - `unknown`
  - `contradicted`
- `evidence[]`
- `missingData[]`
- `followUpQuestions[]`

These fields are first-class drivers of:
- conservative caps,
- risk materiality ranking,
- generated thesis concerns/questions.

## 13) Current Design Intent (Practical Summary)

The current architecture is optimized for:
- high evidence traceability over generic commentary,
- conservative behavior under uncertainty,
- explicit use of founder-provided HubSpot intake context,
- anti-fabrication safeguards for market sizing,
- stable rescoring with incremental skip checks,
- preserving user edits/overrides as authoritative.

## 14) Quick Sequence (End-to-End)

1. Route loads record and refreshes HubSpot company (if linked).
2. Route assembles context docs (Drive docs + optional website/search + HubSpot deck).
3. Route prepares `metricsForScoring` with provenance rules.
4. Route calls `scoreDiligence(...)`.
5. Scorer performs two-pass extraction + scoring (+ external intel).
6. Scorer normalizes, applies guards/penalties/calibration, returns score + metrics + metadata.
7. Route preserves manual thesis/overrides as applicable, stores score/metrics/metadata/fingerprint.
8. Route optionally syncs result to HubSpot deal.

## 15) Current Debug Hooks for Duplicate Docs + Metrics Mapping

When `DEBUG_DILIGENCE_PIPELINE=1` (or non-production runtime), routes emit targeted logs:

- `app/api/diligence/score/route.ts`
  - `[diligence-score][documents_dedupe]`
  - `[diligence-score][metrics_before_persist]`
  - `[diligence-score][metrics_after_persist]`
  - `[diligence-score][tam_fallback_applied]` (only when fallback triggers)

- `app/api/diligence/rescore/route.ts`
  - `[diligence-rescore][documents_after_refresh]`
  - `[diligence-rescore][metrics_before_persist]`
  - `[diligence-rescore][metrics_after_persist]`
  - `[diligence-rescore][tam_fallback_applied]`

- `app/api/hubspot/create/commit/route.ts`
  - `[hubspot-create-commit][resolved_metric_candidates]`
  - `[hubspot-create-commit][persisted_metric_snapshot]`

