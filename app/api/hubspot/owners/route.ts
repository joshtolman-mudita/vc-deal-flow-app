import { NextResponse } from "next/server";
import hubspotClient, { isHubSpotConfigured } from "@/lib/hubspot";

export async function GET() {
  try {
    if (!isHubSpotConfigured()) {
      return NextResponse.json({ error: "HubSpot not configured" }, { status: 400 });
    }

    const ownersApi: any = (hubspotClient as any)?.crm?.owners?.ownersApi;
    if (!ownersApi || typeof ownersApi.getPage !== "function") {
      return NextResponse.json({ error: "HubSpot owners API is unavailable" }, { status: 500 });
    }

    const attempts: any[] = [
      [undefined, undefined, 500, false],
      [500, undefined, undefined, false],
      [undefined, 500, undefined, false],
    ];
    let owners: any[] = [];
    for (const args of attempts) {
      try {
        const response: any = await ownersApi.getPage(...args);
        const results = Array.isArray(response?.results) ? response.results : [];
        if (results.length > 0) {
          owners = results;
          break;
        }
      } catch {
        // Try next invocation signature.
      }
    }
    const items = owners
      .map((owner: any) => {
        const firstName = String(owner?.firstName || "").trim();
        const lastName = String(owner?.lastName || "").trim();
        const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
        const email = String(owner?.email || "").trim();
        const id = String(owner?.id || "").trim();
        const label = fullName || email || `Owner ${id}`;
        return { id, label, email };
      })
      .filter((owner: any) => owner.id)
      .sort((a: any, b: any) => a.label.localeCompare(b.label));

    return NextResponse.json({ owners: items });
  } catch (error: any) {
    const code = Number(error?.code || 0);
    const requiredScopes = error?.body?.errors?.[0]?.context?.requiredGranularScopes;
    if (code === 403) {
      return NextResponse.json({
        owners: [],
        warning: "HubSpot owners scope is missing; owner dropdown disabled.",
        requiredScopes: Array.isArray(requiredScopes) ? requiredScopes : ["crm.objects.owners.read"],
      });
    }

    console.error("Error fetching HubSpot owners:", error);
    return NextResponse.json({ owners: [], error: error?.message || "Failed to fetch HubSpot owners" });
  }
}

