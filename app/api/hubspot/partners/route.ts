import { NextResponse } from "next/server";
import hubspotClient, { isHubSpotConfigured } from "@/lib/hubspot";

// Properties to fetch for VC/Partner companies
const PARTNER_PROPERTIES = [
  "name",
  "type", // VC/PE/Debt or Family Office
  "latest_update", // VC: Thesis
  "vc__check_size", // VC: Check Size
  "vc__investment_stage", // VC: Investment Stage
  "investment_space", // VC: Investment Space
  "vc__regions_of_invesment", // VC: Regions of Investment
  "domain",
  "city",
  "state",
  "country",
  "hs_object_id",
  "createdate",
  "hs_lastmodifieddate",
];

export async function GET(request: Request) {
  try {
    if (!isHubSpotConfigured()) {
      return NextResponse.json(
        { 
          error: "HubSpot is not configured",
          partners: [],
          configured: false
        },
        { status: 200 }
      );
    }

    // Fetch ALL companies (remove page limit to ensure we get everyone)
    let allCompanies: any[] = [];
    let after: string | undefined = undefined;
    let pageCount = 0;
    const maxPages = 100; // Increased limit to fetch all companies (10,000 max)

    do {
      const companiesResponse = await hubspotClient.crm.companies.basicApi.getPage(
        100,
        after,
        PARTNER_PROPERTIES,
        undefined,
        undefined,
        false
      );

      allCompanies = allCompanies.concat(companiesResponse.results);
      after = companiesResponse.paging?.next?.after;
      pageCount++;

      console.log(`Fetched companies page ${pageCount}: ${companiesResponse.results.length} companies (total: ${allCompanies.length})`);

    } while (after && pageCount < maxPages);

    console.log(`\nTotal companies fetched: ${allCompanies.length}`);
    
    // Log unique types for debugging
    const uniqueTypes = new Set(
      allCompanies
        .map((c: any) => c.properties?.type)
        .filter(Boolean)
    );
    console.log(`\nUnique company types found (${uniqueTypes.size}):`, Array.from(uniqueTypes).sort());
    
    // Log companies with "VC" type specifically to verify SaaS Ventures is included
    const vcTypeCompanies = allCompanies.filter((c: any) => c.properties?.type === "VC");
    console.log(`\nCompanies with type "VC": ${vcTypeCompanies.length}`);
    if (vcTypeCompanies.length > 0) {
      console.log(`Sample VC companies:`, vcTypeCompanies.slice(0, 10).map((c: any) => c.properties?.name));
    }

    // Filter to companies that are VCs/Partners
    // Use broader matching to catch variations like "Venture Capital", "VC Fund", etc.
    const partners = allCompanies
      .filter((company: any) => {
        const type = (company.properties?.type || "").toLowerCase();
        
        // Include if type contains any of these keywords
        const isVC = type.includes("vc") || 
                     type.includes("venture") || 
                     type.includes("family office") ||
                     type.includes("fund") ||
                     type.includes("pe") ||
                     type.includes("debt");
        
        // Exclude if it's a portfolio company or other non-investor type
        const isPortfolio = type.includes("portfolio") || 
                           type.includes("customer") ||
                           type.includes("vendor") ||
                           type.includes("partner") && !type.includes("vc") && !type.includes("venture");
        
        return isVC && !isPortfolio;
      })
      .map((company: any) => {
        const props = company.properties;
        
        return {
          id: company.id,
          name: props.name || "Unnamed Partner",
          type: props.type || "N/A",
          thesis: props.latest_update || "",
          checkSize: props.vc__check_size || "N/A",
          investmentStage: props.vc__investment_stage || "N/A",
          investmentSpace: props.investment_space || "N/A",
          regions: props.vc__regions_of_invesment || "N/A",
          domain: props.domain || "",
          city: props.city || "",
          state: props.state || "",
          country: props.country || "",
          hubspotId: company.id,
          createdDate: props.createdate || "",
          lastModified: props.hs_lastmodifieddate || "",
        };
      });

    console.log(`Filtered to ${partners.length} VC/Partner companies`);

    return NextResponse.json({
      partners,
      total: partners.length,
      configured: true,
      synced_at: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error("Error fetching partners:", error);
    return NextResponse.json(
      { 
        error: error.message || "Failed to fetch partners",
        partners: [],
        configured: false
      },
      { status: 500 }
    );
  }
}

