import { NextRequest, NextResponse } from 'next/server';
import { listDiligenceRecords } from '@/lib/diligence-storage';

interface LearningPattern {
  totalDecisions: number;
  invested: number;
  passed: number;
  pending: number;
  averageInvestedScore: number;
  averagePassedScore: number;
  categoryPatterns: {
    category: string;
    averageInvestedScore: number;
    averagePassedScore: number;
    investmentCount: number;
  }[];
  scoreThresholds: {
    invested: { min: number; max: number; avg: number };
    passed: { min: number; max: number; avg: number };
  };
  manualOverrideCalibration: {
    category: string;
    averageDelta: number;
    averageAbsDelta: number;
    sampleCount: number;
  }[];
}

/**
 * GET /api/diligence/learning-data - Analyze historical decision patterns
 */
export async function GET(request: NextRequest) {
  try {
    // Load all diligence records
    const allRecords = await listDiligenceRecords();
    
    // Filter records with decisions and scores
    const recordsWithDecisions = allRecords.filter(
      r => r.decisionOutcome && r.score
    );

    if (recordsWithDecisions.length === 0) {
      return NextResponse.json({
        hasData: false,
        message: 'No historical decisions available yet',
        success: true,
      });
    }

    // Analyze patterns
    const invested = recordsWithDecisions.filter(r => r.decisionOutcome!.decision === 'invested');
    const passed = recordsWithDecisions.filter(r => r.decisionOutcome!.decision === 'passed');
    const pending = recordsWithDecisions.filter(r => r.decisionOutcome!.decision === 'pending');

    // Calculate average scores
    const avgInvestedScore = invested.length > 0
      ? invested.reduce((sum, r) => sum + r.score!.overall, 0) / invested.length
      : 0;

    const avgPassedScore = passed.length > 0
      ? passed.reduce((sum, r) => sum + r.score!.overall, 0) / passed.length
      : 0;

    // Analyze category patterns
    const categoryMap = new Map<string, { invested: number[]; passed: number[]; count: number }>();

    for (const record of recordsWithDecisions) {
      if (!record.score) continue;

      for (const category of record.score.categories) {
        if (!categoryMap.has(category.category)) {
          categoryMap.set(category.category, { invested: [], passed: [], count: 0 });
        }

        const data = categoryMap.get(category.category)!;
        const effectiveScore = category.manualOverride ?? category.score;

        if (record.decisionOutcome!.decision === 'invested') {
          data.invested.push(effectiveScore);
        } else if (record.decisionOutcome!.decision === 'passed') {
          data.passed.push(effectiveScore);
        }
        data.count++;
      }
    }

    const categoryPatterns = Array.from(categoryMap.entries()).map(([category, data]) => ({
      category,
      averageInvestedScore: data.invested.length > 0
        ? data.invested.reduce((sum, s) => sum + s, 0) / data.invested.length
        : 0,
      averagePassedScore: data.passed.length > 0
        ? data.passed.reduce((sum, s) => sum + s, 0) / data.passed.length
        : 0,
      investmentCount: data.invested.length,
    }));

    // Calculate score thresholds
    const investedScores = invested.map(r => r.score!.overall);
    const passedScores = passed.map(r => r.score!.overall);

    const learningData: LearningPattern = {
      totalDecisions: recordsWithDecisions.length,
      invested: invested.length,
      passed: passed.length,
      pending: pending.length,
      averageInvestedScore: Math.round(avgInvestedScore),
      averagePassedScore: Math.round(avgPassedScore),
      categoryPatterns: categoryPatterns.sort((a, b) => b.investmentCount - a.investmentCount),
      scoreThresholds: {
        invested: investedScores.length > 0 ? {
          min: Math.min(...investedScores),
          max: Math.max(...investedScores),
          avg: Math.round(avgInvestedScore),
        } : { min: 0, max: 0, avg: 0 },
        passed: passedScores.length > 0 ? {
          min: Math.min(...passedScores),
          max: Math.max(...passedScores),
          avg: Math.round(avgPassedScore),
        } : { min: 0, max: 0, avg: 0 },
      },
      manualOverrideCalibration: (() => {
        const calibrationMap = new Map<string, { deltas: number[]; absDeltas: number[] }>();

        for (const record of allRecords) {
          const categories = record.score?.categories || [];
          for (const category of categories) {
            if (category.manualOverride === undefined) continue;

            const delta = category.manualOverride - category.score;
            if (!calibrationMap.has(category.category)) {
              calibrationMap.set(category.category, { deltas: [], absDeltas: [] });
            }
            const bucket = calibrationMap.get(category.category)!;
            bucket.deltas.push(delta);
            bucket.absDeltas.push(Math.abs(delta));
          }
        }

        return Array.from(calibrationMap.entries())
          .map(([category, value]) => ({
            category,
            averageDelta: value.deltas.length > 0
              ? value.deltas.reduce((sum, n) => sum + n, 0) / value.deltas.length
              : 0,
            averageAbsDelta: value.absDeltas.length > 0
              ? value.absDeltas.reduce((sum, n) => sum + n, 0) / value.absDeltas.length
              : 0,
            sampleCount: value.deltas.length,
          }))
          .sort((a, b) => b.sampleCount - a.sampleCount);
      })(),
    };

    return NextResponse.json({
      hasData: true,
      learningData,
      success: true,
    });

  } catch (error) {
    console.error('Error analyzing learning data:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to analyze learning data',
        success: false 
      },
      { status: 500 }
    );
  }
}
