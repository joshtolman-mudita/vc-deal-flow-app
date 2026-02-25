import { NextRequest, NextResponse } from 'next/server';
import { loadDiligenceRecord, updateDiligenceRecord } from '@/lib/diligence-storage';
import { loadDiligenceCriteria, isGoogleSheetsConfigured } from '@/lib/google-sheets';
import { scoreDiligence, SCORER_VERSION } from '@/lib/diligence-scorer';
import { fetchUrlContent, isValidUrl } from '@/lib/web-fetch';
import { searchCompanyInformation, formatSearchResultsForAI, isSearchConfigured } from '@/lib/web-search';
import { listFilesRecursively, downloadFileFromDrive } from '@/lib/google-drive';
import { isFileTypeSupported, parseDocument, isUnreadableExtractedText } from '@/lib/document-parser';
import { DiligenceDocument, Founder, ThesisAnswers } from '@/types/diligence';
import { loadAppSettings } from '@/lib/app-settings';
import { buildScoringFingerprint } from '@/lib/scoring-fingerprint';
import {
  getAssociatedCompanyForDeal,
  getAssociatedContactsForCompany,
  getAssociatedContactsForDeal,
  syncDiligenceToHubSpot,
} from '@/lib/hubspot-sync';
import { runTeamResearch } from '@/lib/team-research';
import { runPortfolioSynergyResearch } from '@/lib/portfolio-synergy';
import { runProblemNecessityResearch } from '@/lib/problem-necessity';
import { listThesisFitFeedback } from '@/lib/thesis-fit-feedback-storage';
import { ingestExternalLink, isLowQualityExtractedLinkContent } from '@/lib/external-link-ingest';

function inferExtensionFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const candidate = parsed.pathname.split('/').pop() || '';
    const extension = candidate.includes('.') ? candidate.split('.').pop() || '' : '';
    return extension.toLowerCase();
  } catch {
    return '';
  }
}

function extractCandidateFileUrlFromHtml(html: string): string | undefined {
  const directHrefMatch = html.match(/href="(https?:\/\/[^"]+\.(pdf|pptx|ppt|docx|xlsx|xls|csv)[^"]*)"/i);
  if (directHrefMatch?.[1]) return directHrefMatch[1];
  const encodedUrlMatch = html.match(/https?:\\\/\\\/[^"\\]+/i);
  if (encodedUrlMatch?.[0]) {
    return encodedUrlMatch[0].replace(/\\\//g, '/');
  }
  const genericUrlMatch = html.match(/https?:\/\/[^\s"'<>]+/i);
  return genericUrlMatch?.[0];
}

function normalizeFeedbackLines(input: unknown, max = 6): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    )
  ).slice(0, max);
}

function shouldUseDocumentForScoring(doc: DiligenceDocument): boolean {
  const text = String(doc.extractedText || '').trim();
  if (!text) return false;
  if ((doc.fileType === 'link' || doc.fileType === 'url') && doc.linkIngestStatus !== 'ingested') return false;
  if ((doc.fileType === 'link' || doc.fileType === 'url') && isLowQualityExtractedLinkContent(text)) return false;
  return true;
}

function normalizeTamCandidate(input: unknown): string {
  const text = String(input || '').trim();
  if (!text) return '';
  if (/^(unknown|n\/a|na|none|null)$/i.test(text)) return '';
  if (/not\s+(specified|disclosed|available)/i.test(text)) return '';
  return text;
}

function deriveTamFromScorePayload(score: any): string {
  const companyClaimTam = normalizeTamCandidate(score?.externalMarketIntelligence?.tamSamSom?.companyClaim?.tam);
  if (companyClaimTam) return companyClaimTam;
  const independentTam = normalizeTamCandidate(score?.externalMarketIntelligence?.tamSamSom?.independentEstimate?.tam);
  if (independentTam) return independentTam;
  return '';
}

function normalizeFundingCandidate(input: unknown): string {
  const text = String(input || '').trim();
  if (!text) return '';
  if (/^(unknown|n\/a|na|none|null)$/i.test(text)) return '';
  if (/not\s+(specified|disclosed|available)/i.test(text)) return '';
  return text;
}

function normalizeComparableHost(input?: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const withProtocol = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
  try {
    const host = new URL(withProtocol).hostname.toLowerCase();
    return host.replace(/^www\./, '').trim();
  } catch {
    return '';
  }
}

function hostsLikelyMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function shouldTrustHubspotCompanyData(
  recordCompanyUrl: string | undefined,
  hubspotCompanyData: any
): boolean {
  if (!hubspotCompanyData) return false;
  const recordHost = normalizeComparableHost(recordCompanyUrl);
  if (!recordHost) return true;
  const hubspotHosts = [
    normalizeComparableHost(hubspotCompanyData.website),
    normalizeComparableHost(hubspotCompanyData.domain),
  ].filter(Boolean);
  if (hubspotHosts.length === 0) return true;
  return hubspotHosts.some((host) => hostsLikelyMatch(recordHost, host));
}

function deriveFundingAmountFromText(text: string): string {
  const normalized = String(text || '').replace(/\s+/g, ' ');
  if (!normalized) return '';
  const money = '\\$\\s*\\d[\\d,.]*(?:\\.\\d+)?\\s?(?:k|m|b|thousand|million|billion)?';
  const candidateMatches: Array<{ amount: string; context: string; index: number; score: number }> = [];
  const patterns = [
    new RegExp(`(?:round\\s+info|this\\s+raise|today)\\b[^\\n]{0,100}?(${money})\\s*raise`, 'gi'),
    new RegExp(`(?:target(?:ing)?|currently\\s+raising|we\\s+are\\s+raising|seeking\\s+to\\s+raise|funding\\s+sought|raise\\s+amount|round\\s+(?:size|amount))[^$\\n]{0,35}(${money})(?:\\s*raise)?`, 'gi'),
    new RegExp(`(${money})\\s*raise`, 'gi'),
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized)) !== null) {
      const amount = String(match[1] || '').replace(/\s+/g, ' ').trim();
      if (!amount) continue;
      const context = String(match[0] || '');
      let score = 0;
      if (/\b(round\s+info|this\s+raise|today|target(?:ing)?)\b/i.test(context)) score += 8;
      if (/\b(currently\s+raising|we\s+are\s+raising|seeking\s+to\s+raise|funding\s+sought|round\s+(?:size|amount))\b/i.test(context)) score += 5;
      if (/\b(q[1-4]\s*20\d{2}|20\d{2}\s*:|early\s+20\d{2}|launch|planned\s+evolution|future|start\s+raising)\b/i.test(context)) score -= 7;
      if (/\b(for\s+carrier|\+\s*in\s+equity)\b/i.test(context)) score -= 4;
      candidateMatches.push({ amount, context, index: match.index, score });
    }
  }
  if (candidateMatches.length === 0) return '';
  candidateMatches.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return candidateMatches[0].amount;
}

