import { NextResponse } from "next/server";
import hubspotClient, { isHubSpotConfigured } from "@/lib/hubspot";

export async function GET() {
  try {
    if (!isHubSpotConfigured()) {
      return NextResponse.json({ error: "HubSpot not configured" }, { status: 400 });
    }

    // Get account info using the settings API
    const accountInfo = await hubspotClient.apiRequest({
      method: 'GET',
      path: '/integrations/v1/me'
    }) as any;

    console.log("\n=== HUBSPOT ACCOUNT INFO ===");
    console.log("Portal ID:", accountInfo.portalId);
    console.log("=== END ACCOUNT INFO ===\n");

    return NextResponse.json({
      portalId: accountInfo.portalId,
      hubId: accountInfo.portalId,
    });

  } catch (error: any) {
    console.error("Error fetching HubSpot account info:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

