import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import { DiligenceRecord, ThesisFitFeedbackEntry, ThesisFitResult } from "@/types/diligence";
import { listThesisFitFeedback } from "@/lib/thesis-fit-feedback-storage";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const THESIS_FIT_MODEL_VERSION = "thesis-fit-v1-2026-02-16";
const THESIS_CONFLICT_TAG_PATTERN = /\[(pillar|dealbreaker):\s*[a-z0-9_\- ]+\]/i;
const MISSINGNESS_PATTERN =
  /\b(unknown|unclear|missing|no evidence|lack of|not provided|insufficient|not enough|undisclosed|limited detail|incomplete)\b/i;
const STRONG_CONFLICT_PATTERN =
  /\b(off-thesis|not on thesis|direct conflict|misaligned|no moat|weak founder[- ]market fit|services-heavy|hardware dependency|b2c|consumer marketplace)\b/i;
const GENERIC_FOUNDER_GAP_PATTERN =
  /\b(no information on founders|founder domain depth|execution credibility|founder.*not provided)\b/i;
const GENERIC_FINANCIAL_GAP_PATTERN =
  /\b(arr|tam|sam|som|acv|yoy|financial metrics|gtm efficiency|capital efficiency)\b/i;
const ANTI_CONFLICT_PATTERN =
  /\b(no indication|no evidence|not a core dependency|not a major component|does not appear to be)\b/i;

