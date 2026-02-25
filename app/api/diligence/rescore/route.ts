import { NextRequest, NextResponse } from 'next/server';
import { loadDiligenceRecord, updateDiligenceRecord } from '@/lib/diligence-storage';
import { scoreDiligence, SCORER_VERSION } from '@/lib/diligence-scorer';
import { loadDiligenceCriteria } from '@/lib/google-sheets';
import { downloadFileFromDrive, listFilesRecursively } from '@/lib/google-drive';
import { isFileTypeSupported, parseDocument, isUnreadableExtractedText } from '@/lib/document-parser';
import { DiligenceDocument } from '@/types/diligence';
import { fetchUrlContent, isValidUrl } from '@/lib/web-fetch';
import { searchCompanyInformation, formatSearchResultsForAI, isSearchConfigured } from '@/lib/web-search';
import { DiligenceScore, Founder, ThesisAnswers } from '@/types/diligence';
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

function shouldUseDocumentForScoring(doc: DiligenceDocument): boolean {
  const text = String(doc.extractedText || '').trim();
  if (!text) return false;
  if ((doc.fileType === 'link' || doc.fileType === 'url') && doc.linkIngestStatus !== 'ingested') return false;
  if ((doc.fileType === 'link' || doc.fileType === 'url') && isLowQualityExtractedLinkContent(text)) return false;
  return true;
}

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

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function effectiveCategoryScore(category: any): number {
  return category?.manualOverride ?? category?.score ?? 0;
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

function buildRescoreNarrative(
  previous: DiligenceScore | null | undefined,
  current: DiligenceScore,
  aiOnlyScore: number,
  newDocumentsCount: number
): string {
  const lines: string[] = [];
  const previousOverall = previous?.overall ?? 0;
  const finalOverall = current.overall;

  lines.push('## Score Snapshot');
  lines.push(`- Previous overall: ${previousOverall}/100`);
  lines.push(`- New AI-only score: ${aiOnlyScore}/100`);
  lines.push(`- Final score (after preserved overrides): ${finalOverall}/100`);
  lines.push(`- Data quality: ${current.dataQuality}/100`);
  if (newDocumentsCount > 0) {
    lines.push(`- New documents included in this re-score: ${newDocumentsCount}`);
  }

  const prevCategoryMap = new Map((previous?.categories || []).map((cat: any) => [cat.category, effectiveCategoryScore(cat)]));
  const categoryDeltas = current.categories
    .map(cat => {
      const prev = prevCategoryMap.get(cat.category) ?? 0;
      const next = effectiveCategoryScore(cat);
      return { category: cat.category, prev, next, delta: Math.round(next - prev) };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);

  lines.push('\n## Biggest Category Changes');
  if (categoryDeltas.length === 0) {
    lines.push('- No category deltas available.');
  } else {
    for (const change of categoryDeltas) {
      const direction = change.delta >= 0 ? '+' : '';
      lines.push(`- ${change.category}: ${change.prev} -> ${change.next} (${direction}${change.delta})`);
    }
  }

  const weakCriteria = current.categories
    .flatMap(cat =>
      cat.criteria.map(criterion => ({
        category: cat.category,
        categoryWeight: cat.weight,
        name: criterion.name,
        score: criterion.score,
        confidence: criterion.confidence ?? 55,
        evidenceStatus: criterion.evidenceStatus || 'unknown',
        evidence: (criterion.evidence || []).find(e => e && e !== 'No direct evidence cited.') || '',
        followUpQuestions: criterion.followUpQuestions || [],
        missingData: criterion.missingData || [],
        materiality:
          ((100 - criterion.score) * (cat.weight / 100)) +
          ((criterion.evidenceStatus === 'unknown' || criterion.evidenceStatus === 'contradicted') ? 12 : 0) +
          (Math.max(0, 70 - (criterion.confidence ?? 55)) / 5),
      }))
    )
    .sort((a, b) => b.materiality - a.materiality)
    .slice(0, 3);

  lines.push('\n## Most Material Risks (Top 3)');
  if (weakCriteria.length === 0) {
    lines.push('- No material risk criteria identified.');
  } else {
    for (const criterion of weakCriteria) {
      lines.push(
        `- ${criterion.category} / ${criterion.name}: ${criterion.score}/100 (confidence ${criterion.confidence}/100, status ${criterion.evidenceStatus})`
      );
      if (criterion.evidence) {
        lines.push(`  Evidence: ${criterion.evidence}`);
      } else if (criterion.missingData.length > 0) {
        lines.push(`  Missing evidence: ${criterion.missingData[0]}`);
      }
    }
  }

  const followUps = Array.from(
    new Set([
      ...(current.followUpQuestions || []),
      ...weakCriteria.flatMap(c => c.followUpQuestions),
      ...((current.thesisAnswers?.founderQuestions?.questions) || []),
    ].filter(Boolean))
  ).slice(0, 3);

  lines.push('\n## Priority Founder Follow-ups (Top 3)');
  if (followUps.length === 0) {
    lines.push('- No follow-up questions generated.');
  } else {
    followUps.forEach((question, idx) => lines.push(`${idx + 1}. ${question}`));
  }

  return lines.join('\n');
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

/**
 * POST /api/diligence/rescore - Re-download, re-parse, and re-score a diligence record
 */
export async function POST(request: NextRequest) {
  try {
    const { diligenceId, forceFull, categoryName } = await request.json();
    const runFullRescore = Boolean(forceFull);

    if (!diligenceId) {
      return NextResponse.json(
        { error: 'Missing diligenceId', success: false },
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
        console.warn('Failed to refresh associated HubSpot company before re-scoring:', error);
      }
    }
    const trustedHubspotCompanyData = shouldTrustHubspotCompanyData(record.companyUrl, record.hubspotCompanyData)
      ? record.hubspotCompanyData
      : undefined;

    // Always run enrichment research modules before re-scoring so sections are up to date.
    // Best-effort: module failures should not block re-score.
    try {
      const hubspotContacts = record.hubspotCompanyId
        ? await getAssociatedContactsForCompany(record.hubspotCompanyId)
        : record.hubspotDealId
        ? await getAssociatedContactsForDeal(record.hubspotDealId)
        : [];
      const teamDocumentContext = (record.documents || [])
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
      console.warn('Pre-rescore team research failed, continuing re-score:', error);
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
      console.warn('Pre-rescore portfolio synergy research failed, continuing re-score:', error);
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
      console.warn('Pre-rescore problem necessity research failed, continuing re-score:', error);
    }


    // Track how many new documents were found
    let newDocumentsCount = 0;

    // Check for new files in Google Drive folder (recursively, including shortcuts)
    let allDocuments = [...record.documents];
    if (record.googleDriveFolderId) {
      try {
        const driveFiles = await listFilesRecursively(record.googleDriveFolderId);
        
        // Filter out Google Docs native files (can't download as binary)
        // BUT keep Google Sheets - we can export them as Excel
        const downloadableFiles = driveFiles.filter(f => 
          !f.mimeType.startsWith('application/vnd.google-apps.') ||
          f.mimeType === 'application/vnd.google-apps.shortcut' ||
          f.mimeType === 'application/vnd.google-apps.spreadsheet'
        );
        
        
        // Find files that aren't in the record yet
        // Check both by file ID and by filename to prevent duplicates
        const existingFileIds = new Set(record.documents.map(d => d.googleDriveId).filter(Boolean));
        const existingFileNames = new Set(record.documents.map(d => d.name.toLowerCase()));
        const newFiles = downloadableFiles.filter(f => 
          !existingFileIds.has(f.id) && !existingFileNames.has(f.name.toLowerCase())
        );
        
        if (newFiles.length > 0) {
          // Download and parse new files
          for (const file of newFiles) {
            try {
              // Download from Google Drive (pass mime type for Google Sheets export)
              const buffer = await downloadFileFromDrive(file.id, file.mimeType);
              
              // Parse the document
              const extension = file.name.split('.').pop() || '';
              const extractedText = await parseDocument(buffer, extension);
              
              // Determine document type
              let docType: 'deck' | 'financial' | 'legal' | 'other' = 'other';
              const fileName = file.name.toLowerCase();
              if (fileName.includes('pitch') || fileName.includes('deck') || fileName.includes('presentation')) {
                docType = 'deck';
              } else if (fileName.includes('financial') || fileName.includes('p&l') || fileName.includes('balance')) {
                docType = 'financial';
              } else if (fileName.includes('legal') || fileName.includes('contract') || fileName.includes('agreement')) {
                docType = 'legal';
              }
              
              const newDoc: DiligenceDocument = {
                id: `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                name: file.path || file.name, // Use full path if available (e.g., "Data Room/financials.pdf")
                type: docType,
                fileType: extension,
                googleDriveId: file.id,
                googleDriveUrl: file.webViewLink,
                uploadedAt: new Date().toISOString(),
                extractedText,
                size: file.size,
              };
              
              allDocuments.push(newDoc);
              newDocumentsCount++;
            } catch (error) {
              console.error(`Error processing new file ${file.name}:`, error);
            }
          }
        }
      } catch (error) {
        console.error('Error checking for new files:', error);
        // Continue with re-scoring even if checking for new files fails
      }
    }

    // In incremental mode, keep existing parsed docs and only include newly discovered docs.
    // In full mode, re-download and re-parse all Drive-backed docs.
    const updatedDocuments = [];
    for (const doc of allDocuments) {
      if (!runFullRescore) {
        updatedDocuments.push(doc);
        continue;
      }

      // Skip documents without Google Drive IDs (external links, etc.)
      if (!doc.googleDriveId) {
        updatedDocuments.push(doc);
        continue;
      }
      
      try {
        // Download from Google Drive (pass mime type for Google Sheets export)
        const buffer = await downloadFileFromDrive(doc.googleDriveId, doc.type);
        
        // Re-parse the document
        const extension = doc.name.split('.').pop() || '';
        const extractedText = await parseDocument(buffer, extension);
        
        updatedDocuments.push({
          ...doc,
          extractedText,
        });
      } catch (error) {
        console.error(`Error re-parsing ${doc.name}:`, error);
        // Keep the original document if re-parsing fails
        updatedDocuments.push(doc);
      }
    }

    // Update record with new extracted text
    await updateDiligenceRecord(diligenceId, {
      documents: updatedDocuments,
    });

    // Re-ingest external links when content is missing/low-quality before re-scoring.
    let refreshedAnyLinkDoc = false;
    const reingestedDocuments = await Promise.all(
      updatedDocuments.map(async (doc): Promise<DiligenceDocument> => {
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
      updatedDocuments.splice(0, updatedDocuments.length, ...reingestedDocuments);
      await updateDiligenceRecord(diligenceId, {
        documents: updatedDocuments,
      });
    }

    // Load criteria
    const criteria = await loadDiligenceCriteria();
    const requestedCategoryName = typeof categoryName === 'string' ? categoryName.trim() : '';
    const criteriaForScoring = requestedCategoryName
      ? {
          ...criteria,
          categories: criteria.categories.filter((cat) => cat.name === requestedCategoryName),
        }
      : criteria;
    if (requestedCategoryName && criteriaForScoring.categories.length === 0) {
      return NextResponse.json(
        { error: `Category "${requestedCategoryName}" not found in criteria`, success: false },
        { status: 400 }
      );
    }
    const appSettings = await loadAppSettings();

    // Prepare document texts for scoring
    const documentTexts = updatedDocuments
      .filter((doc) => shouldUseDocumentForScoring(doc)) // Only include docs with usable extracted text
      .map((doc) => ({
        fileName: doc.name,
        type: doc.type,
        text: doc.extractedText!,
      }));

    if (trustedHubspotCompanyData?.pitchDeckUrl) {
      const pitchDeckUrl = trustedHubspotCompanyData.pitchDeckUrl;
      const alreadyLinked = updatedDocuments.some(doc => doc.externalUrl === pitchDeckUrl);
      if (!alreadyLinked) {
        try {
          const pitchDeckDocument = await importHubSpotPitchDeck(pitchDeckUrl);
          if (pitchDeckDocument) {
            updatedDocuments.push(pitchDeckDocument);
            documentTexts.push({
              fileName: pitchDeckDocument.name,
              type: pitchDeckDocument.type,
              text: pitchDeckDocument.extractedText || '',
            });
          } else {
            const linkDoc = buildHubSpotPitchDeckLinkDocument(pitchDeckUrl);
            updatedDocuments.push(linkDoc);
            documentTexts.push({
              fileName: linkDoc.name,
              type: linkDoc.type,
              text: linkDoc.extractedText || '',
            });
          }
        } catch (error) {
          console.warn('Unable to auto-import HubSpot pitch deck URL for re-score:', error);
          const linkDoc = buildHubSpotPitchDeckLinkDocument(pitchDeckUrl);
          updatedDocuments.push(linkDoc);
          documentTexts.push({
            fileName: linkDoc.name,
            type: linkDoc.type,
            text: linkDoc.extractedText || '',
          });
        }
      }
    }
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

    // Fetch fresh web content if URL is provided (full rescore only)
    let websiteContent: string | undefined;
    if (runFullRescore && record.companyUrl && isValidUrl(record.companyUrl)) {
      const fetchResult = await fetchUrlContent(record.companyUrl);
      
      if (fetchResult.success && fetchResult.content) {
        websiteContent = fetchResult.content;
        documentTexts.push({
          fileName: `Website Content: ${fetchResult.title || record.companyUrl}`,
          text: fetchResult.content,
          type: 'other',
        });
      } else {
        console.warn(`Failed to re-fetch website: ${fetchResult.error}`);
      }
    }

    // Perform fresh web searches for updated information (full rescore only)
    if (runFullRescore && isSearchConfigured()) {
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

    // Check if thesis answers are manually edited
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

    const scoringInputFingerprint = buildScoringFingerprint({
      companyName: record.companyName,
      companyUrl: record.companyUrl,
      companyDescription: record.companyDescription,
      notes: notesForExtraction,
      categorizedNotes: record.categorizedNotes || [],
      metrics: record.metrics,
      documents: updatedDocuments,
      criteria: criteriaForScoring,
      scorerVersion: SCORER_VERSION,
      summarizeTranscriptNotesForScoring: Boolean(appSettings.summarizeTranscriptNotesForScoring),
    });

    const previousFingerprint = record.score?.scoringInputFingerprint;
    if (!requestedCategoryName && !runFullRescore && previousFingerprint && previousFingerprint === scoringInputFingerprint && newDocumentsCount === 0) {
      return NextResponse.json({
        success: true,
        record,
        message: 'No new information detected. Skipped scoring. Use Full re-score to force a full refresh.',
        skipped: true,
      });
    }

    // Score the diligence (pass previous score for change explanation)
    const result = await scoreDiligence(
      documentTexts,
      criteriaForScoring,
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
      record.score || undefined, // Pass previous score if it exists
      existingThesisAnswers, // Pass manually edited thesis as context
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
    const finalScoringFingerprint = buildScoringFingerprint({
      companyName: record.companyName,
      companyUrl: record.companyUrl,
      companyDescription: record.companyDescription,
      notes: notesForExtraction,
      categorizedNotes: record.categorizedNotes || [],
      metrics: result.metrics,
      documents: updatedDocuments,
      criteria: criteriaForScoring,
      scorerVersion: SCORER_VERSION,
      summarizeTranscriptNotesForScoring: Boolean(appSettings.summarizeTranscriptNotesForScoring),
    });
    result.score.scoringInputFingerprint = finalScoringFingerprint;
    result.score.scoringMode = runFullRescore ? 'full' : 'incremental';

    const score = result.score;
    const blendedThesisAnswers = score.thesisAnswers;
    if (requestedCategoryName && record.score?.categories?.length) {
      const rescoredCategory = score.categories.find((cat) => cat.category === requestedCategoryName);
      if (rescoredCategory) {
        const mergedCategories = record.score.categories.map((existingCategory) =>
          existingCategory.category === requestedCategoryName ? rescoredCategory : existingCategory
        );
        score.categories = mergedCategories;
        const totalWeight = score.categories.reduce((sum, cat) => sum + cat.weight, 0);
        const weightedTotal = score.categories.reduce(
          (sum, cat) => sum + (effectiveCategoryScore(cat) * cat.weight),
          0
        );
        score.overall = totalWeight > 0 ? Math.round(weightedTotal / totalWeight) : score.overall;
        score.dataQuality = record.score.dataQuality;
        score.thesisAnswers = blendedThesisAnswers || record.score.thesisAnswers;
      }
    }


    // Store the AI-only score before applying any manual overrides
    const aiOnlyScore = score.overall;
    const previousScore = record.score?.overall || 0;
    const modelRescoreExplanation = score.rescoreExplanation?.trim();

    // Preserve manual overrides from the old score
    if (record.score && record.score.categories) {
      // Create a map of category name -> manual override data
      const manualOverrides = new Map(
        record.score.categories
          .filter(cat => cat.manualOverride !== undefined)
          .map(cat => [cat.category, {
            manualOverride: cat.manualOverride,
            overrideReason: cat.overrideReason,
            overridedAt: cat.overridedAt,
          }])
      );

      // Apply manual overrides to the new score
      if (manualOverrides.size > 0) {
        score.categories = score.categories.map(category => {
          const override = manualOverrides.get(category.category);
          if (override) {
            // Recalculate weighted score with the manual override
            const effectiveScore = override.manualOverride!;
            return {
              ...category,
              manualOverride: override.manualOverride,
              overrideReason: override.overrideReason,
              overridedAt: override.overridedAt,
              weightedScore: Number(((effectiveScore * category.weight) / 100).toFixed(2)),
            };
          }
          return category;
        });

        // Recalculate overall score with manual overrides
        let totalWeightedScore = 0;
        let totalWeight = 0;
        for (const category of score.categories) {
          const effectiveScore = category.manualOverride ?? category.score;
          totalWeightedScore += effectiveScore * category.weight;
          totalWeight += category.weight;
        }
        const oldOverall = score.overall;
        score.overall = totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : score.overall;
        
        // Preserve manually edited thesis answers
        if (existingThesisAnswers) {
          score.thesisAnswers = existingThesisAnswers;
        }
        
      }
    }

    const structuredNarrative = buildRescoreNarrative(record.score, score, aiOnlyScore, newDocumentsCount);
    score.rescoreExplanation = modelRescoreExplanation
      ? `${modelRescoreExplanation}\n\n${structuredNarrative}`
      : structuredNarrative;
    
    // Update record with new score (preserving manual overrides) and company metadata
    const updateData: any = {
      score,
      metrics: result.metrics,
      documents: updatedDocuments,
    };
    
    // Update company metadata if provided
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
        console.warn('Auto-sync to HubSpot after re-score failed:', syncError);
      }
    }

    const modeLabel = runFullRescore ? 'full' : 'incremental';
    const message = newDocumentsCount > 0 
      ? `Successfully ${modeLabel} re-scored with ${newDocumentsCount} new document(s) from Drive folder`
      : requestedCategoryName
        ? `Successfully re-scored ${requestedCategoryName} category`
        : `Successfully ${modeLabel} re-scored diligence`;

    const documentWarnings = collectDocumentReadWarnings(updatedRecord.documents || []);
    return NextResponse.json({
      success: true,
      record: updatedRecord,
      message,
      newDocumentsFound: newDocumentsCount,
      documentWarnings,
    });
  } catch (error) {
    const errorMessage = formatUnknownError(error);
    console.error('Error in rescore endpoint:', errorMessage, error);
    return NextResponse.json(
      {
        error: errorMessage || 'Failed to re-score diligence',
        success: false,
      },
      { status: 500 }
    );
  }
}
