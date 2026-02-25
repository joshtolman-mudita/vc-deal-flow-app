import { NextRequest, NextResponse } from "next/server";
import { isHubSpotConfigured } from "@/lib/hubspot";
import { getHubSpotDealById } from "@/lib/hubspot-sync";

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
