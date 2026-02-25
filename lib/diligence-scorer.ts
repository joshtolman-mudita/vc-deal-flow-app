import OpenAI from 'openai';
import {
  DiligenceScore,
  DiligenceCriteria,
  CategoryScore,
  CriterionScore,
  ExternalMarketIntelligence,
  DiligenceMetrics,
  DiligenceMetricValue,
  DiligenceQuestion,
  HubSpotCompanyData,
  ProblemNecessityResearch,
  PortfolioSynergyResearch,
  TeamResearch,
} from '@/types/diligence';

export const SCORER_VERSION = '2026-02-16-dev-investor-questioning-fix-v2';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Token limits for different contexts
const TOKEN_LIMITS = {
  MAX_SCORING_CHARS: 200000,      // Max chars for scoring context
  MAX_CHAT_CHARS: 150000,         // Max chars for chat context
  MAX_SINGLE_DOC_CHARS: 100000,   // Max chars per document
};

type ScoringDocument = { fileName: string; text: string; type: string };
type EvidenceStatus = 'supported' | 'weakly_supported' | 'unknown' | 'contradicted';
type CategorizedNoteInput = {
  id: string;
  category: string;
  title?: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};
type CalibrationProfile = Array<{
  category: string;
  averageDelta: number;
  averageAbsDelta: number;
  sampleCount: number;
}>;

interface ScoringOptions {
  summarizeTranscriptNotesForScoring?: boolean;
}

export interface TamAnalysisResult {
  founderTam: string;
  independentTam: string;
  blendedTam: string;
  alignment: 'aligned' | 'somewhat_aligned' | 'overstated' | 'understated' | 'unknown';
  confidence: number;
  discrepancyRatio?: number;
  method: string;
  assumptions: string[];
  deltaSummary: string;
  explanation: string;
}

function normalizeMetric(value: DiligenceMetricValue | undefined): DiligenceMetricValue | undefined {
  if (!value || !value.value || !value.value.trim()) return undefined;
  return {
    value: value.value.trim(),
    source: value.source || 'auto',
    sourceDetail: value.sourceDetail,
    updatedAt: value.updatedAt || new Date().toISOString(),
  };
}

function isPlaceholderMetricValue(raw?: string): boolean {
  if (!raw) return true;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return true;
  const compact = normalized.replace(/[\s$:_-]/g, '');
  return (
    compact === 'unknown' ||
    compact === 'na' ||
    compact === 'n/a' ||
    compact === 'notavailable' ||
    compact === 'notprovided' ||
    compact === 'notdisclosed' ||
    compact === 'notspecified' ||
    compact === 'none'
  );
}

function hasUsableMetricValue(metric?: DiligenceMetricValue): boolean {
  return Boolean(metric?.value && !isPlaceholderMetricValue(metric.value));
}

function parsePercentValue(raw?: string): number | undefined {
  if (!raw) return undefined;
  const match = raw.match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function deriveMarketGrowthBand(rawRate?: string): 'high' | 'moderate' | 'low' | 'unknown' {
  const pct = parsePercentValue(rawRate);
  if (pct === undefined) return 'unknown';
  if (pct >= 20) return 'high';
  if (pct >= 8) return 'moderate';
  if (pct >= 0) return 'low';
  return 'unknown';
}

function firstRegexMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function normalizeMoneyToken(raw?: string): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  let normalized = value
    .replace(/\b(thousand)\b/gi, 'K')
    .replace(/\b(million)\b/gi, 'M')
    .replace(/\b(billion)\b/gi, 'B')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/^\$/.test(normalized)) {
    normalized = `$${normalized}`;
  }
  return normalized;
}

function isLikelyMoneyToken(raw?: string): boolean {
  if (!raw) return false;
  const value = raw.trim().toLowerCase();
  if (!value) return false;
  if (/x\b/.test(value)) return false;
  if (/\$/.test(value)) return true;
  if (/\b(k|m|b|thousand|million|billion)\b/.test(value)) return true;

  const cleaned = value.replace(/[,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return false;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) && Math.abs(numeric) >= 1000;
}

function extractMoneyTokens(text: string): string[] {
  if (!text) return [];
  const matches = Array.from(
    text.matchAll(/(\$\s*\d[\d,.]*(?:\.\d+)?\s?(?:(?:[kmb]\b)|thousand|million|billion)?|\d[\d,.]*(?:\.\d+)?\s?(?:(?:k|m|b)\b|thousand|million|billion)|\d{4,})/gi)
  )
    .map((m) => m[1]?.trim() || '')
    .filter(Boolean)
    .filter((value) => isLikelyMoneyToken(value));
  return Array.from(new Set(matches));
}

function pickArrValueFromText(text: string): string | undefined {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const findOnMatchingLines = (matcher: RegExp): string | undefined => {
    let best: { token: string; score: number } | null = null;
    for (const line of lines) {
      if (!matcher.test(line)) continue;
      const lowered = line.toLowerCase();
      if (
        /\b(raising|raise|funding\s+sought|seeking\s+to\s+raise|target\s+raise|committed)\b/.test(lowered) &&
        !/\b(contracted|booked|current|actual)\s+arr\b/.test(lowered)
      ) {
        continue;
      }
      if (hasProjectionHint(line)) continue;
      const moneyTokens = extractMoneyTokens(line);
      if (moneyTokens.length === 0) continue;
      const score =
        (/\b(contracted|booked|current|actual)\s+arr\b/.test(lowered) ? 40 : 0) +
        (/\bpaid\s+customers?\b/.test(lowered) ? 15 : 0) +
        (/\barr\b/.test(lowered) ? 10 : 0) -
        (/\b(potential|possible|roughly|about)\b/.test(lowered) ? 5 : 0);
      const token = moneyTokens[0];
      if (!best || score > best.score) {
        best = { token, score };
      }
    }
    return best?.token;
  };

  return (
    findOnMatchingLines(/contracted\s+arr/i) ||
    findOnMatchingLines(/\bcarr\b/i) ||
    findOnMatchingLines(/\b(booked\s+)?arr\b/i) ||
    undefined
  );
}

function resolveFounderTamClaim(
  sourceOfTruthMetrics?: DiligenceMetrics,
  hubspotCompanyData?: HubSpotCompanyData,
  intel?: ExternalMarketIntelligence
): string | undefined {
  const metricTam = sourceOfTruthMetrics?.tam;
  if (
    metricTam &&
    hasUsableMetricValue(metricTam) &&
    (metricTam.source === 'manual' || metricTam.sourceDetail === 'notes' || metricTam.sourceDetail === 'hubspot')
  ) {
    return metricTam.value;
  }
  if (!isPlaceholderMetricValue(hubspotCompanyData?.tamRange)) {
    return hubspotCompanyData?.tamRange;
  }
  const companyClaim = intel?.tamSamSom?.companyClaim?.tam;
  if (!isPlaceholderMetricValue(companyClaim)) {
    return companyClaim;
  }
  return undefined;
}

function parseMoneyToNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim().toLowerCase().replace(/[$,\s]/g, '');
  const match = cleaned.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!match) return undefined;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return undefined;
  const multiplier = match[2] === 'b' ? 1_000_000_000 : match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1;
  return base * multiplier;
}

function hasProjectionHint(line: string): boolean {
  return /\b(projected|projection|forecast|plan|planned|target|expected|estimate|estimated|goal|outlook|pipeline|towards?|aim(?:ing)?|plan\s+to\s+reach|run[-\s]?rate)\b/i.test(line);
}

function filterOutProjectedLines(extractedFacts: string): string {
  return extractedFacts
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !hasProjectionHint(line))
    .join('\n');
}

function extractYearlyArrValues(extractedFacts: string): Array<{ year: number; value: number }> {
  const currentYear = new Date().getFullYear();
  const lines = extractedFacts.split('\n').map(line => line.trim()).filter(Boolean);
  const yearlyPairs: Array<{ year: number; value: number }> = [];

  for (const line of lines) {
    if (hasProjectionHint(line)) continue;
    if (!/arr|annual recurring revenue/i.test(line)) continue;
    const yearMatches = Array.from(line.matchAll(/\b(20\d{2})\b/g)).map(m => Number(m[1]));
    const moneyMatches = Array.from(line.matchAll(/(\$[\d,.]+\s?[kmb]?)/ig)).map(m => m[1]);
    if (yearMatches.length === 0 || moneyMatches.length === 0) continue;

    const pairCount = Math.min(yearMatches.length, moneyMatches.length);
    for (let i = 0; i < pairCount; i += 1) {
      const parsed = parseMoneyToNumber(moneyMatches[i]);
      if (parsed && yearMatches[i] && yearMatches[i] <= currentYear) {
        yearlyPairs.push({ year: yearMatches[i], value: parsed });
      }
    }
  }

  const dedupedByYear = new Map<number, number>();
  yearlyPairs.forEach(({ year, value }) => {
    const current = dedupedByYear.get(year);
    if (!current || value > current) {
      dedupedByYear.set(year, value);
    }
  });

  return Array.from(dedupedByYear.entries())
    .map(([year, value]) => ({ year, value }))
    .sort((a, b) => a.year - b.year);
}

