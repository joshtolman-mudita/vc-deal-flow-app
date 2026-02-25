import { NextRequest, NextResponse } from "next/server";
import { listDiligenceRecords, updateDiligenceRecord } from "@/lib/diligence-storage";
import hubspotClient, { isHubSpotConfigured } from "@/lib/hubspot";
import type { DiligenceRecord } from "@/types/diligence";

type IndustryOption = { label: string; value: string };

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function looksLikeAccounting(value: string): boolean {
  return /\b(accounting|bookkeep|tax|cpa|audit|ledger)\b/i.test(value);
}

function mapGuessToOptionValue(guess: string, options: IndustryOption[]): string {
  const normalizedGuess = guess.trim().toLowerCase();
  if (!normalizedGuess) return "";
  const exactValue = options.find((option) => option.value.trim().toLowerCase() === normalizedGuess);
  if (exactValue) return exactValue.value;
  const exactLabel = options.find((option) => option.label.trim().toLowerCase() === normalizedGuess);
  if (exactLabel) return exactLabel.value;

  const guessTokens = Array.from(new Set(tokenize(normalizedGuess))).filter((token) => token.length >= 2);
  const tokenMatch = options.find((option) => {
    const optionTokens = new Set(tokenize(`${option.label} ${option.value}`));
    return guessTokens.some((token) => optionTokens.has(token));
  });
  if (tokenMatch) return tokenMatch.value;

  if (normalizedGuess.length < 4) return "";
  const contains = options.find((option) => {
    const label = option.label.trim().toLowerCase();
    return label.includes(normalizedGuess) || normalizedGuess.includes(label);
  });
  if (!contains) return "";
  if (contains.label.trim().toLowerCase() === "accounting" && !looksLikeAccounting(normalizedGuess)) {
    return "";
  }
  return contains.value;
}

function inferIndustryGuess(record: DiligenceRecord): string {
  const corpus = [
    record.companyName || "",
    record.companyOneLiner || "",
    record.companyDescription || "",
    record.industry || "",
    record.hubspotCompanyData?.description || "",
    record.hubspotCompanyData?.industrySector || "",
    record.hubspotCompanyData?.investmentSector || "",
  ]
    .join(" ")
    .toLowerCase();

  if (!corpus.trim()) return "";

  const rules: Array<{ pattern: RegExp; guess: string }> = [
    { pattern: /\b(computer vision|vision ai|cv models?|imaging ai|multimodal vision|image intelligence)\b/i, guess: "Artificial Intelligence" },
    { pattern: /\b(ai|artificial intelligence|machine learning|llm|foundation model|generative)\b/i, guess: "Artificial Intelligence" },
    { pattern: /\b(outdoor|camping|campground|rv park|trip planning|trail|travel)\b/i, guess: "Travel" },
    { pattern: /\b(fintech|payments|banking|lending|insurtech|insurance)\b/i, guess: "Financial Services" },
    { pattern: /\b(health|healthcare|medtech|biotech|clinical|pharma)\b/i, guess: "Healthcare" },
    { pattern: /\b(logistics|supply chain|warehouse|shipping|freight)\b/i, guess: "Logistics" },
    { pattern: /\b(real estate|property|proptech|construction)\b/i, guess: "Real Estate" },
    { pattern: /\b(cybersecurity|identity security|security operations|compliance automation)\b/i, guess: "Security" },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(corpus)) return rule.guess;
  }
  return "";
}

async function loadIndustryOptions(): Promise<IndustryOption[]> {
  if (!isHubSpotConfigured()) return [];
  try {
    const propertiesResponse: any = await hubspotClient.crm.properties.coreApi.getAll("companies");
    const properties = Array.isArray(propertiesResponse?.results) ? propertiesResponse.results : [];
    const industryProperty = properties.find((property: any) => property?.name === "industry");
    if (!industryProperty) return [];
    return (industryProperty.options || [])
      .filter((option: any) => option && option.hidden !== true && option.archived !== true)
      .map((option: any) => ({
        label: String(option.label || "").trim(),
        value: String(option.value || "").trim(),
      }))
      .filter((option: IndustryOption) => option.label && option.value);
  } catch (error) {
    console.warn("Failed to load HubSpot industry options for backfill:", error);
    return [];
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = Boolean(body?.dryRun);
    const accountingOnly = body?.accountingOnly !== false;
    const syncHubSpot = body?.syncHubSpot !== false;
    const max = Number.isFinite(Number(body?.max)) ? Math.max(1, Number(body.max)) : 500;
    const targetNames = Array.isArray(body?.companyNames)
      ? new Set(body.companyNames.map((name: unknown) => normalizeText(name).toLowerCase()).filter(Boolean))
      : null;

    const options = await loadIndustryOptions();
    const records = await listDiligenceRecords();
    let examined = 0;
    let updated = 0;
    const changes: Array<{
      id: string;
      companyName: string;
      from: string;
      to: string;
      hubspotSynced: boolean;
      warning?: string;
    }> = [];

    for (const record of records) {
      if (updated >= max) break;
      const companyNameLower = normalizeText(record.companyName).toLowerCase();
      if (targetNames && !targetNames.has(companyNameLower)) continue;

      const current = normalizeText(record.industry);
      if (accountingOnly && !/^accounting$/i.test(current)) continue;

      examined += 1;
      const guess = inferIndustryGuess(record);
      const mapped = guess && options.length > 0 ? mapGuessToOptionValue(guess, options) : "";
      const nextIndustry = normalizeText(mapped || guess);
      if (!nextIndustry) continue;
      if (current.trim().toLowerCase() === nextIndustry.trim().toLowerCase()) continue;

      let hubspotSynced = false;
      let warning: string | undefined;

      if (!dryRun) {
        await updateDiligenceRecord(record.id, { industry: nextIndustry });
        if (syncHubSpot && isHubSpotConfigured() && record.hubspotCompanyId) {
          try {
            await hubspotClient.crm.companies.basicApi.update(record.hubspotCompanyId, {
              properties: {
                industry: nextIndustry,
              },
            } as any);
            hubspotSynced = true;
          } catch (error: any) {
            warning = error?.message || "HubSpot sync failed";
          }
        }
      }

      changes.push({
        id: record.id,
        companyName: record.companyName,
        from: current,
        to: nextIndustry,
        hubspotSynced,
        warning,
      });
      updated += 1;
    }

    return NextResponse.json({
      success: true,
      dryRun,
      accountingOnly,
      examined,
      updated,
      max,
      changes,
    });
  } catch (error) {
    console.error("Industry backfill failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Industry backfill failed",
      },
      { status: 500 }
    );
  }
}
