import { NextRequest, NextResponse } from "next/server";
import { isHubSpotConfigured } from "@/lib/hubspot";
import { getAssociatedCompanyForDeal } from "@/lib/hubspot-sync";

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

    const company = await getAssociatedCompanyForDeal(dealId);
    return NextResponse.json({
      success: true,
      company,
    });
  } catch (error) {
    console.error("Error fetching HubSpot associated company:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch associated company",
      },
      { status: 500 }
    );
  }
}