function deriveMetricsFromFacts(extractedFacts: string, externalIntel?: ExternalMarketIntelligence): DiligenceMetrics {
  const nonProjectedFacts = filterOutProjectedLines(extractedFacts);
  const moneyPattern = '(\\$\\s*\\d[\\d,.]*(?:\\.\\d+)?\\s?(?:(?:[kmb]\\b)|thousand|million|billion)?|\\d[\\d,.]*(?:\\.\\d+)?\\s?(?:(?:k|m|b)\\b|thousand|million|billion)|\\d{4,})';
  const arr = pickArrValueFromText(nonProjectedFacts) || firstRegexMatch(extractedFacts, [
    new RegExp(`booked\\s+arr[^\\d]{0,20}${moneyPattern}`, 'i'),
  ]);
  const tamFromFacts = firstRegexMatch(extractedFacts, [
    new RegExp(`\\btam[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`market\\s+size[^\\d]{0,20}${moneyPattern}`, 'i'),
  ]);
  const tamFromExternal = externalIntel?.tamSamSom?.independentEstimate?.tam || externalIntel?.tamSamSom?.companyClaim?.tam;
  const tam = tamFromFacts || tamFromExternal;
  const acv = firstRegexMatch(extractedFacts, [
    new RegExp(`\\bacv[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`average\\s+contract\\s+value[^\\d]{0,20}${moneyPattern}`, 'i'),
  ]);
  const fundingAmount = firstRegexMatch(extractedFacts, [
    new RegExp(`(?:raising|raise|funding\\s+sought|seeking\\s+to\\s+raise|target\\s+raise)[^\\d]{0,30}${moneyPattern}`, 'i'),
    new RegExp(`\\braising[^\\d]{0,15}${moneyPattern}`, 'i'),
  ]);
  const cashOnHand = firstRegexMatch(extractedFacts, [
    new RegExp(`cash\\s+on\\s+hand[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`cash[^\\d]{0,20}${moneyPattern}`, 'i'),
  ]);
  const committed = firstRegexMatch(extractedFacts, [
    new RegExp(`committed[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`commitments?[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`raised\\s+so\\s+far[^\\d]{0,20}${moneyPattern}`, 'i'),
  ]);
  const valuation = firstRegexMatch(extractedFacts, [
    new RegExp(`valuation[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`post[-\\s]?money[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`pre[-\\s]?money[^\\d]{0,20}${moneyPattern}`, 'i'),
  ]);
  const lead = firstRegexMatch(extractedFacts, [
    /lead\s+investor[^:\n]{0,20}[:\-]\s*([^\n]{3,120})/i,
    /lead\s+vc[^:\n]{0,20}[:\-]\s*([^\n]{3,120})/i,
    /lead\s+information[^:\n]{0,20}[:\-]\s*([^\n]{3,120})/i,
  ]);
  const postFundingRunway = firstRegexMatch(extractedFacts, [
    /post[-\s]?funding\s+runway[^:\n]{0,20}[:\-]\s*([^\n]{2,80})/i,
    /runway\s+post[-\s]?funding[^:\n]{0,20}[:\-]\s*([^\n]{2,80})/i,
    /target[^:\n]{0,30}runway[^:\n]{0,20}[:\-]\s*([^\n]{2,80})/i,
    /target[^:\n]{0,20}[:\-]?\s*(\d+(?:\.\d+)?\s*(?:months?|mos?))\s+runway/i,
    /(\d+(?:\.\d+)?\s*(?:months?|mos?))\s+runway[^.\n]{0,40}(?:post[-\s]?funding|after\s+funding|after\s+raise)/i,
  ]);
  const currentRunwayExplicit = firstRegexMatch(extractedFacts, [
    /current\s+runway[^:\n]{0,20}[:\-]\s*([^\n]{2,80})/i,
  ]);
  const currentRunwayFallback = firstRegexMatch(extractedFacts, [
    /runway[^:\n]{0,20}[:\-]\s*([^\n]{2,80})/i,
  ]);
  const currentRunway = currentRunwayExplicit || (!postFundingRunway ? currentRunwayFallback : undefined);
  let yoyGrowthRate = firstRegexMatch(extractedFacts, [
    /(\d+(?:\.\d+)?%)\s*(?:yoy|year[-\s]?over[-\s]?year)/i,
    /yoy\s+growth[^0-9]{0,20}(\d+(?:\.\d+)?%)/i,
    /(\d+(?:\.\d+)?)x\s*(?:growth\s*)?(?:yoy|year[-\s]?over[-\s]?year)/i,
    /(?:yoy|year[-\s]?over[-\s]?year)[^0-9]{0,20}(\d+(?:\.\d+)?)x/i,
  ]);
  if (yoyGrowthRate && /^\d+(\.\d+)?$/.test(yoyGrowthRate)) {
    yoyGrowthRate = `${yoyGrowthRate}x`;
  }

  const arrValue = isLikelyMoneyToken(arr) ? (normalizeMoneyToken(arr) || arr) : undefined;
  const tamValue = isLikelyMoneyToken(tam) ? (normalizeMoneyToken(tam) || tam) : undefined;
  const tamSourceDetail: DiligenceMetricValue['sourceDetail'] = tamFromFacts ? 'facts' : 'market_research';
  const marketGrowthValue =
    externalIntel?.marketGrowth?.estimatedCagr &&
    !isPlaceholderMetricValue(externalIntel.marketGrowth.estimatedCagr)
      ? externalIntel.marketGrowth.estimatedCagr
      : undefined;
  const acvValue = isLikelyMoneyToken(acv) ? (normalizeMoneyToken(acv) || acv) : undefined;
  const fundingAmountValue = isLikelyMoneyToken(fundingAmount) ? (normalizeMoneyToken(fundingAmount) || fundingAmount) : undefined;
  const cashOnHandValue = isLikelyMoneyToken(cashOnHand) ? (normalizeMoneyToken(cashOnHand) || cashOnHand) : undefined;
  const normalizedFundingAmountValue =
    fundingAmountValue && cashOnHandValue && normalizeMoneyToken(fundingAmountValue) === normalizeMoneyToken(cashOnHandValue)
      ? undefined
      : fundingAmountValue;
  const committedValue = isLikelyMoneyToken(committed) ? (normalizeMoneyToken(committed) || committed) : undefined;
  const valuationValue = isLikelyMoneyToken(valuation) ? (normalizeMoneyToken(valuation) || valuation) : undefined;

  if (!yoyGrowthRate) {
    const yearlyArr = extractYearlyArrValues(nonProjectedFacts);
    if (yearlyArr.length >= 2) {
      const latest = yearlyArr[yearlyArr.length - 1];
      const previous = yearlyArr[yearlyArr.length - 2];
      if (previous.value > 0) {
        const growth = ((latest.value - previous.value) / previous.value) * 100;
        yoyGrowthRate = `${Math.round(growth)}%`;
      }
    }
  }

  return {
    arr: normalizeMetric(arrValue ? { value: arrValue, source: 'auto', sourceDetail: 'facts' } : undefined),
    tam: normalizeMetric(tamValue ? { value: tamValue, source: 'auto', sourceDetail: tamSourceDetail } : undefined),
    marketGrowthRate: normalizeMetric(
      marketGrowthValue
        ? { value: marketGrowthValue, source: 'auto', sourceDetail: 'market_research' }
        : undefined
    ),
    acv: normalizeMetric(acvValue ? { value: acvValue, source: 'auto', sourceDetail: 'facts' } : undefined),
    yoyGrowthRate: normalizeMetric(yoyGrowthRate ? { value: yoyGrowthRate, source: 'auto', sourceDetail: 'facts' } : undefined),
    fundingAmount: normalizeMetric(
      normalizedFundingAmountValue ? { value: normalizedFundingAmountValue, source: 'auto', sourceDetail: 'facts' } : undefined
    ),
    committed: normalizeMetric(
      committedValue ? { value: committedValue, source: 'auto', sourceDetail: 'facts' } : undefined
    ),
    valuation: normalizeMetric(
      valuationValue ? { value: valuationValue, source: 'auto', sourceDetail: 'facts' } : undefined
    ),
    lead: normalizeMetric(lead ? { value: lead, source: 'auto', sourceDetail: 'facts' } : undefined),
    currentRunway: normalizeMetric(
      currentRunway ? { value: currentRunway.replace(/^[\s:;-]+|[\s]+$/g, ''), source: 'auto', sourceDetail: 'facts' } : undefined
    ),
    postFundingRunway: normalizeMetric(
      postFundingRunway ? { value: postFundingRunway.replace(/^[\s:;-]+|[\s]+$/g, ''), source: 'auto', sourceDetail: 'facts' } : undefined
    ),
  };
}

function deriveMetricsFromCategorizedNotes(categorizedNotes: CategorizedNoteInput[] = []): DiligenceMetrics {
  const notesText = categorizedNotes
    .map((note) => `${note.category || ''}\n${note.title || ''}\n${note.content || ''}`)
    .join('\n');
  if (!notesText.trim()) return {};

  const moneyPattern = '(\\$\\s*\\d[\\d,.]*(?:\\.\\d+)?\\s?(?:(?:[kmb]\\b)|thousand|million|billion)?|\\d[\\d,.]*(?:\\.\\d+)?\\s?(?:(?:k|m|b)\\b|thousand|million|billion)|\\d{4,})';
  const arr = pickArrValueFromText(notesText) || firstRegexMatch(notesText, [
    new RegExp(`annual\\s+recurring\\s+revenue[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`revenue[^\\d]{0,20}${moneyPattern}`, 'i'),
  ]);
  const tam = firstRegexMatch(notesText, [
    new RegExp(`\\btam[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`market\\s+size[^\\d]{0,20}${moneyPattern}`, 'i'),
  ]);
  const acv = firstRegexMatch(notesText, [
    new RegExp(`\\bacv[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`average\\s+contract\\s+value[^\\d]{0,20}${moneyPattern}`, 'i'),
  ]);
  const yoyGrowthRate = firstRegexMatch(notesText, [
    /(\d+(?:\.\d+)?%)\s*(?:yoy|year[-\s]?over[-\s]?year)/i,
    /yoy\s+growth[^0-9]{0,20}(\d+(?:\.\d+)?%)/i,
    /growth[^0-9]{0,20}(\d+(?:\.\d+)?x\s*(?:qoq|yoy))/i,
    /(\d+(?:\.\d+)?)x\s*(?:growth\s*)?(?:yoy|year[-\s]?over[-\s]?year)/i,
    /(?:yoy|year[-\s]?over[-\s]?year)[^0-9]{0,20}(\d+(?:\.\d+)?)x/i,
  ]);
  const normalizedYoyGrowthRate = yoyGrowthRate && /^\d+(\.\d+)?$/.test(yoyGrowthRate)
    ? `${yoyGrowthRate}x`
    : yoyGrowthRate;
  const marketGrowthRate = firstRegexMatch(notesText, [
    /market\s+growth[^0-9]{0,20}(\d+(?:\.\d+)?%)/i,
    /(\d+(?:\.\d+)?%)\s*(?:market\s+growth|market\s+cagr|industry\s+cagr)/i,
    /cagr[^0-9]{0,20}(\d+(?:\.\d+)?%)/i,
  ]);
  const fundingAmount = firstRegexMatch(notesText, [
    new RegExp(`raise\\s+amount[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`funding\\s+amount[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`round[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`funding\\s+sought[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`seeking\\s+to\\s+raise[^\\d]{0,20}${moneyPattern}`, 'i'),
  ]);
  const committed = firstRegexMatch(notesText, [
    new RegExp(`committed[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`commitments?[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`raised\\s+so\\s+far[^\\d]{0,20}${moneyPattern}`, 'i'),
  ]);
  const valuation = firstRegexMatch(notesText, [
    new RegExp(`valuation[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`post[-\\s]?money[^\\d]{0,20}${moneyPattern}`, 'i'),
    new RegExp(`pre[-\\s]?money[^\\d]{0,20}${moneyPattern}`, 'i'),
  ]);
  const lead = firstRegexMatch(notesText, [
    /lead\s+investor[^:\n]{0,20}[:\-]\s*([^\n]{3,120})/i,
    /lead\s+vc[^:\n]{0,20}[:\-]\s*([^\n]{3,120})/i,
    /lead\s+information[^:\n]{0,20}[:\-]\s*([^\n]{3,120})/i,
  ]);
  const postFundingRunway = firstRegexMatch(notesText, [
    /post[-\s]?funding\s+runway[^:\n]{0,20}[:\-]\s*([^\n]{2,80})/i,
    /runway\s+post[-\s]?funding[^:\n]{0,20}[:\-]\s*([^\n]{2,80})/i,
    /target[^:\n]{0,30}runway[^:\n]{0,20}[:\-]\s*([^\n]{2,80})/i,
    /target[^:\n]{0,20}[:\-]?\s*(\d+(?:\.\d+)?\s*(?:months?|mos?))\s+runway/i,
    /(\d+(?:\.\d+)?\s*(?:months?|mos?))\s+runway[^.\n]{0,40}(?:post[-\s]?funding|after\s+funding|after\s+raise)/i,
  ]);
  const currentRunwayExplicit = firstRegexMatch(notesText, [
    /current\s+runway[^:\n]{0,20}[:\-]\s*([^\n]{2,80})/i,
  ]);
  const currentRunwayFallback = firstRegexMatch(notesText, [
    /runway[^:\n]{0,20}[:\-]\s*([^\n]{2,80})/i,
  ]);
  const currentRunway = currentRunwayExplicit || (!postFundingRunway ? currentRunwayFallback : undefined);

  const arrValue = isLikelyMoneyToken(arr) ? (normalizeMoneyToken(arr) || arr) : undefined;
  const tamValue = isLikelyMoneyToken(tam) ? (normalizeMoneyToken(tam) || tam) : undefined;
  const acvValue = isLikelyMoneyToken(acv) ? (normalizeMoneyToken(acv) || acv) : undefined;
  const fundingAmountValue = isLikelyMoneyToken(fundingAmount) ? (normalizeMoneyToken(fundingAmount) || fundingAmount) : undefined;
  const committedValue = isLikelyMoneyToken(committed) ? (normalizeMoneyToken(committed) || committed) : undefined;
  const valuationValue = isLikelyMoneyToken(valuation) ? (normalizeMoneyToken(valuation) || valuation) : undefined;

  return {
    arr: normalizeMetric(arrValue ? { value: arrValue, source: 'auto', sourceDetail: 'notes' } : undefined),
    tam: normalizeMetric(tamValue ? { value: tamValue, source: 'auto', sourceDetail: 'notes' } : undefined),
    marketGrowthRate: normalizeMetric(
      marketGrowthRate ? { value: marketGrowthRate, source: 'auto', sourceDetail: 'notes' } : undefined
    ),
    acv: normalizeMetric(acvValue ? { value: acvValue, source: 'auto', sourceDetail: 'notes' } : undefined),
    yoyGrowthRate: normalizeMetric(
      normalizedYoyGrowthRate ? { value: normalizedYoyGrowthRate, source: 'auto', sourceDetail: 'notes' } : undefined
    ),
    fundingAmount: normalizeMetric(
      fundingAmountValue ? { value: fundingAmountValue, source: 'auto', sourceDetail: 'notes' } : undefined
    ),
    committed: normalizeMetric(
      committedValue ? { value: committedValue, source: 'auto', sourceDetail: 'notes' } : undefined
    ),
    valuation: normalizeMetric(
      valuationValue ? { value: valuationValue, source: 'auto', sourceDetail: 'notes' } : undefined
    ),
    lead: normalizeMetric(lead ? { value: lead, source: 'auto', sourceDetail: 'notes' } : undefined),
    currentRunway: normalizeMetric(
      currentRunway ? { value: currentRunway.replace(/^[\s:;-]+|[\s]+$/g, ''), source: 'auto', sourceDetail: 'notes' } : undefined
    ),
    postFundingRunway: normalizeMetric(
      postFundingRunway ? { value: postFundingRunway.replace(/^[\s:;-]+|[\s]+$/g, ''), source: 'auto', sourceDetail: 'notes' } : undefined
    ),
  };
}

function deriveMetricsFromRawDocumentText(rawText: string): DiligenceMetrics {
  const text = String(rawText || '');
  if (!text.trim()) return {};
  const moneyPattern =
    '(\\$\\s*\\d[\\d,.]*(?:\\.\\d+)?\\s?(?:(?:[kmb]\\b)|thousand|million|billion)?|\\d[\\d,.]*(?:\\.\\d+)?\\s?(?:(?:k|m|b)\\b|thousand|million|billion)|\\d{4,})';
  const fundingAmount = firstRegexMatch(text, [
    new RegExp(`(?:raising|raise|funding\\s+sought|seeking\\s+to\\s+raise|target\\s+raise)[^\\d]{0,30}${moneyPattern}`, 'i'),
    new RegExp(`\\bpre[-\\s]?seed[^\\d]{0,30}${moneyPattern}`, 'i'),
    new RegExp(`\\bseed\\s+round[^\\d]{0,30}${moneyPattern}`, 'i'),
  ]);
  const postFundingRunway = firstRegexMatch(text, [
    /post[-\s]?funding\s+runway[^:\n]{0,30}[:\-]?\s*([^\n]{2,80})/i,
    /runway\s+post[-\s]?funding[^:\n]{0,30}[:\-]?\s*([^\n]{2,80})/i,
    /target[^:\n]{0,20}[:\-]?\s*(\d+(?:\.\d+)?\s*(?:months?|mos?))\s+runway/i,
    /(\d+(?:\.\d+)?\s*(?:months?|mos?))\s+runway[^.\n]{0,50}(?:post[-\s]?funding|after\s+funding|after\s+raise)/i,
  ]);
  const currentRunway = firstRegexMatch(text, [
    /current\s+runway[^:\n]{0,30}[:\-]?\s*([^\n]{2,80})/i,
  ]);

  const fundingAmountValue = isLikelyMoneyToken(fundingAmount)
    ? (normalizeMoneyToken(fundingAmount) || fundingAmount)
    : undefined;
  return {
    fundingAmount: normalizeMetric(
      fundingAmountValue ? { value: fundingAmountValue, source: 'auto', sourceDetail: 'facts' } : undefined
    ),
    currentRunway: normalizeMetric(
      currentRunway ? { value: currentRunway.replace(/^[\s:;-]+|[\s]+$/g, ''), source: 'auto', sourceDetail: 'facts' } : undefined
    ),
    postFundingRunway: normalizeMetric(
      postFundingRunway
        ? { value: postFundingRunway.replace(/^[\s:;-]+|[\s]+$/g, ''), source: 'auto', sourceDetail: 'facts' }
        : undefined
    ),
  };
}

function mergeMetrics(existing: DiligenceMetrics | undefined, derived: DiligenceMetrics): DiligenceMetrics {
  const mergeField = (current?: DiligenceMetricValue, fallback?: DiligenceMetricValue): DiligenceMetricValue | undefined => {
    const normalizedCurrent = normalizeMetric(current);
    const normalizedFallback = normalizeMetric(fallback);

    // User-entered metrics always win when usable.
    if (normalizedCurrent?.source === 'manual' && hasUsableMetricValue(normalizedCurrent)) {
      return normalizedCurrent;
    }

    // Prefer fresh derived values over stale auto values from prior runs.
    if (hasUsableMetricValue(normalizedFallback)) {
      return normalizedFallback;
    }

    if (hasUsableMetricValue(normalizedCurrent)) {
      return normalizedCurrent;
    }

    if (normalizedCurrent?.source === 'manual' && normalizedCurrent.value) {
      return normalizedCurrent;
    }
    return normalizedCurrent || normalizedFallback;
  };

  return {
    arr: mergeField(existing?.arr, derived.arr),
    tam: mergeField(existing?.tam, derived.tam),
    marketGrowthRate: mergeField(existing?.marketGrowthRate, derived.marketGrowthRate),
    acv: mergeField(existing?.acv, derived.acv),
    yoyGrowthRate: mergeField(existing?.yoyGrowthRate, derived.yoyGrowthRate),
    fundingAmount: mergeField(existing?.fundingAmount, derived.fundingAmount),
    committed: mergeField(existing?.committed, derived.committed),
    valuation: mergeField(existing?.valuation, derived.valuation),
    dealTerms: mergeField(existing?.dealTerms, derived.dealTerms),
    lead: mergeField(existing?.lead, derived.lead),
    currentRunway: mergeField(existing?.currentRunway, derived.currentRunway),
    postFundingRunway: mergeField(existing?.postFundingRunway, derived.postFundingRunway),
    location: mergeField(existing?.location, derived.location),
  };
}

function formatSourceOfTruthMetrics(metrics?: DiligenceMetrics): string {
  const line = (label: string, metric?: DiligenceMetricValue) =>
    `- ${label}: ${metric?.value || 'Unknown'}${metric?.source ? ` (source: ${metric.source})` : ''}`;

  return `## Source of Truth Metrics
These metrics are canonical for scoring if present.
${line('ARR', metrics?.arr)}
${line('TAM', metrics?.tam)}
${line('Market Growth Rate', metrics?.marketGrowthRate)}
${line('ACV', metrics?.acv)}
${line('YoY Growth Rate', metrics?.yoyGrowthRate)}
${line('Funding Amount', metrics?.fundingAmount)}
${line('Committed', metrics?.committed)}
${line('Valuation', metrics?.valuation)}
${line('Deal Terms', metrics?.dealTerms)}
${line('Lead', metrics?.lead)}
${line('Current Runway', metrics?.currentRunway)}
${line('Post-Funding Runway', metrics?.postFundingRunway)}
${line('Location', metrics?.location)}`.trim();
}

function formatStateOfInvestorsSignal(
  sourceOfTruthMetrics?: DiligenceMetrics,
  hubspotCompanyData?: HubSpotCompanyData
): string {
  const parseNumeric = (raw?: string): number | undefined => {
    if (!raw) return undefined;
    const cleaned = raw.replace(/[$,%\s,]/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const fundingAmountRaw = sourceOfTruthMetrics?.fundingAmount?.value || hubspotCompanyData?.fundingAmount;
  const committedRaw = sourceOfTruthMetrics?.committed?.value || hubspotCompanyData?.currentCommitments;
  const leadInfo = hubspotCompanyData?.leadInformation?.trim() || 'Unknown';

  const fundingAmount = parseNumeric(fundingAmountRaw);
  const committed = parseNumeric(committedRaw);
  const commitRatio =
    fundingAmount && fundingAmount > 0 && committed !== undefined
      ? committed / fundingAmount
      : undefined;
  const commitRatioPct = commitRatio !== undefined ? `${Math.round(commitRatio * 100)}%` : 'Unknown';

  const commitmentSignal =
    commitRatio === undefined
      ? 'Unknown commitment progress'
      : commitRatio >= 0.5
        ? 'Strong (>=50% committed)'
        : commitRatio > 0
          ? 'Partial commitment (<50% committed)'
          : 'No commitments';

  return `## Deal Round Participation Signal (State of Investors)
- Funding Amount: ${fundingAmountRaw || 'Unknown'}
- Committed So Far: ${committedRaw || 'Unknown'}
- Percent of Round Committed: ${commitRatioPct}
- Commitment Signal: ${commitmentSignal}
- Lead / Investor Information: ${leadInfo}

State-of-investors rubric (apply explicitly):
- Best: >=50% committed AND a credible lead VC (or clearly strong VC participation).
- Next best: no lead yet but meaningful commitments from credible VCs.
- Weak: no commitments or only vague/unknown investor participation.
- If investor quality is unknown, reduce confidence and ask specific follow-up questions about lead and participant quality.
- Do not label this criterion strong without explicit evidence of both commitment progress and investor quality.`;
}

function formatTeamResearchSignal(teamResearch?: TeamResearch): string {
  if (!teamResearch) return '';
  const founderLines = (teamResearch.founders || [])
    .slice(0, 8)
    .map((founder) => {
      const signals = [
        founder.hasPriorExit ? 'prior exit' : undefined,
        founder.hasBeenCEO ? 'prior CEO' : undefined,
        founder.hasBeenCTO ? 'prior CTO' : undefined,
      ]
        .filter(Boolean)
        .join(', ');
      const exits = (founder.priorExits || []).filter(Boolean).slice(0, 3).join('; ');
      return `- ${founder.name}${founder.title ? ` (${founder.title})` : ''}${signals ? ` | ${signals}` : ''}${exits ? ` | exits: ${exits}` : ''}${founder.experienceSummary ? ` | notes: ${founder.experienceSummary}` : ''}`;
    })
    .join('\n');

  return `## Team Research Signal
Use this as high-priority evidence for team-quality criteria.
- Team score: ${teamResearch.teamScore ?? 'unknown'}/100
- Summary: ${teamResearch.summary || 'No summary provided'}
- Analyzed at: ${teamResearch.analyzedAt || 'unknown'}
${founderLines || '- No founder-level details captured'}

Team scoring rubric (apply explicitly for team criteria):
- Strong positive: specific prior exits and directly relevant repeat leadership in CEO/CTO roles.
- Moderate positive: partial leadership fit or strong domain depth without full role-history proof.
- Conservative: sparse, conflicting, or unverified founder evidence.
- In reasoning, explicitly state CEO-prior-CEO and CTO-prior-CTO signals when available.`;
}

function formatIndustryThesisSignal(hubspotCompanyData?: HubSpotCompanyData): string {
  const reportedIndustry =
    hubspotCompanyData?.industrySector ||
    hubspotCompanyData?.investmentSector ||
    hubspotCompanyData?.industry ||
    'Unknown';

  return `## Industry Thesis Signal
Use this rubric for industry-oriented criteria, balancing explicit sector opportunity with workflow/data/adoption fit.

Company-reported industry signal: ${reportedIndustry}

Priority spend sectors over the next decade (positive signal when fit is strong):
- Financial services
- Insurance (claims, underwriting, policy servicing)
- Healthcare administration (payer/provider back office)
- Manufacturing and supply chain
- Cybersecurity

Workflow/data/adoption thesis sectors (positive when workflow depth + proprietary data + low prior software penetration are strong):
- Construction and specialty contracting
- Banking back office operations
- Global trade and logistics operations
- Field service / offline operations (utilities, HVAC, telecom, industrial services)

General industry scoring lens:
- High: clear fit to one or more priority sectors OR strong workflow-data-adoption thesis evidence.
- Medium: adjacent/unclear sector fit but credible workflow depth and software wedge.
- Low: weak workflow depth, limited proprietary data advantage, or low evidence of durable software adoption tailwinds.
- Always cite concrete proof points (workflow complexity, data uniqueness, adoption baseline) rather than generic sector labels.`;
}

function formatLocationSignal(
  sourceOfTruthMetrics?: DiligenceMetrics,
  hubspotCompanyData?: HubSpotCompanyData
): string {
  const metricLocation = sourceOfTruthMetrics?.location?.value?.trim();
  const structuredLocation = [hubspotCompanyData?.city, hubspotCompanyData?.state, hubspotCompanyData?.country]
    .map((item) => (item || '').trim())
    .filter(Boolean)
    .join(', ');
  const effectiveLocation = metricLocation || structuredLocation || 'Unknown';
  const country = (hubspotCompanyData?.country || effectiveLocation).toLowerCase();
  const isRemote = /remote/.test(effectiveLocation.toLowerCase());
  const locationBand =
    isRemote
      ? 'Remote (acceptable but lower conviction than specific U.S. location)'
      : /united states|usa|u\.s\.|us\b/.test(country)
        ? 'U.S. based (preferred)'
        : /canada/.test(country)
          ? 'Canada based (usually investable)'
          : effectiveLocation === 'Unknown'
            ? 'Unknown location'
            : 'Outside U.S./Canada (typically non-investable)';

  return `## Location Signal
- Effective location: ${effectiveLocation}
- Location band: ${locationBand}

Location rubric for scoring:
- Best: clearly U.S.-based with a specific operating location.
- Next best: Canada.
- Decent: remote/distributed (if other fundamentals are strong), but generally below a clear U.S. operating base.
- Weak: outside U.S./Canada for this fund mandate.
- If location is unclear, lower confidence and request explicit HQ + core operating footprint.`;
}

function formatMarketGrowthSignal(
  intel?: ExternalMarketIntelligence,
  sourceOfTruthMetrics?: DiligenceMetrics
): string {
  const explicitMetric = sourceOfTruthMetrics?.marketGrowthRate?.value;
  const estimatedCagr = explicitMetric || intel?.marketGrowth?.estimatedCagr || 'unknown';
  const growthBand = deriveMarketGrowthBand(estimatedCagr);
  const confidence = normalizeConfidencePercent(intel?.marketGrowth?.confidence);
  const evidence = (intel?.marketGrowth?.evidence || []).filter(Boolean).slice(0, 4).join(' | ');
  const summary = intel?.marketGrowth?.summary || 'No market growth summary available.';

  return `## Market Growth Signal
Use this for criteria like "Market Growth" and "How quickly/slowly is the market growing?"
- Estimated CAGR / annual growth: ${estimatedCagr}
- Growth band: ${growthBand}
- Confidence: ${confidence}/100
- Evidence: ${evidence || 'No direct growth evidence captured'}
- Summary: ${summary}

Market growth rubric:
- High growth: >=20% annualized growth.
- Moderate growth: 8%-19% annualized growth.
- Low growth: 0%-7% annualized growth.
- Unknown: insufficient evidence; score conservatively and lower confidence.`;
}

function formatPortfolioSynergySignal(portfolioSynergyResearch?: PortfolioSynergyResearch): string {
  if (!portfolioSynergyResearch) return '';
  const matchLines = (portfolioSynergyResearch.matches || [])
    .slice(0, 8)
    .map(
      (match) =>
        `- ${match.companyName} (${match.synergyType}): ${match.rationale}`
    )
    .join('\n');

  return `## Mudita Portfolio Synergy Signal
Use this for criteria like "Are there synergies with the Mudita portfolio?"
- Synergy score: ${portfolioSynergyResearch.synergyScore ?? 'unknown'}/100
- Summary: ${portfolioSynergyResearch.summary || 'No summary provided'}
- Source: ${portfolioSynergyResearch.sourceUrl || 'Unknown'}
- Analyzed at: ${portfolioSynergyResearch.analyzedAt || 'unknown'}
${matchLines || '- No portfolio matches identified'}

Synergy rubric:
- High: clear, practical opportunities across similar space, similar customer base, or complementary offering partnerships.
- Medium: thematic overlap exists but practical GTM/product partnership path is weaker.
- Low: limited meaningful overlap or unclear practical collaboration pathways.
- Always cite specific portfolio company examples in reasoning when available.`;
}

function formatProblemNecessitySignal(problemNecessityResearch?: ProblemNecessityResearch): string {
  if (!problemNecessityResearch) return '';
  const topSignals = (problemNecessityResearch.topSignals || [])
    .slice(0, 6)
    .map((signal) => `- ${signal.label} (${signal.strength || 'n/a'}): ${signal.evidence}`)
    .join('\n');
  const counterSignals = (problemNecessityResearch.counterSignals || [])
    .slice(0, 6)
    .map((signal) => `- ${signal.label} (${signal.strength || 'n/a'}): ${signal.evidence}`)
    .join('\n');

  return `## Problem Necessity Signal (Vitamin / Advil / Vaccine)
Use this for criteria like "How necessary is the problem they are solving?"
- Necessity score: ${problemNecessityResearch.necessityScore ?? 'unknown'}/100
- Classification: ${problemNecessityResearch.classification || 'unknown'}
- Summary: ${problemNecessityResearch.summary || 'No summary provided'}
- Analyzed at: ${problemNecessityResearch.analyzedAt || 'unknown'}

Top necessity signals:
${topSignals || '- none'}

Counter-signals:
${counterSignals || '- none'}

Rubric:
- Vaccine: mandated / existential / severe consequence of inaction.
- Advil: acute, recurring, must-fix pain with clear downside.
- Vitamin: nice-to-have optimization without urgent downside.
- If evidence is sparse, lower confidence and avoid over-classifying as vaccine.`;
}

function formatHubSpotCompanyData(hubspotCompanyData?: HubSpotCompanyData): string {
  if (!hubspotCompanyData) return '';
  return `## FOUNDER-PROVIDED COMPANY DATA (HubSpot company intake)
Treat the following fields as founder-provided inputs from intake forms. Use them as strong signals, cross-check against materials when possible, and flag material discrepancies.
- Company Name: ${hubspotCompanyData.name || 'Unknown'}
- Domain: ${hubspotCompanyData.domain || 'Unknown'}
- Website: ${hubspotCompanyData.website || 'Unknown'}
- Industry/Sector: ${hubspotCompanyData.industrySector || hubspotCompanyData.industry || 'Unknown'}
- Investment Sector: ${hubspotCompanyData.investmentSector || 'Unknown'}
- Product Categorization: ${hubspotCompanyData.productCategorization || 'Unknown'}
- Funding Stage: ${hubspotCompanyData.fundingStage || 'Unknown'}
- Funding Amount: ${hubspotCompanyData.fundingAmount || 'Unknown'}
- Funding Terms/Valuation: ${hubspotCompanyData.fundingValuation || 'Unknown'}
- Current Commitments: ${hubspotCompanyData.currentCommitments || 'Unknown'}
- TAM Range: ${hubspotCompanyData.tamRange || 'Unknown'}
- Current Runway: ${hubspotCompanyData.currentRunway || 'Unknown'}
- Planned Runway Post-Funding: ${hubspotCompanyData.postFundingRunway || 'Unknown'}
- Annual Revenue: ${hubspotCompanyData.annualRevenue || 'Unknown'}
- Employees: ${hubspotCompanyData.numberOfEmployees || 'Unknown'}
- Founded Year: ${hubspotCompanyData.foundedYear || 'Unknown'}
- Location: ${[hubspotCompanyData.city, hubspotCompanyData.state, hubspotCompanyData.country].filter(Boolean).join(', ') || 'Unknown'}
- LinkedIn: ${hubspotCompanyData.linkedinUrl || 'Unknown'}
- Lead Information: ${hubspotCompanyData.leadInformation || 'Unknown'}
- Additional Founder Notes: ${hubspotCompanyData.anythingElse || 'None provided'}
- Founder Description: ${hubspotCompanyData.description || 'Not provided'}
- Pitch Deck URL: ${hubspotCompanyData.pitchDeckUrl || 'Not provided'}

Instructions:
- Use TAM, runway, funding stage, funding amount, commitments, and valuation directly in relevant scoring criteria.
- Treat Founder Description as high-quality founder context when interpreting product, customer, and GTM.
- If intake data and document evidence conflict, explicitly call out the discrepancy and lower confidence.
- Do not ignore intake data when document coverage is sparse.`.trim();
}

interface CriterionContext {
  category: string;
  criterion: string;
  snippets: Array<{
    source: string;
    excerpt: string;
    relevance: number;
  }>;
}

type CriteriaCategory = DiligenceCriteria['categories'][number];

function clampScore(value: unknown, fallback = 50): number {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numericValue)));
}

function applyInsufficientEvidencePolicy(
  criterion: CriterionScore,
  criterionConfig?: { insufficientEvidenceCap?: number }
): CriterionScore {
  const cap = clampScore(criterionConfig?.insufficientEvidenceCap, 60);
  let adjustedScore = criterion.score;

  if (criterion.evidenceStatus === 'unknown') {
    adjustedScore = Math.min(adjustedScore, cap);
  } else if (criterion.evidenceStatus === 'contradicted') {
    adjustedScore = Math.min(adjustedScore, 40);
  } else if (
    criterion.evidenceStatus === 'weakly_supported' &&
    (criterion.evidence.length === 0 || criterion.evidence[0] === 'No direct evidence cited.')
  ) {
    adjustedScore = Math.min(adjustedScore, Math.min(70, cap + 10));
  }

  return {
    ...criterion,
    score: adjustedScore,
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
}

function toDisplayList(value: unknown, fallback = 'Not specified'): string {
  if (Array.isArray(value)) {
    const cleaned = value
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
    return cleaned.length > 0 ? cleaned.join(', ') : fallback;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

function truncateForPrompt(value: string, maxChars: number): string {
  if (!value) return '';
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[... truncated for token limits ...]`;
}

function normalizeEvidenceStatus(value: unknown): EvidenceStatus {
  if (value === 'supported' || value === 'weakly_supported' || value === 'unknown' || value === 'contradicted') {
    return value;
  }
  return 'unknown';
}

function normalizeKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTokenLimitError(error: unknown): boolean {
  const message = String((error as any)?.message || '');
  const code = String((error as any)?.code || '');
  return (
    code === 'rate_limit_exceeded' ||
    message.includes('Request too large') ||
    message.includes('tokens per min') ||
    message.includes('TPM')
  );
}

async function callOpenAIJson(
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.2,
  maxAttempts = 3
): Promise<any> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature,
      });
      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('No response from OpenAI');
      return JSON.parse(content);
    } catch (error) {
      lastError = error;
      if (!isTokenLimitError(error) || attempt === maxAttempts) {
        throw error;
      }
      const waitMs = 4000 * attempt;
      console.warn(`OpenAI token/rate limit hit, retrying in ${waitMs}ms (attempt ${attempt}/${maxAttempts})`);
      await sleep(waitMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('OpenAI call failed');
}

function findBestNamedMatch<T extends Record<string, any>>(
  items: T[],
  primaryField: string,
  targetName: string
): T | undefined {
  if (!Array.isArray(items) || items.length === 0) return undefined;

  const targetKey = normalizeKey(targetName);
  if (!targetKey) return undefined;

  const exact = items.find(item => item?.[primaryField] === targetName);
  if (exact) return exact;

  const normalizedExact = items.find(item => normalizeKey(item?.[primaryField]) === targetKey);
  if (normalizedExact) return normalizedExact;

  const contains = items.find(item => {
    const itemKey = normalizeKey(item?.[primaryField]);
    return itemKey.includes(targetKey) || targetKey.includes(itemKey);
  });
  if (contains) return contains;

  return undefined;
}

function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 4);
}

function buildCriterionKeywords(categoryName: string, criterionName: string, criterionDescription: string): string[] {
  const stopWords = new Set([
    'this', 'that', 'with', 'from', 'into', 'about', 'their', 'there', 'which', 'while', 'where',
    'score', 'scoring', 'criteria', 'guidance', 'against', 'startup', 'company', 'companies'
  ]);
  const tokens = tokenizeText(`${categoryName} ${criterionName} ${criterionDescription}`);
  return Array.from(new Set(tokens.filter(token => !stopWords.has(token))));
}

function scoreSnippetForCriterion(snippetText: string, keywords: string[]): number {
  if (!snippetText.trim() || keywords.length === 0) return 0;
  const lower = snippetText.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (lower.includes(keyword)) score += 1;
  }
  const hasNumericEvidence = /\$?\d+[kmb%]?/i.test(snippetText);
  if (hasNumericEvidence) score += 0.5;
  return score;
}

function buildCriterionContexts(
  criteria: DiligenceCriteria,
  documents: ScoringDocument[],
  extractedFacts: string
): CriterionContext[] {
  const snippets: Array<{ source: string; excerpt: string }> = [];
  const maxSnippetsPerDocument = 25;
  const maxSnippetLength = 320;

  snippets.push({
    source: 'Extracted Company Facts',
    excerpt: extractedFacts.slice(0, 12000),
  });

  for (const doc of documents) {
    const parts = doc.text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
    for (const part of parts.slice(0, maxSnippetsPerDocument)) {
      snippets.push({
        source: doc.fileName,
        excerpt: part.slice(0, maxSnippetLength),
      });
    }
  }

  const contexts: CriterionContext[] = [];

  for (const category of criteria.categories) {
    for (const criterion of category.criteria) {
      const keywords = buildCriterionKeywords(category.name, criterion.name, criterion.description);
      const ranked = snippets
        .map(snippet => ({
          ...snippet,
          relevance: scoreSnippetForCriterion(snippet.excerpt, keywords),
        }))
        .filter(snippet => snippet.relevance > 0)
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, 2);

      contexts.push({
        category: category.name,
        criterion: criterion.name,
        snippets: ranked,
      });
    }
  }

  return contexts;
}

function formatCriterionContexts(contexts: CriterionContext[]): string {
  if (contexts.length === 0) return 'No criterion-specific evidence contexts available.';

  return contexts.map(context => {
    const evidenceLines = context.snippets.length > 0
      ? context.snippets.map((snippet, idx) =>
          `${idx + 1}. [${snippet.source}] ${snippet.excerpt} (relevance: ${snippet.relevance.toFixed(1)})`
        ).join('\n')
      : '1. No direct supporting snippet found. Mark evidenceStatus as "unknown" unless other sections provide evidence.';

    return `### ${context.category} > ${context.criterion}\n${evidenceLines}`;
  }).join('\n\n');
}

function buildExternalResearchContext(documents: ScoringDocument[]): string {
  const prioritized = documents.filter(doc =>
    doc.fileName.includes('Current Web Research') ||
    doc.fileName.includes('Website Content') ||
    doc.fileName.includes('Company Description')
  );
  const fallback = prioritized.length > 0 ? prioritized : documents.slice(0, 3);

  return fallback.map(doc => `## ${doc.fileName}\n${truncateForPrompt(doc.text, 5000)}`).join('\n\n');
}

function formatExternalMarketIntelligence(intel?: ExternalMarketIntelligence): string {
  if (!intel) return 'External market intelligence not available.';
  const competitors = (intel.competitors || []).slice(0, 8).map(comp =>
    `- ${comp.name} | overlap: ${comp.overlap || 'unknown'} | raised: ${comp.fundingRaised || 'unknown'} | concern: ${comp.concernLevel || 'unknown'}${comp.rationale ? ` | ${comp.rationale}` : ''}`
  ).join('\n') || '- No competitor list available';

  return `## External Market Intelligence

### TAM/SAM/SOM (Independent vs Company Claim)
- Claimed TAM/SAM/SOM: ${intel.tamSamSom?.companyClaim?.tam || 'n/a'} / ${intel.tamSamSom?.companyClaim?.sam || 'n/a'} / ${intel.tamSamSom?.companyClaim?.som || 'n/a'}
- Independent TAM/SAM/SOM: ${intel.tamSamSom?.independentEstimate?.tam || 'n/a'} / ${intel.tamSamSom?.independentEstimate?.sam || 'n/a'} / ${intel.tamSamSom?.independentEstimate?.som || 'n/a'}
- Alignment: ${intel.tamSamSom?.comparison?.alignment || 'unknown'}
- Delta summary: ${intel.tamSamSom?.comparison?.deltaSummary || 'n/a'}
- Confidence: ${intel.tamSamSom?.comparison?.confidence ?? 'n/a'}%

### Market Growth
- Estimated growth rate (CAGR): ${intel.marketGrowth?.estimatedCagr || 'unknown'}
- Growth band: ${intel.marketGrowth?.growthBand || 'unknown'}
- Confidence: ${intel.marketGrowth?.confidence ?? 'n/a'}%
- Evidence: ${(intel.marketGrowth?.evidence || []).slice(0, 3).join(' | ') || 'n/a'}
- Summary: ${intel.marketGrowth?.summary || 'n/a'}

### Competitor Landscape
${competitors}

- Competitive threat score: ${intel.competitiveThreatScore ?? 'n/a'}/100
- External summary: ${intel.externalSummary || 'n/a'}`.trim();
}

function extractTamFromEvidenceText(text: string): string | undefined {
  const moneyRegex = /(\$?\d[\d,.]*(?:\.\d+)?\s?(?:trillion|billion|million|thousand|t|b|m|k))/gi;
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 1200);

  let best: { raw: string; value: number } | undefined;
  for (const line of lines) {
    if (!/(tam|sam|som|market\s+size|addressable\s+market|total\s+addressable)/i.test(line)) continue;
    const matches = Array.from(line.matchAll(moneyRegex)).map((m) => (m[1] || '').trim()).filter(Boolean);
    for (const raw of matches) {
      const parsed = parseMagnitudeValue(raw);
      if (!parsed) continue;
      if (!best || parsed > best.value) {
        best = { raw, value: parsed };
      }
    }
  }
  return best?.raw;
}

function extractMarketGrowthFromEvidenceText(text: string): string | undefined {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 1200);

  let bestPercent: number | undefined;
  for (const line of lines) {
    if (!/(cagr|market\s+growth|industry\s+growth|growth\s+rate|year[-\s]?over[-\s]?year)/i.test(line)) continue;
    const matches = Array.from(line.matchAll(/(\d+(?:\.\d+)?)\s*%/g)).map((m) => Number(m[1]));
    for (const pct of matches) {
      if (!Number.isFinite(pct)) continue;
      if (pct < 0 || pct > 150) continue;
      if (bestPercent === undefined || pct > bestPercent) {
        bestPercent = pct;
      }
    }
  }

  return bestPercent !== undefined ? `${Math.round(bestPercent)}%` : undefined;
}

function estimateTamFromIndustryContext(text: string):
  | { tam: string; method: string; assumptions: string[] }
  | undefined {
  const lower = text.toLowerCase();
  const heuristics: Array<{ pattern: RegExp; tam: string; method: string; assumptions: string[] }> = [
    {
      pattern: /(procurement|supply\s*chain|manufactur(ing|er)|industrial\s+software)/,
      tam: '$10B',
      method: 'Sector benchmark heuristic for procurement and industrial software markets.',
      assumptions: [
        'Primary segment aligns with industrial procurement/workflow software.',
        'Global software spend in this segment is commonly in high single-digit to low double-digit billions.',
        'Conservative midpoint benchmark selected due limited direct TAM evidence in source materials.',
      ],
    },
    {
      pattern: /(recruit(ing|ment)|hrtech|talent)/,
      tam: '$10B',
      method: 'Sector benchmark heuristic for recruitment and HR technology.',
      assumptions: [
        'Primary segment aligns with recruiting and talent workflow software.',
        'Broad HR/recruiting software spend supports multi-billion TAM range.',
        'Conservative benchmark selected due limited company-specific TAM evidence.',
      ],
    },
    {
      pattern: /(cyber|security|infosec)/,
      tam: '$150B',
      method: 'Sector benchmark heuristic for cybersecurity markets.',
      assumptions: [
        'Primary segment aligns with cybersecurity software/services.',
        'Global cybersecurity spend commonly exceeds $100B.',
        'Conservative benchmark selected due limited segment split evidence.',
      ],
    },
    {
      pattern: /(fintech|payments|lending|banking)/,
      tam: '$50B',
      method: 'Sector benchmark heuristic for fintech infrastructure and software.',
      assumptions: [
        'Primary segment aligns with fintech/payments software.',
        'Global spend on fintech software/infrastructure supports large multi-billion TAM.',
        'Conservative benchmark selected pending tighter ICP segmentation.',
      ],
    },
    {
      pattern: /(healthcare|medtech|clinical)/,
      tam: '$30B',
      method: 'Sector benchmark heuristic for healthcare software.',
      assumptions: [
        'Primary segment aligns with healthcare/clinical workflow software.',
        'Healthcare software spend supports large multi-billion TAM.',
        'Conservative benchmark selected pending narrower sub-segment data.',
      ],
    },
    {
      pattern: /(title\s+insurance|title\s+company|title\s+agent|real\s+estate\s+closing|closing\s+workflow|proptech|legaltech|property\s+transaction)/,
      tam: '$25B',
      method: 'Sector benchmark heuristic for title, real-estate closing, and property-transaction workflow software.',
      assumptions: [
        'Primary segment aligns with title and real-estate transaction operations software.',
        'U.S. title and closing workflow spend supports a large multi-billion software TAM.',
        'Conservative benchmark selected due limited direct company-specific TAM evidence.',
      ],
    },
  ];
  const hit = heuristics.find((h) => h.pattern.test(lower));
  return hit ? { tam: hit.tam, method: hit.method, assumptions: hit.assumptions } : undefined;
}

function estimateMarketGrowthFromIndustryContext(text: string): string | undefined {
  const lower = text.toLowerCase();
  const heuristics: Array<{ pattern: RegExp; growth: string }> = [
    { pattern: /(procurement|supply\s*chain|manufactur(ing|er)|industrial\s+software)/, growth: '10%' },
    { pattern: /(recruit(ing|ment)|hrtech|talent)/, growth: '10%' },
    { pattern: /(cyber|security|infosec)/, growth: '12%' },
    { pattern: /(fintech|payments|lending|banking)/, growth: '9%' },
    { pattern: /(healthcare|medtech|clinical)/, growth: '8%' },
    { pattern: /(title\s+insurance|title\s+company|title\s+agent|real\s+estate\s+closing|closing\s+workflow|proptech|legaltech|property\s+transaction)/, growth: '9%' },
  ];
  const hit = heuristics.find((h) => h.pattern.test(lower));
  return hit?.growth;
}

async function deriveExternalMarketIntelligence(
  companyName: string,
  companyUrl: string | undefined,
  extractedFacts: string,
  documents: ScoringDocument[]
): Promise<ExternalMarketIntelligence | undefined> {
  try {
    const isUnknown = (value?: string) => {
      if (!value) return true;
      const normalized = value.trim().toLowerCase();
      return !normalized || normalized === 'unknown' || normalized === 'n/a' || normalized === 'na';
    };

    const researchContext = buildExternalResearchContext(documents);
    const prompt = `Analyze external market data for ${companyName}${companyUrl ? ` (${companyUrl})` : ''}.

Use available materials to produce:
1) Independent TAM/SAM/SOM estimate and compare to company claims.
2) Real competitor list with funding and concern levels.

Return JSON only:
{
  "tamSamSom": {
    "companyClaim": { "tam": "", "sam": "", "som": "", "source": "" },
    "independentEstimate": { "tam": "", "sam": "", "som": "", "method": "", "assumptions": [""] },
    "comparison": { "alignment": "aligned|somewhat_aligned|overstated|understated|unknown", "deltaSummary": "", "confidence": 0 }
  },
  "marketGrowth": {
    "estimatedCagr": "",
    "growthBand": "high|moderate|low|unknown",
    "confidence": 0,
    "evidence": [""],
    "summary": ""
  },
  "competitors": [
    { "name": "", "overlap": "low|medium|high", "fundingRaised": "", "concernLevel": "low|medium|high", "rationale": "" }
  ],
  "competitiveThreatScore": 0,
  "externalSummary": ""
}

Extracted facts:
${truncateForPrompt(extractedFacts, 9000)}

External/web context:
${truncateForPrompt(researchContext, 16000)}

Rules:
- Be conservative if evidence is weak.
- Prefer explicit numbers and citations from provided content.
- If data is missing, mark unknown and lower confidence.
- For market growth, prefer explicit CAGR / annual growth rates from credible context; if only directional evidence exists, keep confidence low and classify growthBand conservatively.
- When direct market-size numbers are missing, provide a conservative order-of-magnitude estimate ONLY if the materials provide sufficient market/segment clues. In that case:
  - clearly label it as heuristic,
  - include explicit assumptions,
  - keep comparison confidence <= 40 unless strong support exists.
- Use "unknown" only when there is not enough information to produce even a conservative heuristic estimate.`;

    const systemPrompt = 'You are a venture market intelligence analyst. Return strict JSON only.';
    const intel = await callOpenAIJson(systemPrompt, prompt, 0.2, 2) as ExternalMarketIntelligence;
    const tamClaim = String(intel?.tamSamSom?.companyClaim?.tam || '').toLowerCase();
    const hasCompanyTamClaim = tamClaim && tamClaim !== 'unknown';
    const combinedEvidenceText = `${extractedFacts}\n${researchContext}`;
    const evidenceText = combinedEvidenceText.toLowerCase();
    const hasTamEvidence = /\b(tam|sam|som|market\s+size)\b/.test(evidenceText) && /(\$|\b\d+(\.\d+)?\s*(billion|million|trillion|b|m|k)\b)/.test(evidenceText);
    const deterministicTam = extractTamFromEvidenceText(combinedEvidenceText);
    const heuristicTam = estimateTamFromIndustryContext(combinedEvidenceText);
    const marketGrowthFromEvidence = firstRegexMatch(`${extractedFacts}\n${researchContext}`, [
      /market\s+growth[^0-9]{0,20}(\d+(?:\.\d+)?%)/i,
      /(\d+(?:\.\d+)?%)\s*(?:cagr|annual\s+growth|market\s+growth|industry\s+growth)/i,
    ]) || extractMarketGrowthFromEvidenceText(combinedEvidenceText);
    intel.marketGrowth = intel.marketGrowth || {};
    if (!intel.marketGrowth.estimatedCagr && marketGrowthFromEvidence) {
      intel.marketGrowth.estimatedCagr = marketGrowthFromEvidence;
    }
    intel.marketGrowth.growthBand =
      intel.marketGrowth.growthBand || deriveMarketGrowthBand(intel.marketGrowth.estimatedCagr);
    intel.marketGrowth.confidence = normalizeConfidencePercent(intel.marketGrowth.confidence);
    intel.marketGrowth.evidence = Array.isArray(intel.marketGrowth.evidence)
      ? intel.marketGrowth.evidence.filter(Boolean).slice(0, 5)
      : [];
    if (!intel.marketGrowth.summary) {
      intel.marketGrowth.summary = intel.marketGrowth.estimatedCagr
        ? `Estimated market growth is ${intel.marketGrowth.estimatedCagr} (${intel.marketGrowth.growthBand} growth band).`
        : 'Insufficient evidence to estimate market growth rate confidently.';
    }

    if (!hasCompanyTamClaim && !hasTamEvidence && intel?.tamSamSom?.independentEstimate) {
      intel.tamSamSom.independentEstimate.tam = 'unknown';
      intel.tamSamSom.independentEstimate.sam = 'unknown';
      intel.tamSamSom.independentEstimate.som = 'unknown';
      intel.tamSamSom.independentEstimate.method = 'Insufficient evidence in provided materials/context.';
      intel.tamSamSom.independentEstimate.assumptions = ['No reliable TAM/SAM/SOM evidence found in current inputs.'];
      if (intel.tamSamSom.comparison) {
        intel.tamSamSom.comparison.confidence = 0;
        intel.tamSamSom.comparison.alignment = 'unknown';
      }
    }

    const independentTamUnknown = isUnknown(intel?.tamSamSom?.independentEstimate?.tam);

    // Fallback pass: when independent TAM is unknown but we have at least some TAM signal,
    // ask for a conservative heuristic estimate with explicit assumptions.
    if (independentTamUnknown) {
      try {
        const fallbackPrompt = `You are estimating an independent TAM for ${companyName}${companyUrl ? ` (${companyUrl})` : ''}.

Goal:
- Produce a conservative independent TAM/SAM/SOM estimate even when direct external numbers are sparse,
- BUT only if there is enough contextual signal from the provided materials.

Return JSON only:
{
  "tam": "",
  "sam": "",
  "som": "",
  "method": "",
  "assumptions": [""],
  "confidence": 0
}

Guidance:
- If precise values are unavailable, provide order-of-magnitude estimates (e.g., "$8B", "$10B-$15B").
- Keep confidence conservative (<=40) for heuristic estimates.
- If there is truly insufficient signal, return tam/sam/som as "unknown" with method explaining why.
- Do not copy founder TAM blindly; provide a sanity-checked independent view.

Founder/company TAM context:
${intel?.tamSamSom?.companyClaim?.tam || 'unknown'}

Extracted facts:
${truncateForPrompt(extractedFacts, 9000)}

External/web context:
${truncateForPrompt(researchContext, 16000)}`;

        const fallback = await callOpenAIJson(
          'You are a conservative venture market sizing analyst. Return strict JSON only.',
          fallbackPrompt,
          0.15,
          2
        ) as {
          tam?: string;
          sam?: string;
          som?: string;
          method?: string;
          assumptions?: string[];
          confidence?: number;
        };

        if (!isUnknown(fallback?.tam)) {
          intel.tamSamSom = intel.tamSamSom || {};
          intel.tamSamSom.independentEstimate = {
            tam: fallback.tam || 'unknown',
            sam: fallback.sam || 'unknown',
            som: fallback.som || 'unknown',
            method: fallback.method || 'Heuristic TAM triangulation fallback from available context.',
            assumptions: Array.isArray(fallback.assumptions)
              ? fallback.assumptions.filter(Boolean).slice(0, 6)
              : ['Heuristic estimate due to sparse direct market-size evidence.'],
          };
          intel.tamSamSom.comparison = intel.tamSamSom.comparison || {
            alignment: 'unknown',
            deltaSummary: 'Independent estimate generated via fallback triangulation.',
            confidence: 0,
          };
          const normalizedFallbackConfidence = normalizeConfidencePercent(fallback?.confidence);
          const boundedConfidence = Math.min(
            40,
            normalizedFallbackConfidence > 0 ? normalizedFallbackConfidence : 30
          );
          const founderTamRaw = intel?.tamSamSom?.companyClaim?.tam;
          const alignment = deriveTamAlignment(
            founderTamRaw,
            fallback.tam,
            intel.tamSamSom.comparison.alignment
          );
          intel.tamSamSom.comparison = {
            ...intel.tamSamSom.comparison,
            alignment,
            confidence: boundedConfidence,
            deltaSummary: intel.tamSamSom.comparison.deltaSummary ||
              'Independent estimate generated via conservative fallback triangulation.',
          };
        }
      } catch (fallbackError) {
        console.warn('TAM fallback estimation pass failed:', fallbackError);
      }
    }

    // Deterministic fallback from retrieved evidence text when LLM output is still unknown.
    const deterministicTamValue = parseMagnitudeValue(deterministicTam);
    const deterministicTamLooksTooSmall =
      deterministicTamValue !== undefined && deterministicTamValue < 50_000_000;

    if (isUnknown(intel?.tamSamSom?.independentEstimate?.tam) && deterministicTam && !deterministicTamLooksTooSmall) {
      intel.tamSamSom = intel.tamSamSom || {};
      intel.tamSamSom.independentEstimate = {
        tam: deterministicTam,
        sam: intel.tamSamSom?.independentEstimate?.sam || 'unknown',
        som: intel.tamSamSom?.independentEstimate?.som || 'unknown',
        method: 'Deterministic extraction from external research snippets (market-size evidence).',
        assumptions: ['Estimated from available external snippets containing TAM/market-size signals.'],
      };
      intel.tamSamSom.comparison = {
        alignment: deriveTamAlignment(
          intel?.tamSamSom?.companyClaim?.tam,
          deterministicTam,
          intel?.tamSamSom?.comparison?.alignment
        ),
        deltaSummary: intel?.tamSamSom?.comparison?.deltaSummary || 'Derived from market-size evidence in external snippets.',
        confidence: Math.max(20, normalizeConfidencePercent(intel?.tamSamSom?.comparison?.confidence || 0)),
      };
    }

    if (isUnknown(intel?.tamSamSom?.independentEstimate?.tam) && heuristicTam) {
      intel.tamSamSom = intel.tamSamSom || {};
      intel.tamSamSom.independentEstimate = {
        tam: heuristicTam.tam,
        sam: intel.tamSamSom?.independentEstimate?.sam || 'unknown',
        som: intel.tamSamSom?.independentEstimate?.som || 'unknown',
        method: heuristicTam.method,
        assumptions: heuristicTam.assumptions,
      };
      intel.tamSamSom.comparison = {
        alignment: deriveTamAlignment(
          intel?.tamSamSom?.companyClaim?.tam,
          heuristicTam.tam,
          intel?.tamSamSom?.comparison?.alignment
        ),
        deltaSummary: intel?.tamSamSom?.comparison?.deltaSummary || 'Derived from sector benchmark heuristic.',
        confidence: Math.max(15, normalizeConfidencePercent(intel?.tamSamSom?.comparison?.confidence || 0)),
      };
    }

    if (isUnknown(intel.marketGrowth?.estimatedCagr)) {
      const deterministicGrowth = extractMarketGrowthFromEvidenceText(combinedEvidenceText);
      if (deterministicGrowth) {
        intel.marketGrowth = {
          ...(intel.marketGrowth || {}),
          estimatedCagr: deterministicGrowth,
          growthBand: deriveMarketGrowthBand(deterministicGrowth),
          confidence: Math.max(20, normalizeConfidencePercent(intel.marketGrowth?.confidence || 0)),
          evidence: Array.from(new Set([...(intel.marketGrowth?.evidence || []), 'Derived from external research growth-rate snippets.'])).slice(0, 5),
          summary: intel.marketGrowth?.summary || `Estimated market growth is ${deterministicGrowth} from external research snippets.`,
        };
      }
    }

    if (isUnknown(intel.marketGrowth?.estimatedCagr)) {
      const heuristicGrowth = estimateMarketGrowthFromIndustryContext(combinedEvidenceText);
      if (heuristicGrowth) {
        intel.marketGrowth = {
          ...(intel.marketGrowth || {}),
          estimatedCagr: heuristicGrowth,
          growthBand: deriveMarketGrowthBand(heuristicGrowth),
          confidence: Math.max(15, normalizeConfidencePercent(intel.marketGrowth?.confidence || 0)),
          evidence: Array.from(new Set([...(intel.marketGrowth?.evidence || []), 'Derived from sector-level growth heuristic.'])).slice(0, 5),
          summary:
            intel.marketGrowth?.summary ||
            `Estimated market growth is ${heuristicGrowth} based on sector-level benchmark heuristics.`,
        };
      }
    }

    return intel;
  } catch (error) {
    console.warn('External market intelligence pass failed, continuing without it.');
    return undefined;
  }
}

async function summarizeCategorizedNotesForScoring(
  companyName: string,
  categorizedNotes: CategorizedNoteInput[]
): Promise<CategorizedNoteInput[]> {
  const longNotes = categorizedNotes.filter(note => (note.content || '').length > 1400);
  if (longNotes.length === 0) return categorizedNotes;

  try {
    const payload = longNotes.map(note => ({
      id: note.id,
      category: note.category,
      content: note.content.slice(0, 12000),
    }));

    const prompt = `Summarize long investor notes for scoring context on ${companyName}.
These may include call transcripts or verbose notes. Preserve only scoring-relevant details.

Return JSON:
{
  "summaries": [
    {
      "id": "note id",
      "summary": "3-6 bullet points with concrete facts, metrics, claims, concerns, and missing evidence"
    }
  ]
}

Input notes:
${JSON.stringify(payload)}`;

    const summaryJson = await callOpenAIJson(
      'You are an investment analyst assistant. Summarize notes without changing factual meaning. Return JSON only.',
      prompt,
      0.2,
      2
    );

    const summaryMap = new Map<string, string>(
      (Array.isArray(summaryJson?.summaries) ? summaryJson.summaries : [])
        .map((item: any): [string, string] => [String(item?.id || ''), String(item?.summary || '').trim()])
        .filter(([id, summary]: [string, string]) => Boolean(id && summary))
    );

    return categorizedNotes.map(note =>
      summaryMap.has(note.id)
        ? { ...note, content: summaryMap.get(note.id)! }
        : note
    );
  } catch {
    return categorizedNotes;
  }
}

function applyExternalMarketPenalties(
  categories: CategoryScore[],
  intel?: ExternalMarketIntelligence
): CategoryScore[] {
  if (!intel) return categories;

  const competitiveThreat = clampScore(intel.competitiveThreatScore, 50);
  const threatPenalty = competitiveThreat >= 80 ? 8 : competitiveThreat >= 65 ? 4 : 0;
  const totalMarketPenalty = Math.min(12, threatPenalty);

  return categories.map(category => {
    if (category.category !== 'Market' && category.category !== 'Product Market Fit') {
      return category;
    }
    const categoryPenalty = category.category === 'Market'
      ? totalMarketPenalty
      : Math.round(totalMarketPenalty / 2);
    const adjustedScore = clampScore(category.score - categoryPenalty, category.score);
    return {
      ...category,
      score: adjustedScore,
      weightedScore: Number(((adjustedScore * category.weight) / 100).toFixed(2)),
    };
  });
}

function parseMagnitudeValue(raw?: string): number | undefined {
  if (!raw) return undefined;
  const text = raw.toLowerCase().replace(/,/g, '');
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*(trillion|billion|million|thousand|t|b|m|k)?/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  const unit = (match[2] || '').toLowerCase();
  if (unit === 'trillion' || unit === 't') return value * 1_000_000_000_000;
  if (unit === 'billion' || unit === 'b') return value * 1_000_000_000;
  if (unit === 'million' || unit === 'm') return value * 1_000_000;
  if (unit === 'thousand' || unit === 'k') return value * 1_000;
  return value;
}

function formatMagnitudeMoney(value?: number): string {
  if (!value || !Number.isFinite(value)) return 'unknown';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function deriveTamAlignment(
  founderTamRaw: string | undefined,
  independentTamRaw: string | undefined,
  externalAlignment?: ExternalMarketIntelligence['tamSamSom'] extends infer T
    ? T extends { comparison?: { alignment?: infer A } }
      ? A
      : never
    : never
): 'aligned' | 'somewhat_aligned' | 'overstated' | 'understated' | 'unknown' {
  const founderTam = parseMagnitudeValue(founderTamRaw);
  const independentTam = parseMagnitudeValue(independentTamRaw);
  if (founderTam && independentTam && independentTam > 0) {
    const ratio = founderTam / independentTam;
    if (ratio > 1.35) return 'overstated';
    if (ratio > 1.1) return 'somewhat_aligned';
    if (ratio < 0.65) return 'understated';
    if (ratio < 0.9) return 'somewhat_aligned';
    return 'aligned';
  }
  return externalAlignment || 'unknown';
}

function normalizeConfidencePercent(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric <= 1) return Math.max(0, Math.min(100, Math.round(numeric * 100)));
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

export async function runTamAnalysis(
  documents: { fileName: string; text: string; type: string }[],
  companyName: string,
  companyUrl?: string,
  sourceOfTruthMetrics?: DiligenceMetrics,
  hubspotCompanyData?: HubSpotCompanyData
): Promise<TamAnalysisResult> {
  const extractedFacts = await extractCompanyFacts(documents, companyName, companyUrl);
  const intel = await deriveExternalMarketIntelligence(companyName, companyUrl, extractedFacts, documents);

  const founderTamRaw =
    resolveFounderTamClaim(sourceOfTruthMetrics, hubspotCompanyData, intel) || 'unknown';
  const independentTamRaw = intel?.tamSamSom?.independentEstimate?.tam || 'unknown';
  const alignment = deriveTamAlignment(
    founderTamRaw,
    independentTamRaw,
    intel?.tamSamSom?.comparison?.alignment
  );
  const confidence = normalizeConfidencePercent(intel?.tamSamSom?.comparison?.confidence);
  const founderTamValue = parseMagnitudeValue(founderTamRaw);
  const independentTamValue = parseMagnitudeValue(independentTamRaw);
  const blendedTamValue =
    founderTamValue && independentTamValue
      ? (founderTamValue + independentTamValue) / 2
      : undefined;
  const discrepancyRatio =
    founderTamValue && independentTamValue && founderTamValue > 0 && independentTamValue > 0
      ? Math.max(founderTamValue, independentTamValue) / Math.min(founderTamValue, independentTamValue)
      : undefined;
  const method = intel?.tamSamSom?.independentEstimate?.method || 'No independent method available.';
  const assumptions = (intel?.tamSamSom?.independentEstimate?.assumptions || []).filter(Boolean).slice(0, 6);
  const marketGrowthRate = intel?.marketGrowth?.estimatedCagr || 'unknown';
  const marketGrowthBand = deriveMarketGrowthBand(marketGrowthRate);
  const marketGrowthConfidence = normalizeConfidencePercent(intel?.marketGrowth?.confidence);
  const deltaSummary =
    intel?.tamSamSom?.comparison?.deltaSummary ||
    (!independentTamValue ? 'Independent TAM estimate unavailable, so discrepancy cannot be computed yet.' : 'No delta summary available.');

  const explanation = [
    `Founder TAM: ${founderTamRaw}`,
    `Independent TAM: ${independentTamRaw}`,
    `Blended TAM (average): ${blendedTamValue ? formatMagnitudeMoney(blendedTamValue) : 'unknown (requires both TAM values)'}`,
    `Alignment: ${alignment}`,
    `Confidence: ${confidence}%`,
    discrepancyRatio !== undefined ? `Discrepancy ratio: ${discrepancyRatio.toFixed(2)}x` : 'Discrepancy ratio: unavailable',
    `Market growth estimate: ${marketGrowthRate} (${marketGrowthBand}, confidence ${marketGrowthConfidence}%)`,
    `Method: ${method}`,
    `Assumptions: ${assumptions.length > 0 ? assumptions.join('; ') : 'none provided'}`,
    `Delta summary: ${deltaSummary}`,
  ].join('\n');

  return {
    founderTam: founderTamRaw,
    independentTam: independentTamRaw,
    blendedTam: blendedTamValue ? formatMagnitudeMoney(blendedTamValue) : 'unknown',
    alignment,
    confidence,
    discrepancyRatio,
    method,
    assumptions,
    deltaSummary,
    explanation,
  };
}

function applyTamComparisonCalibration(
  categories: CategoryScore[],
  intel: ExternalMarketIntelligence | undefined,
  sourceOfTruthMetrics?: DiligenceMetrics,
  hubspotCompanyData?: HubSpotCompanyData
): CategoryScore[] {
  if (!intel) return categories;

  const founderTamRaw = resolveFounderTamClaim(sourceOfTruthMetrics, hubspotCompanyData, intel);
  const independentTamRaw = intel.tamSamSom?.independentEstimate?.tam;
  const independentMethod = intel.tamSamSom?.independentEstimate?.method || 'independent market sizing analysis';
  const independentAssumptions = (intel.tamSamSom?.independentEstimate?.assumptions || []).filter(Boolean);
  const tamDeltaSummary = intel.tamSamSom?.comparison?.deltaSummary || 'Not provided';
  const alignment = deriveTamAlignment(
    founderTamRaw,
    independentTamRaw,
    intel.tamSamSom?.comparison?.alignment
  );
  const confidencePct = normalizeConfidencePercent(intel.tamSamSom?.comparison?.confidence);

  return categories.map((category) => {
    let changed = false;
    const nextCriteria = category.criteria.map((criterion) => {
      if (!/tam/i.test(criterion.name)) return criterion;
      changed = true;
      const founderTamValue = parseMagnitudeValue(founderTamRaw);
      const independentTamValue = parseMagnitudeValue(independentTamRaw);
      const ratio =
        founderTamValue && independentTamValue && independentTamValue > 0
          ? founderTamValue / independentTamValue
          : undefined;
      const comparisonAnswer = `Founder-calculated TAM: ${founderTamRaw || 'unknown'}. AI-calculated TAM: ${independentTamRaw || 'unknown'}.`;
      const normalizedDeltaSummary =
        independentTamRaw
          ? (/no\s+tam\/sam\/som\s+data\s+available/i.test(tamDeltaSummary)
              ? 'Company-provided TAM detail is limited, so the independent estimate is used as the primary benchmark.'
              : tamDeltaSummary)
          : founderTamRaw
            ? 'Independent TAM estimate unavailable, so discrepancy cannot be computed yet.'
            : 'No founder TAM claim and no independent estimate available for comparison.';
      const cleanedMethod = trimTrailingSentencePunctuation(independentMethod.toLowerCase());
      const cleanedAssumptions = independentAssumptions
        .slice(0, 2)
        .map((item) => trimTrailingSentencePunctuation(item))
        .filter(Boolean);
      const assumptionSnippet =
        cleanedAssumptions.length > 0
          ? `Key assumptions: ${cleanedAssumptions.join('; ')}.`
          : 'Key assumptions were not explicitly provided.';
      const calibrationReason = `The founder-calculated TAM is ${founderTamRaw || 'unknown'}, while the AI-calculated independent TAM is ${
        independentTamRaw || 'unknown'
      }. The independent estimate is grounded in ${cleanedMethod}. ${assumptionSnippet} ${
        normalizedDeltaSummary || 'No additional delta summary was provided.'
      }`;
      const missingData = [...(criterion.missingData || [])];
      if (!founderTamRaw) missingData.push('Founder/deck TAM claim is missing.');
      if (!independentTamRaw) missingData.push('Independent TAM estimate is missing.');
      const uniqueMissingData = Array.from(new Set(missingData));

      // Light guardrails: enforce confidence discipline and evidence status,
      // while keeping score generation primarily driven by scoring guidance.
      let guardedConfidence = criterion.confidence ?? 55;
      let guardedEvidenceStatus = criterion.evidenceStatus;
      if (!founderTamRaw && !independentTamRaw) {
        guardedConfidence = Math.min(guardedConfidence, 40);
        guardedEvidenceStatus = 'unknown';
      } else if (!founderTamRaw || !independentTamRaw) {
        guardedConfidence = Math.min(guardedConfidence, 60);
        guardedEvidenceStatus = guardedEvidenceStatus === 'supported' ? 'weakly_supported' : guardedEvidenceStatus;
      } else {
        guardedConfidence = Math.max(guardedConfidence, Math.max(45, Math.min(90, confidencePct || guardedConfidence)));
      }
      if (ratio !== undefined && Math.max(ratio, 1 / ratio) > 5) {
        guardedConfidence = Math.min(guardedConfidence, 55);
        uniqueMissingData.push('Founder TAM and independent TAM differ materially (>5x).');
      }

      return {
        ...criterion,
        score: criterion.score,
        confidence: clampScore(guardedConfidence, criterion.confidence ?? 55),
        evidenceStatus: guardedEvidenceStatus,
        reasoning: calibrationReason,
        missingData: Array.from(new Set(uniqueMissingData)),
      };
    });

    if (!changed) return category;
    return {
      ...category,
      criteria: nextCriteria,
    };
  });
}

function applyMarketGrowthCalibration(
  categories: CategoryScore[],
  intel?: ExternalMarketIntelligence,
  sourceOfTruthMetrics?: DiligenceMetrics
): CategoryScore[] {
  const growthRate = sourceOfTruthMetrics?.marketGrowthRate?.value || intel?.marketGrowth?.estimatedCagr;
  const growthBand = deriveMarketGrowthBand(growthRate);
  const growthConfidence = normalizeConfidencePercent(intel?.marketGrowth?.confidence);
  const growthSummary = intel?.marketGrowth?.summary || 'No market growth summary available.';
  const growthEvidence = (intel?.marketGrowth?.evidence || []).filter(Boolean).slice(0, 3);
  const growthMethodDetail = (() => {
    const joined = `${growthSummary} ${growthEvidence.join(' ')}`.toLowerCase();
    if (/sector-level|heuristic|benchmark/.test(joined)) {
      return 'This estimate uses sector benchmark heuristics because direct company-specific CAGR citations are limited.';
    }
    if (/external research|snippet/.test(joined)) {
      return 'This estimate is triangulated from external market-growth references and available company context.';
    }
    return 'This estimate reflects the best available growth evidence in the current materials.';
  })();

  return categories.map((category) => {
    let changed = false;
    const nextCriteria = category.criteria.map((criterion) => {
      const isMarketGrowthCriterion =
        /market/i.test(category.category) &&
        /(market\s*growth|how\s+quickly|how\s+slowly|growth\s+rate|market\s+expan)/i.test(criterion.name);
      if (!isMarketGrowthCriterion) return criterion;
      changed = true;

      const missingData = [...(criterion.missingData || [])];
      let guardedConfidence = criterion.confidence ?? 55;
      let guardedEvidenceStatus = criterion.evidenceStatus || 'unknown';
      let adjustedScore = criterion.score;

      if (growthBand === 'unknown') {
        guardedConfidence = Math.min(guardedConfidence, 50);
        guardedEvidenceStatus = 'unknown';
        missingData.push('Reliable market growth/CAGR evidence is missing.');
      } else {
        guardedConfidence = Math.max(guardedConfidence, Math.max(45, Math.min(85, growthConfidence || guardedConfidence)));
        if (guardedEvidenceStatus === 'unknown') {
          guardedEvidenceStatus = growthEvidence.length > 0 ? 'weakly_supported' : 'unknown';
        }
        if (growthBand === 'high') {
          adjustedScore = Math.max(adjustedScore, 65);
        } else if (growthBand === 'low') {
          adjustedScore = Math.min(adjustedScore, 55);
        }
      }

      return {
        ...criterion,
        score: clampScore(adjustedScore, criterion.score),
        confidence: clampScore(guardedConfidence, criterion.confidence ?? 55),
        evidenceStatus: guardedEvidenceStatus,
        reasoning: (() => {
          const evidenceText = growthEvidence
            .slice(0, 2)
            .map((item) => trimTrailingSentencePunctuation(item))
            .filter(Boolean)
            .join('. ');
          const evidenceSentence = evidenceText
            ? `Supporting evidence includes: ${evidenceText}.`
            : 'Supporting growth-rate evidence is limited, so this estimate remains conservative.';
          return `The market growth estimate is ${growthRate || 'unknown'}, which corresponds to a ${growthBand} growth profile with ${growthConfidence}% confidence. ${growthMethodDetail} ${trimTrailingSentencePunctuation(growthSummary)}. ${evidenceSentence}`;
        })(),
        evidence: growthEvidence.length > 0 ? Array.from(new Set([...criterion.evidence, ...growthEvidence])).slice(0, 5) : criterion.evidence,
        missingData: Array.from(new Set(missingData)),
      };
    });

    if (!changed) return category;
    const recomputedScore = Math.round(
      nextCriteria.reduce((sum, criterion) => sum + criterion.score, 0) / Math.max(nextCriteria.length, 1)
    );
    return {
      ...category,
      score: recomputedScore,
      weightedScore: Number(((recomputedScore * category.weight) / 100).toFixed(2)),
      criteria: nextCriteria,
    };
  });
}

function applyTeamResearchCalibration(
  categories: CategoryScore[],
  teamResearch?: TeamResearch
): CategoryScore[] {
  if (!teamResearch) return categories;

  const founders = teamResearch.founders || [];
  const ceo = founders.find((founder) => /(^|\b)ceo(\b|$)/i.test(founder.title || ''));
  const cto = founders.find((founder) => /(^|\b)cto(\b|$)/i.test(founder.title || ''));
  const exits = founders.flatMap((founder) => founder.priorExits || []).filter(Boolean);
  const exitsText = exits.length > 0 ? exits.slice(0, 4).join('; ') : 'No verified prior exits were identified';
  const hasFounderProfileEvidence = founders.some(
    (founder) => Boolean(String(founder.linkedinUrl || '').trim()) || Boolean(String(founder.experienceSummary || '').trim())
  );
  const founderHighlights = founders
    .slice(0, 4)
    .map((founder) => {
      const signals = [
        founder.hasPriorExit ? 'prior exit' : undefined,
        founder.hasBeenCEO ? 'prior CEO' : undefined,
        founder.hasBeenCTO ? 'prior CTO' : undefined,
      ]
        .filter(Boolean)
        .join(', ');
      return `${founder.name}${founder.title ? ` (${founder.title})` : ''}${signals ? ` - ${signals}` : ''}`;
    })
    .join('; ');
  const founderRoleHistory = founders
    .map((founder) => {
      const summary = String(founder.experienceSummary || '');
      if (!summary) return '';
      const roleHistoryMatch = summary.match(/Role history:\s*([^|]+)/i);
      if (roleHistoryMatch?.[1]) {
        return `${founder.name}: ${roleHistoryMatch[1].trim()}`;
      }
      const roleAtMatch = summary.match(/\b(founder|co[-\s]?founder|ceo|cto|vp|head|director|principal|lead|engineer|architect)\s+at\s+[A-Z][A-Za-z0-9&.\- ]{1,60}/i);
      return roleAtMatch ? `${founder.name}: ${roleAtMatch[0].trim()}` : '';
    })
    .filter(Boolean)
    .slice(0, 4);
  const ceoSignal = ceo ? (ceo.hasBeenCEO ? 'yes' : 'no verified prior CEO signal') : 'unknown';
  const ctoSignal = cto ? (cto.hasBeenCTO ? 'yes' : 'no verified prior CTO signal') : 'unknown';
  const normalizeTeamSummary = (rawSummary?: string): string => {
    const trimmed = String(rawSummary || '').trim();
    if (!trimmed) return '';
    return trimmed
      .replace(/there\s+is\s+currently\s+no\s+verifiable\s+information\s+available\s+about\s+the\s+found(ing|er)\s+team[^.]*\.?/gi, '')
      .replace(/there\s+is\s+insufficient\s+information\s+available\s+about\s+the\s+found(ing|er)\s+team[^.]*\.?/gi, '')
      .replace(/no\s+founder(?:-|\s*)level\s+details\s+(captured|available)[^.]*\.?/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  };
  const normalizedTeamSummary = normalizeTeamSummary(teamResearch.summary);

  return categories.map((category) => {
    let changed = false;
    const nextCriteria = category.criteria.map((criterion) => {
      const isTeamCriterion =
        /(team|founder)/i.test(category.category) ||
        /(team|founder|ceo|cto)/i.test(criterion.name);
      if (!isTeamCriterion) return criterion;
      changed = true;

      const missingData = [...(criterion.missingData || [])];
      let guardedConfidence = criterion.confidence ?? 55;
      let guardedEvidenceStatus = criterion.evidenceStatus;
      const inlineFounderEvidenceText = `${criterion.reasoning || ''}\n${(criterion.evidence || []).join('\n')}`;
      const hasInlineFounderEvidence = /\b(founder|founding|ceo|cto|kevin|ghim|remy|rémy|tuyeras|tuyéras)\b/i.test(
        inlineFounderEvidenceText
      );
      if (founders.length === 0) {
        if (!hasInlineFounderEvidence) {
          guardedConfidence = Math.min(guardedConfidence, 45);
          guardedEvidenceStatus = 'unknown';
          missingData.push('No founder/team evidence found from team research.');
        } else {
          guardedConfidence = Math.max(guardedConfidence, 45);
          if (!guardedEvidenceStatus || guardedEvidenceStatus === 'unknown') {
            guardedEvidenceStatus = 'weakly_supported';
          }
          missingData.push('Founder evidence is present in materials but not yet externally verified.');
        }
      } else if (exits.length === 0) {
        guardedConfidence = Math.min(guardedConfidence, 75);
        if (!guardedEvidenceStatus || guardedEvidenceStatus === 'unknown') {
          guardedEvidenceStatus = 'weakly_supported';
        }
        missingData.push('No specific prior exits verified from available evidence.');
      }
      if (hasFounderProfileEvidence) {
        guardedConfidence = Math.max(guardedConfidence, 50);
        if (!guardedEvidenceStatus || guardedEvidenceStatus === 'unknown') {
          guardedEvidenceStatus = 'weakly_supported';
        }
      }

      const ceoSentence =
        ceoSignal === 'yes'
          ? 'The CEO has verified prior CEO experience.'
          : ceoSignal === 'no verified prior CEO signal'
            ? hasFounderProfileEvidence
              ? 'The CEO profile is present, but prior CEO history is not yet fully verified from accessible sources.'
              : 'No verified prior CEO experience was identified for the CEO.'
            : 'CEO prior leadership evidence is limited in current materials.';
      const ctoSentence =
        ctoSignal === 'yes'
          ? 'The CTO has verified prior CTO experience.'
          : ctoSignal === 'no verified prior CTO signal'
            ? hasFounderProfileEvidence
              ? 'The CTO profile is present, but prior CTO history is not yet fully verified from accessible sources.'
              : 'No verified prior CTO experience was identified for the CTO.'
            : 'CTO prior leadership evidence is limited in current materials.';

      const teamReason = `${normalizedTeamSummary || (hasInlineFounderEvidence ? 'Founding team context is present in company materials.' : 'Team context is available from identified founders and role history.')} ${
        founderHighlights
          ? `Founder signals include ${founderHighlights}.`
          : 'Founder-specific signal detail is limited in current materials.'
      } ${founderRoleHistory.length > 0 ? `Prior roles noted: ${founderRoleHistory.join('; ')}.` : ''} Prior exits: ${exitsText}. ${ceoSentence} ${ctoSentence}`;
      const teamEvidence = [...(criterion.evidence || [])];
      if (founderHighlights && !teamEvidence.some((line) => /founders?\s+identified/i.test(line))) {
        teamEvidence.push(`Founders identified: ${founderHighlights}.`);
      }
      if (founderRoleHistory.length > 0 && !teamEvidence.some((line) => /prior roles noted/i.test(line))) {
        teamEvidence.push(`Prior roles noted: ${founderRoleHistory.join('; ')}.`);
      }
      if (hasFounderProfileEvidence && !teamEvidence.some((line) => /founder profile/i.test(line))) {
        teamEvidence.push('Founder profile evidence is available (LinkedIn/profile background) and was incorporated.');
      }

      return {
        ...criterion,
        confidence: clampScore(guardedConfidence, criterion.confidence ?? 55),
        evidenceStatus: guardedEvidenceStatus,
        reasoning: teamReason,
        evidence: teamEvidence,
        missingData: Array.from(new Set(missingData)),
      };
    });

    if (!changed) return category;
    return {
      ...category,
      criteria: nextCriteria,
    };
  });
}

function applyPortfolioSynergyCalibration(
  categories: CategoryScore[],
  portfolioSynergyResearch?: PortfolioSynergyResearch
): CategoryScore[] {
  if (!portfolioSynergyResearch) return categories;
  const matches = portfolioSynergyResearch.matches || [];
  const similarSpace = matches.filter((m) => m.synergyType === 'similar_space').length;
  const similarCustomer = matches.filter((m) => m.synergyType === 'similar_customer').length;
  const complementary = matches.filter((m) => m.synergyType === 'complementary_offering').length;
  const topMatchesText = matches
    .slice(0, 4)
    .map((match) => {
      const type =
        match.synergyType === 'similar_space'
          ? 'similar space'
          : match.synergyType === 'similar_customer'
            ? 'similar customer'
            : 'complementary offering';
      return `${match.companyName} (${type})`;
    })
    .join('; ');

  return categories.map((category) => {
    let changed = false;
    const nextCriteria = category.criteria.map((criterion) => {
      const isSynergyCriterion =
        /(synerg|portfolio|mudita)/i.test(category.category) ||
        /(synerg|portfolio|mudita)/i.test(criterion.name);
      if (!isSynergyCriterion) return criterion;
      changed = true;
      const missingData = [...(criterion.missingData || [])];
      let guardedConfidence = criterion.confidence ?? 55;
      let guardedEvidenceStatus = criterion.evidenceStatus;

      if (matches.length === 0) {
        guardedConfidence = Math.min(guardedConfidence, 50);
        guardedEvidenceStatus = 'unknown';
        missingData.push('No concrete Mudita portfolio overlap identified yet.');
      }

      const matchMixSentence =
        matches.length > 0
          ? `Most overlap appears in ${complementary > similarSpace && complementary > similarCustomer ? 'complementary offerings' : 'a mix of similar-space and customer overlap'} relationships.`
          : '';
      const synergyReason = `${portfolioSynergyResearch.summary || 'No portfolio-synergy summary was provided.'} ${
        topMatchesText
          ? `Specific portfolio examples include ${topMatchesText}.`
          : 'No specific portfolio company overlaps were identified in current evidence.'
      } ${matchMixSentence}`.trim();

      return {
        ...criterion,
        confidence: clampScore(guardedConfidence, criterion.confidence ?? 55),
        evidenceStatus: guardedEvidenceStatus,
        reasoning: synergyReason,
        missingData: Array.from(new Set(missingData)),
      };
    });

    if (!changed) return category;
    return {
      ...category,
      criteria: nextCriteria,
    };
  });
}

function applyProblemNecessityCalibration(
  categories: CategoryScore[],
  problemNecessityResearch?: ProblemNecessityResearch
): CategoryScore[] {
  if (!problemNecessityResearch) return categories;
  const topSignals = problemNecessityResearch.topSignals || [];
  const counterSignals = problemNecessityResearch.counterSignals || [];
  const necessityClassRaw = problemNecessityResearch.classification || 'unknown';
  const necessityClass = necessityClassRaw
    ? necessityClassRaw.charAt(0).toUpperCase() + necessityClassRaw.slice(1)
    : 'Unknown';
  const topSignalsText = topSignals
    .slice(0, 3)
    .map((signal) => `${signal.label}${signal.strength ? ` (${signal.strength})` : ''}${signal.evidence ? `: ${signal.evidence}` : ''}`)
    .join(' ');
  const counterSignalsText = counterSignals
    .slice(0, 2)
    .map((signal) => `${signal.label}${signal.strength ? ` (${signal.strength})` : ''}${signal.evidence ? `: ${signal.evidence}` : ''}`)
    .join(' ');
  const summarySentence = problemNecessityResearch.summary?.trim()
    ? problemNecessityResearch.summary.trim()
    : 'No dedicated necessity summary was produced.';

  return categories.map((category) => {
    let changed = false;
    const nextCriteria = category.criteria.map((criterion) => {
      const isNecessityCriterion =
        /(necess|vitamin|advil|vaccine)/i.test(category.category) ||
        /(necess|vitamin|advil|vaccine|problem\s+they\s+are\s+solving)/i.test(criterion.name);
      if (!isNecessityCriterion) return criterion;
      changed = true;
      const missingData = [...(criterion.missingData || [])];
      let guardedConfidence = criterion.confidence ?? 55;
      let guardedEvidenceStatus = criterion.evidenceStatus;

      if (topSignals.length === 0) {
        guardedConfidence = Math.min(guardedConfidence, 50);
        guardedEvidenceStatus = 'unknown';
        missingData.push('No concrete necessity signals identified yet.');
      }
      if (problemNecessityResearch.classification === 'vaccine' && topSignals.length < 2) {
        guardedConfidence = Math.min(guardedConfidence, 65);
        missingData.push('Vaccine classification has limited supporting signals.');
      }

      const calibrationReason = `Problem necessity is classified as ${necessityClass}. ${summarySentence} ${
        topSignalsText
          ? `Primary demand signals include ${topSignalsText}.`
          : 'No concrete positive demand signals were identified from current materials.'
      } ${
        counterSignalsText
          ? `Counter-signals include ${counterSignalsText}.`
          : 'No major counter-signals were identified in the current evidence set.'
      }`;

      return {
        ...criterion,
        confidence: clampScore(guardedConfidence, criterion.confidence ?? 55),
        evidenceStatus: guardedEvidenceStatus,
        reasoning: calibrationReason,
        missingData: Array.from(new Set(missingData)),
      };
    });

    if (!changed) return category;
    return {
      ...category,
      criteria: nextCriteria,
    };
  });
}

function applyFundingRaiseGuard(
  categories: CategoryScore[],
  sourceOfTruthMetrics?: DiligenceMetrics,
  extractedFacts?: string,
  userNotes?: string,
  rawDocumentContext?: string
): CategoryScore[] {
  const hasFundingMetric = hasUsableMetricValue(sourceOfTruthMetrics?.fundingAmount);
  const combinedContext = `${extractedFacts || ''}\n${userNotes || ''}\n${rawDocumentContext || ''}`.toLowerCase();
  const hasExplicitRaiseSignal = /(raise\s+amount|raising\s+\$|funding\s+amount|funding\s+sought|seeking\s+to\s+raise|round\s+(size|amount)|we\s+are\s+raising|currently\s+raising)/i.test(
    combinedContext
  );
  if (hasFundingMetric || hasExplicitRaiseSignal) return categories;

  return categories.map((category) => ({
    ...category,
    criteria: category.criteria.map((criterion) => {
      const isDealTermsLike =
        /(deal\s+terms|state\s+of\s+investors|investor\s+state|funding\s+round)/i.test(
          `${category.category} ${criterion.name}`
        );
      if (!isDealTermsLike) return criterion;

      const reasoningRaw = criterion.reasoning || '';
      const sentenceFiltered = reasoningRaw
        .split(/(?<=[.?!])\s+/)
        .filter((sentence) => !/\$\s*\d[\d,.]*(?:\s*(?:k|m|b|thousand|million|billion))?.*\b(raise|raising|round|seed|series)\b/i.test(sentence))
        .join(' ')
        .trim();
      const sanitizedReasoning = (sentenceFiltered || 'Deal terms are unclear due to missing valuation and investor commitment data.')
        .replace(
          /\b(the\s+company|they|it)\s+is\s+raising(?:\s+a)?\s+\$?\s*\d[\d,.]*(?:\s*(?:k|m|b|thousand|million|billion))?/gi,
          'No explicit raise amount is evidenced in the provided materials'
        )
        .replace(
          /\braising\s+\$?\s*\d[\d,.]*(?:\s*(?:k|m|b|thousand|million|billion))?/gi,
          'no explicit raise amount is evidenced'
        )
        .replace(
          /\bthe\s+\$?\s*\d[\d,.]*(?:\s*(?:k|m|b|thousand|million|billion))?\s+(seed|series\s*[a-z]|funding)\s+round\b/gi,
          'No explicit raise amount is evidenced in the provided materials'
        );

      const missingData = Array.from(
        new Set([...(criterion.missingData || []), 'No explicit raise amount evidence in notes/documents.'])
      );

      return {
        ...criterion,
        reasoning: `${sanitizedReasoning} Funding amount should be treated as unknown unless an explicit raise statement is provided.`.trim(),
        missingData,
      };
    }),
  }));
}

function applyEarlyTractionCalibration(
  categories: CategoryScore[],
  extractedFacts?: string,
  userNotes?: string,
  rawDocumentContext?: string
): CategoryScore[] {
  const context = `${extractedFacts || ''}\n${userNotes || ''}\n${rawDocumentContext || ''}`;
  const hasPilotSignal = /\b(paid\s+pilot|pilot\s+in\s+negotiation|pilot|poc|proof[-\s]?of[-\s]?concept)\b/i.test(context);
  const hasMouSignal = /\b(signed\s+mou|mou|memorandum\s+of\s+understanding)\b/i.test(context);
  const qualifiedOppsMatch = context.match(/\b(\d+)\s+quali\w*ed\s+opportunit/i);
  const hasDeveloperAdoptionSignal = /\b(\d{2,4}\+?\s+active\s+developers?|2,?000\+?\s+total\s+engagements?)\b/i.test(context);
  if (!hasPilotSignal && !hasMouSignal && !qualifiedOppsMatch && !hasDeveloperAdoptionSignal) {
    return categories;
  }

  const tractionEvidence: string[] = [];
  if (qualifiedOppsMatch?.[1]) tractionEvidence.push(`${qualifiedOppsMatch[1]} qualified opportunities mentioned.`);
  if (hasPilotSignal) tractionEvidence.push('Pilot/POC traction is explicitly mentioned.');
  if (hasMouSignal) tractionEvidence.push('Signed MOU/partnership signal is explicitly mentioned.');
  if (hasDeveloperAdoptionSignal) tractionEvidence.push('Developer adoption/community traction signal is present.');
  const tractionSummary = tractionEvidence.join(' ');

  return categories.map((category) => ({
    ...category,
    criteria: category.criteria.map((criterion) => {
      const key = `${category.category} ${criterion.name}`;
      const isTractionLike = /(contracted\s+arr|arr|revenue|traction|customers|commercial)/i.test(key);
      if (!isTractionLike) return criterion;

      const nextScore = Math.max(criterion.score ?? 0, 30);
      const nextConfidence = Math.max(criterion.confidence ?? 0, 45);
      const nextEvidenceStatus =
        criterion.evidenceStatus === 'supported' || criterion.evidenceStatus === 'weakly_supported'
          ? criterion.evidenceStatus
          : 'weakly_supported';
      const nextEvidence = Array.from(new Set([...(criterion.evidence || []), ...tractionEvidence]));
      const nextReasoning = `${criterion.reasoning || ''} Early traction signals are present in materials (${tractionSummary}), so this should not be treated as zero commercial signal even if ARR is not yet disclosed.`.trim();

      return {
        ...criterion,
        score: nextScore,
        confidence: nextConfidence,
        evidenceStatus: nextEvidenceStatus,
        evidence: nextEvidence,
        reasoning: nextReasoning,
      };
    }),
  }));
}

/**
 * Truncate documents to fit within token limits
 * Prioritizes deck > financial > legal > other documents
 */
function truncateDocuments(
  documents: { fileName: string; text: string; type: string }[],
  maxChars: number
): { fileName: string; text: string; type: string }[] {
  const totalChars = documents.reduce((sum, doc) => sum + doc.text.length, 0);
  
  if (totalChars <= maxChars) {
    return documents; // No truncation needed
  }
  
  console.log(`⚠️ Documents exceed ${maxChars} chars (${totalChars} total). Truncating...`);
  
  // Prioritize documents: deck > financial > other
  const priorityOrder: Record<string, number> = { deck: 1, financial: 2, legal: 3, other: 4 };
  const sortedDocs = [...documents].sort((a, b) => 
    (priorityOrder[a.type] || 999) - (priorityOrder[b.type] || 999)
  );
  
  // Allocate characters proportionally, but give priority docs more weight
  const result: { fileName: string; text: string; type: string }[] = [];
  let remainingChars = maxChars;
  
  for (const doc of sortedDocs) {
    if (remainingChars <= 0) break;
    
    const allocatedChars = Math.min(doc.text.length, remainingChars);
    const truncatedText = doc.text.substring(0, allocatedChars);
    
    result.push({
      ...doc,
      text: truncatedText + (allocatedChars < doc.text.length ? '\n\n[... Document truncated due to size limits ...]' : ''),
    });
    
    remainingChars -= allocatedChars;
    
    if (allocatedChars < doc.text.length) {
      console.log(`  Truncated "${doc.fileName}" from ${doc.text.length} to ${allocatedChars} chars`);
    }
  }
  
  return result;
}

/**
 * Extract structured facts from documents (First Pass)
 * This creates a compressed, structured summary that's easier for scoring
 */
async function extractCompanyFacts(
  documents: ScoringDocument[],
  companyName: string,
  companyUrl?: string,
  userNotes?: string
): Promise<string> {
  console.log('🔍 Pass 1: Extracting structured facts from documents...');
  
  const isUrlOnlyAnalysis = documents.length === 1 && documents[0].fileName === 'Company Information';
  
  // Truncate documents for extraction
  const truncatedDocs = truncateDocuments(documents, 100000);
  
  const documentsText = truncatedDocs.map(doc => 
    `### ${doc.fileName} (${doc.type})
${doc.text.slice(0, 30000)}`
  ).join('\n\n');

  const extractionPrompt = `You are extracting structured facts from investment materials for ${companyName}.

${isUrlOnlyAnalysis ? `
⚠️ CRITICAL: This is URL-only analysis. The company name is "${companyName}" and URL is "${companyUrl}".
You must identify what this SPECIFIC company actually does based on the name/URL, not generic assumptions.
Use your knowledge of this company if you have it. If you don't recognize them, indicate limited information available.
` : ''}

## Documents to Analyze:
${documentsText}

${userNotes ? `
## Investor's Initial Notes:
${userNotes}
` : ''}

## Task:
Extract ONLY factual information from the documents above into these structured categories. Be specific and cite numbers/details where available.

Return a JSON object with this structure:

\`\`\`json
{
  "companyOverview": {
    "whatTheyDo": "One clear sentence about their product/service",
    "industry": "Specific industry/sector (e.g., 'Manufacturing Software', 'Healthcare Tech')",
    "stage": "Company stage (pre-seed, seed, series A, etc.)",
    "founded": "Year if mentioned"
  },
  "problem": {
    "description": "The specific problem they're solving",
    "targetMarket": "Who has this problem",
    "painPoints": ["List", "of", "specific", "pain", "points"]
  },
  "solution": {
    "product": "What their product/service actually is",
    "approach": "How they solve the problem (technology, process, etc.)",
    "differentiation": "What makes them different from alternatives",
    "valueProposition": "The core value they deliver"
  },
  "customers": {
    "idealCustomerProfile": "Detailed ICP description",
    "targetSegments": ["Segment 1", "Segment 2"],
    "useCases": ["Primary use case", "Secondary use case"]
  },
  "traction": {
    "revenue": "MRR/ARR if mentioned (with numbers)",
    "customers": "Number of customers if mentioned",
    "growth": "Growth metrics if mentioned",
    "partnerships": ["Key partnerships if mentioned"],
    "other": "Any other traction metrics"
  },
  "team": {
    "founders": [
      {
        "name": "Founder name",
        "background": "Relevant experience",
        "linkedinUrl": "URL if mentioned"
      }
    ],
    "keyHires": "Notable team members if mentioned",
    "domainExpertise": "Team's relevant experience"
  },
  "market": {
    "tam": "TAM size if mentioned or estimable",
    "sam": "SAM if mentioned",
    "marketTrends": ["Trend 1", "Trend 2"],
    "competitors": ["Competitor 1", "Competitor 2"]
  },
  "businessModel": {
    "pricing": "Pricing model if mentioned",
    "revenueModel": "How they make money",
    "unitEconomics": "CAC, LTV, margins if mentioned"
  },
  "financials": {
    "raising": "Amount raising if mentioned",
    "valuation": "Valuation if mentioned",
    "terms": "Deal terms if mentioned",
    "runway": "Current runway if mentioned",
    "burnRate": "Monthly burn if mentioned"
  },
  "goToMarket": {
    "strategy": "Their GTM approach",
    "channels": ["Sales channels"],
    "salesCycle": "Length/complexity of sales if mentioned"
  },
  "risks": {
    "execution": ["Execution risks identified"],
    "market": ["Market risks identified"],
    "competition": ["Competitive risks identified"],
    "team": ["Team risks identified"]
  },
  "dataQuality": {
    "score": 85,
    "missingInformation": ["What's missing from the materials"]
  }
}
\`\`\`

**Rules:**
- Only include facts that are explicitly stated or clearly implied
- Use "Not mentioned" or "Unknown" if information is missing
- Include specific numbers, dates, and metrics when available
- Keep descriptions concise but specific
- Do not editorialize or score - just extract facts`;
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a document analysis expert extracting structured facts for venture capital due diligence. 
Extract only factual information - no opinions, scoring, or recommendations yet.
Be thorough but concise. Cite specific details and numbers.${isUrlOnlyAnalysis ? '\n\n⚠️ For URL-only analysis: Use your knowledge of this specific company to provide accurate facts. If you don\'t know the company, indicate limited information is available.' : ''}`
        },
        {
          role: 'user',
          content: extractionPrompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const content = response.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error('No response from fact extraction');
    }

    const facts = JSON.parse(content);

    const raisingRaw = String(facts?.financials?.raising || '').trim();
    const combinedFactContext = `${documentsText}\n${userNotes || ''}`;
    const hasExplicitRaiseSignal = /(raise\s+amount|raising\s+\$|funding\s+amount|funding\s+sought|seeking\s+to\s+raise|round\s+(size|amount)|we\s+are\s+raising|currently\s+raising)/i.test(
      combinedFactContext
    );
    const cashOnHandMatch = combinedFactContext.match(
      /cash\s+on\s+hand[^$0-9]{0,20}(\$?\s*\d[\d,]*(?:\.\d+)?\s?(?:[kmb]|thousand|million|billion)?)/i
    );
    const raisingLooksLikeCashOnHand =
      !!raisingRaw &&
      !!cashOnHandMatch?.[1] &&
      normalizeMoneyToken(raisingRaw) !== undefined &&
      normalizeMoneyToken(cashOnHandMatch[1]) !== undefined &&
      normalizeMoneyToken(raisingRaw) === normalizeMoneyToken(cashOnHandMatch[1]) &&
      !hasExplicitRaiseSignal;
    const raisingForPrompt =
      raisingLooksLikeCashOnHand || /cash\s+on\s+hand/i.test(raisingRaw)
        ? 'Not disclosed'
        : (raisingRaw || 'Not disclosed');
    
    // Format extracted facts as structured text for scoring prompt
    const formattedFacts = `
## 📊 Extracted Company Facts (Structured Analysis)

### Company Overview
- **What They Do**: ${facts.companyOverview?.whatTheyDo || 'Not specified'}
- **Industry**: ${facts.companyOverview?.industry || 'Not specified'}
- **Stage**: ${facts.companyOverview?.stage || 'Not specified'}

### Problem & Solution
- **Problem**: ${facts.problem?.description || 'Not specified'}
- **Target Market**: ${facts.problem?.targetMarket || 'Not specified'}
- **Solution**: ${facts.solution?.product || 'Not specified'}
- **Approach**: ${facts.solution?.approach || 'Not specified'}
- **Differentiation**: ${facts.solution?.differentiation || 'Not specified'}

### Customers & Market
- **Ideal Customer Profile**: ${facts.customers?.idealCustomerProfile || 'Not specified'}
- **Target Segments**: ${toDisplayList(facts.customers?.targetSegments, 'Not specified')}
- **TAM/SAM**: ${facts.market?.tam || 'Not specified'}
- **Key Competitors**: ${toDisplayList(facts.market?.competitors, 'Not specified')}

### Traction & Metrics
- **Revenue**: ${facts.traction?.revenue || 'Not disclosed'}
- **Customers**: ${facts.traction?.customers || 'Not disclosed'}
- **Growth**: ${facts.traction?.growth || 'Not disclosed'}
- **Partnerships**: ${toDisplayList(facts.traction?.partnerships, 'None mentioned')}

### Team
${facts.team?.founders?.map((f: any) => `- **${f.name}**: ${f.background || 'Background not specified'}`).join('\n') || '- Founder information not available'}
- **Domain Expertise**: ${facts.team?.domainExpertise || 'Not specified'}

### Business Model & Financials
- **Revenue Model**: ${facts.businessModel?.revenueModel || 'Not specified'}
- **Pricing**: ${facts.businessModel?.pricing || 'Not specified'}
- **Unit Economics**: ${facts.businessModel?.unitEconomics || 'Not disclosed'}
- **Raising**: ${raisingForPrompt}
- **Valuation**: ${facts.financials?.valuation || 'Not disclosed'}

### Go-to-Market
- **Strategy**: ${facts.goToMarket?.strategy || 'Not specified'}
- **Channels**: ${toDisplayList(facts.goToMarket?.channels, 'Not specified')}

### Key Risks Identified
- **Execution Risks**: ${toDisplayList(facts.risks?.execution, 'None identified')}
- **Market Risks**: ${toDisplayList(facts.risks?.market, 'None identified')}
- **Competitive Risks**: ${toDisplayList(facts.risks?.competition, 'None identified')}

### Data Quality Assessment
- **Completeness Score**: ${facts.dataQuality?.score || 50}/100
- **Missing Information**: ${toDisplayList(facts.dataQuality?.missingInformation, 'None noted')}

---
**SOURCE DOCUMENTS**: ${truncatedDocs.map(d => d.fileName).join(', ')}
`;

    console.log(`✅ Pass 1 complete: Extracted structured facts (${formattedFacts.length} chars)`);
    
    return formattedFacts;
    
  } catch (error) {
    console.error('Error extracting company facts:', error);
    
    // Fallback to original document text if extraction fails
    console.warn('⚠️ Fact extraction failed, using raw documents for scoring');
    return documents.map(doc => `### ${doc.fileName}\n${doc.text.slice(0, 20000)}`).join('\n\n');
  }
}

export async function extractStructuredFactsForContext(
  documents: Array<{ fileName: string; text: string; type?: string }>,
  companyName: string,
  companyUrl?: string,
  userNotes?: string
): Promise<string> {
  const normalizedDocs: ScoringDocument[] = (documents || [])
    .map((doc) => ({
      fileName: String(doc.fileName || 'Document').trim() || 'Document',
      text: String(doc.text || ''),
      type: String(doc.type || 'other'),
    }))
    .filter((doc) => doc.text.trim().length > 0);
  if (normalizedDocs.length === 0) return '';
  return extractCompanyFacts(normalizedDocs, companyName, companyUrl, userNotes);
}

function normalizeScoredCategories(
  criteria: DiligenceCriteria,
  modelCategories: any[]
): CategoryScore[] {
  const categories = Array.isArray(modelCategories) ? modelCategories : [];
  let matchedCategoriesCount = 0;
  let matchedCriteriaCount = 0;
  let totalCriteriaCount = 0;

  const normalizedCategories = criteria.categories.map((criteriaCategory, categoryIndex) => {
    const modelCategoryByName = findBestNamedMatch(categories, 'category', criteriaCategory.name);
    const modelCategory = modelCategoryByName || categories[categoryIndex];
    if (modelCategory) matchedCategoriesCount += 1;

    const modelCriteria = Array.isArray(modelCategory?.criteria) ? modelCategory.criteria : [];

    const normalizedCriteria: CriterionScore[] = criteriaCategory.criteria.map((criteriaCriterion, criterionIndex) => {
      totalCriteriaCount += 1;
      const modelCriterionByName = findBestNamedMatch(modelCriteria, 'name', criteriaCriterion.name);
      const modelCriterion = modelCriterionByName || modelCriteria[criterionIndex];
      if (modelCriterion) matchedCriteriaCount += 1;

      const criterionScore = clampScore(modelCriterion?.score, 50);
      const evidence = asStringArray(modelCriterion?.evidence);
      const confidence = clampScore(modelCriterion?.confidence, 55);
      const missingData = asStringArray(modelCriterion?.missingData);

      return {
        name: criteriaCriterion.name,
        score: criterionScore,
        reasoning: typeof modelCriterion?.reasoning === 'string' && modelCriterion.reasoning.trim().length > 0
          ? modelCriterion.reasoning.trim()
          : 'Model response did not include criterion-specific reasoning.',
        evidence: evidence.length > 0 ? evidence.slice(0, 5) : ['No direct evidence cited.'],
        confidence,
        evidenceStatus: normalizeEvidenceStatus(modelCriterion?.evidenceStatus),
        missingData,
        followUpQuestions: asStringArray(modelCriterion?.followUpQuestions).slice(0, 3),
      };
    }).map(criterion => {
      const config = criteriaCategory.criteria.find(c => c.name === criterion.name);
      return enforceCriterionReasoningQuality(applyInsufficientEvidencePolicy(criterion, config));
    });

    const categoryScoreFromModel = clampScore(modelCategory?.score, 0);
    const categoryScore = categoryScoreFromModel > 0
      ? categoryScoreFromModel
      : Math.round(
          normalizedCriteria.reduce((sum, criterion) => sum + criterion.score, 0) /
            Math.max(normalizedCriteria.length, 1)
        );

    return {
      category: criteriaCategory.name,
      score: categoryScore,
      weight: criteriaCategory.weight,
      weightedScore: Number(((categoryScore * criteriaCategory.weight) / 100).toFixed(2)),
      criteria: normalizedCriteria,
    };
  });

  console.log(
    `Scoring normalization coverage: categories ${matchedCategoriesCount}/${criteria.categories.length}, criteria ${matchedCriteriaCount}/${totalCriteriaCount}`
  );

  return normalizedCategories;
}

function normalizeSingleCategoryScore(
  criteriaCategory: CriteriaCategory,
  modelCategory: any
): CategoryScore {
  const modelCriteria = Array.isArray(modelCategory?.criteria) ? modelCategory.criteria : [];

  const normalizedCriteria: CriterionScore[] = criteriaCategory.criteria.map((criteriaCriterion, criterionIndex) => {
    const modelCriterionByName = findBestNamedMatch(modelCriteria, 'name', criteriaCriterion.name);
    const modelCriterion = modelCriterionByName || modelCriteria[criterionIndex];

    const criterionScore = clampScore(modelCriterion?.score, 50);
    const evidence = asStringArray(modelCriterion?.evidence);
    const confidence = clampScore(modelCriterion?.confidence, 55);
    const missingData = asStringArray(modelCriterion?.missingData);

    return {
      name: criteriaCriterion.name,
      score: criterionScore,
      reasoning: typeof modelCriterion?.reasoning === 'string' && modelCriterion.reasoning.trim().length > 0
        ? modelCriterion.reasoning.trim()
        : 'Model response did not include criterion-specific reasoning.',
      evidence: evidence.length > 0 ? evidence.slice(0, 5) : ['No direct evidence cited.'],
      confidence,
      evidenceStatus: normalizeEvidenceStatus(modelCriterion?.evidenceStatus),
      missingData,
      followUpQuestions: asStringArray(modelCriterion?.followUpQuestions).slice(0, 3),
    };
  }).map(criterion => {
    const config = criteriaCategory.criteria.find(c => c.name === criterion.name);
    return enforceCriterionReasoningQuality(applyInsufficientEvidencePolicy(criterion, config));
  });

  const categoryScoreFromModel = clampScore(modelCategory?.score, 0);
  const categoryScore = categoryScoreFromModel > 0
    ? categoryScoreFromModel
    : Math.round(
        normalizedCriteria.reduce((sum, criterion) => sum + criterion.score, 0) /
          Math.max(normalizedCriteria.length, 1)
      );

  return {
    category: criteriaCategory.name,
    score: categoryScore,
    weight: criteriaCategory.weight,
    weightedScore: Number(((categoryScore * criteriaCategory.weight) / 100).toFixed(2)),
    criteria: normalizedCriteria,
  };
}

function preserveCriterionAnswers(
  categories: CategoryScore[],
  previousScore?: DiligenceScore
): CategoryScore[] {
  if (!previousScore?.categories || previousScore.categories.length === 0) {
    return categories;
  }

  const criterionUserContext = new Map<
    string,
    { answer?: string; userPerspective?: string; manualOverride?: number }
  >();

  for (const category of previousScore.categories) {
    for (const criterion of category.criteria || []) {
      const hasUserPerspective = Boolean(criterion.userPerspective && criterion.userPerspective.trim().length > 0);
      const hasManualOverride = criterion.manualOverride !== undefined;
      const shouldPreserveAnswer = hasUserPerspective || hasManualOverride;
      if (
        shouldPreserveAnswer ||
        criterion.userPerspective !== undefined ||
        criterion.manualOverride !== undefined
      ) {
        criterionUserContext.set(`${category.category}::${criterion.name}`, {
          answer: shouldPreserveAnswer ? criterion.answer : undefined,
          userPerspective: criterion.userPerspective,
          manualOverride: criterion.manualOverride,
        });
      }
    }
  }

  if (criterionUserContext.size === 0) {
    return categories;
  }

  return categories.map((category) => ({
    ...category,
    criteria: category.criteria.map((criterion) => {
      const key = `${category.category}::${criterion.name}`;
      const previousContext = criterionUserContext.get(key);
      return previousContext
        ? {
            ...criterion,
            ...(previousContext.answer !== undefined ? { answer: previousContext.answer } : {}),
            ...(previousContext.userPerspective !== undefined
              ? { userPerspective: previousContext.userPerspective }
              : {}),
            ...(previousContext.manualOverride !== undefined
              ? { manualOverride: previousContext.manualOverride }
              : {}),
          }
        : criterion;
    }),
  }));
}

function fillMetricBackedCriterionAnswers(
  categories: CategoryScore[],
  metrics?: DiligenceMetrics,
  evidenceText?: string
): CategoryScore[] {
  const arr = metrics?.arr?.value;
  const tam = metrics?.tam?.value;
  const yoy = metrics?.yoyGrowthRate?.value;
  const marketGrowth = metrics?.marketGrowthRate?.value;
  const acv = metrics?.acv?.value;
  const runway = metrics?.currentRunway?.value;
  const pilotTractionSignal = extractPilotTractionSignal(evidenceText);

  return categories.map((category) => ({
    ...category,
    criteria: category.criteria.map((criterion) => {
      if (criterion.answer && criterion.answer.trim().length > 0) return criterion;
      const name = criterion.name.toLowerCase();
      if (/contracted arr|\barr\b/.test(name)) {
        if (arr) {
          return { ...criterion, answer: `Contracted ARR: ${arr}` };
        }
        if (pilotTractionSignal) {
          return {
            ...criterion,
            answer: `Contracted ARR: unknown. Early traction signal: ${pilotTractionSignal}`,
          };
        }
        return { ...criterion, answer: 'Contracted ARR: unknown' };
      }
      if (/tam/.test(name)) {
        return { ...criterion, answer: `Estimated TAM: ${tam || 'unknown'}` };
      }
      if (/market\s*growth|how\s+quickly|how\s+slowly|growth\s+rate/.test(name)) {
        return { ...criterion, answer: `Market growth: ${marketGrowth || yoy || 'unknown'}` };
      }
      if (/acv|average\s+contract\s+value/.test(name)) {
        return { ...criterion, answer: `ACV: ${acv || 'unknown'}` };
      }
      if (!arr && pilotTractionSignal && /traction|customer|revenue|commercial/.test(name)) {
        return {
          ...criterion,
          answer: `Revenue is not yet disclosed. Early traction signal: ${pilotTractionSignal}`,
        };
      }
      if (/runway/.test(name)) {
        return { ...criterion, answer: `Current runway: ${runway || 'unknown'}` };
      }
      return criterion;
    }),
  }));
}

function extractPilotTractionSignal(evidenceText?: string): string | undefined {
  const text = (evidenceText || '').trim();
  if (!text) return undefined;
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const pilotLines = lines
    .filter((line) =>
      /\b(pilot|pilots|paid\s+pilot|proof[-\s]?of[-\s]?concept|poc|design\s+partner|letters?\s+of\s+intent|lois?)\b/i.test(line)
    )
    .slice(0, 3);
  if (pilotLines.length === 0) return undefined;

  const joined = pilotLines.join(' ');
  const countMatch = joined.match(/\b(\d{1,3})\s*(?:\+)?\s*(?:paid\s+)?(?:pilot|pilots|customers?|design\s+partners?|lois?)\b/i);
  const count = countMatch?.[1];
  if (count) {
    return `${count} pilot/customer commitments mentioned in materials`;
  }
  return `pilot commitments mentioned in materials (${pilotLines[0].slice(0, 120)})`;
}

function formatUserProvidedCriterionContext(previousScore?: DiligenceScore, categoryName?: string): string {
  if (!previousScore?.categories || previousScore.categories.length === 0) {
    return '';
  }

  const chunks: string[] = [];

  for (const category of previousScore.categories) {
    if (categoryName && category.category !== categoryName) continue;
    for (const criterion of category.criteria || []) {
      const answer = criterion.answer?.trim();
      const userPerspective = criterion.userPerspective?.trim();
      const manualOverride = criterion.manualOverride;
      if (!answer && !userPerspective && manualOverride === undefined) continue;

      const lines = [
        `### ${category.category} / ${criterion.name}`,
        answer ? `- Factual Answer: ${answer}` : undefined,
        userPerspective ? `- User Perspective: ${userPerspective}` : undefined,
        manualOverride !== undefined ? `- User Score Override: ${manualOverride} (AI score: ${criterion.score})` : undefined,
      ].filter(Boolean);
      chunks.push(lines.join('\n'));
    }
  }

  if (chunks.length === 0) return '';

  return `## User-Provided Criterion Context
Use this criterion-level context as strong input where relevant:

${chunks.join('\n\n')}`;
}

function normalizeQuestionLine(question: string): string {
  const trimmed = (question || '').trim();
  if (!trimmed) return '';
  const withQuestionMark = /[?]$/.test(trimmed) ? trimmed : `${trimmed}?`;
  return withQuestionMark.replace(/\s+/g, ' ').trim();
}

function scoreQuestionSpecificity(question: string): number {
  const normalized = question.toLowerCase();
  let score = 0;

  if (normalized.length >= 70) score += 1.2;
  if (normalized.length < 35) score -= 1.5;
  if (/\d|%|\$|arr|mrr|tam|sam|som|cac|ltv|churn|retention|runway|customers?|months?|quarters?/i.test(normalized)) {
    score += 3;
  }
  if (/[":]/.test(question)) score += 0.8;
  if (/\b(next\s+(6|12)\s+months?|next\s+2\s+quarters?)\b/i.test(normalized)) score += 0.8;
  if (/\b(what'?s your strategy|tell us more|can you elaborate|how big is the market)\b/i.test(normalized)) {
    score -= 2;
  }

  return score;
}

function scoreQuestionMateriality(question: string, weakCriteria: CriterionWithCategory[]): number {
  const normalized = question.toLowerCase();
  let score = 0;

  for (const criterion of weakCriteria.slice(0, 8)) {
    const categoryName = criterion.category.toLowerCase();
    const criterionName = criterion.name.toLowerCase();
    const categoryHit = normalized.includes(categoryName);
    const criterionHit = normalized.includes(criterionName);
    if (categoryHit) score += criterion.materiality * 0.05;
    if (criterionHit) score += criterion.materiality * 0.08;
  }

  return score;
}

function buildFollowUpQuestions(scoreData: any, categories: CategoryScore[]): string[] {
  const directQuestions = asStringArray(scoreData?.followUpQuestions);
  const thesisQuestions = asStringArray(scoreData?.thesisAnswers?.founderQuestions?.questions);
  const criterionQuestions = categories.flatMap(category =>
    category.criteria.flatMap(criterion => criterion.followUpQuestions || [])
  );
  const weakCriteria = getWeakCriteria(categories);
  const synthesizedWeakQuestions = weakCriteria.slice(0, 5).map(buildSubstantiatedQuestion);

  const normalizedCandidates = [...directQuestions, ...thesisQuestions, ...criterionQuestions, ...synthesizedWeakQuestions]
    .map(normalizeQuestionLine)
    .filter(Boolean);
  const deduped = dedupeSimilarLines(Array.from(new Set(normalizedCandidates)), 0.52);

  return deduped
    .map(question => ({
      question,
      score: scoreQuestionSpecificity(question) + scoreQuestionMateriality(question, weakCriteria),
    }))
    .sort((a, b) => b.score - a.score)
    .map(item => item.question)
    .slice(0, 5)
    .concat(
      weakCriteria
        .slice(0, 5)
        .map(buildSubstantiatedQuestion)
        .filter(Boolean)
    )
    .filter(Boolean)
    .slice(0, 5);
}

function applyManualCalibration(
  categories: CategoryScore[],
  calibrationProfile?: CalibrationProfile
): CategoryScore[] {
  if (!calibrationProfile || calibrationProfile.length === 0) {
    return categories;
  }

  const calibrationByCategory = new Map(
    calibrationProfile.map(item => [item.category, item])
  );

  return categories.map(category => {
    const calibration = calibrationByCategory.get(category.category);
    if (!calibration || calibration.sampleCount < 3) {
      return category;
    }

    const avgConfidence = category.criteria.length > 0
      ? category.criteria.reduce((sum, criterion) => sum + (criterion.confidence ?? 55), 0) / category.criteria.length
      : 55;

    const sampleStrength = Math.min(1, calibration.sampleCount / 8);
    const confidenceFactor = avgConfidence < 65 ? 1 : 0.7;
    const rawAdjustment = calibration.averageDelta * sampleStrength * confidenceFactor;
    const boundedAdjustment = Math.max(-12, Math.min(12, rawAdjustment));
    const adjustedScore = clampScore(category.score + boundedAdjustment, category.score);

    return {
      ...category,
      score: adjustedScore,
      weightedScore: Number(((adjustedScore * category.weight) / 100).toFixed(2)),
    };
  });
}

function recalculateOverallFromCategories(categories: CategoryScore[]): number {
  const totalWeight = categories.reduce((sum, category) => sum + category.weight, 0);
  if (totalWeight <= 0) return 0;
  const weightedTotal = categories.reduce((sum, category) => sum + (category.score * category.weight), 0);
  return Math.round(weightedTotal / totalWeight);
}

type CriterionWithCategory = CriterionScore & { category: string; categoryWeight: number; materiality: number };

function getWeakCriteria(categories: CategoryScore[]): CriterionWithCategory[] {
  return categories
    .flatMap(category =>
      category.criteria.map(criterion => ({
        ...criterion,
        category: category.category,
        categoryWeight: category.weight,
        materiality:
          ((100 - criterion.score) * (category.weight / 100)) +
          ((criterion.evidenceStatus === 'unknown' || criterion.evidenceStatus === 'contradicted') ? 12 : 0) +
          (Math.max(0, 70 - (criterion.confidence ?? 55)) / 5),
      }))
    )
    .sort((a, b) => {
      if (a.materiality !== b.materiality) return b.materiality - a.materiality;
      const aConfidence = a.confidence ?? 55;
      const bConfidence = b.confidence ?? 55;
      return aConfidence - bConfidence;
    });
}

function isGenericText(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.length < 45 ||
    (!/\d|%|\$|arr|mrr|tam|sam|som|churn|retention|runway|customers?/i.test(normalized) &&
      /(strong|solid|good|promising|interesting|attractive|concerning|risk|challenge)/i.test(normalized))
  );
}

function getBestEvidenceLine(criterion: CriterionScore): string | undefined {
  return criterion.evidence.find(
    line => typeof line === 'string' && line.trim().length > 0 && line !== 'No direct evidence cited.'
  );
}

function buildSubstantiatedConcern(criterion: CriterionWithCategory): string {
  const evidence = getBestEvidenceLine(criterion);
  const base = `${criterion.category}: ${criterion.name} remains a material risk.`;
  if (evidence) {
    return `${base} Evidence suggests: ${evidence}`;
  }
  if (criterion.missingData && criterion.missingData.length > 0) {
    return `${base} Key evidence gap: ${criterion.missingData[0]}.`;
  }
  return `${base} Evidence is currently limited in the available materials.`;
}

function buildSubstantiatedQuestion(criterion: CriterionWithCategory): string {
  const evidence = getBestEvidenceLine(criterion);
  const missing = (criterion.missingData || []).find(Boolean);
  if (missing) {
    return `${criterion.category} / ${criterion.name}: Can you provide ${missing}? How would this change your current plan over the next 12 months?`;
  }
  if (evidence) {
    return `${criterion.category} / ${criterion.name}: You stated "${evidence}". What specific operating metric and timeline will validate this claim in the next 2 quarters?`;
  }
  return `${criterion.category} / ${criterion.name}: What concrete KPI should we use to validate execution progress in the next 6 months?`;
}

function normalizeToStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function extractSuppressedRiskTopics(previousScore?: DiligenceScore): string[] {
  if (!previousScore?.categories) return [];
  const topics: string[] = [];
  for (const category of previousScore.categories) {
    if (Array.isArray(category.overrideSuppressTopics) && category.overrideSuppressTopics.length > 0) {
      topics.push(...category.overrideSuppressTopics.map(t => t.toLowerCase()));
    }
    if (category.manualOverride === undefined || !category.overrideReason) continue;
    const reason = category.overrideReason.toLowerCase();
    const directMatches = [
      'burn',
      'runway',
      'churn',
      'competition',
      'competitor',
      'valuation',
      'team',
      'market',
    ].filter(topic => reason.includes(topic));
    topics.push(...directMatches);

    const regex = /not\s+concerned\s+about\s+([a-z0-9\s\-]+)/g;
    let match: RegExpExecArray | null = regex.exec(reason);
    while (match) {
      const phrase = match[1].trim();
      if (phrase) topics.push(phrase);
      match = regex.exec(reason);
    }
  }
  return Array.from(new Set(topics.filter(Boolean)));
}

function criterionMatchesSuppressedTopics(criterion: CriterionWithCategory, topics: string[]): boolean {
  if (topics.length === 0) return false;
  const corpus = `${criterion.category} ${criterion.name} ${criterion.reasoning} ${(criterion.evidence || []).join(' ')} ${(criterion.missingData || []).join(' ')}`.toLowerCase();
  return topics.some(topic => corpus.includes(topic.toLowerCase()));
}

function textMatchesSuppressedTopics(text: string, topics: string[]): boolean {
  if (!text || topics.length === 0) return false;
  const normalized = text.toLowerCase();
  return topics.some(topic => normalized.includes(topic.toLowerCase()));
}

function tokenSet(text: string): Set<string> {
  const stop = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'about', 'because', 'evidence', 'suggests', 'remains', 'material', 'risk', 'key']);
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 3 && !stop.has(token))
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function dedupeSimilarLines(lines: string[], similarityThreshold = 0.58): string[] {
  const result: string[] = [];
  const signatures: Set<string>[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const current = tokenSet(trimmed);
    const isDuplicate = signatures.some(existing => jaccardSimilarity(existing, current) >= similarityThreshold);
    if (!isDuplicate) {
      result.push(trimmed);
      signatures.push(current);
    }
  }
  return result;
}

function enforceThesisSpecificity(
  thesisAnswers: any,
  categories: CategoryScore[] | undefined,
  previousScore?: DiligenceScore
): any {
  if (!categories || categories.length === 0) {
    return thesisAnswers;
  }

  const suppressedTopics = extractSuppressedRiskTopics(previousScore);
  const allWeakCriteria = getWeakCriteria(categories);
  const weakCriteria = allWeakCriteria.filter(
    criterion => !criterionMatchesSuppressedTopics(criterion, suppressedTopics)
  );
  // Guard against over-suppression that can otherwise produce empty concerns/questions.
  const topWeakCriteria = (weakCriteria.length > 0 ? weakCriteria : allWeakCriteria).slice(0, 6);
  const generatedConcerns = topWeakCriteria.slice(0, 4).map(buildSubstantiatedConcern);
  const generatedQuestions = topWeakCriteria.slice(0, 5).map(buildSubstantiatedQuestion);

  const incomingConcerns = normalizeToStringArray(thesisAnswers?.concerning);
  const highQualityIncomingConcerns = incomingConcerns
    .filter(item => !textMatchesSuppressedTopics(item, suppressedTopics))
    .filter(item => item.trim().length >= 20);
  const improvedConcerns = dedupeSimilarLines(
    [...generatedConcerns, ...highQualityIncomingConcerns],
    0.52
  )
    .map(concern => ({
      concern,
      score:
        (scoreQuestionSpecificity(concern) * 0.4) +
        scoreQuestionMateriality(concern, topWeakCriteria) +
        (/evidence|missing|gap|contradiction|risk|runway|retention|churn|tam|cac|ltv/i.test(concern) ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .map(item => item.concern)
    .slice(0, 3);

  const incomingQuestions = normalizeToStringArray(thesisAnswers?.founderQuestions?.questions);
  const highQualityIncomingQuestions = incomingQuestions
    .map(normalizeQuestionLine)
    .filter(question => !textMatchesSuppressedTopics(question, suppressedTopics))
    .filter(question => question.length >= 25);
  const improvedQuestions = dedupeSimilarLines(
    [...generatedQuestions, ...highQualityIncomingQuestions],
    0.5
  )
    .filter(question => !textMatchesSuppressedTopics(question, suppressedTopics))
    .map(question => ({
      question,
      score: scoreQuestionSpecificity(question) + scoreQuestionMateriality(question, topWeakCriteria),
    }))
    .sort((a, b) => b.score - a.score)
    .map(item => item.question)
    .slice(0, 3);

  const fallbackConcerns = generatedConcerns.slice(0, 3);
  const fallbackQuestions = generatedQuestions.slice(0, 3);
  const finalConcerns = (improvedConcerns.length > 0 ? improvedConcerns : fallbackConcerns).slice(0, 3);
  const finalQuestions = (improvedQuestions.length > 0 ? improvedQuestions : fallbackQuestions).slice(0, 3);

  const primaryConcernFallback = normalizeToStringArray([thesisAnswers?.founderQuestions?.primaryConcern])
    .find(item => !textMatchesSuppressedTopics(item, suppressedTopics)) || '';
  const primaryConcern = primaryConcernFallback || finalConcerns[0] || generatedConcerns[0] || '';
  const keyGaps = Array.from(
    new Set(
      topWeakCriteria
        .flatMap(c => c.missingData || [])
        .filter(Boolean)
        .slice(0, 5)
    )
  ).join('; ') || thesisAnswers?.founderQuestions?.keyGaps || 'Key evidence gaps remain on low-confidence criteria.';

  return {
    ...(thesisAnswers || {}),
    concerning: finalConcerns,
    founderQuestions: {
      ...(thesisAnswers?.founderQuestions || {}),
      questions: finalQuestions,
      primaryConcern,
      keyGaps,
    },
  };
}

async function generateInvestorGradeQuestioningPass(
  companyName: string,
  thesisAnswers: any,
  categories: CategoryScore[]
): Promise<{ thesisAnswers?: any; followUpQuestions?: string[] } | null> {
  if (process.env.NODE_ENV === 'production' || process.env.DISABLE_INVESTOR_QUESTION_PASS === 'true') {
    return null;
  }

  const weakCriteria = getWeakCriteria(categories).slice(0, 6);
  if (weakCriteria.length === 0) return null;

  const weakCriteriaContext = weakCriteria
    .map((criterion, index) => {
      const evidence = getBestEvidenceLine(criterion) || 'No concrete evidence line captured';
      const missing = (criterion.missingData || []).slice(0, 2).join('; ') || 'No explicit missing data listed';
      return `${index + 1}. ${criterion.category} / ${criterion.name} (score=${criterion.score}, confidence=${criterion.confidence ?? 55}, materiality=${criterion.materiality.toFixed(1)})
- Evidence anchor: ${evidence}
- Missing data: ${missing}`;
    })
    .join('\n');

  const existingConcerns = normalizeToStringArray(thesisAnswers?.concerning)
    .slice(0, 5)
    .map(item => `- ${item}`)
    .join('\n');
  const existingQuestions = normalizeToStringArray(thesisAnswers?.founderQuestions?.questions)
    .slice(0, 5)
    .map(item => `- ${item}`)
    .join('\n');

  const prompt = `You are preparing partner-level venture diligence questions for ${companyName}.

Use the risk context below to produce focused, evidence-anchored outputs.
Avoid generic startup questions.

## Existing concerns
${existingConcerns || '- none'}

## Existing founder questions
${existingQuestions || '- none'}

## Highest-materiality weak criteria
${weakCriteriaContext}

## Output requirements
- Return ONLY valid JSON.
- "concerning": exactly 3 bullets, each tied to concrete evidence or an explicit missing metric.
- "founderQuestions.questions": exactly 3 tactical questions, each referencing a concrete claim/metric/gap.
- "founderQuestions.primaryConcern": one sentence.
- "founderQuestions.keyGaps": concise semicolon-delimited list of missing data.
- "followUpQuestions": exactly 5 best overall due diligence questions ranked by decision impact.

JSON schema:
{
  "thesisAnswers": {
    "concerning": ["..."],
    "founderQuestions": {
      "questions": ["..."],
      "primaryConcern": "...",
      "keyGaps": "..."
    }
  },
  "followUpQuestions": ["..."]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a rigorous VC diligence associate. Be concise, specific, and evidence-driven.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });
    const content = response.choices[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    return {
      thesisAnswers: parsed?.thesisAnswers,
      followUpQuestions: asStringArray(parsed?.followUpQuestions),
    };
  } catch (error) {
    console.warn('Investor-grade questioning pass failed; continuing with baseline thesis outputs.', error);
    return null;
  }
}

function mergeThesisAnswers(base: any, override: any): any {
  if (!override) return base;
  return {
    ...(base || {}),
    ...(override || {}),
    founderQuestions: {
      ...(base?.founderQuestions || {}),
      ...(override?.founderQuestions || {}),
    },
  };
}

function reasoningHasConcreteSignal(text: string): boolean {
  const concretePattern = /(\$|%|\b\d+\b|arr|mrr|tam|sam|som|churn|cac|ltv|runway|customers?|months?|years?)/i;
  return concretePattern.test(text);
}

function reasoningLooksGeneric(text: string): boolean {
  const normalized = text.toLowerCase();
  const genericPhrases = [
    'strong team',
    'large market',
    'good traction',
    'promising opportunity',
    'solid potential',
    'relevant experience',
    'compelling product',
    'clear value proposition',
    'significant opportunity',
  ];
  return genericPhrases.some(phrase => normalized.includes(phrase));
}

function toNaturalReasoning(text: string): string {
  const raw = (text || '').trim();
  if (!raw) return raw;

  const structured = raw.match(/Claim:\s*([\s\S]*?)\s*Evidence:\s*([\s\S]*?)\s*Implication:\s*([\s\S]*)$/i);
  if (structured) {
    const claim = structured[1]?.trim();
    const evidence = structured[2]?.trim();
    const implication = structured[3]?.trim();
    return [claim, evidence, implication].filter(Boolean).join(' ');
  }

  return raw
    .replace(/\bClaim:\s*/gi, '')
    .replace(/\bEvidence:\s*/gi, '')
    .replace(/\bImplication:\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function trimTrailingSentencePunctuation(text: string): string {
  return (text || '').trim().replace(/[.\s]+$/g, '').trim();
}

function enforceCriterionReasoningQuality(criterion: CriterionScore): CriterionScore {
  const rawReasoning = toNaturalReasoning(criterion.reasoning || '');
  const evidenceLine = criterion.evidence.find(
    line => typeof line === 'string' && line.trim().length > 0 && line !== 'No direct evidence cited.'
  );

  const needsRewrite =
    !rawReasoning ||
    rawReasoning === 'Model response did not include criterion-specific reasoning.' ||
    ((reasoningLooksGeneric(rawReasoning) || rawReasoning.length < 80) && !reasoningHasConcreteSignal(rawReasoning));

  if (!needsRewrite) {
    return {
      ...criterion,
      reasoning: rawReasoning,
    };
  }

  const statusText = criterion.evidenceStatus || 'unknown';
  const implication =
    statusText === 'supported'
      ? 'This supports conviction in the score.'
      : statusText === 'weakly_supported'
      ? 'This supports the score but still leaves material uncertainty.'
      : statusText === 'contradicted'
      ? 'This contradicts key assumptions and warrants a conservative score.'
      : 'Evidence is limited, so the score is intentionally conservative.';

  const rewritten = evidenceLine
    ? `${criterion.name} is scored using concrete diligence evidence from the provided materials. ${evidenceLine} ${implication}`
    : `${criterion.name} is scored conservatively because direct support in the current materials is limited. ${implication}`;

  return {
    ...criterion,
    reasoning: rewritten,
  };
}

/**
 * Score a company's diligence documents against criteria
 */
export async function scoreDiligence(
  documentTexts: ScoringDocument[],
  criteria: DiligenceCriteria,
  companyName: string,
  companyUrl?: string,
  userNotes?: string,
  categorizedNotes?: CategorizedNoteInput[],
  questions?: DiligenceQuestion[],
  hubspotCompanyData?: HubSpotCompanyData,
  teamResearch?: TeamResearch,
  portfolioSynergyResearch?: PortfolioSynergyResearch,
  problemNecessityResearch?: ProblemNecessityResearch,
  sourceOfTruthMetrics?: DiligenceMetrics,
  previousScore?: DiligenceScore,
  existingThesisAnswers?: any,
  scoringOptions?: ScoringOptions
): Promise<{
  score: DiligenceScore;
  metrics: DiligenceMetrics;
  companyMetadata: { companyOneLiner?: string; industry?: string; founders?: Array<{ name: string; linkedinUrl?: string; title?: string }> };
}> {
  
  // PASS 1: Extract structured facts from documents
  console.log('🔄 Starting two-pass scoring system...');
  const extractedFacts = await extractCompanyFacts(
    documentTexts,
    companyName,
    companyUrl,
    userNotes
  );
  const externalMarketIntelligence = await deriveExternalMarketIntelligence(
    companyName,
    companyUrl,
    extractedFacts,
    documentTexts
  );
  const derivedMetrics = deriveMetricsFromFacts(extractedFacts, externalMarketIntelligence);
  const notesDerivedMetrics = deriveMetricsFromCategorizedNotes(categorizedNotes || []);
  const rawDocumentContext = documentTexts.map((doc) => doc.text || '').join('\n');
  const rawDerivedMetrics = deriveMetricsFromRawDocumentText(rawDocumentContext);
  const combinedDerivedMetrics = mergeMetrics(derivedMetrics, mergeMetrics(notesDerivedMetrics, rawDerivedMetrics));
  const resolvedMetrics = mergeMetrics(sourceOfTruthMetrics, combinedDerivedMetrics);
  
  // Fetch learning data from past decisions (if available)
  let learningContext = '';
  let calibrationProfile: CalibrationProfile = [];
  try {
    const learningResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/diligence/learning-data`);
    if (learningResponse.ok) {
      const learningData = await learningResponse.json();
      if (learningData.hasData) {
        learningContext = formatLearningContext(learningData.learningData);
        calibrationProfile = Array.isArray(learningData.learningData?.manualOverrideCalibration)
          ? learningData.learningData.manualOverrideCalibration
          : [];
      }
    }
  } catch (err) {
    console.warn('Could not fetch learning data, proceeding without historical context');
  }
  
  // PASS 2: Score based on structured facts + notes + criteria
  console.log('📊 Pass 2: Scoring based on extracted facts and criteria...');
  const criterionContexts = buildCriterionContexts(criteria, documentTexts, extractedFacts);
  const notesForScoring = scoringOptions?.summarizeTranscriptNotesForScoring
    ? await summarizeCategorizedNotesForScoring(companyName, categorizedNotes || [])
    : (categorizedNotes || []);
  let prompt = buildScoringPrompt(
    extractedFacts,
    criteria,
    companyName,
    companyUrl,
    userNotes,
    notesForScoring,
    questions,
    learningContext,
    previousScore,
    existingThesisAnswers,
    criterionContexts,
    externalMarketIntelligence,
    hubspotCompanyData,
    resolvedMetrics,
    teamResearch,
    portfolioSynergyResearch,
    problemNecessityResearch
  );

  if (prompt.length > 110000) {
    console.warn(`Prompt is large (${prompt.length} chars). Switching to compact mode for token safety.`);
    prompt = buildScoringPrompt(
      extractedFacts,
      criteria,
      companyName,
      companyUrl,
      userNotes,
      notesForScoring,
      questions,
      learningContext,
      previousScore,
      existingThesisAnswers,
      criterionContexts,
      externalMarketIntelligence,
      hubspotCompanyData,
      resolvedMetrics,
      teamResearch,
      portfolioSynergyResearch,
      problemNecessityResearch,
      true
    );
  }
  
  console.log('Starting AI scoring for:', companyName);
  console.log(`Prompt size: ${prompt.length} chars (${Math.round(prompt.length / 4)} estimated tokens)`);
  
  // Check if we're doing URL-only analysis
  const isUrlOnlyAnalysis = documentTexts.length === 1 && documentTexts[0].fileName === 'Company Information';
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are an expert venture capital analyst conducting comprehensive due diligence on startups and companies. Your role is to:

1. ${isUrlOnlyAnalysis ? '⚠️ RESEARCH THE SPECIFIC COMPANY: Look at the company name and URL provided. Determine what they ACTUALLY do (their real product/service and industry). DO NOT assume or use generic startup analysis. If they make manufacturing software, analyze manufacturing software. If they are healthcare, analyze healthcare. Match your analysis to their ACTUAL business.' : 'Thoroughly analyze all provided documents (pitch decks, financial statements, etc.)'}
2. Score the company against specific investment criteria
3. Provide evidence-based reasoning for each score with SPECIFIC details (not generic statements)
4. Identify key strengths and concerns based on actual company information
5. ${isUrlOnlyAnalysis ? 'Provide detailed TAM estimates, competitive landscape analysis, and market insights for the ACTUAL industry/product category this company operates in based on the URL and company name' : 'Assess the quality and completeness of the provided information'}
6. **Identify Red Flags**: Flag any dealbreakers or serious concerns (regulatory issues, unit economics problems, weak team, oversaturated market, unrealistic projections)
7. **Competitive Differentiation**: Analyze what makes this company uniquely defensible vs competitors
8. **Market Timing**: Assess "why now" - is this the right time for this solution/market?
9. Generate highly specific, tactical questions for the founder that reference actual details from the materials (not generic startup questions)

${isUrlOnlyAnalysis ? '⚠️ CRITICAL: The company name and URL tell you what they do. Analyze the CORRECT industry and product type. If you recognize the company from training data, use that knowledge. If not, make educated inferences from the domain/name but be honest about uncertainty. NEVER provide analysis for the wrong industry.' : ''}

**CRITICAL FOR FOUNDER QUESTIONS**: Your questions must be specific to THIS company's actual situation. Reference specific metrics, claims, or gaps from their materials. Examples:
- BAD: "What's your customer acquisition strategy?"
- GOOD: "You mention $50K MRR with 15 customers but show 30% churn. What specific changes are you making to reduce churn, and what's causing customers to leave?"

**INVESTMENT CONTEXT**: You are evaluating for a Seed-stage B2B VC fund focused on AI-first solutions. Consider:
- Team quality and domain expertise
- Product-market fit evidence
- Scalability and defensibility
- Market size and timing
- Capital efficiency and unit economics

Be objective, thorough, and cite specific evidence${isUrlOnlyAnalysis ? ' from your knowledge of this company and its market' : ' from the documents'} in your analysis.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3, // Lower temperature for consistent, analytical scoring
    });

    const content = response.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    const scoreData = JSON.parse(content);
    const normalizedCategories = normalizeScoredCategories(criteria, scoreData.categories);
    const calibratedCategories = applyManualCalibration(normalizedCategories, calibrationProfile);
    const externallyAdjustedCategories = applyExternalMarketPenalties(calibratedCategories, externalMarketIntelligence);
    const tamCalibratedCategories = applyTamComparisonCalibration(
      externallyAdjustedCategories,
      externalMarketIntelligence,
      resolvedMetrics,
      hubspotCompanyData
    );
    const marketGrowthCalibratedCategories = applyMarketGrowthCalibration(
      tamCalibratedCategories,
      externalMarketIntelligence,
      resolvedMetrics
    );
    const teamCalibratedCategories = applyTeamResearchCalibration(marketGrowthCalibratedCategories, teamResearch);
    const portfolioCalibratedCategories = applyPortfolioSynergyCalibration(
      teamCalibratedCategories,
      portfolioSynergyResearch
    );
    const necessityCalibratedCategories = applyProblemNecessityCalibration(
      portfolioCalibratedCategories,
      problemNecessityResearch
    );
    const fundingGuardedCategories = applyFundingRaiseGuard(
      necessityCalibratedCategories,
      resolvedMetrics,
      extractedFacts,
      userNotes,
      rawDocumentContext
    );
    const earlyTractionCalibratedCategories = applyEarlyTractionCalibration(
      fundingGuardedCategories,
      extractedFacts,
      userNotes,
      rawDocumentContext
    );
    const categoriesWithPreservedAnswers = fillMetricBackedCriterionAnswers(
      preserveCriterionAnswers(earlyTractionCalibratedCategories, previousScore),
      resolvedMetrics,
      `${extractedFacts}\n${userNotes || ''}\n${rawDocumentContext}`
    );
    const totalWeight = categoriesWithPreservedAnswers.reduce((sum, category) => sum + category.weight, 0);
    const computedOverall = totalWeight > 0
      ? Math.round(
          categoriesWithPreservedAnswers.reduce((sum, category) => sum + (category.score * category.weight), 0) / totalWeight
        )
      : 0;
    const baselineRefinedThesisAnswers = enforceThesisSpecificity(
      scoreData.thesisAnswers,
      categoriesWithPreservedAnswers,
      previousScore
    );
    const investorGradeQuestioning = await generateInvestorGradeQuestioningPass(
      companyName,
      baselineRefinedThesisAnswers,
      categoriesWithPreservedAnswers
    );
    const mergedThesisAnswers = mergeThesisAnswers(
      baselineRefinedThesisAnswers,
      investorGradeQuestioning?.thesisAnswers
    );
    const refinedThesisAnswers = enforceThesisSpecificity(
      mergedThesisAnswers,
      categoriesWithPreservedAnswers,
      previousScore
    );
    const followUpQuestions = buildFollowUpQuestions(
      {
        ...scoreData,
        thesisAnswers: refinedThesisAnswers,
        followUpQuestions: investorGradeQuestioning?.followUpQuestions || scoreData?.followUpQuestions,
      },
      categoriesWithPreservedAnswers
    );
    
    // Validate and structure the response
    const score: DiligenceScore = {
      // Always derive overall from normalized category scores for consistency
      overall: computedOverall,
      categories: categoriesWithPreservedAnswers,
      dataQuality: clampScore(scoreData.dataQuality, 50),
      scoredAt: new Date().toISOString(),
      thesisAnswers: refinedThesisAnswers || undefined,
      rescoreExplanation: scoreData.rescoreExplanation || undefined,
      followUpQuestions,
      externalMarketIntelligence,
    };

    console.log(`Scoring completed. Overall: ${score.overall}, Data Quality: ${score.dataQuality}`);

    // Return both score and extracted company metadata
    return {
      score,
      metrics: resolvedMetrics,
      companyMetadata: {
        companyOneLiner: scoreData.companyOneLiner || undefined,
        industry: scoreData.industry || undefined,
        founders: scoreData.founders || undefined,
      },
    } as any; // Type will be fixed
    
  } catch (error) {
    console.error('Error scoring diligence:', error);

    // Fallback: chunk scoring by category when a single request exceeds token/rate limits
    if (isTokenLimitError(error)) {
      console.warn('Falling back to category-by-category scoring due to token/rate limits.');
      try {
        return await scoreDiligenceByCategory(
          criteria,
          companyName,
          companyUrl,
          extractedFacts,
          criterionContexts,
          externalMarketIntelligence,
          userNotes,
          notesForScoring,
          questions,
          hubspotCompanyData,
          teamResearch,
          portfolioSynergyResearch,
          problemNecessityResearch,
          previousScore,
          calibrationProfile,
          resolvedMetrics
        );
      } catch (fallbackError) {
        console.error('Category-by-category fallback scoring failed:', fallbackError);
        throw new Error('Scoring failed after fallback. Please retry or reduce document volume.');
      }
    }

    throw new Error('Failed to score diligence with AI');
  }
}

/**
 * Format learning data into context for AI scoring
 */
function formatLearningContext(learningData: any): string {
  if (!learningData || learningData.totalDecisions < 5) {
    return ''; // Need at least 5 decisions to provide meaningful patterns
  }

  const insights: string[] = [];

  insights.push(`\n## Historical Investment Patterns\n`);
  insights.push(`Based on ${learningData.totalDecisions} past diligence reviews:\n`);
  insights.push(`- Invested in: ${learningData.invested} companies (avg score: ${learningData.averageInvestedScore})`);
  insights.push(`- Passed on: ${learningData.passed} companies (avg score: ${learningData.averagePassedScore})`);
  
  if (learningData.invested > 0 && learningData.passed > 0) {
    insights.push(`\n**Key Patterns**:`);
    
    // Category insights
    const topCategories = learningData.categoryPatterns.slice(0, 3);
    topCategories.forEach((cat: any) => {
      if (cat.investmentCount > 0) {
        insights.push(`- ${cat.category}: Investments average ${Math.round(cat.averageInvestedScore)} (passed: ${Math.round(cat.averagePassedScore)})`);
      }
    });

    // Score thresholds
    if (learningData.scoreThresholds.invested.min > 0) {
      insights.push(`\n**Investment Score Range**: ${learningData.scoreThresholds.invested.min}-${learningData.scoreThresholds.invested.max}`);
    }
  }

  const calibrationRows = Array.isArray(learningData.manualOverrideCalibration)
    ? learningData.manualOverrideCalibration.filter((row: any) => row.sampleCount >= 3).slice(0, 5)
    : [];
  if (calibrationRows.length > 0) {
    insights.push(`\n**Manual Override Calibration Trends**:`);
    calibrationRows.forEach((row: any) => {
      const direction = row.averageDelta >= 0 ? '+' : '';
      insights.push(`- ${row.category}: typical manual adjustment ${direction}${Math.round(row.averageDelta)} points (${row.sampleCount} samples)`);
    });
  }

  return insights.join('\n');
}

/**
 * Build comprehensive prompt for AI scoring
 */
function buildScoringPrompt(
  extractedFacts: string, // Now receives structured facts instead of raw documents
  criteria: DiligenceCriteria,
  companyName: string,
  companyUrl?: string,
  userNotes?: string,
  categorizedNotes?: Array<{ id: string; category: string; content: string; createdAt: string; updatedAt: string }>,
  questions?: DiligenceQuestion[],
  learningContext?: string,
  previousScore?: DiligenceScore,
  existingThesisAnswers?: any,
  criterionContexts?: CriterionContext[],
  externalMarketIntelligence?: ExternalMarketIntelligence,
  hubspotCompanyData?: HubSpotCompanyData,
  sourceOfTruthMetrics?: DiligenceMetrics,
  teamResearch?: TeamResearch,
  portfolioSynergyResearch?: PortfolioSynergyResearch,
  problemNecessityResearch?: ProblemNecessityResearch,
  compactMode = false
): string {
  const limits = compactMode
    ? {
        extractedFacts: 18000,
        learningContext: 2500,
        previousScore: 2000,
        existingThesis: 4000,
        notes: 5000,
        strictNameMap: 3000,
        criterionContext: 10000,
        externalIntel: 7000,
      }
    : {
        extractedFacts: 35000,
        learningContext: 6000,
        previousScore: 3500,
        existingThesis: 7000,
        notes: 9000,
        strictNameMap: 6000,
        criterionContext: 22000,
        externalIntel: 14000,
      };

  const criteriaSections = criteria.categories.map(category => {
    const criteriaList = category.criteria.map(c => 
      `- **${c.name}**: ${c.description}
  Scoring Guidance: ${c.scoringGuidance}`
    ).join('\n');

    return `### ${category.name} (Weight: ${category.weight}%)
${criteriaList}`;
  }).join('\n\n');

  const strictNameMap = criteria.categories
    .map((category) => {
      const criteriaNames = category.criteria.map(c => `- ${c.name}`).join('\n');
      return `Category: ${category.name}\n${criteriaNames}`;
    })
    .join('\n\n');

  // Build categorized notes section
  let notesSection = '';
  
  if (categorizedNotes && categorizedNotes.length > 0) {
    const notesByCategory = categorizedNotes.reduce((acc, note) => {
      if (!acc[note.category]) acc[note.category] = [];
      acc[note.category].push(note);
      return acc;
    }, {} as Record<string, typeof categorizedNotes>);
    
    const categorizedNotesText = Object.entries(notesByCategory)
      .map(([category, notes]) => {
        const notesText = notes.map(n => `- ${n.content}`).join('\n');
        return `### ${category}\n${notesText}`;
      })
      .join('\n\n');
    
    notesSection = `

## 🔍 Investor's Categorized Notes and Observations:

${categorizedNotesText}

**IMPORTANT**: The notes above are from the investor/analyst reviewing this deal, organized by criteria category. These notes contain valuable context, initial impressions, concerns, questions, and observations that should be heavily weighted in your scoring. When scoring each category, pay special attention to the notes for that category.

---
`;
  } else if (userNotes) {
    // Legacy single note field
    notesSection = `

## 🔍 User's Notes and Observations:

${userNotes}

**IMPORTANT**: The notes above are from the investor/analyst reviewing this deal. These notes contain valuable context, initial impressions, concerns, questions, and observations that should be heavily weighted in your analysis. Consider these notes as critical insider information that provides context the documents may not reveal.

---
`;
  }

  // Build questions section
  let questionsSection = '';
  if (questions && questions.length > 0) {
    const answeredQuestions = questions.filter(q => q.status === 'answered');
    const openQuestions = questions.filter(q => q.status === 'open');

    if (answeredQuestions.length > 0) {
      const answeredText = answeredQuestions.map(q => 
        `Q: ${q.question}\nA: ${q.answer || '(No answer provided)'}`
      ).join('\n\n');
      
      questionsSection += `
## ✅ RESOLVED QUESTIONS (Confirmed Facts)

The following questions have been answered and should be treated as confirmed, verified facts in your scoring:

${answeredText}

**CRITICAL INSTRUCTION**: These answered questions provide verified information. Use them as authoritative facts. DO NOT regenerate these questions in your "Top 3 Open Questions" or follow-up recommendations. They are resolved.

---
`;
    }

    if (openQuestions.length > 0) {
      const openText = openQuestions.map(q => `- ${q.question}`).join('\n');
      
      questionsSection += `
## ❓ ACTIVE OPEN QUESTIONS (Information Gaps)

The following questions remain unanswered and represent key information gaps:

${openText}

**IMPORTANT**: When scoring criteria related to these open questions, you should:
1. Lower confidence scores if the question represents a material information gap
2. Note the missing information in your reasoning
3. Include relevant unanswered questions in your follow-up recommendations
4. DO refine or rephrase these questions if you have better/more specific versions based on the materials

---
`;
    }
  }

  // Build previous score context if this is a re-score
  let previousScoreContext = '';
  if (previousScore) {
    const categoryScores = previousScore.categories
      .map(cat => `- ${cat.category}: ${cat.manualOverride ?? cat.score}/100${cat.manualOverride !== undefined ? ' (manually overridden)' : ''}`)
      .join('\n');
    
    previousScoreContext = `
## 🔄 Previous Score (Re-scoring in Progress)

**Previous Overall Score**: ${previousScore.overall}/100
**Previous Category Scores**:
${categoryScores}

**IMPORTANT FOR RE-SCORING**: 
- You are re-scoring this company with updated or additional information.
- Compare your new scores to the previous scores above.
- At the end of your analysis, provide a "rescoreExplanation" field that explains:
  * What new information influenced the scoring
  * Which categories changed significantly and why
  * Key insights that emerged from the new data
- Be specific about what changed and why (e.g., "Team score increased from 65 to 78 due to new information about founder's successful exits")

---
`;
  }

  // Build existing thesis context if manually edited
  let existingThesisContext = '';
  if (existingThesisAnswers && existingThesisAnswers.manuallyEdited) {
    const excitingPoints = Array.isArray(existingThesisAnswers.exciting) 
      ? existingThesisAnswers.exciting.map((item: string, idx: number) => `${idx + 1}. ${item}`).join('\n')
      : existingThesisAnswers.exciting;
    
    const concerningPoints = Array.isArray(existingThesisAnswers.concerning)
      ? existingThesisAnswers.concerning.map((item: string, idx: number) => `${idx + 1}. ${item}`).join('\n')
      : existingThesisAnswers.concerning;

    const founderQuestionsText = existingThesisAnswers.founderQuestions 
      ? `\n**Questions for Founders:**
${existingThesisAnswers.founderQuestions.questions.map((q: string, idx: number) => `${idx + 1}. ${q}`).join('\n')}

**Primary Concern:** ${existingThesisAnswers.founderQuestions.primaryConcern}

**Key Information Gaps:** ${existingThesisAnswers.founderQuestions.keyGaps}`
      : '';

    existingThesisContext = `
## ✏️ User's Investment Thesis (Manually Edited)

The investor has provided the following refined investment thesis. **Use this as critical context when scoring.**
These insights represent the investor's refined understanding of the opportunity and should heavily inform your scoring decisions.

**Problem Being Solved:**
${existingThesisAnswers.problemSolving}

**Solution Approach:**
${existingThesisAnswers.solution}

**Ideal Customer Profile:**
${existingThesisAnswers.idealCustomer}

**What's Exciting:**
${excitingPoints}

**What's Concerning:**
${concerningPoints}${founderQuestionsText}

**IMPORTANT**: Since the investor has manually refined this thesis, it reflects their deep analysis and should be considered authoritative context. Your scoring should align with these insights while still being objective about the underlying criteria.

---
`;
  }

  const criterionContextText = truncateForPrompt(
    formatCriterionContexts(criterionContexts || []),
    limits.criterionContext
  );
  const userCriterionContext = truncateForPrompt(
    formatUserProvidedCriterionContext(previousScore),
    limits.previousScore
  );

  const hierarchyContext = [
    truncateForPrompt(learningContext || '', limits.learningContext),
    truncateForPrompt(previousScoreContext, limits.previousScore),
    userCriterionContext ? `${userCriterionContext}\n\n---\n` : '',
    truncateForPrompt(existingThesisContext, limits.existingThesis),
    truncateForPrompt(notesSection, limits.notes),
    questionsSection, // Questions section (no truncation, it's already concise)
  ].join('');

  const externalIntelSection = truncateForPrompt(
    formatExternalMarketIntelligence(externalMarketIntelligence),
    limits.externalIntel
  );
  const sourceOfTruthMetricsSection = formatSourceOfTruthMetrics(sourceOfTruthMetrics);
  const hubspotCompanySection = formatHubSpotCompanyData(hubspotCompanyData);
  const stateOfInvestorsSignal = formatStateOfInvestorsSignal(sourceOfTruthMetrics, hubspotCompanyData);
  const teamResearchSignal = formatTeamResearchSignal(teamResearch);
  const industryThesisSignal = formatIndustryThesisSignal(hubspotCompanyData);
  const locationSignal = formatLocationSignal(sourceOfTruthMetrics, hubspotCompanyData);
  const marketGrowthSignal = formatMarketGrowthSignal(externalMarketIntelligence, sourceOfTruthMetrics);
  const portfolioSynergySignal = formatPortfolioSynergySignal(portfolioSynergyResearch);
  const problemNecessitySignal = formatProblemNecessitySignal(problemNecessityResearch);

  return `# Due Diligence Scoring Task

## Company: ${companyName}${companyUrl ? ` (${companyUrl})` : ''}

---

# INFORMATION HIERARCHY (Process in this order)

${hierarchyContext}

${truncateForPrompt(extractedFacts, limits.extractedFacts)}

---

${externalIntelSection}

---

${marketGrowthSignal}

---

${sourceOfTruthMetricsSection}

---

${hubspotCompanySection}

---

${stateOfInvestorsSignal}

---

${teamResearchSignal}

---

${industryThesisSignal}

${locationSignal}

---

${portfolioSynergySignal}

---

${problemNecessitySignal}

---

## Investment Thesis Questions

First, answer these five key questions based on the documents:

1. **What problem are they solving?** - Identify the core problem or pain point the company is addressing. Be specific about the market need.

2. **How are they solving this problem?** - Describe their solution, approach, and unique value proposition. What makes their solution different?

3. **What is their ideal customer profile?** - Describe who their target customers are: demographics, use cases, pain points, and why they would buy this solution.

4. **What is exciting about this deal?** - Provide 3-5 bullet points highlighting the most compelling aspects: market opportunity, team strengths, traction, competitive advantages, or unique insights.

5. **What is concerning about this deal?** - Provide 3-5 bullet points identifying key risks, challenges, or red flags: execution risks, market concerns, competition, or gaps in the pitch.

6. **Due Diligence Follow-up** - Based on your deep analysis of the documents, scoring, and identified gaps:
   - **Top 3 Questions for the Founder**: Generate 3 highly specific, tactical questions that address:
     * Critical assumptions you identified that need validation
     * Specific gaps in the business model, go-to-market strategy, or unit economics
     * The most concerning risks or challenges you scored poorly
     * Missing details about competitive advantages, market positioning, or execution plans
     **CRITICAL**: Make these questions SPECIFIC to THIS company, their actual product/market/strategy. Reference specific details from their materials. Avoid generic questions like "What's your traction?" Instead: "Given your $50K MRR and 15 customers, what's driving the 30% month-over-month churn rate mentioned in the deck?"
   - **Primary Concern**: Identify the single most concerning aspect that would most likely derail this investment or cause failure. Be specific and reference your scoring analysis.
   - **Critical Information Gaps**: List the exact documents, metrics, data points, or evidence that are missing and would materially change your investment decision. Be specific (e.g., "Unit economics data including CAC, LTV, payback period by customer segment" not "more financial data").

---

## Scoring Criteria:

${criteriaSections}

---

## Required Category and Criterion Names

Use these names exactly in your JSON output. Do not rename, merge, or invent categories/criteria:

${truncateForPrompt(strictNameMap, limits.strictNameMap)}

---

## Criterion-Specific Evidence Retrieval Context

Use this section to ground each criterion in specific supporting snippets. If a criterion has weak or missing evidence, mark evidenceStatus accordingly and generate follow-up questions to close the gap.

${criterionContextText}

---

## Instructions:

**CRITICAL SCORING RULES - Evidence-Based Analysis:**

1. **Prioritize Information Sources in This Order:**
   - ✅ **HIGHEST PRIORITY**: Investor notes and manually edited thesis (these reflect deep human analysis)
   - ✅ **SECOND PRIORITY**: Extracted structured facts from documents (verified data points)
   - ✅ **THIRD PRIORITY**: Scoring criteria definitions (framework to apply)

2. **Evidence Citation Requirements:**
   - Every score MUST have specific evidence from the extracted facts or notes
   - Use direct quotes or specific data points (not generic statements)
   - If a criterion lacks evidence, score conservatively and note the gap
   - Evidence array should contain: specific metrics, quotes, or fact references

3. **Avoid Generic Analysis:**
   - ❌ BAD: "Strong team with relevant experience"
   - ✅ GOOD: "CEO has 8 years at Tesla leading battery division (extracted facts: Team section)"
   - ❌ BAD: "Large market opportunity"
   - ✅ GOOD: "TAM: $12B manufacturing software market growing at 18% CAGR (extracted facts: Market section)"

4. **Weight Your Sources:**
   - If investor notes contradict document data, heavily favor the notes (they have context)
   - If data quality is low, note it and score accordingly
   - Missing information = lower score + explicit mention in reasoning

5. **Be Specific in Reasoning:**
   - Reference exact sections from extracted facts
   - Cite specific numbers, dates, metrics
   - Explain why the evidence led to that score

6. **Confidence Calibration (Required Per Criterion):**
   - Return confidence score from 0-100 for each criterion
   - 80-100: strong direct evidence with concrete metrics
   - 60-79: decent evidence but some assumptions
   - 40-59: weak evidence, partial support
   - 0-39: insufficient evidence or contradictions

7. **Evidence Status (Required Per Criterion):**
   - "supported": clear direct evidence supports the score
   - "weakly_supported": some support but important gaps remain
   - "unknown": not enough evidence to score confidently
   - "contradicted": evidence conflicts with key claims

8. **Missing Data + Follow-Up Questions (Required Per Criterion):**
   - missingData: list exact missing facts/metrics that affect this criterion
   - followUpQuestions: 1-3 tactical, company-specific questions to resolve gaps
   - Also provide a top-level followUpQuestions array with the best 5 overall questions

9. **Name Fidelity (Required):**
   - For each category object, "category" must exactly match one category name from "Required Category and Criterion Names"
   - For each criterion object, "name" must exactly match one criterion under that category
   - If evidence is sparse, still return the exact category/criterion names with conservative scoring

10. **Reasoning Structure (Required Per Criterion):**
   - Write each criterion reasoning in natural prose (no section labels).
   - Include these three elements in one concise narrative: what you conclude, the concrete support (metric/quote/fact), and why it changes conviction/risk.
   - Avoid generic statements without concrete facts.
   - If no concrete evidence exists, explicitly state that and mark conservative implications.

11. **Thesis Concerns + Follow-Up Specificity (Required):**
   - "concerning" bullets must reference a concrete metric, claim, contradiction, or missing evidence.
   - Founder follow-up questions must reference specific evidence gaps (not generic startup questions).
   - For each follow-up question, include enough context so the founder knows exactly what data is being requested.

12. **External Research Integration (Required):**
   - Compare company-claimed TAM/SAM/SOM against the independent estimate in External Market Intelligence.
   - If claims appear overstated or low-confidence, score Market criteria more conservatively and explain why.
   - Use competitor funding and overlap data to assess competitive risk and defensibility.

13. **TAM Criterion Framework (Required):**
   - For the TAM criterion, explicitly compare:
     1) Founder-claimed TAM (from Source of Truth Metrics / founder intake),
     2) Independent TAM estimate (External Market Intelligence).
   - Include both values in reasoning and classify alignment: aligned, somewhat_aligned, overstated, understated, or unknown.
   - Base TAM criterion scoring primarily on this comparison (not generic market language).
   - If either side is missing, lower confidence and score conservatively.

14. **Team Criterion Framework (Required):**
   - For team/founder criteria (including "What are the strengths and proof points of the team?"), explicitly incorporate Team Research Signal.
   - In reasoning, reference:
     1) specific prior exits (if any),
     2) CEO has-been-CEO signal,
     3) CTO has-been-CTO signal.
   - If those signals are missing or weak, keep confidence conservative and state evidence gaps explicitly.

15. **Source of Truth Metrics Precedence (Required):**
   - If ARR/TAM/Market Growth/ACV/YoY Growth metrics are provided in "Source of Truth Metrics", treat them as authoritative.
   - Only deviate if stronger contradictory evidence is explicitly present, and then call out the contradiction in reasoning.
   - Do not mark a concern as negative if cited metric evidence is strictly positive.

16. **Industry Criterion Framework (Required):**
   - For industry-oriented criteria, apply both:
     1) priority spend sector fit, and
     2) workflow/data/adoption thesis fit.
   - A company can score well via either (or both) if evidence is concrete.
  - Do not over-score based on sector label alone; require specific operational proof points.

17. **Location Criterion Framework (Required):**
   - Prefer U.S.-based teams, with Canada as generally acceptable.
   - Treat remote/distributed as acceptable but below a clear U.S. location unless other evidence is very strong.
   - Score outside U.S./Canada conservatively for this fund mandate.
   - If location evidence is unclear, reduce confidence and call out the missing data.

18. **Portfolio Synergy Criterion Framework (Required):**
   - For portfolio-synergy criteria, explicitly evaluate overlap in:
     1) similar space,
     2) similar customer base,
     3) complementary offering/partnership potential.
   - Reference specific Mudita portfolio company examples when evidence exists.
   - If no concrete overlap is found, score conservatively and state the evidence gap.

19. **Problem Necessity Criterion Framework (Required):**
   - For necessity criteria, explicitly classify using Vitamin / Advil / Vaccine.
   - Support classification with concrete evidence on urgency, consequence of inaction, recurrence, and mandate/compliance.
   - If evidence is sparse, keep classification conservative and lower confidence.

20. **Market Growth Criterion Framework (Required):**
   - For market growth criteria, explicitly assess how quickly/slowly the market is growing using the Market Growth Signal.
   - Include estimated CAGR (or explicitly state unknown), growth band (high/moderate/low/unknown), confidence, and at least one concrete evidence line.
   - Use this baseline score rubric (adjust +/-10 only with strong company-specific evidence):
     * High growth (>=20% CAGR): 75-90
     * Moderate growth (8%-19% CAGR): 55-74
     * Low growth (0%-7% CAGR): 35-54
     * Negative/contracting growth: 20-40
     * Unknown growth (insufficient evidence): 30-50 max
   - Confidence requirements:
     * >=80 only with 2+ concrete, recent evidence points.
     * 60-79 with one strong source or multiple weak signals.
     * <=59 when evidence is sparse, indirect, conflicting, or stale.
   - Evidence status requirements:
     * "supported" only when CAGR/growth claim is directly evidenced.
     * "weakly_supported" when growth is inferred from partial signals.
     * "unknown" when no reliable growth signal exists.
   - Missing-data requirements:
     * If confidence <70, include explicit missingData entries (e.g., source recency, segment-specific growth, regional split, methodology).
   - If growth evidence is weak or missing, lower confidence and score conservatively.

Provide your analysis in the following JSON format:

\`\`\`json
{
  "companyOneLiner": "1-2 sentence description of what the company does. Do NOT start with the company name. (e.g., 'AI-powered logistics software for manufacturing companies that reduces quoting time by 80% through automated CAD analysis.')",
  "industry": "Primary industry/vertical/market sector the company operates in or serves (e.g., 'Real Estate', 'Healthcare', 'Manufacturing', 'Financial Services', 'Logistics', 'E-commerce', 'Education'). Prefer the vertical/market over business model.",
  "founders": [
    {
      "name": "Founder Name",
      "linkedinUrl": "https://www.linkedin.com/in/profile (if found in documents or known)",
      "title": "CEO" 
    }
  ],
  "thesisAnswers": {
    "problemSolving": "The company addresses [specific problem] which affects [target market]. The pain point is [describe pain]...",
    "solution": "They solve this through [approach/technology]. Their unique value proposition is [differentiation]...",
    "idealCustomer": "The ideal customer is [customer description]. They typically [use case/context]. They would buy because [value proposition]...",
    "exciting": [
      "Market opportunity details and growth potential",
      "Strong founding team with relevant experience",
      "Demonstrated product-market fit with traction metrics"
    ],
    "concerning": [
      "Execution risk in specific area",
      "Competitive pressure from established players",
      "Limited financial runway or unclear path to profitability"
    ],
    "founderQuestions": {
      "questions": [
        "Specific question about strategy/execution based on analysis",
        "Question addressing a critical gap or validation need",
        "Question about the most concerning aspect identified"
      ],
      "primaryConcern": "The single most concerning aspect requiring immediate clarification (e.g., 'Unclear path to profitability with current pricing model')",
      "keyGaps": "Specific missing information that would impact decision (e.g., 'No unit economics, CAC/LTV data, or customer retention metrics provided')"
    }
  },
  "overall": 75,
  "dataQuality": 80,
  "followUpQuestions": [
    "Five best overall due diligence follow-up questions based on missing evidence and risks"
  ],
  "rescoreExplanation": "Optional: Only include if this is a re-score. Explain what changed and why. Example: 'Team score increased from 65 to 78 after discovering founder has 2 successful exits. Market score decreased from 82 to 75 due to new competitive intelligence showing 3 well-funded competitors we were unaware of.'",
  "categories": [
    {
      "category": "Team",
      "score": 85,
      "weight": 25,
      "weightedScore": 21.25,
      "criteria": [
        {
          "name": "Founder Experience",
          "score": 90,
          "confidence": 88,
          "evidenceStatus": "supported",
          "reasoning": "Founders have 10+ years experience in the industry...",
          "evidence": [
            "Quote from document supporting this score",
            "Another relevant quote"
          ],
          "missingData": [
            "No quantified team hiring plan for next 12 months"
          ],
          "followUpQuestions": [
            "You cite founder-led enterprise sales. What is the hiring timeline for first 2 AEs and expected ramp productivity?"
          ]
        }
      ]
    }
  ]
}
\`\`\`

**Scoring Guidelines:**
- Score each criterion from 0-100 (0 = major concern, 50 = meets expectations, 100 = exceptional)
- Calculate weighted scores: criterion_score × category_weight ÷ 100
- Overall score is the sum of all weighted category scores
- Provide specific evidence quotes from documents
- Identify 3-5 key strengths and 3-5 key concerns
- Data quality (0-100) reflects completeness of information: 100 = comprehensive data, 50 = adequate but gaps, 0 = insufficient data
- Be objective and analytical
- If information is missing for a criterion, note it in reasoning and score accordingly

**Important:**
- Quote specific passages from documents as evidence
- Be consistent in scoring across criteria
- Consider both quantitative and qualitative factors
- Focus on investment decision-making relevance
- Make founder questions highly specific to THIS company's actual situation, not generic startup questions
- Reference specific data points, metrics, or statements from the documents when formulating questions`;
}

function buildCategoryScoringPrompt(
  companyName: string,
  companyUrl: string | undefined,
  extractedFacts: string,
  category: CriteriaCategory,
  criterionContexts: CriterionContext[],
  externalMarketIntelligence?: ExternalMarketIntelligence,
  hubspotCompanyData?: HubSpotCompanyData,
  sourceOfTruthMetrics?: DiligenceMetrics,
  teamResearch?: TeamResearch,
  portfolioSynergyResearch?: PortfolioSynergyResearch,
  problemNecessityResearch?: ProblemNecessityResearch,
  userNotes?: string,
  categorizedNotes?: Array<{ id: string; category: string; content: string; createdAt: string; updatedAt: string }>,
  questions?: DiligenceQuestion[],
  previousScore?: DiligenceScore
): string {
  const categoryCriteria = category.criteria
    .map(c => `- ${c.name}: ${c.description}\n  Guidance: ${c.scoringGuidance}`)
    .join('\n');

  const categoryNotes = (categorizedNotes || [])
    .filter(note => note.category === category.name || note.category.toLowerCase() === 'overall')
    .map(note => `- ${note.content}`)
    .join('\n');

  const scopedContexts = criterionContexts.filter(context => context.category === category.name);
  const userCriterionContext = formatUserProvidedCriterionContext(previousScore, category.name);
  const stateOfInvestorsSignal = formatStateOfInvestorsSignal(sourceOfTruthMetrics, hubspotCompanyData);
  const teamResearchSignal = formatTeamResearchSignal(teamResearch);
  const industryThesisSignal = formatIndustryThesisSignal(hubspotCompanyData);
  const marketGrowthSignal = formatMarketGrowthSignal(externalMarketIntelligence, sourceOfTruthMetrics);
  const portfolioSynergySignal = formatPortfolioSynergySignal(portfolioSynergyResearch);
  const problemNecessitySignal = formatProblemNecessitySignal(problemNecessityResearch);

  // Build questions section for category
  let categoryQuestionsSection = '';
  if (questions && questions.length > 0) {
    const answeredQuestions = questions.filter(q => q.status === 'answered');
    const openQuestions = questions.filter(q => q.status === 'open');

    if (answeredQuestions.length > 0) {
      const answeredText = answeredQuestions.map(q => 
        `Q: ${q.question}\nA: ${q.answer || '(No answer provided)'}`
      ).join('\n\n');
      categoryQuestionsSection += `\n## Resolved Questions (Confirmed Facts)\n${answeredText}\n`;
    }

    if (openQuestions.length > 0) {
      const openText = openQuestions.map(q => `- ${q.question}`).join('\n');
      categoryQuestionsSection += `\n## Active Open Questions\n${openText}\n`;
    }
  }

  return `# Category Scoring Task
Company: ${companyName}${companyUrl ? ` (${companyUrl})` : ''}
Category: ${category.name}
Weight: ${category.weight}%

## Facts
${truncateForPrompt(extractedFacts, 12000)}

## External Market Intelligence
${truncateForPrompt(formatExternalMarketIntelligence(externalMarketIntelligence), 5000)}

${formatHubSpotCompanyData(hubspotCompanyData)}

## Source of Truth Metrics
${formatSourceOfTruthMetrics(sourceOfTruthMetrics)}

${userCriterionContext}

${stateOfInvestorsSignal}

${teamResearchSignal}

${industryThesisSignal}

${marketGrowthSignal}

${portfolioSynergySignal}

${problemNecessitySignal}

## Relevant Notes
${truncateForPrompt(categoryNotes || userNotes || 'No investor notes provided.', 2500)}
${categoryQuestionsSection}
## Criteria In Scope
${categoryCriteria}

## Criterion Evidence Snippets
${truncateForPrompt(formatCriterionContexts(scopedContexts), 7000)}

Return JSON:
{
  "category": "${category.name}",
  "score": 0-100,
  "criteria": [
    {
      "name": "EXACT criterion name from above",
      "score": 0-100,
      "confidence": 0-100,
      "evidenceStatus": "supported | weakly_supported | unknown | contradicted",
      "reasoning": "Specific reasoning with data points",
      "evidence": ["Specific quotes or metrics"],
      "missingData": ["What is missing for confidence"],
      "followUpQuestions": ["1-3 tactical questions for this criterion"]
    }
  ]
}

Rules:
- Use EXACT criterion names listed above.
- Be specific and non-generic.
- If evidence is weak, lower confidence and use unknown/weakly_supported.
- Keep evidence tied to numbers or concrete claims whenever possible.
- Write criterion reasoning as natural prose with a clear conclusion, concrete support, and investment implication.
- Avoid phrases like "strong team" or "large market" unless backed by specific facts/metrics.
- For Market/Product criteria, explicitly reference TAM/SAM/SOM comparison and competitor threat data when available.
- For the TAM criterion, explicitly compare founder-claimed TAM vs independent TAM estimate and classify alignment before finalizing score.
- For team/founder criteria (including "What are the strengths and proof points of the team?"), explicitly cite prior exits and CEO/CTO role-history signals from Team Research Signal when available.
- For industry criteria, explicitly evaluate both sector priority fit and workflow/data/adoption thesis fit with concrete evidence.
- For location criteria, apply the fund location rubric (U.S. preferred, Canada acceptable, remote decent, outside U.S./Canada conservative).
- For portfolio-synergy criteria, explicitly analyze similar space, similar customer base, and complementary offering opportunities versus named Mudita portfolio companies.
- For necessity criteria, explicitly apply Vitamin/Advil/Vaccine framing with concrete urgency and consequence-of-inaction evidence.
- For market growth criteria:
  * Explicitly use Market Growth Signal (estimated CAGR + growth band + confidence + evidence).
  * Apply this baseline rubric: high growth (>=20%) => 75-90, moderate (8%-19%) => 55-74, low (0%-7%) => 35-54, negative growth => 20-40, unknown => max 50.
  * Do not use evidenceStatus="supported" unless a concrete growth rate or equivalent direct evidence is present.
  * If confidence <70, include missingData describing what growth evidence is absent (recency, methodology, segment breakdown, geography).
- Use Source of Truth metrics (ARR/TAM/Market Growth/ACV/YoY Growth) as authoritative when present unless stronger contradictory evidence exists.
- If ARR is missing but materials cite signed/paid pilots, design partners, LOIs, or named customer deployments, treat that as early commercial traction (not zero traction). Reflect it in reasoning with appropriately conservative confidence.
- Do not claim a negative risk if the cited metric evidence is only positive.`;
}

function buildSynthesisPrompt(
  companyName: string,
  companyUrl: string | undefined,
  extractedFacts: string,
  categories: CategoryScore[],
  externalMarketIntelligence?: ExternalMarketIntelligence,
  hubspotCompanyData?: HubSpotCompanyData,
  sourceOfTruthMetrics?: DiligenceMetrics,
  previousScore?: DiligenceScore,
  questions?: DiligenceQuestion[]
): string {
  const categorySummary = categories
    .map(category => {
      const lowConfidence = category.criteria
        .filter(c => (c.confidence ?? 0) < 60)
        .map(c => c.name)
        .slice(0, 2)
        .join(', ');
      return `- ${category.category}: ${category.score}/100${lowConfidence ? ` (low confidence: ${lowConfidence})` : ''}`;
    })
    .join('\n');

  // Build questions section for synthesis
  let synthesisQuestionsSection = '';
  if (questions && questions.length > 0) {
    const answeredQuestions = questions.filter(q => q.status === 'answered');
    const openQuestions = questions.filter(q => q.status === 'open');

    if (answeredQuestions.length > 0) {
      const answeredText = answeredQuestions.map(q => 
        `Q: ${q.question}\nA: ${q.answer || '(No answer provided)'}`
      ).join('\n\n');
      synthesisQuestionsSection += `\n## Resolved Questions (Confirmed Facts)\n${answeredText}\n**CRITICAL**: DO NOT regenerate these answered questions in your "Top 3 Questions for the Founder" or follow-up recommendations. They are resolved.\n`;
    }

    if (openQuestions.length > 0) {
      const openText = openQuestions.map(q => `- ${q.question}`).join('\n');
      synthesisQuestionsSection += `\n## Active Open Questions\n${openText}\n`;
    }
  }

  return `# Diligence Synthesis Task
Company: ${companyName}${companyUrl ? ` (${companyUrl})` : ''}

## Extracted Facts
${truncateForPrompt(extractedFacts, 12000)}

## Category Scores
${categorySummary}

## External Market Intelligence
${truncateForPrompt(formatExternalMarketIntelligence(externalMarketIntelligence), 6000)}

${formatHubSpotCompanyData(hubspotCompanyData)}

## Source of Truth Metrics
${formatSourceOfTruthMetrics(sourceOfTruthMetrics)}

${previousScore ? `## Previous Overall Score\n${previousScore.overall}/100` : ''}
${synthesisQuestionsSection}
Return JSON:
{
  "companyOneLiner": "1-2 sentence company description (do NOT start with company name)",
  "industry": "Primary industry/vertical/market (prefer vertical over business model, e.g., 'Real Estate' not 'B2B SaaS')",
  "founders": [{"name":"", "linkedinUrl":"", "title":""}],
  "dataQuality": 0-100,
  "thesisAnswers": {
    "problemSolving": "...",
    "solution": "...",
    "idealCustomer": "...",
    "exciting": ["..."],
    "concerning": ["..."],
    "founderQuestions": {
      "questions": ["...", "...", "..."],
      "primaryConcern": "...",
      "keyGaps": "..."
    }
  },
  "followUpQuestions": ["Top 5 overall follow-up questions"],
  "rescoreExplanation": "Only when previous score exists"
}

Rules:
- Questions must be highly specific to this company and the evidence gaps.
- Keep outputs concise, concrete, and evidence-aware.
- "concerning" bullets must include substantiated evidence or explicit missing data.
- Founder questions must request specific metrics, documents, or timelines tied to weak criteria.
- Include at least one concern or follow-up grounded in external TAM/SAM/SOM or competitor findings when available.
- Use Source of Truth metrics as authoritative unless explicit stronger contradictions are present.`;
}

async function scoreDiligenceByCategory(
  criteria: DiligenceCriteria,
  companyName: string,
  companyUrl: string | undefined,
  extractedFacts: string,
  criterionContexts: CriterionContext[],
  externalMarketIntelligence?: ExternalMarketIntelligence,
  userNotes?: string,
  categorizedNotes?: Array<{ id: string; category: string; content: string; createdAt: string; updatedAt: string }>,
  questions?: DiligenceQuestion[],
  hubspotCompanyData?: HubSpotCompanyData,
  teamResearch?: TeamResearch,
  portfolioSynergyResearch?: PortfolioSynergyResearch,
  problemNecessityResearch?: ProblemNecessityResearch,
  previousScore?: DiligenceScore,
  calibrationProfile?: CalibrationProfile,
  sourceOfTruthMetrics?: DiligenceMetrics
): Promise<{
  score: DiligenceScore;
  metrics: DiligenceMetrics;
  companyMetadata: { companyOneLiner?: string; industry?: string; founders?: Array<{ name: string; linkedinUrl?: string; title?: string }> };
}> {
  const systemPrompt = 'You are an expert VC analyst. Return valid JSON only.';
  const scoredCategories: CategoryScore[] = [];

  for (const category of criteria.categories) {
    const categoryPrompt = buildCategoryScoringPrompt(
      companyName,
      companyUrl,
      extractedFacts,
      category,
      criterionContexts,
      externalMarketIntelligence,
      hubspotCompanyData,
      sourceOfTruthMetrics,
      teamResearch,
      portfolioSynergyResearch,
      problemNecessityResearch,
      userNotes,
      categorizedNotes,
      questions,
      previousScore
    );
    console.log(`Scoring category chunk: ${category.name} (${Math.round(categoryPrompt.length / 4)} est. tokens)`);
    const categoryJson = await callOpenAIJson(systemPrompt, categoryPrompt, 0.2, 3);
    scoredCategories.push(normalizeSingleCategoryScore(category, categoryJson));
    await sleep(300);
  }

  const calibratedCategories = applyManualCalibration(scoredCategories, calibrationProfile);
  const externallyAdjustedCategories = applyExternalMarketPenalties(calibratedCategories, externalMarketIntelligence);
  const tamCalibratedCategories = applyTamComparisonCalibration(
    externallyAdjustedCategories,
    externalMarketIntelligence,
    sourceOfTruthMetrics,
    hubspotCompanyData
  );
  const marketGrowthCalibratedCategories = applyMarketGrowthCalibration(
    tamCalibratedCategories,
    externalMarketIntelligence,
    sourceOfTruthMetrics
  );
  const teamCalibratedCategories = applyTeamResearchCalibration(marketGrowthCalibratedCategories, teamResearch);
  const portfolioCalibratedCategories = applyPortfolioSynergyCalibration(
    teamCalibratedCategories,
    portfolioSynergyResearch
  );
  const necessityCalibratedCategories = applyProblemNecessityCalibration(
    portfolioCalibratedCategories,
    problemNecessityResearch
  );
  const fundingGuardedCategories = applyFundingRaiseGuard(
    necessityCalibratedCategories,
    sourceOfTruthMetrics,
    extractedFacts,
    userNotes
  );
  const earlyTractionCalibratedCategories = applyEarlyTractionCalibration(
    fundingGuardedCategories,
    extractedFacts,
    userNotes
  );
  const categoriesWithPreservedAnswers = fillMetricBackedCriterionAnswers(
    preserveCriterionAnswers(earlyTractionCalibratedCategories, previousScore),
    sourceOfTruthMetrics,
    `${extractedFacts}\n${userNotes || ''}`
  );
  const overall = recalculateOverallFromCategories(categoriesWithPreservedAnswers);

  const synthesisPrompt = buildSynthesisPrompt(
    companyName,
    companyUrl,
    extractedFacts,
    categoriesWithPreservedAnswers,
    externalMarketIntelligence,
    hubspotCompanyData,
    sourceOfTruthMetrics,
    previousScore,
    questions
  );
  const synthesisJson = await callOpenAIJson(systemPrompt, synthesisPrompt, 0.25, 3);
  const baselineRefinedThesisAnswers = enforceThesisSpecificity(
    synthesisJson?.thesisAnswers,
    categoriesWithPreservedAnswers,
    previousScore
  );
  const investorGradeQuestioning = await generateInvestorGradeQuestioningPass(
    companyName,
    baselineRefinedThesisAnswers,
    categoriesWithPreservedAnswers
  );
  const mergedThesisAnswers = mergeThesisAnswers(
    baselineRefinedThesisAnswers,
    investorGradeQuestioning?.thesisAnswers
  );
  const refinedThesisAnswers = enforceThesisSpecificity(
    mergedThesisAnswers,
    categoriesWithPreservedAnswers,
    previousScore
  );
  const followUpQuestions = buildFollowUpQuestions(
    {
      ...synthesisJson,
      thesisAnswers: refinedThesisAnswers,
      followUpQuestions: investorGradeQuestioning?.followUpQuestions || synthesisJson?.followUpQuestions,
    },
    categoriesWithPreservedAnswers
  );

  return {
    score: {
      overall,
      categories: categoriesWithPreservedAnswers,
      dataQuality: clampScore(synthesisJson?.dataQuality, 60),
      scoredAt: new Date().toISOString(),
      thesisAnswers: refinedThesisAnswers || undefined,
      rescoreExplanation: synthesisJson?.rescoreExplanation || undefined,
      followUpQuestions,
      externalMarketIntelligence,
    },
    metrics: sourceOfTruthMetrics || {},
    companyMetadata: {
      companyOneLiner: synthesisJson?.companyOneLiner || undefined,
      industry: synthesisJson?.industry || undefined,
      founders: synthesisJson?.founders || undefined,
    },
  };
}

/**
 * Build chat context for discussing diligence
 */
export function buildChatContext(
  companyName: string,
  documents: { fileName: string; text: string; type: string }[],
  score: DiligenceScore | null,
  criteria: DiligenceCriteria,
  userNotes?: string,
  categorizedNotes?: Array<{ id: string; category: string; content: string; createdAt: string; updatedAt: string }>
): string {
  // Truncate document content more aggressively for chat context
  // Chat needs to be more responsive and fit within token limits
  // Limit total document content to ~40k chars (~10k tokens) to leave room for conversation
  const MAX_CHAT_DOCUMENT_CHARS = 40000;
  const charPerDoc = Math.min(5000, Math.floor(MAX_CHAT_DOCUMENT_CHARS / Math.max(documents.length, 1)));
  
  const documentContent = documents.map(doc => 
    `### ${doc.fileName} (${doc.type}):\n${doc.text.slice(0, charPerDoc)}${doc.text.length > charPerDoc ? '\n[... document truncated for chat context ...]' : ''}\n`
  ).join('\n');

  let scoreContext = '';
  if (score) {
    let thesisContext = '';
    if (score.thesisAnswers) {
      const excitingPoints = Array.isArray(score.thesisAnswers.exciting) 
        ? score.thesisAnswers.exciting.map(e => `  - ${e}`).join('\n')
        : `  - ${score.thesisAnswers.exciting}`;
      
      const concerningPoints = Array.isArray(score.thesisAnswers.concerning)
        ? score.thesisAnswers.concerning.map(c => `  - ${c}`).join('\n')
        : `  - ${score.thesisAnswers.concerning}`;

      const founderQuestionsContext = score.thesisAnswers.founderQuestions ? `
- **Top Questions for Founder**:
${score.thesisAnswers.founderQuestions.questions.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}
- **Primary Concern**: ${score.thesisAnswers.founderQuestions.primaryConcern}
- **Key Information Gaps**: ${score.thesisAnswers.founderQuestions.keyGaps}
` : '';

      thesisContext = `

### Investment Thesis:
- **Problem**: ${score.thesisAnswers.problemSolving}
- **Solution**: ${score.thesisAnswers.solution}
- **Ideal Customer**: ${score.thesisAnswers.idealCustomer}
- **Exciting Aspects**:
${excitingPoints}
- **Concerning Aspects**:
${concerningPoints}
${founderQuestionsContext}
`;
    }

    scoreContext = `

## Current Diligence Score:
- Overall: ${score.overall}/100
- Data Quality: ${score.dataQuality}/100
${score.followUpQuestions && score.followUpQuestions.length > 0 ? `- **Top Follow-Up Questions**:\n${score.followUpQuestions.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}` : ''}
${thesisContext}

### Category Scores:
${score.categories.map(cat => `- ${cat.category}: ${cat.score}/100 (weight: ${cat.weight}%)`).join('\n')}`;
  }

  // Build notes context (prioritize categorized notes)
  let notesContext = '';
  
  if (categorizedNotes && categorizedNotes.length > 0) {
    const notesByCategory = categorizedNotes.reduce((acc, note) => {
      if (!acc[note.category]) acc[note.category] = [];
      acc[note.category].push(note);
      return acc;
    }, {} as Record<string, typeof categorizedNotes>);
    
    const categorizedNotesText = Object.entries(notesByCategory)
      .map(([category, notes]) => {
        const notesText = notes.map(n => `- ${n.content}`).join('\n');
        return `### ${category}\n${notesText}`;
      })
      .join('\n\n');
    
    notesContext = `

## 🔍 Investor's Categorized Notes and Observations:

${categorizedNotesText}

**CRITICAL**: The notes above are from the investor/analyst reviewing this deal, organized by investment criteria category. These contain valuable insider context, concerns, questions, and observations. Treat these notes as high-priority context when answering questions, especially when discussing specific categories.
`;
  } else if (userNotes) {
    // Legacy single note field
    notesContext = `

## 🔍 Investor's Notes and Observations:
${userNotes}

**CRITICAL**: The notes above are from the investor/analyst reviewing this deal. These contain valuable insider context, concerns, questions, and observations. Treat these notes as high-priority context when answering questions.
`;
  }

  return `You are an expert venture capital analyst discussing due diligence on ${companyName}.

## Document Content:
${documentContent}

${scoreContext}${notesContext}

## Your Role and Capabilities:
You should provide comprehensive investment analysis by:

1. **Analyze the provided documents** - Review the pitch deck and materials provided
2. **Apply your broader knowledge** - Use your understanding of markets, industries, competitors, and business models
3. **Provide independent estimates** - Make your own TAM calculations, market sizing, and financial projections based on industry knowledge
4. **Research-backed insights** - Draw on your knowledge of similar companies, market trends, and industry benchmarks
5. **Critical analysis** - Challenge assumptions in the deck, identify gaps, and provide objective assessment
6. **Investment recommendations** - Give clear guidance on whether this is an attractive opportunity

**Important Guidelines:**
- Don't limit yourself to only what's in the documents - use your knowledge of the industry, market, and competitive landscape
- If asked about TAM, market size, or projections, provide your own independent analysis based on industry knowledge
- Compare this company to similar companies or market leaders you know about
- Identify what's NOT in the deck that should be there
- Be direct and analytical - this is for professional investors
- When you provide estimates or analysis beyond the documents, explain your reasoning and assumptions

Be insightful, proactive, and use both the documents AND your broader expertise to support the investment decision.`;
}
