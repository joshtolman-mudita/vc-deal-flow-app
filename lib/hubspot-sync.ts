import hubspotClient, { isHubSpotConfigured } from "@/lib/hubspot";
import {
  DiligenceRecord,
  DiligenceHubSpotData,
  HubSpotCompanyData,
  HubSpotContactData,
  HubSpotDealLookup,
} from "@/types/diligence";
import {
  FieldRegistryEntry,
  RequiredMode,
  getHubSpotCompanyProperties,
  getHubSpotCreateFields,
  getHubSpotStandardCompanyProperties,
  getCompanyPropertyMappings,
} from "@/lib/field-registry";

/**
 * Company properties are now derived from config/field-registry.csv at
 * runtime via the field-registry helpers.  The previous hardcoded arrays
 * (STANDARD_COMPANY_PROPERTIES, FOUNDER_FORM_COMPANY_PROPERTIES, etc.)
 * have been removed.
 */

function mapStageAndPipelineMetadata(pipelines: any[]) {
  const pipelineMap = new Map<string, string>();
  const stageMap = new Map<string, { label: string; pipelineId: string; pipelineLabel: string }>();

  for (const pipeline of pipelines || []) {
    pipelineMap.set(pipeline.id, pipeline.label);
    for (const stage of pipeline.stages || []) {
      stageMap.set(stage.id, {
        label: stage.label,
        pipelineId: pipeline.id,
        pipelineLabel: pipeline.label,
      });
    }
  }

  return { pipelineMap, stageMap };
}

function asDisplayAmount(rawAmount?: string): string | undefined {
  if (!rawAmount) return undefined;
  const parsed = Number(rawAmount);
  if (Number.isFinite(parsed)) return `$${parsed.toLocaleString()}`;
  return rawAmount;
}

function buildHubSpotDealUrl(dealId: string): string {
  const portalId = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || "21880552";
  return `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}`;
}

type HubSpotCreateObject = "company" | "deal";
const HUBSPOT_DEAL_CURRENT_RUNWAY_PROPERTY = process.env.HUBSPOT_DEAL_CURRENT_RUNWAY_PROPERTY || "current_runway";
const HUBSPOT_DEAL_POST_FUNDING_RUNWAY_PROPERTY = process.env.HUBSPOT_DEAL_POST_FUNDING_RUNWAY_PROPERTY || "post_runway_funding";
const HUBSPOT_DEAL_RAISE_AMOUNT_PROPERTY = process.env.HUBSPOT_DEAL_RAISE_AMOUNT_PROPERTY || "raise_amount";
const HUBSPOT_DEAL_COMMITTED_FUNDING_PROPERTY = process.env.HUBSPOT_DEAL_COMMITTED_FUNDING_PROPERTY || "committed_funding";
const HUBSPOT_DEAL_VALUATION_PROPERTY = process.env.HUBSPOT_DEAL_VALUATION_PROPERTY || "deal_valuation";
const HUBSPOT_DEAL_TERMS_PROPERTY = process.env.HUBSPOT_DEAL_TERMS_PROPERTY || "deal_terms";
const HUBSPOT_DEAL_PRIORITY_PROPERTY = process.env.HUBSPOT_DEAL_PRIORITY_PROPERTY || "hs_priority";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHubSpotRateLimitError(error: any): boolean {
  const statusCode = Number(error?.statusCode || error?.code || 0);
  if (statusCode === 429) return true;
  const message = String(error?.message || "").toLowerCase();
  const bodyMessage = String(error?.body?.message || "").toLowerCase();
  const errorType = String(error?.body?.errorType || "").toLowerCase();
  return (
    message.includes("rate limit") ||
    bodyMessage.includes("rate limit") ||
    bodyMessage.includes("ten_secondly_rolling") ||
    errorType === "rate_limit"
  );
}

function parseRetryAfterMs(error: any): number | null {
  const headers = error?.headers || error?.response?.headers;
  if (!headers) return null;
  const retryAfterRaw =
    headers["retry-after"] ||
    headers["Retry-After"] ||
    (typeof headers.get === "function" ? headers.get("retry-after") : undefined);
  if (!retryAfterRaw) return null;
  const seconds = Number(String(retryAfterRaw).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds * 1000);
}

async function withHubSpotRateLimitRetry<T>(
  operationName: string,
  fn: () => Promise<T>,
  maxAttempts = 4
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      if (!isHubSpotRateLimitError(error) || attempt >= maxAttempts - 1) {
        throw error;
      }
      const retryAfterMs = parseRetryAfterMs(error);
      const backoffMs = retryAfterMs ?? (800 * Math.pow(2, attempt));
      const jitterMs = Math.floor(Math.random() * 250);
      const waitMs = Math.min(backoffMs + jitterMs, 7000);
      console.warn(`HubSpot rate limit hit during ${operationName}. Retrying in ${waitMs}ms (attempt ${attempt + 2}/${maxAttempts}).`);
      await sleep(waitMs);
      attempt += 1;
    }
  }
}

export interface HubSpotCreateFieldState {
  fieldName: string;
  hubspotProperty: string;
  object: HubSpotCreateObject;
  appPath: string;
  notes?: string;
  uiOrder?: number;
  value: string;
  required: boolean;
  requiredMode: RequiredMode;
  missing: boolean;
}

export interface HubSpotCreatePreview {
  company: {
    properties: Record<string, string>;
    fields: HubSpotCreateFieldState[];
    missingHard: string[];
    missingWarnings: string[];
  };
  deal: {
    properties: Record<string, string>;
    fields: HubSpotCreateFieldState[];
    missingHard: string[];
    missingWarnings: string[];
  };
  canCreateCompany: boolean;
  canCreateDeal: boolean;
}

function getValueByPath(source: unknown, pathValue: string): unknown {
  if (!source || !pathValue) return undefined;
  const segments = pathValue.split(".").filter(Boolean);
  let current: any = source;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    current = current[segment];
  }
  return current;
}

function normalizeCreateValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (Array.isArray(raw)) return raw.map((item) => String(item ?? "").trim()).filter(Boolean).join(", ");
  return "";
}

