import { NextRequest, NextResponse } from 'next/server';
import { 
  listDiligenceRecords, 
  updateDiligenceRecord,
  saveDiligenceRecord, 
  generateDiligenceId 
} from '@/lib/diligence-storage';
import { DiligenceRecord } from '@/types/diligence';
import { isHubSpotConfigured } from '@/lib/hubspot';
import { getAssociatedCompanyForDeal, pullHubSpotFieldsWithCompany, searchHubSpotDealsByName } from '@/lib/hubspot-sync';

/**
 * GET /api/diligence - List all diligence records
 */
export async function GET(request: NextRequest) {
  try {
    const records = await listDiligenceRecords();
    let hydratedRecords = records;
    const hubspotAutoLinkStatuses: Record<string, { status: 'linked' | 'no_match' | 'ambiguous' | 'error'; message?: string }> = {};

    // HubSpot is the source of truth for deal stage/pipeline/amount on reads.
    // Also attempt auto-link for records without a linked HubSpot deal.
    if (isHubSpotConfigured()) {
      const syncedAt = new Date().toISOString();
      hydratedRecords = await Promise.all(
        records.map(async (record) => {
          try {
            // Existing linked records: hydrate live HubSpot fields.
            if (record.hubspotDealId) {
              const pulled = await pullHubSpotFieldsWithCompany(record.hubspotDealId, syncedAt);
              const hubspotData = pulled.hubspotData;
              hubspotAutoLinkStatuses[record.id] = { status: 'linked' };
              if (!hubspotData) return record;
              return {
                ...record,
                hubspotDealStageId: hubspotData.stageId ?? record.hubspotDealStageId,
                hubspotDealStageLabel: hubspotData.stageLabel ?? record.hubspotDealStageLabel,
                hubspotPipelineId: hubspotData.pipelineId ?? record.hubspotPipelineId,
                hubspotPipelineLabel: hubspotData.pipelineLabel ?? record.hubspotPipelineLabel,
                hubspotAmount: hubspotData.amount ?? record.hubspotAmount,
                priority: record.priority || hubspotData.priority || "",
                hubspotSyncedAt: hubspotData.syncedAt ?? record.hubspotSyncedAt,
                hubspotCompanyId: pulled.hubspotCompanyId ?? record.hubspotCompanyId,
                hubspotCompanyName: pulled.hubspotCompanyName ?? record.hubspotCompanyName,
                hubspotCompanyData: pulled.hubspotCompanyData ?? record.hubspotCompanyData,
              };
            }

            // Unlinked records: auto-link by company name when unambiguous.
            const candidates = await searchHubSpotDealsByName(record.companyName, 10);
            const exactMatches = candidates.filter(
              (deal) => deal.name.toLowerCase() === record.companyName.toLowerCase()
            );

            const selected = exactMatches.length === 1
              ? exactMatches[0]
              : candidates.length === 1
                ? candidates[0]
                : null;

            if (!selected) {
              if (candidates.length === 0) {
                hubspotAutoLinkStatuses[record.id] = { status: 'no_match', message: 'No HubSpot deal match found' };
              } else {
                const ambiguousCount = exactMatches.length > 1 ? exactMatches.length : candidates.length;
                hubspotAutoLinkStatuses[record.id] = {
                  status: 'ambiguous',
                  message: `${ambiguousCount} potential matches found`,
                };
              }
              return record;
            }

            const pulled = await pullHubSpotFieldsWithCompany(selected.id, syncedAt);
            const updates: Partial<DiligenceRecord> = {
              hubspotDealId: selected.id,
              hubspotDealStageId: selected.stageId,
              hubspotDealStageLabel: selected.stageLabel,
              hubspotPipelineId: selected.pipelineId,
              hubspotPipelineLabel: selected.pipelineLabel,
              hubspotAmount: selected.amount,
              priority: selected.priority || record.priority || "",
              hubspotSyncedAt: syncedAt,
              hubspotCompanyId: pulled.hubspotCompanyId,
              hubspotCompanyName: pulled.hubspotCompanyName,
              hubspotCompanyData: pulled.hubspotCompanyData,
            };
            const updatedRecord = await updateDiligenceRecord(record.id, updates);
            hubspotAutoLinkStatuses[record.id] = { status: 'linked', message: 'Auto-linked to HubSpot deal' };
            return updatedRecord;
          } catch (error) {
            console.warn(`Failed to auto-link/hydrate HubSpot fields for diligence ${record.id}:`, error);
            hubspotAutoLinkStatuses[record.id] = { status: 'error', message: 'Auto-link attempt failed' };
            return record;
          }
        })
      );
    }
    
    return NextResponse.json({
      records: hydratedRecords,
      count: hydratedRecords.length,
      hubspotAutoLinkStatuses,
      success: true,
    });
  } catch (error) {
    console.error('Error listing diligence records:', error);
    return NextResponse.json(
      { error: 'Failed to list diligence records', success: false },
      { status: 500 }
    );
  }
}

