/**
 * Config-driven Field Registry
 *
 * Reads config/field-registry.csv at runtime so that non-developers can
 * add/edit field mappings without touching TypeScript source code.
 *
 * The CSV is the single source of truth for which fields exist, where they
 * live (app / HubSpot / both), how they sync, and what HubSpot property
 * names they map to.
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FieldType =
  | "string"
  | "number"
  | "date"
  | "enum"
  | "multi-select"
  | "url"
  | "rich-text"
  | "object";

export type FieldLocation = "shared" | "app-only" | "hubspot-only";

export type SourceOfTruth = "app" | "hubspot" | "";

export type SyncDirection = "app-to-hs" | "hs-to-app" | "bidirectional" | "none" | "";

export type UpdatePolicy = "app-wins" | "hubspot-wins" | "latest-wins" | "";

export type ConflictPolicy = "source-wins" | "manual" | "";

export type HubSpotObject = "deal" | "company" | "";
export type RequiredOnCreate = "none" | "company" | "deal" | "both";
export type RequiredMode = "hard" | "warning";

export interface FieldRegistryEntry {
  /** Human-readable field name (primary key) */
  fieldName: string;
  type: FieldType;
  location: FieldLocation;
  sourceOfTruth: SourceOfTruth;
  syncDirection: SyncDirection;
  updatePolicy: UpdatePolicy;
  conflictPolicy: ConflictPolicy;
  required: boolean;
  requiredOnCreate: RequiredOnCreate;
  requiredMode: RequiredMode;
  createDefault: string;
  allowedValues: string[];
  min?: number;
  max?: number;
  /** HubSpot internal property name (e.g. "dealname") */
  hubspotProperty: string;
  hubspotObject: HubSpotObject;
  /** Dot-path into the app DiligenceRecord, e.g. "metrics.arr.value" */
  appPath: string;
  notes: string;
  uiOrder?: number;
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/**
 * Minimal CSV line parser that handles quoted fields (double-quote escaping).
 * Does NOT handle embedded newlines inside quotes — those are not expected
 * in this registry CSV.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote?
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip next quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current); // last field
  return fields;
}

function rowToEntry(headers: string[], values: string[]): FieldRegistryEntry {
  const get = (colName: string): string => {
    const idx = headers.indexOf(colName);
    return idx >= 0 && idx < values.length ? values[idx].trim() : "";
  };
  const uiOrderRaw = get("ui_order");
  const uiOrderParsed = uiOrderRaw ? Number(uiOrderRaw) : undefined;

  return {
    fieldName: get("field_name"),
    type: (get("type") || "string") as FieldType,
    location: (get("location") || "app-only") as FieldLocation,
    sourceOfTruth: get("source_of_truth") as SourceOfTruth,
    syncDirection: (get("sync_direction") || "") as SyncDirection,
    updatePolicy: (get("update_policy") || "") as UpdatePolicy,
    conflictPolicy: (get("conflict_policy") || "") as ConflictPolicy,
    required: get("required").toLowerCase() === "true",
    requiredOnCreate: (get("required_on_create") || "none") as RequiredOnCreate,
    requiredMode: (get("required_mode") || "warning") as RequiredMode,
    createDefault: get("create_default"),
    allowedValues: get("allowed_values")
      ? get("allowed_values").split(";").map((v) => v.trim()).filter(Boolean)
      : [],
    min: get("min") ? Number(get("min")) : undefined,
    max: get("max") ? Number(get("max")) : undefined,
    hubspotProperty: get("hubspot_property"),
    hubspotObject: (get("hubspot_object") || "") as HubSpotObject,
    appPath: get("app_path"),
    notes: get("notes"),
    uiOrder: Number.isFinite(uiOrderParsed) ? uiOrderParsed : undefined,
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cachedEntries: FieldRegistryEntry[] | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function csvFilePath(): string {
  return path.join(process.cwd(), "config", "field-registry.csv");
}

function loadCsvSync(): FieldRegistryEntry[] {
  const raw = fs.readFileSync(csvFilePath(), "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const entries: FieldRegistryEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const entry = rowToEntry(headers, values);
    if (entry.fieldName) {
      entries.push(entry);
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns all entries from the field registry CSV.
 * Results are cached for 5 minutes.
 */
export function getFieldRegistry(forceRefresh = false): FieldRegistryEntry[] {
  if (!forceRefresh && cachedEntries && Date.now() - cacheTimestamp < CACHE_DURATION) {
    return cachedEntries;
  }

  try {
    cachedEntries = loadCsvSync();
    cacheTimestamp = Date.now();
    return cachedEntries;
  } catch (err) {
    console.error("Failed to load field-registry.csv:", err);
    // Return cached if available, else empty array
    return cachedEntries ?? [];
  }
}

/**
 * Clear the registry cache (useful for testing / hot-reloading).
 */
export function clearFieldRegistryCache(): void {
  cachedEntries = null;
  cacheTimestamp = 0;
}

// ---------------------------------------------------------------------------
// Helper: HubSpot company property names to request
// ---------------------------------------------------------------------------

/**
 * Returns the list of HubSpot *company* property names from the registry.
 * Used when calling `companies.basicApi.getById(...)`.
 */
