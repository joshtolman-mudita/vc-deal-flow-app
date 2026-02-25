import fs from "fs/promises";
import path from "path";
import { Storage } from "@google-cloud/storage";
import { ThesisFitFeedbackEntry } from "@/types/diligence";

const STORAGE_BACKEND = process.env.STORAGE_BACKEND || "local";
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || "";
const FEEDBACK_DIR = path.join(process.cwd(), "data", "thesis-fit-feedback");
const FEEDBACK_GCS_PREFIX = "thesis-fit-feedback/";

let gcsStorage: Storage | null = null;
if (STORAGE_BACKEND === "gcs") {
  gcsStorage = new Storage({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
  });
}

function getGCSBucket() {
  if (!gcsStorage || !GCS_BUCKET_NAME) {
    throw new Error("Google Cloud Storage not configured");
  }
  return gcsStorage.bucket(GCS_BUCKET_NAME);
}

async function ensureFeedbackDir(): Promise<void> {
  if (STORAGE_BACKEND !== "local") return;
  await fs.mkdir(FEEDBACK_DIR, { recursive: true });
}

function buildFeedbackId(): string {
  return `tff_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeText(value: unknown, maxLen = 6000): string | undefined {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.slice(0, maxLen);
}

function normalizeList(input: unknown, max = 8): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((item) => String(item || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
    )
  ).slice(0, max);
}

function safeConfidence(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.max(0, Math.min(100, Math.round(num)));
}

export function sanitizeThesisFitFeedbackInput(
  raw: Partial<ThesisFitFeedbackEntry>
): Omit<ThesisFitFeedbackEntry, "id" | "createdAt"> {
  return {
    diligenceId: String(raw.diligenceId || "").trim(),
    companyName: String(raw.companyName || "").trim(),
    sourceEntryId: normalizeText(raw.sourceEntryId, 120),
    sourceCreatedAt: normalizeText(raw.sourceCreatedAt, 80),
    sourceEnvironment: normalizeText(raw.sourceEnvironment, 40),
    reviewerFit: (String(raw.reviewerFit || "").trim().toLowerCase() as ThesisFitFeedbackEntry["reviewerFit"]) || "mixed",
    reviewerConfidence: safeConfidence(raw.reviewerConfidence),
    reviewerWhyFits: normalizeList(raw.reviewerWhyFits, 8),
    reviewerWhyNotFit: normalizeList(raw.reviewerWhyNotFit, 8),
    reviewerEvidenceGaps: normalizeList(raw.reviewerEvidenceGaps, 8),
    reviewerCruxQuestion: normalizeText(raw.reviewerCruxQuestion, 500),
    reviewerNotes: normalizeText(raw.reviewerNotes, 4000),
    chatgptAssessment: normalizeText(raw.chatgptAssessment, 12000),
    appAssessmentNotes: normalizeText(raw.appAssessmentNotes, 1200),
    appThesisFitSnapshot: raw.appThesisFitSnapshot,
  };
}

function entrySignature(
  input: Pick<
    ThesisFitFeedbackEntry,
    "diligenceId" | "companyName" | "reviewerFit" | "reviewerWhyFits" | "reviewerWhyNotFit" | "reviewerEvidenceGaps" | "reviewerCruxQuestion"
  >
): string {
  const normalized = {
    diligenceId: input.diligenceId.trim().toLowerCase(),
    companyName: input.companyName.trim().toLowerCase(),
    reviewerFit: input.reviewerFit,
    reviewerWhyFits: [...input.reviewerWhyFits].map((v) => v.toLowerCase()).sort(),
    reviewerWhyNotFit: [...input.reviewerWhyNotFit].map((v) => v.toLowerCase()).sort(),
    reviewerEvidenceGaps: [...(input.reviewerEvidenceGaps || [])].map((v) => v.toLowerCase()).sort(),
    reviewerCruxQuestion: (input.reviewerCruxQuestion || "").trim().toLowerCase(),
  };
  return JSON.stringify(normalized);
}

export async function saveThesisFitFeedback(
  input: Omit<ThesisFitFeedbackEntry, "id" | "createdAt">
): Promise<ThesisFitFeedbackEntry> {
  const fit = input.reviewerFit;
  if (fit !== "on_thesis" && fit !== "mixed" && fit !== "off_thesis") {
    throw new Error("reviewerFit must be one of: on_thesis, mixed, off_thesis");
  }
  if (!input.diligenceId) {
    throw new Error("diligenceId is required");
  }
  if (!input.companyName) {
    throw new Error("companyName is required");
  }

  const entry: ThesisFitFeedbackEntry = {
    ...input,
    id: buildFeedbackId(),
    createdAt: new Date().toISOString(),
  };
  const content = JSON.stringify(entry, null, 2);

  if (STORAGE_BACKEND === "gcs") {
    const bucket = getGCSBucket();
    const file = bucket.file(`${FEEDBACK_GCS_PREFIX}${entry.id}.json`);
    await file.save(content, {
      contentType: "application/json",
      metadata: { cacheControl: "no-cache" },
    });
    return entry;
  }

  await ensureFeedbackDir();
  const filePath = path.join(FEEDBACK_DIR, `${entry.id}.json`);
  await fs.writeFile(filePath, content, "utf-8");
  return entry;
}

export async function importThesisFitFeedback(
  rawEntries: Array<Partial<ThesisFitFeedbackEntry>>
): Promise<{
  imported: ThesisFitFeedbackEntry[];
  skippedDuplicates: number;
}> {
  const existing = await listThesisFitFeedback({ limit: 5000 });
  const signatures = new Set(existing.map((entry) => entrySignature(entry)));

  const imported: ThesisFitFeedbackEntry[] = [];
  let skippedDuplicates = 0;

  for (const raw of rawEntries) {
    const cleaned = sanitizeThesisFitFeedbackInput(raw);
    if (!cleaned.diligenceId || !cleaned.companyName) continue;

    const signature = entrySignature({
      ...cleaned,
      reviewerEvidenceGaps: cleaned.reviewerEvidenceGaps || [],
    } as ThesisFitFeedbackEntry);
    if (signatures.has(signature)) {
      skippedDuplicates += 1;
      continue;
    }

    const saved = await saveThesisFitFeedback(cleaned);
    imported.push(saved);
    signatures.add(signature);
  }

  return { imported, skippedDuplicates };
}

async function readFeedbackFile(pathOrName: string): Promise<ThesisFitFeedbackEntry | null> {
  try {
    const raw =
      STORAGE_BACKEND === "gcs"
        ? (await getGCSBucket().file(pathOrName).download())[0].toString("utf-8")
        : await fs.readFile(path.join(FEEDBACK_DIR, pathOrName), "utf-8");
    return JSON.parse(raw) as ThesisFitFeedbackEntry;
  } catch {
    return null;
  }
}

export async function listThesisFitFeedback(options?: {
  diligenceId?: string;
  limit?: number;
}): Promise<ThesisFitFeedbackEntry[]> {
  const diligenceId = options?.diligenceId?.trim();
  const limit = Math.max(1, Math.min(options?.limit ?? 100, 1000));

  let files: string[] = [];
  if (STORAGE_BACKEND === "gcs") {
    const [gcsFiles] = await getGCSBucket().getFiles({ prefix: FEEDBACK_GCS_PREFIX });
    files = gcsFiles
      .map((file) => file.name)
      .filter((name) => name.endsWith(".json"));
  } else {
    await ensureFeedbackDir();
    files = (await fs.readdir(FEEDBACK_DIR)).filter((name) => name.endsWith(".json"));
  }

  const entries = (
    await Promise.all(files.map((file) => readFeedbackFile(file)))
  ).filter((entry): entry is ThesisFitFeedbackEntry => Boolean(entry));

  const filtered = diligenceId
    ? entries.filter((entry) => entry.diligenceId === diligenceId)
    : entries;

  return filtered
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}