function normalizeRunwayValueForDeal(raw: unknown): string {
  const input = normalizeCreateValue(raw);
  if (!input) return "";
  const normalized = input.toLowerCase().replace(/\s+/g, " ").trim();
  if (/[-–]|to|>|<|under|over|less than|more than/.test(normalized)) {
    return input;
  }
  const numeric = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!numeric) return input;
  return String(Math.round(Number(numeric[1])));
}

function normalizeValuationInMillionsForDeal(raw: unknown): string {
  const input = normalizeCreateValue(raw);
  if (!input) return "";
  const cleaned = input.toLowerCase().replace(/[$,\s]/g, "");
  const match = cleaned.match(/^(-?\d+(?:\.\d+)?)([kmb])?$/);
  if (!match) return input;

  const base = Number(match[1]);
  if (!Number.isFinite(base)) return input;

  let millions: number;
  if (match[2] === "b") millions = base * 1000;
  else if (match[2] === "m") millions = base;
  else if (match[2] === "k") millions = base / 1000;
  else millions = base > 100000 ? base / 1_000_000 : base;

  const rounded = Math.round(millions * 100) / 100;
  return Number.isInteger(rounded) ? String(Math.trunc(rounded)) : String(rounded);
}

function isMissingCreateValue(value: string): boolean {
  return !value || !value.trim();
}

function requiredForCreate(entry: FieldRegistryEntry, object: HubSpotCreateObject): { required: boolean; mode: RequiredMode } {
  const requiredOnCreate = entry.requiredOnCreate || "none";
  const explicitRequired =
    requiredOnCreate === "both" ||
    requiredOnCreate === object;
  const legacyRequired = entry.required && requiredOnCreate === "none";
  const required = explicitRequired || legacyRequired;
  if (!required) return { required: false, mode: "warning" };

  if (explicitRequired) {
    return { required: true, mode: entry.requiredMode || "warning" };
  }
  // Legacy fallback: strict on deal, warning on company.
  return { required: true, mode: object === "deal" ? "hard" : "warning" };
}

function extractDomainFromUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const normalized = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return new URL(normalized).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return rawUrl.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0]?.toLowerCase() || undefined;
  }
}

let cachedPortfolioProspectTypeValue: string | null | undefined;

async function resolvePortfolioProspectCompanyTypeValue(): Promise<string | undefined> {
  if (cachedPortfolioProspectTypeValue !== undefined) {
    return cachedPortfolioProspectTypeValue || undefined;
  }

  const explicitValue = normalizeCreateValue(process.env.HUBSPOT_COMPANY_TYPE_PORTFOLIO_PROSPECT_VALUE || "");
  if (explicitValue) {
    cachedPortfolioProspectTypeValue = explicitValue;
    return explicitValue;
  }

  const configuredProperty = normalizeCreateValue(process.env.HUBSPOT_COMPANY_TYPE_PROPERTY || "");
  const candidateProperties = Array.from(new Set([configuredProperty || "type", "company_type"]));

  for (const propertyName of candidateProperties) {
    try {
      const property: any = await hubspotClient.crm.properties.coreApi.getByName("companies", propertyName);
      const options = Array.isArray(property?.options) ? property.options : [];
      const matchingOption = options.find((option: any) => {
        const label = normalizeCreateValue(option?.label).toLowerCase();
        const value = normalizeCreateValue(option?.value).toLowerCase();
        return (
          label === "portfolio prospect" ||
          value === "portfolio_prospect" ||
          label.includes("portfolio prospect") ||
          value.includes("portfolio_prospect")
        );
      });
      if (matchingOption?.value) {
        cachedPortfolioProspectTypeValue = normalizeCreateValue(matchingOption.value);
        return cachedPortfolioProspectTypeValue || undefined;
      }
    } catch {
      // Try next candidate property name.
    }
  }

  cachedPortfolioProspectTypeValue = null;
  return undefined;
}

function applyEditedProperties(
  base: Record<string, string>,
  edits?: Record<string, string>
): Record<string, string> {
  if (!edits) return base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(edits)) {
    if (typeof value !== "string") continue;
    merged[key] = value.trim();
  }
  return merged;
}

function evaluateCreateFields(
  fields: HubSpotCreateFieldState[],
  props: Record<string, string>
): { states: HubSpotCreateFieldState[]; missingHard: string[]; missingWarnings: string[] } {
  const states = fields.map((field) => {
    const nextValue = normalizeCreateValue(props[field.hubspotProperty] || "");
    const missing = field.required ? isMissingCreateValue(nextValue) : false;
    return {
      ...field,
      value: nextValue,
      missing,
    };
  });

  const missingHard = states
    .filter((field) => field.required && field.missing && field.requiredMode === "hard")
    .map((field) => field.fieldName);
  const missingWarnings = states
    .filter((field) => field.required && field.missing && field.requiredMode === "warning")
    .map((field) => field.fieldName);

  return { states, missingHard, missingWarnings };
}

function compactProperties(input: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const normalized = normalizeCreateValue(value);
    if (normalized) result[key] = normalized;
  }
  return result;
}

type HubSpotObjectName = "deals" | "companies";
const hubspotPropertyNameCache: Partial<Record<HubSpotObjectName, { names: Set<string>; cachedAt: number }>> = {};
const HUBSPOT_PROPERTY_CACHE_MS = 5 * 60 * 1000;

async function getHubSpotObjectPropertyNames(objectName: HubSpotObjectName): Promise<Set<string>> {
  const cached = hubspotPropertyNameCache[objectName];
  if (cached && Date.now() - cached.cachedAt < HUBSPOT_PROPERTY_CACHE_MS) {
    return cached.names;
  }
  const response: any = await hubspotClient.crm.properties.coreApi.getAll(objectName);
  const names = new Set<string>(
    (response?.results || [])
      .map((property: any) => normalizeCreateValue(property?.name))
      .filter((name: unknown): name is string => Boolean(name))
  );
  hubspotPropertyNameCache[objectName] = { names, cachedAt: Date.now() };
  return names;
}

async function compactKnownProperties(
  objectName: HubSpotObjectName,
  input: Record<string, string>
): Promise<Record<string, string>> {
  const compacted = compactProperties(input);
  try {
    const allowedNames = await getHubSpotObjectPropertyNames(objectName);
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(compacted)) {
      if (!allowedNames.has(key)) continue;
      filtered[key] = value;
    }
    return filtered;
  } catch {
    // If metadata lookup fails, do not block writes.
    return compacted;
  }
}

