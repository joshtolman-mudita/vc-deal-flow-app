import { NextRequest, NextResponse } from "next/server";
import { importThesisFitFeedback } from "@/lib/thesis-fit-feedback-storage";
import { ThesisFitFeedbackEntry } from "@/types/diligence";

export async function POST(request: NextRequest) {
  try {
    const requiredKey = process.env.THESIS_FEEDBACK_IMPORT_KEY;
    if (requiredKey) {
      const providedKey = request.headers.get("x-thesis-import-key");
      if (!providedKey || providedKey !== requiredKey) {
        return NextResponse.json(
          { success: false, error: "Unauthorized import request" },
          { status: 401 }
        );
      }
    }

    const body = await request.json();
    const entries = (body?.entries || []) as Array<Partial<ThesisFitFeedbackEntry>>;
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { success: false, error: "Body must include non-empty entries array" },
        { status: 400 }
      );
    }

    const result = await importThesisFitFeedback(entries);
    return NextResponse.json({
      success: true,
      importedCount: result.imported.length,
      skippedDuplicates: result.skippedDuplicates,
      imported: result.imported,
    });
  } catch (error) {
    console.error("Error importing thesis-fit feedback:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to import thesis-fit feedback",
      },
      { status: 500 }
    );
  }
}
