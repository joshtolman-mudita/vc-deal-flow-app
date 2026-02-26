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
    } while (after && pageCount < maxPages);

    console.log(`Total fetched: ${allDeals.length} deals across ${pageCount} pages`);
    

    // Helper function to check if a deal meets VC criteria:
    // - All open stages (Deal 0 through Deal 6) are always shown
    // - Deal 7 (closed) stages are shown only if active within the last 60 days
    const meetsVCCriteria = (deal: any): boolean => {
      const stageId = deal.properties?.dealstage || "";
      const lastModified = deal.properties?.hs_lastmodifieddate ? new Date(deal.properties.hs_lastmodifieddate) : null;
      const closeDate = deal.properties?.closedate ? new Date(deal.properties.closedate) : null;

      const stageInfo = stageMap.get(stageId);
      const stageName = stageInfo?.label || "";

      // Deal 7 stages are closed outcomes — only surface if recently active
      if (/^deal\s*7\s*:/i.test(stageName)) {
        const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const dateToCheck = closeDate || lastModified;
        return !!(dateToCheck && dateToCheck >= sixtyDaysAgo);
      }

      // All other stages (Deal 0–6 or unrecognized) are treated as open
      return true;
    };

    const diligenceRecords = await listDiligenceRecords();
    const diligenceByHubspotDealId = new Map(
      diligenceRecords.filter((record) => record.hubspotDealId).map((record) => [record.hubspotDealId!, record]),
    );
    const diligenceByName = new Map(
      diligenceRecords.map((record) => [record.companyName.toLowerCase(), record]),
    );

    // Filter HubSpot deals to the target pipelines and VC stage criteria
    const filteredRawDeals = allDeals.filter((deal: any) => {
      const pipelineId = deal.properties?.pipeline;
      const pipelineName = pipelineMap.get(pipelineId);
      if (!pipelineName) return false;
      if (!shouldIncludeDeal(deal, pipelineName)) return false;
      return meetsVCCriteria(deal);
    });

    // Batch-fetch associated company data for enriched descriptions and industry
    const companyIds = [...new Set(
      filteredRawDeals
        .map((d: any) => d.properties?.associatedcompanyid)
        .filter(Boolean) as string[]
    )];

    const companyMap = new Map<string, any>();
    if (companyIds.length > 0) {
      try {
        const chunks: string[][] = [];
        for (let i = 0; i < companyIds.length; i += 100) {
          chunks.push(companyIds.slice(i, i + 100));
        }
        for (const chunk of chunks) {
          const batchResult = await hubspotClient.crm.companies.batchApi.read({
            inputs: chunk.map((id: string) => ({ id })),
            properties: [
              "description",
              "industry",
              "what_industry_sector_do_you_operate_in___please_select_all_that_apply_",
            ],
            propertiesWithHistory: [],
          });
          for (const company of batchResult.results) {
            companyMap.set(company.id, company.properties);
          }
        }
      } catch (err) {
        console.error("Warning: failed to batch-fetch company data", err);
      }
    }

    console.log(`Filtered ${filteredRawDeals.length} VC-relevant deals from ${allDeals.length} total`);

    const deals = filteredRawDeals.map((deal: any) => {
        const companyData = companyMap.get(deal.properties?.associatedcompanyid) || {};
        const appDeal = mapHubSpotDealToAppDeal(deal, stageMap, companyData);
        const linkedDiligence =
          diligenceByHubspotDealId.get(appDeal.hubspotId || "") ||
          diligenceByName.get((appDeal.name || "").toLowerCase());
        if (linkedDiligence) {
          appDeal.diligenceId = linkedDiligence.id;
          appDeal.diligenceScore = linkedDiligence.score?.overall;
          appDeal.diligenceStatus = linkedDiligence.status;
          // portco_arr on the HubSpot deal is the source of truth; fall back to diligence record
          if (!appDeal.arr) {
            appDeal.arr = (linkedDiligence.metrics as any)?.arr?.value || undefined;
          }
        }
        return appDeal;
      });

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