function normalizePropValue(rawValue: unknown): string | undefined {
  if (rawValue === null || rawValue === undefined) return undefined;
  const text = String(rawValue).trim();
  return text || undefined;
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = normalizeCreateValue(value);
    if (normalized) return normalized;
  }
  return "";
}

export function buildAutoCompanyDescription(record: DiligenceRecord): string {
  const explicit = firstNonEmptyString(
    record.hubspotCompanyData?.description,
    record.companyDescription,
    record.companyOneLiner
  );
  if (explicit) return explicit;

  const thesisSummary = firstNonEmptyString(
    record.thesisFit?.companyDescription,
    record.score?.thesisAnswers?.problemSolving
  );
  const thesisSolution = firstNonEmptyString(
    record.thesisFit?.solutionApproach,
    record.score?.thesisAnswers?.solution
  );

  if (thesisSummary && thesisSolution) {
    return `${thesisSummary} ${thesisSolution}`.slice(0, 980);
  }
  if (thesisSummary) return thesisSummary.slice(0, 980);

  const industry = firstNonEmptyString(
    record.industry,
    record.hubspotCompanyData?.industry,
    record.hubspotCompanyData?.investmentSector,
    record.hubspotCompanyData?.industrySector
  );
  const website = firstNonEmptyString(record.companyUrl, record.hubspotCompanyData?.website);
  const websitePart = website ? ` Website: ${website}.` : "";
  const industryPart = industry ? ` in the ${industry} space` : "";
  return `${record.companyName} is a company under diligence review${industryPart}.${websitePart}`.slice(0, 980);
}

function normalizeMultiSelect(rawValue: unknown): string | undefined {
  const value = normalizePropValue(rawValue);
  if (!value) return undefined;
  return value.includes(";") ? value.split(";").map((item) => item.trim()).filter(Boolean).join(", ") : value;
}

/**
 * Build a HubSpotCompanyData object from raw HubSpot company API response.
 *
 * The property→key mapping is now driven by config/field-registry.csv via
 * `getCompanyPropertyMappings()`.  Multi-select fields are normalised
 * automatically based on the `type` column in the CSV.
 *
 * Special handling:
 *  - `currentRunway` falls back to the `runway` property when the primary
 *    `what_is_your_current_runway_` property is empty.
 */
function mapHubSpotCompanyData(company: any): HubSpotCompanyData {
  const properties = company?.properties || {};
  const mappings = getCompanyPropertyMappings();

  // Start with the companyId which isn't a property mapping
  const result: Record<string, string | undefined> = {
    companyId: company.id,
  };

  for (const mapping of mappings) {
    const rawValue = properties[mapping.hubspotProperty];
    result[mapping.appKey] = mapping.multiSelect
      ? normalizeMultiSelect(rawValue)
      : normalizePropValue(rawValue);
  }

  // Fallback: currentRunway may come from the alternate "runway" property
  if (!result.currentRunway) {
    const runwayFallback = normalizePropValue(properties.runway);
    if (runwayFallback) {
      result.currentRunway = runwayFallback;
    }
  }

  result.fetchedAt = new Date().toISOString();

  return result as unknown as HubSpotCompanyData;
}

const CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "jobtitle",
  "hs_linkedin_url",
  "linkedinbio",
  "bio",
  "about_us",
  "description",
];

function mapHubSpotContactData(contact: any): HubSpotContactData {
  const properties = contact?.properties || {};
  const firstName = normalizePropValue(properties.firstname);
  const lastName = normalizePropValue(properties.lastname);
  const fullName =
    [firstName, lastName].filter(Boolean).join(" ").trim() || normalizePropValue(properties.full_name);
  return {
    contactId: String(contact?.id || ""),
    firstName,
    lastName,
    fullName: fullName || undefined,
    email: normalizePropValue(properties.email),
    title: normalizePropValue(properties.jobtitle),
    linkedinUrl: normalizePropValue(properties.hs_linkedin_url),
    background:
      normalizePropValue(properties.linkedinbio) ||
      normalizePropValue(properties.bio) ||
      normalizePropValue(properties.about_us) ||
      normalizePropValue(properties.description),
  };
}

async function getAssociatedCompanyIdForDeal(dealId: string): Promise<string | null> {
  if (!isHubSpotConfigured() || !dealId) return null;
  try {
    const dealWithAssociations: any = await hubspotClient.crm.deals.basicApi.getById(
      dealId,
      ["dealname"],
      undefined,
      ["companies"],
      false,
    );
    return dealWithAssociations?.associations?.companies?.results?.[0]?.id || null;
  } catch (error) {
    console.warn("Failed to resolve associated HubSpot company id:", error);
    return null;
  }
}

