#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Creates the diligence_arr custom property on HubSpot deals (one-time setup).
 * Run: node scripts/create-arr-property.js
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("@hubspot/api-client");

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
    vars[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return vars;
}

const envVars = loadEnv(".env.local");
const HUBSPOT_TOKEN = envVars.HUBSPOT_ACCESS_TOKEN || process.env.HUBSPOT_ACCESS_TOKEN || "";

if (!HUBSPOT_TOKEN) {
  console.error("ERROR: HUBSPOT_ACCESS_TOKEN not found.");
  process.exit(1);
}

async function main() {
  const client = new Client({ accessToken: HUBSPOT_TOKEN });
  console.log("Creating diligence_arr property on HubSpot deals...");
  try {
    const result = await client.crm.properties.coreApi.create("deals", {
      name: "diligence_arr",
      label: "Diligence ARR",
      type: "string",
      fieldType: "text",
      groupName: "dealinformation",
      description: "Annual Recurring Revenue synced from diligence record",
    });
    console.log("Created property:", result.name, "(label:", result.label + ")");
  } catch (err) {
    const msg = err?.body?.message || err?.message || String(err);
    if (msg.includes("already exists") || msg.includes("PROPERTY_ALREADY_EXISTS")) {
      console.log("Property already exists — nothing to do.");
    } else {
      console.error("Failed:", msg);
      process.exit(1);
    }
  }
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
