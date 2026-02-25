import { NextRequest, NextResponse } from 'next/server';
import { loadDiligenceRecord, updateDiligenceRecord, deleteDiligenceRecord } from '@/lib/diligence-storage';
import { deleteDriveFolder, moveDriveFolderToArchive } from '@/lib/google-drive';
import { getAssociatedCompanyForDeal, pullHubSpotFieldsWithCompany } from '@/lib/hubspot-sync';
import hubspotClient, { isHubSpotConfigured } from '@/lib/hubspot';
const HUBSPOT_DEAL_CURRENT_RUNWAY_PROPERTY = process.env.HUBSPOT_DEAL_CURRENT_RUNWAY_PROPERTY || "current_runway";
const HUBSPOT_DEAL_POST_FUNDING_RUNWAY_PROPERTY = process.env.HUBSPOT_DEAL_POST_FUNDING_RUNWAY_PROPERTY || "post_runway_funding";
const HUBSPOT_DEAL_RAISE_AMOUNT_PROPERTY = process.env.HUBSPOT_DEAL_RAISE_AMOUNT_PROPERTY || "raise_amount";
const HUBSPOT_DEAL_COMMITTED_FUNDING_PROPERTY = process.env.HUBSPOT_DEAL_COMMITTED_FUNDING_PROPERTY || "committed_funding";
const HUBSPOT_DEAL_VALUATION_PROPERTY = process.env.HUBSPOT_DEAL_VALUATION_PROPERTY || "deal_valuation";
const HUBSPOT_DEAL_TERMS_PROPERTY = process.env.HUBSPOT_DEAL_TERMS_PROPERTY || "deal_terms";
const HUBSPOT_DEAL_PRIORITY_PROPERTY = process.env.HUBSPOT_DEAL_PRIORITY_PROPERTY || "hs_priority";

