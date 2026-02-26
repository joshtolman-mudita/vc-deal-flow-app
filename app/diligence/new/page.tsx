"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import LoadingSpinner from "@/components/LoadingSpinner";
import CategorizedNotes from "@/components/CategorizedNotes";
import { Upload, FileText, AlertCircle, ExternalLink, X, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import type { DiligenceNote, HubSpotDealLookup, ThesisFitResult } from "@/types/diligence";

interface HubSpotCreateFieldState {
  fieldName: string;
  hubspotProperty: string;
  notes?: string;
  uiOrder?: number;
  required: boolean;
  requiredMode: "hard" | "warning";
  missing: boolean;
}

interface HubSpotCreatePreview {
  company: {
    properties: Record<string, string>;
    fields: HubSpotCreateFieldState[];
    missingHard: string[];
    missingWarnings: string[];
  };
  deal: {
    properties: Record<string, string>;
    fields: HubSpotCreateFieldState[];
    missingHard: string[];
    missingWarnings: string[];
  };
  canCreateCompany: boolean;
  canCreateDeal: boolean;
  createCompany?: boolean;
  existingCompanyId?: string;
  existingCompanyName?: string;
}
interface HubSpotSelectOption {
  label: string;
  value: string;
}
interface HubSpotOwnerOption {
  id: string;
  label: string;
  email?: string;
}
interface HubSpotPipelineOption {
  id: string;
  label: string;
  displayOrder?: number;
  stages?: Array<{
    id: string;
    label: string;
    displayOrder?: number;
  }>;
}
interface HubSpotPropertyOption {
  label: string;
  value: string;
}
const REQUESTED_DEAL_FIELD_KEYS = [
  "deal_bucket",
  "hubspot_owner_id",
  "hs_all_collaborator_owner_ids",
  "deal_lead",
  "deal_source_list",
  "dealtype",
  "hs_priority",
  "original_mudita_source",
  "deal_source",
  "dealstage",
  "closed_lost_reason",
  "closed_lost_reason_notes",
  "round_still_open",
];
const HIDDEN_DEAL_FIELD_KEYS = new Set([
  "description",
  "website",
  "diligence_recommendation",
  "diligence_data_quality",
  "diligence_score",
  "diligence_date",
  "diligence_arr",
  "diligence_tam",
  "diligence_acv",
  "deal_field_priority",
  "diligence_priority",
  "investment_decision",
  "decision_reason",
]);
const REJECT_FLOW_HIDDEN_FIELD_KEYS = new Set([
  "amount",
  "hs_all_collaborator_owner_ids",
  "dealtype",
  "hs_priority",
]);
const REJECT_FLOW_FORCE_VISIBLE_FIELD_KEYS = new Set([
  "closed_lost_reason",
  "closed_lost_reason_notes",
  "round_still_open",
]);
const CLOSED_LOST_WORKFLOW_FIELD_KEYS = new Set([
  "closed_lost_reason",
  "closed_lost_reason_notes",
  "round_still_open",
]);
const REJECT_FLOW_FIELD_ORDER = [
  "deal:dealstage",
  "company:name",
  "company:website",
  "company:description",
  "company:industry",
  "deal:deal_bucket",
  "deal:deal_source_list",
  "deal:pipeline",
  "deal:deal_source",
  "deal:original_mudita_source",
  "company:hubspot_owner_id",
  "deal:hubspot_owner_id",
  "company:city",
  "company:state",
  "company:country",
  "company:what_is_the_tam___sam___som_of_your_business_",
  "company:tam",
  "company:founded_year",
  "deal:raise_amount",
  "deal:committed_funding",
  "deal:deal_valuation",
  "deal:deal_terms",
  "deal:deal_lead",
  "deal:current_runway",
  "deal:post_runway_funding",
  "deal:closed_lost_reason",
  "deal:closed_lost_reason_notes",
  "deal:round_still_open",
] as const;

function NewDiligenceForm() {
  type StartMode = "thesis" | "full";
  const SCORE_PROGRESS_STEPS = [
    "Starting full diligence scoring...",
    "Running Team research...",
    "Running Portfolio Synergy research...",
    "Running Problem Necessity research...",
    "Running TAM and market growth analysis...",
    "Scoring all diligence criteria...",
    "Finalizing score and syncing results...",
  ];

  const router = useRouter();
  const searchParams = useSearchParams();
  const [companyName, setCompanyName] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [categorizedNotes, setCategorizedNotes] = useState<DiligenceNote[]>([]);
  const [noteCategories] = useState<string[]>(["Overall"]);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [links, setLinks] = useState<Array<{ name: string; url: string; email?: string }>>([]);
  const [addingLink, setAddingLink] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkEmail, setLinkEmail] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [runningThesisFirst, setRunningThesisFirst] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diligenceId, setDiligenceId] = useState<string | null>(null);
  const [createdHubspotDealId, setCreatedHubspotDealId] = useState<string | null>(null);
  const [thesisFirstResult, setThesisFirstResult] = useState<ThesisFitResult | null>(null);
  const [showThesisDecisionPanel, setShowThesisDecisionPanel] = useState(false);
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);
  const [movingToStageSeven, setMovingToStageSeven] = useState(false);
  const [stageSevenAfterCreate, setStageSevenAfterCreate] = useState(false);
  const [showThesisFeedbackForm, setShowThesisFeedbackForm] = useState(false);
  const [savingThesisFeedback, setSavingThesisFeedback] = useState(false);
  const [thesisFeedbackError, setThesisFeedbackError] = useState<string | null>(null);
  const [thesisFeedbackSuccess, setThesisFeedbackSuccess] = useState<string | null>(null);
  const [thesisFeedbackSavedAt, setThesisFeedbackSavedAt] = useState<string | null>(null);
  const [lastAutoFeedbackSignature, setLastAutoFeedbackSignature] = useState<string | null>(null);
  const [reviewerFitDraft, setReviewerFitDraft] = useState<ThesisFitResult["fit"]>("mixed");
  const [reviewerWhyFitsDraft, setReviewerWhyFitsDraft] = useState("");
  const [reviewerWhyNotFitDraft, setReviewerWhyNotFitDraft] = useState("");
  const [reviewerCruxQuestionDraft, setReviewerCruxQuestionDraft] = useState("");
  const [reviewerNotesDraft, setReviewerNotesDraft] = useState("");
  const [chatgptAssessmentDraft, setChatgptAssessmentDraft] = useState("");
  const [enableScoringFeedback, setEnableScoringFeedback] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const [docsendIngestWarning, setDocsendIngestWarning] = useState<string | null>(null);
  const [documentReadWarning, setDocumentReadWarning] = useState<string | null>(null);
  const [discoveringHubSpot, setDiscoveringHubSpot] = useState(false);
  const [loadingHubspotCompany, setLoadingHubspotCompany] = useState(false);
  const [hubspotLookupError, setHubspotLookupError] = useState<string | null>(null);
  const [hubspotCandidates, setHubspotCandidates] = useState<HubSpotDealLookup[]>([]);
  const [selectedHubspotDeal, setSelectedHubspotDeal] = useState<HubSpotDealLookup | null>(null);
  const [showHubSpotMatchModal, setShowHubSpotMatchModal] = useState(false);
  const [pendingStartMode, setPendingStartMode] = useState<StartMode | null>(null);
  const [pendingNormalizedCompanyUrl, setPendingNormalizedCompanyUrl] = useState("");
  const [manualHubSpotDealLink, setManualHubSpotDealLink] = useState("");
  const [manualHubSpotLookupLoading, setManualHubSpotLookupLoading] = useState(false);
  const [manualHubSpotLookupError, setManualHubSpotLookupError] = useState<string | null>(null);
  const [closeDealAfterCreate, setCloseDealAfterCreate] = useState(false);
  const [showHubSpotCreateModal, setShowHubSpotCreateModal] = useState(false);
  const [hubSpotCreatePreview, setHubSpotCreatePreview] = useState<HubSpotCreatePreview | null>(null);
  const [hubSpotCreateError, setHubSpotCreateError] = useState<string | null>(null);
  const [hubSpotCreateLoading, setHubSpotCreateLoading] = useState(false);
  const [hubSpotCreateSaving, setHubSpotCreateSaving] = useState(false);
  const [companyDraftProperties, setCompanyDraftProperties] = useState<Record<string, string>>({});
  const [dealDraftProperties, setDealDraftProperties] = useState<Record<string, string>>({});
  const [hubspotIndustryOptions, setHubspotIndustryOptions] = useState<HubSpotSelectOption[]>([]);
  const [hubspotIndustryOptionsLoading, setHubspotIndustryOptionsLoading] = useState(false);
  const [hubspotOwnerOptions, setHubspotOwnerOptions] = useState<HubSpotOwnerOption[]>([]);
  const [hubspotOwnerOptionsLoading, setHubspotOwnerOptionsLoading] = useState(false);
  const [hubspotDealPipelineOptions, setHubspotDealPipelineOptions] = useState<HubSpotPipelineOption[]>([]);
  const [hubspotDealPipelineOptionsLoading, setHubspotDealPipelineOptionsLoading] = useState(false);
  const [hubspotReferenceOptionsLoaded, setHubspotReferenceOptionsLoaded] = useState(false);
  const [hubspotFieldDescriptions, setHubspotFieldDescriptions] = useState<Record<string, string>>({});
  const [hubspotDealFieldOptions, setHubspotDealFieldOptions] = useState<Record<string, HubSpotPropertyOption[]>>({});
  const [hubspotCreateModalOffset, setHubspotCreateModalOffset] = useState({ x: 0, y: 0 });
  const hubspotCreateModalDragRef = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  useEffect(() => {
    if (showHubSpotCreateModal) {
      setHubspotReferenceOptionsLoaded(false);
    } else {
      setHubspotCreateModalOffset({ x: 0, y: 0 });
    }
  }, [showHubSpotCreateModal]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!hubspotCreateModalDragRef.current.dragging) return;
      const deltaX = event.clientX - hubspotCreateModalDragRef.current.startX;
      const deltaY = event.clientY - hubspotCreateModalDragRef.current.startY;
      setHubspotCreateModalOffset({
        x: hubspotCreateModalDragRef.current.originX + deltaX,
        y: hubspotCreateModalDragRef.current.originY + deltaY,
      });
    };
    const handleMouseUp = () => {
      hubspotCreateModalDragRef.current.dragging = false;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  useEffect(() => {
    const name = searchParams.get("companyName");
    const url = searchParams.get("companyUrl");
    if (name) setCompanyName(name);
    if (url) setCompanyUrl(url);
  }, [searchParams]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch("/api/settings");
        if (!response.ok) return;
        const data = await response.json();
        setEnableScoringFeedback(data?.settings?.enableScoringFeedback !== false);
      } catch {
        // Non-blocking: default remains enabled.
      }
    };
    void loadSettings();
  }, []);

  useEffect(() => {
    if (!thesisFirstResult) return;
    setReviewerFitDraft(thesisFirstResult.fit);
    setReviewerWhyFitsDraft((thesisFirstResult.whyFits || []).join("\n"));
    setReviewerWhyNotFitDraft((thesisFirstResult.whyNotFit || []).join("\n"));
    setReviewerCruxQuestionDraft(thesisFirstResult.cruxQuestion || "");
    setThesisFeedbackError(null);
    setThesisFeedbackSuccess(null);
    setThesisFeedbackSavedAt(null);
    setLastAutoFeedbackSignature(null);
    setReviewerNotesDraft("");
    setChatgptAssessmentDraft("");
  }, [thesisFirstResult]);

  useEffect(() => {
    if (!showHubSpotCreateModal || hubspotReferenceOptionsLoaded) return;
    setHubspotReferenceOptionsLoaded(true);
    const loadReferenceOptions = async () => {
      setHubspotIndustryOptionsLoading(true);
      setHubspotOwnerOptionsLoading(true);
      setHubspotDealPipelineOptionsLoading(true);
      try {
        if (hubspotIndustryOptions.length === 0) {
          const response = await fetch("/api/hubspot/companies/properties?property=industry");
          const data = await response.json();
          if (response.ok) {
            const options = Array.isArray(data?.property?.options)
              ? data.property.options
                  .map((option: any) => ({
                    label: String(option?.label || option?.value || "").trim(),
                    value: String(option?.value || "").trim(),
                  }))
                  .filter((option: HubSpotSelectOption) => option.label && option.value)
              : [];
            setHubspotIndustryOptions(options);
          }
        }
        if (hubspotOwnerOptions.length === 0) {
          const ownerResponse = await fetch("/api/hubspot/owners");
          const ownerData = await ownerResponse.json();
          if (ownerResponse.ok) {
            let owners = Array.isArray(ownerData?.owners)
              ? ownerData.owners
                  .map((owner: any) => ({
                    id: String(owner?.id || "").trim(),
                    label: String(owner?.label || owner?.email || owner?.id || "").trim(),
                    email: String(owner?.email || "").trim() || undefined,
                  }))
                  .filter((owner: HubSpotOwnerOption) => owner.id && owner.label)
              : [];
            if (owners.length === 0) {
              const ownerPropertyResponse = await fetch("/api/hubspot/companies/properties?property=hubspot_owner_id");
              const ownerPropertyData = await ownerPropertyResponse.json();
              if (ownerPropertyResponse.ok && Array.isArray(ownerPropertyData?.property?.options)) {
                owners = ownerPropertyData.property.options
                  .map((option: any) => ({
                    id: String(option?.value || "").trim(),
                    label: String(option?.label || option?.value || "").trim(),
                  }))
                  .filter((owner: HubSpotOwnerOption) => owner.id && owner.label);
              }
            }
            setHubspotOwnerOptions(owners);
          }
        }
        if (hubspotDealPipelineOptions.length === 0) {
          const pipelineResponse = await fetch("/api/hubspot/stages");
          const pipelineData = await pipelineResponse.json();
          if (pipelineResponse.ok && Array.isArray(pipelineData?.pipelines)) {
            const options = pipelineData.pipelines
              .map((pipeline: any) => ({
                id: String(pipeline?.id || "").trim(),
                label: String(pipeline?.label || "").trim(),
                displayOrder: Number(pipeline?.displayOrder || 0),
                stages: Array.isArray(pipeline?.stages)
                  ? pipeline.stages.map((stage: any) => ({
                      id: String(stage?.id || "").trim(),
                      label: String(stage?.label || "").trim(),
                      displayOrder: Number(stage?.displayOrder || 0),
                    }))
                  : [],
              }))
              .filter((pipeline: HubSpotPipelineOption) => pipeline.id && pipeline.label)
              .filter((pipeline: HubSpotPipelineOption) => /deal\s*flow/i.test(pipeline.label))
              .sort((a: HubSpotPipelineOption, b: HubSpotPipelineOption) => (a.displayOrder || 0) - (b.displayOrder || 0));
            setHubspotDealPipelineOptions(options);
          }
        }
      } catch {
        // Non-blocking: fallback to text input when options fail to load.
      } finally {
        setHubspotIndustryOptionsLoading(false);
        setHubspotOwnerOptionsLoading(false);
        setHubspotDealPipelineOptionsLoading(false);
      }
    };
    void loadReferenceOptions();
  }, [
    showHubSpotCreateModal,
    hubspotReferenceOptionsLoaded,
    hubspotIndustryOptions.length,
    hubspotOwnerOptions.length,
    hubspotDealPipelineOptions.length,
  ]);

  useEffect(() => {
    if (!showHubSpotCreateModal || hubspotDealPipelineOptions.length === 0) return;
    setDealDraftProperties((prev) => {
      const currentPipelineId = (prev.pipeline || "").trim();
      const hasCurrent = hubspotDealPipelineOptions.some((pipeline) => pipeline.id === currentPipelineId);
      if (hasCurrent) return prev;
      const preferred =
        hubspotDealPipelineOptions.find((pipeline) => /fund\s*ii\s*deal\s*flow/i.test(pipeline.label)) ||
        hubspotDealPipelineOptions[0];
      if (!preferred?.id) return prev;
      return { ...prev, pipeline: preferred.id };
    });
  }, [showHubSpotCreateModal, hubspotDealPipelineOptions]);

  useEffect(() => {
    if (!showHubSpotCreateModal || !hubSpotCreatePreview) return;
    const companyKeys = getVisibleCompanyFieldEntries().map(([key]) => key);
    const dealKeys = Object.keys(dealDraftProperties).filter((key) => !HIDDEN_DEAL_FIELD_KEYS.has(key));
    const missingCompanyKeys = companyKeys.filter((key) => !hubspotFieldDescriptions[`company:${key}`]);
    const missingDealKeys = dealKeys.filter((key) => !hubspotFieldDescriptions[`deal:${key}`]);
    if (missingCompanyKeys.length === 0 && missingDealKeys.length === 0) return;

    const loadFieldDescriptions = async () => {
      const nextDescriptions: Record<string, string> = {};
      await Promise.all([
        ...missingCompanyKeys.map(async (key) => {
          try {
            const response = await fetch(`/api/hubspot/companies/properties?property=${encodeURIComponent(key)}`);
            const data = await response.json();
            if (response.ok) {
              const description = String(data?.property?.description || "").trim();
              if (description) nextDescriptions[`company:${key}`] = description;
            }
          } catch {}
        }),
        ...missingDealKeys.map(async (key) => {
          try {
            const response = await fetch(`/api/hubspot/properties?property=${encodeURIComponent(key)}`);
            const data = await response.json();
            if (response.ok) {
              const description = String(data?.property?.description || "").trim();
              if (description) nextDescriptions[`deal:${key}`] = description;
            }
          } catch {}
        }),
      ]);
      if (Object.keys(nextDescriptions).length > 0) {
        setHubspotFieldDescriptions((prev) => ({ ...prev, ...nextDescriptions }));
      }
    };
    void loadFieldDescriptions();
  }, [showHubSpotCreateModal, hubSpotCreatePreview, dealDraftProperties, hubspotFieldDescriptions]);

  useEffect(() => {
    if (!showHubSpotCreateModal || !hubSpotCreatePreview) return;
    const ensureRequestedDealFields = async () => {
      const resolvedEntries = await Promise.all(
        REQUESTED_DEAL_FIELD_KEYS.map(async (propertyKey) => {
          try {
            const response = await fetch(`/api/hubspot/properties?property=${encodeURIComponent(propertyKey)}`);
            const data = await response.json();
            if (!response.ok || !data?.property?.name) return null;
            const propertyName = String(data.property.name || "").trim();
            const description = String(data.property.description || "").trim();
            const options = Array.isArray(data.property.options)
              ? data.property.options
                  .map((option: any) => ({
                    label: String(option?.label || option?.value || "").trim(),
                    value: String(option?.value || "").trim(),
                  }))
                  .filter((option: HubSpotPropertyOption) => option.label && option.value)
              : [];
            return { propertyName, description, options };
          } catch {
            return null;
          }
        })
      );

      const validEntries = resolvedEntries.filter(
        (entry): entry is { propertyName: string; description: string; options: HubSpotPropertyOption[] } =>
          Boolean(entry?.propertyName)
      );
      if (validEntries.length === 0) return;

      setDealDraftProperties((prev) => {
        const next = { ...prev };
        for (const entry of validEntries) {
          if (!(entry.propertyName in next)) next[entry.propertyName] = "";
        }
        return next;
      });
      const nextDescriptions: Record<string, string> = {};
      const nextOptions: Record<string, HubSpotPropertyOption[]> = {};
      for (const entry of validEntries) {
        if (entry.description) nextDescriptions[`deal:${entry.propertyName}`] = entry.description;
        if (entry.options.length > 0) nextOptions[entry.propertyName] = entry.options;
      }
      if (Object.keys(nextDescriptions).length > 0) {
        setHubspotFieldDescriptions((prev) => ({ ...prev, ...nextDescriptions }));
      }
      if (Object.keys(nextOptions).length > 0) {
        setHubspotDealFieldOptions((prev) => ({ ...prev, ...nextOptions }));
      }
    };
    void ensureRequestedDealFields();
  }, [showHubSpotCreateModal, hubSpotCreatePreview]);

  useEffect(() => {
    if (hubspotOwnerOptions.length > 0) return;
    const collaboratorOptions = hubspotDealFieldOptions.hs_all_collaborator_owner_ids || [];
    if (collaboratorOptions.length === 0) return;
    setHubspotOwnerOptions(
      collaboratorOptions.map((option) => ({
        id: option.value,
        label: option.label,
      }))
    );
  }, [hubspotOwnerOptions.length, hubspotDealFieldOptions]);

  useEffect(() => {
    if (!showHubSpotCreateModal) return;
    setDealDraftProperties((prev) => {
      const options = hubspotDealFieldOptions.dealtype || [];
      const preferred = options.find((option) => /new\s*-?\s*investment/i.test(option.label || ""));
      const selectedPipeline = hubspotDealPipelineOptions.find((pipeline) => pipeline.id === (prev.pipeline || "").trim());
      const triageStage =
        (selectedPipeline?.stages || []).find((stage) => /deal\s*0\s*:\s*triage/i.test(stage.label || "")) ||
        hubspotDealPipelineOptions
          .flatMap((pipeline) => pipeline.stages || [])
          .find((stage) => /deal\s*0\s*:\s*triage/i.test(stage.label || ""));
      const next: Record<string, string> = { ...prev };
      if (!(next.dealtype || "").trim()) {
        next.dealtype = preferred?.value || "New Investment";
      }
      if (triageStage?.id) {
        next.dealstage = triageStage.id;
      }
      return next;
    });
  }, [showHubSpotCreateModal, hubspotDealFieldOptions, hubspotDealPipelineOptions]);

  useEffect(() => {
    if (!showHubSpotCreateModal) return;
    if (hubspotIndustryOptions.length === 0) return;
    setCompanyDraftProperties((prev) => {
      const rawIndustry = String(prev.industry || "").trim();
      if (rawIndustry) {
        const normalized = mapIndustryGuessToOptionValue(rawIndustry, hubspotIndustryOptions);
        if (normalized && normalized !== rawIndustry) {
          return {
            ...prev,
            industry: normalized,
          };
        }
        return prev;
      }
      const fallbackIndustry = chooseIndustryValue(prev);
      if (!fallbackIndustry) return prev;
      return {
        ...prev,
        industry: fallbackIndustry,
      };
    });
  }, [showHubSpotCreateModal, hubspotIndustryOptions]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddLink = () => {
    if (!linkName.trim() || !linkUrl.trim()) return;
    setLinks(prev => [...prev, { 
      name: linkName.trim(), 
      url: linkUrl.trim(),
      email: linkEmail.trim() || undefined
    }]);
    setLinkName("");
    setLinkUrl("");
    setLinkEmail("");
    setAddingLink(false);
  };

  const removeLink = (index: number) => {
    setLinks(prev => prev.filter((_, i) => i !== index));
  };

  const normalizeCompanyUrlInput = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  };

  const isValidHttpUrl = (value: string): boolean => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  const normalizeCompanyNameForMatch = (value: string): string => {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b(inc|llc|ltd|corp|corporation|company|co)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  const levenshteinDistance = (a: string, b: string): number => {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost,
        );
      }
    }
    return dp[a.length][b.length];
  };

  const confirmNotDuplicateDiligence = async (normalizedCompanyUrl: string): Promise<boolean> => {
    const proposedName = companyName.trim();
    if (!proposedName) return true;

    const proposedNormalized = normalizeCompanyNameForMatch(proposedName);
    if (!proposedNormalized) return true;

    const proposedDomain = extractDomain(normalizedCompanyUrl);

    try {
      const response = await fetch("/api/diligence");
      const data = await response.json();
      const records: Array<{ id: string; companyName?: string; companyUrl?: string; createdAt?: string; status?: string }> =
        Array.isArray(data?.records) ? data.records : [];

      const candidates = records
        .map((record) => {
          const existingName = String(record.companyName || "").trim();
          if (!existingName) return null;

          const existingNormalized = normalizeCompanyNameForMatch(existingName);
          if (!existingNormalized) return null;

          let score = 0;
          let reason = "";

          if (existingNormalized === proposedNormalized) {
            score = 1;
            reason = "same company name";
          } else {
            const minLen = Math.min(existingNormalized.length, proposedNormalized.length);
            if (minLen >= 5 && (existingNormalized.includes(proposedNormalized) || proposedNormalized.includes(existingNormalized))) {
              score = 0.92;
              reason = "very similar company name";
            } else {
              const distance = levenshteinDistance(existingNormalized, proposedNormalized);
              const similarity = 1 - distance / Math.max(existingNormalized.length, proposedNormalized.length, 1);
              if (similarity >= 0.82) {
                score = similarity;
                reason = "fuzzy name match";
              }
            }
          }

          const existingDomain = extractDomain(record.companyUrl || "");
          if (proposedDomain && existingDomain && proposedDomain === existingDomain) {
            if (score < 0.95) score = 0.95;
            reason = reason ? `${reason} + same domain` : "same domain";
          }

          if (score <= 0) return null;
          return {
            id: record.id,
            existingName,
            createdAt: record.createdAt,
            status: record.status,
            score,
            reason,
          };
        })
        .filter((candidate): candidate is {
          id: string;
          existingName: string;
          createdAt: string | undefined;
          status: string | undefined;
          score: number;
          reason: string;
        } => Boolean(candidate))
        .sort((a, b) => b.score - a.score);

      if (candidates.length === 0) return true;

      const topCandidates = candidates.slice(0, 3);
      const details = topCandidates
        .map((match) => {
          const similarityPct = Math.round(match.score * 100);
          const created = match.createdAt ? new Date(match.createdAt).toISOString().split("T")[0] : "unknown date";
          const status = match.status || "unknown";
          return `- ${match.existingName} (${similarityPct}% match, ${match.reason}, status: ${status}, created: ${created})`;
        })
        .join("\n");

      const proceed = window.confirm(
        `This looks like a potential duplicate diligence record:\n\n${details}\n\nDo you still want to create a new diligence record?`
      );
      return proceed;
    } catch (err) {
      console.warn("Duplicate diligence check failed; allowing create flow to continue.", err);
      return true;
    }
  };

  const isPotentialDuplicateHubSpotStage = (deal: HubSpotDealLookup | null): boolean => {
    if (!deal) return false;
    const stageLabel = (deal.stageLabel || "").toLowerCase();
    const stageId = (deal.stageId || "").toLowerCase();

    // Heuristic: "stage 7" style labels or closed outcomes often indicate
    // late/final pipeline states where creating a new diligence can be a duplicate.
    const looksLikeStageSeven =
      /\bstage\s*7\b/.test(stageLabel) ||
      /^7(\b|[^0-9])/.test(stageLabel) ||
      /\b7\b/.test(stageId);
    const looksClosed =
      /closed\s*won|closed\s*lost|won\b|lost\b|do not invest|passed/.test(stageLabel);

    return looksLikeStageSeven || looksClosed;
  };

  const thesisFitLabel = (fit?: ThesisFitResult["fit"]) => {
    if (fit === "on_thesis") return "On thesis";
    if (fit === "off_thesis") return "Off thesis";
    return "Mixed";
  };

  const thesisFitBadgeClass = (fit?: ThesisFitResult["fit"]) => {
    if (fit === "on_thesis") return "bg-green-100 text-green-800";
    if (fit === "off_thesis") return "bg-red-100 text-red-800";
    return "bg-amber-100 text-amber-800";
  };

  const formatHubSpotFieldLabel = (
    propertyKey: string,
    fallbackLabel?: string,
    objectType?: "company" | "deal"
  ): string => {
    if (propertyKey === "dealname" || propertyKey === "name") return "Company Name";
    if (propertyKey === "founded_year") return "Year Founded";
    if (propertyKey === "amount") return "Target Investment Amount";
    if (propertyKey === "dealstage") return "Deal Stage";
    if (propertyKey === "hs_all_collaborator_owner_ids") return "Deal Collaborator";
    if (propertyKey === "dealtype") return "Deal Type";
    if (propertyKey === "deal_source_list") return "Deal Source";
    if (propertyKey === "deal_source") return "Deal Source Details";
    if (propertyKey === "hs_priority") return "Priority";
    if (propertyKey === "original_mudita_source") return "Original Mudita Source";
    if (propertyKey === "raise_amount") return "Raise Amount";
    if (propertyKey === "committed_funding") return "Committed Funding";
    if (propertyKey === "deal_valuation") return "Valuation";
    if (propertyKey === "current_runway") return "Current Runway";
    if (propertyKey === "post_runway_funding") return "Post Funding Runway";
    if (propertyKey === "closed_lost_reason") return "Deal Reject Reasons";
    if (propertyKey === "closed_lost_reason_notes") return "Closed Lost Reason Notes";
    if (propertyKey === "round_still_open") return "Round Still Open";
    if (propertyKey === "hubspot_owner_id") return objectType === "deal" ? "Deal Owner" : "Company Owner";
    if (propertyKey === "what_is_the_tam___sam___som_of_your_business_" || propertyKey === "tam") return "TAM";
    if (
      propertyKey === "industry" ||
      propertyKey === "investment_sector" ||
      propertyKey === "what_industry_sector_do_you_operate_in___please_select_all_that_apply_"
    ) {
      return "Industry";
    }
    const cleanPrefix = (value: string) =>
      value
        .replace(/^hs[\s:_-]+/i, "")
        .replace(/^hubspot[\s:_-]+/i, "")
        .trim();
    const preferred = cleanPrefix((fallbackLabel || "").trim());
    if (preferred) return preferred;
    return cleanPrefix(propertyKey)
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const resolvePreferredIndustryFromDraft = (draft: Record<string, string>): string => {
    return (
      (draft.industry || "").trim() ||
      (draft.what_industry_sector_do_you_operate_in___please_select_all_that_apply_ || "").trim() ||
      (draft.investment_sector || "").trim() ||
      ""
    );
  };

  const mapIndustryGuessToOptionValue = (guess: string, options: HubSpotSelectOption[]): string => {
    const normalizedGuess = guess.trim().toLowerCase();
    if (!normalizedGuess) return "";
    const tokenize = (value: string) =>
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter(Boolean);
    const exactValue = options.find((option) => option.value.trim().toLowerCase() === normalizedGuess);
    if (exactValue) return exactValue.value;
    const exactLabel = options.find((option) => option.label.trim().toLowerCase() === normalizedGuess);
    if (exactLabel) return exactLabel.value;
    const guessTokens = Array.from(new Set(tokenize(normalizedGuess))).filter((token) => token.length >= 2);
    const tokenMatch = options.find((option) => {
      const optionTokens = new Set(tokenize(`${option.label} ${option.value}`));
      return guessTokens.some((token) => optionTokens.has(token));
    });
    if (tokenMatch) return tokenMatch.value;
    if (normalizedGuess.length < 4) return "";
    const contains = options.find((option) => {
      const label = option.label.trim().toLowerCase();
      return label.includes(normalizedGuess) || normalizedGuess.includes(label);
    });
    if (contains) {
      const label = contains.label.trim().toLowerCase();
      if (label === "accounting" && !/\b(accounting|bookkeep|tax|cpa|audit|ledger)\b/i.test(normalizedGuess)) {
        return "";
      }
      return contains.value;
    }
    return "";
  };

  const chooseIndustryValue = (draft: Record<string, string>): string => {
    const guessed = resolvePreferredIndustryFromDraft(draft);
    const mapped = guessed ? mapIndustryGuessToOptionValue(guessed, hubspotIndustryOptions) : "";
    if (mapped) return mapped;
    const other = hubspotIndustryOptions.find((option) => /other/i.test(option.label));
    if (other?.value) return other.value;
    return "";
  };

  const COMPANY_FIELD_PRIORITY = [
    "name",
    "website",
    "description",
    "hubspot_owner_id",
    "industry",
    "what_is_the_tam___sam___som_of_your_business_",
    "tam",
    "investment_sector",
    "what_industry_sector_do_you_operate_in___please_select_all_that_apply_",
    "founded_year",
    "city",
    "state",
    "country",
  ] as const;
  const US_STATE_OPTIONS = [
    "", "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
    "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
    "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
    "WV", "WI", "WY",
  ] as const;

  const getVisibleCompanyFieldEntries = (): Array<[string, string]> => {
    if (!hubSpotCreatePreview) return [];
    const industryKeys = [
      "industry",
      "investment_sector",
      "what_industry_sector_do_you_operate_in___please_select_all_that_apply_",
    ] as const;
    const tamKeys = ["what_is_the_tam___sam___som_of_your_business_", "tam"] as const;
    const selectedIndustryKey =
      industryKeys.find((key) => {
        const value = String(companyDraftProperties[key] || "").trim();
        return value.length > 0;
      }) ||
      industryKeys.find((key) => key in companyDraftProperties) ||
      "industry";
    const selectedTamKey = tamKeys.find((key) => key in companyDraftProperties) || "what_is_the_tam___sam___som_of_your_business_";
    return COMPANY_FIELD_PRIORITY
      .filter((key) => !industryKeys.includes(key as any) || key === selectedIndustryKey)
      .filter((key) => !tamKeys.includes(key as any) || key === selectedTamKey)
      .map((key) => [key, companyDraftProperties[key] || ""]);
  };

  const getVisibleHubSpotCreateFieldEntries = (): Array<{ objectType: "company" | "deal"; key: string; value: string }> => {
    const seen = new Set<string>();
    const combined: Array<{ objectType: "company" | "deal"; key: string; value: string }> = [];
    const shouldCreateCompany = hubSpotCreatePreview?.createCompany !== false;
    const companyFieldKeys = new Set<string>(Object.keys(companyDraftProperties || {}));
    const dealOnlyAllowedKeys = new Set<string>([
      "dealname",
      "pipeline",
      "dealstage",
      "deal_bucket",
      "hubspot_owner_id",
      "hs_all_collaborator_owner_ids",
      "deal_lead",
      "deal_source_list",
      "dealtype",
      "hs_priority",
      "deal_source",
      "original_mudita_source",
      "amount",
      "raise_amount",
      "committed_funding",
      "deal_valuation",
      "deal_terms",
      "current_runway",
      "post_runway_funding",
      "closed_lost_reason",
      "closed_lost_reason_notes",
      "round_still_open",
    ]);
    const selectedDealStage = (dealDraftProperties.dealstage || "").trim().toLowerCase();
    const selectedDealStageLabel = (hubspotDealFieldOptions.dealstage || [])
      .find((option) => option.value === dealDraftProperties.dealstage)?.label?.toLowerCase() || "";
    const selectedStageTokens = new Set([selectedDealStage, selectedDealStageLabel].filter(Boolean));
    const parseVisibleStages = (notes?: string): string[] => {
      const raw = String(notes || "");
      const marker = raw.match(/(?:visible_stages|stage_visibility|stages)\s*[:=]\s*([^\n\r]+)/i);
      if (!marker?.[1]) return [];
      return marker[1]
        .split(/[|,;]/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
    };
    const shouldShowFieldForStage = (objectType: "company" | "deal", key: string): boolean => {
      if (objectType !== "deal") return true;
      if (!selectedDealStage) return true;
      const fieldMeta = hubSpotCreatePreview?.deal.fields.find((field) => field.hubspotProperty === key);
      const visibleStages = parseVisibleStages(fieldMeta?.notes);
      if (visibleStages.length === 0) return true;
      return visibleStages.some((stage) => selectedStageTokens.has(stage));
    };
    const canonicalKey = (objectType: "company" | "deal", key: string): string => {
      if (key === "dealname") return "name";
      // Keep company/deal owner visible as separate controls.
      if (key === "hubspot_owner_id") return `${objectType}:${key}`;
      return key;
    };
    if (shouldCreateCompany) {
      for (const [key, value] of getVisibleCompanyFieldEntries()) {
        const canonical = canonicalKey("company", key);
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        combined.push({ objectType: "company", key, value });
      }
    }
    for (const [key, value] of Object.entries(dealDraftProperties).filter(([dealKey]) => !HIDDEN_DEAL_FIELD_KEYS.has(dealKey))) {
      if (!shouldCreateCompany && companyFieldKeys.has(key) && !dealOnlyAllowedKeys.has(key)) continue;
      const canonical = canonicalKey("deal", key);
      if (seen.has(canonical)) continue;
      if (!closeDealAfterCreate && CLOSED_LOST_WORKFLOW_FIELD_KEYS.has(key)) continue;
      if (closeDealAfterCreate && REJECT_FLOW_HIDDEN_FIELD_KEYS.has(key)) continue;
      if (!(closeDealAfterCreate && (key === "dealstage" || REJECT_FLOW_FORCE_VISIBLE_FIELD_KEYS.has(key))) && !shouldShowFieldForStage("deal", key)) continue;
      seen.add(canonical);
      combined.push({ objectType: "deal", key, value: value || "" });
    }
    const rejectOrderIndex = new Map<string, number>();
    REJECT_FLOW_FIELD_ORDER.forEach((token, idx) => rejectOrderIndex.set(token, idx));
    return combined
      .map((entry, idx) => {
        const fieldMeta = (entry.objectType === "company" ? hubSpotCreatePreview?.company.fields : hubSpotCreatePreview?.deal.fields)
          ?.find((field) => field.hubspotProperty === entry.key);
        const rejectToken = `${entry.objectType}:${entry.key}`;
        const rejectRank = rejectOrderIndex.has(rejectToken)
          ? (rejectOrderIndex.get(rejectToken) as number)
          : Number.POSITIVE_INFINITY;
        return {
          ...entry,
          _idx: idx,
          _uiOrder: typeof fieldMeta?.uiOrder === "number" ? fieldMeta.uiOrder : Number.POSITIVE_INFINITY,
          _rejectRank: rejectRank,
          _stageTopRank: entry.objectType === "deal" && entry.key === "dealstage" ? -1 : 0,
        };
      })
      .sort((a, b) => {
        if (closeDealAfterCreate) {
          return (a._rejectRank - b._rejectRank) || (a._idx - b._idx);
        }
        return (a._stageTopRank - b._stageTopRank) || (a._uiOrder - b._uiOrder) || (a._idx - b._idx);
      })
      .map(({ _idx, _uiOrder, _rejectRank, _stageTopRank, ...entry }) => entry);
  };

  const parseFeedbackLines = (value: string): string[] =>
    Array.from(
      new Set(
        value
          .split("\n")
          .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
          .filter(Boolean)
      )
    ).slice(0, 8);

  const stripThesisTag = (line: string): string =>
    String(line || "")
      .replace(/\[(pillar|dealbreaker):\s*[a-z0-9_\- ]+\]\s*/gi, "")
      .replace(/\s+/g, " ")
      .trim();

  const sanitizeThesisLinesForDisplay = (lines: string[] = []): string[] =>
    lines
      .map((line) => stripThesisTag(line))
      .filter(Boolean);

  const buildFeedbackPayload = (baseThesis: ThesisFitResult) => ({
    reviewerFit: reviewerFitDraft || baseThesis.fit,
    reviewerConfidence: String(baseThesis.confidence ?? ""),
    reviewerWhyFits: parseFeedbackLines(reviewerWhyFitsDraft).length > 0
      ? parseFeedbackLines(reviewerWhyFitsDraft)
      : (baseThesis.whyFits || []),
    reviewerWhyNotFit: parseFeedbackLines(reviewerWhyNotFitDraft).length > 0
      ? parseFeedbackLines(reviewerWhyNotFitDraft)
      : (baseThesis.whyNotFit || []),
    reviewerEvidenceGaps: (baseThesis.evidenceGaps || []),
    reviewerCruxQuestion: reviewerCruxQuestionDraft.trim() || baseThesis.cruxQuestion || "",
    reviewerNotes: reviewerNotesDraft.trim(),
    chatgptAssessment: chatgptAssessmentDraft.trim(),
    appAssessmentNotes: `Thesis First Pass: ${thesisFitLabel(baseThesis.fit)}`,
    appThesisFitSnapshot: baseThesis,
  });

  const computeFeedbackSignature = (payload: ReturnType<typeof buildFeedbackPayload>): string =>
    JSON.stringify({
      reviewerFit: payload.reviewerFit,
      reviewerConfidence: payload.reviewerConfidence,
      reviewerWhyFits: payload.reviewerWhyFits,
      reviewerWhyNotFit: payload.reviewerWhyNotFit,
      reviewerEvidenceGaps: payload.reviewerEvidenceGaps,
      reviewerCruxQuestion: payload.reviewerCruxQuestion,
      reviewerNotes: payload.reviewerNotes,
      chatgptAssessment: payload.chatgptAssessment,
    });

  const ensureFirstPassFeedbackSaved = async (): Promise<void> => {
    if (!diligenceId || !thesisFirstResult || !enableScoringFeedback) return;
    const payload = buildFeedbackPayload(thesisFirstResult);
    const signature = computeFeedbackSignature(payload);
    if (signature === lastAutoFeedbackSignature) {
      return;
    }

    const response = await fetch(`/api/diligence/${diligenceId}/thesis-fit-feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || "Failed to auto-save thesis feedback");
    }
    const savedAt = data?.entry?.createdAt ? String(data.entry.createdAt) : new Date().toISOString();
    setThesisFeedbackSavedAt(savedAt);
    setLastAutoFeedbackSignature(signature);
    setThesisFeedbackSuccess(`Saved feedback example at ${new Date(savedAt).toLocaleString()}.`);
  };

  const extractDomain = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
      const normalized = trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? trimmed
        : `https://${trimmed}`;
      return new URL(normalized).hostname.replace(/^www\./i, "");
    } catch {
      return trimmed.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
    }
  };

  const extractHubSpotDealId = (value: string): string => {
    const input = value.trim();
    if (!input) return "";
    const match = input.match(/\/(?:deal|deals)\/(\d+)/i) || input.match(/\b(\d{6,})\b/);
    return match?.[1] || "";
  };

  const buildHubSpotDealUrl = (dealId: string): string => {
    const id = dealId.trim();
    if (!id) return "";
    return `https://app.hubspot.com/contacts/21880552/deal/${id}`;
  };

  const closeHubSpotMatchModal = () => {
    setShowHubSpotMatchModal(false);
    setPendingStartMode(null);
    setPendingNormalizedCompanyUrl("");
    setManualHubSpotDealLink("");
    setManualHubSpotLookupError(null);
  };

  const hydrateManualHubSpotDeal = async (): Promise<HubSpotDealLookup | null> => {
    const dealId = extractHubSpotDealId(manualHubSpotDealLink);
    if (!dealId) {
      setManualHubSpotLookupError("Paste a valid HubSpot deal URL or numeric deal id.");
      return null;
    }

    setManualHubSpotLookupLoading(true);
    setManualHubSpotLookupError(null);
    try {
      const response = await fetch(`/api/hubspot/deal?dealId=${encodeURIComponent(dealId)}`);
      const data = await response.json();
      if (!data.success || !data.deal) {
        throw new Error(data.error || "Unable to find that HubSpot deal");
      }
      const deal = data.deal as HubSpotDealLookup;
      setSelectedHubspotDeal(deal);
      await hydrateFromHubSpotDeal(deal);
      return deal;
    } catch (err) {
      setManualHubSpotLookupError(err instanceof Error ? err.message : "Unable to find that HubSpot deal");
      return null;
    } finally {
      setManualHubSpotLookupLoading(false);
    }
  };

  const handleDiscoverHubSpot = async () => {
    setHubspotLookupError(null);
    setHubspotCandidates([]);
    setSelectedHubspotDeal(null);

    const domain = extractDomain(companyUrl);
    const query = companyName.trim() || domain;
    if (!query) {
      setHubspotLookupError("Enter a company name or domain before searching HubSpot.");
      return;
    }

    setDiscoveringHubSpot(true);
    try {
      const response = await fetch(`/api/hubspot/search-deals?query=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to search HubSpot records");
      }
      setHubspotCandidates(Array.isArray(data.deals) ? data.deals : []);
      if (!data.deals || data.deals.length === 0) {
        setHubspotLookupError("No matching HubSpot deals found.");
      }
    } catch (err) {
      setHubspotLookupError(err instanceof Error ? err.message : "Failed to search HubSpot records");
    } finally {
      setDiscoveringHubSpot(false);
    }
  };

  const hydrateFromHubSpotDeal = async (deal: HubSpotDealLookup) => {
    if (!deal.id) return;
    setLoadingHubspotCompany(true);
    try {
      const response = await fetch(`/api/hubspot/deal-company?dealId=${encodeURIComponent(deal.id)}`);
      const data = await response.json();
      if (!data.success || !data.company) return;

      const company = data.company as {
        website?: string;
      };

      if (!companyUrl.trim() && company.website?.trim()) {
        setCompanyUrl(normalizeCompanyUrlInput(company.website.trim()));
      }
    } catch (err) {
      console.warn("Failed to hydrate company data from HubSpot deal:", err);
    } finally {
      setLoadingHubspotCompany(false);
    }
  };

  const openHubSpotCreateReview = async (newDiligenceId: string): Promise<boolean> => {
    try {
      setHubSpotCreateError(null);
      setHubSpotCreateLoading(true);
      const response = await fetch("/api/hubspot/create/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diligenceId: newDiligenceId }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to build HubSpot create preview");
      }
      if (data.linked || data.alreadyLinkedDealId) {
        return false;
      }
      const preview = data.preview as HubSpotCreatePreview;
      const nextCompanyDraft = { ...(preview.company.properties || {}) };
      const rawIndustry = String(nextCompanyDraft.industry || "").trim();
      const normalizedIndustry = rawIndustry
        ? mapIndustryGuessToOptionValue(rawIndustry, hubspotIndustryOptions)
        : "";
      if (normalizedIndustry) {
        nextCompanyDraft.industry = normalizedIndustry;
      } else if (!rawIndustry) {
        const fallbackIndustry = chooseIndustryValue(nextCompanyDraft);
        if (fallbackIndustry) nextCompanyDraft.industry = fallbackIndustry;
      }
      setHubSpotCreatePreview(preview);
      setCompanyDraftProperties(nextCompanyDraft);
      setDealDraftProperties(preview.deal.properties || {});
      setShowHubSpotCreateModal(true);
      return true;
    } catch (err) {
      console.warn("Failed to prepare HubSpot create review:", err);
      setHubSpotCreateError(err instanceof Error ? err.message : "Failed to prepare HubSpot create review");
      return false;
    } finally {
      setHubSpotCreateLoading(false);
    }
  };

  const updateDraftProperty = (
    objectType: "company" | "deal",
    key: string,
    value: string
  ) => {
    if (objectType === "company") {
      setCompanyDraftProperties((prev) => {
        const next = { ...prev, [key]: value };
        if (key === "website") {
          const domain = extractDomain(value);
          if (domain) next.domain = domain;
        }
        return next;
      });
      return;
    }
    setDealDraftProperties((prev) => ({ ...prev, [key]: value }));
  };

  const handleHubSpotCreateModalDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a")) return;
    hubspotCreateModalDragRef.current.dragging = true;
    hubspotCreateModalDragRef.current.startX = event.clientX;
    hubspotCreateModalDragRef.current.startY = event.clientY;
    hubspotCreateModalDragRef.current.originX = hubspotCreateModalOffset.x;
    hubspotCreateModalDragRef.current.originY = hubspotCreateModalOffset.y;
  };

  const handleCommitHubSpotCreate = async () => {
    if (!diligenceId) return;
    try {
      if (closeDealAfterCreate && !String(dealDraftProperties.round_still_open || "").trim()) {
        setHubSpotCreateError("Round Still Open is required when rejecting a deal.");
        return;
      }
      if (thesisFirstResult) {
        setSavingThesisFeedback(true);
        setThesisFeedbackError(null);
        await ensureFirstPassFeedbackSaved();
        setSavingThesisFeedback(false);
      }
      setHubSpotCreateSaving(true);
      setHubSpotCreateError(null);
      const response = await fetch("/api/hubspot/create/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diligenceId,
          companyProperties: companyDraftProperties,
          dealProperties: dealDraftProperties,
        }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to create HubSpot records");
      }
      if (data.dealId) {
        setCreatedHubspotDealId(String(data.dealId));
      }
      if (stageSevenAfterCreate && data.dealId) {
        await moveLinkedDealToStageSeven(String(data.dealId));
      }
      setShowHubSpotCreateModal(false);
      setStageSevenAfterCreate(false);
      setCloseDealAfterCreate(false);
      if (closeDealAfterCreate) {
        router.push("/diligence");
      } else {
        router.push(`/diligence/${diligenceId}`);
      }
    } catch (err) {
      setSavingThesisFeedback(false);
      setHubSpotCreateError(err instanceof Error ? err.message : "Failed to create HubSpot records");
    } finally {
      setHubSpotCreateSaving(false);
    }
  };

  const getLikelyRejectedStage = async (): Promise<{ id: string; label: string } | null> => {
    const response = await fetch("/api/hubspot/stages");
    const data = await response.json();
    if (!data.success || !Array.isArray(data.pipelines)) return null;
    const stages = data.pipelines.flatMap((pipeline: { stages?: Array<{ id: string; label: string }> }) => pipeline.stages || []);
    if (!stages.length) return null;

    const normalized: { id: string; label: string; lower: string }[] = stages.map((stage: { id: string; label: string }) => ({
      ...stage,
      label: String(stage.label || "").trim(),
      lower: String(stage.label || "").trim().toLowerCase(),
    }));

    const explicitRejected =
      normalized.find((stage) => /^deal\s*7\s*:\s*deal\s*rejected$/i.test(stage.label)) ||
      normalized.find((stage) => /^deal\s*7\s*:\s*rejected$/i.test(stage.label)) ||
      normalized.find((stage) => /^deal\s*7\s*:/i.test(stage.label) && /\b(reject|rejected|closed\s*lost|lost|pass(ed)?)\b/i.test(stage.label));
    if (explicitRejected) return { id: explicitRejected.id, label: explicitRejected.label };

    const closedLost = normalized.find((stage) => /\b(closed\s*lost|lost|deal\s*rejected|do\s*not\s*invest|pass(ed)?)\b/i.test(stage.label));
    if (closedLost) return { id: closedLost.id, label: closedLost.label };

    // Defensive fallback: if we only have stage-7 labels, avoid any won/deploy stage.
    const stageSevenNonWon = normalized.find(
      (stage) =>
        /\b(deal|stage)\s*7\b/i.test(stage.label) &&
        !/\b(won|close\s*win|deploy\s*funds)\b/i.test(stage.label)
    );
    if (stageSevenNonWon) return { id: stageSevenNonWon.id, label: stageSevenNonWon.label };

    return null;
  };

  const moveLinkedDealToStageSeven = async (explicitDealId?: string) => {
    if (!diligenceId) return;
    const targetDealId = explicitDealId || createdHubspotDealId || selectedHubspotDeal?.id;
    if (!targetDealId) {
      setError("No HubSpot deal is linked yet. Link or create a deal first.");
      return;
    }

    setMovingToStageSeven(true);
    setError(null);
    try {
      const rejectedStage = await getLikelyRejectedStage();
      if (!rejectedStage) {
        throw new Error("Could not identify Deal 7: Rejected in HubSpot pipeline settings.");
      }

      const response = await fetch(`/api/diligence/${diligenceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hubspotDealId: targetDealId,
          hubspotDealStageId: rejectedStage.id,
          hubspotDealStageLabel: rejectedStage.label,
          hubspotDealStageProperties: {
            closed_lost_reason: dealDraftProperties.closed_lost_reason || "",
            closed_lost_reason_notes: dealDraftProperties.closed_lost_reason_notes || "",
            round_still_open: dealDraftProperties.round_still_open || "",
            closedate: new Date().toISOString().slice(0, 10),
            dealtype: dealDraftProperties.dealtype || "New Investment",
          },
        }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to move HubSpot deal to Stage 7");
      }
      setDecisionMessage(`Moved HubSpot deal to ${rejectedStage.label}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move HubSpot deal to Stage 7");
    } finally {
      setMovingToStageSeven(false);
    }
  };

  const runThesisFirstPass = async (targetDiligenceId: string): Promise<ThesisFitResult> => {
    setRunningThesisFirst(true);
    setUploadProgress("Running thesis-first pass...");
    const response = await fetch(`/api/diligence/${targetDiligenceId}/thesis-first`, {
      method: "POST",
    });
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || "Failed to run thesis-first pass");
    }
    if (Array.isArray(data.documentWarnings) && data.documentWarnings.length > 0) {
      setDocumentReadWarning(data.documentWarnings.slice(0, 3).join(" "));
    }
    return data.thesisFit as ThesisFitResult;
  };

  const runFullScoring = async (targetDiligenceId: string, linkedDuringCreate: boolean) => {
    setScoring(true);
    let progressIndex = 0;
    setUploadProgress(SCORE_PROGRESS_STEPS[progressIndex]);
    const scoreProgressTimer: ReturnType<typeof setInterval> = setInterval(() => {
      progressIndex = Math.min(progressIndex + 1, SCORE_PROGRESS_STEPS.length - 1);
      setUploadProgress(SCORE_PROGRESS_STEPS[progressIndex]);
    }, 7000);

    try {
      const scoreResponse = await fetch("/api/diligence/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diligenceId: targetDiligenceId,
        }),
      });

      const scoreData = await scoreResponse.json();
      if (!scoreData.success) {
        throw new Error(scoreData.error || "Failed to score diligence");
      }
      if (Array.isArray(scoreData.documentWarnings) && scoreData.documentWarnings.length > 0) {
        setDocumentReadWarning(scoreData.documentWarnings.slice(0, 3).join(" "));
      }
      setUploadProgress("Scoring complete!");
    } finally {
      clearInterval(scoreProgressTimer);
      setScoring(false);
    }

    const shouldOpenHubSpotCreateReview = !linkedDuringCreate;
    if (shouldOpenHubSpotCreateReview) {
      setUploadProgress("Scoring complete. Review HubSpot create fields...");
      const opened = await openHubSpotCreateReview(targetDiligenceId);
      if (opened) return;
      setDecisionMessage("HubSpot create preview was unavailable. You can open it from the detail page.");
    } else {
      setDecisionMessage("HubSpot deal already linked, so create preview was skipped.");
    }

    setTimeout(() => {
      router.push(`/diligence/${targetDiligenceId}`);
    }, 300);
  };

  const deleteDraftRecordAndExit = async () => {
    if (!diligenceId) {
      router.push("/diligence");
      return;
    }
    const response = await fetch(`/api/diligence/${diligenceId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderAction: "keep" }),
    });
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || "Failed to delete draft diligence record");
    }
    router.push("/diligence");
  };

  const handleExitFromFirstPass = async () => {
    const hasUnsavedFeedbackDraft =
      enableScoringFeedback &&
      showThesisFeedbackForm &&
      !thesisFeedbackSavedAt &&
      Boolean(
        reviewerWhyFitsDraft.trim() ||
        reviewerWhyNotFitDraft.trim() ||
        reviewerCruxQuestionDraft.trim() ||
        reviewerNotesDraft.trim() ||
        chatgptAssessmentDraft.trim()
      );

    if (hasUnsavedFeedbackDraft) {
      const leaveWithoutSaving = window.confirm(
        "You have unsaved feedback notes. Leave without saving?"
      );
      if (!leaveWithoutSaving) return;
    }

    try {
      setSavingThesisFeedback(true);
      setThesisFeedbackError(null);
      await ensureFirstPassFeedbackSaved();
    } catch (err) {
      setSavingThesisFeedback(false);
      setThesisFeedbackError(err instanceof Error ? err.message : "Failed to auto-save feedback");
      return;
    }
    setSavingThesisFeedback(false);

    const shouldDelete = window.confirm(
      "Delete this newly created draft diligence record before leaving?\n\nChoose OK to delete it, or Cancel to keep it."
    );
    if (!shouldDelete) {
      router.push(`/diligence/${diligenceId}`);
      return;
    }
    try {
      await deleteDraftRecordAndExit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete draft diligence record");
    }
  };

  const validateStartInputs = (): string | null => {
    setError(null);
    setDocsendIngestWarning(null);
    setDocumentReadWarning(null);
    setShowThesisDecisionPanel(false);
    setThesisFirstResult(null);
    setDecisionMessage(null);
    const normalizedCompanyUrl = normalizeCompanyUrlInput(companyUrl);

    if (!companyName.trim()) {
      setError("Please enter a company name");
      return null;
    }

    if (companyUrl.trim() && !isValidHttpUrl(normalizedCompanyUrl)) {
      setError("Please enter a valid website URL");
      return null;
    }

    if (!normalizedCompanyUrl) {
      setError("Please enter a company website");
      return null;
    }

    return normalizedCompanyUrl;
  };

  const executeCreateFlow = async (mode: StartMode, normalizedCompanyUrl: string, linkedDealOverride?: HubSpotDealLookup | null) => {
    const linkedDeal = linkedDealOverride ?? selectedHubspotDeal;
    if (isPotentialDuplicateHubSpotStage(linkedDeal)) {
      const proceed = window.confirm(
        `The linked HubSpot deal appears to be in a late/final stage (${linkedDeal?.stageLabel || linkedDeal?.stageId || "unknown stage"}).\n\nThis may indicate a duplicate diligence record.\n\nDo you still want to create a new diligence record?`
      );
      if (!proceed) {
        return;
      }
    }

    try {
      setUploading(true);
      setUploadProgress("Creating diligence record...");

      const createResponse = await fetch("/api/diligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          companyName: companyName.trim(),
          companyUrl: normalizedCompanyUrl || undefined,
          categorizedNotes,
          hubspotDealId: linkedDeal?.id,
        }),
      });

      const createData = await createResponse.json();
      if (!createData.success) {
        throw new Error(createData.error || "Failed to create diligence record");
      }

      const newDiligenceId = createData.record.id;
      setDiligenceId(newDiligenceId);

      // Step 2: Upload documents and add links (if any)
      if (files.length > 0 || links.length > 0) {
        const totalItems = files.length + links.length;
        setUploadProgress(`Processing ${totalItems} item${totalItems > 1 ? 's' : ''}...`);
        
        const formData = new FormData();
        formData.append("diligenceId", newDiligenceId);
        formData.append("companyName", companyName.trim());
        
        // Add links as JSON
        if (links.length > 0) {
          formData.append("documentLinks", JSON.stringify(links));
        }
        
        files.forEach(file => {
          formData.append("files", file);
        });

        const uploadResponse = await fetch("/api/diligence/upload", {
          method: "POST",
          body: formData,
        });

        const uploadData = await uploadResponse.json();
        if (!uploadData.success) {
          throw new Error(uploadData.error || "Failed to upload documents");
        }
        if (Array.isArray(uploadData.errors) && uploadData.errors.length > 0) {
          setDocumentReadWarning(uploadData.errors.slice(0, 3).join(" "));
        }

        const failedDocsendLinks = Array.isArray(uploadData.documents)
          ? uploadData.documents.filter((doc: any) => {
              const url = String(doc?.externalUrl || "");
              return (
                /docsend\.com/i.test(url) &&
                (doc?.fileType === "link" || doc?.fileType === "url") &&
                doc?.linkIngestStatus !== "ingested"
              );
            })
          : [];
        if (failedDocsendLinks.length > 0) {
          const firstFailure = failedDocsendLinks[0];
          const failureMessage = String(firstFailure?.linkIngestMessage || "Unable to parse DocSend content.");
          setDocsendIngestWarning(
            failedDocsendLinks.length === 1
              ? `DocSend warning: "${firstFailure?.name || "Document link"}" did not ingest and won't be used in thesis/scoring until fixed. ${failureMessage}`
              : `DocSend warning: ${failedDocsendLinks.length} DocSend links did not ingest and won't be used in thesis/scoring until fixed.`
          );
        }

        setUploadProgress("Documents uploaded successfully!");
      }
      
      setUploading(false);

      setCreatedHubspotDealId(createData.record?.hubspotDealId || null);
      if (mode === "thesis") {
        const firstPass = await runThesisFirstPass(newDiligenceId);
        setThesisFirstResult(firstPass);
        setDecisionMessage(null);
        setShowThesisDecisionPanel(true);
        setUploadProgress("Thesis-first pass complete. Review and decide whether to continue.");
        setUploading(false);
        setRunningThesisFirst(false);
        return;
      }

      const linkedDuringCreate = Boolean(createData.record?.hubspotDealId || linkedDeal?.id);
      await runFullScoring(newDiligenceId, linkedDuringCreate);
      return;

    } catch (err) {
      console.error("Error creating diligence:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
      setUploading(false);
      setScoring(false);
      setRunningThesisFirst(false);
    }
  };

  const startThesisCheckFlow = async () => {
    const normalizedCompanyUrl = validateStartInputs();
    if (!normalizedCompanyUrl) return;
    const shouldProceed = await confirmNotDuplicateDiligence(normalizedCompanyUrl);
    if (!shouldProceed) return;
    setPendingStartMode("thesis");
    setPendingNormalizedCompanyUrl(normalizedCompanyUrl);
    setShowHubSpotMatchModal(true);
    await handleDiscoverHubSpot();
  };

  const startFullScoringFlow = async () => {
    if (showThesisDecisionPanel && diligenceId) {
      try {
        if (thesisFirstResult) {
          setSavingThesisFeedback(true);
          setThesisFeedbackError(null);
          await ensureFirstPassFeedbackSaved();
          setSavingThesisFeedback(false);
        }
        const alreadyLinkedDeal = Boolean(createdHubspotDealId || selectedHubspotDeal?.id);
        await runFullScoring(diligenceId, alreadyLinkedDeal);
      } catch (err) {
        setSavingThesisFeedback(false);
        setError(err instanceof Error ? err.message : "Failed to continue from thesis check");
      }
      return;
    }
    const normalizedCompanyUrl = validateStartInputs();
    if (!normalizedCompanyUrl) return;
    const shouldProceed = await confirmNotDuplicateDiligence(normalizedCompanyUrl);
    if (!shouldProceed) return;
    setPendingStartMode("full");
    setPendingNormalizedCompanyUrl(normalizedCompanyUrl);
    setShowHubSpotMatchModal(true);
    await handleDiscoverHubSpot();
  };

  const handleCloseDealAfterThesis = async () => {
    if (!diligenceId || !thesisFirstResult) return;
    try {
      setDecisionMessage("Saving feedback before closing deal...");
      setSavingThesisFeedback(true);
      setThesisFeedbackError(null);
      await ensureFirstPassFeedbackSaved();
      setSavingThesisFeedback(false);

      if (createdHubspotDealId || selectedHubspotDeal?.id) {
        setDecisionMessage("Moving linked HubSpot deal to Stage 7...");
        await moveLinkedDealToStageSeven();
        router.push("/diligence");
        return;
      }

      setDecisionMessage("Preparing HubSpot close-deal fields...");
      setStageSevenAfterCreate(true);
      setCloseDealAfterCreate(true);
      const opened = await openHubSpotCreateReview(diligenceId);
      if (!opened) {
        setStageSevenAfterCreate(false);
        setCloseDealAfterCreate(false);
        setError("Unable to open HubSpot create flow.");
      }
    } catch (err) {
      setSavingThesisFeedback(false);
      setError(err instanceof Error ? err.message : "Failed to close deal");
    }
  };

  const confirmHubSpotMatchAndRun = async () => {
    if (!pendingStartMode) return;
    let linkedDeal = selectedHubspotDeal;
    const manualDealId = extractHubSpotDealId(manualHubSpotDealLink);
    if (manualDealId && (!selectedHubspotDeal || selectedHubspotDeal.id !== manualDealId)) {
      const fetched = await hydrateManualHubSpotDeal();
      if (!fetched) {
        return;
      }
      linkedDeal = fetched;
    }
    const normalizedCompanyUrl = pendingNormalizedCompanyUrl || normalizeCompanyUrlInput(companyUrl);
    const mode = pendingStartMode;
    closeHubSpotMatchModal();
    await executeCreateFlow(mode, normalizedCompanyUrl, linkedDeal);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await startFullScoringFlow();
  };

  const isProcessing = uploading || scoring || runningThesisFirst || movingToStageSeven;
  const actionStatusMessage =
    savingThesisFeedback
      ? "Saving thesis feedback..."
      : scoring
        ? uploadProgress || "Running full scoring..."
        : runningThesisFirst
          ? uploadProgress || "Running thesis-first pass..."
          : movingToStageSeven
            ? "Moving linked deal to Stage 7..."
            : hubSpotCreateLoading
              ? "Preparing HubSpot create form..."
              : hubSpotCreateSaving
                ? "Creating HubSpot records..."
                : null;

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Diligence New Company</h1>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Single Card Layout - Fits on one page */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="space-y-5">
              <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
                <h2 className="text-sm font-semibold text-gray-900">Company Details</h2>
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Company Name *
                    </label>
                    <input
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      disabled={isProcessing}
                      placeholder="Enter company name"
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Company Website *
                    </label>
                    <input
                      type="text"
                      value={companyUrl}
                      onChange={(e) => setCompanyUrl(e.target.value)}
                      onBlur={() => {
                        if (companyUrl.trim()) {
                          setCompanyUrl(normalizeCompanyUrlInput(companyUrl));
                        }
                      }}
                      disabled={isProcessing}
                      placeholder="example.com or https://example.com"
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
                <h2 className="text-sm font-semibold text-gray-900">Documents & Links</h2>
                <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Document Links
                    </label>
                    
                    <button
                      type="button"
                      onClick={() => setAddingLink(true)}
                      disabled={isProcessing}
                      className="w-full flex items-center justify-center gap-2 rounded-md border-2 border-dashed border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Add Document Link
                    </button>

                  {/* Add Link Form */}
                  {addingLink && (
                    <div className="mt-2 p-3 bg-blue-50 rounded-md border border-blue-200">
                      <div className="space-y-2">
                        <input
                          type="text"
                          placeholder="Link Name (e.g., 'Pitch Deck' or 'Founder Call')"
                          value={linkName}
                          onChange={(e) => setLinkName(e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          autoFocus
                        />
                        <input
                          type="url"
                          placeholder="URL (e.g., 'https://example.com/deck.pdf')"
                          value={linkUrl}
                          onChange={(e) => setLinkUrl(e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <input
                          type="email"
                          placeholder="Access Email (for DocSend/email-gated links)"
                          value={linkEmail}
                          onChange={(e) => setLinkEmail(e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handleAddLink}
                            disabled={!linkName.trim() || !linkUrl.trim()}
                            className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            Add Link
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAddingLink(false);
                              setLinkName("");
                              setLinkUrl("");
                              setLinkEmail("");
                            }}
                            className="flex-1 rounded-md bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                    {/* Links List */}
                    {links.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {links.map((link, index) => (
                          <div
                            key={index}
                            className="rounded border border-gray-200 bg-white px-2 py-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                <ExternalLink className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                                <span className="text-xs text-gray-700 truncate font-medium">{link.name}</span>
                              </div>
                              {!isProcessing && (
                                <button
                                  type="button"
                                  onClick={() => removeLink(index)}
                                  className="text-red-600 hover:text-red-800 ml-2 flex-shrink-0"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                            {link.email && (
                              <div className="mt-1 text-xs text-gray-500 ml-5">
                                Access email: <span className="font-mono">{link.email}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Upload Documents
                    </label>
                    
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center bg-white hover:border-gray-400 transition-colors">
                      <Upload className="mx-auto h-8 w-8 text-gray-400" />
                      <div className="mt-2">
                        <label className="cursor-pointer">
                          <span className="text-sm font-medium text-blue-600 hover:text-blue-700">
                            Click to upload
                          </span>
                          <input
                            type="file"
                            multiple
                            onChange={handleFileChange}
                            disabled={isProcessing}
                            accept=".pdf,.docx,.pptx,.ppt,.xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg"
                            className="hidden"
                          />
                        </label>
                        <p className="mt-1 text-xs text-gray-500">
                          PDF, PPT, Word, Excel, images
                        </p>
                      </div>
                    </div>

                    {/* File List */}
                    {files.length > 0 && (
                      <div className="mt-3 space-y-1.5 max-h-32 overflow-y-auto">
                        {files.map((file, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between rounded border border-gray-200 bg-white px-2 py-1.5"
                          >
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <FileText className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                              <span className="text-xs text-gray-700 truncate">{file.name}</span>
                            </div>
                            {!isProcessing && (
                              <button
                                type="button"
                                onClick={() => removeFile(index)}
                                className="text-red-600 hover:text-red-800 text-xs ml-2 flex-shrink-0"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            <div>
              <div className="rounded-md border border-gray-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">
                    Notes
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsAddingNote(true)}
                    disabled={isProcessing}
                    className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                    Add Note
                  </button>
                </div>
                <CategorizedNotes
                  notes={categorizedNotes}
                  categories={noteCategories}
                  onNotesChange={setCategorizedNotes}
                  onSave={() => {}}
                  saving={false}
                  isAdding={isAddingNote}
                  onAddNote={() => setIsAddingNote(false)}
                  showSaveButton={false}
                  showEmptyMessage={false}
                />
              </div>
            </div>
            </div>
          </div>

          {/* Progress Message */}
          {isProcessing && uploadProgress && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <div className="flex items-center gap-3">
                <LoadingSpinner />
                <p className="text-sm text-blue-800">{uploadProgress}</p>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-red-800">Error</h3>
                  <p className="mt-1 text-sm text-red-700">{error}</p>
                  
                  {/* Special handling for Google setup errors */}
                  {(error.includes('Google credentials') || error.includes('placeholder values')) && (
                    <div className="mt-3 p-3 bg-white rounded border border-red-300">
                      <p className="text-xs font-semibold text-red-900 mb-2">📋 Setup Required:</p>
                      <ol className="text-xs text-red-800 space-y-1 list-decimal list-inside">
                        <li>Follow <code className="bg-red-100 px-1 rounded">DILIGENCE_SETUP_GUIDE.md</code></li>
                        <li>Set up Google Cloud service account</li>
                        <li>Update credentials in <code className="bg-red-100 px-1 rounded">.env.local</code></li>
                        <li>Restart dev server</li>
                      </ol>
                      <p className="mt-2 text-xs text-red-700">
                        See <code className="bg-red-100 px-1 rounded">GOOGLE_SETUP_REQUIRED.md</code> for details.
                      </p>
                    </div>
                  )}
                  
                  {/* Special handling for Shared Drive errors */}
                  {(error.includes('Service Accounts do not have storage quota') || error.includes('shared drives')) && (
                    <div className="mt-3 p-3 bg-white rounded border border-red-300">
                      <p className="text-xs font-semibold text-red-900 mb-2">🚨 Shared Drive Required:</p>
                      <p className="text-xs text-red-800 mb-2">
                        Service accounts cannot upload to regular Google Drive folders. You need a <strong>Shared Drive</strong>.
                      </p>
                      <ol className="text-xs text-red-800 space-y-1 list-decimal list-inside">
                        <li>Create a Shared Drive in Google Drive (requires Google Workspace)</li>
                        <li>Add your service account as a member with "Content Manager" permissions</li>
                        <li>Update <code className="bg-red-100 px-1 rounded">GOOGLE_DRIVE_FOLDER_ID</code> with the Shared Drive ID</li>
                        <li>Restart dev server</li>
                      </ol>
                      <p className="mt-2 text-xs text-red-700">
                        <strong>Alternative:</strong> Set <code className="bg-red-100 px-1 rounded">GOOGLE_DRIVE_FOLDER_ID=root</code> to use service account's own Drive.
                      </p>
                      <p className="mt-1 text-xs text-red-700">
                        See <code className="bg-red-100 px-1 rounded">SHARED_DRIVE_SETUP.md</code> for detailed instructions.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {docsendIngestWarning && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 text-amber-700" />
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-amber-900">DocSend ingest warning</h3>
                  <p className="mt-1 text-sm text-amber-800">{docsendIngestWarning}</p>
                </div>
              </div>
            </div>
          )}
          {documentReadWarning && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 text-amber-700" />
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-amber-900">Document readability warning</h3>
                  <p className="mt-1 text-sm text-amber-800">{documentReadWarning}</p>
                </div>
              </div>
            </div>
          )}

          {showThesisDecisionPanel && diligenceId && thesisFirstResult && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${thesisFitBadgeClass(thesisFirstResult.fit)}`}>
                    Thesis First Pass: {thesisFitLabel(thesisFirstResult.fit)}
                  </span>
                </div>
                <div />
              </div>
              <p className="mt-2 text-sm text-indigo-900">
                Review this first-pass thesis read.
              </p>
              {(thesisFirstResult.companyDescription || thesisFirstResult.problemSolving || thesisFirstResult.solutionApproach) && (
                <div className="mt-2 rounded border border-indigo-200 bg-white p-3">
                  <h4 className="text-xs font-semibold text-indigo-900">First-pass snapshot</h4>
                  <div className="mt-1 space-y-2">
                    <div>
                      <p className="text-[11px] font-semibold text-indigo-800">Company description</p>
                      <p className="text-xs text-indigo-900">
                        {thesisFirstResult.companyDescription || "Not enough evidence yet."}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-indigo-800">What problem are they solving?</p>
                      <p className="text-xs text-indigo-900">
                        {thesisFirstResult.problemSolving || "Not enough evidence yet."}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-indigo-800">How are they solving it?</p>
                      <p className="text-xs text-indigo-900">
                        {thesisFirstResult.solutionApproach || "Not enough evidence yet."}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {(thesisFirstResult.whyFits || []).length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-indigo-900">Why this fits</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-indigo-900">
                    {sanitizeThesisLinesForDisplay(thesisFirstResult.whyFits || []).slice(0, 3).map((line, idx) => (
                      <li key={`new-thesis-fit-${idx}`}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-2">
                <p className="text-xs font-semibold text-indigo-900">Why it might not be a fit</p>
                {sanitizeThesisLinesForDisplay(thesisFirstResult.whyNotFit || []).length > 0 ? (
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-indigo-900">
                    {sanitizeThesisLinesForDisplay(thesisFirstResult.whyNotFit || []).slice(0, 3).map((line, idx) => (
                      <li key={`new-thesis-notfit-${idx}`}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-indigo-800">
                    No direct thesis conflicts identified from currently available evidence.
                  </p>
                )}
              </div>
              {enableScoringFeedback && showThesisFeedbackForm && (
                <div className="mt-3 rounded border border-indigo-200 bg-white p-3">
                  <h4 className="text-xs font-semibold text-indigo-900">Thesis-first feedback</h4>
                  <p className="mt-1 text-[11px] text-indigo-800">
                    Save your judgment + ChatGPT reference so we can keep improving the model behavior.
                  </p>
                  {thesisFeedbackSavedAt && (
                    <p className="mt-1 text-[11px] font-medium text-green-700">
                      Last saved: {new Date(thesisFeedbackSavedAt).toLocaleString()}
                    </p>
                  )}
                  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                    <label className="text-[11px] font-semibold text-indigo-900">
                      Your fit decision
                      <select
                        value={reviewerFitDraft}
                        onChange={(e) => setReviewerFitDraft(e.target.value as ThesisFitResult["fit"])}
                        className="mt-1 w-full rounded border border-indigo-200 px-2 py-1 text-xs text-indigo-900"
                      >
                        <option value="on_thesis">On thesis</option>
                        <option value="mixed">Mixed</option>
                        <option value="off_thesis">Off thesis</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                    <label className="text-[11px] font-semibold text-indigo-900">
                      Why this fits (one per line)
                      <textarea
                        value={reviewerWhyFitsDraft}
                        onChange={(e) => setReviewerWhyFitsDraft(e.target.value)}
                        rows={3}
                        className="mt-1 w-full rounded border border-indigo-200 px-2 py-1 text-xs text-indigo-900"
                      />
                    </label>
                    <label className="text-[11px] font-semibold text-indigo-900">
                      Why it might not fit (one per line)
                      <textarea
                        value={reviewerWhyNotFitDraft}
                        onChange={(e) => setReviewerWhyNotFitDraft(e.target.value)}
                        rows={3}
                        className="mt-1 w-full rounded border border-indigo-200 px-2 py-1 text-xs text-indigo-900"
                      />
                    </label>
                    <label className="text-[11px] font-semibold text-indigo-900">
                      Crux question
                      <textarea
                        value={reviewerCruxQuestionDraft}
                        onChange={(e) => setReviewerCruxQuestionDraft(e.target.value)}
                        rows={3}
                        className="mt-1 w-full rounded border border-indigo-200 px-2 py-1 text-xs text-indigo-900"
                      />
                    </label>
                    <label className="text-[11px] font-semibold text-indigo-900 md:col-span-2">
                      ChatGPT assessment (optional)
                      <textarea
                        value={chatgptAssessmentDraft}
                        onChange={(e) => setChatgptAssessmentDraft(e.target.value)}
                        rows={4}
                        className="mt-1 w-full rounded border border-indigo-200 px-2 py-1 text-xs text-indigo-900"
                      />
                    </label>
                    <label className="text-[11px] font-semibold text-indigo-900 md:col-span-2">
                      Notes on app output (optional)
                      <textarea
                        value={reviewerNotesDraft}
                        onChange={(e) => setReviewerNotesDraft(e.target.value)}
                        rows={2}
                        className="mt-1 w-full rounded border border-indigo-200 px-2 py-1 text-xs text-indigo-900"
                      />
                    </label>
                  </div>
                  {thesisFeedbackError && <p className="mt-2 text-xs text-red-700">{thesisFeedbackError}</p>}
                  {thesisFeedbackSuccess && <p className="mt-2 text-xs text-green-700">{thesisFeedbackSuccess}</p>}
                  <p className="mt-2 text-[11px] text-indigo-700">
                    Feedback auto-saves when you continue with <strong>Reject Deal</strong> or <strong>Score Company</strong>.
                  </p>
                </div>
              )}
              {decisionMessage && <p className="mt-2 text-xs font-medium text-green-700">{decisionMessage}</p>}
              {actionStatusMessage && !(isProcessing && uploadProgress) && (
                <div className="mt-2 inline-flex items-center gap-2 rounded border border-indigo-200 bg-white px-2 py-1.5 text-xs text-indigo-800">
                  <LoadingSpinner />
                  <span>{actionStatusMessage}</span>
                </div>
              )}
              {enableScoringFeedback && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const nextOpen = !showThesisFeedbackForm;
                      setShowThesisFeedbackForm(nextOpen);
                      if (nextOpen) {
                        setReviewerFitDraft(thesisFirstResult.fit);
                        setReviewerWhyFitsDraft((thesisFirstResult.whyFits || []).join("\n"));
                        setReviewerWhyNotFitDraft((thesisFirstResult.whyNotFit || []).join("\n"));
                        setReviewerCruxQuestionDraft(thesisFirstResult.cruxQuestion || "");
                      }
                      setThesisFeedbackError(null);
                      setThesisFeedbackSuccess(null);
                    }}
                    className="rounded border border-indigo-300 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                  >
                    {showThesisFeedbackForm ? "Hide Scoring Feedback" : "Give Scoring Feedback"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Submit Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => void (showThesisDecisionPanel ? handleCloseDealAfterThesis() : startThesisCheckFlow())}
              disabled={
                isProcessing ||
                !companyName.trim() ||
                !normalizeCompanyUrlInput(companyUrl)
              }
              className="flex items-center gap-2 rounded-lg bg-yellow-400 px-6 py-2.5 text-sm font-bold text-black hover:bg-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {runningThesisFirst || movingToStageSeven ? (
                <>
                  <LoadingSpinner />
                  Processing...
                </>
              ) : (
                <>{showThesisDecisionPanel ? "Reject Deal" : "Check Thesis"}</>
              )}
            </button>
            <button
              type="button"
              onClick={() => void startFullScoringFlow()}
              disabled={
                isProcessing ||
                !companyName.trim() ||
                !normalizeCompanyUrlInput(companyUrl)
              }
              className="rounded-lg border border-indigo-300 bg-indigo-50 px-6 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Score Company
            </button>
            <button
              type="button"
              onClick={async () => {
                if (showThesisDecisionPanel && diligenceId) {
                  await handleExitFromFirstPass();
                  return;
                }
                router.push("/diligence");
              }}
              disabled={isProcessing}
              className="rounded-lg border border-gray-300 bg-white px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>

      {showHubSpotMatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Confirm HubSpot Match</h2>
              <p className="mt-1 text-sm text-gray-600">
                We searched HubSpot using your company name/domain. Confirm a match (with stage), manually paste a deal link/id, or continue without linking.
              </p>
            </div>

            {discoveringHubSpot && (
              <div className="mb-3 inline-flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700">
                <LoadingSpinner />
                Searching HubSpot...
              </div>
            )}

            {hubspotLookupError && !discoveringHubSpot && (
              <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {hubspotLookupError}
              </div>
            )}

            <div className="max-h-72 space-y-2 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-2">
              {hubspotCandidates.length === 0 ? (
                <p className="px-2 py-4 text-xs text-gray-600">No matches found. You can continue without linking.</p>
              ) : (
                hubspotCandidates.map((deal) => {
                  const isSelected = selectedHubspotDeal?.id === deal.id;
                  return (
                    <button
                      key={deal.id}
                      type="button"
                      onClick={() => {
                        setSelectedHubspotDeal(deal);
                        void hydrateFromHubSpotDeal(deal);
                      }}
                      className={`w-full rounded border px-3 py-2 text-left text-xs transition-colors ${
                        isSelected ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white hover:bg-gray-100"
                      }`}
                    >
                      <div className="font-semibold text-gray-800">{deal.name}</div>
                      <div className="mt-0.5 text-gray-600">
                        Stage: {deal.stageLabel || deal.stageId || "Unknown stage"}
                        {deal.pipelineLabel ? ` • ${deal.pipelineLabel}` : ""}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="mt-3 rounded border border-gray-200 bg-white p-3">
              <label className="block text-xs font-semibold text-gray-700">
                Manually link HubSpot deal (optional)
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="text"
                  value={manualHubSpotDealLink}
                  onChange={(e) => {
                    setManualHubSpotDealLink(e.target.value);
                    setManualHubSpotLookupError(null);
                  }}
                  placeholder="Paste HubSpot deal URL or deal id"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() => void hydrateManualHubSpotDeal()}
                  disabled={manualHubSpotLookupLoading || !extractHubSpotDealId(manualHubSpotDealLink)}
                  className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {manualHubSpotLookupLoading ? "Checking..." : "Use deal"}
                </button>
              </div>
              {manualHubSpotLookupError && (
                <p className="mt-1 text-xs text-red-700">{manualHubSpotLookupError}</p>
              )}
              {extractHubSpotDealId(manualHubSpotDealLink) && (
                <a
                  href={buildHubSpotDealUrl(extractHubSpotDealId(manualHubSpotDealLink))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-xs font-medium text-blue-700 hover:text-blue-900 hover:underline"
                >
                  Open pasted deal in HubSpot
                </a>
              )}
              {selectedHubspotDeal && (
                <div className="mt-2 rounded border border-green-200 bg-green-50 px-2.5 py-2 text-xs text-green-800">
                  <p className="font-semibold">Selected deal for linking</p>
                  <p className="mt-0.5">
                    {selectedHubspotDeal.name} - {selectedHubspotDeal.stageLabel || selectedHubspotDeal.stageId || "Unknown stage"}
                  </p>
                  {selectedHubspotDeal.url && (
                    <a
                      href={selectedHubspotDeal.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block font-medium text-green-800 underline"
                    >
                      Open selected deal
                    </a>
                  )}
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void confirmHubSpotMatchAndRun()}
                disabled={isProcessing}
                className="rounded bg-yellow-400 px-3 py-2 text-xs font-semibold text-black hover:bg-yellow-500 disabled:opacity-50"
              >
                {pendingStartMode === "full"
                  ? selectedHubspotDeal || extractHubSpotDealId(manualHubSpotDealLink)
                    ? "Confirm Match + Score Company"
                    : "Score Company (No Match)"
                  : selectedHubspotDeal || extractHubSpotDealId(manualHubSpotDealLink)
                    ? "Confirm Match + Thesis Check"
                    : "Run Thesis Check (No Match)"}
              </button>
              <button
                type="button"
                onClick={closeHubSpotMatchModal}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showHubSpotCreateModal && hubSpotCreatePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
            style={{ transform: `translate(${hubspotCreateModalOffset.x}px, ${hubspotCreateModalOffset.y}px)` }}
          >
            <div
              className="mb-4 flex items-start justify-between gap-4 cursor-move"
              onMouseDown={handleHubSpotCreateModalDragStart}
            >
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {hubSpotCreatePreview.createCompany === false ? "Create HubSpot Deal" : "Create HubSpot Company + Deal"}
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  {hubSpotCreatePreview.createCompany === false
                    ? `Existing company found${hubSpotCreatePreview.existingCompanyName ? `: ${hubSpotCreatePreview.existingCompanyName}` : ""}. Review deal fields before creating the HubSpot deal.`
                    : "Review and edit fields before creating HubSpot company and deal."}
                </p>
              </div>
            </div>

            {hubSpotCreateError && (
              <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {hubSpotCreateError}
              </div>
            )}

            {((hubSpotCreatePreview.createCompany !== false && hubSpotCreatePreview.company.missingWarnings.length > 0) || hubSpotCreatePreview.deal.missingHard.length > 0) && (
              <div className="mb-4 space-y-2">
                {hubSpotCreatePreview.createCompany !== false && hubSpotCreatePreview.company.missingWarnings.length > 0 && (
                  <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Company warnings: {hubSpotCreatePreview.company.missingWarnings.join(", ")}
                  </div>
                )}
                {hubSpotCreatePreview.deal.missingHard.length > 0 && (
                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    Deal required fields missing: {hubSpotCreatePreview.deal.missingHard.join(", ")}
                  </div>
                )}
              </div>
            )}

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
              <div className="rounded border border-gray-200 bg-white p-3">
                <h4 className="mb-2 text-xs font-semibold text-gray-800">Fields</h4>
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {getVisibleHubSpotCreateFieldEntries().map(({ objectType, key, value }) => {
                    const fieldMeta = (objectType === "company" ? hubSpotCreatePreview.company.fields : hubSpotCreatePreview.deal.fields)
                      .find((field) => field.hubspotProperty === key);
                    const fieldDescription = hubspotFieldDescriptions[`${objectType}:${key}`];
                    const hoverDescription =
                      fieldDescription ||
                      String(fieldMeta?.notes || "").trim() ||
                      `HubSpot property: ${key}`;
                    const rawFieldOptions = objectType === "deal" ? (hubspotDealFieldOptions[key] || []) : [];
                    const fieldOptions = key === "dealtype"
                      ? (rawFieldOptions.length > 0
                          ? rawFieldOptions.filter((option) => /new investment|follow-?on investment/i.test(option.label))
                          : [
                              { label: "New Investment", value: "New Investment" },
                              { label: "Follow-on Investment", value: "Follow-on Investment" },
                            ])
                      : rawFieldOptions;
                    return (
                      <label key={`${objectType}-${key}`} className="block text-[11px]">
                        <div className="mb-1 flex items-center gap-1.5 text-gray-700">
                          <span className="font-medium cursor-help" title={hoverDescription}>
                            {formatHubSpotFieldLabel(key, fieldMeta?.fieldName, objectType)}
                          </span>
                          {fieldMeta?.required && (
                            <span className={`rounded px-1 py-0.5 text-[10px] ${
                              fieldMeta.requiredMode === "hard"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-700"
                            }`}>
                              {fieldMeta.requiredMode}
                            </span>
                          )}
                        </div>
                        {key === "description" ? (
                          <textarea
                            value={value}
                            onChange={(e) => updateDraftProperty(objectType, key, e.target.value)}
                            rows={2}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                            disabled={hubSpotCreateSaving}
                          />
                        ) : key === "hubspot_owner_id" ? (
                          <select
                            value={value}
                            onChange={(e) => updateDraftProperty(objectType, key, e.target.value)}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                            disabled={hubSpotCreateSaving || hubspotOwnerOptionsLoading}
                          >
                            <option value="">
                              {hubspotOwnerOptionsLoading
                                ? "Loading owners..."
                                : hubspotOwnerOptions.length > 0
                                  ? "Select owner"
                                  : "No owners found"}
                            </option>
                            {hubspotOwnerOptions.map((owner) => (
                              <option key={owner.id} value={owner.id}>
                                {owner.label}
                              </option>
                            ))}
                          </select>
                        ) : key === "industry" && hubspotIndustryOptions.length > 0 ? (
                          <select
                            value={value}
                            onChange={(e) => updateDraftProperty(objectType, key, e.target.value)}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                            disabled={hubSpotCreateSaving || hubspotIndustryOptionsLoading}
                          >
                            <option value="">{hubspotIndustryOptionsLoading ? "Loading..." : "Select industry"}</option>
                            {hubspotIndustryOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : key === "state" ? (
                          <select
                            value={value}
                            onChange={(e) => updateDraftProperty(objectType, key, e.target.value)}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                            disabled={hubSpotCreateSaving}
                          >
                            {US_STATE_OPTIONS.map((option) => (
                              <option key={option || "blank"} value={option}>
                                {option || "Select state"}
                              </option>
                            ))}
                          </select>
                        ) : key === "pipeline" && hubspotDealPipelineOptions.length > 0 ? (
                          <select
                            value={value}
                            onChange={(e) => updateDraftProperty(objectType, key, e.target.value)}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                            disabled={hubSpotCreateSaving || hubspotDealPipelineOptionsLoading}
                          >
                            <option value="">
                              {hubspotDealPipelineOptionsLoading ? "Loading deal-flow pipelines..." : "Select deal-flow pipeline"}
                            </option>
                            {hubspotDealPipelineOptions.map((pipeline) => (
                              <option key={pipeline.id} value={pipeline.id}>
                                {pipeline.label}
                              </option>
                            ))}
                          </select>
                        ) : key === "closed_lost_reason" && fieldOptions.length > 0 ? (
                          <select
                            multiple
                            value={String(value || "")
                              .split(";")
                              .map((item) => item.trim())
                              .filter(Boolean)}
                            onChange={(e) => {
                              const selected = Array.from(e.target.selectedOptions).map((option) => option.value);
                              updateDraftProperty(objectType, key, selected.join(";"));
                            }}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs min-h-20"
                            disabled={hubSpotCreateSaving}
                          >
                            {fieldOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : key === "closed_lost_reason_notes" ? (
                          <textarea
                            value={value}
                            onChange={(e) => updateDraftProperty(objectType, key, e.target.value)}
                            rows={2}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                            disabled={hubSpotCreateSaving}
                          />
                        ) : key === "round_still_open" && fieldOptions.length > 0 ? (
                          <select
                            value={value}
                            onChange={(e) => updateDraftProperty(objectType, key, e.target.value)}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                            disabled={hubSpotCreateSaving}
                          >
                            <option value="">Select Yes or No</option>
                            {fieldOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : key === "round_still_open" ? (
                          <select
                            value={value}
                            onChange={(e) => updateDraftProperty(objectType, key, e.target.value)}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                            disabled={hubSpotCreateSaving}
                          >
                            <option value="">Select Yes or No</option>
                            <option value="Yes">Yes</option>
                            <option value="No">No</option>
                          </select>
                        ) : key === "dealstage" ? (
                          <input
                            type="text"
                            value="Deal 0: Triage"
                            className="w-full rounded border border-gray-300 bg-gray-100 px-2 py-1 text-xs text-gray-700"
                            disabled
                          />
                        ) : (key === "hs_all_collaborator_owner_ids" || key === "original_mudita_source") && hubspotOwnerOptions.length > 0 ? (
                          <select
                            value={value}
                            onChange={(e) => updateDraftProperty(objectType, key, e.target.value)}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                            disabled={hubSpotCreateSaving || hubspotOwnerOptionsLoading}
                          >
                            <option value="">
                              {hubspotOwnerOptionsLoading
                                ? "Loading owners..."
                                : key === "original_mudita_source"
                                  ? "Select owner source"
                                  : "Select collaborator"}
                            </option>
                            {hubspotOwnerOptions.map((owner) => (
                              <option key={owner.id} value={owner.id}>
                                {owner.label}
                              </option>
                            ))}
                          </select>
                        ) : fieldOptions.length > 0 ? (
                          <select
                            value={value}
                            onChange={(e) => updateDraftProperty(objectType, key, e.target.value)}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                            disabled={hubSpotCreateSaving}
                          >
                            <option value="">Select option</option>
                            {fieldOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={value}
                            onChange={(e) => updateDraftProperty(objectType, key, e.target.value)}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                            disabled={hubSpotCreateSaving}
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCommitHubSpotCreate}
                disabled={hubSpotCreateSaving}
                className="rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {hubSpotCreateSaving
                  ? "Creating..."
                  : closeDealAfterCreate
                    ? "Create in HubSpot + Close Deal"
                    : hubSpotCreatePreview.createCompany === false
                      ? "Create Deal in HubSpot"
                      : "Create in HubSpot"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowHubSpotCreateModal(false);
                  setStageSevenAfterCreate(false);
                  setCloseDealAfterCreate(false);
                }}
                disabled={hubSpotCreateSaving}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

export default function NewDiligencePage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <NewDiligenceForm />
    </Suspense>
  );
}
