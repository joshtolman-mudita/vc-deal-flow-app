import { NextRequest, NextResponse } from "next/server";
import { loadDiligenceRecord, updateDiligenceRecord } from "@/lib/diligence-storage";
import { isHubSpotConfigured } from "@/lib/hubspot";
import { createHubSpotCompanyAndDeal } from "@/lib/hubspot-sync";

const PIPELINE_DEBUG =
  process.env.DEBUG_DILIGENCE_PIPELINE === "1" ||
  process.env.DEBUG_DILIGENCE_PIPELINE === "true" ||
  process.env.NODE_ENV !== "production";

function pipelineDebug(label: string, payload: Record<string, unknown>) {
  if (!PIPELINE_DEBUG) return;
  console.log(`[hubspot-create-commit][${label}]`, payload);
}

const HUBSPOT_DEAL_CURRENT_RUNWAY_PROPERTY =
  process.env.HUBSPOT_DEAL_CURRENT_RUNWAY_PROPERTY || "current_runway";
const HUBSPOT_DEAL_POST_FUNDING_RUNWAY_PROPERTY =
  process.env.HUBSPOT_DEAL_POST_FUNDING_RUNWAY_PROPERTY || "post_runway_funding";
const HUBSPOT_DEAL_RAISE_AMOUNT_PROPERTY =
  process.env.HUBSPOT_DEAL_RAISE_AMOUNT_PROPERTY || "raise_amount";
const HUBSPOT_DEAL_COMMITTED_FUNDING_PROPERTY =
  process.env.HUBSPOT_DEAL_COMMITTED_FUNDING_PROPERTY || "committed_funding";
const HUBSPOT_DEAL_VALUATION_PROPERTY =
  process.env.HUBSPOT_DEAL_VALUATION_PROPERTY || "deal_valuation";
const HUBSPOT_DEAL_TERMS_PROPERTY =
  process.env.HUBSPOT_DEAL_TERMS_PROPERTY || "deal_terms";
const HUBSPOT_DEAL_PRIORITY_PROPERTY =
  process.env.HUBSPOT_DEAL_PRIORITY_PROPERTY || "hs_priority";

function firstFilled(...values: Array<unknown>): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

