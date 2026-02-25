import { NextRequest, NextResponse } from 'next/server';
import { loadDiligenceRecord, updateDiligenceRecord } from '@/lib/diligence-storage';

/**
 * POST /api/diligence/[id]/decision - Record investment decision
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { decision, decisionReason } = body;

    if (!decision || !['invested', 'passed', 'pending'].includes(decision)) {
      return NextResponse.json(
        { error: 'Valid decision is required (invested, passed, or pending)', success: false },
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

    // Update decision outcome
    const decisionOutcome = {
      decision,
      decisionDate: new Date().toISOString(),
      decisionReason: decisionReason || undefined,
      actualPerformance: record.decisionOutcome?.actualPerformance,
    };

    const updatedRecord = await updateDiligenceRecord(id, {
      decisionOutcome,
      status: decision === 'invested' ? 'completed' : decision === 'passed' ? 'passed' : record.status,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      record: updatedRecord,
      success: true,
    });

  } catch (error) {
    console.error('Error recording decision:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to record decision',
        success: false 
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/diligence/[id]/decision - Update post-investment performance notes
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { actualPerformance } = body;

    // Load the diligence record
    const record = await loadDiligenceRecord(id);
    if (!record) {
      return NextResponse.json(
        { error: 'Diligence record not found', success: false },
        { status: 404 }
      );
    }

    if (!record.decisionOutcome) {
      return NextResponse.json(
        { error: 'No decision recorded yet', success: false },
        { status: 400 }
      );
    }

    // Update performance notes
    const decisionOutcome = {
      ...record.decisionOutcome,
      actualPerformance,
    };

    const updatedRecord = await updateDiligenceRecord(id, {
      decisionOutcome,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      record: updatedRecord,
      success: true,
    });

  } catch (error) {
    console.error('Error updating performance notes:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to update performance notes',
        success: false 
      },
      { status: 500 }
    );
  }
}