function deriveFundingAmountFromScorePayload(score: any): string {
  const scoreJson = JSON.stringify(score || {});
  return normalizeFundingCandidate(deriveFundingAmountFromText(scoreJson));
}

function collectCompanyDocumentText(
  documentTexts: Array<{ fileName?: string; text?: string; type?: string }>
): string {
  return (documentTexts || [])
    .filter((doc) => {
      const name = String(doc.fileName || '').toLowerCase();
      const type = String(doc.type || '').toLowerCase();
      if (name.includes('current web research') || name.includes('web research') || name.includes('website content')) {
        return false;
      }
      if (type && type !== 'other') return true;
      return /(deck|pitch|one.?sheet|memo|pdf|docx?|pptx?)/i.test(name);
    })
    .map((doc) => doc.text || '')
    .join('\n');
}

function deriveCompanyRaiseAmountFromDocuments(companyDocsText: string, companyName?: string): string {
  const text = String(companyDocsText || '').replace(/\s+/g, ' ');
  if (!text) return '';
  const direct = deriveFundingAmountFromText(text);
  if (direct) return direct;
  const escapedName = String(companyName || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escapedName) return '';
  const fallbackPattern = new RegExp(`${escapedName}[^.\\n]{0,80}(\\$\\s*\\d[\\d,.]*(?:\\.\\d+)?\\s?(?:k|m|b|thousand|million|billion)?)\\s*raise`, 'i');
  const fallbackMatch = text.match(fallbackPattern);
  return fallbackMatch?.[1]?.replace(/\s+/g, ' ').trim() || '';
}

function deriveFundingAmountFromDealTermsScore(score: any): string {
  const categories = Array.isArray(score?.categories) ? score.categories : [];
  const dealTermsCategory = categories.find((category: any) => /deal\s*terms/i.test(String(category?.category || category?.name || '')));
  const criteria = Array.isArray(dealTermsCategory?.criteria) ? dealTermsCategory.criteria : [];
  const scoreText = criteria
    .flatMap((criterion: any) => [
      String(criterion?.answer || ''),
      String(criterion?.reasoning || ''),
      ...(Array.isArray(criterion?.evidence) ? criterion.evidence.map((line: unknown) => String(line || '')) : []),
    ])
    .join('\n');
  return normalizeFundingCandidate(deriveFundingAmountFromText(scoreText));
}

function normalizeCommittedCandidate(input: unknown): string {
  const text = String(input || '').trim();
  if (!text) return '';
  if (/^(unknown|n\/a|na|none|null)$/i.test(text)) return '';
  if (/not\s+(specified|disclosed|available)/i.test(text)) return '';
  return text;
}

