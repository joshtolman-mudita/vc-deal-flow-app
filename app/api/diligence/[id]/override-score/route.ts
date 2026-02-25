import { NextRequest, NextResponse } from 'next/server';
import { loadDiligenceRecord, updateDiligenceRecord } from '@/lib/diligence-storage';
import { applyCategoryOverride, removeCategoryOverride } from '@/lib/score-calculator';

/**
 * POST /api/diligence/[id]/override-score - Apply or remove manual score override
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { categoryName, overrideScore, reason, action, suppressRiskTopics } = body;

    if (!categoryName) {
      return NextResponse.json(
        { error: 'Category name is required', success: false },
        { status: 400 }
      );
    }

    // Load the diligence record
    const record = await loadDiligenceRecord(id);
    if (!record) {
      return NextResponse.json(
        { error: 'Diligence record not found', success: false },
        { status: 404 }
      );
    }

    if (!record.score) {
      return NextResponse.json(
        { error: 'No score found to override', success: false },
        { status: 400 }
      );
    }

    // Apply or remove override
    let updatedScore;
    if (action === 'remove') {
      updatedScore = removeCategoryOverride(record.score, categoryName);
    } else {
      if (overrideScore === undefined || overrideScore < 0 || overrideScore > 100) {
        return NextResponse.json(
          { error: 'Override score must be between 0 and 100', success: false },
          { status: 400 }
        );
      }
      updatedScore = applyCategoryOverride(
        record.score,
        categoryName,
        overrideScore,
        reason,
        Array.isArray(suppressRiskTopics)
          ? suppressRiskTopics.filter((topic: unknown) => typeof topic === 'string' && topic.trim().length > 0)
          : undefined
      );
    }

    // Update the record
    const updatedRecord = await updateDiligenceRecord(id, {
      score: updatedScore,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      score: updatedScore,
      record: updatedRecord,
      success: true,
    });

  } catch (error) {
    console.error('Error applying score override:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to apply score override',
        success: false 
      },
      { status: 500 }
    );
  }
}
