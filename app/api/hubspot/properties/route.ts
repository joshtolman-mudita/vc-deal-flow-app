import { NextResponse } from "next/server";
import hubspotClient, { isHubSpotConfigured } from "@/lib/hubspot";

export async function GET(request: Request) {
  try {
    if (!isHubSpotConfigured()) {
      return NextResponse.json({ error: "HubSpot not configured" }, { status: 400 });
    }

    // Fetch all deal properties
    const propertiesResponse = await hubspotClient.crm.properties.coreApi.getAll("deals");
    const properties = propertiesResponse.results || [];
    const { searchParams } = new URL(request.url);
    const requestedProperty = (searchParams.get("property") || "").trim();
    const requestedLabel = (searchParams.get("label") || "").trim().toLowerCase();

    const normalizeOptions = (options: any[] = []) =>
      options
        .filter((option: any) => option && option.hidden !== true && option.archived !== true)
        .map((option: any) => ({ label: option.label, value: option.value }))
        .filter((option: any) => String(option.label || "").trim() && String(option.value || "").trim());

    if (requestedProperty) {
      const exact = properties.find((prop: any) => prop?.name === requestedProperty);
      if (!exact) {
        return NextResponse.json(
          { error: `Property '${requestedProperty}' not found on HubSpot deal object` },
          { status: 404 }
        );
      }
      return NextResponse.json({
        property: {
          label: exact.label,
          name: exact.name,
          description: exact.description,
          type: exact.type,
          fieldType: exact.fieldType,
          options: normalizeOptions(exact.options || []),
        },
      });
    }
    if (requestedLabel) {
      const exactByLabel = properties.find((prop: any) => String(prop?.label || "").trim().toLowerCase() === requestedLabel);
      const containsByLabel =
        exactByLabel ||
        properties.find((prop: any) => String(prop?.label || "").trim().toLowerCase().includes(requestedLabel));
      if (!containsByLabel) {
        return NextResponse.json(
          { error: `Property label '${requestedLabel}' not found on HubSpot deal object` },
          { status: 404 }
        );
      }
      return NextResponse.json({
        property: {
          label: containsByLabel.label,
          name: containsByLabel.name,
          description: containsByLabel.description,
          type: containsByLabel.type,
          fieldType: containsByLabel.fieldType,
          options: normalizeOptions(containsByLabel.options || []),
        },
      });
    }
    
    console.log("\n=== ALL DEAL PROPERTIES IN HUBSPOT ===");
    console.log(`Total properties: ${properties.length}`);
    
    // Find custom properties related to "next", "terms", and "industry"
    const relevantProps = properties.filter((prop: any) => 
      prop.label?.toLowerCase().includes('next') ||
      prop.label?.toLowerCase().includes('step') ||
      prop.label?.toLowerCase().includes('term') ||
      prop.label?.toLowerCase().includes('industry') ||
      prop.name?.toLowerCase().includes('next') ||
      prop.name?.toLowerCase().includes('step') ||
      prop.name?.toLowerCase().includes('term') ||
      prop.name?.toLowerCase().includes('industry')
    );
    
    console.log("\n=== PROPERTIES RELATED TO 'NEXT STEP', 'TERMS', AND 'INDUSTRY' ===");
    relevantProps.forEach((prop: any) => {
      console.log(`Label: "${prop.label}" | Name: "${prop.name}" | Type: ${prop.type}`);
    });
    console.log("=== END PROPERTIES ===\n");

    return NextResponse.json({
      total: properties.length,
      relevant: relevantProps.map((p: any) => ({
        label: p.label,
        name: p.name,
        type: p.type,
      })),
    });

  } catch (error: any) {
    console.error("Error fetching properties:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

