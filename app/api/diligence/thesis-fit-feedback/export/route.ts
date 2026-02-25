import { NextRequest, NextResponse } from "next/server";
import { listThesisFitFeedback } from "@/lib/thesis-fit-feedback-storage";

export async function GET(request: NextRequest) {
  try {
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 1000;
    const entries = await listThesisFitFeedback({
      limit: Number.isFinite(limit) ? limit : 1000,
    });

    return NextResponse.json({
      success: true,
      schemaVersion: "thesis-fit-feedback.v1",
      exportedAt: new Date().toISOString(),
      count: entries.length,
      entries,
    });
  } catch (error) {
    console.error("Error exporting thesis-fit feedback:", error);
    return NextResponse.json(
      { success: false, error: "Failed to export thesis-fit feedback" },
      { status: 500 }
    );
  }
}
