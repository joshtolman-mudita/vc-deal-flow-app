import { NextRequest, NextResponse } from 'next/server';
import { loadDiligenceRecord, updateDiligenceRecord } from '@/lib/diligence-storage';
import { runPortfolioSynergyResearch } from '@/lib/portfolio-synergy';

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

    const research = await runPortfolioSynergyResearch({
      companyName: record.companyName,
      companyUrl: record.companyUrl,
      companyDescription: record.companyDescription,
      companyOneLiner: record.companyOneLiner,
      industry: record.industry,
    });

    const updatedRecord = await updateDiligenceRecord(id, {
      portfolioSynergyResearch: research,
    });

    return NextResponse.json({
      success: true,
      portfolioSynergyResearch: research,
      record: updatedRecord,
    });
  } catch (error) {
    console.error('Error running portfolio synergy research:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run portfolio synergy research',
      },
      { status: 500 }
    );
  }
}
