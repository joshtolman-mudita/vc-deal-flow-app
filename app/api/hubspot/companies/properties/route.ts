import { NextResponse } from "next/server";
import hubspotClient, { isHubSpotConfigured } from "@/lib/hubspot";

export async function GET(request: Request) {
  try {
    if (!isHubSpotConfigured()) {
      return NextResponse.json({ error: "HubSpot not configured" }, { status: 400 });
    }

    // Fetch all company properties
    const propertiesResponse = await hubspotClient.crm.properties.coreApi.getAll("companies");
    const properties = propertiesResponse.results || [];
    const { searchParams } = new URL(request.url);
    const requestedProperty = (searchParams.get("property") || "").trim();

    if (requestedProperty) {
      const exact = properties.find((prop: any) => prop?.name === requestedProperty);
      if (!exact) {
        return NextResponse.json(
          { error: `Property '${requestedProperty}' not found on HubSpot company object` },
          { status: 404 }
        );
      }
      return NextResponse.json({
        property: {
          label: exact.label,
          name: exact.name,
          type: exact.type,
          fieldType: exact.fieldType,
          options: (exact.options || []).map((o: any) => ({ label: o.label, value: o.value })),
        },
      });
    }
    
    console.log("\n=== ALL COMPANY PROPERTIES IN HUBSPOT ===");
    console.log(`Total properties: ${properties.length}`);
    
    // Find properties related to VC/investment criteria
    const relevantProps = properties.filter((prop: any) => 
      prop.label?.toLowerCase().includes('vc') ||
      prop.label?.toLowerCase().includes('investment') ||
      prop.label?.toLowerCase().includes('type') ||
      prop.label?.toLowerCase().includes('thesis') ||
      prop.label?.toLowerCase().includes('check') ||
      prop.label?.toLowerCase().includes('stage') ||
      prop.label?.toLowerCase().includes('space') ||
      prop.label?.toLowerCase().includes('region') ||
      prop.name?.toLowerCase().includes('vc') ||
      prop.name?.toLowerCase().includes('investment') ||
      prop.name?.toLowerCase().includes('type')
    );
    
    console.log("\n=== PROPERTIES RELATED TO VC/INVESTMENT ===");
    relevantProps.forEach((prop: any) => {
      console.log(`Label: "${prop.label}" | Name: "${prop.name}" | Type: ${prop.type}`);
      if (prop.options && prop.options.length > 0) {
        console.log(`  Options: ${prop.options.map((o: any) => o.label).join(', ')}`);
      }
    });
    console.log("=== END PROPERTIES ===\n");

    return NextResponse.json({
      total: properties.length,
      relevant: relevantProps.map((p: any) => ({
        label: p.label,
        name: p.name,
        type: p.type,
        options: p.options?.map((o: any) => ({ label: o.label, value: o.value })),
      })),
    });

  } catch (error: any) {
    console.error("Error fetching company properties:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}