async function getAssociatedCompanyIdsForDeal(dealId: string): Promise<string[]> {
  if (!isHubSpotConfigured() || !dealId) return [];
  try {
    const dealWithAssociations: any = await hubspotClient.crm.deals.basicApi.getById(
      dealId,
      ["dealname"],
      undefined,
      ["companies"],
      false,
    );
    return (dealWithAssociations?.associations?.companies?.results || [])
      .map((item: any) => String(item?.id || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function findExistingDealForCreate(record: DiligenceRecord): Promise<any | null> {
  if (!isHubSpotConfigured()) return null;

  const hubspotDealId = normalizeCreateValue(record.hubspotDealId);
  if (hubspotDealId) {
    try {
      return await withHubSpotRateLimitRetry("findExistingDealForCreate.getById(record.hubspotDealId)", () =>
        hubspotClient.crm.deals.basicApi.getById(
          hubspotDealId,
          ["dealname", "dealstage", "pipeline", "amount", "description"],
          undefined,
          ["companies"],
          false,
        )
      );
    } catch {
      // fall through to search by name
    }
  }

  const searchResults = await searchHubSpotDealsByName(record.companyName, 10);
  if (searchResults.length === 0) return null;
  const exact = searchResults.find((deal) => deal.name.toLowerCase() === record.companyName.toLowerCase()) || searchResults[0];
  try {
    return await withHubSpotRateLimitRetry("findExistingDealForCreate.getById(searchResult)", () =>
      hubspotClient.crm.deals.basicApi.getById(
        exact.id,
        ["dealname", "dealstage", "pipeline", "amount", "description"],
        undefined,
        ["companies"],
        false,
      )
    );
  } catch {
    return null;
  }
}

async function ensureDealCompanyAssociation(dealId: string, companyId: string): Promise<void> {
  const existingCompanyIds = await getAssociatedCompanyIdsForDeal(dealId);
  if (existingCompanyIds.includes(companyId)) return;
  try {
    const associationsApi: any = (hubspotClient as any)?.crm?.associations?.v4?.basicApi;
    if (associationsApi?.createDefault) {
      await associationsApi.createDefault("deals", dealId, "companies", companyId);
      return;
    }
  } catch {
    // fallback below
  }
  // Fallback: update is non-fatal if association API is unavailable.
}

export async function getAssociatedContactsForCompany(companyId: string): Promise<HubSpotContactData[]> {
  if (!isHubSpotConfigured() || !companyId) return [];
  try {
    const companyWithAssociations: any = await hubspotClient.crm.companies.basicApi.getById(
      companyId,
      ["name"],
      undefined,
      ["contacts"],
      false,
    );
    const associatedContactIds = (companyWithAssociations?.associations?.contacts?.results || [])
      .map((item: any) => item?.id)
      .filter(Boolean);

    if (associatedContactIds.length === 0) return [];

    const contacts = await Promise.all(
      associatedContactIds.map(async (contactId: string) => {
        try {
          const contact: any = await hubspotClient.crm.contacts.basicApi.getById(
            contactId,
            CONTACT_PROPERTIES,
            undefined,
            undefined,
            false,
          );
          return mapHubSpotContactData(contact);
        } catch (error) {
          console.warn(`Failed to load HubSpot contact ${contactId}:`, error);
          return null;
        }
      }),
    );

    return contacts
      .filter((c): c is HubSpotContactData => Boolean(c?.contactId))
      .filter((c) => Boolean(c.fullName || c.email));
  } catch (error) {
    console.warn("Failed to resolve associated HubSpot contacts:", error);
    return [];
  }
}

export async function getAssociatedContactsForDeal(dealId: string): Promise<HubSpotContactData[]> {
  const companyId = await getAssociatedCompanyIdForDeal(dealId);
  if (!companyId) return [];
  return getAssociatedContactsForCompany(companyId);
}

export async function searchHubSpotDealsByName(query: string, limit: number = 10): Promise<HubSpotDealLookup[]> {
  if (!isHubSpotConfigured() || !query.trim()) return [];

  const pipelinesResponse = await withHubSpotRateLimitRetry("searchHubSpotDealsByName.getPipelines", () =>
    hubspotClient.crm.pipelines.pipelinesApi.getAll("deals")
  );
  const { stageMap } = mapStageAndPipelineMetadata(pipelinesResponse.results || []);

  const searchResponse = await withHubSpotRateLimitRetry("searchHubSpotDealsByName.doSearch", () =>
    hubspotClient.crm.deals.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "dealname",
              operator: "CONTAINS_TOKEN" as any,
              value: query.trim(),
            },
          ],
        },
      ],
      properties: ["dealname", "dealstage", "pipeline", "amount", "description"],
      limit,
    } as any)
  );

  return (searchResponse.results || []).map((deal: any) => {
    const stageId = deal.properties?.dealstage;
    const stageInfo = stageId ? stageMap.get(stageId) : undefined;
    return {
      id: deal.id,
      name: deal.properties?.dealname || "Untitled Deal",
      stageId,
      stageLabel: stageInfo?.label || stageId,
      pipelineId: deal.properties?.pipeline || stageInfo?.pipelineId,
      pipelineLabel: stageInfo?.pipelineLabel,
      amount: asDisplayAmount(deal.properties?.amount),
      description: deal.properties?.description || "",
      url: buildHubSpotDealUrl(deal.id),
    };
  });
}

export async function getHubSpotDealById(dealId: string): Promise<HubSpotDealLookup | null> {
  if (!isHubSpotConfigured() || !dealId) return null;

  const pipelinesResponse = await withHubSpotRateLimitRetry("getHubSpotDealById.getPipelines", () =>
    hubspotClient.crm.pipelines.pipelinesApi.getAll("deals")
  );
  const { stageMap, pipelineMap } = mapStageAndPipelineMetadata(pipelinesResponse.results || []);

  const deal = await withHubSpotRateLimitRetry("getHubSpotDealById.getById", () =>
    hubspotClient.crm.deals.basicApi.getById(
      dealId,
      [
        "dealname",
        "dealstage",
        "pipeline",
        "amount",
        HUBSPOT_DEAL_PRIORITY_PROPERTY,
        HUBSPOT_DEAL_RAISE_AMOUNT_PROPERTY,
        HUBSPOT_DEAL_COMMITTED_FUNDING_PROPERTY,
        HUBSPOT_DEAL_VALUATION_PROPERTY,
        HUBSPOT_DEAL_TERMS_PROPERTY,
        "description",
        HUBSPOT_DEAL_CURRENT_RUNWAY_PROPERTY,
        HUBSPOT_DEAL_POST_FUNDING_RUNWAY_PROPERTY,
      ],
      undefined,
      undefined,
      false,
    )
  );

  const stageId = deal.properties?.dealstage || undefined;
  const pipelineId = deal.properties?.pipeline || undefined;
  const stageInfo = stageId ? stageMap.get(stageId) : undefined;

  return {
    id: deal.id,
    name: deal.properties?.dealname || "Untitled Deal",
    stageId,
    stageLabel: stageInfo?.label || stageId,
    pipelineId: pipelineId || stageInfo?.pipelineId,
    pipelineLabel: (pipelineId && pipelineMap.get(pipelineId)) || stageInfo?.pipelineLabel,
    amount: asDisplayAmount(deal.properties?.amount || undefined),
    priority: normalizePropValue(deal.properties?.[HUBSPOT_DEAL_PRIORITY_PROPERTY]),
    raiseAmount: normalizePropValue(deal.properties?.[HUBSPOT_DEAL_RAISE_AMOUNT_PROPERTY]),
    committedFunding: normalizePropValue(deal.properties?.[HUBSPOT_DEAL_COMMITTED_FUNDING_PROPERTY]),
    dealValuation: normalizePropValue(deal.properties?.[HUBSPOT_DEAL_VALUATION_PROPERTY]),
    dealTerms: normalizePropValue(deal.properties?.[HUBSPOT_DEAL_TERMS_PROPERTY]),
    description: deal.properties?.description || "",
    currentRunway: normalizePropValue(deal.properties?.[HUBSPOT_DEAL_CURRENT_RUNWAY_PROPERTY]),
    postFundingRunway: normalizePropValue(deal.properties?.[HUBSPOT_DEAL_POST_FUNDING_RUNWAY_PROPERTY]),
    url: buildHubSpotDealUrl(deal.id),
  };
}

