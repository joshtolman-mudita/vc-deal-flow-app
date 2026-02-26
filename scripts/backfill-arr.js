#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * backfill-arr.js
 *
 * Reads every diligence record from GCS (or local), and for each record that
 * has a linked HubSpot deal AND has an ARR metric value, writes that value to
 * the HubSpot deal property:  portco_arr
 *
 * Usage (dry run — shows what would change, writes nothing):
 *   node scripts/backfill-arr.js
 *
 * Usage (apply changes):
 *   node scripts/backfill-arr.js --apply
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("@hubspot/api-client");
const { Storage } = require("@google-cloud/storage");

const DRY_RUN = !process.argv.includes("--apply");

// ─── Load env ─────────────────────────────────────────────────────────────────

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

// ─── Normalize ARR string → plain dollar integer string ──────────────────────
// "$1.2M" → "1200000", "$160k" → "160000", "$30,000" → "30000"
function normalizeToDollars(raw) {
  if (!raw) return "";
  const clean = String(raw).replace(/[$,\s]/g, "").toLowerCase();
  const match = clean.match(/^([\d.]+)([kmb]?)$/);
  if (!match) return ""; // non-numeric ("Not specified", ranges, etc.) — skip
  const n = parseFloat(match[1]);
  if (!Number.isFinite(n)) return "";
  if (match[2] === "b") return String(Math.round(n * 1_000_000_000));
  if (match[2] === "m") return String(Math.round(n * 1_000_000));
  if (match[2] === "k") return String(Math.round(n * 1_000));
  return String(Math.round(n));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Diligence → HubSpot ARR Backfill ===");
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

    const arrRaw = (record.metrics?.arr?.value || "").trim();
    const arrDollars = normalizeToDollars(arrRaw);

    if (!arrDollars) {
      noData++;
      if (arrRaw) console.log(`  [SKIP] ${name}: could not normalize "${arrRaw}" to a number`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] ${name} (deal ${record.hubspotDealId}): "${arrRaw}" → portco_arr=${arrDollars}`);
      updated++;
      continue;
    }

    try {
      await hubspot.crm.deals.basicApi.update(record.hubspotDealId, {
        properties: { portco_arr: arrDollars },
      });
      console.log(`  ✓ ${name} (deal ${record.hubspotDealId}): "${arrRaw}" → portco_arr=${arrDollars}`);
      updated++;
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
  console.log(`  ${noData}  record(s) skipped (no ARR data)`);
  if (errors) console.log(`  ${errors}  error(s)`);
  console.log("");
  if (DRY_RUN) {
    console.log("Run with --apply to write these values to HubSpot (portco_arr):");
    console.log("  node scripts/backfill-arr.js --apply");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
