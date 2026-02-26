#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * backfill-deal-financials.js
 *
 * Reads every diligence record from GCS (or local), and for each record that
 * has a linked HubSpot deal AND has raise/committed/valuation metric values,
 * writes those values to the three HubSpot deal properties:
 *   - raise_amount_in_millions
 *   - committed_funding_in_millions
 *   - deal_valuation_post_money_in_millions
 *
 * Usage (dry run — shows what would change, writes nothing):
 *   node scripts/backfill-deal-financials.js
 *
 * Usage (apply changes):
 *   node scripts/backfill-deal-financials.js --apply
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("@hubspot/api-client");
const { Storage } = require("@google-cloud/storage");

const DRY_RUN = !process.argv.includes("--apply");

// ─── Load env ────────────────────────────────────────────────────────────────

function loadEnv(envFile) {
  const envPath = path.join(process.cwd(), envFile);
  if (!fs.existsSync(envPath)) return {};
  const raw = fs.readFileSync(envPath, "utf8");
  const vars = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    vars[key] = val;
  }
  return vars;
}

// Prefer .env.local for dev; fall back to env
const envVars = loadEnv(".env.local");
const HUBSPOT_TOKEN = envVars.HUBSPOT_ACCESS_TOKEN || process.env.HUBSPOT_ACCESS_TOKEN || "";
const STORAGE_BACKEND = envVars.STORAGE_BACKEND || process.env.STORAGE_BACKEND || "local";
const GCS_BUCKET_NAME = envVars.GCS_BUCKET_NAME || process.env.GCS_BUCKET_NAME || "";
const GOOGLE_CLIENT_EMAIL = envVars.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || "";
const GOOGLE_PRIVATE_KEY = (envVars.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY || "")
  .replace(/\\n/g, "\n");

if (!HUBSPOT_TOKEN) {
  console.error("ERROR: HUBSPOT_ACCESS_TOKEN not found in .env.local or environment.");
  process.exit(1);
}

// ─── Load diligence records ───────────────────────────────────────────────────

async function loadAllDiligenceRecords() {
  if (STORAGE_BACKEND === "gcs") {
    if (!GCS_BUCKET_NAME || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
      throw new Error("GCS credentials missing. Check GCS_BUCKET_NAME, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY.");
    }
    const storage = new Storage({
      credentials: { client_email: GOOGLE_CLIENT_EMAIL, private_key: GOOGLE_PRIVATE_KEY },
    });
    const bucket = storage.bucket(GCS_BUCKET_NAME);
    const [files] = await bucket.getFiles({ prefix: "diligence/" });
    const jsonFiles = files.filter((f) => f.name.endsWith(".json"));
    console.log(`  Found ${jsonFiles.length} diligence files in GCS bucket "${GCS_BUCKET_NAME}"`);
    const records = await Promise.all(
      jsonFiles.map(async (file) => {
        try {
          const [contents] = await file.download();
          return JSON.parse(contents.toString("utf-8"));
        } catch {
          return null;
        }
      })
    );
    return records.filter(Boolean);
  } else {
    const dir = path.join(process.cwd(), "data", "diligence");
    if (!fs.existsSync(dir)) {
      console.warn(`  Local diligence directory not found: ${dir}`);
      return [];
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    console.log(`  Found ${files.length} diligence files in local storage`);
    return files
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
}

// ─── Normalise a metric value to a plain millions number string ───────────────
// e.g. "$4M" → "4", "4000000" → "4", "20" → "20", "$1.5M" → "1.5"

function normalizeToMillions(raw) {
  if (!raw) return "";
  const cleaned = String(raw).toLowerCase().replace(/[$,\s]/g, "");
  const match = cleaned.match(/^(-?\d+(?:\.\d+)?)([kmb])?$/);
  if (!match) return ""; // ranges / text — skip
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return "";
  let millions;
  if (match[2] === "b") millions = base * 1000;
  else if (match[2] === "m") millions = base;
  else if (match[2] === "k") millions = base / 1000;
  else millions = base > 100000 ? base / 1_000_000 : base;
  const rounded = Math.round(millions * 100) / 100;
  return Number.isInteger(rounded) ? String(Math.trunc(rounded)) : String(rounded);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Diligence → HubSpot Financial Backfill ===");
  console.log(`Mode:    ${DRY_RUN ? "DRY RUN (pass --apply to write)" : "APPLY — writing to HubSpot"}`);
  console.log(`Backend: ${STORAGE_BACKEND}`);
  console.log("");

  const hubspot = new Client({ accessToken: HUBSPOT_TOKEN });

  console.log("Loading diligence records...");
  const records = await loadAllDiligenceRecords();
  console.log(`  Loaded ${records.length} total records`);
  console.log("");

  let skipped = 0;
  let noData = 0;
  let updated = 0;
  let errors = 0;

  for (const record of records) {
    const name = record.companyName || record.id;

    if (!record.hubspotDealId) {
      skipped++;
      continue;
    }

    const raiseRaw = record.metrics?.fundingAmount?.value || "";
    const committedRaw = record.metrics?.committed?.value || "";
    const valuationRaw = record.metrics?.valuation?.value || "";

    const raise = normalizeToMillions(raiseRaw);
    const committed = normalizeToMillions(committedRaw);
    const valuation = normalizeToMillions(valuationRaw);

    if (!raise && !committed && !valuation) {
      noData++;
      continue;
    }

    const props = {};
    if (raise) props["raise_amount_in_millions"] = raise;
    if (committed) props["committed_funding_in_millions"] = committed;
    if (valuation) props["deal_valuation_post_money_in_millions"] = valuation;

    const propSummary = Object.entries(props)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");

    if (DRY_RUN) {
      console.log(`  [DRY RUN] ${name} (deal ${record.hubspotDealId}): would set ${propSummary}`);
      updated++;
      continue;
    }

    try {
      await hubspot.crm.deals.basicApi.update(record.hubspotDealId, { properties: props });
      console.log(`  ✓ ${name} (deal ${record.hubspotDealId}): set ${propSummary}`);
      updated++;
      // Small delay to avoid rate limits
      await new Promise((r) => setTimeout(r, 150));
    } catch (err) {
      console.error(`  ✗ ${name} (deal ${record.hubspotDealId}): ${err?.message || err}`);
      errors++;
    }
  }

  console.log("");
  console.log("=== Summary ===");
  console.log(`  ${updated}  record(s) ${DRY_RUN ? "would be updated" : "updated"}`);
  console.log(`  ${skipped}  record(s) skipped (no linked HubSpot deal)`);
  console.log(`  ${noData}  record(s) skipped (no raise/committed/valuation data)`);
  if (errors) console.log(`  ${errors}  error(s)`);
  console.log("");
  if (DRY_RUN) {
    console.log("Run with --apply to write these values to HubSpot:");
    console.log("  node scripts/backfill-deal-financials.js --apply");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
