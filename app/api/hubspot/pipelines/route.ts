import { NextResponse } from "next/server";
import hubspotClient, { isHubSpotConfigured } from "@/lib/hubspot";

export async function GET() {
  try {
    if (!isHubSpotConfigured()) {
      return NextResponse.json({ error: "HubSpot not configured" }, { status: 400 });
    }

    // Fetch all deal pipelines
    const pipelinesResponse = await hubspotClient.crm.pipelines.pipelinesApi.getAll("deals");
    
    console.log("\n=== AVAILABLE PIPELINES ===");
    pipelinesResponse.results.forEach((pipeline: any) => {
      console.log(`Pipeline: "${pipeline.label}" (ID: ${pipeline.id})`);
    });
    console.log("=== END PIPELINES ===\n");

    return NextResponse.json({
      pipelines: pipelinesResponse.results.map((p: any) => ({
        id: p.id,
        label: p.label,
        displayOrder: p.displayOrder,
      })),
    });

  } catch (error: any) {
    console.error("Error fetching pipelines:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

