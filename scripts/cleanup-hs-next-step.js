#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { Client } = require("@hubspot/api-client");

function loadTokenFromEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return process.env.HUBSPOT_ACCESS_TOKEN || "";
  const raw = fs.readFileSync(envPath, "utf8");
  const line = raw
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith("HUBSPOT_ACCESS_TOKEN="));
  if (!line) return process.env.HUBSPOT_ACCESS_TOKEN || "";
  return line.slice("HUBSPOT_ACCESS_TOKEN=".length).trim().replace(/^['"]|['"]$/g, "");
}

function isLikelyScoringDump(text) {
  if (!text) return false;
  const value = String(text);

  const markers = [
    /overall score/i,
    /category breakdown/i,
    /diligence score/i,
    /what is exciting/i,
    /what is concerning/i,
    /why this fits/i,
    /why it might not be a fit/i,
    /recommendation/i,
  ];
  const matched = markers.filter((rx) => rx.test(value)).length;
  if (matched >= 2) return true;
  // Catch shorter but still obviously generated score dumps
  if (matched >= 1 && value.length >= 220) return true;
  return false;
}

async function listAllDeals(client) {
  const results = [];
  let after;
  let page = 0;
  do {
    const resp = await client.crm.deals.searchApi.doSearch({
      filterGroups: [],
      properties: ["dealname", "hs_next_step", "hs_lastmodifieddate"],
      sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
      limit: 100,
      after,
    });
    results.push(...(resp.results || []));
    after = resp.paging && resp.paging.next ? resp.paging.next.after : undefined;
    page += 1;
    if (page > 40) break;
  } while (after);
  return results;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const token = loadTokenFromEnvLocal();
  if (!token) {
    console.error("Missing HUBSPOT_ACCESS_TOKEN in .env.local or env.");
    process.exit(1);
  }

  const client = new Client({ accessToken: token });
  const deals = await listAllDeals(client);
  const polluted = deals.filter((d) => isLikelyScoringDump(d.properties?.hs_next_step));

  console.log(`Scanned deals: ${deals.length}`);
  console.log(`Likely polluted hs_next_step records: ${polluted.length}`);
  polluted.slice(0, 20).forEach((d, i) => {
    const name = d.properties?.dealname || "(untitled)";
    const len = (d.properties?.hs_next_step || "").length;
    console.log(`${i + 1}. ${name} (id=${d.id}, chars=${len})`);
  });

  if (!apply) {
    console.log("Preview only. Re-run with --apply to clear hs_next_step for these records.");
    return;
  }

  let updated = 0;
  for (const deal of polluted) {
    try {
      await client.crm.deals.basicApi.update(deal.id, {
        properties: { hs_next_step: "" },
      });
      updated += 1;
    } catch (err) {
      const name = deal.properties?.dealname || deal.id;
      console.warn(`Failed to update ${name}: ${err.message || err}`);
    }
  }
  console.log(`Cleared hs_next_step on ${updated}/${polluted.length} deals.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