function deriveCommittedAmountFromText(text: string): string {
  const normalized = String(text || '').replace(/\s+/g, ' ');
  if (!normalized) return '';
  const money = '(\\$\\s*\\d[\\d,.]*(?:\\.\\d+)?\\s?(?:k|m|b|thousand|million|billion)?)';
  const patterns = [
    // Prefer explicit commitment phrases so we capture "$260K committed"
    // instead of the raise amount in "raising $1M with $260K committed".
    new RegExp(`(?:with|including|of)\\s*${money}[^.\\n]{0,20}(?:already\\s+)?(?:funded|committed|in\\s+commitments?)`, 'i'),
    new RegExp(`(?:committed\\s+funding|current\\s+commitments?)[:\\s-]{0,20}${money}`, 'i'),
    new RegExp(`${money}\\s*(?:already\\s+)?(?:funded|committed|in\\s+commitments?)`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const directMoney = match[1] || '';
    if (directMoney) return directMoney.replace(/\s+/g, ' ').trim();
    const moneyFromPhrase = match[0].match(/\$\s*\d[\d,.]*(?:\.\d+)?\s?(?:k|m|b|thousand|million|billion)?/i);
    if (moneyFromPhrase?.[0]) return moneyFromPhrase[0].replace(/\s+/g, ' ').trim();
  }
  return '';
}

function deriveCommittedAmountFromDealTermsScore(score: any): string {
  const categories = Array.isArray(score?.categories) ? score.categories : [];
  const dealTermsCategory = categories.find((category: any) => /deal\s*terms/i.test(String(category?.category || category?.name || '')));
  const criteria = Array.isArray(dealTermsCategory?.criteria) ? dealTermsCategory.criteria : [];
  const scoreText = criteria
    .flatMap((criterion: any) => [
      String(criterion?.answer || ''),
      String(criterion?.reasoning || ''),
      ...(Array.isArray(criterion?.evidence) ? criterion.evidence.map((line: unknown) => String(line || '')) : []),
    ])
    .join('\n');
  return normalizeCommittedCandidate(deriveCommittedAmountFromText(scoreText));
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

function mergeFoundersPreservingLinkedIn(
  existingFounders: Founder[] | undefined,
  incomingFounders: Founder[] | undefined
): Founder[] {
  const existingByName = new Map<string, Founder>();
  for (const founder of existingFounders || []) {
    const key = String(founder?.name || '').trim().toLowerCase();
    if (!key) continue;
    existingByName.set(key, founder);
  }
  return (incomingFounders || []).map((founder): Founder => {
    const safeName = String(founder?.name || '').trim();
    const key = String(founder?.name || '').trim().toLowerCase();
    const existing = key ? existingByName.get(key) : undefined;
    return {
      ...founder,
      name: safeName || String(existing?.name || '').trim(),
      linkedinUrl: String(founder?.linkedinUrl || '').trim() || String(existing?.linkedinUrl || '').trim() || undefined,
      title: String(founder?.title || '').trim() || String(existing?.title || '').trim() || undefined,
    };
  }).filter((founder) => Boolean(founder.name));
}

function normalizeDocUrl(input?: string): string {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '').toLowerCase();
}

function dedupeDocuments<T extends { googleDriveId?: string; externalUrl?: string; name?: string; fileType?: string }>(
  docs: T[]
): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const doc of docs || []) {
    const byDrive = String(doc.googleDriveId || '').trim();
    const byUrl = normalizeDocUrl(doc.externalUrl);
    const byName = `${String(doc.name || '').trim().toLowerCase()}|${String(doc.fileType || '').trim().toLowerCase()}`;
    const key = byDrive ? `gd:${byDrive}` : byUrl ? `url:${byUrl}` : `name:${byName}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(doc);
  }
  return output;
}

async function fetchPitchDeckBuffer(url: string): Promise<{ buffer: Buffer; fileName?: string; extension: string }> {
  const primaryResponse = await fetch(url, { redirect: 'follow' });
  if (!primaryResponse.ok) {
    throw new Error(`Failed to fetch pitch deck (${primaryResponse.status})`);
  }

  const contentType = primaryResponse.headers.get('content-type') || '';
  const contentDisposition = primaryResponse.headers.get('content-disposition') || '';
  const fileNameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);

  if (contentType.includes('text/html')) {
    const html = await primaryResponse.text();
    const candidateUrl = extractCandidateFileUrlFromHtml(html);
    if (!candidateUrl) {
      throw new Error('HubSpot redirect page did not expose a downloadable file URL');
    }
    const fileResponse = await fetch(candidateUrl, { redirect: 'follow' });
    if (!fileResponse.ok) {
      throw new Error(`Failed to fetch redirected pitch deck file (${fileResponse.status})`);
    }
    const arrayBuffer = await fileResponse.arrayBuffer();
    const fallbackExtension = inferExtensionFromUrl(candidateUrl) || inferExtensionFromUrl(url) || 'pdf';
    return {
      buffer: Buffer.from(arrayBuffer),
      fileName: fileNameMatch?.[1],
      extension: fallbackExtension,
    };
  }

  const arrayBuffer = await primaryResponse.arrayBuffer();
  const extension = inferExtensionFromUrl(fileNameMatch?.[1] || '') || inferExtensionFromUrl(url) || 'pdf';
  return {
    buffer: Buffer.from(arrayBuffer),
    fileName: fileNameMatch?.[1],
    extension,
  };
}

async function importHubSpotPitchDeck(url: string): Promise<DiligenceDocument | null> {
  const fallbackExtension = inferExtensionFromUrl(url) || 'pdf';
  const extension = fallbackExtension;
  if (!isFileTypeSupported(`pitch_deck.${extension}`)) return null;

  const fetched = await fetchPitchDeckBuffer(url);
  const parsedExtension = fetched.extension || fallbackExtension;
  if (!isFileTypeSupported(`pitch_deck.${parsedExtension}`)) return null;
  const suggestedName = fetched.fileName || `HubSpot Pitch Deck.${parsedExtension}`;
  const extractedText = await parseDocument(fetched.buffer, parsedExtension);
  if (!extractedText || extractedText.trim().length === 0) return null;

  return {
    id: `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    name: suggestedName,
    type: 'deck',
    fileType: parsedExtension,
    externalUrl: url,
    uploadedAt: new Date().toISOString(),
    extractedText,
    size: fetched.buffer.byteLength,
  };
}

function buildHubSpotPitchDeckLinkDocument(url: string): DiligenceDocument {
  const extension = inferExtensionFromUrl(url) || 'url';
  return {
    id: `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    name: `HubSpot Founder Pitch Deck (${extension.toUpperCase()})`,
    type: 'deck',
    fileType: extension,
    externalUrl: url,
    uploadedAt: new Date().toISOString(),
    extractedText: `Founder pitch deck link from HubSpot intake: ${url}`,
  };
}

function hasHubSpotCompanyAnalysisContent(record: Awaited<ReturnType<typeof loadDiligenceRecord>>): boolean {
  const company = record?.hubspotCompanyData;
  if (!company) return false;
  return Boolean(
    (company.description && company.description.trim()) ||
    (company.website && company.website.trim()) ||
    (company.industrySector && company.industrySector.trim()) ||
    (company.investmentSector && company.investmentSector.trim()) ||
    (company.productCategorization && company.productCategorization.trim()) ||
    (company.anythingElse && company.anythingElse.trim())
  );
}

function combineNotesForExtraction(record: Awaited<ReturnType<typeof loadDiligenceRecord>>): string | undefined {
  const sections: string[] = [];
  if (record?.notes?.trim()) {
    sections.push(record.notes.trim());
  }
  const categorized = (record?.categorizedNotes || [])
    .filter((note) => (note.content || '').trim().length > 0)
    .map((note) => `(${note.category || 'Overall'}) ${note.title || 'Note'}: ${note.content}`);
  if (categorized.length > 0) {
    sections.push(categorized.join('\n'));
  }
  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

function deriveHomepageUrl(inputUrl?: string): string | null {
  if (!inputUrl) return null;
  try {
    const parsed = new URL(inputUrl.startsWith('http') ? inputUrl : `https://${inputUrl}`);
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return null;
  }
}

