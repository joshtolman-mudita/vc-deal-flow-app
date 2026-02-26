import { Deal } from "@/types";

// Properties we want to fetch from HubSpot deals
export const DEAL_PROPERTIES = [
  "dealname",
  "amount",
  "dealstage",
  "pipeline",
  "hs_pipeline",
  "hs_pipeline_stage",
  "closedate",
  "createdate",
  "hs_lastmodifieddate",
  "hs_object_id",
  "industry_sector",
  "industry",
  "description",
  "dealtype",
  "deal_terms",
  "terms",
  "associatedcompanyid",
  "round_still_open",
  // Funding round financials (try both naming conventions for compatibility)
  "raise_amount_in_millions",
  "committed_funding_in_millions",
  "deal_valuation_post_money_in_millions",
  "raise_amount",
  "committed_funding",
  "deal_valuation",
  "portco_arr",
];

// Pipelines to include (Fund I and Fund II only, exclude fundraising pipelines)
export const ALLOWED_PIPELINES = [
  "Fund I",
  "Fund II",
  // Add exact pipeline names/IDs from your HubSpot here
];

// Map HubSpot deal to our Deal type
// companyData is optionally provided from a batch company fetch (description, industry, industrySector)
export function mapHubSpotDealToAppDeal(
  hubspotDeal: any,
  stageMap?: Map<string, any>,
  companyData?: Record<string, any>,
): Deal {
  const properties = hubspotDeal.properties;
  const company = companyData || {};

  // Format amount
  const amount = properties.amount 
    ? `$${parseFloat(properties.amount).toLocaleString()}`
    : "N/A";

  // Get stage name from stage ID if stageMap is provided
  const stageId = properties.dealstage || "";
  const stageInfo = stageMap?.get(stageId);
  const stageName = stageInfo?.label || stageId;

  // Determine status based on deal stage
  let status: "Active" | "Shared" | "Archived" = "Active";
  const dealStageLower = stageName.toLowerCase();
  
  if (dealStageLower.includes("closed") || dealStageLower.includes("won") || dealStageLower.includes("close win")) {
    status = "Archived";
  } else if (dealStageLower.includes("shared") || dealStageLower.includes("sent")) {
    status = "Shared";
  }

  // Format date
  const createDate = properties.createdate 
    ? new Date(properties.createdate).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];

  // Deal terms
  const dealTerms = properties.deal_terms || properties.terms || "";

  // Funding round financials — try _in_millions naming first, fall back to short names
  const parseMillions = (v: string | undefined | null): number | undefined => {
    const n = parseFloat(v || "");
    return isNaN(n) ? undefined : n;
  };
  // Format portco_arr (stored as plain dollar integer in HubSpot) to a display string
  const formatArrDollars = (v: string | undefined | null): string | undefined => {
    if (!v) return undefined;
    const n = parseFloat(v);
    if (isNaN(n)) return undefined;
    if (n >= 1_000_000) {
      const m = n / 1_000_000;
      return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
    }
    if (n >= 1_000) return `$${Math.round(n / 1000)}K`;
    return `$${Math.round(n).toLocaleString()}`;
  };

  const raiseAmount = parseMillions(properties.raise_amount_in_millions ?? properties.raise_amount);
  const committedFunding = parseMillions(properties.committed_funding_in_millions ?? properties.committed_funding);
  const dealValuation = parseMillions(properties.deal_valuation_post_money_in_millions ?? properties.deal_valuation);

  // Industry: prefer company's intake sector field, then company industry, then deal industry
  const rawCompanyIndustrySector = company.what_industry_sector_do_you_operate_in___please_select_all_that_apply_ || "";
  const rawCompanyIndustry = company.industry || "";
  const rawDealIndustry = properties.industry_sector || properties.industry || properties.dealtype || "N/A";
  const rawIndustry = rawCompanyIndustrySector || rawCompanyIndustry || rawDealIndustry;

  const humanizeIndustry = (raw: string) =>
    raw === "N/A" || !raw
      ? "N/A"
      : raw
          .replace(/_/g, " ")
          .toLowerCase()
          .split(" ")
          .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");

  const formattedIndustry = humanizeIndustry(rawIndustry);
  const formattedCompanyIndustry = rawCompanyIndustrySector || rawCompanyIndustry
    ? humanizeIndustry(rawCompanyIndustrySector || rawCompanyIndustry)
    : undefined;

  // Description: prefer company description over deal description
  const companyDescription = (company.description || "").trim() || undefined;
  const description = companyDescription || properties.description || "";

  // Build HubSpot URL
  const portalId = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || "21880552";
  const hubspotUrl = `https://app.hubspot.com/contacts/${portalId}/deal/${hubspotDeal.id}`;

  return {
    id: hubspotDeal.id,
    name: properties.dealname || "Untitled Deal",
    industry: formattedIndustry,
    companyIndustry: formattedCompanyIndustry,
    stage: stageId,
    stageName: stageName,
    amount: amount,
    date: createDate,
    status: status,
    description,
    companyDescription,
    hubspotId: hubspotDeal.id,
    pipeline: properties.pipeline || "N/A",
    companyId: properties.associatedcompanyid,
    dealTerms: dealTerms,
    createdate: properties.createdate,
    url: hubspotUrl,
    roundStillOpen: properties.round_still_open || undefined,
    raiseAmount,
    committedFunding,
    dealValuation,
    arr: formatArrDollars(properties.portco_arr),
  };
}