function clampScore(value: unknown, fallback = 50): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function asStringArray(value: unknown, max = 5): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeBulletText(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function collapseRepeatedPhraseTail(text: string): string {
  const value = normalizeBulletText(text);
  if (!value) return "";
  return value.replace(/\b(.{12,80}?)\s+\1\b/gi, "$1");
}

function stripDeckExtractionArtifacts(input: unknown): string {
  const raw = String(input || "");
  if (!raw) return "";
  return raw
    .replace(/\b\d+\s*\/\s*\d+\b/g, " ")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, " ")
    .replace(/\b(powered by docsend|docsend privacy policy|cookies\s*&\s*ccpa preferences)\b/gi, " ")
    .replace(/\b(select page|content unavailable|this content is no longer available)\b/gi, " ")
    .replace(/\b(there was an error loading part of this content|please enable cookies then reload the page)\b/gi, " ")
    // Remove injected web-search scaffolding/error lines from thesis-first context docs.
    .replace(/#\s*web search results[^\n]*/gi, " ")
    .replace(/search performed:\s*[^\n]*/gi, " ")
    .replace(/##\s*search:\s*"[^\n]*"/gi, " ")
    .replace(/⚠️?\s*search failed:\s*[^\n]*/gi, " ")
    .replace(/serper api error:\s*[^\n]*/gi, " ")
    .replace(/#\s*current web information[^\n]*/gi, " ")
    .replace(/\*\*analysis instructions\*\*:[\s\S]*$/gi, " ")
    .replace(/\boutline\s+\d+\b/gi, " ")
    .replace(/\bsource:\s*[^.!?\n]{0,220}/gi, " ")
    .replace(/\b[A-D]\s+problem\s+[A-D]\s+solution\s+[A-D]\s+opportunity\b/gi, " ")
    .replace(/\n?\s*---\s*\n?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripRichTextArtifacts(input: unknown): string {
  const raw = String(input || "");
  if (!raw) return "";
  return raw
    .replace(/<o:p>\s*<\/o:p>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/Reply,\s*and\s*I[’']ll\s*share\s*the\s*deck\.?/gi, " ")
    .replace(/mso-[a-z-]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingSlideMarker(line: string): string {
  return normalizeBulletText(String(line || "").replace(/^\s*\d{1,2}\s+(?=[A-Za-z(])/g, ""));
}

function sanitizeSnapshotCandidate(line: string): string {
  return normalizeBulletText(
    stripLeadingSlideMarker(
      String(line || "")
        .replace(/(?:\b[A-Z]\s+){4,}[A-Z]\b/g, " ")
        .replace(/\s+[—–-]\s+[^.?!\n]{20,}$/g, " ")
        .replace(/\s+[→➜]\s+[^.?!\n]{10,}$/g, " ")
        .replace(/\boutline\s+\d+\b/gi, " ")
        .replace(/\bsource:\s*[^.!?\n]{0,220}/gi, " ")
        .replace(/\b[A-D]\s+problem\s+[A-D]\s+solution\s+[A-D]\s+opportunity\b/gi, " ")
    )
  );
}

function isLikelyDeckFragment(line: string): boolean {
  const text = sanitizeSnapshotCandidate(line);
  if (!text) return true;
  if (text.length < 24) return true;
  if (/^\d+\s*(?:\/\s*\d+)?$/.test(text)) return true;
  if (/(?:\b[A-Z]\s+){4,}[A-Z]\b/.test(text)) return true;
  if (/^(?:[A-D]\s+[A-Za-z][A-Za-z-]*){2,}$/.test(text.replace(/\s+/g, " "))) return true;
  if (/\binsuring resilience outline\b/i.test(text)) return true;
  const looksBioTail =
    /\b(ph\.?d\.?|professor|harvard|wharton|stanford|uc berkeley|uc san diego|treasury)\b/i.test(text) &&
    !/\b(problem|pain|challenge|solution|platform|product|inspection|underwriting|insurance)\b/i.test(text);
  if (looksBioTail) return true;
  if (/\b(founder and ceo|select page|document request and collection|uploaded directly to the platform)\b/i.test(text)) {
    return true;
  }
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) return true;
  return false;
}

function dedupeList(items: string[], max = 6): string[] {
  const normalized = items.map(normalizeBulletText).filter(Boolean);
  return Array.from(new Set(normalized)).slice(0, max);
}

function asShortString(value: unknown, max = 280): string | undefined {
  const base = normalizeBulletText(stripDeckExtractionArtifacts(stripRichTextArtifacts(value)));
  if (!base) return undefined;
  const sentences = base
    .split(/(?<=[.!?])\s+|\n+|\s+\|\s+|(?<=\D)\s{2,}(?=[A-Z])/)
    .map((line) => sanitizeSnapshotCandidate(line))
    .filter(Boolean)
    .filter((line) => !isLikelyDeckFragment(line));
  const best = sentences.length > 0 ? sentences.slice(0, 2).join(" ") : base;
  const trimmed = best
    .replace(/(?:\b[A-Z]\s+){4,}[A-Z]\b[\s\S]*$/g, "")
    .replace(/\b(ph\.?d\.?|professor|harvard|wharton|stanford|uc berkeley|uc san diego|treasury)\b[\s\S]*$/i, "")
    .trim();
  return collapseRepeatedPhraseTail(trimmed).slice(0, max);
}

function normalizeComparableToken(value: unknown): string {
  return normalizeBulletText(stripRichTextArtifacts(value))
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^\w.\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLowInformationText(value: unknown, disallowedTokens: string[] = []): boolean {
  const text = normalizeBulletText(stripRichTextArtifacts(value)).toLowerCase();
  if (!text) return true;
  if (/\b(unknown|unclear|not specified|not provided|insufficient|no information|n\/a|none)\b/.test(text)) {
    return true;
  }
  const normalized = normalizeComparableToken(text);
  if (!normalized) return true;
  if (disallowedTokens.some((token) => token && normalized === token)) {
    return true;
  }
  return false;
}

function isNonInformativeExtractedText(value: unknown): boolean {
  const text = normalizeBulletText(String(value || "").toLowerCase());
  if (!text) return true;
  return (
    text.includes("pdf was parsed but contains minimal extractable text") ||
    text.includes("document could not be parsed") ||
    text.includes("pdf parsing library is not properly configured") ||
    text.includes("external document link:") ||
    text.includes("failed to ingest external link") ||
    text.includes("content appears unavailable from mirror fetch")
  );
}

function firstUsableShortString(candidates: unknown[], max = 320, disallowedTokens: string[] = []): string | undefined {
  for (const candidate of candidates) {
    if (isLowInformationText(candidate, disallowedTokens)) continue;
    const short = asShortString(candidate, max);
    if (short) return short;
  }
  return undefined;
}

function buildDisallowedSummaryTokens(record: DiligenceRecord): string[] {
  const companyName = normalizeComparableToken(record.companyName || "");
  const website = normalizeComparableToken(record.companyUrl || "");
  const websiteHost = website.split("/")[0] || "";
  const websiteRoot = websiteHost.split(".")[0] || "";
  return Array.from(new Set([companyName, websiteHost, websiteRoot].filter(Boolean)));
}

function collectSignalSentences(record: DiligenceRecord, signal: "problem" | "solution"): string[] {
  const docsText = (record.documents || [])
    .map((doc) => String(doc.extractedText || "").replace(/\s+/g, " ").trim())
    .filter((text) => !isNonInformativeExtractedText(text))
    .map((text) => stripDeckExtractionArtifacts(text))
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
  const notesText = (record.categorizedNotes || [])
    .map((note) => `${note.title || ""} ${note.content || ""}`.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  const corpus = `${record.companyDescription || ""} ${record.companyOneLiner || ""} ${notesText} ${docsText}`;
  const sentences = corpus
    .split(/(?<=[.!?])\s+|\n+|\s+\|\s+|(?<=\D)\s{2,}(?=[A-Z])/)
    .map((sentence) => sanitizeSnapshotCandidate(sentence))
    .filter(Boolean)
    .filter((sentence) => !isLikelyDeckFragment(sentence));
  const matcher =
    signal === "problem"
      ? /\b(problem|pain|challenge|manual|delay|inefficien|cost|bottleneck|risk|error|friction)\b/i
      : /\b(solution|platform|product|automate|workflow|infrastructure|agent|software|tool|model)\b/i;
  return dedupeList(sentences.filter((sentence) => matcher.test(sentence)), 4);
}

function buildRichSnapshot(
  primary: string | undefined,
  fallbackLines: string[],
  max = 320
): string | undefined {
  const primaryClean = asShortString(primary, max);
  const fallback = fallbackLines
    .map((line) => asShortString(line, Math.round(max / 2)))
    .filter(Boolean) as string[];
  if (primaryClean && fallback.length > 0 && !fallback.some((line) => primaryClean.includes(line))) {
    return asShortString(`${primaryClean} ${fallback[0]}`, max);
  }
  if (primaryClean) return primaryClean;
  if (fallback.length >= 2) return asShortString(`${fallback[0]} ${fallback[1]}`, max);
  if (fallback.length === 1) return asShortString(fallback[0], max);
  return undefined;
}

function firstCleanSentence(value: string | undefined, max = 320): string | undefined {
  const cleaned = asShortString(value, max);
  if (!cleaned) return undefined;
  const sentence = cleaned
    .split(/(?<=[.!?])\s+|\s+[—–-]\s+|\s+[→➜]\s+/)
    .map((part) => sanitizeSnapshotCandidate(part))
    .find((part) => part && !isLikelyDeckFragment(part));
  if (!sentence) return undefined;
  return sentence.slice(0, max);
}

function buildConciseSnapshot(primary: string | undefined, fallbackLines: string[], max = 320): string | undefined {
  const primarySentence = firstCleanSentence(primary, max);
  if (primarySentence) return primarySentence;
  for (const line of fallbackLines) {
    const candidate = firstCleanSentence(line, max);
    if (candidate) return candidate;
  }
  return undefined;
}

function extractStructuredFactValue(
  record: DiligenceRecord,
  label: "Problem" | "Approach" | "Solution" | "What They Do"
): string | undefined {
  const structuredFactsDoc = (record.documents || []).find((doc) =>
    /structured facts \(scoring extractor\)/i.test(String(doc.name || ""))
  );
  const text = String(structuredFactsDoc?.extractedText || "");
  if (!text) return undefined;
  const match = text.match(new RegExp(`-\\s*\\*\\*${label}\\*\\*:\\s*([^\\n]+)`, "i"));
  const value = normalizeBulletText(match?.[1] || "");
  return value && !/not specified|unknown|not disclosed/i.test(value) ? value : undefined;
}

function splitConflictsAndGaps(
  rawWhyNotFit: string[],
  rawEvidenceGaps: string[]
): { conflicts: string[]; gaps: string[] } {
  const conflicts: string[] = [];
  const gaps: string[] = [...rawEvidenceGaps];

  for (const item of rawWhyNotFit) {
    const line = normalizeBulletText(item);
    if (!line) continue;
    const hasTag = THESIS_CONFLICT_TAG_PATTERN.test(line);
    const looksMissingness = MISSINGNESS_PATTERN.test(line);
    const looksStrongConflict = STRONG_CONFLICT_PATTERN.test(line);
    const looksAntiConflict = ANTI_CONFLICT_PATTERN.test(line);

    // Keep only explicit or strongly worded thesis conflicts in whyNotFit.
    if (((hasTag && !looksMissingness) || (looksStrongConflict && !looksMissingness)) && !looksAntiConflict) {
      conflicts.push(line);
    } else {
      gaps.push(line);
    }
  }

  return {
    conflicts: dedupeList(conflicts, 5),
    gaps: dedupeList(gaps, 6),
  };
}

function synthesizeCruxQuestion(
  whyFits: string[],
  whyNotFit: string[],
  evidenceGaps: string[]
): string {
  if (whyNotFit.length > 0) {
    const primaryConflict = whyNotFit[0].replace(THESIS_CONFLICT_TAG_PATTERN, "").trim();
    return `What specific evidence in the next 1-2 quarters would resolve this thesis conflict: ${primaryConflict}?`;
  }
  if (evidenceGaps.length > 0) {
    return `Which single missing datapoint, if verified, would most change conviction on thesis fit?`;
  }
  if (whyFits.length > 0) {
    return `Is this strength durable enough to remain true as the company scales?`;
  }
  return "What evidence would most increase conviction on thesis fit right now?";
}

function inferHeuristicThesisConflicts(record: DiligenceRecord): string[] {
  const corpus = [
    record.companyOneLiner || "",
    record.industry || "",
    record.companyDescription || "",
    ...(record.documents || []).map((d) => d.extractedText || "").slice(0, 2),
  ]
    .join(" ")
    .toLowerCase();

  const heuristics: string[] = [];

  if (/\b(mga|underwriting|insurer|insurance|carrier|reinsurer|catastrophe|claims)\b/.test(corpus)) {
    heuristics.push(
      "[pillar: business_model] Business model appears regulated and insurance-risk linked, which may be less aligned with classic software-first economics."
    );
  }

  if (/\b(service|consulting|implementation-heavy|managed service)\b/.test(corpus)) {
    heuristics.push(
      "[dealbreaker: services_heavy] Delivery motion may trend services-heavy, which can weaken software scalability and margin profile."
    );
  }

  if (/\b(government|public sector|education)\b/.test(corpus)) {
    heuristics.push(
      "[pillar: sales_cycle] Go-to-market may involve longer procurement cycles and higher friction than preferred."
    );
  }

  if (/\b(transit|rail|metro|bus|airport|aviation|infrastructure)\b/.test(corpus)) {
    heuristics.push(
      "[pillar: sales_cycle] End-market appears infrastructure/public-procurement adjacent, which can imply longer enterprise sales cycles and slower expansion velocity."
    );
  }

  if (/\b(computer vision|vision ai|physical vision|camera|sensor|edge device|drone|hardware|robotics)\b/.test(corpus)) {
    heuristics.push(
      "[pillar: software_scalability] Product may depend on hardware/sensor deployment and on-site integration, which can pressure margins and repeatability versus pure software delivery."
    );
  }

  if (/\b(safety inspection|compliance|certification|regulated|regulatory)\b/.test(corpus)) {
    heuristics.push(
      "[pillar: deployment_risk] Safety/compliance-critical workflows can introduce validation and adoption friction that slows rollout and revenue realization."
    );
  }

  return dedupeList(heuristics, 3);
}

function inferHeuristicWhyFits(record: DiligenceRecord): string[] {
  const hints: string[] = [];
  const metrics = record.metrics || {};
  const arr = normalizeBulletText(metrics.arr?.value || "");
  const tam = normalizeBulletText(metrics.tam?.value || "");
  const yoy = normalizeBulletText(metrics.yoyGrowthRate?.value || "");
  const marketGrowth = normalizeBulletText(metrics.marketGrowthRate?.value || "");
  const runway = normalizeBulletText(metrics.currentRunway?.value || "");

  const thesisExciting = Array.isArray(record.score?.thesisAnswers?.exciting)
    ? record.score?.thesisAnswers?.exciting
    : (record.score?.thesisAnswers?.exciting ? [record.score.thesisAnswers.exciting] : []);
  for (const item of thesisExciting || []) {
    const line = normalizeBulletText(item || "");
    if (!line || isLowInformationText(line)) continue;
    hints.push(line);
  }

  if (arr) hints.push(`Commercial traction signal present (ARR reported: ${arr}).`);
  if (tam) hints.push(`Market size signal present (TAM reported: ${tam}).`);
  if (yoy || marketGrowth) {
    hints.push(`Growth signal present${yoy ? ` (YoY growth: ${yoy})` : ""}${marketGrowth ? ` (market growth: ${marketGrowth})` : ""}.`);
  }
  if (runway) hints.push(`Operating durability signal present (current runway: ${runway}).`);

  const oneLiner = normalizeBulletText(record.companyOneLiner || record.companyDescription || "");
  if (oneLiner && !isLowInformationText(oneLiner, buildDisallowedSummaryTokens(record))) {
    hints.push(`Clear company narrative available: ${oneLiner.slice(0, 180)}${oneLiner.length > 180 ? "..." : ""}`);
  }

  const informativeDocuments = (record.documents || []).filter(
    (doc) => !isNonInformativeExtractedText(doc.extractedText || "")
  ).length;
  if (informativeDocuments > 0) {
    hints.push(
      `Primary-source evidence is available (${informativeDocuments} document${informativeDocuments === 1 ? "" : "s"} analyzed).`
    );
  }
  if ((record.categorizedNotes || []).length > 0) {
    hints.push(`Analyst notes are available to support initial thesis-fit judgment.`);
  }

  return dedupeList(hints, 5);
}

function inferFitDecision(
  modelFit: string,
  whyFits: string[],
  whyNotFit: string[],
  evidenceGaps: string[]
): ThesisFitResult["fit"] {
  const normalized = modelFit.trim().toLowerCase();
  if (normalized === "on_thesis" || normalized === "off_thesis" || normalized === "mixed") {
    // Guardrail: do not allow off_thesis purely due to missing info with no conflicts.
    if (normalized === "off_thesis" && whyNotFit.length === 0 && evidenceGaps.length > 0) {
      return "mixed";
    }
    return normalized as ThesisFitResult["fit"];
  }

  if (whyNotFit.length >= 3 && whyFits.length <= 1) return "off_thesis";
  if (whyNotFit.length === 0 && whyFits.length >= 2) return "on_thesis";
  return "mixed";
}

function calibrateConfidence(
  modelConfidence: number,
  fit: ThesisFitResult["fit"],
  whyFits: string[],
  whyNotFit: string[],
  evidenceAnchors: string[],
  evidenceGaps: string[]
): number {
  // Blend model confidence with structural evidence so outputs don't collapse to a single value.
  const structural =
    35 +
    (Math.min(evidenceAnchors.length, 6) * 8) +
    (Math.min(whyFits.length, 4) * 4) +
    (Math.min(whyNotFit.length, 4) * 4) -
    (Math.min(evidenceGaps.length, 5) * 5) +
    (fit === "mixed" ? -6 : 0);

  const blended = Math.round((modelConfidence * 0.6) + (structural * 0.4));
  return clampScore(blended, 50);
}

function truncate(text: string, maxChars: number): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[...truncated...]`;
}

function buildFewShotText(items: string[], max = 4): string {
  return items
    .slice(0, max)
    .map((line) => `- ${normalizeBulletText(line).slice(0, 220)}`)
    .join("\n");
}

function feedbackEntrySignature(entry: ThesisFitFeedbackEntry): string {
  const whyFits = dedupeList(entry.reviewerWhyFits || [], 8).map((v) => v.toLowerCase()).sort();
  const whyNotFit = dedupeList(entry.reviewerWhyNotFit || [], 8).map((v) => v.toLowerCase()).sort();
  const evidenceGaps = dedupeList(entry.reviewerEvidenceGaps || [], 8).map((v) => v.toLowerCase()).sort();
  const crux = normalizeBulletText(entry.reviewerCruxQuestion || "").toLowerCase();
  return JSON.stringify({
    companyName: normalizeBulletText(entry.companyName || "").toLowerCase(),
    reviewerFit: entry.reviewerFit,
    whyFits,
    whyNotFit,
    evidenceGaps,
    crux,
  });
}

function dedupeFeedbackEntries(entries: ThesisFitFeedbackEntry[]): ThesisFitFeedbackEntry[] {
  const seen = new Set<string>();
  const output: ThesisFitFeedbackEntry[] = [];
  for (const entry of entries) {
    const signature = feedbackEntrySignature(entry);
    if (seen.has(signature)) continue;
    seen.add(signature);
    output.push(entry);
  }
  return output;
}

async function buildLabeledExamplesPromptSection(record: DiligenceRecord): Promise<string> {
  try {
    const entries = await listThesisFitFeedback({ limit: 120 });
    const usable = dedupeFeedbackEntries(
      entries
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .filter(
          (entry) =>
            entry.reviewerWhyFits.length > 0 &&
            (entry.reviewerWhyNotFit.length > 0 || (entry.reviewerEvidenceGaps || []).length > 0)
        )
    );
    const targetCompany = normalizeBulletText(record.companyName || "").toLowerCase();
    const sameCompany = usable
      .filter(
        (entry) =>
          normalizeBulletText(entry.companyName || "").toLowerCase() === targetCompany
      )
      .slice(0, 2);
    const crossCompany = usable
      .filter(
        (entry) =>
          normalizeBulletText(entry.companyName || "").toLowerCase() !== targetCompany
      )
      .slice(0, Math.max(0, 2 - sameCompany.length));
    const selected = [...sameCompany, ...crossCompany].slice(0, 2);

    if (selected.length === 0) return "";

    const blocks = selected.map((entry, idx) => {
      const gaps = entry.reviewerEvidenceGaps || [];
      return `### Labeled Example ${idx + 1}
Company: ${entry.companyName}
Reviewer fit: ${entry.reviewerFit}
Reviewer confidence: ${entry.reviewerConfidence ?? "unknown"}
Why fits:
${buildFewShotText(entry.reviewerWhyFits)}
Why might not fit (direct thesis conflicts only):
${entry.reviewerWhyNotFit.length > 0 ? buildFewShotText(entry.reviewerWhyNotFit) : "- none"}
Evidence gaps (confidence only):
${gaps.length > 0 ? buildFewShotText(gaps) : "- none"}
Crux question: ${entry.reviewerCruxQuestion || "unknown"}`;
    });

    return `## Calibration Examples (reviewer-labeled)
Use these as style and decision calibration references. Do not copy wording verbatim.
Prioritize examples from the same company name when available.

${blocks.join("\n\n")}`;
  } catch {
    return "";
  }
}

function pruneNonThesisNoise(
  record: DiligenceRecord,
  whyNotFit: string[],
  evidenceGaps: string[]
): { whyNotFit: string[]; evidenceGaps: string[] } {
  const hasDocs = (record.documents || []).some((doc) => Boolean(doc.extractedText?.trim()));
  const hasFounderSignal =
    /(\bceo\b|\bcto\b|\bfounder\b|experience|exits?|consensys|mozilla|mit|leadership)/i.test(
      [
        record.companyDescription || "",
        record.companyOneLiner || "",
        ...(record.documents || []).slice(0, 2).map((doc) => (doc.extractedText || "").slice(0, 2500)),
      ].join(" ")
    );
  const hasTamMetric = Boolean(record.metrics?.tam?.value?.trim() || record.hubspotCompanyData?.tamRange?.trim());
  const hasFinancialMetric =
    hasTamMetric || Boolean(record.metrics?.arr?.value?.trim() || record.metrics?.fundingAmount?.value?.trim());

  const filteredConflicts = whyNotFit.filter((line) => {
    if (GENERIC_FOUNDER_GAP_PATTERN.test(line) && (hasDocs || hasFounderSignal)) return false;
    if (ANTI_CONFLICT_PATTERN.test(line)) return false;
    return true;
  });

  const filteredGaps = evidenceGaps.filter((line) => {
    if (GENERIC_FOUNDER_GAP_PATTERN.test(line) && (hasDocs || hasFounderSignal)) return false;
    if (GENERIC_FINANCIAL_GAP_PATTERN.test(line) && hasFinancialMetric) return false;
    // Drop low-value anti-conflict statements entirely (they are neither risk nor useful gap).
    if (ANTI_CONFLICT_PATTERN.test(line)) return false;
    return true;
  });

  return {
    whyNotFit: dedupeList(filteredConflicts, 5),
    evidenceGaps: dedupeList(filteredGaps, 6),
  };
}

function buildRecordContext(record: DiligenceRecord): string {
  const metrics = record.metrics || {};
  const hubspotDescription = record.hubspotCompanyData?.description || "";
  const hubspotIndustry = record.hubspotCompanyData?.industry || "";
  const disallowedSummaryTokens = buildDisallowedSummaryTokens(record);
  const bestCompanyDescription =
    firstUsableShortString(
      [record.companyDescription, record.companyOneLiner, hubspotDescription],
      600,
      disallowedSummaryTokens
    ) || "unknown";
  const bestOneLiner =
    firstUsableShortString(
      [record.companyOneLiner, record.companyDescription, hubspotDescription],
      320,
      disallowedSummaryTokens
    ) || "unknown";
  const bestIndustry =
    firstUsableShortString([record.industry, hubspotIndustry], 160) || "unknown";
  const metricLines = [
    `ARR: ${metrics.arr?.value || "unknown"}`,
    `TAM: ${metrics.tam?.value || "unknown"}`,
    `Market Growth: ${metrics.marketGrowthRate?.value || "unknown"}`,
    `ACV: ${metrics.acv?.value || "unknown"}`,
    `YoY Growth: ${metrics.yoyGrowthRate?.value || "unknown"}`,
    `Funding Amount: ${metrics.fundingAmount?.value || "unknown"}`,
    `Current Commitments: ${metrics.committed?.value || "unknown"}`,
    `Runway: ${metrics.currentRunway?.value || "unknown"}`,
    `Location: ${metrics.location?.value || "unknown"}`,
  ].join("\n");

  const categoryScores = (record.score?.categories || [])
    .map((cat) => `- ${cat.category}: ${cat.score}/100`)
    .join("\n");

  const concerning = Array.isArray(record.score?.thesisAnswers?.concerning)
    ? record.score?.thesisAnswers?.concerning.join("\n- ")
    : record.score?.thesisAnswers?.concerning || "";

  const exciting = Array.isArray(record.score?.thesisAnswers?.exciting)
    ? record.score?.thesisAnswers?.exciting.join("\n- ")
    : record.score?.thesisAnswers?.exciting || "";

  const notes = (record.categorizedNotes || [])
    .map((n) => `${n.category}: ${n.title || ""}\n${n.content || ""}`)
    .join("\n\n");

  const docs = (record.documents || [])
    .map((doc) => `## ${doc.name}\n${truncate(doc.extractedText || "", 3000)}`)
    .join("\n\n");

  return `# Company
Name: ${record.companyName}
Website: ${record.companyUrl || "unknown"}
Industry: ${bestIndustry}
One-liner: ${bestOneLiner}
Company description: ${bestCompanyDescription}
HubSpot context:
- Domain: ${record.hubspotCompanyData?.domain || "unknown"}
- Employees: ${record.hubspotCompanyData?.numberOfEmployees || "unknown"}
- Location: ${[record.hubspotCompanyData?.city, record.hubspotCompanyData?.state, record.hubspotCompanyData?.country].filter(Boolean).join(", ") || "unknown"}
- LinkedIn: ${record.hubspotCompanyData?.linkedinUrl || "unknown"}

# Metrics
${metricLines}

# Current Score Snapshot
Overall: ${record.score?.overall ?? "unknown"}
Data Quality: ${record.score?.dataQuality ?? "unknown"}
Category Scores:
${categoryScores || "- none"}

# Current Thesis Summary
Problem: ${record.score?.thesisAnswers?.problemSolving || "unknown"}
Solution: ${record.score?.thesisAnswers?.solution || "unknown"}
Ideal Customer: ${record.score?.thesisAnswers?.idealCustomer || "unknown"}
Exciting:
- ${exciting || "none"}
Concerning:
- ${concerning || "none"}

# Analyst Notes
${truncate(notes || "none", 6000)}

# Extracted Document Evidence
${truncate(docs || "none", 12000)}`;
}

async function readMuditaThesisMarkdown(): Promise<string> {
  const thesisPath = path.join(process.cwd(), "config", "mudita-thesis.md");
  try {
    const content = await fs.readFile(thesisPath, "utf-8");
    return content.trim() || "No thesis markdown content found.";
  } catch {
    return "No thesis markdown file found at config/mudita-thesis.md.";
  }
}

export async function runThesisFitAssessment(record: DiligenceRecord): Promise<ThesisFitResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to run thesis fit assessment");
  }

  const muditaThesis = await readMuditaThesisMarkdown();
  const companyContext = buildRecordContext(record);
  const labeledExamples = await buildLabeledExamplesPromptSection(record);

  const prompt = `Evaluate whether this company is on Mudita thesis.

## Mudita Thesis
${muditaThesis}

## Company Context
${companyContext}

${labeledExamples}

Return ONLY valid JSON in this exact schema:
{
  "fit": "on_thesis | mixed | off_thesis",
  "confidence": 0,
  "companyDescription": "1-2 sentence plain-language description of what the company does",
  "problemSolving": "1-2 sentence summary of the core customer problem",
  "solutionApproach": "1-2 sentence summary of how the company solves that problem",
  "whyFits": ["3-5 concise bullets with concrete evidence"],
  "whyNotFit": ["2-5 concise bullets ONLY for direct thesis conflicts (pillar/dealbreaker mismatch), each prefixed with [pillar:<name>] or [dealbreaker:<name>]"],
  "evidenceGaps": ["0-5 missing-information bullets that lower confidence but are NOT thesis conflicts"],
  "evidenceAnchors": ["2-6 direct anchors (metric/claim/gap) used for judgment"],
  "cruxQuestion": "single decision-driving question"
}

Rules:
- Be evidence-based; avoid generic statements.
- If evidence is weak/missing, lower confidence and call out missing evidence explicitly.
- Missing generic diligence information (including incomplete financials) should go to evidenceGaps, not whyNotFit.
- whyNotFit must only include direct conflicts with core thesis pillars or hard dealbreakers.
- Do not place missingness language in whyNotFit.
- Never include "absence of a dealbreaker" bullets (e.g., "no hardware dependency", "no blockchain component") in whyNotFit.
- Fit must be one of: on_thesis, mixed, off_thesis.
- If information is limited, still provide best-effort summaries for companyDescription/problemSolving/solutionApproach and note uncertainty.
- Keep bullets short and decision-relevant.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are a rigorous venture diligence analyst. Judge thesis fit precisely and conservatively.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from model for thesis fit");
  }
  const parsed = JSON.parse(content);

  const rawWhyFits = dedupeList(asStringArray(parsed?.whyFits || parsed?.rationale, 5), 5);
  const rawWhyNotFit = asStringArray(parsed?.whyNotFit || parsed?.topRisks, 5);
  const rawEvidenceGaps = asStringArray(parsed?.evidenceGaps, 5);
  const split = splitConflictsAndGaps(rawWhyNotFit, rawEvidenceGaps);
  const heuristicConflicts = inferHeuristicThesisConflicts(record);
  const heuristicWhyFits = inferHeuristicWhyFits(record);
  const whyFits = rawWhyFits.length > 0 ? rawWhyFits : heuristicWhyFits;
  const rawConflicts = split.conflicts.length > 0 ? split.conflicts : heuristicConflicts;
  const rawGaps = split.gaps;
  const pruned = pruneNonThesisNoise(record, rawConflicts, rawGaps);
  const whyNotFit = pruned.whyNotFit;
  const evidenceGaps = pruned.evidenceGaps;
  const evidenceAnchors = asStringArray(parsed?.evidenceAnchors, 6);
  const disallowedSummaryTokens = buildDisallowedSummaryTokens(record);
  const structuredWhatTheyDo = extractStructuredFactValue(record, "What They Do");
  const structuredProblem = extractStructuredFactValue(record, "Problem");
  const structuredApproach = extractStructuredFactValue(record, "Approach");
  const structuredSolution = extractStructuredFactValue(record, "Solution");
  const problemSignalSentences = collectSignalSentences(record, "problem");
  const solutionSignalSentences = collectSignalSentences(record, "solution");
  const baselineCompanySnapshot =
    firstUsableShortString(
      [record.companyOneLiner, record.companyDescription, record.hubspotCompanyData?.description],
      320,
      disallowedSummaryTokens
    ) || `${record.companyName} appears to be an early-stage company with limited structured context captured so far.`;
  const baselineProblemSnapshot =
    problemSignalSentences[0] ||
    "Core customer pain is not yet clearly evidenced in current materials; validate the highest-frequency workflow bottleneck.";
  const baselineSolutionSnapshot =
    solutionSignalSentences[0] ||
    "Solution approach appears software-led, but product workflow and differentiation details need clearer evidence.";
  const fit = inferFitDecision(String(parsed?.fit || ""), whyFits, whyNotFit, evidenceGaps);
  const confidence = calibrateConfidence(
    clampScore(parsed?.confidence, 50),
    fit,
    whyFits,
    whyNotFit,
    evidenceAnchors,
    evidenceGaps
  );

  return {
    fit,
    confidence,
    companyDescription:
      firstUsableShortString(
        [
          structuredWhatTheyDo,
          parsed?.companyDescription,
          record.companyOneLiner,
          record.companyDescription,
          record.hubspotCompanyData?.description,
        ],
        320,
        disallowedSummaryTokens
      ) || baselineCompanySnapshot,
    problemSolving: buildConciseSnapshot(
      firstUsableShortString(
        [
          structuredProblem,
          record.score?.thesisAnswers?.problemSolving,
          problemSignalSentences[0],
          record.companyDescription,
          record.hubspotCompanyData?.description,
        ],
        320,
        disallowedSummaryTokens
      ),
      problemSignalSentences,
      320
    ) || baselineProblemSnapshot,
    solutionApproach: buildConciseSnapshot(
      firstUsableShortString(
        [
          structuredApproach || structuredSolution,
          record.score?.thesisAnswers?.solution,
          solutionSignalSentences[0],
          record.companyDescription,
          record.hubspotCompanyData?.description,
        ],
        320,
        disallowedSummaryTokens
      ),
      solutionSignalSentences,
      320
    ) || baselineSolutionSnapshot,
    whyFits,
    whyNotFit,
    evidenceGaps,
    cruxQuestion: normalizeBulletText(parsed?.cruxQuestion || synthesizeCruxQuestion(whyFits, whyNotFit, evidenceGaps)),
    // Keep legacy keys populated for older UI paths if any remain cached.
    rationale: whyFits,
    topRisks: whyNotFit,
    evidenceAnchors,
    computedAt: new Date().toISOString(),
    modelVersion: THESIS_FIT_MODEL_VERSION,
  };
}