/**
 * POST /api/diligence - Create a new diligence record
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { companyName, companyUrl, companyDescription, notes, categorizedNotes, hubspotDealId } = body;

    if (!companyName || typeof companyName !== 'string') {
      return NextResponse.json(
        { error: 'Company name is required', success: false },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const record: DiligenceRecord = {
      id: generateDiligenceId(),
      companyName: companyName.trim(),
      companyUrl: companyUrl?.trim() || undefined,
      companyDescription: companyDescription?.trim() || undefined,
      notes: notes?.trim() || undefined, // Legacy field
      categorizedNotes: Array.isArray(categorizedNotes) ? categorizedNotes : [],
      documents: [],
      score: null,
      chatHistory: [],
      recommendation: null,
      status: 'in_progress',
      createdAt: now,
      updatedAt: now,
    };

    let suggestedHubspotDeals: any[] = [];

    if (isHubSpotConfigured()) {
      try {
        const explicitHubspotDealId = typeof hubspotDealId === 'string' ? hubspotDealId.trim() : '';
        if (explicitHubspotDealId) {
          const pulled = await pullHubSpotFieldsWithCompany(explicitHubspotDealId, now);
          const hubspotData = pulled.hubspotData;
          record.hubspotDealId = explicitHubspotDealId;
          record.hubspotDealStageId = hubspotData?.stageId;
          record.hubspotDealStageLabel = hubspotData?.stageLabel;
          record.hubspotPipelineId = hubspotData?.pipelineId;
          record.hubspotPipelineLabel = hubspotData?.pipelineLabel;
          record.hubspotAmount = hubspotData?.amount;
          record.hubspotSyncedAt = hubspotData?.syncedAt;
          record.hubspotCompanyId = pulled.hubspotCompanyId;
          record.hubspotCompanyName = pulled.hubspotCompanyName;
          record.hubspotCompanyData = pulled.hubspotCompanyData;
          if (!record.companyUrl && pulled.hubspotCompanyData?.website) {
            record.companyUrl = pulled.hubspotCompanyData.website;
          }
          if (!record.companyDescription && pulled.hubspotCompanyData?.description) {
            record.companyDescription = pulled.hubspotCompanyData.description;
          }
        } else {
          const candidates = await searchHubSpotDealsByName(record.companyName, 10);
          const exactMatches = candidates.filter(
            (deal) => deal.name.toLowerCase() === record.companyName.toLowerCase(),
          );
          suggestedHubspotDeals = candidates;
          const selected = exactMatches.length === 1
            ? exactMatches[0]
            : candidates.length === 1
              ? candidates[0]
              : null;

          if (selected) {
            record.hubspotDealId = selected.id;
            record.hubspotDealStageId = selected.stageId;
            record.hubspotDealStageLabel = selected.stageLabel;
            record.hubspotPipelineId = selected.pipelineId;
            record.hubspotPipelineLabel = selected.pipelineLabel;
            record.hubspotAmount = selected.amount;
            const associatedCompany = await getAssociatedCompanyForDeal(selected.id);
            if (associatedCompany) {
              record.hubspotCompanyId = associatedCompany.companyId;
              record.hubspotCompanyName = associatedCompany.name;
              record.hubspotCompanyData = associatedCompany;
              if (!record.companyUrl && associatedCompany.website) {
                record.companyUrl = associatedCompany.website;
              }
              if (!record.companyDescription && associatedCompany.description) {
                record.companyDescription = associatedCompany.description;
              }
            }
          }
        }
      } catch (error) {
        console.warn('HubSpot auto-link lookup failed on create:', error);
      }
    }

    await saveDiligenceRecord(record);

    return NextResponse.json({
      record,
      suggestedHubspotDeals,
      success: true,
    });
  } catch (error) {
    console.error('Error creating diligence record:', error);
    return NextResponse.json(
      { error: 'Failed to create diligence record', success: false },
      { status: 500 }
    );
  }
}