/**
 * POST /api/diligence/score - Score a diligence record using AI
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { diligenceId, companyDescription } = body;

    if (!diligenceId) {
      return NextResponse.json(
        { error: 'Diligence ID is required', success: false },
        { status: 400 }
      );
    }

    // Load the diligence record
    const record = await loadDiligenceRecord(diligenceId);
    if (!record) {
      return NextResponse.json(
        { error: 'Diligence record not found', success: false },
        { status: 404 }
      );
    }
    const incomingDocuments = record.documents || [];
    const dedupedDocuments = dedupeDocuments(incomingDocuments);
    if (dedupedDocuments.length !== (record.documents || []).length) {
      record.documents = dedupedDocuments;
      await updateDiligenceRecord(diligenceId, { documents: dedupedDocuments });
    }

    // Re-ingest external links when content is missing/low-quality so scoring can use real deck text.
    let refreshedAnyLinkDoc = false;
    const refreshedDocuments = await Promise.all(
      (record.documents || []).map(async (doc): Promise<DiligenceDocument> => {
        if (!doc.externalUrl || (doc.fileType !== 'link' && doc.fileType !== 'url')) return doc;
        const currentText = String(doc.extractedText || '').trim();
        const needsReingest =
          doc.linkIngestStatus !== 'ingested' || !currentText || isLowQualityExtractedLinkContent(currentText);
        if (!needsReingest) return doc;
        try {
          const ingested = await ingestExternalLink(doc.externalUrl, doc.accessEmail);
          refreshedAnyLinkDoc = true;
          const nextStatus: DiligenceDocument['linkIngestStatus'] =
            ingested.success && ingested.extractedText ? 'ingested' : (ingested.status || 'failed');
          return {
            ...doc,
            linkIngestStatus: nextStatus,
            linkIngestMessage:
              ingested.success && ingested.extractedText
                ? 'Content extracted successfully.'
                : (ingested.error || 'Failed to ingest external link content'),
            linkIngestedAt: new Date().toISOString(),
            extractedText: ingested.success && ingested.extractedText ? ingested.extractedText : undefined,
            externalUrl: ingested.resolvedUrl || doc.externalUrl,
          };
        } catch (error) {
          refreshedAnyLinkDoc = true;
          const failedStatus: DiligenceDocument['linkIngestStatus'] = 'failed';
          return {
            ...doc,
            linkIngestStatus: failedStatus,
            linkIngestMessage: error instanceof Error ? error.message : 'Failed to ingest external link content',
            linkIngestedAt: new Date().toISOString(),
            extractedText: undefined,
          };
        }
      })
    );
    if (refreshedAnyLinkDoc) {
      record.documents = refreshedDocuments;
      await updateDiligenceRecord(diligenceId, { documents: refreshedDocuments });
    }

    if (record.hubspotDealId) {
      try {
        const company = await getAssociatedCompanyForDeal(record.hubspotDealId);
        if (company) {
          record.hubspotCompanyId = company.companyId;
          record.hubspotCompanyName = company.name;
          record.hubspotCompanyData = company;
          await updateDiligenceRecord(diligenceId, {
            hubspotCompanyId: company.companyId,
            hubspotCompanyName: company.name,
            hubspotCompanyData: company,
          });
        }
      } catch (error) {
        console.warn('Failed to refresh associated HubSpot company before scoring:', error);
      }
    }
    const effectiveHubspotCompanyData = (() => {
      const fallbackIndustry = String(record.industry || '').trim();
      if (record.hubspotCompanyData) {
        const merged = { ...record.hubspotCompanyData };
        if (!String(merged.industry || '').trim() && fallbackIndustry) {
          merged.industry = fallbackIndustry;
        }
        if (!String(merged.industrySector || '').trim() && fallbackIndustry) {
          merged.industrySector = fallbackIndustry;
        }
        return merged;
      }
      if (!fallbackIndustry) return undefined;
      return {
        companyId: record.hubspotCompanyId || '',
        name: record.hubspotCompanyName || record.companyName,
        industry: fallbackIndustry,
        industrySector: fallbackIndustry,
      };
    })();
    const trustedHubspotCompanyData = shouldTrustHubspotCompanyData(record.companyUrl, effectiveHubspotCompanyData)
      ? effectiveHubspotCompanyData
      : undefined;

    // Always run enrichment research modules before scoring so section quality stays high.
    // These are best-effort: if one fails, scoring continues with available signals.
    try {
      const hubspotContacts = record.hubspotCompanyId
        ? await getAssociatedContactsForCompany(record.hubspotCompanyId)
        : record.hubspotDealId
        ? await getAssociatedContactsForDeal(record.hubspotDealId)
        : [];
      const teamDocumentContext = (record.documents || [])
        .filter((doc) => shouldUseDocumentForScoring(doc))
        .map((doc) => String(doc.extractedText || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 3)
        .join('\n\n')
        .slice(0, 16000);
      const teamResearch = await runTeamResearch({
        companyName: record.companyName,
        companyUrl: record.companyUrl,
        companyDescription: record.companyDescription,
        existingFounders: record.founders,
        hubspotCompanyData: trustedHubspotCompanyData,
        hubspotContacts,
        documentContext: teamDocumentContext,
      });
      record.teamResearch = teamResearch;
      const mergedFounders =
        teamResearch.founders.length > 0
          ? mergeFoundersPreservingLinkedIn(record.founders, teamResearch.founders)
          : record.founders;
      if (teamResearch.founders.length > 0) {
        record.founders = mergedFounders as any;
      }
      await updateDiligenceRecord(diligenceId, {
        teamResearch,
        founders: mergedFounders,
      });
    } catch (error) {
      console.warn('Pre-score team research failed, continuing scoring:', error);
    }

    try {
      const portfolioSynergyResearch = await runPortfolioSynergyResearch({
        companyName: record.companyName,
        companyUrl: record.companyUrl,
        companyDescription: record.companyDescription,
        companyOneLiner: record.companyOneLiner,
        industry: record.industry,
      });
      record.portfolioSynergyResearch = portfolioSynergyResearch;
      await updateDiligenceRecord(diligenceId, {
        portfolioSynergyResearch,
      });
    } catch (error) {
      console.warn('Pre-score portfolio synergy research failed, continuing scoring:', error);
    }

    try {
      const problemNecessityResearch = await runProblemNecessityResearch({
        companyName: record.companyName,
        companyUrl: record.companyUrl,
        companyDescription: record.companyDescription,
        companyOneLiner: record.companyOneLiner,
        industry: record.industry,
      });
      record.problemNecessityResearch = problemNecessityResearch;
      await updateDiligenceRecord(diligenceId, {
        problemNecessityResearch,
      });
    } catch (error) {
      console.warn('Pre-score problem necessity research failed, continuing scoring:', error);
    }

    // Validate we have enough analyzable context.
    // A linked HubSpot company profile is sufficient even without uploaded docs/URL.
    const hasHubSpotContext = hasHubSpotCompanyAnalysisContent(record);
    if (
      record.documents.length === 0 &&
      !companyDescription &&
      !record.companyDescription &&
      !record.companyUrl &&
      !hasHubSpotContext
    ) {
      return NextResponse.json(
        { error: 'No analyzable content found. Provide docs, company URL/description, or link a HubSpot deal with company data.', success: false },
        { status: 400 }
      );
    }

    // Check if Google Sheets is configured
    if (!isGoogleSheetsConfigured()) {
      return NextResponse.json(
        { 
          error: 'Google Sheets not configured. Please set up DILIGENCE_CRITERIA_SHEET_ID in .env.local',
          success: false 
        },
        { status: 503 }
      );
    }


    // Check Google Drive folder for any existing files not yet in the record
    if (record.googleDriveFolderId) {
      try {
        const driveFiles = await listFilesRecursively(record.googleDriveFolderId);
        
        // Filter processable files
        const processableFiles = driveFiles.filter(file => 
          !file.mimeType.startsWith('application/vnd.google-apps.') ||
          file.mimeType === 'application/vnd.google-apps.document' ||
          file.mimeType === 'application/vnd.google-apps.spreadsheet'
        );

        // Get existing document IDs and names so repeated uploads with new Drive IDs
        // do not keep duplicating the record.
        const existingFileIds = new Set(record.documents.map(doc => doc.googleDriveId).filter(Boolean));
        const existingFileNames = new Set(
          record.documents.map((doc) => String(doc.name || '').trim().toLowerCase()).filter(Boolean)
        );
        
        // Find new files by both id and normalized name.
        const newFiles = processableFiles.filter((file) => {
          const normalizedName = String(file.name || '').trim().toLowerCase();
          return !existingFileIds.has(file.id) && !existingFileNames.has(normalizedName);
        });
        
        if (newFiles.length > 0) {
          const newDocuments: DiligenceDocument[] = [];

          for (const driveFile of newFiles) {
            try {
              const fileBuffer = await downloadFileFromDrive(driveFile.id, driveFile.mimeType);
              const fileExtension = driveFile.name.split('.').pop() || '';
              const parsedText = await parseDocument(fileBuffer, fileExtension);

              if (parsedText && parsedText.trim().length > 0) {
                const fileExtension = driveFile.name.split('.').pop() || '';
                newDocuments.push({
                  id: `doc_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                  name: driveFile.name,
                  type: 'other',
                  fileType: fileExtension,
                  googleDriveId: driveFile.id,
                  googleDriveUrl: driveFile.webViewLink,
                  extractedText: parsedText,
                  uploadedAt: new Date().toISOString(),
                });
                existingFileIds.add(driveFile.id);
                existingFileNames.add(String(driveFile.name || '').trim().toLowerCase());
              }
            } catch (error) {
              console.error(`Error processing ${driveFile.name}:`, error);
            }
          }

          if (newDocuments.length > 0) {
            record.documents = [...record.documents, ...newDocuments];
            await updateDiligenceRecord(diligenceId, { documents: record.documents });
          }
        }
      } catch (error) {
        console.error('Error scanning Google Drive folder:', error);
        // Continue with scoring even if folder scan fails
      }
    }

    // Load diligence criteria from Google Sheets
    const criteria = await loadDiligenceCriteria();

    // Prepare document texts for scoring
    const documentTexts = record.documents
      .filter((doc) => shouldUseDocumentForScoring(doc))
      .map(doc => ({
        fileName: doc.name,
        text: doc.extractedText || '',
        type: doc.type,
      }));

    if (trustedHubspotCompanyData?.pitchDeckUrl) {
      const pitchDeckUrl = trustedHubspotCompanyData.pitchDeckUrl;
      const alreadyLinked = record.documents.some(doc => doc.externalUrl === pitchDeckUrl);
      if (!alreadyLinked) {
        try {
          const pitchDeckDocument = await importHubSpotPitchDeck(pitchDeckUrl);
          if (pitchDeckDocument) {
            record.documents.push(pitchDeckDocument);
            await updateDiligenceRecord(diligenceId, { documents: record.documents });
            documentTexts.push({
              fileName: pitchDeckDocument.name,
              text: pitchDeckDocument.extractedText || '',
              type: pitchDeckDocument.type,
            });
          } else {
            const linkDoc = buildHubSpotPitchDeckLinkDocument(pitchDeckUrl);
            record.documents.push(linkDoc);
            await updateDiligenceRecord(diligenceId, { documents: record.documents });
            documentTexts.push({
              fileName: linkDoc.name,
              text: linkDoc.extractedText || '',
              type: linkDoc.type,
            });
          }
        } catch (error) {
          console.warn('Unable to auto-import HubSpot pitch deck URL for scoring:', error);
          const linkDoc = buildHubSpotPitchDeckLinkDocument(pitchDeckUrl);
          record.documents.push(linkDoc);
          await updateDiligenceRecord(diligenceId, { documents: record.documents });
          documentTexts.push({
            fileName: linkDoc.name,
            text: linkDoc.extractedText || '',
            type: linkDoc.type,
          });
        }
      }
    }

    // Add company description as a document if provided
    const description = companyDescription || record.companyDescription;
    if (description) {
      documentTexts.push({
        fileName: 'Company Description',
        text: description,
        type: 'other',
      });
    }

    if (trustedHubspotCompanyData) {
      const company = trustedHubspotCompanyData;
      const hubspotSummary = [
        `HubSpot Company Name: ${company.name || record.companyName}`,
        company.website ? `Website: ${company.website}` : '',
        company.description ? `Description: ${company.description}` : '',
        company.industrySector ? `Industry/Sector: ${company.industrySector}` : '',
        company.investmentSector ? `Investment Sector: ${company.investmentSector}` : '',
        company.productCategorization ? `Product Categorization: ${company.productCategorization}` : '',
        company.fundingStage ? `Funding Stage: ${company.fundingStage}` : '',
        company.anythingElse ? `Founder Notes (Anything Else): ${company.anythingElse}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      if (hubspotSummary.trim()) {
        documentTexts.push({
          fileName: 'HubSpot Company Intake',
          text: hubspotSummary,
          type: 'other',
        });
      }
    }
    const structuredContextLines = [
      `Industry: ${record.industry || trustedHubspotCompanyData?.industry || trustedHubspotCompanyData?.industrySector || 'Not specified'}`,
      `Funding Amount: ${record.metrics?.fundingAmount?.value || trustedHubspotCompanyData?.fundingAmount || 'Not specified'}`,
      `Current Commitments: ${record.metrics?.committed?.value || trustedHubspotCompanyData?.currentCommitments || 'Not specified'}`,
      `Valuation: ${record.metrics?.valuation?.value || trustedHubspotCompanyData?.fundingValuation || 'Not specified'}`,
      `Current Runway: ${record.metrics?.currentRunway?.value || trustedHubspotCompanyData?.currentRunway || 'Not specified'}`,
      `Post-Funding Runway: ${record.metrics?.postFundingRunway?.value || trustedHubspotCompanyData?.postFundingRunway || 'Not specified'}`,
      `Revenue/ARR: ${record.metrics?.arr?.value || trustedHubspotCompanyData?.annualRevenue || 'Not specified'}`,
      `Traction Notes: ${record.companyDescription || 'Not specified'}`,
      `Team Summary: ${record.teamResearch?.summary || 'Not specified'}`,
      `Founders: ${(record.teamResearch?.founders || record.founders || []).map((f) => f.name).filter(Boolean).join(', ') || 'Not specified'}`,
    ];
    documentTexts.push({
      fileName: 'Structured Diligence Context',
      text: structuredContextLines.join('\n'),
      type: 'other',
    });

    if (record.teamResearch?.summary) {
      const founderLines = (record.teamResearch.founders || [])
        .map((f) => {
          const roleSignals = [
            f.hasBeenCEO ? 'prior CEO' : '',
            f.hasBeenCTO ? 'prior CTO' : '',
            f.hasPriorExit ? 'prior exit' : '',
          ]
            .filter(Boolean)
            .join(', ');
          const exits = (f.priorExits || []).join('; ');
          return `${f.name}${f.title ? ` (${f.title})` : ''}${roleSignals ? ` | ${roleSignals}` : ''}${
            exits ? ` | exits: ${exits}` : ''
          }${f.experienceSummary ? ` | notes: ${f.experienceSummary}` : ''}`;
        })
        .join('\n');
      documentTexts.push({
        fileName: 'Founder Team Research',
        text: `Team score: ${record.teamResearch.teamScore ?? 'unknown'}/100\n${record.teamResearch.summary}\n\n${
          founderLines || 'No founders identified'
        }`,
        type: 'other',
      });
    }

    if (record.portfolioSynergyResearch?.summary) {
      const matchLines = (record.portfolioSynergyResearch.matches || [])
        .map(
          (match) =>
            `${match.companyName} | ${match.synergyType} | ${match.rationale}`
        )
        .join('\n');
      documentTexts.push({
        fileName: 'Mudita Portfolio Synergy Research',
        text: `Synergy score: ${record.portfolioSynergyResearch.synergyScore ?? 'unknown'}/100\n${
          record.portfolioSynergyResearch.summary
        }\n\n${matchLines || 'No specific matches identified.'}`,
        type: 'other',
      });
    }

    if (record.problemNecessityResearch?.summary) {
      const topSignals = (record.problemNecessityResearch.topSignals || [])
        .map((signal) => `${signal.label} (${signal.strength || 'n/a'}): ${signal.evidence}`)
        .join('\n');
      const counterSignals = (record.problemNecessityResearch.counterSignals || [])
        .map((signal) => `${signal.label} (${signal.strength || 'n/a'}): ${signal.evidence}`)
        .join('\n');
      documentTexts.push({
        fileName: 'Problem Necessity Research',
        text: `Necessity score: ${record.problemNecessityResearch.necessityScore ?? 'unknown'}/100\nClassification: ${
          record.problemNecessityResearch.classification || 'unknown'
        }\n${record.problemNecessityResearch.summary}\n\nTop signals:\n${topSignals || 'None'}\n\nCounter-signals:\n${
          counterSignals || 'None'
        }`,
        type: 'other',
      });
    }

    // Fetch web content if URL is provided
    let websiteContent: string | undefined;
    if (record.companyUrl && isValidUrl(record.companyUrl)) {
      const fetchResult = await fetchUrlContent(record.companyUrl);
      
      if (fetchResult.success && fetchResult.content) {
        websiteContent = fetchResult.content;
        documentTexts.push({
          fileName: `Website Content: ${fetchResult.title || record.companyUrl}`,
          text: fetchResult.content,
          type: 'other',
        });
      } else {
        console.warn(`Failed to fetch website: ${fetchResult.error}`);
      }

      // If URL is a deep page (e.g. /pricing), also pull homepage to improve
      // market/TAM context quality in early-stage diligence.
      const homepageUrl = deriveHomepageUrl(record.companyUrl);
      const normalizedCurrent = record.companyUrl.replace(/\/+$/, '');
      const normalizedHomepage = (homepageUrl || '').replace(/\/+$/, '');
      if (homepageUrl && normalizedHomepage && normalizedHomepage !== normalizedCurrent) {
        const homeFetch = await fetchUrlContent(homepageUrl);
        if (homeFetch.success && homeFetch.content) {
          documentTexts.push({
            fileName: `Homepage Content: ${homeFetch.title || homepageUrl}`,
            text: homeFetch.content,
            type: 'other',
          });
          websiteContent = `${websiteContent || ''}\n\n${homeFetch.content}`.trim();
        } else {
          console.warn(`Failed to fetch homepage content: ${homeFetch.error}`);
        }
      }
    }

    // Perform web searches for additional context
    if (isSearchConfigured()) {
      const searchContent = await searchCompanyInformation(record.companyName, record.companyUrl);
      
      // Format and add search results as a document
      const formattedSearchResults = formatSearchResultsForAI(
        record.companyName,
        searchContent,
        websiteContent
      );
      
      documentTexts.push({
        fileName: 'Current Web Research & News',
        text: formattedSearchResults,
        type: 'other',
      });
      
    }

    // Fallback: If we still have no documents, create a minimal prompt
    if (documentTexts.length === 0) {
      if (record.companyUrl) {
        documentTexts.push({
          fileName: 'Company Information',
          text: `⚠️ LIMITED INFORMATION AVAILABLE

Company Name: ${record.companyName}
Website: ${record.companyUrl}

Note: Unable to fetch website content or perform web searches. Analysis will be based on the company name and URL only.`,
          type: 'other',
        });
      } else {
        return NextResponse.json(
          { error: 'No content available to analyze', success: false },
          { status: 400 }
        );
      }
    }

    // Check if thesis answers are manually edited (preserve them if they exist)
    const existingThesisAnswers = record.score?.thesisAnswers?.manuallyEdited 
      ? record.score.thesisAnswers 
      : undefined;
    const metricsForScoring = { ...(record.metrics || {}) };
    const notesTextForMetricGuard = (record.categorizedNotes || [])
      .map((note) => `${note.title || ''}\n${note.content || ''}`)
      .join('\n')
      .toLowerCase();
    const normalizeMoney = (raw?: string) =>
      (raw || '').toLowerCase().replace(/[$,\s]/g, '');
    const cashOnHandMatch = notesTextForMetricGuard.match(/cash\s+on\s+hand[^0-9]{0,20}(\$?\d[\d,.]*(?:\.\d+)?\s?[kmb]?)/i);
    const hasExplicitRaiseSignal = /(raise\s+amount|raising\s+\$|funding\s+amount|funding\s+sought|seeking\s+to\s+raise|round\s+(size|amount))/i.test(
      notesTextForMetricGuard
    );
    if (
      metricsForScoring.fundingAmount?.value &&
      cashOnHandMatch?.[1] &&
      normalizeMoney(metricsForScoring.fundingAmount.value) === normalizeMoney(cashOnHandMatch[1]) &&
      !hasExplicitRaiseSignal
    ) {
      delete metricsForScoring.fundingAmount;
    }
    if (!metricsForScoring.arr?.value && trustedHubspotCompanyData?.annualRevenue) {
      metricsForScoring.arr = {
        value: trustedHubspotCompanyData.annualRevenue,
        source: 'manual',
        updatedAt: new Date().toISOString(),
      };
    }
    if (!metricsForScoring.tam?.value && trustedHubspotCompanyData?.tamRange) {
      metricsForScoring.tam = {
        value: trustedHubspotCompanyData.tamRange,
        source: 'manual',
        updatedAt: new Date().toISOString(),
      };
    }

    const notesForExtraction = combineNotesForExtraction(record);

    // Run AI scoring
    const appSettings = await loadAppSettings();
    const result = await scoreDiligence(
      documentTexts, 
      criteria, 
      record.companyName, 
      record.companyUrl, 
      notesForExtraction,
      record.categorizedNotes || [],
      record.questions || [],
      trustedHubspotCompanyData,
      record.teamResearch,
      record.portfolioSynergyResearch,
      record.problemNecessityResearch,
      metricsForScoring,
      undefined, // No previous score for initial scoring
      existingThesisAnswers, // Pass manually edited thesis as context if it exists
      {
        summarizeTranscriptNotesForScoring: Boolean(appSettings.summarizeTranscriptNotesForScoring),
      }
    );
    const existingTam = String(result.metrics?.tam?.value || '').trim();
    if (!existingTam) {
      const fallbackTam = deriveTamFromScorePayload(result.score);
      if (fallbackTam) {
        result.metrics = {
          ...(result.metrics || {}),
          tam: {
            ...(result.metrics?.tam || {}),
            value: fallbackTam,
            source: result.metrics?.tam?.source || 'auto',
            sourceDetail: result.metrics?.tam?.sourceDetail || 'market_research',
            updatedAt: new Date().toISOString(),
          },
        };
      }
    }
    const companyDocsText = collectCompanyDocumentText(documentTexts);
    const explicitCompanyRaiseFromDocs = normalizeFundingCandidate(
      deriveCompanyRaiseAmountFromDocuments(companyDocsText, record.companyName)
    );
    const explicitCompanyRaiseFromDealTerms = deriveFundingAmountFromDealTermsScore(result.score);
    const explicitCompanyRaise = explicitCompanyRaiseFromDocs || explicitCompanyRaiseFromDealTerms;
    const existingFundingAmount = String(result.metrics?.fundingAmount?.value || '').trim();
    if (explicitCompanyRaise) {
      const source = result.metrics?.fundingAmount?.source || 'auto';
      if (!existingFundingAmount || source !== 'manual' || existingFundingAmount !== explicitCompanyRaise) {
        result.metrics = {
          ...(result.metrics || {}),
          fundingAmount: {
            ...(result.metrics?.fundingAmount || {}),
            value: explicitCompanyRaise,
            source,
            sourceDetail: result.metrics?.fundingAmount?.sourceDetail || 'facts',
            updatedAt: new Date().toISOString(),
          },
        };
      }
    } else if (!existingFundingAmount) {
      const docsFallbackFunding = deriveFundingAmountFromText(companyDocsText);
      const fallbackFunding = normalizeFundingCandidate(docsFallbackFunding);
      if (fallbackFunding) {
        result.metrics = {
          ...(result.metrics || {}),
          fundingAmount: {
            ...(result.metrics?.fundingAmount || {}),
            value: fallbackFunding,
            source: result.metrics?.fundingAmount?.source || 'auto',
            sourceDetail: result.metrics?.fundingAmount?.sourceDetail || 'facts',
            updatedAt: new Date().toISOString(),
          },
        };
      }
    }
    const explicitCommittedFromDocs = normalizeCommittedCandidate(deriveCommittedAmountFromText(companyDocsText));
    const explicitCommittedFromDealTerms = deriveCommittedAmountFromDealTermsScore(result.score);
    const explicitCommitted = explicitCommittedFromDocs || explicitCommittedFromDealTerms;
    const existingCommittedAmount = String(result.metrics?.committed?.value || '').trim();
    if (explicitCommitted) {
      const source = result.metrics?.committed?.source || 'auto';
      if (!existingCommittedAmount || source !== 'manual' || existingCommittedAmount !== explicitCommitted) {
        result.metrics = {
          ...(result.metrics || {}),
          committed: {
            ...(result.metrics?.committed || {}),
            value: explicitCommitted,
            source,
            sourceDetail: result.metrics?.committed?.sourceDetail || 'facts',
            updatedAt: new Date().toISOString(),
          },
        };
      }
    }
    const latestThesisFeedback = (await listThesisFitFeedback({ diligenceId, limit: 50 }))
      .filter(
        (entry) =>
          String(entry.companyName || '').trim().toLowerCase() ===
          String(record.companyName || '').trim().toLowerCase()
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    if (latestThesisFeedback) {
      const userWhyMightFit = normalizeFeedbackLines(latestThesisFeedback.reviewerWhyFits, 5);
      const userConcerns = normalizeFeedbackLines(latestThesisFeedback.reviewerWhyNotFit, 5);
      const userEvidenceGaps = normalizeFeedbackLines(latestThesisFeedback.reviewerEvidenceGaps, 4);
      const userCruxQuestion = String(latestThesisFeedback.reviewerCruxQuestion || '').trim();
      const existingThesis = result.score.thesisAnswers as ThesisAnswers | undefined;
      const existingFounderQuestions = Array.isArray(existingThesis?.founderQuestions?.questions)
        ? existingThesis.founderQuestions.questions
        : [];
      const mergedQuestions = Array.from(
        new Set(
          [
            ...existingFounderQuestions,
            ...userEvidenceGaps,
          ]
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        )
      ).slice(0, 5);
      result.score.thesisAnswers = {
        problemSolving: existingThesis?.problemSolving || '',
        solution: existingThesis?.solution || '',
        whyMightFit:
          userWhyMightFit.length > 0
            ? userWhyMightFit
            : (Array.isArray(existingThesis?.whyMightFit) ? existingThesis.whyMightFit : normalizeFeedbackLines(record?.thesisFit?.whyFits, 5)),
        exciting: Array.isArray(existingThesis?.exciting) ? existingThesis.exciting : [],
        idealCustomer: existingThesis?.idealCustomer || '',
        concerning:
          userConcerns.length > 0
            ? userConcerns
            : (Array.isArray(existingThesis?.concerning) ? existingThesis.concerning : []),
        founderQuestions: {
          ...(existingThesis?.founderQuestions || {}),
          questions: mergedQuestions.length > 0 ? mergedQuestions : existingFounderQuestions,
          keyGaps: existingThesis?.founderQuestions?.keyGaps || '',
          primaryConcern:
            userCruxQuestion ||
            userConcerns[0] ||
            existingThesis?.founderQuestions?.primaryConcern ||
            '',
        },
        manuallyEdited: existingThesis?.manuallyEdited,
      };
    }
    const normalizedThesisAnswers = result.score.thesisAnswers as ThesisAnswers | undefined;
    if (normalizedThesisAnswers) {
      const whyMightFit = normalizeFeedbackLines(
        Array.isArray(normalizedThesisAnswers.whyMightFit) && normalizedThesisAnswers.whyMightFit.length > 0
          ? normalizedThesisAnswers.whyMightFit
          : record?.thesisFit?.whyFits,
        5
      );
      result.score.thesisAnswers = {
        ...normalizedThesisAnswers,
        ...(whyMightFit.length > 0 ? { whyMightFit } : {}),
      };
    }
    const scoringInputFingerprint = buildScoringFingerprint({
      companyName: record.companyName,
      companyUrl: record.companyUrl,
      companyDescription: record.companyDescription || companyDescription,
      notes: notesForExtraction,
      categorizedNotes: record.categorizedNotes || [],
      metrics: result.metrics,
      documents: record.documents,
      criteria,
      scorerVersion: SCORER_VERSION,
      summarizeTranscriptNotesForScoring: Boolean(appSettings.summarizeTranscriptNotesForScoring),
    });
    result.score.scoringInputFingerprint = scoringInputFingerprint;
    result.score.scoringMode = 'full';
    
    // If thesis was manually edited, preserve it
    if (existingThesisAnswers) {
      result.score.thesisAnswers = existingThesisAnswers;
    }

    // Update the record with the score and company metadata
    const updateData: any = { score: result.score, metrics: result.metrics };
    if (result.companyMetadata.companyOneLiner) {
      updateData.companyOneLiner = result.companyMetadata.companyOneLiner;
    }
    const lockedIndustry = String(
      record.industry ||
        trustedHubspotCompanyData?.industry ||
        trustedHubspotCompanyData?.industrySector ||
        ''
    ).trim();
    if (lockedIndustry) {
      updateData.industry = lockedIndustry;
    } else if (result.companyMetadata.industry) {
      updateData.industry = result.companyMetadata.industry;
    }
    if (result.companyMetadata.founders && result.companyMetadata.founders.length > 0) {
      updateData.founders = result.companyMetadata.founders;
    }
    
    let updatedRecord = await updateDiligenceRecord(diligenceId, updateData);

    if (updatedRecord.hubspotDealId && updatedRecord.score) {
      try {
        const syncResult = await syncDiligenceToHubSpot(updatedRecord, diligenceId);
        updatedRecord = await updateDiligenceRecord(diligenceId, {
          hubspotDealId: syncResult.dealId,
          hubspotSyncedAt: new Date().toISOString(),
          hubspotDealStageId: syncResult.hubspotData.stageId,
          hubspotDealStageLabel: syncResult.hubspotData.stageLabel,
          hubspotPipelineId: syncResult.hubspotData.pipelineId,
          hubspotPipelineLabel: syncResult.hubspotData.pipelineLabel,
          hubspotAmount: syncResult.hubspotData.amount,
        });
      } catch (syncError) {
        console.warn('Auto-sync to HubSpot after score failed:', syncError);
      }
    }

    const documentWarnings = collectDocumentReadWarnings(updatedRecord.documents || []);
    return NextResponse.json({
      score: result.score,
      record: updatedRecord,
      documentWarnings,
      success: true,
    });

  } catch (error) {
    console.error('Error scoring diligence:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to score diligence',
        success: false 
      },
      { status: 500 }
    );
  }
}
