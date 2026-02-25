import { NextRequest, NextResponse } from "next/server";
import { loadDiligenceRecord, updateDiligenceRecord } from "@/lib/diligence-storage";
import { runThesisFitAssessment } from "@/lib/thesis-fit";
import { extractStructuredFactsForContext } from "@/lib/diligence-scorer";
import { fetchUrlContent, isValidUrl } from "@/lib/web-fetch";
import { formatSearchResultsForAI, isSearchConfigured, searchCompanyInformation } from "@/lib/web-search";
import { DiligenceDocument, DiligenceRecord } from "@/types/diligence";
import { ingestExternalLink, isLowQualityExtractedLinkContent } from "@/lib/external-link-ingest";
import { isUnreadableExtractedText } from "@/lib/document-parser";

function normalizeSummaryToken(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^\w.\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isThinSummaryValue(value: string | undefined, companyName: string): boolean {
  const normalized = normalizeSummaryToken(value || "");
  if (!normalized) return true;
  const normalizedName = normalizeSummaryToken(companyName || "");
  if (normalizedName && normalized === normalizedName) return true;
  return /\b(unknown|unclear|not specified|not provided|insufficient|no information|n\/a|none)\b/.test(normalized);
}

function isNonInformativeDocumentText(text: string): boolean {
  const normalized = String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized.includes("pdf was parsed but contains minimal extractable text") ||
    normalized.includes("document could not be parsed") ||
    normalized.includes("pdf parsing library is not properly configured") ||
    normalized.includes("external document link:") ||
    normalized.includes("failed to ingest external link") ||
    normalized.includes("content appears unavailable from mirror fetch")
  );
}