export async function POST(request: NextRequest) {
  try {
    if (!isHubSpotConfigured()) {
      return NextResponse.json(
        { success: false, error: "HubSpot is not configured" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const diligenceId = typeof body?.diligenceId === "string" ? body.diligenceId.trim() : "";
    const companyProperties =
      body?.companyProperties && typeof body.companyProperties === "object"
        ? (body.companyProperties as Record<string, string>)
        : undefined;
    const dealProperties =
      body?.dealProperties && typeof body.dealProperties === "object"
        ? (body.dealProperties as Record<string, string>)
        : undefined;

    if (!diligenceId) {
      return NextResponse.json(
        { success: false, error: "diligenceId is required" },
        { status: 400 }
      );
    }

    const record = await loadDiligenceRecord(diligenceId);
    if (!record) {
      return NextResponse.json(
        { success: false, error: "Diligence record not found" },
        { status: 404 }
      );
    }

    const created = await createHubSpotCompanyAndDeal(record, diligenceId, {
      editedCompanyProperties: companyProperties,
      editedDealProperties: dealProperties,
    });

    const nowIso = new Date().toISOString();
    const nextCurrentRunway = firstFilled(
      dealProperties?.[HUBSPOT_DEAL_CURRENT_RUNWAY_PROPERTY],
      dealProperties?.current_runway,
      dealProperties?.runway,
      created.hubspotData?.currentRunway,
      created.hubspotCompanyData?.currentRunway,
      record.metrics?.currentRunway?.value
    );
    const nextPostFundingRunway = firstFilled(
      dealProperties?.[HUBSPOT_DEAL_POST_FUNDING_RUNWAY_PROPERTY],
      dealProperties?.post_runway_funding,
      dealProperties?.post_funding_runway,
      created.hubspotData?.postFundingRunway,
      created.hubspotCompanyData?.postFundingRunway,
      record.metrics?.postFundingRunway?.value
    );
    const nextFundingAmount = firstFilled(
      dealProperties?.[HUBSPOT_DEAL_RAISE_AMOUNT_PROPERTY],
      dealProperties?.raise_amount,
      created.hubspotData?.raiseAmount,
      created.hubspotCompanyData?.fundingAmount,
      record.metrics?.fundingAmount?.value
    );
    const nextCommittedFunding = firstFilled(
      dealProperties?.[HUBSPOT_DEAL_COMMITTED_FUNDING_PROPERTY],
      dealProperties?.committed_funding,
      created.hubspotData?.committedFunding,
      created.hubspotCompanyData?.currentCommitments,
      record.metrics?.committed?.value
    );
    const nextValuation = firstFilled(
      dealProperties?.[HUBSPOT_DEAL_VALUATION_PROPERTY],
      dealProperties?.deal_valuation,
      created.hubspotData?.dealValuation,
      created.hubspotCompanyData?.fundingValuation,
      record.metrics?.valuation?.value
    );
    const nextDealTerms = firstFilled(
      dealProperties?.[HUBSPOT_DEAL_TERMS_PROPERTY],
      dealProperties?.deal_terms,
      created.hubspotData?.dealTerms,
      record.metrics?.dealTerms?.value
    );
    const nextDealLead = firstFilled(
      dealProperties?.deal_lead,
      record.metrics?.lead?.value
    );
    const nextPriority = firstFilled(
      dealProperties?.[HUBSPOT_DEAL_PRIORITY_PROPERTY],
      dealProperties?.hs_priority,
      (created.hubspotData as any)?.priority,
      record.priority
    );
    pipelineDebug("resolved_metric_candidates", {
      diligenceId,
      dealPropertyKeys: Object.keys(dealProperties || {}),
      nextCurrentRunway,
      nextPostFundingRunway,
      nextFundingAmount,
      nextCommittedFunding,
      nextValuation,
      nextDealTerms,
      nextDealLead,
      nextPriority,
      existingMetricKeys: Object.keys(record.metrics || {}),
    });

    const nextMetrics = {
      ...(record.metrics || {}),
      ...(nextCurrentRunway
        ? {
            currentRunway: {
              ...(record.metrics?.currentRunway || {}),
              value: nextCurrentRunway,
              source: "manual" as const,
              updatedAt: nowIso,
            },
          }
        : {}),
      ...(nextFundingAmount
        ? {
            fundingAmount: {
              ...(record.metrics?.fundingAmount || {}),
              value: nextFundingAmount,
              source: "manual" as const,
              updatedAt: nowIso,
            },
          }
        : {}),
      ...(nextCommittedFunding
        ? {
            committed: {
              ...(record.metrics?.committed || {}),
              value: nextCommittedFunding,
              source: "manual" as const,
              updatedAt: nowIso,
            },
          }
        : {}),
      ...(nextValuation
        ? {
            valuation: {
              ...(record.metrics?.valuation || {}),
              value: nextValuation,
              source: "manual" as const,
              updatedAt: nowIso,
            },
          }
        : {}),
      ...(nextDealTerms
        ? {
            dealTerms: {
              ...(record.metrics?.dealTerms || {}),
              value: nextDealTerms,
              source: "manual" as const,
              updatedAt: nowIso,
            },
          }
        : {}),
      ...(nextDealLead
        ? {
            lead: {
              ...(record.metrics?.lead || {}),
              value: nextDealLead,
              source: "manual" as const,
              updatedAt: nowIso,
            },
          }
        : {}),
      ...(nextPostFundingRunway
        ? {
            postFundingRunway: {
              ...(record.metrics?.postFundingRunway || {}),
              value: nextPostFundingRunway,
              source: "manual" as const,
              updatedAt: nowIso,
            },
          }
        : {}),
    };

    const updatedRecord = await updateDiligenceRecord(diligenceId, {
      hubspotDealId: created.dealId,
      hubspotDealStageId: created.hubspotData?.stageId,
      hubspotDealStageLabel: created.hubspotData?.stageLabel,
      hubspotPipelineId: created.hubspotData?.pipelineId,
      hubspotPipelineLabel: created.hubspotData?.pipelineLabel,
      hubspotAmount: created.hubspotData?.amount,
      hubspotSyncedAt: created.hubspotData?.syncedAt || new Date().toISOString(),
      hubspotCompanyId: created.companyId,
      hubspotCompanyName: created.hubspotCompanyData?.name || record.hubspotCompanyName,
      hubspotCompanyData: created.hubspotCompanyData || record.hubspotCompanyData,
      priority: nextPriority || "",
      metrics: nextMetrics,
      industry:
        String(companyProperties?.industry || "").trim() ||
        String(created.hubspotCompanyData?.industry || "").trim() ||
        record.industry ||
        "",
    });
    pipelineDebug("persisted_metric_snapshot", {
      diligenceId,
      metricKeys: Object.keys(updatedRecord.metrics || {}),
      tam: updatedRecord.metrics?.tam?.value || "",
      currentRunway: updatedRecord.metrics?.currentRunway?.value || "",
      postFundingRunway: updatedRecord.metrics?.postFundingRunway?.value || "",
      fundingAmount: updatedRecord.metrics?.fundingAmount?.value || "",
      committed: updatedRecord.metrics?.committed?.value || "",
      valuation: updatedRecord.metrics?.valuation?.value || "",
      dealTerms: updatedRecord.metrics?.dealTerms?.value || "",
      lead: updatedRecord.metrics?.lead?.value || "",
    });

    return NextResponse.json({
      success: true,
      record: updatedRecord,
      preview: created.preview,
      dealId: created.dealId,
      companyId: created.companyId,
      dealUrl: created.dealUrl,
    });
  } catch (error) {
    console.error("Error committing HubSpot create flow:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to create HubSpot records" },
      { status: 500 }
    );
  }
}
