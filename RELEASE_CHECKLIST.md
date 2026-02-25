# Release Checklist (10 Minutes)

Use this before each production release to catch regressions in scoring, UI, and PDF export.

## 1) Core Scoring Flows (2 min)

- [ ] Run **Incremental Re-score** on a recent record.
- [ ] Run **Full Re-score** on the same record.
- [ ] Run **single-category re-score** from the scoring grid refresh icon.
- [ ] Confirm re-score status banner progresses and completes without errors.

## 2) TAM + Market Growth Validation (2 min)

Use one rich record (for example `Implentio`) and one sparse/heuristic record (for example `Pippin Title`).

- [ ] Rich record shows:
  - [ ] `metrics.tam` populated
  - [ ] `metrics.marketGrowthRate` populated
  - [ ] Market criteria answers not `unknown`
- [ ] Sparse record shows:
  - [ ] Independent TAM fallback populated (not blank)
  - [ ] Market growth fallback populated when possible
  - [ ] AI details include concise method/assumption backup (not just a raw number)

## 3) Answer Builder + Token Checks (1 min)

- [ ] Business model criterion renders from `{{businessModelThesis}}` (not `not available`).
- [ ] Team criterion renders from `{{teamStrengthLabel}}`.
- [ ] Synergy criterion renders from `{{portfolioSynergyLevel}}`.
- [ ] Problem necessity renders capitalized class via `{{problemNecessityClass}}` (Vitamin/Advil/Vaccine).

## 4) Scoring Grid UX Checks (1 min)

- [ ] Category refresh icon appears on right side between score and caret.
- [ ] Notes header shows `No notes yet` when empty, otherwise `X notes`.
- [ ] Key Metrics source info is hover-only (no extra question-mark badge under values).

## 5) Funding Guardrail (1 min)

- [ ] Deal Terms reasoning does **not** claim a raise amount from "cash on hand" text.
- [ ] Funding amount is treated as unknown unless explicit raise language exists.

## 6) PDF Export Validation (2 min)

Generate PDF with `Overview`, `Score`, `Metrics`, `Scoring Grid`, and `Notes`.

- [ ] Founder names are clickable hyperlinks (on name itself).
- [ ] Overall score matches diligence page score.
- [ ] Only set key metrics are shown in PDF.
- [ ] Scoring Grid includes `Criterion`, `Answer`, `Score`, `Details`.
- [ ] Details prefer user entry when available, otherwise AI details.
- [ ] No section truncation/cut-off in output pages.

## 7) HubSpot Roundtrip (1 min)

- [ ] Change HubSpot stage from diligence detail page; ensure update persists.
- [ ] Save metrics and verify write-through sync still succeeds.

## 8) Release Gate

Ship only if all checks above are green.

If any check fails:

1. Capture record ID + screenshot.
2. Re-run full re-score once.
3. If still failing, block release and file a bug with exact failing checklist item.

## 9) Thesis Check Learning + Document Readability (2 min)

- [ ] Run a thesis-first pass on a record with an uploaded deck.
- [ ] Confirm `Why this fits` and `Why it might not be a fit` are both non-generic and evidence-based.
- [ ] Confirm no slide-outline/source fragment noise appears in problem/solution snapshot fields.
- [ ] If a deck/link is unreadable, confirm a visible **Document readability warning** is shown.
- [ ] Confirm thesis feedback entries are persisting in the active storage backend (`gcs` in production) so model examples keep improving over time.
