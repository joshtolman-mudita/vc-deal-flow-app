import { NextResponse } from "next/server";
import hubspotClient from "@/lib/hubspot";

// Properties to fetch from the company record
const COMPANY_PROPERTIES = [
  "name",
  "domain",
  "industry",
  "city",
  "state",
  "country",
  "founded_year",
  "num_employees",
  "linkedin_company_page",
  "description",
  "website",
  "annualrevenue",
  // Add any custom properties from your HubSpot form here
  // You can check available properties at /api/hubspot/companies/properties
];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    return NextResponse.json(
      { error: "HubSpot access token not configured." },
      { status: 400 }
    );
  }

  try {
    const { companyId } = await params;

    console.log(`Fetching company data for ID: ${companyId}`);

    const company = await hubspotClient.crm.companies.basicApi.getById(
      companyId,
      COMPANY_PROPERTIES
    );

    console.log(`Successfully fetched company: ${company.properties.name}`);

    return NextResponse.json({
      company: {
        id: company.id,
        ...company.properties,
      },
    });
  } catch (error: any) {
    console.error("Error fetching HubSpot company:", error);
    return NextResponse.json(
      {
        error: error.message || "An unknown error occurred.",
        details: error.body || error.message,
      },
      { status: error.code || 500 }
    );
  }
}