/**
 * GET /api/diligence/[id] - Get a specific diligence record
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const record = await loadDiligenceRecord(id);

    if (!record) {
      return NextResponse.json(
        { error: 'Diligence record not found', success: false },
        { status: 404 }
      );
    }

    let hubspotData = null;
    let hubspotCompanyData = record.hubspotCompanyData;
    if (record.hubspotDealId) {
      try {
        const pulled = await pullHubSpotFieldsWithCompany(record.hubspotDealId, record.hubspotSyncedAt);
        hubspotData = pulled.hubspotData;
        hubspotCompanyData = pulled.hubspotCompanyData || hubspotCompanyData;
      } catch (error) {
        console.warn('Failed to pull HubSpot fields for diligence detail:', error);
      }
    }

    const recordWithLiveHubspot = hubspotData
      ? {
          ...record,
          hubspotDealStageId: hubspotData.stageId ?? record.hubspotDealStageId,
          hubspotDealStageLabel: hubspotData.stageLabel ?? record.hubspotDealStageLabel,
          hubspotPipelineId: hubspotData.pipelineId ?? record.hubspotPipelineId,
          hubspotPipelineLabel: hubspotData.pipelineLabel ?? record.hubspotPipelineLabel,
          hubspotAmount: hubspotData.amount ?? record.hubspotAmount,
          hubspotSyncedAt: hubspotData.syncedAt ?? record.hubspotSyncedAt,
          priority: record.priority || hubspotData.priority || "",
          hubspotCompanyData: hubspotCompanyData || record.hubspotCompanyData,
          metrics: {
            ...(record.metrics || {}),
            fundingAmount:
              record.metrics?.fundingAmount ||
              ((hubspotData.raiseAmount || hubspotCompanyData?.fundingAmount)
                ? {
                    value: hubspotData.raiseAmount || hubspotCompanyData?.fundingAmount,
                    source: 'auto',
                    sourceDetail: 'hubspot',
                    updatedAt: new Date().toISOString(),
                  }
                : undefined),
            committed:
              record.metrics?.committed ||
              ((hubspotData.committedFunding || hubspotCompanyData?.currentCommitments)
                ? {
                    value: hubspotData.committedFunding || hubspotCompanyData?.currentCommitments,
                    source: 'auto',
                    sourceDetail: 'hubspot',
                    updatedAt: new Date().toISOString(),
                  }
                : undefined),
            valuation:
              record.metrics?.valuation ||
              ((hubspotData.dealValuation || hubspotCompanyData?.fundingValuation)
                ? {
                    value: hubspotData.dealValuation || hubspotCompanyData?.fundingValuation,
                    source: 'auto',
                    sourceDetail: 'hubspot',
                    updatedAt: new Date().toISOString(),
                  }
                : undefined),
            dealTerms:
              record.metrics?.dealTerms ||
              ((hubspotData.dealTerms || hubspotCompanyData?.fundingValuation)
                ? {
                    value: hubspotData.dealTerms || hubspotCompanyData?.fundingValuation,
                    source: 'auto',
                    sourceDetail: 'hubspot',
                    updatedAt: new Date().toISOString(),
                  }
                : undefined),
            currentRunway:
              record.metrics?.currentRunway ||
              ((hubspotData.currentRunway || hubspotCompanyData?.currentRunway)
                ? {
                    value: hubspotData.currentRunway || hubspotCompanyData?.currentRunway,
                    source: 'auto',
                    sourceDetail: 'hubspot',
                    updatedAt: new Date().toISOString(),
                  }
                : undefined),
            postFundingRunway:
              record.metrics?.postFundingRunway ||
              ((hubspotData.postFundingRunway || hubspotCompanyData?.postFundingRunway)
                ? {
                    value: hubspotData.postFundingRunway || hubspotCompanyData?.postFundingRunway,
                    source: 'auto',
                    sourceDetail: 'hubspot',
                    updatedAt: new Date().toISOString(),
                  }
                : undefined),
          },
        }
      : record;

    return NextResponse.json({
      record: recordWithLiveHubspot,
      hubspotData,
      hubspotCompanyData,
      success: true,
    });
  } catch (error) {
    console.error('Error loading diligence record:', error);
    return NextResponse.json(
      { error: 'Failed to load diligence record', success: false },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/diligence/[id] - Update a diligence record
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      recommendation,
      status,
      score,
      notes,
      categorizedNotes,
      questions,
      documents,
      metrics,
      industry,
      priority,
      hubspotDealId,
      hubspotDealStageId,
      hubspotDealStageLabel,
      hubspotPipelineId,
      hubspotPipelineLabel,
      hubspotAmount,
      hubspotSyncedAt,
      hubspotDealStageProperties,
    } = body;

    const updates: any = {};
    if (recommendation !== undefined) updates.recommendation = recommendation;
    if (status !== undefined) updates.status = status;
    if (score !== undefined) updates.score = score;
    if (notes !== undefined) updates.notes = notes; // Legacy field
    if (categorizedNotes !== undefined) updates.categorizedNotes = categorizedNotes;
    if (questions !== undefined) updates.questions = questions;
    if (documents !== undefined) updates.documents = documents;
    if (metrics !== undefined) updates.metrics = metrics;
    if (industry !== undefined) updates.industry = industry;
    if (priority !== undefined) updates.priority = typeof priority === 'string' ? priority.trim() : '';
    if (hubspotDealId !== undefined) updates.hubspotDealId = hubspotDealId;
    if (hubspotDealStageId !== undefined) updates.hubspotDealStageId = hubspotDealStageId;
    if (hubspotDealStageLabel !== undefined) updates.hubspotDealStageLabel = hubspotDealStageLabel;
    if (hubspotPipelineId !== undefined) updates.hubspotPipelineId = hubspotPipelineId;
    if (hubspotPipelineLabel !== undefined) updates.hubspotPipelineLabel = hubspotPipelineLabel;
    if (hubspotAmount !== undefined) updates.hubspotAmount = hubspotAmount;
    if (hubspotSyncedAt !== undefined) updates.hubspotSyncedAt = hubspotSyncedAt;

    if (hubspotDealId !== undefined) {
      const normalizedDealId = typeof hubspotDealId === 'string' ? hubspotDealId.trim() : '';
      if (!normalizedDealId) {
        updates.hubspotCompanyId = undefined;
        updates.hubspotCompanyName = undefined;
        updates.hubspotCompanyData = undefined;
      } else {
        const company = await getAssociatedCompanyForDeal(normalizedDealId);
        if (company) {
          updates.hubspotCompanyId = company.companyId;
          updates.hubspotCompanyName = company.name;
          updates.hubspotCompanyData = company;
        } else {
          updates.hubspotCompanyId = undefined;
          updates.hubspotCompanyName = undefined;
          updates.hubspotCompanyData = undefined;
        }
      }
    }

    const existingRecord = await loadDiligenceRecord(id);
    if (!existingRecord) {
      return NextResponse.json(
        { error: 'Diligence record not found', success: false },
        { status: 404 }
      );
    }

    // HubSpot stage updates are write-through: local stage changes are only persisted
    // when the HubSpot write succeeds, preventing app/HubSpot drift.
    if (priority !== undefined) {
      const targetDealId = hubspotDealId !== undefined ? hubspotDealId : existingRecord.hubspotDealId;
      if (targetDealId && isHubSpotConfigured()) {
        try {
          const normalizedPriority = typeof priority === 'string' ? priority.trim() : '';
          await hubspotClient.crm.deals.basicApi.update(targetDealId, {
            properties: {
              [HUBSPOT_DEAL_PRIORITY_PROPERTY]: normalizedPriority,
            },
          });
        } catch (error: any) {
          const errorMessage = error?.message || 'Unknown error';
          console.error('✗ Failed to update HubSpot deal priority:', error);
          return NextResponse.json(
            { error: `HubSpot priority update failed: ${errorMessage}`, success: false },
            { status: 502 }
          );
        }
      }
    }

    // HubSpot stage updates are write-through: local stage changes are only persisted
    // when the HubSpot write succeeds, preventing app/HubSpot drift.
    if (hubspotDealStageId !== undefined) {
      const targetDealId = hubspotDealId !== undefined ? hubspotDealId : existingRecord.hubspotDealId;
      
      if (targetDealId && isHubSpotConfigured()) {
        try {
          console.log(`Attempting to update HubSpot deal ${targetDealId} stage to ${hubspotDealStageId}`);
          const extraStageProperties: Record<string, string> = {};
          if (hubspotDealStageProperties && typeof hubspotDealStageProperties === 'object') {
            for (const [key, rawValue] of Object.entries(hubspotDealStageProperties as Record<string, unknown>)) {
              if (!key) continue;
              if (typeof rawValue === 'string') {
                const normalized = rawValue.trim();
                if (normalized) extraStageProperties[key] = normalized;
              } else if (Array.isArray(rawValue)) {
                const normalized = rawValue.map((item) => String(item || '').trim()).filter(Boolean).join(';');
                if (normalized) extraStageProperties[key] = normalized;
              } else if (rawValue !== undefined && rawValue !== null) {
                const normalized = String(rawValue).trim();
                if (normalized) extraStageProperties[key] = normalized;
              }
            }
          }
          await hubspotClient.crm.deals.basicApi.update(targetDealId, {
            properties: {
              dealstage: hubspotDealStageId,
              ...extraStageProperties,
            },
          });
          console.log(`✓ Successfully updated HubSpot deal ${targetDealId} stage to ${hubspotDealStageId}`);
        } catch (error: any) {
          const errorMessage = error?.message || 'Unknown error';
          console.error('✗ Failed to update HubSpot deal stage:', error);
          return NextResponse.json(
            { error: `HubSpot stage update failed: ${errorMessage}`, success: false },
            { status: 502 }
          );
        }
      } else if (targetDealId && !isHubSpotConfigured()) {
        console.warn('HubSpot not configured, skipping sync');
        return NextResponse.json(
          { error: 'HubSpot is not configured for stage updates', success: false },
          { status: 400 }
        );
      } else {
        console.warn('No HubSpot deal ID found, skipping sync');
      }
    }

    // HubSpot company metric updates are also write-through.
    // Local metric changes are only persisted when HubSpot write succeeds.
    if (metrics !== undefined) {
      const normalizeMetricInput = (value: any): string => {
        if (typeof value?.value !== 'string') return '';
        return value.value.trim();
      };
      const normalizeRunwayMetricInput = (value: any): string => {
        const raw = normalizeMetricInput(value);
        if (!raw) return '';

        const normalized = raw.toLowerCase().replace(/\s+/g, ' ').trim();
        const numericMatch = normalized.match(/(\d+(?:\.\d+)?)/);
        const numericMonths = numericMatch ? Number(numericMatch[1]) : NaN;

        if (/^(<\s*3|under\s*3|less\s*than\s*3)/.test(normalized) && /month/.test(normalized)) {
          return '<3 months';
        }
        if (/^3\s*[-–]\s*6/.test(normalized) && /month/.test(normalized)) {
          return '3 - 6 months';
        }
        if (/^6\s*[-–]\s*12/.test(normalized) && /month/.test(normalized)) {
          return '6 - 12 months';
        }
        if (/^(>\s*12|over\s*12|more\s*than\s*12)/.test(normalized) && /month/.test(normalized)) {
          return '>12 months';
        }
        if (/month/.test(normalized) && Number.isFinite(numericMonths)) {
          if (numericMonths < 3) return '<3 months';
          if (numericMonths <= 6) return '3 - 6 months';
          if (numericMonths <= 12) return '6 - 12 months';
          return '>12 months';
        }

        // Preserve exact allowed options if already valid.
        if (
          raw === '<3 months' ||
          raw === '3 - 6 months' ||
          raw === '6 - 12 months' ||
          raw === '>12 months'
        ) {
          return raw;
        }

        // Fallback to raw value so HubSpot can return explicit validation if unsupported.
        return raw;
      };
      const normalizeRunwayForDealMetricInput = (value: any): string => {
        const raw = normalizeMetricInput(value);
        if (!raw) return '';
        const normalized = raw.toLowerCase().replace(/\s+/g, ' ').trim();
        if (/[-–]|to|>|<|under|over|less than|more than/.test(normalized)) {
          return raw;
        }
        const numericMatch = normalized.match(/(\d+(?:\.\d+)?)/);
        if (!numericMatch) return raw;
        return String(Math.round(Number(numericMatch[1])));
      };
      const normalizeValuationInMillionsForDealMetricInput = (value: any): string => {
        const raw = normalizeMetricInput(value);
        if (!raw) return '';
        const cleaned = raw.toLowerCase().replace(/[$,\s]/g, '');
        const match = cleaned.match(/^(-?\d+(?:\.\d+)?)([kmb])?$/);
        if (!match) return raw;
        const base = Number(match[1]);
        if (!Number.isFinite(base)) return raw;
        let millions: number;
        if (match[2] === 'b') millions = base * 1000;
        else if (match[2] === 'm') millions = base;
        else if (match[2] === 'k') millions = base / 1000;
        else millions = base > 100000 ? base / 1_000_000 : base;
        const rounded = Math.round(millions * 100) / 100;
        return Number.isInteger(rounded) ? String(Math.trunc(rounded)) : String(rounded);
      };
      const normalizeIntegerMetricInput = (value: any): string => {
        const raw = normalizeMetricInput(value);
        if (!raw) return '';

        const cleaned = raw
          .toLowerCase()
          .replace(/[$,\s]/g, '')
          .replace(/thousand/g, 'k')
          .replace(/million/g, 'm')
          .replace(/billion/g, 'b');

        const match = cleaned.match(/^(-?\d+(?:\.\d+)?)([kmb])?$/);
        if (!match) {
          return raw;
        }

        const base = Number(match[1]);
        if (!Number.isFinite(base)) {
          return raw;
        }

        const multiplier =
          match[2] === 'b' ? 1_000_000_000 :
          match[2] === 'm' ? 1_000_000 :
          match[2] === 'k' ? 1_000 :
          1;

        return String(Math.round(base * multiplier));
      };

      const targetCompanyId =
        updates.hubspotCompanyId !== undefined
          ? updates.hubspotCompanyId
          : existingRecord.hubspotCompanyId;
      const targetDealId =
        updates.hubspotDealId !== undefined
          ? updates.hubspotDealId
          : existingRecord.hubspotDealId;

      const companyProperties: Record<string, string> = {
        funding_valuation: normalizeIntegerMetricInput(metrics?.valuation),
        lead_information: normalizeMetricInput(metrics?.lead),
      };
      const fundingAmountForDeal = normalizeIntegerMetricInput(metrics?.fundingAmount);
      const fundingAmountForCompany = normalizeIntegerMetricInput(metrics?.fundingAmount);
      const committedFundingForDeal = normalizeIntegerMetricInput(metrics?.committed);
      const committedFundingForCompany = normalizeIntegerMetricInput(metrics?.committed);
      const valuationForDeal = normalizeValuationInMillionsForDealMetricInput(metrics?.valuation);
      const valuationForCompany = normalizeMetricInput(metrics?.valuation);
      const dealTermsForDeal = normalizeMetricInput(metrics?.dealTerms);
      const dealTermsForCompany = normalizeMetricInput(metrics?.dealTerms);
      const runwayForDeal = normalizeRunwayForDealMetricInput(metrics?.currentRunway);
      const runwayForCompany = normalizeRunwayMetricInput(metrics?.currentRunway);
      const postFundingRunwayForDeal = normalizeRunwayForDealMetricInput(metrics?.postFundingRunway);
      const postFundingRunwayForCompany = normalizeRunwayMetricInput(metrics?.postFundingRunway);
      let fallbackFundingAmountToCompany = false;
      let fallbackCommittedFundingToCompany = false;
      let fallbackValuationToCompany = false;
      let fallbackDealTermsToCompany = false;
      if (!targetDealId && fundingAmountForCompany) {
        companyProperties.funding_amount = fundingAmountForCompany;
      }
      if (!targetDealId && committedFundingForCompany) {
        companyProperties.current_commitments = committedFundingForCompany;
      }
      if (!targetDealId && valuationForCompany) {
        companyProperties.funding_valuation = valuationForCompany;
      }
      if (!targetDealId && !valuationForCompany && dealTermsForCompany) {
        companyProperties.funding_valuation = dealTermsForCompany;
      }
      if (!targetDealId && runwayForCompany) {
        companyProperties.what_is_your_current_runway_ = runwayForCompany;
      }
      if (!targetDealId && postFundingRunwayForCompany) {
        companyProperties.post_funding_runway = postFundingRunwayForCompany;
      }

      const hasCompanyMetricPayload = Object.values(companyProperties).some((value) => value !== '');
      const hasDealRunwayPayload =
        fundingAmountForDeal !== '' ||
        committedFundingForDeal !== '' ||
        valuationForDeal !== '' ||
        dealTermsForDeal !== '' ||
        runwayForDeal !== '' ||
        postFundingRunwayForDeal !== '';

      if (targetDealId && isHubSpotConfigured() && hasDealRunwayPayload) {
        try {
          const dealRunwayPayload: Record<string, string> = {};
          if (fundingAmountForDeal) {
            dealRunwayPayload[HUBSPOT_DEAL_RAISE_AMOUNT_PROPERTY] = fundingAmountForDeal;
          }
          if (committedFundingForDeal) {
            dealRunwayPayload[HUBSPOT_DEAL_COMMITTED_FUNDING_PROPERTY] = committedFundingForDeal;
          }
          if (valuationForDeal) {
            dealRunwayPayload[HUBSPOT_DEAL_VALUATION_PROPERTY] = valuationForDeal;
          }
          if (dealTermsForDeal) {
            dealRunwayPayload[HUBSPOT_DEAL_TERMS_PROPERTY] = dealTermsForDeal;
          }
          if (runwayForDeal) {
            dealRunwayPayload[HUBSPOT_DEAL_CURRENT_RUNWAY_PROPERTY] = runwayForDeal;
          }
          if (postFundingRunwayForDeal) {
            dealRunwayPayload[HUBSPOT_DEAL_POST_FUNDING_RUNWAY_PROPERTY] = postFundingRunwayForDeal;
          }
          await hubspotClient.crm.deals.basicApi.update(targetDealId, {
            properties: dealRunwayPayload,
          });
        } catch (error: any) {
          if (fundingAmountForCompany) {
            fallbackFundingAmountToCompany = true;
          }
          if (committedFundingForCompany) {
            fallbackCommittedFundingToCompany = true;
          }
          if (valuationForCompany) {
            fallbackValuationToCompany = true;
          }
          if (dealTermsForCompany) {
            fallbackDealTermsToCompany = true;
          }
          console.warn('HubSpot deal runway update failed; continuing with company fallback path:', error?.message || error);
        }
      }

      if (fallbackFundingAmountToCompany && fundingAmountForCompany) {
        companyProperties.funding_amount = fundingAmountForCompany;
      }
      if (fallbackCommittedFundingToCompany && committedFundingForCompany) {
        companyProperties.current_commitments = committedFundingForCompany;
      }
      if (fallbackValuationToCompany && valuationForCompany) {
        companyProperties.funding_valuation = valuationForCompany;
      }
      if (fallbackDealTermsToCompany && !valuationForCompany && dealTermsForCompany) {
        companyProperties.funding_valuation = dealTermsForCompany;
      }

      if (targetCompanyId && isHubSpotConfigured() && hasCompanyMetricPayload) {
        try {
          console.log(`Attempting to update HubSpot company ${targetCompanyId} funding fields`);
          await hubspotClient.crm.companies.basicApi.update(targetCompanyId, { properties: companyProperties });
          console.log(`✓ Successfully updated HubSpot company ${targetCompanyId} funding fields`);
        } catch (error: any) {
          const errorMessage = error?.message || 'Unknown error';
          console.error('✗ Failed to update HubSpot company funding fields:', error);
          return NextResponse.json(
            { error: `HubSpot company metric update failed: ${errorMessage}`, success: false },
            { status: 502 }
          );
        }
      } else if (targetCompanyId && !isHubSpotConfigured() && hasCompanyMetricPayload) {
        return NextResponse.json(
          { error: 'HubSpot is not configured for company metric updates', success: false },
          { status: 400 }
        );
      }
    }

    if (industry !== undefined) {
      const normalizedIndustry = typeof industry === 'string' ? industry.trim() : '';
      const targetCompanyId =
        updates.hubspotCompanyId !== undefined
          ? updates.hubspotCompanyId
          : existingRecord.hubspotCompanyId;
      if (targetCompanyId && isHubSpotConfigured() && normalizedIndustry) {
        try {
          await hubspotClient.crm.companies.basicApi.update(targetCompanyId, {
            properties: {
              industry: normalizedIndustry,
            },
          } as any);
        } catch (error: any) {
          const errorMessage = error?.message || 'Unknown error';
          return NextResponse.json(
            { error: `HubSpot company industry update failed: ${errorMessage}`, success: false },
            { status: 502 }
          );
        }
      }
    }

    const updatedRecord = await updateDiligenceRecord(id, updates);
    const shouldTriggerAutoRescore = Boolean(
      hubspotDealId !== undefined &&
      typeof hubspotDealId === 'string' &&
      hubspotDealId.trim() &&
      updates.hubspotCompanyData &&
      updatedRecord.score
    );
    if (shouldTriggerAutoRescore) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
      void fetch(`${appUrl}/api/diligence/rescore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diligenceId: id, forceFull: true }),
      }).catch((rescoreError) => {
        console.warn('Background auto-rescore after HubSpot deal link failed:', rescoreError);
      });
    }

    return NextResponse.json({
      record: updatedRecord,
      success: true,
    });
  } catch (error: any) {
    console.error('Error updating diligence record:', error);
    
    if (error.message === 'Diligence record not found') {
      return NextResponse.json(
        { error: 'Diligence record not found', success: false },
        { status: 404 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to update diligence record', success: false },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/diligence/[id] - Delete a diligence record
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Get the record to check for Google Drive folder
    const record = await loadDiligenceRecord(id);
    if (!record) {
      return NextResponse.json(
        { error: 'Diligence record not found', success: false },
        { status: 404 }
      );
    }

    console.log(`\n=== DELETING DILIGENCE: ${record.companyName} ===`);
    console.log(`Record ID: ${id}`);
    console.log(`Google Drive Folder ID: ${record.googleDriveFolderId || 'NONE'}`);

    // Handle Google Drive folder if it exists
    let folderMessage = '';
    let folderOperationFailed = false;
    let folderOperationError = '';
    if (record.googleDriveFolderId) {
      try {
        // Try to read the request body
        let body: any = {};
        try {
          const text = await request.text();
          console.log(`Request body text: "${text}"`);
          if (text) {
            body = JSON.parse(text);
          }
        } catch (e) {
          console.log('No request body or invalid JSON');
        }
        
        const folderAction = body.folderAction || 'keep';
        console.log(`Folder action: ${folderAction}`);

        if (folderAction === 'delete') {
          await deleteDriveFolder(record.googleDriveFolderId);
          folderMessage = ' Google Drive folder moved to Trash.';
          console.log(`✓ Trashed Google Drive folder: ${record.googleDriveFolderId}`);
        } else if (folderAction === 'archive') {
          await moveDriveFolderToArchive(record.googleDriveFolderId, record.companyName);
          folderMessage = ' Google Drive folder archived.';
          console.log(`✓ Archived Google Drive folder: ${record.googleDriveFolderId}`);
        } else {
          folderMessage = ' Google Drive folder kept.';
          console.log(`✓ Kept Google Drive folder: ${record.googleDriveFolderId}`);
        }
      } catch (folderError) {
        console.error('Error handling Google Drive folder:', folderError);
        folderOperationFailed = true;
        folderOperationError = folderError instanceof Error ? folderError.message : 'Unknown folder operation error';
        folderMessage = ' Warning: Could not manage Google Drive folder.';
      }
    }

    // If user explicitly requested archive/delete, do not delete the record unless folder operation succeeded.
    // This prevents false-positive "deleted" outcomes when Drive operations fail.
    if (record.googleDriveFolderId && folderOperationFailed) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to ${'manage'} Google Drive folder: ${folderOperationError}. Diligence record was NOT deleted.`,
        },
        { status: 500 }
      );
    }

    // Delete the diligence record
    await deleteDiligenceRecord(id);
    console.log(`✓ Deleted diligence record from storage`);
    console.log(`=== END DELETE ===\n`);

    return NextResponse.json({
      success: true,
      message: `Diligence record deleted.${folderMessage}`,
    });
  } catch (error) {
    console.error('Error deleting diligence record:', error);
    return NextResponse.json(
      { error: 'Failed to delete diligence record', success: false },
      { status: 500 }
    );
  }
}