export async function pullHubSpotFields(hubspotDealId: string, syncedAt?: string): Promise<DiligenceHubSpotData | null> {
  const deal = await getHubSpotDealById(hubspotDealId);
  if (!deal) return null;
  return {
    dealId: deal.id,
    dealName: deal.name,
    stageId: deal.stageId,
    stageLabel: deal.stageLabel,
    pipelineId: deal.pipelineId,
    pipelineLabel: deal.pipelineLabel,
    amount: deal.amount,
    priority: deal.priority,
    raiseAmount: deal.raiseAmount,
    committedFunding: deal.committedFunding,
    dealValuation: deal.dealValuation,
    dealTerms: deal.dealTerms,
    currentRunway: deal.currentRunway,
    postFundingRunway: deal.postFundingRunway,
    url: deal.url,
    syncedAt,
  };
}

export async function getAssociatedCompanyForDeal(dealId: string): Promise<HubSpotCompanyData | null> {
  if (!isHubSpotConfigured() || !dealId) return null;

  try {
    const associatedCompanyId = await getAssociatedCompanyIdForDeal(dealId);

    if (!associatedCompanyId) return null;

    const allCompanyProps = getHubSpotCompanyProperties();
    try {
      const company: any = await hubspotClient.crm.companies.basicApi.getById(
        associatedCompanyId,
        allCompanyProps,
        undefined,
        undefined,
        false,
      );
      return mapHubSpotCompanyData(company);
    } catch (error) {
      console.warn("Failed to fetch company with full property list, falling back to standard properties:", error);
      const standardProps = getHubSpotStandardCompanyProperties();
      const company: any = await hubspotClient.crm.companies.basicApi.getById(
        associatedCompanyId,
        standardProps,
        undefined,
        undefined,
        false,
      );
      return mapHubSpotCompanyData(company);
    }
  } catch (error) {
    console.warn("Failed to resolve associated HubSpot company:", error);
    return null;
  }
}

export function prepareHubSpotCreatePayload(
  record: DiligenceRecord,
  options?: {
    editedCompanyProperties?: Record<string, string>;
    editedDealProperties?: Record<string, string>;
    defaultPipelineId?: string;
    defaultDealStageId?: string;
  }
): HubSpotCreatePreview {
  // For company creation we include hs-to-app mapped fields too, so users can
  // review/edit the full company profile before first create.
  const companyEntries = getHubSpotCreateFields("company", { includeHsToApp: true });
  const dealEntries = getHubSpotCreateFields("deal");
  const defaultPipelineId = options?.defaultPipelineId || process.env.HUBSPOT_DEFAULT_DEAL_PIPELINE_ID || "default";
  const defaultDealStageId = options?.defaultDealStageId || process.env.HUBSPOT_DEFAULT_DEAL_STAGE_ID || "qualifiedtobuy";

  const baseCompanyProperties: Record<string, string> = {
    name: normalizeCreateValue(record.hubspotCompanyData?.name || record.companyName),
    website: normalizeCreateValue(record.hubspotCompanyData?.website || record.companyUrl || ""),
    domain: normalizeCreateValue(
      record.hubspotCompanyData?.domain ||
      extractDomainFromUrl(record.hubspotCompanyData?.website || record.companyUrl)
    ),
    description: normalizeCreateValue(buildAutoCompanyDescription(record)),
    industry: normalizeCreateValue(
      firstNonEmptyString(
        record.industry,
        record.hubspotCompanyData?.industry,
        record.hubspotCompanyData?.investmentSector,
        record.hubspotCompanyData?.industrySector
      )
    ),
  };

  for (const entry of companyEntries) {
    const derived = normalizeCreateValue(getValueByPath(record, entry.appPath));
    const existing = normalizeCreateValue(baseCompanyProperties[entry.hubspotProperty]);
    const fallbackDefault = normalizeCreateValue(entry.createDefault);
    baseCompanyProperties[entry.hubspotProperty] = existing || derived || fallbackDefault;
  }

  const baseDealProperties: Record<string, string> = {
    dealname: normalizeCreateValue(record.companyName),
    description: normalizeCreateValue(buildAutoCompanyDescription(record)),
    pipeline: normalizeCreateValue(record.hubspotPipelineId || defaultPipelineId),
    dealstage: normalizeCreateValue(record.hubspotDealStageId || defaultDealStageId),
    amount: normalizeCreateValue(record.hubspotAmount || ""),
    [HUBSPOT_DEAL_RAISE_AMOUNT_PROPERTY]: normalizeCreateValue(
      record.metrics?.fundingAmount?.value ||
      record.hubspotCompanyData?.fundingAmount ||
      ""
    ),
    [HUBSPOT_DEAL_COMMITTED_FUNDING_PROPERTY]: normalizeCreateValue(
      record.metrics?.committed?.value ||
      record.hubspotCompanyData?.currentCommitments ||
      ""
    ),
    [HUBSPOT_DEAL_VALUATION_PROPERTY]: normalizeValuationInMillionsForDeal(
      record.metrics?.valuation?.value ||
      record.hubspotCompanyData?.fundingValuation ||
      ""
    ),
    [HUBSPOT_DEAL_TERMS_PROPERTY]: normalizeCreateValue(
      record.metrics?.dealTerms?.value ||
      ""
    ),
    [HUBSPOT_DEAL_CURRENT_RUNWAY_PROPERTY]: normalizeRunwayValueForDeal(
      record.metrics?.currentRunway?.value ||
      record.hubspotCompanyData?.currentRunway ||
      ""
    ),
    [HUBSPOT_DEAL_POST_FUNDING_RUNWAY_PROPERTY]: normalizeRunwayValueForDeal(
      record.metrics?.postFundingRunway?.value ||
      record.hubspotCompanyData?.postFundingRunway ||
      ""
    ),
  };

  for (const entry of dealEntries) {
    const derived = normalizeCreateValue(getValueByPath(record, entry.appPath));
    const existing = normalizeCreateValue(baseDealProperties[entry.hubspotProperty]);
    const fallbackDefault = normalizeCreateValue(entry.createDefault);
    baseDealProperties[entry.hubspotProperty] = existing || derived || fallbackDefault;
  }

  const mergedCompanyProperties = applyEditedProperties(baseCompanyProperties, options?.editedCompanyProperties);
  const mergedDealProperties = applyEditedProperties(baseDealProperties, options?.editedDealProperties);
  // Industry now belongs on the company record; avoid writing legacy deal-level industry.
  delete mergedDealProperties.diligence_industry;

  const companyFieldStates: HubSpotCreateFieldState[] = companyEntries.map((entry) => {
    const req = requiredForCreate(entry, "company");
    return {
      fieldName: entry.fieldName,
      hubspotProperty: entry.hubspotProperty,
      object: "company",
      appPath: entry.appPath,
      notes: entry.notes,
      uiOrder: entry.uiOrder,
      value: normalizeCreateValue(mergedCompanyProperties[entry.hubspotProperty]),
      required: req.required,
      requiredMode: req.mode,
      missing: false,
    };
  });

  const dealFieldStates: HubSpotCreateFieldState[] = dealEntries.map((entry) => {
    const req = requiredForCreate(entry, "deal");
    return {
      fieldName: entry.fieldName,
      hubspotProperty: entry.hubspotProperty,
      object: "deal",
      appPath: entry.appPath,
      notes: entry.notes,
      uiOrder: entry.uiOrder,
      value: normalizeCreateValue(mergedDealProperties[entry.hubspotProperty]),
      required: req.required,
      requiredMode: req.mode,
      missing: false,
    };
  });

  const companyEvaluation = evaluateCreateFields(companyFieldStates, mergedCompanyProperties);
  const dealEvaluation = evaluateCreateFields(dealFieldStates, mergedDealProperties);

  return {
    company: {
      properties: mergedCompanyProperties,
      fields: companyEvaluation.states,
      missingHard: companyEvaluation.missingHard,
      missingWarnings: companyEvaluation.missingWarnings,
    },
    deal: {
      properties: mergedDealProperties,
      fields: dealEvaluation.states,
      missingHard: dealEvaluation.missingHard,
      missingWarnings: dealEvaluation.missingWarnings,
    },
    canCreateCompany: true,
    canCreateDeal: dealEvaluation.missingHard.length === 0,
  };
}

