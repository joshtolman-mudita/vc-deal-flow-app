import { NextResponse } from "next/server";
import hubspotClient, { isHubSpotConfigured } from "@/lib/hubspot";

export async function GET() {
  try {
    // Check if HubSpot is configured
    if (!isHubSpotConfigured()) {
      return NextResponse.json({
        configured: false,
        connected: false,
        message: "HubSpot access token not configured",
      });
    }

    // Try to fetch account info to verify connection
    try {
      await hubspotClient.crm.deals.basicApi.getPage(1);
      
      return NextResponse.json({
        configured: true,
        connected: true,
        message: "Successfully connected to HubSpot",
      });
    } catch (apiError: any) {
      return NextResponse.json({
        configured: true,
        connected: false,
        message: apiError.message || "Failed to connect to HubSpot",
        error: apiError.statusCode === 401 ? "Invalid access token" : "API error",
      });
    }

  } catch (error: any) {
    return NextResponse.json({
      configured: false,
      connected: false,
      message: error.message || "Error checking HubSpot status",
    });
  }
}

