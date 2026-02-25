import { NextRequest, NextResponse } from 'next/server';
import { loadDiligenceRecord, updateDiligenceRecord } from '@/lib/diligence-storage';
import { syncDiligenceToHubSpot } from '@/lib/hubspot-sync';

/**
 * POST /api/diligence/hubspot-sync - Sync diligence to HubSpot
 * Creates or updates a HubSpot deal with diligence information
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { diligenceId, dealStage } = body;

    if (!diligenceId) {
      return NextResponse.json(
        { error: 'Diligence ID is required', success: false },
        { status: 400 }
      );
    }

    // Load the diligence record
    const record = await loadDiligenceRecord(diligenceId);
    if (!record) {
      return NextResponse.json(
        { error: 'Diligence record not found', success: false },
        { status: 404 }
      );
    }

    // Validate we have a score
    if (!record.score) {
      return NextResponse.json(
        { error: 'Please score the diligence before syncing to HubSpot', success: false },
        { status: 400 }
      );
    }

    console.log(`Syncing diligence ${diligenceId} to HubSpot for ${record.companyName}`);
    const syncResult = await syncDiligenceToHubSpot(record, diligenceId, {
      dealStage: dealStage || undefined,
    });

    // Update diligence record with HubSpot deal ID and sync timestamp
    await updateDiligenceRecord(diligenceId, {
      hubspotDealId: syncResult.dealId,
      hubspotSyncedAt: new Date().toISOString(),
      hubspotDealStageId: syncResult.hubspotData.stageId,
      hubspotDealStageLabel: syncResult.hubspotData.stageLabel,
      hubspotPipelineId: syncResult.hubspotData.pipelineId,
      hubspotPipelineLabel: syncResult.hubspotData.pipelineLabel,
      hubspotAmount: syncResult.hubspotData.amount,
    });

    console.log(`Successfully synced to HubSpot deal: ${syncResult.dealId}`);

    return NextResponse.json({
      dealId: syncResult.dealId,
      dealUrl: syncResult.dealUrl,
      success: true,
      message: syncResult.existed ? 'Deal updated successfully' : 'Deal created successfully',
    });

  } catch (error) {
    console.error('Error syncing to HubSpot:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to sync to HubSpot',
        success: false 
      },
      { status: 500 }
    );
  }
}