export async function findExistingCompanyForCreate(name?: string, domain?: string): Promise<any | null> {
  if (!isHubSpotConfigured()) return null;
  if (domain) {
    const response = await withHubSpotRateLimitRetry("findExistingCompanyForCreate.searchByDomain", () =>
      hubspotClient.crm.companies.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              {
                propertyName: "domain",
                operator: "EQ" as any,
                value: domain,
              },
            ],
          },
        ],
        properties: ["name", "domain", "website", "description", "industry"],
        limit: 1,
      } as any)
    );
    if (response.results?.[0]) return response.results[0];
  }

  if (name) {
    const response = await withHubSpotRateLimitRetry("findExistingCompanyForCreate.searchByName", () =>
      hubspotClient.crm.companies.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              {
                propertyName: "name",
                operator: "CONTAINS_TOKEN" as any,
                value: name,
              },
            ],
          },
        ],
        properties: ["name", "domain", "website", "description", "industry"],
        limit: 5,
      } as any)
    );
    const exact = (response.results || []).find((company: any) =>
      normalizeCreateValue(company.properties?.name).toLowerCase() === name.toLowerCase()
    );
    return exact || response.results?.[0] || null;
  }

  return null;
}

export async function createHubSpotCompanyAndDeal(
  record: DiligenceRecord,
  diligenceId: string,
  options?: {
    editedCompanyProperties?: Record<string, string>;
    editedDealProperties?: Record<string, string>;
  }
): Promise<{
  preview: HubSpotCreatePreview;
  dealId: string;
  companyId: string;
  dealUrl: string;
  hubspotData: DiligenceHubSpotData | null;
  hubspotCompanyData?: HubSpotCompanyData;
}> {
  if (!isHubSpotConfigured()) {
    throw new Error("HubSpot is not configured");
  }

  const preview = prepareHubSpotCreatePayload(record, options);
  if (!preview.canCreateDeal) {
    throw new Error(`Missing required Deal fields: ${preview.deal.missingHard.join(", ")}`);
  }

  const companyProps = { ...preview.company.properties };
  if (!companyProps.name) companyProps.name = record.companyName;
  if (!companyProps.domain && companyProps.website) {
    companyProps.domain = extractDomainFromUrl(companyProps.website) || "";
  }

  // Always stamp newly created companies as "Portfolio Prospect" (hidden from UI).
  const companyTypeProperty = normalizeCreateValue(process.env.HUBSPOT_COMPANY_TYPE_PROPERTY || "type");
  const portfolioProspectTypeValue = await resolvePortfolioProspectCompanyTypeValue();
  if (companyTypeProperty && portfolioProspectTypeValue && !normalizeCreateValue(companyProps[companyTypeProperty])) {
    companyProps[companyTypeProperty] = portfolioProspectTypeValue;
  }

  const existingDeal = await findExistingDealForCreate(record);
  const existingDealAssociatedCompanyId = existingDeal?.associations?.companies?.results?.[0]?.id as string | undefined;

  let existingCompany: any = null;
  const hubspotCompanyId = normalizeCreateValue(record.hubspotCompanyId);
  const companyReadProperties = ["name", "domain", "website", "description", "industry", companyTypeProperty]
    .filter((prop): prop is string => Boolean(prop));
  if (hubspotCompanyId) {
    try {
      existingCompany = await withHubSpotRateLimitRetry("createHubSpotCompanyAndDeal.getExistingCompanyByRecordId", () =>
        hubspotClient.crm.companies.basicApi.getById(
          hubspotCompanyId,
          companyReadProperties,
          undefined,
          undefined,
          false,
        )
      );
    } catch {
      existingCompany = null;
    }
  }
  if (!existingCompany && existingDealAssociatedCompanyId) {
    try {
      existingCompany = await withHubSpotRateLimitRetry("createHubSpotCompanyAndDeal.getExistingCompanyByAssociatedDeal", () =>
        hubspotClient.crm.companies.basicApi.getById(
          existingDealAssociatedCompanyId,
          companyReadProperties,
          undefined,
          undefined,
          false,
        )
      );
    } catch {
      existingCompany = null;
    }
  }
  if (!existingCompany) {
    existingCompany = await findExistingCompanyForCreate(companyProps.name, companyProps.domain);
  }

  let companyId = existingCompany?.id as string | undefined;
  if (!companyId) {
    const safeCompanyCreateProps = await compactKnownProperties("companies", companyProps);
    const createdCompany: any = await withHubSpotRateLimitRetry("createHubSpotCompanyAndDeal.createCompany", () =>
      hubspotClient.crm.companies.basicApi.create({
        properties: safeCompanyCreateProps,
      } as any)
    );
    companyId = createdCompany.id;
  } else {
    const existingDescription = normalizeCreateValue(existingCompany?.properties?.description || "");
    const nextDescription = normalizeCreateValue(companyProps.description || "");
    const existingIndustry = normalizeCreateValue(existingCompany?.properties?.industry || "");
    const nextIndustry = normalizeCreateValue(companyProps.industry || "");
    const companyUpdates: Record<string, string> = {};
    if (!existingDescription && nextDescription) {
      companyUpdates.description = nextDescription;
    }
    if (nextIndustry && existingIndustry !== nextIndustry) {
      companyUpdates.industry = nextIndustry;
    }
    if (Object.keys(companyUpdates).length > 0) {
      const safeCompanyUpdateProps = await compactKnownProperties("companies", companyUpdates);
      await withHubSpotRateLimitRetry("createHubSpotCompanyAndDeal.updateExistingCompany", () =>
        hubspotClient.crm.companies.basicApi.update(companyId!, {
          properties: safeCompanyUpdateProps,
        } as any)
      );
    }
  }
  if (!companyId) {
    throw new Error("Failed to resolve HubSpot company");
  }
  const resolvedCompanyId = companyId;

  const dealProps: Record<string, string> = {
    ...preview.deal.properties,
    dealname: preview.deal.properties.dealname || record.companyName,
    pipeline: preview.deal.properties.pipeline || process.env.HUBSPOT_DEFAULT_DEAL_PIPELINE_ID || "default",
    dealstage: preview.deal.properties.dealstage || process.env.HUBSPOT_DEFAULT_DEAL_STAGE_ID || "qualifiedtobuy",
  };

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const diligenceLink = `${APP_URL}/diligence/${diligenceId}`;
  if (!dealProps.diligence_link) {
    dealProps.diligence_link = diligenceLink;
  }

  let dealId: string;
  if (existingDeal?.id) {
    const safeDealUpdateProps = await compactKnownProperties("deals", dealProps);
    await withHubSpotRateLimitRetry("createHubSpotCompanyAndDeal.updateExistingDeal", () =>
      hubspotClient.crm.deals.basicApi.update(existingDeal.id, {
        properties: safeDealUpdateProps,
      } as any)
    );
    dealId = existingDeal.id;
  } else {
    const safeDealCreateProps = await compactKnownProperties("deals", dealProps);
    const createdDeal: any = await withHubSpotRateLimitRetry("createHubSpotCompanyAndDeal.createDeal", () =>
      hubspotClient.crm.deals.basicApi.create({
        properties: safeDealCreateProps,
        associations: [
          {
            to: { id: resolvedCompanyId },
            types: [
              {
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: 5,
              },
            ],
          },
        ],
      } as any)
    );
    dealId = createdDeal.id;
  }

  await ensureDealCompanyAssociation(dealId, resolvedCompanyId);

  const pulled = await pullHubSpotFieldsWithCompany(dealId, new Date().toISOString());
  return {
    preview,
    dealId,
    companyId: resolvedCompanyId,
    dealUrl: buildHubSpotDealUrl(dealId),
    hubspotData: pulled.hubspotData,
    hubspotCompanyData: pulled.hubspotCompanyData,
  };
}