// Check if a deal should be included based on pipeline
export function shouldIncludeDeal(deal: any, pipelineName: string | undefined): boolean {
  // If no pipeline name, exclude the deal
  if (!pipelineName) {
    return false;
  }
  
  // Only include deals from Fund I Deal Flow and Fund II Deal Flow pipelines
  const allowedPipelines = [
    "Fund I Deal Flow",
    "Fund II Deal Flow"
  ];
  
  return allowedPipelines.some(
    allowed => pipelineName.toLowerCase() === allowed.toLowerCase()
  );
}

// Format deal stage for display
export function formatDealStage(stage: string): string {
  if (!stage) return "N/A";
  
  // Convert snake_case or camelCase to Title Case
  return stage
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
    .trim();
}

// Parse filters from query parameters
export interface DealFilters {
  industry?: string;
  stage?: string;
  minAmount?: number;
  maxAmount?: number;
  search?: string;
}

export function parseFilters(searchParams: URLSearchParams): DealFilters {
  const filters: DealFilters = {};
  
  if (searchParams.get("industry")) {
    filters.industry = searchParams.get("industry") as string;
  }
  
  if (searchParams.get("stage")) {
    filters.stage = searchParams.get("stage") as string;
  }
  
  if (searchParams.get("minAmount")) {
    filters.minAmount = parseFloat(searchParams.get("minAmount") as string);
  }
  
  if (searchParams.get("maxAmount")) {
    filters.maxAmount = parseFloat(searchParams.get("maxAmount") as string);
  }
  
  if (searchParams.get("search")) {
    filters.search = searchParams.get("search") as string;
  }
  
  return filters;
}

// Apply client-side filters to deals
export function filterDeals(deals: Deal[], filters: DealFilters): Deal[] {
  return deals.filter(deal => {
    // Search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const matchesSearch = 
        deal.name.toLowerCase().includes(searchLower) ||
        deal.industry.toLowerCase().includes(searchLower) ||
        deal.stage.toLowerCase().includes(searchLower);
      
      if (!matchesSearch) return false;
    }
    
    // Industry filter
    if (filters.industry && deal.industry !== filters.industry) {
      return false;
    }
    
    // Stage filter
    if (filters.stage && deal.stage !== filters.stage) {
      return false;
    }
    
    // Amount filters
    if (filters.minAmount || filters.maxAmount) {
      const amountStr = deal.amount.replace(/[$,]/g, "");
      const amount = parseFloat(amountStr);
      
      if (isNaN(amount)) return true; // Don't filter out if amount is N/A
      
      if (filters.minAmount && amount < filters.minAmount) {
        return false;
      }
      
      if (filters.maxAmount && amount > filters.maxAmount) {
        return false;
      }
    }
    
    return true;
  });
}

