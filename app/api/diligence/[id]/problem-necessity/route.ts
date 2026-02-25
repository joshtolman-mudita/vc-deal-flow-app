import { NextRequest, NextResponse } from 'next/server';
import { loadDiligenceRecord, updateDiligenceRecord } from '@/lib/diligence-storage';
import { runProblemNecessityResearch } from '@/lib/problem-necessity';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const record = await loadDiligenceRecord(id);

    if (!record) {
      return NextResponse.json(
        { success: false, error: 'Diligence record not found' },
        { status: 404 }
      );
    }

    const research = await runProblemNecessityResearch({
      companyName: record.companyName,
      companyUrl: record.companyUrl,
      companyDescription: record.companyDescription,
      companyOneLiner: record.companyOneLiner,
      industry: record.industry,
    });

    const updatedRecord = await updateDiligenceRecord(id, {
      problemNecessityResearch: research,
    });

    return NextResponse.json({
      success: true,
      problemNecessityResearch: research,
      record: updatedRecord,
    });
  } catch (error) {
    console.error('Error running problem necessity research:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run problem necessity research',
      },
      { status: 500 }
    );
  }
}