export function getHubSpotCompanyProperties(): string[] {
  const entries = getFieldRegistry();
  const props = entries
    .filter((e) => e.hubspotObject === "company" && e.hubspotProperty)
    .map((e) => e.hubspotProperty);
  return [...new Set(props)];
}

/**
 * Returns the standard (non-custom) HubSpot company property names.
 * Used as a fallback if the full list throws (custom properties not
 * provisioned yet in the portal).
 *
 * These are the safe, universally-available HubSpot company properties
 * that won't 400 on portals without the custom founder-form fields.
 */
const WELL_KNOWN_STANDARD_COMPANY_PROPS = new Set([
  "name", "domain", "description", "website", "annualrevenue",
  "numberofemployees", "founded_year", "city", "state", "country",
  "linkedin_company_page",
]);

export function getHubSpotStandardCompanyProperties(): string[] {
  const entries = getFieldRegistry();
  const standardFields = entries.filter(
    (e) =>
      e.hubspotObject === "company" &&
      e.hubspotProperty &&
      WELL_KNOWN_STANDARD_COMPANY_PROPS.has(e.hubspotProperty)
  );
  return [...new Set(standardFields.map((e) => e.hubspotProperty))];
}

// ---------------------------------------------------------------------------
// Helper: HubSpot deal property names
// ---------------------------------------------------------------------------

/**
 * Returns the HubSpot *deal* properties the app needs to read.
 */
export function getHubSpotDealReadProperties(): string[] {
  const entries = getFieldRegistry();
  const props = entries
    .filter((e) => e.hubspotObject === "deal" && e.hubspotProperty)
    .map((e) => e.hubspotProperty);
  // Always include core deal properties even if not in CSV
  const base = ["dealname", "dealstage", "pipeline", "amount", "description", "hs_next_step"];
  return [...new Set([...base, ...props])];
}

/**
 * Returns the deal properties the app writes to when syncing a
 * scored diligence record *to* HubSpot.
 * (Only fields with sync_direction "app-to-hs" or "bidirectional"
 *  and hubspot_object "deal".)
 */
export function getAppToHubSpotDealWriteFields(): FieldRegistryEntry[] {
  const entries = getFieldRegistry();
  return entries.filter(
    (e) =>
      e.hubspotObject === "deal" &&
      e.hubspotProperty &&
      (e.syncDirection === "app-to-hs" || e.syncDirection === "bidirectional")
  );
}

/**
 * Returns fields that can be used when creating HubSpot objects from app data.
 * Includes app-to-hs and bidirectional mappings with a valid appPath.
 */
export function getHubSpotCreateFields(
  object: "deal" | "company",
  options?: { includeHsToApp?: boolean }
): FieldRegistryEntry[] {
  const entries = getFieldRegistry();
  const includeHsToApp = Boolean(options?.includeHsToApp);
  return entries.filter(
    (e) =>
      e.hubspotObject === object &&
      e.hubspotProperty &&
      e.appPath &&
      (
        e.syncDirection === "app-to-hs" ||
        e.syncDirection === "bidirectional" ||
        (includeHsToApp && e.syncDirection === "hs-to-app")
      )
  );
}

// ---------------------------------------------------------------------------
// Helper: company property → HubSpotCompanyData key mapping
// ---------------------------------------------------------------------------

export interface CompanyPropertyMapping {
  hubspotProperty: string;
  /** The key on HubSpotCompanyData, e.g. "annualRevenue" */
  appKey: string;
  /** Whether the raw value should be run through normalizeMultiSelect */
  multiSelect: boolean;
}

/**
 * Returns the mapping from HubSpot company property names to the
 * HubSpotCompanyData interface keys.
 *
 * The `appKey` is derived from the `app_path` column by stripping the
 * "hubspotCompanyData." prefix and taking the remainder (e.g.
 * "hubspotCompanyData.annualRevenue" → "annualRevenue").
 */
export function getCompanyPropertyMappings(): CompanyPropertyMapping[] {
  const entries = getFieldRegistry();
  return entries
    .filter(
      (e) =>
        e.hubspotObject === "company" &&
        e.hubspotProperty &&
        e.appPath.startsWith("hubspotCompanyData.")
    )
    .map((e) => ({
      hubspotProperty: e.hubspotProperty,
      appKey: e.appPath.replace("hubspotCompanyData.", ""),
      multiSelect: e.type === "multi-select",
    }));
}

// ---------------------------------------------------------------------------
// Helper: look up a single entry by field name
// ---------------------------------------------------------------------------

export function getFieldByName(fieldName: string): FieldRegistryEntry | undefined {
  return getFieldRegistry().find((e) => e.fieldName === fieldName);
}

// ---------------------------------------------------------------------------
// Helper: entries that reference a criterion (via the criteria sheet link)
// ---------------------------------------------------------------------------

/**
 * Search for field registry entries whose `fieldName` matches a given key.
 * This is used when the criteria sheet references a field_registry_key to
 * connect a scoring criterion to its underlying data field.
 */
export function getFieldsForCriterionKey(fieldRegistryKey: string): FieldRegistryEntry[] {
  if (!fieldRegistryKey) return [];
  return getFieldRegistry().filter((e) => e.fieldName === fieldRegistryKey);
}
