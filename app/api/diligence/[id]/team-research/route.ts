import { NextRequest, NextResponse } from 'next/server';
import { loadDiligenceRecord, updateDiligenceRecord } from '@/lib/diligence-storage';
import { runTeamResearch } from '@/lib/team-research';
import {
  getAssociatedCompanyForDeal,
  getAssociatedContactsForCompany,
  getAssociatedContactsForDeal,
} from '@/lib/hubspot-sync';

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

    let companyData = record.hubspotCompanyData || null;
    if (!companyData && record.hubspotDealId) {
      companyData = await getAssociatedCompanyForDeal(record.hubspotDealId);
    }

    const contacts = record.hubspotCompanyId
      ? await getAssociatedContactsForCompany(record.hubspotCompanyId)
      : record.hubspotDealId
      ? await getAssociatedContactsForDeal(record.hubspotDealId)
      : [];

    const teamResearch = await runTeamResearch({
      companyName: record.companyName,
      companyUrl: record.companyUrl,
      companyDescription: record.companyDescription,
      existingFounders: record.founders,
      hubspotCompanyData: companyData,
      hubspotContacts: contacts,
    });

    const updatedRecord = await updateDiligenceRecord(id, {
      founders: teamResearch.founders.length > 0 ? teamResearch.founders : record.founders,
      teamResearch,
      hubspotCompanyData: companyData || record.hubspotCompanyData,
      hubspotCompanyId: companyData?.companyId || record.hubspotCompanyId,
      hubspotCompanyName: companyData?.name || record.hubspotCompanyName,
    });

    return NextResponse.json({
      success: true,
      teamResearch,
      contactsUsed: contacts.length,
      record: updatedRecord,
    });
  } catch (error) {
    console.error('Error running team research:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run team research',
      },
      { status: 500 }
    );
  }
}