export async function pullHubSpotFieldsWithCompany(
  hubspotDealId: string,
  syncedAt?: string
): Promise<{
  hubspotData: DiligenceHubSpotData | null;
  hubspotCompanyId?: string;
  hubspotCompanyName?: string;
  hubspotCompanyData?: HubSpotCompanyData;
}> {
  const [hubspotData, hubspotCompanyData] = await Promise.all([
    pullHubSpotFields(hubspotDealId, syncedAt),
    getAssociatedCompanyForDeal(hubspotDealId),
  ]);

  return {
    hubspotData,
    hubspotCompanyId: hubspotCompanyData?.companyId,
    hubspotCompanyName: hubspotCompanyData?.name,
    hubspotCompanyData: hubspotCompanyData || undefined,
  };
}

function metricValue(record: DiligenceRecord, key: "arr" | "tam" | "acv"): string | undefined {
  const value = record.metrics?.[key]?.value?.trim();
  return value || undefined;
}

export async function syncDiligenceToHubSpot(
  record: DiligenceRecord,
  diligenceId: string,
  options?: { dealStage?: string },
): Promise<{ dealId: string; dealUrl: string; existed: boolean; hubspotData: DiligenceHubSpotData }> {
  if (!record.score) {
    throw new Error("Cannot sync diligence without a score");
  }
  if (!isHubSpotConfigured()) {
    throw new Error("HubSpot is not configured");
  }

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const diligenceLink = `${APP_URL}/diligence/${diligenceId}`;

  let existingDeal: any = null;
  if (record.hubspotDealId) {
    try {
      existingDeal = await hubspotClient.crm.deals.basicApi.getById(
        record.hubspotDealId,
        [
          "dealname",
          "dealstage",
          "pipeline",
          "amount",
          HUBSPOT_DEAL_RAISE_AMOUNT_PROPERTY,
          HUBSPOT_DEAL_COMMITTED_FUNDING_PROPERTY,
          HUBSPOT_DEAL_VALUATION_PROPERTY,
          HUBSPOT_DEAL_TERMS_PROPERTY,
          "description",
          HUBSPOT_DEAL_CURRENT_RUNWAY_PROPERTY,
          HUBSPOT_DEAL_POST_FUNDING_RUNWAY_PROPERTY,
        ],
        undefined,
        undefined,
        false,
      );
    } catch {
      existingDeal = null;
    }
  }

  if (!existingDeal) {
    const searchResults = await searchHubSpotDealsByName(record.companyName, 10);
    if (searchResults.length > 0) {
      const best = searchResults.find((d) => d.name.toLowerCase() === record.companyName.toLowerCase()) || searchResults[0];
      existingDeal = await hubspotClient.crm.deals.basicApi.getById(
        best.id,
        [
          "dealname",
          "dealstage",
          "pipeline",
          "amount",
          HUBSPOT_DEAL_RAISE_AMOUNT_PROPERTY,
          HUBSPOT_DEAL_COMMITTED_FUNDING_PROPERTY,
          HUBSPOT_DEAL_VALUATION_PROPERTY,
          HUBSPOT_DEAL_TERMS_PROPERTY,
          "description",
          HUBSPOT_DEAL_CURRENT_RUNWAY_PROPERTY,
          HUBSPOT_DEAL_POST_FUNDING_RUNWAY_PROPERTY,
        ],
        undefined,
        undefined,
        false,
      );
    }
  }

  const currentStage = normalizeCreateValue(existingDeal?.properties?.dealstage || "");
  // Important safety rule: never auto-change HubSpot stage from scoring/rescoring.
  // Stage moves should only happen from explicit workflow actions (e.g. reject/closed-lost flows).
  const targetStage = normalizeCreateValue(options?.dealStage || "");
  const existingDescription = existingDeal?.properties?.description || "";
  const descriptionValue =
    existingDescription || record.companyOneLiner || record.recommendation || `Diligence completed on ${new Date(record.score.scoredAt).toLocaleDateString()}`;

  const diligenceProperties: Record<string, string> = {
    dealname: record.companyName,
    description: descriptionValue,
    diligence_score: record.score.overall.toString(),
    diligence_date: record.score.scoredAt,
    diligence_status: record.status,
    diligence_link: diligenceLink,
    diligence_data_quality: record.score.dataQuality.toString(),
    diligence_arr: metricValue(record, "arr") || "",
    diligence_tam: metricValue(record, "tam") || "",
    diligence_acv: metricValue(record, "acv") || "",
    diligence_recommendation: record.recommendation || "",
    [HUBSPOT_DEAL_PRIORITY_PROPERTY]: normalizeCreateValue(record.priority || ""),
    [HUBSPOT_DEAL_RAISE_AMOUNT_PROPERTY]: normalizeCreateValue(
      record.metrics?.fundingAmount?.value || ""
    ),
    [HUBSPOT_DEAL_COMMITTED_FUNDING_PROPERTY]: normalizeCreateValue(
      record.metrics?.committed?.value || ""
    ),
    [HUBSPOT_DEAL_VALUATION_PROPERTY]: normalizeValuationInMillionsForDeal(
      record.metrics?.valuation?.value || ""
    ),
    [HUBSPOT_DEAL_TERMS_PROPERTY]: normalizeCreateValue(
      record.metrics?.dealTerms?.value || ""
    ),
    [HUBSPOT_DEAL_CURRENT_RUNWAY_PROPERTY]: normalizeRunwayValueForDeal(
      record.metrics?.currentRunway?.value || ""
    ),
    [HUBSPOT_DEAL_POST_FUNDING_RUNWAY_PROPERTY]: normalizeRunwayValueForDeal(
      record.metrics?.postFundingRunway?.value || ""
    ),
  };
  if (targetStage) {
    diligenceProperties.dealstage = targetStage;
  }

  if (record.decisionOutcome) {
    diligenceProperties.investment_decision = record.decisionOutcome.decision;
    if (record.decisionOutcome.decisionReason) diligenceProperties.decision_reason = record.decisionOutcome.decisionReason;
  }
  if (record.companyUrl) diligenceProperties.website = record.companyUrl;

  const safeDiligenceProperties = await compactKnownProperties("deals", diligenceProperties);
  let dealId: string;
  if (existingDeal) {
    await hubspotClient.crm.deals.basicApi.update(existingDeal.id, {
      properties: safeDiligenceProperties,
    });
    dealId = existingDeal.id;
  } else {
    const defaultPipelineId = normalizeCreateValue(process.env.HUBSPOT_DEFAULT_DEAL_PIPELINE_ID || "default");
    const defaultStageId = normalizeCreateValue(process.env.HUBSPOT_DEFAULT_DEAL_STAGE_ID || "qualifiedtobuy");
    const safeCreateProperties = await compactKnownProperties("deals", {
      ...safeDiligenceProperties,
      dealstage: targetStage || defaultStageId,
      pipeline: defaultPipelineId,
    });
    const newDeal = await hubspotClient.crm.deals.basicApi.create({
      properties: safeCreateProperties,
      associations: [],
    } as any);
    dealId = newDeal.id;
  }

  const normalizedIndustry = normalizeCreateValue(record.industry || "");
  if (normalizedIndustry) {
    try {
      const associatedCompany = await getAssociatedCompanyForDeal(dealId);
      const companyId = associatedCompany?.companyId;
      if (companyId) {
        await hubspotClient.crm.companies.basicApi.update(companyId, {
          properties: { industry: normalizedIndustry },
        } as any);
      }
    } catch {
      // Non-blocking: a failed company industry update should not fail overall sync.
    }
  }

  const pulled = await pullHubSpotFields(dealId, new Date().toISOString());
  return {
    dealId,
    dealUrl: buildHubSpotDealUrl(dealId),
    existed: Boolean(existingDeal),
    hubspotData: pulled || {
      dealId,
      dealName: record.companyName,
      url: buildHubSpotDealUrl(dealId),
      syncedAt: new Date().toISOString(),
    },
  };
}
