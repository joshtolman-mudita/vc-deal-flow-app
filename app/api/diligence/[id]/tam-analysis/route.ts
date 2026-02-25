import { NextRequest, NextResponse } from 'next/server';
import { loadDiligenceRecord } from '@/lib/diligence-storage';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
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

    const documentTexts = (record.documents || [])
      .map((doc) => ({
        fileName: doc.name,
        text: doc.extractedText || (doc.externalUrl ? `External document link: ${doc.externalUrl}` : ''),
        type: doc.type || 'other',
      }))
      .filter((doc) => doc.text && doc.text.trim().length > 0);

    if (documentTexts.length === 0) {
      documentTexts.push({
        fileName: 'Company Information',
        text: [
          `Company Name: ${record.companyName}`,
          record.companyUrl ? `Company URL: ${record.companyUrl}` : '',
          record.companyDescription ? `Description: ${record.companyDescription}` : '',
          record.hubspotCompanyData?.description ? `Founder Description: ${record.hubspotCompanyData.description}` : '',
          record.hubspotCompanyData?.tamRange ? `Founder TAM Claim: ${record.hubspotCompanyData.tamRange}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        type: 'other',
      });
    }

    const scorerModule = await import('@/lib/diligence-scorer');
    const runTamAnalysis = (scorerModule as any).runTamAnalysis as
      | ((...args: any[]) => Promise<any>)
      | undefined;

    if (typeof runTamAnalysis !== 'function') {
      throw new Error('TAM analysis function is unavailable in scorer module');
    }

    const analysis = await runTamAnalysis(
      documentTexts,
      record.companyName,
      record.companyUrl,
      record.metrics,
      record.hubspotCompanyData
    );

    return NextResponse.json({
      success: true,
      analysis,
    });
  } catch (error) {
    console.error('Error running TAM analysis:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to run TAM analysis' },
      { status: 500 }
    );
  }
}
