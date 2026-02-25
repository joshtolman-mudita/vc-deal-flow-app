import { NextRequest, NextResponse } from "next/server";
import hubspotClient, { isHubSpotConfigured } from "@/lib/hubspot";
import { mapHubSpotDealToAppDeal, shouldIncludeDeal, DEAL_PROPERTIES } from "@/lib/hubspot-utils";
import { listDiligenceRecords } from "@/lib/diligence-storage";

export async function GET(request: NextRequest) {
  try {
    // Check if HubSpot is configured
    if (!isHubSpotConfigured()) {
      return NextResponse.json(
        { 
          error: "HubSpot is not configured. Please add HUBSPOT_ACCESS_TOKEN to your .env.local file.",
          deals: [],
          configured: false
        },
        { status: 200 } // Return 200 to allow graceful degradation
      );
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const properties = searchParams.get("properties")?.split(",") || DEAL_PROPERTIES;

    // Fetch pipeline metadata to map IDs to names AND stage IDs to stage names
    const pipelinesResponse = await hubspotClient.crm.pipelines.pipelinesApi.getAll("deals");
    
    // Log the full response to see if portal ID is there
    console.log("\n=== PIPELINES API RESPONSE (checking for portal ID) ===");
    console.log("Response keys:", Object.keys(pipelinesResponse));
    console.log("=== END PIPELINES CHECK ===\n");
    
    const pipelineMap = new Map(
      pipelinesResponse.results.map((p: any) => [p.id, p.label])
    );
    
    // Create a map of stage IDs to stage labels for all pipelines
    const stageMap = new Map();
    pipelinesResponse.results.forEach((pipeline: any) => {
      pipeline.stages?.forEach((stage: any) => {
        stageMap.set(stage.id, {
          label: stage.label,
          pipelineLabel: pipeline.label
        });
      });
    });
    
    // Get the IDs for Fund I and Fund II Deal Flow pipelines
    const targetPipelineIds = pipelinesResponse.results
      .filter((p: any) => 
        p.label === "Fund I Deal Flow" || p.label === "Fund II Deal Flow"
      )
      .map((p: any) => p.id);
    
    console.log("\n=== TARGET PIPELINES ===");
    targetPipelineIds.forEach(id => {
      console.log(`"${pipelineMap.get(id)}" (ID: ${id})`);
    });

    // Fetch deals sorted by most recently modified using search API
    let allDeals: any[] = [];
    let after: number | undefined = undefined;
    let pageCount = 0;
    const maxPages = 10; // Safety limit to prevent infinite loops
    
    do {
      const searchRequest: any = {
        filterGroups: [],
        properties: DEAL_PROPERTIES,
        limit: 100,
        after: after ? String(after) : undefined,
        sorts: [
          {
            propertyName: "hs_lastmodifieddate",
            direction: "DESCENDING" as const
          }
        ]
      };
      
      const dealsResponse = await hubspotClient.crm.deals.searchApi.doSearch(searchRequest);
      
      allDeals = allDeals.concat(dealsResponse.results);
      after = dealsResponse.paging?.next?.after ? parseInt(dealsResponse.paging.next.after) : undefined;
      pageCount++;
      
      console.log(`Fetched page ${pageCount}: ${dealsResponse.results.length} deals (total so far: ${allDeals.length})`);
      
    } while (after && pageCount < maxPages);
    
    console.log(`\nTotal fetched: ${allDeals.length} deals across ${pageCount} pages`);
    
    // Log sample deal stages from INVESTMENT pipelines only
    const investmentDeals = allDeals.filter((deal: any) => {
      const pipelineId = deal.properties?.pipeline;
      const pipelineName = pipelineMap.get(pipelineId);
      return pipelineName === "Fund I Deal Flow" || pipelineName === "Fund II Deal Flow";
    });
    
    console.log(`\n=== SAMPLE DEALS FROM INVESTMENT PIPELINES (${investmentDeals.length} total) ===`);
    investmentDeals.slice(0, 3).forEach((deal: any) => {
      const stageId = deal.properties?.dealstage;
      const stageInfo = stageMap.get(stageId);
      const stageName = stageInfo?.label || stageId;
      console.log(`\n- ${deal.properties?.dealname}`);
      console.log(`  Stage: "${stageName}" (ID: ${stageId})`);
    });
    
    // Find a deal that's paused or at pitch stage (more likely to have data)
    const sampleDeal = investmentDeals.find((d: any) => {
      const stageId = d.properties?.dealstage;
      const stageInfo = stageMap.get(stageId);
      const stageName = stageInfo?.label || "";
      return stageName.includes("Paused") || stageName.includes("Pitch");
    }) || investmentDeals[0];
    
    if (sampleDeal) {
      const stageId = sampleDeal.properties?.dealstage;
      const stageInfo = stageMap.get(stageId);
      const stageName = stageInfo?.label || "";
      
      console.log(`\n=== ALL PROPERTIES OF "${sampleDeal.properties?.dealname}" (${stageName}) ===`);
      const allProps = Object.keys(sampleDeal.properties || {}).sort();
      
      console.log(`Total properties: ${allProps.length}`);
      console.log("\nALL properties (including empty):");
      allProps.forEach(prop => {
        const value = sampleDeal.properties[prop];
        if (value && typeof value === 'string' && value.length > 0) {
          const displayValue = value.length > 80 ? value.substring(0, 80) + '...' : value;
          console.log(`  ${prop}: "${displayValue}"`);
        } else {
          console.log(`  ${prop}: [empty]`);
        }
      });
      console.log("=== END PROPERTIES ===");
    }
    console.log();
    
    // Get unique stages from investment pipelines with names
    const uniqueStageIds = new Set(
      investmentDeals.map((deal: any) => deal.properties?.dealstage).filter(Boolean)
    );
    console.log("=== UNIQUE STAGES IN INVESTMENT PIPELINES ===");
    Array.from(uniqueStageIds).forEach(stageId => {
      const stageInfo = stageMap.get(stageId);
      const stageName = stageInfo?.label || stageId;
      console.log(`  - "${stageName}" (ID: ${stageId})`);
    });
    console.log("=== END UNIQUE STAGES ===\n");

    // Helper function to check if a deal meets VC criteria
    const meetsVCCriteria = (deal: any): boolean => {
      const stageId = deal.properties?.dealstage || "";
      const lastModified = deal.properties?.hs_lastmodifieddate ? new Date(deal.properties.hs_lastmodifieddate) : null;
      const closeDate = deal.properties?.closedate ? new Date(deal.properties.closedate) : null;
      
      // Get the stage name from the stage ID
      const stageInfo = stageMap.get(stageId);
      const stageName = stageInfo?.label || "";
      
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      // In-progress deals (show all, regardless of date)
      const inProgressStages = [
        "Deal 2: Pitch",
        "Deal 3: Due Diligence",
        "Deal 4: Preliminary Vote",
        "Deal 5: Confirmatory Diligence", 
        "Deal 6: Final Vote",
      ];
      
      // For Close Win, only show recent ones (last 60 days based on close date OR last modified)
      if (stageName.toLowerCase() === "deal 7: close win / deploy funds") {
        const dateToCheck = closeDate || lastModified;
        const isRecent = dateToCheck && dateToCheck >= sixtyDaysAgo;
        
        // Debug logging for Close Win deals
        if (!isRecent) {
          console.log(`Filtering out Close Win deal: ${deal.properties?.dealname}`);
          console.log(`  Close Date: ${closeDate?.toISOString().split('T')[0]}`);
          console.log(`  Last Modified: ${lastModified?.toISOString().split('T')[0]}`);
          console.log(`  60 days ago: ${sixtyDaysAgo.toISOString().split('T')[0]}`);
        }
        
        return isRecent ?? false;
      }
      
      // For Paused deals, only show if modified in the last 30 days
      if (stageName.toLowerCase() === "deal 7: deal paused") {
        const isRecentlyPaused = lastModified && lastModified >= thirtyDaysAgo;
        
        // Debug logging for Paused deals
        if (!isRecentlyPaused) {
          console.log(`Filtering out old Paused deal: ${deal.properties?.dealname}`);
          console.log(`  Last Modified: ${lastModified?.toISOString().split('T')[0]}`);
          console.log(`  30 days ago: ${thirtyDaysAgo.toISOString().split('T')[0]}`);
        }
        
        return isRecentlyPaused ?? false;
      }
      
      // Exclude rejected/lost/early deals
      const excludedStages = [
        "Deal 7: Deal Rejected",
        "Deal 7: Deal Lost",
        "Deal 0: Triage",
        "Deal 1: Early Interest",
      ];
      
      const isExcluded = excludedStages.some(stage =>
        stageName.toLowerCase() === stage.toLowerCase()
      );
      
      if (isExcluded) {
        return false;
      }
      
      // Include if it's an in-progress stage
      const isInProgress = inProgressStages.some(stage => 
        stageName.toLowerCase() === stage.toLowerCase()
      );
      
      return isInProgress;
    };

    const diligenceRecords = await listDiligenceRecords();
    const diligenceByHubspotDealId = new Map(
      diligenceRecords.filter((record) => record.hubspotDealId).map((record) => [record.hubspotDealId!, record]),
    );
    const diligenceByName = new Map(
      diligenceRecords.map((record) => [record.companyName.toLowerCase(), record]),
    );

    // Filter and map HubSpot deals to our app format
    // Only include deals from Fund I Deal Flow and Fund II Deal Flow pipelines
    const deals = allDeals
      .filter((deal: any) => {
        const pipelineId = deal.properties?.pipeline;
        const pipelineName = pipelineMap.get(pipelineId);
        
        // If we can't find the pipeline name, skip this deal
        if (!pipelineName) {
          return false;
        }
        
        // Must be in the right pipeline
        if (!shouldIncludeDeal(deal, pipelineName)) {
          return false;
        }
        
        // Must meet VC criteria
        return meetsVCCriteria(deal);
      })
      .map((deal: any) => {
        const appDeal = mapHubSpotDealToAppDeal(deal, stageMap);
        const linkedDiligence =
          diligenceByHubspotDealId.get(appDeal.hubspotId || "") ||
          diligenceByName.get((appDeal.name || "").toLowerCase());
        if (linkedDiligence) {
          appDeal.diligenceId = linkedDiligence.id;
          appDeal.diligenceScore = linkedDiligence.score?.overall;
          appDeal.diligenceStatus = linkedDiligence.status;
        }
        return appDeal;
      });
    
    // Count deals by criteria for debugging
    console.log("\n=== FILTERING DEBUG ===");
    const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    
    const investmentDealsOnly = investmentDeals;
    
    // Count by creation date
    const created45Days = investmentDealsOnly.filter((d: any) => {
      const createDate = d.properties?.createdate ? new Date(d.properties.createdate) : null;
      return createDate && createDate >= fortyFiveDaysAgo;
    }).length;
    
    const created6Months = investmentDealsOnly.filter((d: any) => {
      const createDate = d.properties?.createdate ? new Date(d.properties.createdate) : null;
      return createDate && createDate >= sixMonthsAgo;
    }).length;
    
    // Count by modification date
    const modified30Days = investmentDealsOnly.filter((d: any) => {
      const lastModified = d.properties?.hs_lastmodifieddate ? new Date(d.properties.hs_lastmodifieddate) : null;
      return lastModified && lastModified >= thirtyDaysAgo;
    }).length;
    
    // Count by stage
    const stage2Plus = investmentDealsOnly.filter((d: any) => {
      const stageId = d.properties?.dealstage;
      const stageInfo = stageMap.get(stageId);
      const stageName = stageInfo?.label || "";
      return stageName.includes("Deal 2") || stageName.includes("Deal 3") || 
             stageName.includes("Deal 4") || stageName.includes("Deal 5") || 
             stageName.includes("Deal 6") || stageName.includes("Deal 7");
    }).length;
    
    console.log(`Investment deals: ${investmentDealsOnly.length}`);
    console.log(`Created in last 45 days: ${created45Days}`);
    console.log(`Created in last 6 months: ${created6Months}`);
    console.log(`Modified in last 30 days: ${modified30Days}`);
    console.log(`At Deal Stage 2+: ${stage2Plus}`);
    console.log(`Filtered ${deals.length} VC-relevant deals from ${allDeals.length} total deals`);
    
    // Show breakdown of filtered deals by stage
    const stageBreakdown = new Map<string, number>();
    deals.forEach((deal: any) => {
      const stageName = deal.stageName || "Unknown";
      stageBreakdown.set(stageName, (stageBreakdown.get(stageName) || 0) + 1);
    });
    
    console.log("\n=== FILTERED DEALS BY STAGE ===");
    Array.from(stageBreakdown.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([stage, count]) => {
        console.log(`  ${stage}: ${count} deals`);
      });
    console.log("=== END DEBUG ===\n");

    // For now, use a hardcoded portal ID or get it from environment variable
    // The user can find their portal ID in their HubSpot URL
    const portalId = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || "21880552";

    return NextResponse.json({
      deals,
      total: allDeals.length,
      configured: true,
      synced_at: new Date().toISOString(),
      portalId: portalId,
    });

  } catch (error: any) {
    console.error("Error fetching HubSpot deals:", error);

    // Handle specific HubSpot errors
    if (error.statusCode === 401) {
      return NextResponse.json(
        { 
          error: "Invalid HubSpot access token. Please check your credentials.",
          deals: [],
          configured: false
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { 
        error: error.message || "Failed to fetch deals from HubSpot",
        deals: [],
        configured: false
      },
      { status: 500 }
    );
  }
}

