import { NextRequest, NextResponse } from "next/server";
import { isHubSpotConfigured } from "@/lib/hubspot";
import { searchHubSpotDealsByName } from "@/lib/hubspot-sync";

export async function GET(request: NextRequest) {
  try {
    if (!isHubSpotConfigured()) {
      return NextResponse.json(
        { success: false, error: "HubSpot is not configured", deals: [] },
        { status: 200 },
      );
    }

    const query = request.nextUrl.searchParams.get("query") || "";
    if (!query.trim()) {
      return NextResponse.json({ success: true, deals: [] });
    }

    const deals = await searchHubSpotDealsByName(query, 20);
    return NextResponse.json({ success: true, deals });
  } catch (error) {
    console.error("Error searching HubSpot deals:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to search deals", deals: [] },
      { status: 500 },
    );
  }
}
