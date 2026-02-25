import { NextRequest, NextResponse } from "next/server";
import hubspotClient, { isHubSpotConfigured } from "@/lib/hubspot";

export const dynamic = "force-dynamic";

/**
 * GET /api/hubspot/stages
 * 
 * Fetches all HubSpot deal pipelines and their stages for use in
 * dropdown filters and stage selection.
 */
export async function GET(request: NextRequest) {
  try {
    if (!isHubSpotConfigured()) {
      return NextResponse.json(
        { success: false, error: "HubSpot is not configured" },
        { status: 400 }
      );
    }

    const pipelinesResponse = await hubspotClient.crm.pipelines.pipelinesApi.getAll("deals");
    
    // Transform to a simpler structure for the frontend
    const pipelines = (pipelinesResponse.results || [])
      .filter((pipeline: any) => pipeline && pipeline.archived !== true)
      .map((pipeline: any) => ({
        id: pipeline.id,
        label: pipeline.label,
        displayOrder: pipeline.displayOrder,
        stages: (pipeline.stages || [])
          .filter((stage: any) => stage && stage.archived !== true)
          .map((stage: any) => ({
            id: stage.id,
            label: stage.label,
            displayOrder: stage.displayOrder,
          }))
          .sort((a: any, b: any) => a.displayOrder - b.displayOrder),
      }));

    return NextResponse.json({
      success: true,
      pipelines,
    });
  } catch (error) {
    console.error("Error fetching HubSpot stages:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch HubSpot stages",
      },
      { status: 500 }
    );
  }
}
