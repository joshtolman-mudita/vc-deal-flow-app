import { DiligenceRecord } from "@/types/diligence";
import { listDiligenceRecords } from "@/lib/diligence-storage";

export interface DiligenceMatchContext {
  diligenceId: string;
  score?: number;
  dataQuality?: number;
  industry?: string;
  recommendation?: string | null;
  hubspotCompany?: {
    industrySector?: string;
    investmentSector?: string;
    fundingStage?: string;
    fundingAmount?: string;
    tamRange?: string;
    currentRunway?: string;
    productCategorization?: string;
  };
  thesis?: {
    problemSolving?: string;
    solution?: string;
    idealCustomer?: string;
    exciting?: string[];
    concerning?: string[];
  };
}

function normalizeName(name?: string): string {
  return (name || "").trim().toLowerCase();
}

function toContext(record: DiligenceRecord): DiligenceMatchContext {
  return {
    diligenceId: record.id,
    score: record.score?.overall,
    dataQuality: record.score?.dataQuality,
    industry: record.industry,
    recommendation: record.recommendation,
    hubspotCompany: record.hubspotCompanyData
      ? {
          industrySector: record.hubspotCompanyData.industrySector || record.hubspotCompanyData.industry,
          investmentSector: record.hubspotCompanyData.investmentSector,
          fundingStage: record.hubspotCompanyData.fundingStage,
          fundingAmount: record.hubspotCompanyData.fundingAmount,
          tamRange: record.hubspotCompanyData.tamRange,
          currentRunway: record.hubspotCompanyData.currentRunway,
          productCategorization: record.hubspotCompanyData.productCategorization,
        }
      : undefined,
    thesis: record.score?.thesisAnswers
      ? {
          problemSolving: record.score.thesisAnswers.problemSolving,
          solution: record.score.thesisAnswers.solution,
          idealCustomer: record.score.thesisAnswers.idealCustomer,
          exciting: Array.isArray(record.score.thesisAnswers.exciting)
            ? record.score.thesisAnswers.exciting
            : [],
          concerning: Array.isArray(record.score.thesisAnswers.concerning)
            ? record.score.thesisAnswers.concerning
            : [],
        }
      : undefined,
  };
}

export async function buildDiligenceLookupMaps() {
  const records = await listDiligenceRecords();
  const byHubSpotDealId = new Map<string, DiligenceRecord>();
  const byCompanyName = new Map<string, DiligenceRecord>();

  for (const record of records) {
    if (record.hubspotDealId) byHubSpotDealId.set(record.hubspotDealId, record);
    const key = normalizeName(record.companyName);
    if (key && !byCompanyName.has(key)) byCompanyName.set(key, record);
  }

  return { byHubSpotDealId, byCompanyName };
}

export function resolveDiligenceContextForDeal(
  deal: { hubspotId?: string; id?: string; name?: string },
  maps: { byHubSpotDealId: Map<string, DiligenceRecord>; byCompanyName: Map<string, DiligenceRecord> },
): DiligenceMatchContext | null {
  const hubspotKey = deal.hubspotId || deal.id;
  if (hubspotKey && maps.byHubSpotDealId.has(hubspotKey)) {
    return toContext(maps.byHubSpotDealId.get(hubspotKey)!);
  }
  const nameKey = normalizeName(deal.name);
  if (nameKey && maps.byCompanyName.has(nameKey)) {
    return toContext(maps.byCompanyName.get(nameKey)!);
  }
  return null;
}
