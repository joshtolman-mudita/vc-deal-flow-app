import { NextRequest, NextResponse } from "next/server";
import { loadDiligenceRecord, updateDiligenceRecord } from "@/lib/diligence-storage";
import { runThesisFitAssessment } from "@/lib/thesis-fit";

export async function GET(
  _request: NextRequest,
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

    return NextResponse.json({
      success: true,
      thesisFit: record.thesisFit || null,
    });
  } catch (error) {
    console.error("Error loading thesis fit:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load thesis fit" },
      { status: 500 }
    );
  }
}

export async function POST(
  _request: NextRequest,
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

    const thesisFit = await runThesisFitAssessment(record);
    const updatedRecord = await updateDiligenceRecord(id, { thesisFit });

    return NextResponse.json({
      success: true,
      thesisFit,
      record: updatedRecord,
    });
  } catch (error) {
    console.error("Error computing thesis fit:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to compute thesis fit",
      },
      { status: 500 }
    );
  }
}
