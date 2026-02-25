import { NextRequest, NextResponse } from "next/server";
import { loadDiligenceRecord } from "@/lib/diligence-storage";
import { isHubSpotConfigured } from "@/lib/hubspot";
import { findExistingCompanyForCreate, prepareHubSpotCreatePayload } from "@/lib/hubspot-sync";

export async function POST(request: NextRequest) {
  try {
    if (!isHubSpotConfigured()) {
      return NextResponse.json(
        { success: false, error: "HubSpot is not configured" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const diligenceId = typeof body?.diligenceId === "string" ? body.diligenceId.trim() : "";
    if (!diligenceId) {
      return NextResponse.json(
        { success: false, error: "diligenceId is required" },
        { status: 400 }
      );
    }

    const record = await loadDiligenceRecord(diligenceId);
    if (!record) {
      return NextResponse.json(
        { success: false, error: "Diligence record not found" },
        { status: 404 }
      );
    }

    const preview = prepareHubSpotCreatePayload(record);
    const candidateCompanyName = String(preview.company.properties?.name || record.companyName || "").trim();
    const candidateCompanyDomain = String(preview.company.properties?.domain || "").trim();
    const existingCompany =
      record.hubspotCompanyId
        ? { id: record.hubspotCompanyId, properties: { name: record.hubspotCompanyName || candidateCompanyName } }
        : await findExistingCompanyForCreate(candidateCompanyName, candidateCompanyDomain);
    const createCompany = !existingCompany?.id;

    return NextResponse.json({
      success: true,
      preview,
      createCompany,
      existingCompanyId: existingCompany?.id || undefined,
      existingCompanyName: String(existingCompany?.properties?.name || candidateCompanyName || "").trim() || undefined,
      linked: Boolean(record.hubspotDealId),
      alreadyLinkedDealId: record.hubspotDealId || undefined,
    });
  } catch (error) {
    console.error("Error generating HubSpot create preview:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to generate preview" },
      { status: 500 }
    );
  }
}