function hasMeaningfulFirstPassContext(record: DiligenceRecord): boolean {
  const hasDescription = !isThinSummaryValue(record.companyDescription, record.companyName);
  const hasOneLiner = !isThinSummaryValue(record.companyOneLiner, record.companyName);
  const hasIndustry = !isThinSummaryValue(record.industry, record.companyName);
  const hasSummary =
    hasDescription ||
    hasOneLiner ||
    hasIndustry;
  const hasNotes = (record.categorizedNotes || []).some((note) => Boolean(note.content?.trim()));
  const hasDocs = (record.documents || []).some((doc) => {
    const text = String(doc.extractedText || "").trim();
    if (!text) return false;
    if ((doc.fileType === "link" || doc.fileType === "url") && doc.linkIngestStatus !== "ingested") return false;
    if ((doc.fileType === "link" || doc.fileType === "url") && isLowQualityExtractedLinkContent(text)) return false;
    if (isNonInformativeDocumentText(text)) return false;
    return true;
  });
  return hasSummary || hasNotes || hasDocs;
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

function deriveProblemSolutionContext(record: DiligenceRecord): string {
  const joinedDocText = (record.documents || [])
    .filter((doc) => {
      const text = String(doc.extractedText || "").trim();
      if (!text) return false;
      if ((doc.fileType === "link" || doc.fileType === "url") && doc.linkIngestStatus !== "ingested") return false;
      if ((doc.fileType === "link" || doc.fileType === "url") && isLowQualityExtractedLinkContent(text)) return false;
      if (isNonInformativeDocumentText(text)) return false;
      return true;
    })
    .map((doc) => stripRichTextArtifacts(doc.extractedText || ""))
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
  const notesText = (record.categorizedNotes || [])
    .map((note) => stripRichTextArtifacts(`${note.title || ""} ${note.content || ""}`))
    .filter(Boolean)
    .join(" ");
  const corpus = `${record.companyDescription || ""} ${record.companyOneLiner || ""} ${notesText} ${joinedDocText}`;
  const sentenceCandidates = corpus
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const problemSentences = sentenceCandidates
    .filter((sentence) =>
      /\b(problem|pain|challenge|manual|delay|inefficien|cost|bottleneck|risk|error)\b/i.test(sentence)
    )
    .slice(0, 3);
  const solutionSentences = sentenceCandidates
    .filter((sentence) =>
      /\b(solution|platform|product|automate|workflow|infrastructure|agent|software|tool)\b/i.test(sentence)
    )
    .slice(0, 3);
  const contextBlocks: string[] = [];
  if (problemSentences.length > 0) {
    contextBlocks.push(`Problem signals:\n- ${problemSentences.join("\n- ")}`);
  }
  if (solutionSentences.length > 0) {
    contextBlocks.push(`Solution signals:\n- ${solutionSentences.join("\n- ")}`);
  }
  return contextBlocks.join("\n\n").trim();
}

function collectDocumentReadWarnings(docs: DiligenceDocument[]): string[] {
  const warnings: string[] = [];
  for (const doc of docs || []) {
    const name = String(doc.name || 'Document').trim() || 'Document';
    if ((doc.fileType === 'link' || doc.fileType === 'url') && doc.linkIngestStatus !== 'ingested') {
      warnings.push(
        `${name}: Link ingestion failed${doc.linkIngestMessage ? ` (${doc.linkIngestMessage})` : ''}. This document will not be used in thesis/scoring.`
      );
      continue;
    }
    if (isUnreadableExtractedText(doc.extractedText || '')) {
      warnings.push(`${name}: File is attached but text could not be reliably extracted. This document may be ignored by thesis/scoring.`);
    }
  }
  return Array.from(new Set(warnings)).slice(0, 10);
}

async function enrichForThesisFirstPass(record: DiligenceRecord): Promise<DiligenceRecord> {
  const enriched: DiligenceRecord = {
    ...record,
    documents: [...(record.documents || [])],
  };

  const hasContext = hasMeaningfulFirstPassContext(record);
  if (hasContext) {
    return enriched;
  }
  const hasValidCompanyUrl = Boolean(record.companyUrl && isValidUrl(record.companyUrl));

  let websiteContent: string | undefined;
  if (hasValidCompanyUrl) {
    try {
      const fetched = await fetchUrlContent(record.companyUrl!);
      if (fetched.success && fetched.content) {
        websiteContent = fetched.content.slice(0, 16000);
        enriched.documents.push({
          id: `doc_thesis_first_web_${Date.now()}`,
          name: `Website Snapshot: ${fetched.title || record.companyUrl}`,
          type: "other",
          fileType: "url",
          externalUrl: record.companyUrl,
          uploadedAt: new Date().toISOString(),
          extractedText: websiteContent,
        });
        if (!enriched.companyDescription && fetched.title && !isThinSummaryValue(fetched.title, record.companyName)) {
          enriched.companyDescription = fetched.title;
        }
      }
    } catch (error) {
      console.warn("thesis-first website enrichment failed:", error);
    }
  }

  if (isSearchConfigured()) {
    try {
      const searchContent = await searchCompanyInformation(record.companyName, record.companyUrl);
      const combined = formatSearchResultsForAI(record.companyName, searchContent, websiteContent);
      enriched.documents.push({
        id: `doc_thesis_first_search_${Date.now()}`,
        name: "Current Web Research",
        type: "other",
        fileType: "txt",
        uploadedAt: new Date().toISOString(),
        extractedText: combined.slice(0, 12000),
      });
    } catch (error) {
      console.warn("thesis-first search enrichment failed:", error);
    }
  }

  return enriched;
}

/**
 * POST /api/diligence/[id]/thesis-first
 * Runs lightweight thesis-fit first pass before full scoring.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const record = await loadDiligenceRecord(id);
    if (!record) {
      return NextResponse.json(
        { success: false, error: "Diligence record not found" },
        { status: 404 }
      );
    }

    // Re-ingest external links when content is missing/low-quality so thesis-first sees usable deck text.
    let refreshedAnyLinkDoc = false;
    const refreshedDocuments = await Promise.all(
      (record.documents || []).map(async (doc): Promise<DiligenceDocument> => {
        if (!doc.externalUrl || (doc.fileType !== "link" && doc.fileType !== "url")) return doc;
        const currentText = String(doc.extractedText || "").trim();
        const needsReingest =
          doc.linkIngestStatus !== "ingested" || !currentText || isLowQualityExtractedLinkContent(currentText);
        if (!needsReingest) return doc;
        try {
          const ingested = await ingestExternalLink(doc.externalUrl, doc.accessEmail);
          refreshedAnyLinkDoc = true;
          const nextStatus: DiligenceDocument["linkIngestStatus"] =
            ingested.success && ingested.extractedText ? "ingested" : (ingested.status || "failed");
          return {
            ...doc,
            linkIngestStatus: nextStatus,
            linkIngestMessage:
              ingested.success && ingested.extractedText
                ? "Content extracted successfully."
                : (ingested.error || "Failed to ingest external link content"),
            linkIngestedAt: new Date().toISOString(),
            extractedText: ingested.success && ingested.extractedText ? ingested.extractedText : undefined,
            externalUrl: ingested.resolvedUrl || doc.externalUrl,
          };
        } catch (error) {
          refreshedAnyLinkDoc = true;
          const failedStatus: DiligenceDocument["linkIngestStatus"] = "failed";
          return {
            ...doc,
            linkIngestStatus: failedStatus,
            linkIngestMessage: error instanceof Error ? error.message : "Failed to ingest external link content",
            linkIngestedAt: new Date().toISOString(),
            extractedText: undefined,
          };
        }
      })
    );
    if (refreshedAnyLinkDoc) {
      await updateDiligenceRecord(id, { documents: refreshedDocuments });
      record.documents = refreshedDocuments;
    }

    const workingRecord = await enrichForThesisFirstPass(record);
    const structuredContext = deriveProblemSolutionContext(workingRecord);
    if (structuredContext) {
      workingRecord.documents = [
        ...(workingRecord.documents || []),
        {
          id: `doc_thesis_structured_context_${Date.now()}`,
          name: "Thesis Structured Context",
          type: "other",
          fileType: "txt",
          uploadedAt: new Date().toISOString(),
          extractedText: structuredContext,
        },
      ];
    }
    try {
      const factsInput = (workingRecord.documents || [])
        .map((doc) => ({
          fileName: String(doc.name || "Document"),
          type: String(doc.type || "other"),
          text: String(doc.extractedText || ""),
        }))
        .filter((doc) => doc.text.trim().length > 0)
        .slice(0, 8);
      const structuredFacts = await extractStructuredFactsForContext(
        factsInput,
        record.companyName,
        record.companyUrl,
        (record.categorizedNotes || [])
          .map((note) => `${note.title || ""}\n${note.content || ""}`)
          .join("\n\n")
      );
      if (structuredFacts) {
        workingRecord.documents = [
          ...(workingRecord.documents || []),
          {
            id: `doc_thesis_structured_facts_${Date.now()}`,
            name: "Structured Facts (Scoring Extractor)",
            type: "other",
            fileType: "txt",
            uploadedAt: new Date().toISOString(),
            extractedText: structuredFacts.slice(0, 15000),
          },
        ];
      }
    } catch (error) {
      console.warn("thesis-first structured fact extraction failed:", error);
    }
    const thesisFit = await runThesisFitAssessment(workingRecord);
    const documentWarnings = collectDocumentReadWarnings(record.documents || []);
    const updatedRecord = await updateDiligenceRecord(id, { thesisFit });

    return NextResponse.json({
      success: true,
      thesisFit,
      record: updatedRecord,
      documentWarnings,
    });
  } catch (error) {
    console.error("Error computing thesis-first pass:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to run thesis-first pass",
      },
      { status: 500 }
    );
  }
}
