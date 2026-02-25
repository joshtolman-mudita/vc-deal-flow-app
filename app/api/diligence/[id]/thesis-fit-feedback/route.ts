import { NextRequest, NextResponse } from "next/server";
import { loadDiligenceRecord } from "@/lib/diligence-storage";
import {
  listThesisFitFeedback,
  sanitizeThesisFitFeedbackInput,
  saveThesisFitFeedback,
} from "@/lib/thesis-fit-feedback-storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 25;
    const companyNameParam = request.nextUrl.searchParams.get("companyName")?.trim().toLowerCase();

    const byRecord = await listThesisFitFeedback({
      diligenceId: id,
      limit: Number.isFinite(limit) ? limit : 25,
    });
    if (!companyNameParam) {
      return NextResponse.json({
        success: true,
        entries: byRecord,
        count: byRecord.length,
      });
    }

    const allEntries = await listThesisFitFeedback({
      limit: 2000,
    });
    const sameCompany = allEntries.filter(
      (entry) => String(entry.companyName || "").trim().toLowerCase() === companyNameParam
    );

    const merged = [...byRecord, ...sameCompany];
    const deduped = Array.from(new Map(merged.map((entry) => [entry.id, entry])).values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, Number.isFinite(limit) ? limit : 25);

    return NextResponse.json({
      success: true,
      entries: deduped,
      count: deduped.length,
    });
  } catch (error) {
    console.error("Error loading thesis-fit feedback:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load thesis-fit feedback" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const record = await loadDiligenceRecord(id);
    if (!record) {
      return NextResponse.json(
        { success: false, error: "Diligence record not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const cleaned = sanitizeThesisFitFeedbackInput({
      ...body,
      diligenceId: id,
      companyName: record.companyName,
      appThesisFitSnapshot: body?.appThesisFitSnapshot || record.thesisFit,
    });

    const hasAnyNotes =
      cleaned.reviewerWhyFits.length > 0 ||
      cleaned.reviewerWhyNotFit.length > 0 ||
      (cleaned.reviewerEvidenceGaps || []).length > 0 ||
      Boolean(cleaned.reviewerNotes) ||
      Boolean(cleaned.chatgptAssessment);
    if (!hasAnyNotes) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Add at least one bullet or note so this example can improve the thesis-fit evaluator.",
        },
        { status: 400 }
      );
    }

    const entry = await saveThesisFitFeedback(cleaned);
    return NextResponse.json({
      success: true,
      entry,
    });
  } catch (error) {
    console.error("Error saving thesis-fit feedback:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save thesis-fit feedback",
      },
      { status: 500 }
    );
  }
}
