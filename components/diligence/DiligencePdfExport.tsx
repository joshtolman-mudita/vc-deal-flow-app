"use client";

import React, { useRef, useState, useEffect } from 'react';
import { DiligenceRecord, HubSpotCompanyData, DiligenceMetrics } from '@/types/diligence';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface DiligencePdfExportProps {
  record: DiligenceRecord;
  selectedSections: Set<string>;
  onComplete: () => void;
}

export default function DiligencePdfExport({ record, selectedSections, onComplete }: DiligencePdfExportProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [criteriaByRowKey, setCriteriaByRowKey] = useState<Record<string, { answerBuilder?: string }>>({});
  const [criteriaByNormalizedRowKey, setCriteriaByNormalizedRowKey] = useState<Record<string, { answerBuilder?: string }>>({});
  const [recordWithComposedAnswers, setRecordWithComposedAnswers] = useState<DiligenceRecord>(record);

  // Load criteria configuration
  useEffect(() => {
    const fetchCriteria = async () => {
      try {
        const response = await fetch("/api/diligence/criteria");
        const data = await response.json();
        if (!data.success || !data.criteria) return;

        const criteriaMap: Record<string, { answerBuilder?: string }> = {};
        const normalizedCriteriaMap: Record<string, { answerBuilder?: string }> = {};
        const criteria = data.criteria as any;
        const normalizeKeyPart = (value: string) =>
          value.toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const category of criteria.categories || []) {
          for (const criterion of category.criteria || []) {
            const exactKey = `${category.name}::${criterion.name}`;
            criteriaMap[exactKey] = {
              answerBuilder: criterion.answerBuilder,
            };
            const normalizedKey = `${normalizeKeyPart(category.name)}::${normalizeKeyPart(criterion.name)}`;
            normalizedCriteriaMap[normalizedKey] = {
              answerBuilder: criterion.answerBuilder,
            };
          }
        }
        setCriteriaByRowKey(criteriaMap);
        setCriteriaByNormalizedRowKey(normalizedCriteriaMap);
      } catch (criteriaError) {
        console.warn("Failed to load criteria metadata:", criteriaError);
      }
    };

    void fetchCriteria();
  }, []);

  // Compose answers when criteria are loaded
  useEffect(() => {
    if (Object.keys(criteriaByRowKey).length === 0) return;
    
    const composedScore = buildScoreWithComposedAnswers(
      record.score,
      record.metrics,
      record.hubspotCompanyData,
      record.industry,
      record.teamResearch
    );
    
    if (composedScore) {
      setRecordWithComposedAnswers({
        ...record,
        score: composedScore,
      });
    }
  }, [criteriaByRowKey, record]);

  // Helper functions for answer composition
  const scoringGridRowKey = (categoryName: string, criterionName: string) =>
    `${categoryName}::${criterionName}`;

  const getAnswerBuilderForCriterion = (categoryName: string, criterionName: string): string | undefined => {
    const exactKey = scoringGridRowKey(categoryName, criterionName);
    const exact = criteriaByRowKey[exactKey]?.answerBuilder;
    if (exact) return exact;

    const normalizeKeyPart = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normalizedKey = `${normalizeKeyPart(categoryName)}::${normalizeKeyPart(criterionName)}`;
    const normalized = criteriaByNormalizedRowKey[normalizedKey]?.answerBuilder;
    if (normalized) return normalized;

    // Sensible fallback for team proof-point criterion when sheet template isn't configured yet.
    if (/strengths?.*proof\s*points?.*team|team.*strengths?.*proof\s*points?/i.test(criterionName)) {
      return "{{teamStrengthLabel}}";
    }
    if (/(industry|sector|vertical|what\s+space\s+is\s+it\s+in|space\s+is\s+it\s+in)/i.test(criterionName)) {
      return "Primary industry: {{industry}}.";
    }
    if (/location|hq|headquarters/i.test(criterionName)) {
      return "Company location: {{location}}.";
    }
    if (/(business\s+model|revenue\s+model|how\s+do(?:es)?\s+.*make\s+money|pricing|monetiz)/i.test(criterionName)) {
      return "{{businessModelThesis}}";
    }
    if (/(synerg|portfolio|mudita)/i.test(criterionName)) {
      return "{{portfolioSynergyLevel}}";
    }
    if (/(necess|vitamin|advil|vaccine|problem\s+they\s+are\s+solving)/i.test(criterionName)) {
      return "Problem necessity: {{problemNecessityClass}}.";
    }
    if (/(market\s*growth|how\s+quickly|how\s+slowly|growth\s+rate)/i.test(criterionName)) {
      return "Estimated market growth: {{marketGrowthRate}} ({{marketGrowthBand}}). Confidence: {{marketGrowthConfidence}}%. Evidence: {{marketGrowthEvidence}}. Summary: {{marketGrowthSummary}}.";
    }
    return undefined;
  };

  const resolvePreferredIndustry = (
    recordIndustry?: string,
    companyData?: HubSpotCompanyData | null
  ): string | undefined => {
    const preferred =
      recordIndustry?.trim() ||
      companyData?.industrySector?.trim() ||
      companyData?.investmentSector?.trim() ||
      companyData?.industry?.trim();
    return preferred || undefined;
  };

  const normalizeFounderLinkedInUrl = (value?: string): string => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^www\./i.test(trimmed) || /^linkedin\.com\//i.test(trimmed) || /^linkedin\.com$/i.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return trimmed;
  };

  const composeAnswer = (
    template: string,
    metrics?: DiligenceMetrics,
    companyData?: HubSpotCompanyData | null,
    score?: DiligenceRecord["score"] | null,
    criterionName?: string,
    recordIndustry?: string,
    teamResearch?: DiligenceRecord["teamResearch"]
  ): string => {
    if (!template.trim()) return "";

    const parseNumeric = (raw?: string): number | undefined => {
      if (!raw) return undefined;
      const cleaned = raw.replace(/[$,%\s,]/g, "");
      if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined;
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const fundingAmountRaw = metrics?.fundingAmount?.value || companyData?.fundingAmount;
    const committedRaw = metrics?.committed?.value || companyData?.currentCommitments;
    const fundingAmount = parseNumeric(fundingAmountRaw);
    const committed = parseNumeric(committedRaw);
    const percentCommitted =
      fundingAmount && fundingAmount > 0 && committed !== undefined
        ? `${Math.round((committed / fundingAmount) * 100)}%`
        : undefined;
    const commitmentBand =
      fundingAmount && fundingAmount > 0 && committed !== undefined
        ? committed / fundingAmount >= 0.5
          ? "at least half committed"
          : committed / fundingAmount > 0
            ? "partially committed"
            : "no commitments"
        : undefined;
    const founderTamFromMetrics =
      metrics?.tam?.value &&
      (metrics?.tam?.source === "manual" ||
        metrics?.tam?.sourceDetail === "notes" ||
        metrics?.tam?.sourceDetail === "hubspot")
        ? metrics.tam.value
        : undefined;
    const founderTamFromIntel = score?.externalMarketIntelligence?.tamSamSom?.companyClaim?.tam;
    const founderTam =
      founderTamFromMetrics ||
      companyData?.tamRange ||
      (founderTamFromIntel && founderTamFromIntel.toLowerCase() !== "unknown" ? founderTamFromIntel : undefined);
    const locationFromCompany = ((companyData as any)?.location || [companyData?.city, companyData?.state, companyData?.country]
      .map((item) => (item || "").trim())
      .filter(Boolean)
      .join(", ")) || undefined;
    const resolvedIndustry = resolvePreferredIndustry(recordIndustry, companyData);
    const independentTam = score?.externalMarketIntelligence?.tamSamSom?.independentEstimate?.tam;
    const tamAlignment = score?.externalMarketIntelligence?.tamSamSom?.comparison?.alignment;
    const tamComparisonConfidence = score?.externalMarketIntelligence?.tamSamSom?.comparison?.confidence;
    const tamDeltaSummary = score?.externalMarketIntelligence?.tamSamSom?.comparison?.deltaSummary;
    const tamMethod = score?.externalMarketIntelligence?.tamSamSom?.independentEstimate?.method;
    const tamAssumptions = (score?.externalMarketIntelligence?.tamSamSom?.independentEstimate?.assumptions || [])
      .filter(Boolean)
      .slice(0, 3)
      .join("; ");
    const tamDeepExplanation = [
      `Founder TAM: ${founderTam || "unknown"}`,
      `Independent TAM: ${independentTam || "unknown"}`,
      `Alignment: ${tamAlignment || "unknown"}`,
      tamComparisonConfidence !== undefined ? `Confidence: ${tamComparisonConfidence}%` : undefined,
      tamDeltaSummary ? `Delta: ${tamDeltaSummary}` : undefined,
      tamMethod ? `Method: ${tamMethod}` : undefined,
      tamAssumptions ? `Assumptions: ${tamAssumptions}` : undefined,
    ]
      .filter(Boolean)
      .join(" | ");
    const marketGrowthRate =
      metrics?.marketGrowthRate?.value ||
      score?.externalMarketIntelligence?.marketGrowth?.estimatedCagr;
    const marketGrowthBand =
      score?.externalMarketIntelligence?.marketGrowth?.growthBand ||
      (marketGrowthRate
        ? (() => {
            const match = marketGrowthRate.match(/(-?\d+(?:\.\d+)?)\s*%/);
            const pct = match ? Number(match[1]) : NaN;
            if (!Number.isFinite(pct)) return "unknown";
            if (pct >= 20) return "high";
            if (pct >= 8) return "moderate";
            if (pct >= 0) return "low";
            return "unknown";
          })()
        : "unknown");
    const marketGrowthConfidence = score?.externalMarketIntelligence?.marketGrowth?.confidence;
    const marketGrowthSummary = score?.externalMarketIntelligence?.marketGrowth?.summary;
    const marketGrowthEvidence = (score?.externalMarketIntelligence?.marketGrowth?.evidence || [])
      .filter(Boolean)
      .slice(0, 3)
      .join("; ");
    const flattenedCriteria = (score?.categories || []).flatMap((category) => category.criteria || []);
    const businessModelCriterion = flattenedCriteria.find((criterion) =>
      /(business\s+model|revenue\s+model|pricing|monetization|how\s+do(?:es)?\s+.*make\s+money)/i.test(
        criterion.name || ""
      )
    );
    const businessModelSummary = (
      businessModelCriterion?.answer ||
      businessModelCriterion?.reasoning ||
      ""
    )
      .toString()
      .trim();
    const businessModelThesis = (() => {
      const fromHubSpot = (companyData?.productCategorization || "").trim();
      const normalized = fromHubSpot.toLowerCase();
      if (normalized.includes("b2b saas")) return "B2B SaaS";
      if (normalized.includes("b2c saas")) return "B2C SaaS";
      if (normalized.includes("b2b")) return "B2B";
      if (normalized.includes("b2c")) return "B2C";
      if (normalized.includes("marketplace")) return "Marketplace";
      if (normalized.includes("subscription")) return "Subscription";
      if (normalized.includes("transaction")) return "Transaction-based";
      if (fromHubSpot) {
        return fromHubSpot
          .split(/[;|,]/)
          .map((part) => part.trim())
          .filter(Boolean)[0];
      }

      const fromReasoningMatch = businessModelSummary.match(
        /\b(B2B\s*SaaS|B2C\s*SaaS|B2B|B2C|Marketplace|Subscription|Transaction(?:-based)?)\b/i
      );
      if (fromReasoningMatch?.[1]) {
        const raw = fromReasoningMatch[1].trim();
        if (/^b2b\s*saas$/i.test(raw)) return "B2B SaaS";
        if (/^b2c\s*saas$/i.test(raw)) return "B2C SaaS";
        if (/^b2b$/i.test(raw)) return "B2B";
        if (/^b2c$/i.test(raw)) return "B2C";
        if (/^transaction/i.test(raw)) return "Transaction-based";
        return raw.charAt(0).toUpperCase() + raw.slice(1);
      }
      return undefined;
    })();
    const teamFounders = teamResearch?.founders || [];
    const teamScore = teamResearch?.teamScore;
    const teamSummary = teamResearch?.summary;
    const teamStrengthLabel = (() => {
      const exitsCount = teamFounders.flatMap((founder) => founder.priorExits || []).filter(Boolean).length;
      if (exitsCount > 0 && (teamScore === undefined || teamScore >= 65)) return "Strong team with exits";
      if ((teamScore !== undefined && teamScore >= 70) || teamFounders.length >= 2) return "Strong team";
      return "Average team";
    })();
    const teamFounderHighlights = teamFounders.length
      ? teamFounders
          .map((founder) => {
            const signals = [
              founder.hasPriorExit ? "exit" : undefined,
              founder.hasBeenCEO ? "prior CEO" : undefined,
              founder.hasBeenCTO ? "prior CTO" : undefined,
            ]
              .filter(Boolean)
              .join(", ");
            return `${founder.name}${founder.title ? ` (${founder.title})` : ""}${signals ? ` [${signals}]` : ""}`;
          })
          .join("; ")
      : undefined;
    const teamPriorExits = teamFounders
      .flatMap((founder) => founder.priorExits || [])
      .filter(Boolean)
      .slice(0, 8)
      .join("; ");
    const ceoFounder = teamFounders.find((founder) => /(^|\b)ceo(\b|$)/i.test(founder.title || ""));
    const ctoFounder = teamFounders.find((founder) => /(^|\b)cto(\b|$)/i.test(founder.title || ""));
    const portfolioSynergy = recordWithComposedAnswers?.portfolioSynergyResearch;
    const portfolioSynergyLevel = (() => {
      const scoreValue = portfolioSynergy?.synergyScore;
      if (scoreValue !== undefined) {
        if (scoreValue >= 70) return "High Synergies";
        if (scoreValue >= 40) return "Some Synergies";
        return "Minimal Synergies";
      }
      const matchesCount = portfolioSynergy?.matches?.length || 0;
      if (matchesCount >= 4) return "High Synergies";
      if (matchesCount >= 2) return "Some Synergies";
      return "Minimal Synergies";
    })();
    const portfolioSynergyTopMatches = (portfolioSynergy?.matches || [])
      .slice(0, 5)
      .map((match) => `${match.companyName} (${match.synergyType})`)
      .join("; ");
    const problemNecessity = recordWithComposedAnswers?.problemNecessityResearch;
    const problemNecessityClassLabel = (() => {
      const raw = (problemNecessity?.classification || "").trim().toLowerCase();
      if (!raw) return undefined;
      if (raw === "vitamin") return "Vitamin";
      if (raw === "advil") return "Advil";
      if (raw === "vaccine") return "Vaccine";
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    })();
    const problemNecessityTopSignals = (problemNecessity?.topSignals || [])
      .slice(0, 5)
      .map((signal) => `${signal.label}${signal.strength ? ` (${signal.strength})` : ""}`)
      .join("; ");
    const problemNecessityCounterSignals = (problemNecessity?.counterSignals || [])
      .slice(0, 5)
      .map((signal) => `${signal.label}${signal.strength ? ` (${signal.strength})` : ""}`)
      .join("; ");

    const metricValueByToken: Record<string, string | undefined> = {
      fundingAmount: metrics?.fundingAmount?.value,
      committed: metrics?.committed?.value,
      valuation: metrics?.valuation?.value,
      currentRunway: metrics?.currentRunway?.value || companyData?.currentRunway,
      location: metrics?.location?.value || locationFromCompany,
      arr: metrics?.arr?.value,
      tam: metrics?.tam?.value,
      acv: metrics?.acv?.value,
      marketGrowthRate,
      yoyGrowthRate: metrics?.yoyGrowthRate?.value,
      hsFundingAmount: metrics?.fundingAmount?.value,
      hsCurrentCommitments: metrics?.committed?.value,
      hsFundingValuation: metrics?.valuation?.value,
      hsLeadInformation: companyData?.leadInformation,
      hsCurrentRunway: metrics?.currentRunway?.value || companyData?.currentRunway,
      hsLocation: metrics?.location?.value || locationFromCompany,
      leadInformation: companyData?.leadInformation,
      lead: metrics?.lead?.value || companyData?.leadInformation,
      annualRevenue: metrics?.arr?.value,
      percentCommitted,
      commitmentBand,
      founderTam,
      independentTam,
      tamAlignment,
      tamComparisonConfidence:
        tamComparisonConfidence !== undefined ? `${tamComparisonConfidence}%` : undefined,
      tamDeltaSummary,
      tamMethod,
      tamAssumptions,
      tamDeepExplanation,
      marketGrowthBand,
      marketGrowthConfidence:
        marketGrowthConfidence !== undefined ? `${marketGrowthConfidence}%` : undefined,
      marketGrowthSummary,
      marketGrowthEvidence,
      industry: resolvedIndustry,
      businessModel: businessModelSummary || undefined,
      businessModelSummary: businessModelSummary || undefined,
      businessModelThesis,
      teamStrengthLabel,
      teamScore: teamScore !== undefined ? String(teamScore) : undefined,
      teamSummary,
      teamFounderHighlights,
      teamPriorExits: teamPriorExits || undefined,
      teamCeoExperience: ceoFounder
        ? ceoFounder.hasBeenCEO
          ? "yes"
          : "no evidence"
        : "unknown",
      teamCtoExperience: ctoFounder
        ? ctoFounder.hasBeenCTO
          ? "yes"
          : "no evidence"
        : "unknown",
      portfolioSynergyScore:
        portfolioSynergy?.synergyScore !== undefined
          ? String(portfolioSynergy.synergyScore)
          : undefined,
      portfolioSynergySummary: portfolioSynergy?.summary,
      portfolioSynergyTopMatches: portfolioSynergyTopMatches || undefined,
      portfolioSynergyLevel,
      problemNecessityScore:
        problemNecessity?.necessityScore !== undefined
          ? String(problemNecessity.necessityScore)
          : undefined,
      problemNecessityClass: problemNecessityClassLabel,
      problemNecessitySummary: problemNecessity?.summary,
      problemNecessityTopSignals: problemNecessityTopSignals || undefined,
      problemNecessityCounterSignals: problemNecessityCounterSignals || undefined,
    };

    const normalizeToken = (raw: string) =>
      raw
        .trim()
        .replace(/[{}]/g, "")
        .replace(/[\s\-\/]/g, "")
        .replace(/[^a-zA-Z0-9_]/g, "")
        .replace(/^HS/i, "hs")
        .replace(/^hs/, "hs")
        .replace(/^([a-z])/, (ch) => ch.toLowerCase());

    const toPascalCase = (value: string) =>
      value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");

    // Dynamic aliasing so new HubSpot placeholders resolve without hardcoding.
    // Example: "HS Product Categorization" -> hsProductCategorization
    if (companyData) {
      for (const [rawKey, rawValue] of Object.entries(companyData)) {
        if (typeof rawValue !== "string") continue;
        const trimmedValue = rawValue.trim();
        if (!trimmedValue) continue;
        const key = rawKey.trim();
        const normalized = normalizeToken(key);
        const pascal = toPascalCase(key);
        if (!metricValueByToken[normalized]) {
          metricValueByToken[normalized] = trimmedValue;
        }
        const hsAlias = `hs${pascal}`.replace(/^hs([A-Z])/, (_m, first) => `hs${first}`);
        if (!metricValueByToken[hsAlias]) {
          metricValueByToken[hsAlias] = trimmedValue;
        }
      }
    }

    // Guardrail: business model criteria should not use investor lead context.
    if ((criterionName || "").toLowerCase().includes("business model")) {
      delete metricValueByToken.lead;
      delete metricValueByToken.leadInformation;
      delete metricValueByToken.hsLeadInformation;
    }

    const currencyTokens = new Set([
      "fundingAmount",
      "committed",
      "valuation",
      "arr",
      "tam",
      "acv",
      "annualRevenue",
      "hsFundingAmount",
      "hsCurrentCommitments",
      "hsFundingValuation",
    ]);

    const formatCompactCurrency = (raw: string): string => {
      const cleaned = raw.replace(/[$,\s]/g, "");
      if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
        return raw;
      }
      const numeric = Number(cleaned);
      if (!Number.isFinite(numeric)) {
        return raw;
      }
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(numeric);
    };

    return template.replace(/\{\{\s*([^{}]+?)\s*\}\}|\{\s*([^{}]+?)\s*\}/g, (_match, doubleToken, singleToken) => {
      const token = normalizeToken((doubleToken || singleToken || "").toString());
      const value = metricValueByToken[token]?.trim();
      if (value && currencyTokens.has(token)) {
        return formatCompactCurrency(value);
      }
      return value || "not available";
    });
  };

  const buildScoreWithComposedAnswers = (
    score: DiligenceRecord["score"] | null | undefined,
    metrics: DiligenceMetrics | undefined,
    companyData?: HubSpotCompanyData | null,
    recordIndustry?: string,
    teamResearch?: DiligenceRecord["teamResearch"]
  ) => {
    if (!score) return score;
    return {
      ...score,
      categories: score.categories.map((category) => ({
        ...category,
        criteria: category.criteria.map((criterion) => {
          const answerBuilder = getAnswerBuilderForCriterion(category.category, criterion.name);
          if (!answerBuilder) return criterion;
          return {
            ...criterion,
            answer: composeAnswer(
              answerBuilder,
              metrics,
              companyData,
              score,
              criterion.name,
              recordIndustry,
              teamResearch
            ),
          };
        }),
      })),
    };
  };

  const getEffectiveCriterionScore = (criterion: any) => criterion?.manualOverride ?? criterion?.score ?? 0;

  const getComputedCategoryScoreFromCriteria = (category: any): number => {
    if (!category?.criteria || category.criteria.length === 0) return category?.score ?? 0;
    const total = category.criteria.reduce((sum: number, criterion: any) => sum + getEffectiveCriterionScore(criterion), 0);
    return Math.round(total / category.criteria.length);
  };

  const getEffectiveCategoryScore = (category: any) => getComputedCategoryScoreFromCriteria(category);

  const getEffectiveOverallScore = (): number => {
    const score = recordWithComposedAnswers.score;
    if (!score?.categories || score.categories.length === 0) {
      return score?.overall ?? 0;
    }
    const totalWeight = score.categories.reduce((sum, category) => sum + (category.weight || 0), 0);
    if (totalWeight <= 0) return score?.overall ?? 0;
    const weightedTotal = score.categories.reduce(
      (sum, category) => sum + (getEffectiveCategoryScore(category) * (category.weight || 0)),
      0
    );
    return Math.round(weightedTotal / totalWeight);
  };

  const formatMetricValue = (key: string, raw?: string): string => {
    const value = (raw || '').trim();
    if (!value) return 'Not set';

    if (/[%>$<]/.test(value) || /month|months|year|years|runway|unknown|n\/a/i.test(value)) {
      return value;
    }

    const currencyLike = new Set(['arr', 'tam', 'acv', 'fundingAmount', 'committed', 'valuation']);
    if (!currencyLike.has(key)) return value;

    if (/^\$/.test(value)) return value;

    const normalized = value
      .toLowerCase()
      .replace(/[, ]/g, '')
      .replace(/thousand/g, 'k')
      .replace(/million/g, 'm')
      .replace(/billion/g, 'b');

    const match = normalized.match(/^(-?\d+(?:\.\d+)?)([kmb])?$/);
    if (!match) return value;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) return value;
    const multiplier = match[2] === 'b' ? 1_000_000_000 : match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1;
    return `$${Math.round(base * multiplier).toLocaleString()}`;
  };

  const generatePdf = async () => {
    if (!contentRef.current) return;

    try {
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const contentWidth = pdfWidth - (margin * 2);
      const sectionScale = 1.5;
      const WHITE_ROW_LUMA_THRESHOLD = 246; // near-white pixel threshold
      const WHITE_ROW_REQUIRED_RATIO = 0.985; // require mostly white row to split
      const MAX_SPLIT_SEARCH_WINDOW_PX = 180; // look this far upward for clean split row

      let currentY = margin;
      let isFirstSection = true;

      const findWhitespaceSplitRow = (
        canvas: HTMLCanvasElement,
        startY: number,
        proposedSliceHeight: number
      ): number => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return proposedSliceHeight;

        const canvasWidth = canvas.width;
        const proposedBottom = startY + proposedSliceHeight;
        const minBottom = startY + Math.max(120, Math.floor(proposedSliceHeight * 0.6));
        const searchTop = Math.max(minBottom, proposedBottom - MAX_SPLIT_SEARCH_WINDOW_PX);

        for (let y = proposedBottom; y >= searchTop; y--) {
          const row = ctx.getImageData(0, y, canvasWidth, 1).data;
          let whiteLike = 0;
          for (let i = 0; i < row.length; i += 4) {
            const r = row[i];
            const g = row[i + 1];
            const b = row[i + 2];
            // Relative luminance in sRGB space.
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            if (luma >= WHITE_ROW_LUMA_THRESHOLD) whiteLike += 1;
          }
          const whiteRatio = whiteLike / canvasWidth;
          if (whiteRatio >= WHITE_ROW_REQUIRED_RATIO) {
            return Math.max(1, y - startY);
          }
        }

        return proposedSliceHeight;
      };

      // Get all section elements
      const sections = contentRef.current.querySelectorAll('.pdf-section');

      for (const section of Array.from(sections)) {
        // Capture this section
        const canvas = await html2canvas(section as HTMLElement, {
          scale: sectionScale,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
        });
        const sectionEl = section as HTMLElement;
        const sectionRect = sectionEl.getBoundingClientRect();
        const linkTargets = Array.from(sectionEl.querySelectorAll('a[data-pdf-link]'))
          .map((anchor) => {
            const href = anchor.getAttribute('href') || '';
            if (!href) return null;
            const rect = anchor.getBoundingClientRect();
            return {
              url: href,
              x: rect.left - sectionRect.left,
              y: rect.top - sectionRect.top,
              w: rect.width,
              h: rect.height,
            };
          })
          .filter(Boolean) as Array<{ url: string; x: number; y: number; w: number; h: number }>;

        const sectionHeightPdf = (canvas.height * contentWidth) / canvas.width;
        const onePageCapacity = pdfHeight - (margin * 2);
        const isLargeSection = sectionHeightPdf > onePageCapacity;

        const addLinkOverlaysForFullSection = (sectionTopY: number, pageNumber: number) => {
          if (linkTargets.length === 0) return;
          const ratio = contentWidth / sectionRect.width;
          pdf.setPage(pageNumber);
          for (const link of linkTargets) {
            const x = margin + (link.x * ratio);
            const y = sectionTopY + (link.y * ratio);
            const w = Math.max(1, link.w * ratio);
            const h = Math.max(1, link.h * ratio);
            pdf.link(x, y, w, h, { url: link.url });
          }
        };

        if (!isLargeSection) {
          if (!isFirstSection && currentY + sectionHeightPdf > pdfHeight - margin) {
            pdf.addPage();
            currentY = margin;
          }
          const imgData = canvas.toDataURL('image/png');
          const pageNumber = pdf.getNumberOfPages();
          pdf.addImage(imgData, 'PNG', margin, currentY, contentWidth, sectionHeightPdf);
          addLinkOverlaysForFullSection(currentY, pageNumber);
          currentY += sectionHeightPdf;
        } else {
          let sourceY = 0;
          while (sourceY < canvas.height) {
            const availableHeight = pdfHeight - margin - currentY;
            if (!isFirstSection && availableHeight < 20) {
              pdf.addPage();
              currentY = margin;
            }

            const proposedSliceHeightPx = Math.max(
              1,
              Math.floor(((pdfHeight - margin - currentY) * canvas.width) / contentWidth)
            );
            const whitespaceAlignedSliceHeightPx = findWhitespaceSplitRow(
              canvas,
              sourceY,
              proposedSliceHeightPx
            );
            const actualSliceHeightPx = Math.min(
              whitespaceAlignedSliceHeightPx,
              canvas.height - sourceY
            );
            const sliceCanvas = document.createElement('canvas');
            sliceCanvas.width = canvas.width;
            sliceCanvas.height = actualSliceHeightPx;
            const ctx = sliceCanvas.getContext('2d');
            if (!ctx) break;
            ctx.drawImage(
              canvas,
              0,
              sourceY,
              canvas.width,
              actualSliceHeightPx,
              0,
              0,
              canvas.width,
              actualSliceHeightPx
            );

            const imgData = sliceCanvas.toDataURL('image/png');
            const imgHeight = (actualSliceHeightPx * contentWidth) / canvas.width;
            const pageNumber = pdf.getNumberOfPages();
            pdf.addImage(imgData, 'PNG', margin, currentY, contentWidth, imgHeight);

            if (linkTargets.length > 0) {
              const ratioPdfPerCanvasPx = contentWidth / canvas.width;
              for (const link of linkTargets) {
                const linkTopCanvas = link.y * sectionScale;
                const linkBottomCanvas = (link.y + link.h) * sectionScale;
                const sliceTop = sourceY;
                const sliceBottom = sourceY + actualSliceHeightPx;
                if (linkBottomCanvas <= sliceTop || linkTopCanvas >= sliceBottom) continue;

                const overlapTop = Math.max(linkTopCanvas, sliceTop);
                const overlapBottom = Math.min(linkBottomCanvas, sliceBottom);
                const overlayX = margin + ((link.x * sectionScale) * ratioPdfPerCanvasPx);
                const overlayY = currentY + ((overlapTop - sliceTop) * ratioPdfPerCanvasPx);
                const overlayW = Math.max(1, (link.w * sectionScale) * ratioPdfPerCanvasPx);
                const overlayH = Math.max(1, (overlapBottom - overlapTop) * ratioPdfPerCanvasPx);
                pdf.setPage(pageNumber);
                pdf.link(overlayX, overlayY, overlayW, overlayH, { url: link.url });
              }
            }

            currentY += imgHeight;
            sourceY += actualSliceHeightPx;

            if (sourceY < canvas.height) {
              pdf.addPage();
              currentY = margin;
            }
          }
        }

        isFirstSection = false;
      }

      const fileName = `${record.companyName.replace(/[^a-z0-9]/gi, '_')}_diligence_${new Date().toISOString().split('T')[0]}.pdf`;
      pdf.save(fileName);
      onComplete();
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Failed to generate PDF. Please try again.');
      onComplete();
    }
  };

  // Trigger PDF generation when component mounts
  React.useEffect(() => {
    // Small delay to ensure rendering is complete
    const timer = setTimeout(() => {
      generatePdf();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const getScoreColor = (score: number) => {
    if (score >= 75) return '#10b981'; // green
    if (score >= 50) return '#f59e0b'; // orange
    return '#ef4444'; // red
  };

  return (
    <div ref={contentRef} style={{ position: 'absolute', left: '-9999px', width: '760px', backgroundColor: '#ffffff', padding: '32px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Company Overview */}
      {selectedSections.has('overview') && (
        <div className="pdf-section" style={{ marginBottom: '40px', paddingBottom: '32px', borderBottom: '2px solid #e5e7eb' }}>
          <h1 style={{ fontSize: '30px', fontWeight: '700', marginBottom: '10px', color: '#0f172a', letterSpacing: '-0.02em' }}>
            {record.companyName}
          </h1>
          {record.companyOneLiner && (
            <p style={{ fontSize: '14px', color: '#475569', marginBottom: '16px', lineHeight: '1.55' }}>{record.companyOneLiner}</p>
          )}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {record.industry && (
              <span style={{ padding: '6px 14px', backgroundColor: '#3b82f6', color: '#ffffff', borderRadius: '16px', fontSize: '13px', fontWeight: '600', letterSpacing: '0.025em' }}>
                {record.industry}
              </span>
            )}
            <span style={{ padding: '6px 14px', backgroundColor: record.status === 'passed' ? '#ef4444' : '#10b981', color: '#ffffff', borderRadius: '16px', fontSize: '13px', fontWeight: '600', letterSpacing: '0.025em' }}>
              {record.status === 'passed' ? 'Passed On' : 'In Progress'}
            </span>
          </div>
          {record.founders && record.founders.length > 0 && (
            <div style={{ marginTop: '16px', padding: '14px', backgroundColor: '#f8fafc', borderRadius: '8px', borderLeft: '4px solid #3b82f6' }}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#64748b', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Founders</h3>
              {record.founders.map((founder, idx) => (
                <div key={idx} style={{ fontSize: '13px', color: '#334155', marginBottom: '6px', fontWeight: '500' }}>
                  {normalizeFounderLinkedInUrl(founder.linkedinUrl) ? (
                    <a
                      data-pdf-link
                      href={normalizeFounderLinkedInUrl(founder.linkedinUrl)}
                      style={{ color: '#2563eb', textDecoration: 'underline' }}
                    >
                      {founder.name}
                    </a>
                  ) : (
                    <span>{founder.name}</span>
                  )}{" "}
                  • {founder.title}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Overall Score */}
      {selectedSections.has('score') && recordWithComposedAnswers.score && (
        <div className="pdf-section" style={{ marginBottom: '40px', padding: '28px', background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '14px', color: '#0f172a', letterSpacing: '-0.02em' }}>Overall Score</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
            <div style={{ fontSize: '48px', fontWeight: '700', color: getScoreColor(getEffectiveOverallScore()), textShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              {getEffectiveOverallScore()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '15px', color: '#64748b', marginBottom: '8px', fontWeight: '600' }}>Data Quality: {recordWithComposedAnswers.score.dataQuality}%</div>
              <div style={{ height: '12px', backgroundColor: '#e2e8f0', borderRadius: '6px', overflow: 'hidden', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)' }}>
                <div style={{ height: '100%', backgroundColor: getScoreColor(recordWithComposedAnswers.score.dataQuality), width: `${recordWithComposedAnswers.score.dataQuality}%`, transition: 'width 0.3s' }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Metrics */}
      {selectedSections.has('metrics') && record.metrics && (
        <div className="pdf-section" style={{ marginBottom: '40px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '14px', color: '#0f172a', letterSpacing: '-0.02em' }}>Key Metrics</h2>
          {(() => {
            const metricCards = [
              { key: 'arr', label: 'ARR' },
              { key: 'tam', label: 'TAM' },
              { key: 'marketGrowthRate', label: 'Market Growth Rate' },
              { key: 'acv', label: 'ACV' },
              { key: 'yoyGrowthRate', label: 'YoY Growth Rate' },
              { key: 'fundingAmount', label: 'Funding Amount' },
              { key: 'committed', label: 'Committed' },
              { key: 'valuation', label: 'Valuation' },
              { key: 'lead', label: 'Lead' },
              { key: 'currentRunway', label: 'Current Runway' },
              { key: 'location', label: 'Location' },
            ]
              .map((field) => {
              const metric = (record.metrics as any)?.[field.key];
              const metricValue = metric?.value;
              if (!metricValue || !String(metricValue).trim()) return null;
              return (
                <div key={field.key} style={{ padding: '16px', backgroundColor: '#f8fafc', borderRadius: '10px', borderLeft: '4px solid #cbd5e1' }}>
                  <div style={{ fontSize: '12px', color: '#475569', marginBottom: '6px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {field.label}
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: '700', color: '#0f172a', lineHeight: '1.35' }}>
                    {formatMetricValue(field.key, metricValue)}
                  </div>
                </div>
              );
            })
              .filter(Boolean);

            if (metricCards.length === 0) {
              return <p style={{ fontSize: '14px', color: '#64748b', fontStyle: 'italic' }}>No key metrics set.</p>;
            }

            return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>{metricCards}</div>;
          })()}
        </div>
      )}

      {/* Investment Thesis */}
      {selectedSections.has('thesis') && recordWithComposedAnswers.score?.thesisAnswers && (
        <div className="pdf-section" style={{ marginBottom: '40px' }}>
          <h2 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '20px', color: '#0f172a', letterSpacing: '-0.025em' }}>Investment Thesis</h2>
          
          {recordWithComposedAnswers.score.thesisAnswers.problemSolving && (
            <div style={{ marginBottom: '20px', padding: '18px', backgroundColor: '#fef3c7', borderRadius: '10px', borderLeft: '4px solid #f59e0b' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#92400e', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Problem Being Solved</h3>
              <p style={{ fontSize: '15px', color: '#1f2937', lineHeight: '1.7' }}>{recordWithComposedAnswers.score.thesisAnswers.problemSolving}</p>
            </div>
          )}

          {recordWithComposedAnswers.score.thesisAnswers.solution && (
            <div style={{ marginBottom: '20px', padding: '18px', backgroundColor: '#dbeafe', borderRadius: '10px', borderLeft: '4px solid #3b82f6' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#1e40af', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Solution Approach</h3>
              <p style={{ fontSize: '15px', color: '#1f2937', lineHeight: '1.7' }}>{recordWithComposedAnswers.score.thesisAnswers.solution}</p>
            </div>
          )}

          {recordWithComposedAnswers.score.thesisAnswers.idealCustomer && (
            <div style={{ marginBottom: '20px', padding: '18px', backgroundColor: '#e0e7ff', borderRadius: '10px', borderLeft: '4px solid #6366f1' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#3730a3', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ideal Customer Profile</h3>
              <p style={{ fontSize: '15px', color: '#1f2937', lineHeight: '1.7' }}>{recordWithComposedAnswers.score.thesisAnswers.idealCustomer}</p>
            </div>
          )}

          {recordWithComposedAnswers.score.thesisAnswers.exciting && recordWithComposedAnswers.score.thesisAnswers.exciting.length > 0 && (
            <div style={{ marginBottom: '20px', padding: '18px', backgroundColor: '#d1fae5', borderRadius: '10px', borderLeft: '4px solid #10b981' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#065f46', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>What's Exciting</h3>
              <ul style={{ marginLeft: '20px', fontSize: '15px', color: '#1f2937', lineHeight: '1.7' }}>
                {recordWithComposedAnswers.score.thesisAnswers.exciting.map((item, idx) => (
                  <li key={idx} style={{ marginBottom: '8px' }}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {recordWithComposedAnswers.score.thesisAnswers.concerning && recordWithComposedAnswers.score.thesisAnswers.concerning.length > 0 && (
            <div style={{ marginBottom: '20px', padding: '18px', backgroundColor: '#fee2e2', borderRadius: '10px', borderLeft: '4px solid #ef4444' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#991b1b', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>What's Concerning</h3>
              <ul style={{ marginLeft: '20px', fontSize: '15px', color: '#1f2937', lineHeight: '1.7' }}>
                {recordWithComposedAnswers.score.thesisAnswers.concerning.map((item, idx) => (
                  <li key={idx} style={{ marginBottom: '8px' }}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Scoring Grid */}
      {selectedSections.has('categories') && recordWithComposedAnswers.score?.categories && (
        <div className="pdf-section" style={{ marginBottom: '40px' }}>
          <h2 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '20px', color: '#0f172a', letterSpacing: '-0.025em' }}>Scoring Grid</h2>
          {recordWithComposedAnswers.score.categories.map((category) => (
            <div key={category.category} style={{ marginBottom: '20px', padding: '20px', backgroundColor: '#ffffff', borderRadius: '10px', border: '2px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', paddingBottom: '12px', borderBottom: '2px solid #f1f5f9' }}>
                <div>
                  <span style={{ fontSize: '17px', fontWeight: '700', color: '#0f172a' }}>{category.category}</span>
                  <span style={{ fontSize: '14px', color: '#64748b', marginLeft: '10px', fontWeight: '600' }}>({category.weight}%)</span>
                </div>
                <span style={{ fontSize: '24px', fontWeight: '700', color: getScoreColor(getEffectiveCategoryScore(category)), padding: '8px 16px', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                  {getEffectiveCategoryScore(category)}
                </span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ textAlign: 'left', padding: '10px 8px', color: '#334155', fontWeight: '700', width: '22%' }}>Criterion</th>
                    <th style={{ textAlign: 'left', padding: '10px 8px', color: '#334155', fontWeight: '700', width: '18%' }}>Answer</th>
                    <th style={{ textAlign: 'left', padding: '10px 8px', color: '#334155', fontWeight: '700', width: '8%' }}>Score</th>
                    <th style={{ textAlign: 'left', padding: '10px 8px', color: '#334155', fontWeight: '700', width: '52%' }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {category.criteria.map((criterion, cIdx) => {
                    const effectiveCriterionScore = criterion.manualOverride ?? criterion.score;
                    return (
                      <tr key={criterion.name} style={{ borderBottom: cIdx < category.criteria.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                        <td style={{ verticalAlign: 'top', padding: '10px 8px', color: '#0f172a', fontWeight: '600' }}>
                          {criterion.name}
                        </td>
                        <td style={{ verticalAlign: 'top', padding: '10px 8px', color: '#334155', lineHeight: '1.5' }}>
                          {criterion.answer || 'Not set'}
                        </td>
                        <td style={{ verticalAlign: 'top', padding: '10px 8px' }}>
                          <span style={{ fontWeight: '700', color: getScoreColor(effectiveCriterionScore) }}>
                            {effectiveCriterionScore}
                          </span>
                        </td>
                        <td style={{ verticalAlign: 'top', padding: '10px 8px', color: '#475569', lineHeight: '1.55', whiteSpace: 'pre-wrap' }}>
                          {criterion.userPerspective?.trim() || criterion.reasoning || 'No details provided.'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Due Diligence Follow-up */}
      {selectedSections.has('followup') && recordWithComposedAnswers.score?.thesisAnswers?.founderQuestions && (
        <div className="pdf-section" style={{ marginBottom: '40px' }}>
          <h2 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '20px', color: '#0f172a', letterSpacing: '-0.025em' }}>Due Diligence Follow-up</h2>
          
          {recordWithComposedAnswers.score.thesisAnswers.founderQuestions.questions && recordWithComposedAnswers.score.thesisAnswers.founderQuestions.questions.length > 0 && (
            <div style={{ marginBottom: '20px', padding: '20px', backgroundColor: '#fef3c7', borderRadius: '10px', borderLeft: '4px solid #f59e0b' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#92400e', marginBottom: '14px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Top 3 Questions for the Founder</h3>
              <ol style={{ marginLeft: '24px', fontSize: '15px', color: '#1f2937', lineHeight: '1.8' }}>
                {recordWithComposedAnswers.score.thesisAnswers.founderQuestions.questions.map((q, idx) => (
                  <li key={idx} style={{ marginBottom: '12px', fontWeight: '500' }}>{q}</li>
                ))}
              </ol>
            </div>
          )}

          {recordWithComposedAnswers.score.thesisAnswers.founderQuestions.primaryConcern && (
            <div style={{ marginBottom: '20px', padding: '18px', backgroundColor: '#fee2e2', borderRadius: '10px', borderLeft: '4px solid #ef4444' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#991b1b', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Primary Concern</h3>
              <p style={{ fontSize: '15px', color: '#1f2937', lineHeight: '1.7' }}>{recordWithComposedAnswers.score.thesisAnswers.founderQuestions.primaryConcern}</p>
            </div>
          )}

          {recordWithComposedAnswers.score.thesisAnswers.founderQuestions.keyGaps && (
            <div style={{ marginBottom: '20px', padding: '18px', backgroundColor: '#dbeafe', borderRadius: '10px', borderLeft: '4px solid #3b82f6' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#1e40af', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Critical Information Gaps</h3>
              <p style={{ fontSize: '15px', color: '#1f2937', lineHeight: '1.7' }}>{recordWithComposedAnswers.score.thesisAnswers.founderQuestions.keyGaps}</p>
            </div>
          )}
        </div>
      )}

      {/* Open Questions & Answers */}
      {selectedSections.has('questions') && record.questions && record.questions.length > 0 && (
        <div className="pdf-section" style={{ marginBottom: '40px' }}>
          <h2 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '20px', color: '#0f172a', letterSpacing: '-0.025em' }}>Open Questions & Answers</h2>
          <div style={{ border: '2px solid #e5e7eb', borderRadius: '10px', padding: '16px 18px', backgroundColor: '#ffffff' }}>
            <ul style={{ margin: 0, paddingLeft: '20px', color: '#0f172a', fontSize: '14px', lineHeight: '1.7' }}>
              {record.questions.map((q) => {
                const questionText = String(q.question || '').replace(/\s+/g, ' ').trim();
                const answerText = String(q.answer || '').replace(/\s+/g, ' ').trim();
                return (
                  <li key={q.id} style={{ marginBottom: '8px' }}>
                    {answerText ? `${questionText} -> ${answerText}` : questionText}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Notes */}
      {selectedSections.has('notes') && (
        <div className="pdf-section" style={{ marginBottom: '40px' }}>
          <h2 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '20px', color: '#0f172a', letterSpacing: '-0.025em' }}>Notes</h2>
          {!record.categorizedNotes || record.categorizedNotes.length === 0 ? (
            <p style={{ fontSize: '15px', color: '#64748b', fontStyle: 'italic' }}>No notes yet.</p>
          ) : (
            Object.entries(
              record.categorizedNotes.reduce((acc, note) => {
                if (!acc[note.category]) acc[note.category] = [];
                acc[note.category].push(note);
                return acc;
              }, {} as Record<string, typeof record.categorizedNotes>)
            ).map(([category, notes]) => (
              <div key={category} style={{ marginBottom: '24px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#334155', marginBottom: '12px', paddingBottom: '8px', borderBottom: '2px solid #e5e7eb' }}>{category}</h3>
                {notes.map((note) => (
                  <div key={note.id} style={{ marginBottom: '14px', padding: '16px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    {note.title && <div style={{ fontSize: '15px', fontWeight: '600', color: '#0f172a', marginBottom: '6px' }}>{note.title}</div>}
                    <p style={{ fontSize: '14px', color: '#475569', lineHeight: '1.7', whiteSpace: 'pre-wrap' }}>{note.content}</p>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {/* Footer */}
      <div className="pdf-section" style={{ marginTop: '56px', paddingTop: '20px', borderTop: '2px solid #e5e7eb', fontSize: '13px', color: '#94a3b8', textAlign: 'center', fontWeight: '500' }}>
        Generated on {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} at {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
}
