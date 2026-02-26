import { NextRequest, NextResponse } from "next/server";
import hubspotClient, { isHubSpotConfigured } from "@/lib/hubspot";
import { getHubSpotDealById } from "@/lib/hubspot-sync";
import {
  findDiligenceRecordByHubspotDealId,
  updateDiligenceRecord,
} from "@/lib/diligence-storage";

// Maps HubSpot financial property names → diligence metrics keys
const HS_PROP_TO_METRIC_KEY: Record<string, "fundingAmount" | "committed" | "valuation"> = {
  raise_amount_in_millions: "fundingAmount",
  committed_funding_in_millions: "committed",
  deal_valuation_post_money_in_millions: "valuation",
};

export async function GET(request: NextRequest) {
  try {
    if (!isHubSpotConfigured()) {
      return NextResponse.json(
        { success: false, error: "HubSpot is not configured" },
        { status: 200 }
      );
    }

    const dealId = (request.nextUrl.searchParams.get("dealId") || "").trim();
    if (!dealId) {
      return NextResponse.json(
        { success: false, error: "dealId is required" },
        { status: 400 }
      );
    }

    const deal = await getHubSpotDealById(dealId);
    if (!deal) {
      return NextResponse.json(
        { success: false, error: "HubSpot deal not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, deal });
  } catch (error) {
    console.error("Error fetching HubSpot deal:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch HubSpot deal",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    if (!isHubSpotConfigured()) {
      return NextResponse.json(
        { success: false, error: "HubSpot is not configured" },
        { status: 200 }
      );
    }

    const { dealId, properties } = await request.json();
    if (!dealId || !properties) {
      return NextResponse.json(
        { success: false, error: "dealId and properties are required" },
        { status: 400 }
      );
    }

    // Write to HubSpot
    await hubspotClient.crm.deals.basicApi.update(dealId, { properties });

    // Check if any financial fields were updated
    const financialUpdates: Partial<Record<"fundingAmount" | "committed" | "valuation", string>> = {};
    for (const [hsProp, metricKey] of Object.entries(HS_PROP_TO_METRIC_KEY)) {
      if (properties[hsProp] != null && String(properties[hsProp]).trim() !== "") {
        financialUpdates[metricKey] = String(properties[hsProp]).trim();
      }
    }

    // If financial fields changed, sync back to the linked diligence record (non-blocking)
    if (Object.keys(financialUpdates).length > 0) {
      syncFinancialsToDigilenceRecord(dealId, financialUpdates).catch((err) =>
        console.warn("Non-blocking: failed to sync financials back to diligence record:", err)
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating HubSpot deal:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update HubSpot deal",
      },
      { status: 500 }
    );
  }
}

async function syncFinancialsToDigilenceRecord(
  dealId: string,
  updates: Partial<Record<"fundingAmount" | "committed" | "valuation", string>>
) {
  const record = await findDiligenceRecordByHubspotDealId(dealId);
  if (!record) return;

  const now = new Date().toISOString();
  const metricUpdates: Record<string, { value: string; source: "manual"; sourceDetail: "hubspot"; updatedAt: string }> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (value) {
      metricUpdates[key] = { value, source: "manual", sourceDetail: "hubspot", updatedAt: now };
    }
  }

  if (Object.keys(metricUpdates).length === 0) return;

  await updateDiligenceRecord(record.id, {
    metrics: {
      ...record.metrics,
      ...metricUpdates,
    },
  });
}
