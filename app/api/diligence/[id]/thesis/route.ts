import { NextRequest, NextResponse } from 'next/server';
import { loadDiligenceRecord, updateDiligenceRecord } from '@/lib/diligence-storage';
import { ThesisAnswers } from '@/types/diligence';

/**
 * POST /api/diligence/[id]/thesis - Update thesis answers
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { thesisAnswers } = body as { thesisAnswers: ThesisAnswers };

    if (!id) {
      return NextResponse.json(
        { error: 'Diligence ID is required', success: false },
        { status: 400 }
      );
    }

    // Load the record
    const record = await loadDiligenceRecord(id);
    if (!record) {
      return NextResponse.json(
        { error: 'Diligence record not found', success: false },
        { status: 404 }
      );
    }

    if (!record.score) {
      return NextResponse.json(
        { error: 'Record has no score yet', success: false },
        { status: 400 }
      );
    }

    // Validate required fields
    if (!thesisAnswers.problemSolving || !thesisAnswers.solution || !thesisAnswers.idealCustomer) {
      return NextResponse.json(
        { error: 'Missing required thesis fields', success: false },
        { status: 400 }
      );
    }

    // Mark as manually edited and update the record
    const updatedThesisAnswers: ThesisAnswers = {
      ...thesisAnswers,
      manuallyEdited: true,
    };

    const updatedScore = {
      ...record.score,
      thesisAnswers: updatedThesisAnswers,
    };

    const updatedRecord = await updateDiligenceRecord(id, {
      score: updatedScore,
    });

    return NextResponse.json({
      success: true,
      record: updatedRecord,
    });

  } catch (error) {
    console.error('Error updating thesis answers:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update thesis answers',
        success: false,
      },
      { status: 500 }
    );
  }
}
