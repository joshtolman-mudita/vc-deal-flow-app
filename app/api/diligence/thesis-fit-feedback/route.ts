import { NextRequest, NextResponse } from "next/server";
import { listThesisFitFeedback } from "@/lib/thesis-fit-feedback-storage";

export async function GET(request: NextRequest) {
  try {
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 200;
    const entries = await listThesisFitFeedback({
      limit: Number.isFinite(limit) ? limit : 200,
    });

    const withSnapshot = entries.filter((entry) => entry.appThesisFitSnapshot);
    const exactFitMatches = withSnapshot.filter(
      (entry) => entry.appThesisFitSnapshot?.fit === entry.reviewerFit
    ).length;
    const fitAgreementRate = withSnapshot.length
      ? Math.round((exactFitMatches / withSnapshot.length) * 100)
      : null;

    const confidenceDeltas = withSnapshot
      .filter((entry) => typeof entry.reviewerConfidence === "number")
      .map((entry) =>
        Math.abs((entry.reviewerConfidence || 0) - (entry.appThesisFitSnapshot?.confidence || 0))
      );
    const averageConfidenceDelta = confidenceDeltas.length
      ? Math.round(confidenceDeltas.reduce((sum, val) => sum + val, 0) / confidenceDeltas.length)
      : null;

    return NextResponse.json({
      success: true,
      summary: {
        totalExamples: entries.length,
        withAppSnapshot: withSnapshot.length,
        fitAgreementRate,
        averageConfidenceDelta,
      },
      entries,
    });
  } catch (error) {
    console.error("Error evaluating thesis-fit feedback:", error);
    return NextResponse.json(
      { success: false, error: "Failed to evaluate thesis-fit feedback" },
      { status: 500 }
    );
  }
}
