"use client";

import { useState, useEffect, useRef, use, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import LoadingSpinner from "@/components/LoadingSpinner";

async function parseApiError(response: Response): Promise<{ message: string; raw?: string }> {
  const fallback = `Request failed (${response.status})`;
  try {
    const rawText = await response.text();
    if (!rawText) return { message: fallback };

    try {
      const parsed = JSON.parse(rawText);
      return {
        message: parsed?.error || parsed?.message || fallback,
        raw: rawText,
      };
    } catch {
      return {
        message: `${fallback}: ${rawText.slice(0, 240)}`,
        raw: rawText,
      };
    }
  } catch {
    return { message: fallback };
  }
}
import CategorizedNotes from "@/components/CategorizedNotes";
import ScoreOverrideModal from "@/components/diligence/ScoreOverrideModal";
import DiligencePdfExport from "@/components/diligence/DiligencePdfExport";
import {
  FileText,
  ExternalLink,
  Send,
  Download,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Trash2,
  ArrowLeft,
  Upload,
  MessageCircle,
  X,
  Folder,
  Edit2,
  Plus,
  HelpCircle,
  CheckCircle,
  AlertCircle,
  Globe,
  RotateCcw,
  Copy,
} from "lucide-react";
import {
  DiligenceRecord,
  DiligenceNote,
  DiligenceQuestion,
  CategoryScore,
  DiligenceMetrics,
  DiligenceMetricValue,
  HubSpotCompanyData,
  HubSpotDealLookup,
  DiligenceCriteria,
} from "@/types/diligence";
import { useRouter } from "next/navigation";

interface HubSpotStageOption {
  id: string;
  label: string;
  displayOrder: number;
}

interface HubSpotPipelineOption {
  id: string;
  label: string;
  displayOrder?: number;
  stages: HubSpotStageOption[];
}

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
interface ClosedLostStageDraft {
  stageId: string;
  stageLabel: string;
}
interface HubSpotPropertyOption {
  label: string;
  value: string;
}
type MetricDraftKey =
  | "arr"
  | "tam"
  | "marketGrowthRate"
  | "acv"
  | "yoyGrowthRate"
  | "fundingAmount"
  | "committed"
  | "valuation"
  | "dealTerms"
  | "lead"
  | "currentRunway"
  | "postFundingRunway"
  | "location";
type MetricDraftRecord = Record<MetricDraftKey, string>;
interface MetricFieldConfig {
  key: MetricDraftKey;
  label: string;
  placeholder: string;
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

export default function DiligenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const RESCORE_PROGRESS_STEPS = [
    "Refreshing company and deal context...",
    "Running Team research...",
    "Running Portfolio Synergy research...",
    "Running Problem Necessity research...",
    "Refreshing TAM and market growth analysis...",
    "Scoring all diligence criteria...",
    "Finalizing score and syncing updates...",
  ];
  const [record, setRecord] = useState<DiligenceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [documentReadWarning, setDocumentReadWarning] = useState<string | null>(null);
  const [chatMessage, setChatMessage] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const [rescoreProgress, setRescoreProgress] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [recommendation, setRecommendation] = useState("");
  const [editingRecommendation, setEditingRecommendation] = useState(false);
  const [notes, setNotes] = useState("");
  const [categorizedNotes, setCategorizedNotes] = useState<DiligenceNote[]>([]);
  const [noteCategories, setNoteCategories] = useState<string[]>(["Overall"]);
  const [editingNotes, setEditingNotes] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [isDocumentsExpanded, setIsDocumentsExpanded] = useState(true);
  const [isNotesExpanded, setIsNotesExpanded] = useState(false);
  const [isQuestionsExpanded, setIsQuestionsExpanded] = useState(false);
  const [isScoringGridExpanded, setIsScoringGridExpanded] = useState(true);
  const [expandedScoringCategories, setExpandedScoringCategories] = useState<Set<string>>(new Set());
  const [expandedScoringDetails, setExpandedScoringDetails] = useState<Set<string>>(new Set());
  const [scoringPerspectiveDrafts, setScoringPerspectiveDrafts] = useState<Record<string, string>>({});
  const [isThesisExpanded, setIsThesisExpanded] = useState(true);
  const [showChatModal, setShowChatModal] = useState(false);
  const [showDocumentsModal, setShowDocumentsModal] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [selectedPdfSections, setSelectedPdfSections] = useState<Set<string>>(
    new Set(['overview', 'score', 'metrics', 'categories', 'thesis', 'followup', 'questions', 'notes'])
  );
  const [addingLink, setAddingLink] = useState(false);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkEmail, setLinkEmail] = useState("");
  const [editingCategory, setEditingCategory] = useState<CategoryScore | null>(null);
  const [showHubspotLinker, setShowHubspotLinker] = useState(false);
  const [hubspotSearchQuery, setHubspotSearchQuery] = useState("");
  const [hubspotSearchResults, setHubspotSearchResults] = useState<HubSpotDealLookup[]>([]);
  const [searchingHubspotDeals, setSearchingHubspotDeals] = useState(false);
  const [linkingHubspotDeal, setLinkingHubspotDeal] = useState(false);
  const [hubspotSearchAttempted, setHubspotSearchAttempted] = useState(false);
  const [hubspotCreatePreview, setHubspotCreatePreview] = useState<HubSpotCreatePreview | null>(null);
  const [hubspotCreateLoading, setHubspotCreateLoading] = useState(false);
  const [hubspotCreateSaving, setHubspotCreateSaving] = useState(false);
  const [hubspotCreateError, setHubspotCreateError] = useState<string | null>(null);
  const [hubspotCreateCompanyDraft, setHubspotCreateCompanyDraft] = useState<Record<string, string>>({});
  const [hubspotCreateDealDraft, setHubspotCreateDealDraft] = useState<Record<string, string>>({});
  const [hubspotIndustryOptions, setHubspotIndustryOptions] = useState<HubSpotSelectOption[]>([]);
  const [hubspotPriorityOptions, setHubspotPriorityOptions] = useState<HubSpotSelectOption[]>([]);
  const [hubspotIndustryOptionsLoading, setHubspotIndustryOptionsLoading] = useState(false);
  const [hubspotPriorityOptionsLoading, setHubspotPriorityOptionsLoading] = useState(false);
  const [hubspotOwnerOptions, setHubspotOwnerOptions] = useState<HubSpotOwnerOption[]>([]);
  const [hubspotOwnerOptionsLoading, setHubspotOwnerOptionsLoading] = useState(false);
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
  const [showFoundersModal, setShowFoundersModal] = useState(false);
  const [showClosedLostStageModal, setShowClosedLostStageModal] = useState(false);
  const [pendingClosedLostStage, setPendingClosedLostStage] = useState<ClosedLostStageDraft | null>(null);
  const [closedLostReasonsDraft, setClosedLostReasonsDraft] = useState<string[]>([]);
  const [closedLostReasonNotesDraft, setClosedLostReasonNotesDraft] = useState("");
  const [roundStillOpenDraft, setRoundStillOpenDraft] = useState("");
  const [closedLostReasonOptions, setClosedLostReasonOptions] = useState<HubSpotSelectOption[]>([]);
  const [roundStillOpenOptions, setRoundStillOpenOptions] = useState<HubSpotSelectOption[]>([]);
  const [editingFounders, setEditingFounders] = useState<Array<{ name: string; linkedinUrl: string; title: string }>>([]);
  const [savingFounders, setSavingFounders] = useState(false);
  const [editingThesis, setEditingThesis] = useState(false);
  const [editedThesisAnswers, setEditedThesisAnswers] = useState<any>(null);
  const [savingThesis, setSavingThesis] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showRescoreDialog, setShowRescoreDialog] = useState(false);
  const [rescoreDialogText, setRescoreDialogText] = useState("");
  const [showRescoreMenu, setShowRescoreMenu] = useState(false);
  const [rescoringCategoryName, setRescoringCategoryName] = useState<string | null>(null);
  const [editingMetrics, setEditingMetrics] = useState(false);
  const [savingMetrics, setSavingMetrics] = useState(false);
  const [metricsDraft, setMetricsDraft] = useState<MetricDraftRecord>({
    arr: "",
    tam: "",
    marketGrowthRate: "",
    acv: "",
    yoyGrowthRate: "",
    fundingAmount: "",
    committed: "",
    valuation: "",
    dealTerms: "",
    lead: "",
    currentRunway: "",
    postFundingRunway: "",
    location: "",
  });
  const [savingIndustry, setSavingIndustry] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  const [editingPriorityField, setEditingPriorityField] = useState(false);
  const [hubspotCompanyData, setHubspotCompanyData] = useState<HubSpotCompanyData | null>(null);
  const [hubspotPipelineOptions, setHubspotPipelineOptions] = useState<HubSpotPipelineOption[]>([]);
  const [loadingHubspotStages, setLoadingHubspotStages] = useState(false);
  const [updatingHubspotStage, setUpdatingHubspotStage] = useState(false);
  const [editingHubspotStageField, setEditingHubspotStageField] = useState(false);
  const [questions, setQuestions] = useState<DiligenceQuestion[]>([]);
  const [isAddingQuestion, setIsAddingQuestion] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");
  const [newCategory, setNewCategory] = useState<string>("Other");
  const [questionStatusFilter, setQuestionStatusFilter] = useState<"open" | "closed" | "both">("both");
  const [copiedQuestions, setCopiedQuestions] = useState(false);
  const [editingCell, setEditingCell] = useState<{ questionId: string; field: 'question' | 'answer' } | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingQuestions, setSavingQuestions] = useState(false);
  const [savingScoringPerspectiveKey, setSavingScoringPerspectiveKey] = useState<string | null>(null);
  const [criterionScoreDrafts, setCriterionScoreDrafts] = useState<Record<string, string>>({});
  const [savingCriterionScoreKey, setSavingCriterionScoreKey] = useState<string | null>(null);
  const [criteriaByRowKey, setCriteriaByRowKey] = useState<Record<string, { answerBuilder?: string }>>({});
  const [criteriaByNormalizedRowKey, setCriteriaByNormalizedRowKey] = useState<Record<string, { answerBuilder?: string }>>({});
  const chatEndRef = useRef<HTMLDivElement>(null);
  const attemptedIndustryAutoSetRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setHubspotReferenceOptionsLoaded(false);
    if (!hubspotCreatePreview) {
      setHubspotCreateModalOffset({ x: 0, y: 0 });
    }
  }, [hubspotCreatePreview]);

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
    fetchRecord();
    void fetchHubSpotStages();
  }, [id]);

  useEffect(() => {
    if (hubspotIndustryOptions.length > 0) return;
    const loadIndustryOptions = async () => {
      setHubspotIndustryOptionsLoading(true);
      try {
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
      } catch {
        // Non-blocking.
      } finally {
        setHubspotIndustryOptionsLoading(false);
      }
    };
    void loadIndustryOptions();
  }, [hubspotIndustryOptions.length]);

  useEffect(() => {
    if (hubspotPriorityOptions.length > 0) return;
    const loadPriorityOptions = async () => {
      setHubspotPriorityOptionsLoading(true);
      try {
        const response = await fetch("/api/hubspot/properties?property=hs_priority");
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
          setHubspotPriorityOptions(options);
        }
      } catch {
        // Non-blocking.
      } finally {
        setHubspotPriorityOptionsLoading(false);
      }
    };
    void loadPriorityOptions();
  }, [hubspotPriorityOptions.length]);

  useEffect(() => {
    if (!hubspotCreatePreview || hubspotReferenceOptionsLoaded) return;
    setHubspotReferenceOptionsLoaded(true);
    const loadReferenceOptions = async () => {
      setHubspotIndustryOptionsLoading(true);
      setHubspotOwnerOptionsLoading(true);
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
      } catch {
        // Non-blocking: fallback to text input when options fail to load.
      } finally {
        setHubspotIndustryOptionsLoading(false);
        setHubspotOwnerOptionsLoading(false);
      }
    };
    void loadReferenceOptions();
  }, [hubspotCreatePreview, hubspotReferenceOptionsLoaded, hubspotIndustryOptions.length, hubspotOwnerOptions.length]);

  useEffect(() => {
    if (!hubspotCreatePreview || hubspotPipelineOptions.length === 0) return;
    const dealFlowPipelines = hubspotPipelineOptions
      .filter((pipeline) => /deal\s*flow/i.test(pipeline.label || ""))
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    if (dealFlowPipelines.length === 0) return;

    setHubspotCreateDealDraft((prev) => {
      const currentPipelineId = (prev.pipeline || "").trim();
      const hasCurrent = dealFlowPipelines.some((pipeline) => pipeline.id === currentPipelineId);
      if (hasCurrent) return prev;
      const preferred =
        dealFlowPipelines.find((pipeline) => /fund\s*ii\s*deal\s*flow/i.test(pipeline.label || "")) ||
        dealFlowPipelines[0];
      if (!preferred?.id) return prev;
      return { ...prev, pipeline: preferred.id };
    });
  }, [hubspotCreatePreview, hubspotPipelineOptions]);

  useEffect(() => {
    if (!hubspotCreatePreview) return;
    const companyKeys = getVisibleCompanyFieldEntries().map(([key]) => key);
    const dealKeys = Object.keys(hubspotCreateDealDraft).filter((key) => !HIDDEN_DEAL_FIELD_KEYS.has(key));
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
  }, [hubspotCreatePreview, hubspotCreateDealDraft, hubspotFieldDescriptions]);

  useEffect(() => {
    if (!hubspotCreatePreview) return;
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

      setHubspotCreateDealDraft((prev) => {
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
  }, [hubspotCreatePreview]);

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
    if (!showHubspotLinker || !hubspotCreatePreview) return;
    if (hubspotIndustryOptions.length === 0) return;
    setHubspotCreateCompanyDraft((prev) => {
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
      const guessedIndustry = resolvePreferredIndustry(record?.industry, hubspotCompanyData || record?.hubspotCompanyData);
      if (!guessedIndustry) return prev;
      return {
        ...prev,
        industry: mapIndustryGuessToOptionValue(guessedIndustry, hubspotIndustryOptions),
      };
    });
  }, [showHubspotLinker, hubspotCreatePreview, hubspotIndustryOptions, record, hubspotCompanyData]);

  useEffect(() => {
    if (!record || hubspotIndustryOptions.length === 0 || savingIndustry) return;
    const preferred = resolvePreferredIndustry(record.industry, hubspotCompanyData || record.hubspotCompanyData);
    const needsSet = !String(record.industry || "").trim();
    if (!needsSet && preferred) return;
    if (attemptedIndustryAutoSetRef.current.has(record.id)) return;
    const fallback = chooseIndustryValue(preferred, hubspotIndustryOptions);
    if (!fallback) return;
    attemptedIndustryAutoSetRef.current.add(record.id);
    void saveIndustryValue(fallback).catch(() => {
      attemptedIndustryAutoSetRef.current.delete(record.id);
    });
  }, [record, hubspotIndustryOptions, hubspotCompanyData, savingIndustry]);

  const fetchHubSpotStages = async () => {
    setLoadingHubspotStages(true);
    try {
      const response = await fetch("/api/hubspot/stages");
      const data = await response.json();
      if (data.success && Array.isArray(data.pipelines)) {
        setHubspotPipelineOptions(data.pipelines);
      }
    } catch (err) {
      console.warn("Failed to load HubSpot stages:", err);
    } finally {
      setLoadingHubspotStages(false);
    }
  };

  useEffect(() => {
    const loadClosedLostFieldOptions = async () => {
      try {
        const [reasonsResponse, roundResponse] = await Promise.all([
          fetch("/api/hubspot/properties?property=closed_lost_reason"),
          fetch("/api/hubspot/properties?property=round_still_open"),
        ]);
        const reasonsData = await reasonsResponse.json();
        const roundData = await roundResponse.json();
        if (reasonsResponse.ok && Array.isArray(reasonsData?.property?.options)) {
          setClosedLostReasonOptions(
            reasonsData.property.options
              .map((option: any) => ({
                label: String(option?.label || option?.value || "").trim(),
                value: String(option?.value || "").trim(),
              }))
              .filter((option: HubSpotSelectOption) => option.label && option.value)
          );
        }
        if (roundResponse.ok && Array.isArray(roundData?.property?.options)) {
          setRoundStillOpenOptions(
            roundData.property.options
              .map((option: any) => ({
                label: String(option?.label || option?.value || "").trim(),
                value: String(option?.value || "").trim(),
              }))
              .filter((option: HubSpotSelectOption) => option.label && option.value)
          );
        }
      } catch {
        // Non-blocking fallback to manual defaults.
      }
    };
    void loadClosedLostFieldOptions();
  }, []);

  const handleUpdateHubSpotStage = async (
    nextStageId: string,
    stageProperties?: Record<string, string>
  ) => {
    if (!record || !record.hubspotDealId || !nextStageId || updatingHubspotStage) return;
    const allStages = hubspotPipelineOptions.flatMap((pipeline) => pipeline.stages || []);
    const nextStage = allStages.find((stage) => stage.id === nextStageId);
    if (!nextStage) return;

    setUpdatingHubspotStage(true);
    setError(null);
    try {
      const response = await fetch(`/api/diligence/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hubspotDealStageId: nextStage.id,
          hubspotDealStageLabel: nextStage.label,
          hubspotDealStageProperties: stageProperties,
        }),
      });
      const data = await response.json();
      if (data.success && data.record) {
        setRecord(data.record);
      } else {
        setError(data.error || "Failed to update HubSpot stage");
      }
    } catch (err) {
      console.error("Error updating HubSpot stage:", err);
      setError("Failed to update HubSpot stage");
    } finally {
      setUpdatingHubspotStage(false);
    }
  };

  const saveIndustryValue = async (nextIndustryValue: string) => {
    if (!record) return;
    setSavingIndustry(true);
    try {
      const response = await fetch(`/api/diligence/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry: nextIndustryValue }),
      });
      const data = await response.json();
      if (data.success && data.record) {
        setRecord(data.record);
      } else {
        throw new Error(data.error || "Failed to save industry");
      }
    } finally {
      setSavingIndustry(false);
    }
  };

  const savePriorityValue = async (nextPriorityValue: string) => {
    if (!record) return;
    setSavingPriority(true);
    try {
      const response = await fetch(`/api/diligence/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: nextPriorityValue }),
      });
      const data = await response.json();
      if (data.success && data.record) {
        setRecord(data.record);
        setEditingPriorityField(false);
      } else {
        throw new Error(data.error || "Failed to save priority");
      }
    } finally {
      setSavingPriority(false);
    }
  };

  const isClosedLostLikeStageLabel = (label?: string): boolean => {
    const normalized = String(label || "").toLowerCase();
    return /closed\s*lost|rejected|deal\s*7/i.test(normalized);
  };

  const handleSelectHubSpotStage = async (nextStageId: string) => {
    const allStages = hubspotPipelineOptions.flatMap((pipeline) => pipeline.stages || []);
    const nextStage = allStages.find((stage) => stage.id === nextStageId);
    if (!nextStage) return;
    if (isClosedLostLikeStageLabel(nextStage.label)) {
      setPendingClosedLostStage({ stageId: nextStage.id, stageLabel: nextStage.label });
      setClosedLostReasonsDraft([]);
      setClosedLostReasonNotesDraft("");
      setRoundStillOpenDraft("");
      setShowClosedLostStageModal(true);
      return;
    }
    await handleUpdateHubSpotStage(nextStageId);
    setEditingHubspotStageField(false);
  };

  const confirmClosedLostStageUpdate = async () => {
    if (!pendingClosedLostStage) return;
    if (!roundStillOpenDraft.trim()) {
      setError("Round Still Open is required when closing a deal as lost.");
      return;
    }
    setShowClosedLostStageModal(false);
    await handleUpdateHubSpotStage(pendingClosedLostStage.stageId, {
      closed_lost_reason: closedLostReasonsDraft.join(";"),
      closed_lost_reason_notes: closedLostReasonNotesDraft.trim(),
      round_still_open: roundStillOpenDraft.trim(),
      closedate: new Date().toISOString().slice(0, 10),
    });
    setPendingClosedLostStage(null);
  };

  useEffect(() => {
    if (showFoundersModal && record) {
      // Initialize editing founders with current data or empty array
      setEditingFounders(
        record.founders && record.founders.length > 0
          ? record.founders.map(f => ({ name: f.name, linkedinUrl: f.linkedinUrl || '', title: f.title || '' }))
          : [{ name: '', linkedinUrl: '', title: '' }]
      );
    }
  }, [showFoundersModal, record]);

  useEffect(() => {
    if (record && !recommendation && record.recommendation) {
      setRecommendation(record.recommendation);
    }
  }, [record]);

  useEffect(() => {
    if (record) {
      // Load legacy notes
      if (record.notes !== undefined) {
        setNotes(record.notes);
      }
      // Load categorized notes
      if (record.categorizedNotes) {
        setCategorizedNotes(record.categorizedNotes);
      }
      // Load questions
      if (record.questions) {
        setQuestions(record.questions);
      }
      // Load categories from score
      if (record.score?.categories) {
        const scoreCats = record.score.categories.map(c => c.category);
        setNoteCategories(["Overall", ...scoreCats]);
      }
    }
  }, [record]);

  useEffect(() => {
    if (!record?.score) return;

    const nextDrafts: Record<string, string> = {};
    for (const category of record.score.categories) {
      for (const criterion of category.criteria) {
        nextDrafts[`${category.category}::${criterion.name}`] = criterion.userPerspective || "";
      }
    }
    setScoringPerspectiveDrafts(nextDrafts);
  }, [record?.id, record?.score?.scoredAt]);

  useEffect(() => {
    if (!record?.score) return;
    const nextDrafts: Record<string, string> = {};
    for (const category of record.score.categories) {
      for (const criterion of category.criteria) {
        nextDrafts[`${category.category}::${criterion.name}`] = String(
          criterion.manualOverride ?? criterion.score
        );
      }
    }
    setCriterionScoreDrafts(nextDrafts);
  }, [record?.id, record?.score?.scoredAt]);

  useEffect(() => {
    if (!record?.score) return;
    const nextExpanded = new Set<string>();
    for (const category of record.score.categories) {
      for (const criterion of category.criteria) {
        const rowKey = scoringGridRowKey(category.category, criterion.name);
        const hasUserDetails = Boolean((criterion.userPerspective || "").trim());
        if (!hasUserDetails) {
          nextExpanded.add(rowKey);
        }
      }
    }
    setExpandedScoringDetails(nextExpanded);
  }, [record?.id, record?.score?.scoredAt]);

  useEffect(() => {
    const fetchCriteria = async () => {
      try {
        // Ensure we pick up latest spreadsheet edits instead of waiting for cache expiry.
        await fetch("/api/diligence/criteria/refresh", { method: "POST" });
        const response = await fetch("/api/diligence/criteria");
        const data = await response.json();
        if (!data.success || !data.criteria) return;

        const criteriaMap: Record<string, { answerBuilder?: string }> = {};
        const normalizedCriteriaMap: Record<string, { answerBuilder?: string }> = {};
        const criteria = data.criteria as DiligenceCriteria;
        const normalizeKeyPart = (value: string) =>
          value.toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const category of criteria.categories || []) {
          for (const criterion of category.criteria || []) {
            const exactKey = `${category.name}::${criterion.name}`;
            criteriaMap[exactKey] = {
              answerBuilder: criterion.answerBuilder,
            };
            const normalizedKey = `${normalizeKeyPart(category.name)}::${normalizeKeyPart(criterion.name)}`;
            normalizedCriteriaMap[normalizedKey] = {
              answerBuilder: criterion.answerBuilder,
            };
          }
        }
        setCriteriaByRowKey(criteriaMap);
        setCriteriaByNormalizedRowKey(normalizedCriteriaMap);
      } catch (criteriaError) {
        console.warn("Failed to load criteria metadata:", criteriaError);
      }
    };

    void fetchCriteria();
  }, []);

  // Remove auto-scroll - let user control their scroll position
  // useEffect(() => {
  //   chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  // }, [record?.chatHistory]);

  const fetchRecord = async () => {
    try {
      const response = await fetch(`/api/diligence/${id}`);
      const data = await response.json();

      if (data.success) {
        const resolvedHubspotCompany = data.hubspotCompanyData || data.record?.hubspotCompanyData || null;
        const seededMetrics = withSeededDealTermMetrics(data.record?.metrics, resolvedHubspotCompany);
        const nextRecord = data.record
          ? {
              ...data.record,
              metrics: seededMetrics,
              score: buildScoreWithComposedAnswers(data.record.score, seededMetrics),
            }
          : data.record;
        setRecord(nextRecord);
        setHubspotCompanyData(resolvedHubspotCompany);
      } else {
        setError(data.error || "Failed to load diligence record");
      }
    } catch (err) {
      console.error("Error fetching diligence record:", err);
      setError("Failed to connect to API");
    } finally {
      setLoading(false);
    }
  };

  const handleSearchHubSpotDeals = async (queryOverride?: string) => {
    const query = (queryOverride ?? hubspotSearchQuery).trim();
    if (!query) {
      setHubspotSearchResults([]);
      setHubspotSearchAttempted(true);
      return;
    }
    setSearchingHubspotDeals(true);
    setHubspotSearchAttempted(true);
    try {
      const response = await fetch(`/api/hubspot/search-deals?query=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (data.success) {
        setHubspotSearchResults(data.deals || []);
      } else {
        setError(data.error || "Failed to search HubSpot deals");
      }
    } catch (err) {
      console.error("Error searching HubSpot deals:", err);
      setError("Failed to search HubSpot deals");
    } finally {
      setSearchingHubspotDeals(false);
    }
  };

  const handlePrepareHubSpotCreate = async () => {
    if (!record) return;
    setHubspotCreateError(null);
    setHubspotCreateLoading(true);
    try {
      const response = await fetch("/api/hubspot/create/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diligenceId: id }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to generate HubSpot create preview");
      }
      const preview = data.preview as HubSpotCreatePreview;
      const guessedIndustry = resolvePreferredIndustry(record.industry, hubspotCompanyData || record.hubspotCompanyData);
      const nextCompanyDraft = { ...(preview.company.properties || {}) };
      const rawIndustry = String(nextCompanyDraft.industry || "").trim();
      const normalizedIndustry = rawIndustry
        ? mapIndustryGuessToOptionValue(rawIndustry, hubspotIndustryOptions)
        : "";
      if (normalizedIndustry) {
        nextCompanyDraft.industry = normalizedIndustry;
      } else if (!rawIndustry && guessedIndustry) {
        nextCompanyDraft.industry = mapIndustryGuessToOptionValue(guessedIndustry, hubspotIndustryOptions);
      }
      setHubspotCreatePreview(preview);
      setHubspotCreateCompanyDraft(nextCompanyDraft);
      setHubspotCreateDealDraft(preview.deal.properties || {});
    } catch (err) {
      setHubspotCreateError(err instanceof Error ? err.message : "Failed to generate HubSpot create preview");
    } finally {
      setHubspotCreateLoading(false);
    }
  };

  const handleCommitHubSpotCreate = async () => {
    if (!record) return;
    setHubspotCreateSaving(true);
    setHubspotCreateError(null);
    try {
      const response = await fetch("/api/hubspot/create/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diligenceId: id,
          companyProperties: hubspotCreateCompanyDraft,
          dealProperties: hubspotCreateDealDraft,
        }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to create HubSpot company/deal");
      }
      if (data.record) {
        setRecord(data.record);
      }
      setShowHubspotLinker(false);
      setHubspotCreatePreview(null);
    } catch (err) {
      setHubspotCreateError(err instanceof Error ? err.message : "Failed to create HubSpot company/deal");
    } finally {
      setHubspotCreateSaving(false);
    }
  };

  const updateHubSpotCreateDraft = (
    objectType: "company" | "deal",
    key: string,
    value: string
  ) => {
    if (objectType === "company") {
      setHubspotCreateCompanyDraft((prev) => {
        const next = { ...prev, [key]: value };
        if (key === "website") {
          const domain = extractDomainFromWebsite(value);
          if (domain) next.domain = domain;
        }
        return next;
      });
      return;
    }
    setHubspotCreateDealDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleLinkHubSpotDeal = async (deal: HubSpotDealLookup) => {
    if (!record) return;
    setLinkingHubspotDeal(true);
    setError(null);
    try {
      const response = await fetch(`/api/diligence/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hubspotDealId: deal.id,
          hubspotDealStageId: deal.stageId,
          hubspotDealStageLabel: deal.stageLabel,
          hubspotPipelineId: deal.pipelineId,
          hubspotPipelineLabel: deal.pipelineLabel,
          hubspotAmount: deal.amount,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setShowHubspotLinker(false);
        await fetchRecord();
      } else {
        setError(data.error || "Failed to link HubSpot deal");
      }
    } catch (err) {
      console.error("Error linking HubSpot deal:", err);
      setError("Failed to link HubSpot deal");
    } finally {
      setLinkingHubspotDeal(false);
    }
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

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim() || chatLoading || !record) return;

    const userMessage = chatMessage.trim();
    setChatMessage("");
    setChatLoading(true);

    try {
      const response = await fetch("/api/diligence/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diligenceId: id,
          message: userMessage,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      // Read the streaming response
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      let accumulatedResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = new TextDecoder().decode(value);
        accumulatedResponse += text;

        // Update UI with streaming text (optimistic update)
        setRecord(prev => {
          if (!prev) return prev;
          
          const existingUserMsg = prev.chatHistory.find(
            msg => msg.content === userMessage && msg.role === 'user'
          );

          if (!existingUserMsg) {
            return {
              ...prev,
              chatHistory: [
                ...prev.chatHistory,
                {
                  id: `msg_${Date.now()}_user`,
                  role: 'user' as const,
                  content: userMessage,
                  timestamp: new Date().toISOString(),
                },
                {
                  id: `msg_${Date.now()}_assistant`,
                  role: 'assistant' as const,
                  content: accumulatedResponse,
                  timestamp: new Date().toISOString(),
                },
              ],
            };
          } else {
            // Update last assistant message
            const newHistory = [...prev.chatHistory];
            const lastMsg = newHistory[newHistory.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content = accumulatedResponse;
            }
            return { ...prev, chatHistory: newHistory };
          }
        });
      }

      // Refresh record to get saved version
      await fetchRecord();

    } catch (err) {
      console.error("Error sending message:", err);
      setError("Failed to send message. Please try again.");
    } finally {
      setChatLoading(false);
    }
  };

  const handleSaveRecommendation = async () => {
    if (!record) return;

    try {
      const response = await fetch(`/api/diligence/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendation }),
      });

      const data = await response.json();
      if (data.success) {
        setRecord(data.record);
        setEditingRecommendation(false);
      }
    } catch (err) {
      console.error("Error saving recommendation:", err);
    }
  };

  const handleSaveNotes = async (shouldRescore: boolean = false) => {
    if (!record) return;

    setSavingNotes(true);

    try {
      // Save the categorized notes
      const response = await fetch(`/api/diligence/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categorizedNotes }),
      });

      const data = await response.json();
      if (data.success) {
        setRecord(data.record);
        setEditingNotes(false);

        // If user wants to re-score with the new notes
        if (shouldRescore) {
          await handleRescore();
        }
      }
    } catch (err) {
      console.error("Error saving notes:", err);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleRescore = async (forceFull: boolean = false) => {
    if (!record) return;

    setRescoring(true);
    let progressIndex = 0;
    setRescoreProgress(
      forceFull
        ? `${RESCORE_PROGRESS_STEPS[progressIndex]} (full refresh mode)`
        : RESCORE_PROGRESS_STEPS[progressIndex]
    );
    const rescoreProgressTimer: ReturnType<typeof setInterval> = setInterval(() => {
      progressIndex = Math.min(progressIndex + 1, RESCORE_PROGRESS_STEPS.length - 1);
      setRescoreProgress(
        forceFull
          ? `${RESCORE_PROGRESS_STEPS[progressIndex]} (full refresh mode)`
          : RESCORE_PROGRESS_STEPS[progressIndex]
      );
    }, 7000);
    setError(null);
    setDocumentReadWarning(null);
    setShowRescoreDialog(false);
    setShowRescoreMenu(false);

    try {
      const response = await fetch("/api/diligence/rescore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diligenceId: id, forceFull }),
      });
      if (!response.ok) {
        const apiError = await parseApiError(response);
        setError(apiError.message || "Failed to re-score");
        console.warn("Re-score failed (HTTP error):", {
          status: response.status,
          statusText: response.statusText,
          details: apiError.message,
          raw: apiError.raw,
        });
        return;
      }

      const data = await response.json();

      if (data.success && data.record) {
        const resolvedHubspotCompany =
          data.hubspotCompanyData ||
          data.record?.hubspotCompanyData ||
          hubspotCompanyData ||
          record.hubspotCompanyData ||
          null;
        const seededMetrics = withSeededDealTermMetrics(data.record.metrics, resolvedHubspotCompany);
        const nextRecord = {
          ...data.record,
          metrics: seededMetrics,
          score: buildScoreWithComposedAnswers(data.record.score, seededMetrics),
        };
        setRecord(nextRecord);
        if (resolvedHubspotCompany) {
          setHubspotCompanyData(resolvedHubspotCompany);
        }
        if (data.skipped && data.message) {
          setRescoreDialogText(data.message);
        }
        const explanation = data.record?.score?.rescoreExplanation;
        if (explanation && typeof explanation === "string" && explanation.trim().length > 0) {
          setRescoreDialogText(explanation);
        }
        if (Array.isArray(data.documentWarnings) && data.documentWarnings.length > 0) {
          setDocumentReadWarning(data.documentWarnings.slice(0, 3).join(" "));
        }
        setRescoreProgress("Re-score complete.");
      } else {
        const message = data?.error || "Failed to re-score";
        setError(message);
        console.warn("Re-score failed (application error):", {
          status: response.status,
          data,
          message,
        });
      }
    } catch (err) {
      console.error("Error re-scoring:", err);
      setError("Failed to re-score diligence");
    } finally {
      clearInterval(rescoreProgressTimer);
      setRescoring(false);
      setTimeout(() => setRescoreProgress(""), 1200);
    }
  };

  const handleRescoreCategory = async (categoryName: string) => {
    if (!record) return;
    setRescoring(true);
    setRescoringCategoryName(categoryName);
    setRescoreProgress(`Re-scoring ${categoryName} category...`);
    setError(null);
    setDocumentReadWarning(null);
    setShowRescoreDialog(false);
    setShowRescoreMenu(false);

    try {
      const response = await fetch("/api/diligence/rescore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diligenceId: id, categoryName }),
      });
      if (!response.ok) {
        const apiError = await parseApiError(response);
        setError(apiError.message || `Failed to re-score ${categoryName}`);
        return;
      }

      const data = await response.json();
      if (data.success && data.record) {
        const resolvedHubspotCompany =
          data.hubspotCompanyData ||
          data.record?.hubspotCompanyData ||
          hubspotCompanyData ||
          record.hubspotCompanyData ||
          null;
        const seededMetrics = withSeededDealTermMetrics(data.record.metrics, resolvedHubspotCompany);
        const nextRecord = {
          ...data.record,
          metrics: seededMetrics,
          score: buildScoreWithComposedAnswers(data.record.score, seededMetrics),
        };
        setRecord(nextRecord);
        if (resolvedHubspotCompany) {
          setHubspotCompanyData(resolvedHubspotCompany);
        }
        if (Array.isArray(data.documentWarnings) && data.documentWarnings.length > 0) {
          setDocumentReadWarning(data.documentWarnings.slice(0, 3).join(" "));
        }
        setRescoreProgress(`${categoryName} category re-score complete.`);
      } else {
        setError(data?.error || `Failed to re-score ${categoryName}`);
      }
    } catch (err) {
      console.error("Error re-scoring category:", err);
      setError(`Failed to re-score ${categoryName}`);
    } finally {
      setRescoring(false);
      setRescoringCategoryName(null);
      setTimeout(() => setRescoreProgress(""), 1200);
    }
  };

  const handleSaveOverride = async (overrideScore: number, reason: string, suppressRiskTopics: string[]) => {
    if (!record || !editingCategory) return;

    try {
      const response = await fetch(`/api/diligence/${id}/override-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryName: editingCategory.category,
          overrideScore,
          reason,
          suppressRiskTopics,
          action: 'apply',
        }),
      });

      const data = await response.json();

      if (data.success && data.record) {
        setRecord(data.record);
        setEditingCategory(null);
      } else {
        throw new Error(data.error || "Failed to save override");
      }
    } catch (err) {
      console.error("Error saving override:", err);
      throw err;
    }
  };

  const handleRemoveOverride = async () => {
    if (!record || !editingCategory) return;

    try {
      const response = await fetch(`/api/diligence/${id}/override-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryName: editingCategory.category,
          action: 'remove',
        }),
      });

      const data = await response.json();

      if (data.success && data.record) {
        setRecord(data.record);
        setEditingCategory(null);
      } else {
        throw new Error(data.error || "Failed to remove override");
      }
    } catch (err) {
      console.error("Error removing override:", err);
      throw err;
    }
  };

  const performDelete = async (folderAction: 'keep' | 'archive' | 'delete') => {
    if (!record) return;

    try {
      const response = await fetch(`/api/diligence/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderAction }),
      });

      const data = await response.json();

      if (data.success) {
        // Navigate back to list
        router.push('/diligence');
      } else {
        setError(data.error || 'Failed to delete record');
      }
    } catch (err) {
      console.error('Error deleting record:', err);
      setError('Failed to delete record');
    }
  };

  const handleDelete = async () => {
    if (!record) return;
    setShowDeleteDialog(true);
  };

  const normalizeFounderLinkedInUrl = (value?: string): string => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^www\./i.test(trimmed) || /^linkedin\.com\//i.test(trimmed) || /^linkedin\.com$/i.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return trimmed;
  };

  const isPlaceholderFounderName = (value?: string): boolean => {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return true;
    return /^(not provided|unknown|n\/a|na|none|not specified|tbd)$/i.test(normalized);
  };

  const resolveFounderLinkedInHref = (founder: { name?: string; linkedinUrl?: string }): string => {
    if (isPlaceholderFounderName(founder.name)) return "";
    const normalized = normalizeFounderLinkedInUrl(founder.linkedinUrl);
    if (normalized) return normalized;
    const name = String(founder.name || "").trim();
    if (!name) return "";
    return `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(name)}`;
  };

  const handleSaveFounders = async () => {
    if (!record) return;

    setSavingFounders(true);
    try {
      // Filter out empty entries
      const validFounders = editingFounders
        .filter(f => f.name.trim() && !isPlaceholderFounderName(f.name))
        .map((founder) => ({
          ...founder,
          linkedinUrl: normalizeFounderLinkedInUrl(founder.linkedinUrl),
        }));

      const response = await fetch(`/api/diligence/${id}/founders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ founders: validFounders }),
      });

      const data = await response.json();

      if (data.success) {
        setRecord(data.record);
        setShowFoundersModal(false);
      } else {
        setError(data.error || 'Failed to update founders');
      }
    } catch (err) {
      console.error('Error updating founders:', err);
      setError('Failed to update founders');
    } finally {
      setSavingFounders(false);
    }
  };

  const handleEditThesis = () => {
    if (!record?.score?.thesisAnswers) return;
    const nextAnswers = JSON.parse(JSON.stringify(record.score.thesisAnswers));
    if (!Array.isArray(nextAnswers.whyMightFit) || nextAnswers.whyMightFit.length === 0) {
      nextAnswers.whyMightFit = resolveWhyMightFitItems();
    }
    setEditedThesisAnswers(nextAnswers);
    setEditingThesis(true);
  };

  const handleSaveThesis = async () => {
    if (!record || !editedThesisAnswers) return;

    setSavingThesis(true);
    try {
      const response = await fetch(`/api/diligence/${id}/thesis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thesisAnswers: editedThesisAnswers }),
      });

      const data = await response.json();

      if (data.success) {
        setRecord(data.record);
        setEditingThesis(false);
        setEditedThesisAnswers(null);
      } else {
        setError(data.error || 'Failed to update thesis');
      }
    } catch (err) {
      console.error('Error updating thesis:', err);
      setError('Failed to update thesis');
    } finally {
      setSavingThesis(false);
    }
  };

  const handleCancelEditThesis = () => {
    setEditingThesis(false);
    setEditedThesisAnswers(null);
  };

  const handleAddQuestion = async () => {
    if (!newQuestion.trim() || !record) return;
    const question: DiligenceQuestion = {
      id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      question: newQuestion.trim(),
      answer: newAnswer.trim() || undefined,
      status: 'open', // Always start as open, user will manually update
      category: newCategory,
      createdAt: new Date().toISOString(),
    };
    const updatedQuestions = [...questions, question];
    setQuestions(updatedQuestions);
    setNewQuestion("");
    setNewAnswer("");
    setNewCategory("Other");
    setIsAddingQuestion(false);
    await saveQuestions(updatedQuestions);
  };

  const handleCancelAddQuestion = () => {
    setIsAddingQuestion(false);
    setNewQuestion("");
    setNewAnswer("");
    setNewCategory("Other");
  };

  const handleStartEdit = (questionId: string, field: 'question' | 'answer') => {
    const question = questions.find(q => q.id === questionId);
    if (!question) return;
    setEditingCell({ questionId, field });
    setEditDraft(field === 'question' ? question.question : (question.answer || ''));
  };

  const handleSaveEdit = async () => {
    if (!editingCell || !record) return;
    const { questionId, field } = editingCell;
    
    const updatedQuestions = questions.map(q => {
      if (q.id !== questionId) return q;
      
      if (field === 'question') {
        return { ...q, question: editDraft.trim() || q.question };
      } else {
        // Editing answer - don't auto-change status
        return {
          ...q,
          answer: editDraft.trim() || undefined,
        };
      }
    });
    
    setQuestions(updatedQuestions);
    setEditingCell(null);
    setEditDraft("");
    await saveQuestions(updatedQuestions);
  };

  const handleCancelEdit = () => {
    setEditingCell(null);
    setEditDraft("");
  };

  const handleUpdateCategory = async (questionId: string, newCategory: string) => {
    if (!record) return;
    const updatedQuestions = questions.map(q =>
      q.id === questionId ? { ...q, category: newCategory } : q
    );
    setQuestions(updatedQuestions);
    await saveQuestions(updatedQuestions);
  };

  const handleUpdateQuestionStatus = async (questionId: string, newStatus: 'open' | 'answered') => {
    if (!record) return;
    const updatedQuestions = questions.map(q => {
      if (q.id !== questionId) return q;
      return {
        ...q,
        status: newStatus,
        answeredAt: newStatus === 'answered' ? (q.answeredAt || new Date().toISOString()) : undefined,
      };
    });
    setQuestions(updatedQuestions);
    await saveQuestions(updatedQuestions);
  };

  const isQuestionClosed = (q: DiligenceQuestion): boolean => q.status === "answered" || (q.status as string) === "closed";
  const isQuestionOpen = (q: DiligenceQuestion): boolean => !isQuestionClosed(q);
  const getQuestionUiStatus = (q: DiligenceQuestion): "open" | "closed" => (isQuestionClosed(q) ? "closed" : "open");

  const filteredQuestions = useMemo(() => {
    if (questionStatusFilter === "both") return questions;
    if (questionStatusFilter === "open") return questions.filter(isQuestionOpen);
    return questions.filter(isQuestionClosed);
  }, [questions, questionStatusFilter]);

  const handleUpdateQuestionStatusUi = async (questionId: string, newStatus: "open" | "closed") => {
    const normalizedStatus: "open" | "answered" = newStatus === "closed" ? "answered" : "open";
    await handleUpdateQuestionStatus(questionId, normalizedStatus);
  };

  const handleCopyFilteredQuestions = async () => {
    if (filteredQuestions.length === 0) return;
    const text = filteredQuestions
      .map((q) => {
        const questionText = String(q.question || "").replace(/\s+/g, " ").trim();
        const answerText = String(q.answer || "").replace(/\s+/g, " ").trim();
        if (answerText) {
          return `- ${questionText} -> ${answerText}`;
        }
        return `- ${questionText}`;
      })
      .join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopiedQuestions(true);
      setTimeout(() => setCopiedQuestions(false), 1800);
    } catch (err) {
      console.error("Failed to copy questions:", err);
      setError("Failed to copy questions to clipboard");
    }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!record) return;
    const updatedQuestions = questions.filter(q => q.id !== questionId);
    setQuestions(updatedQuestions);
    await saveQuestions(updatedQuestions);
  };

  const saveQuestions = async (updatedQuestions: DiligenceQuestion[]) => {
    setSavingQuestions(true);
    try {
      const response = await fetch(`/api/diligence/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: updatedQuestions }),
      });
      const data = await response.json();
      if (data.success) {
        setRecord(data.record);
      } else {
        setError(data.error || 'Failed to save questions');
      }
    } catch (err) {
      console.error('Error saving questions:', err);
      setError('Failed to save questions');
    } finally {
      setSavingQuestions(false);
    }
  };

  const isQuestionSimilar = (newQuestion: string, existingQuestion: string): boolean => {
    // Simple semantic matching: normalize and check for substantial overlap
    const normalize = (str: string) => str.toLowerCase().trim().replace(/[?.,!]/g, '');
    const newNorm = normalize(newQuestion);
    const existNorm = normalize(existingQuestion);
    
    // If 70% of words overlap, consider it similar
    const newWords = new Set(newNorm.split(/\s+/));
    const existWords = new Set(existNorm.split(/\s+/));
    const intersection = new Set([...newWords].filter(w => existWords.has(w)));
    const similarity = intersection.size / Math.min(newWords.size, existWords.size);
    
    return similarity > 0.7;
  };

  const handleAddAiQuestionToTracker = async (aiQuestion: string) => {
    if (!record) return;
    
    // Check if this question or a similar one already exists and is answered
    const answeredQuestions = questions.filter(isQuestionClosed);
    const isDuplicate = answeredQuestions.some(q => isQuestionSimilar(aiQuestion, q.question));
    
    if (isDuplicate) {
      // Question already answered, skip
      return;
    }

    // Check if it's already in the open questions
    const openQuestions = questions.filter(q => q.status === 'open');
    const isAlreadyOpen = openQuestions.some(q => isQuestionSimilar(aiQuestion, q.question));
    
    if (isAlreadyOpen) {
      // Already exists in open questions, skip
      return;
    }

    // Add as new question
    const question: DiligenceQuestion = {
      id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      question: aiQuestion.trim(),
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    const updatedQuestions = [...questions, question];
    setQuestions(updatedQuestions);
    await saveQuestions(updatedQuestions);
  };

  const togglePdfSection = (section: string) => {
    const newSections = new Set(selectedPdfSections);
    if (newSections.has(section)) {
      newSections.delete(section);
    } else {
      newSections.add(section);
    }
    setSelectedPdfSections(newSections);
  };

  const toggleAllPdfSections = () => {
    if (selectedPdfSections.size === 8) {
      setSelectedPdfSections(new Set());
    } else {
      setSelectedPdfSections(new Set(['overview', 'score', 'metrics', 'categories', 'thesis', 'followup', 'questions', 'notes']));
    }
  };

  const handleGeneratePdf = () => {
    if (selectedPdfSections.size === 0) {
      alert('Please select at least one section to export');
      return;
    }
    setGeneratingPdf(true);
    setShowPdfModal(false);
  };

  const handleUploadDocuments = async (files: FileList | null) => {
    if (!files || files.length === 0 || !record) return;

    try {
      setUploading(true);
      setError(null);

      const formData = new FormData();
      formData.append('diligenceId', id);
      formData.append('companyName', record.companyName);

      Array.from(files).forEach(file => {
        formData.append('files', file);
      });

      const response = await fetch('/api/diligence/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        // Reload the record to show new documents
        fetchRecord();
      } else {
        setError(data.error || 'Failed to upload documents');
      }
    } catch (err) {
      console.error('Error uploading documents:', err);
      setError('Failed to upload documents');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleAddLink = async () => {
    if (!linkName.trim() || !linkUrl.trim() || !record) return;

    try {
      setUploading(true);
      setError(null);
      const formData = new FormData();
      formData.append('diligenceId', id);
      formData.append('companyName', record.companyName);
      formData.append(
        'documentLinks',
        JSON.stringify([
          {
            name: linkName.trim(),
            url: linkUrl.trim(),
            email: linkEmail.trim() || undefined,
          },
        ])
      );

      const response = await fetch('/api/diligence/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        await fetchRecord();
        setLinkName("");
        setLinkUrl("");
        setLinkEmail("");
        setAddingLink(false);
        if (Array.isArray(data.errors) && data.errors.length > 0) {
          setError(`Link added with warnings: ${data.errors[0]}`);
        }
      } else {
        setError(data.error || 'Failed to add link');
      }
    } catch (err) {
      console.error('Error adding link:', err);
      setError('Failed to add link');
    } finally {
      setUploading(false);
    }
  };

  const toggleCategory = (categoryName: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryName)) {
        newSet.delete(categoryName);
      } else {
        newSet.add(categoryName);
      }
      return newSet;
    });
  };

  const scoringGridRowKey = (categoryName: string, criterionName: string) =>
    `${categoryName}::${criterionName}`;

  const getAnswerBuilderForCriterion = (categoryName: string, criterionName: string): string | undefined => {
    const exactKey = scoringGridRowKey(categoryName, criterionName);
    const exact = criteriaByRowKey[exactKey]?.answerBuilder;
    if (exact) return exact;

    const normalizeKeyPart = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normalizedKey = `${normalizeKeyPart(categoryName)}::${normalizeKeyPart(criterionName)}`;
    const normalized = criteriaByNormalizedRowKey[normalizedKey]?.answerBuilder;
    if (normalized) return normalized;

    // Sensible fallback for team proof-point criterion when sheet template isn't configured yet.
    if (/strengths?.*proof\s*points?.*team|team.*strengths?.*proof\s*points?/i.test(criterionName)) {
      return "{{teamStrengthLabel}}";
    }
    if (/(industry|sector|vertical|what\s+space\s+is\s+it\s+in|space\s+is\s+it\s+in)/i.test(criterionName)) {
      return "Primary industry: {{industry}}.";
    }
    if (/location|hq|headquarters/i.test(criterionName)) {
      return "Company location: {{location}}.";
    }
    if (/(business\s+model|revenue\s+model|how\s+do(?:es)?\s+.*make\s+money|pricing|monetiz)/i.test(criterionName)) {
      return "{{businessModelThesis}}";
    }
    if (/(synerg|portfolio|mudita)/i.test(criterionName)) {
      return "{{portfolioSynergyLevel}}";
    }
    if (/(necess|vitamin|advil|vaccine|problem\s+they\s+are\s+solving)/i.test(criterionName)) {
      return "Problem necessity: {{problemNecessityClass}}.";
    }
    if (/(market\s*growth|how\s+quickly|how\s+slowly|growth\s+rate)/i.test(criterionName)) {
      return "Estimated market growth: {{marketGrowthRate}} ({{marketGrowthBand}}). Confidence: {{marketGrowthConfidence}}%. Evidence: {{marketGrowthEvidence}}. Summary: {{marketGrowthSummary}}.";
    }
    return undefined;
  };

  const resolvePreferredIndustry = (
    recordIndustry?: string,
    companyData?: HubSpotCompanyData | null
  ): string | undefined => {
    const preferred =
      recordIndustry?.trim() ||
      companyData?.industrySector?.trim() ||
      companyData?.investmentSector?.trim() ||
      companyData?.industry?.trim();
    return preferred || undefined;
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

  const inferIndustryFromRecord = (record: DiligenceRecord, companyData?: HubSpotCompanyData | null): string => {
    if (hubspotIndustryOptions.length === 0) return "";
    const corpus = [
      record.companyName || "",
      record.companyOneLiner || "",
      record.companyDescription || "",
      companyData?.description || "",
      companyData?.industrySector || "",
      companyData?.investmentSector || "",
    ]
      .join(" ")
      .toLowerCase();
    if (!corpus.trim()) return "";

    const aliasRules: Array<{ pattern: RegExp; optionPattern: RegExp }> = [
      { pattern: /\b(ai|artificial intelligence|machine learning|ml|llm)\b/i, optionPattern: /\b(ai|artificial intelligence|machine learning|data)\b/i },
      { pattern: /\b(fintech|payments|banking|lending|insurtech|insurance)\b/i, optionPattern: /\b(finance|fintech|insurance|bank)\b/i },
      { pattern: /\b(health|healthcare|medtech|biotech|pharma|clinical)\b/i, optionPattern: /\b(health|medical|biotech|pharma)\b/i },
      { pattern: /\b(travel|hospitality|camping|outdoor)\b/i, optionPattern: /\b(travel|hospitality|leisure|consumer)\b/i },
      { pattern: /\b(real estate|property|proptech|construction)\b/i, optionPattern: /\b(real estate|property|construction)\b/i },
      { pattern: /\b(cybersecurity|security|identity|compliance)\b/i, optionPattern: /\b(security|cyber|compliance)\b/i },
    ];
    for (const rule of aliasRules) {
      if (!rule.pattern.test(corpus)) continue;
      const match = hubspotIndustryOptions.find((option) => rule.optionPattern.test(`${option.label} ${option.value}`));
      if (match?.value) return match.value;
    }

    const tokenize = (value: string): string[] =>
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !["and", "the", "for", "with", "services", "software"].includes(token));

    let best: { value: string; score: number } | null = null;
    for (const option of hubspotIndustryOptions) {
      const tokens = Array.from(new Set([...tokenize(option.label), ...tokenize(option.value)]));
      let score = 0;
      for (const token of tokens) {
        if (corpus.includes(token)) score += token.length >= 6 ? 2 : 1;
      }
      if (!best || score > best.score) {
        best = { value: option.value, score };
      }
    }
    return best && best.score >= 2 ? best.value : "";
  };

  const mapIndustryValueToDisplayLabel = (rawIndustry: string): string => {
    const normalized = rawIndustry.trim().toLowerCase();
    if (!normalized) return "";
    const byValue = hubspotIndustryOptions.find((option) => option.value.trim().toLowerCase() === normalized);
    if (byValue) return byValue.label;
    const byLabel = hubspotIndustryOptions.find((option) => option.label.trim().toLowerCase() === normalized);
    if (byLabel) return byLabel.label;
    const humanized = rawIndustry
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
    return humanized || rawIndustry;
  };

  const mapPriorityValueToDisplayLabel = (rawPriority: string): string => {
    const normalized = rawPriority.trim().toLowerCase();
    if (!normalized) return "";
    const byValue = hubspotPriorityOptions.find((option) => option.value.trim().toLowerCase() === normalized);
    if (byValue) return byValue.label;
    const byLabel = hubspotPriorityOptions.find((option) => option.label.trim().toLowerCase() === normalized);
    if (byLabel) return byLabel.label;
    if (normalized.includes("high")) return "High";
    if (normalized.includes("medium")) return "Medium";
    if (normalized.includes("low")) return "Low";
    return rawPriority;
  };

  const getPriorityBadge = (rawPriority: string | undefined, isClickable = false) => {
    const normalized = String(rawPriority || "").trim().toLowerCase();
    let colorClass = "bg-gray-100 text-gray-600";
    let label = "Not set";
    if (normalized.includes("high")) {
      colorClass = "bg-red-100 text-red-800";
      label = "High";
    } else if (normalized.includes("medium")) {
      colorClass = "bg-yellow-100 text-yellow-800";
      label = "Medium";
    } else if (normalized.includes("low")) {
      colorClass = "bg-blue-100 text-blue-800";
      label = "Low";
    }
    return (
      <span
        className={`px-2 py-1 text-xs font-semibold rounded-full ${colorClass} ${
          isClickable ? "cursor-pointer hover:opacity-80 transition-opacity" : ""
        }`}
      >
        {label}
      </span>
    );
  };

  const getHubSpotStageBadge = (stageId: string | undefined, stageLabel: string | undefined, isClickable = false) => {
    if (!stageId || !stageLabel) {
      return (
        <span className={`px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-600 ${isClickable ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}>
          Not Linked
        </span>
      );
    }
    const lowerLabel = stageLabel.toLowerCase();
    let colorClass = "bg-blue-100 text-blue-800";
    if (lowerLabel.includes("closed") && lowerLabel.includes("won")) {
      colorClass = "bg-green-100 text-green-800";
    } else if (lowerLabel.includes("closed") || lowerLabel.includes("lost") || lowerLabel.includes("rejected")) {
      colorClass = "bg-red-100 text-red-800";
    } else if (lowerLabel.includes("qualified") || lowerLabel.includes("presentation")) {
      colorClass = "bg-yellow-100 text-yellow-800";
    }
    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${colorClass} ${isClickable ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}>
        {stageLabel}
      </span>
    );
  };

  const chooseIndustryValue = (preferred: string | undefined, options: HubSpotSelectOption[]): string => {
    const preferredMatch = preferred ? mapIndustryGuessToOptionValue(preferred, options) : "";
    if (preferredMatch) return preferredMatch;
    if (record) {
      const inferred = inferIndustryFromRecord(record, hubspotCompanyData || record.hubspotCompanyData);
      if (inferred) return inferred;
    }
    const otherMatch = options.find((option) => /other/i.test(option.label));
    if (otherMatch?.value) return otherMatch.value;
    return "";
  };

  const composeAnswer = (
    template: string,
    metrics?: DiligenceMetrics,
    companyData?: HubSpotCompanyData | null,
    score?: DiligenceRecord["score"] | null,
    criterionName?: string,
    recordIndustry?: string,
    teamResearch?: DiligenceRecord["teamResearch"]
  ): string => {
    if (!template.trim()) return "";

    const parseNumeric = (raw?: string): number | undefined => {
      if (!raw) return undefined;
      const cleaned = raw.replace(/[$,%\s,]/g, "");
      if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined;
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const fundingAmountRaw = metrics?.fundingAmount?.value || companyData?.fundingAmount;
    const committedRaw = metrics?.committed?.value || companyData?.currentCommitments;
    const fundingAmount = parseNumeric(fundingAmountRaw);
    const committed = parseNumeric(committedRaw);
    const percentCommitted =
      fundingAmount && fundingAmount > 0 && committed !== undefined
        ? `${Math.round((committed / fundingAmount) * 100)}%`
        : undefined;
    const commitmentBand =
      fundingAmount && fundingAmount > 0 && committed !== undefined
        ? committed / fundingAmount >= 0.5
          ? "at least half committed"
          : committed / fundingAmount > 0
            ? "partially committed"
            : "no commitments"
        : undefined;
    const founderTamFromMetrics =
      metrics?.tam?.value &&
      (metrics?.tam?.source === "manual" ||
        metrics?.tam?.sourceDetail === "notes" ||
        metrics?.tam?.sourceDetail === "hubspot")
        ? metrics.tam.value
        : undefined;
    const founderTamFromIntel = score?.externalMarketIntelligence?.tamSamSom?.companyClaim?.tam;
    const founderTam =
      founderTamFromMetrics ||
      companyData?.tamRange ||
      (founderTamFromIntel && founderTamFromIntel.toLowerCase() !== "unknown" ? founderTamFromIntel : undefined);
    const locationFromCompany = ((companyData as any)?.location || [companyData?.city, companyData?.state, companyData?.country]
      .map((item) => (item || "").trim())
      .filter(Boolean)
      .join(", ")) || undefined;
    const resolvedIndustry = resolvePreferredIndustry(recordIndustry, companyData);
    const independentTam = score?.externalMarketIntelligence?.tamSamSom?.independentEstimate?.tam;
    const tamAlignment = score?.externalMarketIntelligence?.tamSamSom?.comparison?.alignment;
    const tamComparisonConfidence = score?.externalMarketIntelligence?.tamSamSom?.comparison?.confidence;
    const tamDeltaSummary = score?.externalMarketIntelligence?.tamSamSom?.comparison?.deltaSummary;
    const tamMethod = score?.externalMarketIntelligence?.tamSamSom?.independentEstimate?.method;
    const tamAssumptions = (score?.externalMarketIntelligence?.tamSamSom?.independentEstimate?.assumptions || [])
      .filter(Boolean)
      .slice(0, 3)
      .join("; ");
    const tamDeepExplanation = [
      `Founder TAM: ${founderTam || "unknown"}`,
      `Independent TAM: ${independentTam || "unknown"}`,
      `Alignment: ${tamAlignment || "unknown"}`,
      tamComparisonConfidence !== undefined ? `Confidence: ${tamComparisonConfidence}%` : undefined,
      tamDeltaSummary ? `Delta: ${tamDeltaSummary}` : undefined,
      tamMethod ? `Method: ${tamMethod}` : undefined,
      tamAssumptions ? `Assumptions: ${tamAssumptions}` : undefined,
    ]
      .filter(Boolean)
      .join(" | ");
    const marketGrowthRate =
      metrics?.marketGrowthRate?.value ||
      score?.externalMarketIntelligence?.marketGrowth?.estimatedCagr;
    const marketGrowthBand =
      score?.externalMarketIntelligence?.marketGrowth?.growthBand ||
      (marketGrowthRate
        ? (() => {
            const match = marketGrowthRate.match(/(-?\d+(?:\.\d+)?)\s*%/);
            const pct = match ? Number(match[1]) : NaN;
            if (!Number.isFinite(pct)) return "unknown";
            if (pct >= 20) return "high";
            if (pct >= 8) return "moderate";
            if (pct >= 0) return "low";
            return "unknown";
          })()
        : "unknown");
    const marketGrowthConfidence = score?.externalMarketIntelligence?.marketGrowth?.confidence;
    const marketGrowthSummary = score?.externalMarketIntelligence?.marketGrowth?.summary;
    const marketGrowthEvidence = (score?.externalMarketIntelligence?.marketGrowth?.evidence || [])
      .filter(Boolean)
      .slice(0, 3)
      .join("; ");
    const flattenedCriteria = (score?.categories || []).flatMap((category) => category.criteria || []);
    const businessModelCriterion = flattenedCriteria.find((criterion) =>
      /(business\s+model|revenue\s+model|pricing|monetization|how\s+do(?:es)?\s+.*make\s+money)/i.test(
        criterion.name || ""
      )
    );
    const businessModelSummary = (
      businessModelCriterion?.answer ||
      businessModelCriterion?.reasoning ||
      ""
    )
      .toString()
      .trim();
    const businessModelThesis = (() => {
      const fromHubSpot = (companyData?.productCategorization || "").trim();
      const normalized = fromHubSpot.toLowerCase();
      if (normalized.includes("b2b saas")) return "B2B SaaS";
      if (normalized.includes("b2c saas")) return "B2C SaaS";
      if (normalized.includes("b2b")) return "B2B";
      if (normalized.includes("b2c")) return "B2C";
      if (normalized.includes("marketplace")) return "Marketplace";
      if (normalized.includes("subscription")) return "Subscription";
      if (normalized.includes("transaction")) return "Transaction-based";
      if (fromHubSpot) {
        return fromHubSpot
          .split(/[;|,]/)
          .map((part) => part.trim())
          .filter(Boolean)[0];
      }

      const fromReasoningMatch = businessModelSummary.match(
        /\b(B2B\s*SaaS|B2C\s*SaaS|B2B|B2C|Marketplace|Subscription|Transaction(?:-based)?)\b/i
      );
      if (fromReasoningMatch?.[1]) {
        const raw = fromReasoningMatch[1].trim();
        if (/^b2b\s*saas$/i.test(raw)) return "B2B SaaS";
        if (/^b2c\s*saas$/i.test(raw)) return "B2C SaaS";
        if (/^b2b$/i.test(raw)) return "B2B";
        if (/^b2c$/i.test(raw)) return "B2C";
        if (/^transaction/i.test(raw)) return "Transaction-based";
        return raw.charAt(0).toUpperCase() + raw.slice(1);
      }
      return undefined;
    })();
    const teamFounders = teamResearch?.founders || [];
    const teamScore = teamResearch?.teamScore;
    const teamSummary = teamResearch?.summary;
    const teamStrengthLabel = (() => {
      const exitsCount = teamFounders.flatMap((founder) => founder.priorExits || []).filter(Boolean).length;
      if (exitsCount > 0 && (teamScore === undefined || teamScore >= 65)) return "Strong team with exits";
      if ((teamScore !== undefined && teamScore >= 70) || teamFounders.length >= 2) return "Strong team";
      return "Average team";
    })();
    const teamFounderHighlights = teamFounders.length
      ? teamFounders
          .map((founder) => {
            const signals = [
              founder.hasPriorExit ? "exit" : undefined,
              founder.hasBeenCEO ? "prior CEO" : undefined,
              founder.hasBeenCTO ? "prior CTO" : undefined,
            ]
              .filter(Boolean)
              .join(", ");
            return `${founder.name}${founder.title ? ` (${founder.title})` : ""}${signals ? ` [${signals}]` : ""}`;
          })
          .join("; ")
      : undefined;
    const teamPriorExits = teamFounders
      .flatMap((founder) => founder.priorExits || [])
      .filter(Boolean)
      .slice(0, 8)
      .join("; ");
    const ceoFounder = teamFounders.find((founder) => /(^|\b)ceo(\b|$)/i.test(founder.title || ""));
    const ctoFounder = teamFounders.find((founder) => /(^|\b)cto(\b|$)/i.test(founder.title || ""));
    const portfolioSynergy = record?.portfolioSynergyResearch;
    const portfolioSynergyLevel = (() => {
      const scoreValue = portfolioSynergy?.synergyScore;
      if (scoreValue !== undefined) {
        if (scoreValue >= 70) return "High Synergies";
        if (scoreValue >= 40) return "Some Synergies";
        return "Minimal Synergies";
      }
      const matchesCount = portfolioSynergy?.matches?.length || 0;
      if (matchesCount >= 4) return "High Synergies";
      if (matchesCount >= 2) return "Some Synergies";
      return "Minimal Synergies";
    })();
    const portfolioSynergyTopMatches = (portfolioSynergy?.matches || [])
      .slice(0, 5)
      .map((match) => `${match.companyName} (${match.synergyType})`)
      .join("; ");
    const problemNecessity = record?.problemNecessityResearch;
    const problemNecessityClassLabel = (() => {
      const raw = (problemNecessity?.classification || "").trim().toLowerCase();
      if (!raw) return undefined;
      if (raw === "vitamin") return "Vitamin";
      if (raw === "advil") return "Advil";
      if (raw === "vaccine") return "Vaccine";
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    })();
    const problemNecessityTopSignals = (problemNecessity?.topSignals || [])
      .slice(0, 5)
      .map((signal) => `${signal.label}${signal.strength ? ` (${signal.strength})` : ""}`)
      .join("; ");
    const problemNecessityCounterSignals = (problemNecessity?.counterSignals || [])
      .slice(0, 5)
      .map((signal) => `${signal.label}${signal.strength ? ` (${signal.strength})` : ""}`)
      .join("; ");

    const metricValueByToken: Record<string, string | undefined> = {
      fundingAmount: metrics?.fundingAmount?.value,
      committed: metrics?.committed?.value,
      valuation: metrics?.valuation?.value,
      dealTerms: metrics?.dealTerms?.value,
      currentRunway: metrics?.currentRunway?.value || companyData?.currentRunway,
      postFundingRunway: metrics?.postFundingRunway?.value || companyData?.postFundingRunway,
      location: metrics?.location?.value || locationFromCompany,
      arr: metrics?.arr?.value,
      tam: metrics?.tam?.value,
      acv: metrics?.acv?.value,
      marketGrowthRate,
      yoyGrowthRate: metrics?.yoyGrowthRate?.value,
      hsFundingAmount: metrics?.fundingAmount?.value,
      hsCurrentCommitments: metrics?.committed?.value,
      hsFundingValuation: metrics?.valuation?.value,
      hsDealTerms: metrics?.dealTerms?.value,
      hsLeadInformation: companyData?.leadInformation,
      hsCurrentRunway: metrics?.currentRunway?.value || companyData?.currentRunway,
      hsPostFundingRunway: metrics?.postFundingRunway?.value || companyData?.postFundingRunway,
      hsLocation: metrics?.location?.value || locationFromCompany,
      leadInformation: companyData?.leadInformation,
      lead: metrics?.lead?.value || companyData?.leadInformation,
      annualRevenue: metrics?.arr?.value,
      percentCommitted,
      commitmentBand,
      founderTam,
      independentTam,
      tamAlignment,
      tamComparisonConfidence:
        tamComparisonConfidence !== undefined ? `${tamComparisonConfidence}%` : undefined,
      tamDeltaSummary,
      tamMethod,
      tamAssumptions,
      tamDeepExplanation,
      marketGrowthBand,
      marketGrowthConfidence:
        marketGrowthConfidence !== undefined ? `${marketGrowthConfidence}%` : undefined,
      marketGrowthSummary,
      marketGrowthEvidence,
      industry: resolvedIndustry,
      businessModel: businessModelSummary || undefined,
      businessModelSummary: businessModelSummary || undefined,
      businessModelThesis,
      teamStrengthLabel,
      teamScore: teamScore !== undefined ? String(teamScore) : undefined,
      teamSummary,
      teamFounderHighlights,
      teamPriorExits: teamPriorExits || undefined,
      teamCeoExperience: ceoFounder
        ? ceoFounder.hasBeenCEO
          ? "yes"
          : "no evidence"
        : "unknown",
      teamCtoExperience: ctoFounder
        ? ctoFounder.hasBeenCTO
          ? "yes"
          : "no evidence"
        : "unknown",
      portfolioSynergyScore:
        portfolioSynergy?.synergyScore !== undefined
          ? String(portfolioSynergy.synergyScore)
          : undefined,
      portfolioSynergySummary: portfolioSynergy?.summary,
      portfolioSynergyTopMatches: portfolioSynergyTopMatches || undefined,
      portfolioSynergyLevel,
      problemNecessityScore:
        problemNecessity?.necessityScore !== undefined
          ? String(problemNecessity.necessityScore)
          : undefined,
      problemNecessityClass: problemNecessityClassLabel,
      problemNecessitySummary: problemNecessity?.summary,
      problemNecessityTopSignals: problemNecessityTopSignals || undefined,
      problemNecessityCounterSignals: problemNecessityCounterSignals || undefined,
    };

    const normalizeToken = (raw: string) =>
      raw
        .trim()
        .replace(/[{}]/g, "")
        .replace(/[\s\-\/]/g, "")
        .replace(/[^a-zA-Z0-9_]/g, "")
        .replace(/^HS/i, "hs")
        .replace(/^hs/, "hs")
        .replace(/^([a-z])/, (ch) => ch.toLowerCase());

    const toPascalCase = (value: string) =>
      value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");

    // Dynamic aliasing so new HubSpot placeholders resolve without hardcoding.
    // Example: "HS Product Categorization" -> hsProductCategorization
    if (companyData) {
      for (const [rawKey, rawValue] of Object.entries(companyData)) {
        if (typeof rawValue !== "string") continue;
        const trimmedValue = rawValue.trim();
        if (!trimmedValue) continue;
        const key = rawKey.trim();
        const normalized = normalizeToken(key);
        const pascal = toPascalCase(key);
        if (!metricValueByToken[normalized]) {
          metricValueByToken[normalized] = trimmedValue;
        }
        const hsAlias = `hs${pascal}`.replace(/^hs([A-Z])/, (_m, first) => `hs${first}`);
        if (!metricValueByToken[hsAlias]) {
          metricValueByToken[hsAlias] = trimmedValue;
        }
      }
    }

    // Guardrail: business model criteria should not use investor lead context.
    if ((criterionName || "").toLowerCase().includes("business model")) {
      delete metricValueByToken.lead;
      delete metricValueByToken.leadInformation;
      delete metricValueByToken.hsLeadInformation;
    }

    const currencyTokens = new Set([
      "fundingAmount",
      "committed",
      "valuation",
      "arr",
      "tam",
      "acv",
      "annualRevenue",
      "hsFundingAmount",
      "hsCurrentCommitments",
      "hsFundingValuation",
    ]);

    const formatCompactCurrency = (raw: string): string => {
      const cleaned = raw.replace(/[$,\s]/g, "");
      if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
        return raw;
      }
      const numeric = Number(cleaned);
      if (!Number.isFinite(numeric)) {
        return raw;
      }
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(numeric);
    };

    return template.replace(/\{\{\s*([^{}]+?)\s*\}\}|\{\s*([^{}]+?)\s*\}/g, (_match, doubleToken, singleToken) => {
      const token = normalizeToken((doubleToken || singleToken || "").toString());
      const value = metricValueByToken[token]?.trim();
      if (value && currencyTokens.has(token)) {
        return formatCompactCurrency(value);
      }
      return value || "not available";
    });
  };

  const withSeededDealTermMetrics = (
    metrics: DiligenceMetrics | undefined,
    company: HubSpotCompanyData | null | undefined
  ): DiligenceMetrics | undefined => {
    if (!company) return metrics;
    const now = new Date().toISOString();
    const next: DiligenceMetrics = { ...(metrics || {}) };
    const maybeSeed = (
      key: "arr" | "tam" | "fundingAmount" | "committed" | "valuation" | "dealTerms" | "lead" | "currentRunway" | "postFundingRunway" | "location",
      value?: string
    ) => {
      const trimmed = value?.trim();
      if (!trimmed) return;
      const existing = next[key]?.value?.trim();
      if (existing) return;
      next[key] = {
        value: trimmed,
        source: "manual",
        updatedAt: now,
      };
    };

    // Keep Key Metrics in sync with HubSpot intake fields so users can see/edit them directly.
    maybeSeed("arr", company.annualRevenue);
    maybeSeed("tam", company.tamRange);
    maybeSeed("fundingAmount", company.fundingAmount);
    maybeSeed("committed", company.currentCommitments);
    maybeSeed("valuation", company.fundingValuation);
    maybeSeed("dealTerms", (company as any).dealTerms || (company as any).terms);
    maybeSeed("lead", company.leadInformation);
    maybeSeed("currentRunway", company.currentRunway);
    maybeSeed("postFundingRunway", company.postFundingRunway);
    maybeSeed(
      "location",
      ((company as any).location || [company.city, company.state, company.country].filter(Boolean).join(", "))
    );
    return next;
  };

  const buildScoreWithComposedAnswers = (
    score: DiligenceRecord["score"] | null | undefined,
    metrics: DiligenceMetrics | undefined
  ) => {
    if (!score) return score;
    return {
      ...score,
      categories: score.categories.map((category) => ({
        ...category,
        criteria: category.criteria.map((criterion) => {
          const answerBuilder = getAnswerBuilderForCriterion(category.category, criterion.name);
          if (!answerBuilder) return criterion;
          return {
            ...criterion,
            answer: composeAnswer(
              answerBuilder,
              metrics,
              hubspotCompanyData || record?.hubspotCompanyData,
              score,
              criterion.name,
              record?.industry,
              record?.teamResearch
            ),
          };
        }),
      })),
    };
  };

  const toggleScoringDetail = (rowKey: string) => {
    setExpandedScoringDetails((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  };

  const toggleScoringCategory = (categoryName: string) => {
    setExpandedScoringCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryName)) {
        next.delete(categoryName);
      } else {
        next.add(categoryName);
      }
      return next;
    });
  };

  const saveCriterionPerspective = async (categoryName: string, criterionName: string, perspective: string) => {
    if (!record?.score) return;

    const rowKey = scoringGridRowKey(categoryName, criterionName);
    const trimmedPerspective = perspective.trim();
    const currentCriterion = record.score.categories
      .find((category) => category.category === categoryName)
      ?.criteria.find((criterion) => criterion.name === criterionName);

    if (!currentCriterion) return;
    if ((currentCriterion.userPerspective || "") === trimmedPerspective) return;

    const updatedScore = {
      ...record.score,
      categories: record.score.categories.map((category) => {
        if (category.category !== categoryName) return category;
        return {
          ...category,
          criteria: category.criteria.map((criterion) =>
            criterion.name === criterionName
              ? { ...criterion, userPerspective: trimmedPerspective }
              : criterion
          ),
        };
      }),
    };

    setRecord((prev) => (prev ? { ...prev, score: updatedScore } : prev));
    setScoringPerspectiveDrafts((prev) => ({ ...prev, [rowKey]: trimmedPerspective }));
    setSavingScoringPerspectiveKey(rowKey);
    setError(null);

    try {
      const response = await fetch(`/api/diligence/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score: updatedScore }),
      });
      if (!response.ok) {
        const parsed = await parseApiError(response);
        throw new Error(parsed.message);
      }
      const data = await response.json();
      if (data.success) {
        setRecord(data.record);
      } else {
        throw new Error(data.error || "Failed to save user perspective");
      }
    } catch (err: any) {
      console.error("Error saving user perspective:", err);
      setError(err?.message || "Failed to save user perspective");
      await fetchRecord();
    } finally {
      setSavingScoringPerspectiveKey(null);
    }
  };

  const saveCriterionManualScore = async (categoryName: string, criterionName: string, rawValue: string) => {
    if (!record?.score) return;
    const rowKey = scoringGridRowKey(categoryName, criterionName);
    const trimmed = rawValue.trim();
    const currentCriterion = record.score.categories
      .find((category) => category.category === categoryName)
      ?.criteria.find((criterion) => criterion.name === criterionName);

    if (!currentCriterion) return;

    let nextManualOverride: number | undefined = undefined;
    if (trimmed.length > 0) {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        setError("Score must be a number between 0 and 100");
        setCriterionScoreDrafts((prev) => ({
          ...prev,
          [rowKey]: String(currentCriterion.manualOverride ?? currentCriterion.score),
        }));
        return;
      }
      nextManualOverride = Math.max(0, Math.min(100, Math.round(parsed)));
      if (nextManualOverride === currentCriterion.score) {
        // Matching AI score should clear manual override, not create one.
        nextManualOverride = undefined;
      }
    }

    if (currentCriterion.manualOverride === nextManualOverride) {
      setCriterionScoreDrafts((prev) => ({
        ...prev,
        [rowKey]: String(nextManualOverride ?? currentCriterion.score),
      }));
      return;
    }

    const updatedCategories = record.score.categories.map((category) => {
      if (category.category !== categoryName) return category;
      return {
        ...category,
        criteria: category.criteria.map((criterion) =>
          criterion.name === criterionName
            ? {
                ...criterion,
                ...(nextManualOverride !== undefined
                  ? { manualOverride: nextManualOverride }
                  : { manualOverride: undefined }),
              }
            : criterion
        ),
      };
    });

    // Recalculate category scores based on updated criteria
    const recalculatedCategories = updatedCategories.map((category) => {
      // Compute category score from criteria (accounting for criterion overrides)
      if (!category.criteria || category.criteria.length === 0) {
        return category;
      }
      const total = category.criteria.reduce((sum, criterion) => {
        const effectiveScore = criterion.manualOverride ?? criterion.score;
        return sum + effectiveScore;
      }, 0);
      const computedCategoryScore = Math.round(total / category.criteria.length);

      const effectiveCategoryScore = computedCategoryScore;
      const weightedScore = Number(((effectiveCategoryScore * category.weight) / 100).toFixed(2));

      return {
        ...category,
        weightedScore,
      };
    });

    // Recalculate overall score
    let totalWeightedScore = 0;
    let totalWeight = 0;
    for (const category of recalculatedCategories) {
      const effectiveScore =
        category.criteria && category.criteria.length > 0
          ? Math.round(
              category.criteria.reduce((sum, c) => sum + (c.manualOverride ?? c.score), 0) /
                category.criteria.length
            )
          : category.score;
      totalWeightedScore += effectiveScore * category.weight;
      totalWeight += category.weight;
    }
    const recalculatedOverall = totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : record.score.overall;

    const updatedScore = {
      ...record.score,
      overall: recalculatedOverall,
      categories: recalculatedCategories,
    };

    setRecord((prev) => (prev ? { ...prev, score: updatedScore } : prev));
    setCriterionScoreDrafts((prev) => ({
      ...prev,
      [rowKey]: String(nextManualOverride ?? currentCriterion.score),
    }));
    setSavingCriterionScoreKey(rowKey);
    setError(null);

    try {
      const response = await fetch(`/api/diligence/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score: updatedScore }),
      });
      if (!response.ok) {
        const parsed = await parseApiError(response);
        throw new Error(parsed.message);
      }
      const data = await response.json();
      if (data.success) {
        setRecord(data.record);
      } else {
        throw new Error(data.error || "Failed to save criterion score");
      }
    } catch (err: any) {
      console.error("Error saving criterion score override:", err);
      setError(err?.message || "Failed to save criterion score");
      await fetchRecord();
    } finally {
      setSavingCriterionScoreKey(null);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 80) return "bg-green-50 border-green-200";
    if (score >= 60) return "bg-yellow-50 border-yellow-200";
    return "bg-red-50 border-red-200";
  };

  const getEffectiveCriterionScore = (criterion: { score: number; manualOverride?: number }) =>
    criterion.manualOverride ?? criterion.score;

  const getComputedCategoryScoreFromCriteria = (category: CategoryScore) => {
    if (!category.criteria || category.criteria.length === 0) return category.score;
    const total = category.criteria.reduce((sum, criterion) => sum + getEffectiveCriterionScore(criterion), 0);
    return Math.round(total / category.criteria.length);
  };

  const getCriterionScoreInputValue = (
    rowKey: string,
    criterion: { score: number; manualOverride?: number }
  ) => criterionScoreDrafts[rowKey] ?? String(getEffectiveCriterionScore(criterion));

  const effectiveScoreModel = useMemo(() => {
    if (!record?.score) {
      return {
        overall: 0,
        categoryScores: {} as Record<string, number>,
        baseCategoryScores: {} as Record<string, number>,
      };
    }

    const baseCategoryScores: Record<string, number> = {};
    const categoryScores: Record<string, number> = {};
    for (const category of record.score.categories) {
      const baseCategoryScore = getComputedCategoryScoreFromCriteria(category);
      baseCategoryScores[category.category] = baseCategoryScore;
      categoryScores[category.category] = baseCategoryScore;
    }

    const totalWeight = record.score.categories.reduce((sum, category) => sum + category.weight, 0);
    const weightedSum = record.score.categories.reduce(
      (sum, category) => sum + (categoryScores[category.category] * category.weight),
      0
    );
    const overall =
      totalWeight > 0
        ? Math.round(weightedSum / totalWeight)
        : record.score.overall;

    return { overall, categoryScores, baseCategoryScores };
  }, [record?.score]);

  const preferredIndustry = resolvePreferredIndustry(
    record?.industry,
    hubspotCompanyData || record?.hubspotCompanyData
  );
  const preferredPriority = String(record?.priority || "").trim();
  const activeHubSpotPipeline =
    hubspotPipelineOptions.find((pipeline) => pipeline.id === record?.hubspotPipelineId) ||
    hubspotPipelineOptions.find((pipeline) => pipeline.label === "Fund II Deal Flow") ||
    hubspotPipelineOptions[0];
  const dealFlowPipelineOptions = hubspotPipelineOptions
    .filter((pipeline) => /deal\s*flow/i.test(pipeline.label || ""))
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  const activeHubSpotStages = [...(activeHubSpotPipeline?.stages || [])].sort(
    (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
  );
  const metricFields: MetricFieldConfig[] = [
    { key: "arr", label: "ARR", placeholder: "$1.2M" },
    { key: "tam", label: "TAM", placeholder: "$8B" },
    { key: "marketGrowthRate", label: "Market Growth Rate", placeholder: "12% CAGR" },
    { key: "acv", label: "ACV", placeholder: "$25K" },
    { key: "yoyGrowthRate", label: "YoY Growth Rate", placeholder: "48%" },
    { key: "fundingAmount", label: "Raise Amount ($M)", placeholder: "e.g. 4 or $4M" },
    { key: "committed", label: "Committed ($M)", placeholder: "e.g. 1.5 or $1.5M" },
    { key: "valuation", label: "Post-Money Valuation ($M)", placeholder: "e.g. 20 or $20M" },
    { key: "dealTerms", label: "Deal Terms", placeholder: "SAFE, 20% discount, no cap" },
    { key: "lead", label: "Lead", placeholder: "Lead investor / syndicate context" },
    { key: "currentRunway", label: "Current Runway", placeholder: "12 months" },
    { key: "postFundingRunway", label: "Post Runway Funding", placeholder: "18 months" },
    { key: "location", label: "Location", placeholder: "New York, NY, United States" },
  ];

  const metricsFromRecord = (input?: DiligenceMetrics) => ({
    arr: input?.arr?.value || "",
    tam: input?.tam?.value || "",
    marketGrowthRate: input?.marketGrowthRate?.value || "",
    acv: input?.acv?.value || "",
    yoyGrowthRate: input?.yoyGrowthRate?.value || "",
    fundingAmount: input?.fundingAmount?.value || "",
    committed: input?.committed?.value || "",
    valuation: input?.valuation?.value || "",
    dealTerms: input?.dealTerms?.value || "",
    lead: input?.lead?.value || "",
    currentRunway: input?.currentRunway?.value || "",
    postFundingRunway: input?.postFundingRunway?.value || "",
    location: input?.location?.value || "",
  });

  const mergeManualMetrics = (
    rawDraft: MetricDraftRecord
  ): DiligenceMetrics => {
    const now = new Date().toISOString();
    const buildMetric = (value: string): DiligenceMetricValue | undefined => {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      return {
        value: trimmed,
        source: "manual",
        updatedAt: now,
      };
    };

    return {
      arr: buildMetric(rawDraft.arr),
      tam: buildMetric(rawDraft.tam),
      marketGrowthRate: buildMetric(rawDraft.marketGrowthRate),
      acv: buildMetric(rawDraft.acv),
      yoyGrowthRate: buildMetric(rawDraft.yoyGrowthRate),
      fundingAmount: buildMetric(rawDraft.fundingAmount),
      committed: buildMetric(rawDraft.committed),
      valuation: buildMetric(rawDraft.valuation),
      dealTerms: buildMetric(rawDraft.dealTerms),
      lead: buildMetric(rawDraft.lead),
      currentRunway: buildMetric(rawDraft.currentRunway),
      postFundingRunway: buildMetric(rawDraft.postFundingRunway),
      location: buildMetric(rawDraft.location),
    };
  };

  const formatMetricValueForDisplay = (
    key: MetricDraftKey,
    value: string
  ): string => {
    if (!value.trim()) return value;
    if (key === "yoyGrowthRate" || key === "marketGrowthRate" || key === "lead" || key === "dealTerms" || key === "currentRunway" || key === "postFundingRunway" || key === "location") return value;

    const cleaned = value.replace(/[$,\s]/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
      return value;
    }

    const numeric = Number(cleaned);
    if (!Number.isFinite(numeric)) {
      return value;
    }

    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(numeric);
  };

  const startEditingMetrics = () => {
    setMetricsDraft(metricsFromRecord(record?.metrics));
    setEditingMetrics(true);
  };

  const cancelEditingMetrics = () => {
    setEditingMetrics(false);
    setMetricsDraft(metricsFromRecord(record?.metrics));
  };

  // Normalise a metric value that represents millions into a plain number string
  // suitable for HubSpot properties like raise_amount_in_millions.
  const normalizeMetricToMillions = (raw: string): string => {
    if (!raw) return "";
    const cleaned = raw.toLowerCase().replace(/[$,\s]/g, "");
    const match = cleaned.match(/^(-?\d+(?:\.\d+)?)([kmb])?$/);
    if (!match) return raw; // pass-through for ranges/text
    const base = Number(match[1]);
    if (!Number.isFinite(base)) return raw;
    let millions: number;
    if (match[2] === "b") millions = base * 1000;
    else if (match[2] === "m") millions = base;
    else if (match[2] === "k") millions = base / 1000;
    else millions = base > 100000 ? base / 1_000_000 : base;
    const rounded = Math.round(millions * 100) / 100;
    return Number.isInteger(rounded) ? String(Math.trunc(rounded)) : String(rounded);
  };

  const handleSaveMetrics = async () => {
    if (!record) return;
    setSavingMetrics(true);
    setError(null);
    try {
      const payloadMetrics = mergeManualMetrics(metricsDraft);
      const updatedScore = buildScoreWithComposedAnswers(record.score, payloadMetrics);
      const response = await fetch(`/api/diligence/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metrics: payloadMetrics, score: updatedScore }),
      });
      const data = await response.json();
      if (data.success) {
        const resolvedHubspotCompany =
          data.record?.hubspotCompanyData ||
          hubspotCompanyData ||
          record.hubspotCompanyData ||
          null;
        const seededMetrics = withSeededDealTermMetrics(data.record?.metrics, resolvedHubspotCompany);
        const nextRecord = data.record
          ? {
              ...data.record,
              metrics: seededMetrics,
              score: buildScoreWithComposedAnswers(data.record.score, seededMetrics),
            }
          : data.record;
        setRecord(nextRecord);
        if (resolvedHubspotCompany) {
          setHubspotCompanyData(resolvedHubspotCompany);
        }
        setEditingMetrics(false);

        // Push raise/committed/valuation/ARR straight to the linked HubSpot deal
        const linkedDealId = data.record?.hubspotDealId || record.hubspotDealId;
        if (linkedDealId) {
          const raiseRaw = payloadMetrics?.fundingAmount?.value || "";
          const committedRaw = payloadMetrics?.committed?.value || "";
          const valuationRaw = payloadMetrics?.valuation?.value || "";
          const arrRaw = payloadMetrics?.arr?.value || "";
          const hsProps: Record<string, string> = {};
          if (raiseRaw) hsProps["raise_amount_in_millions"] = normalizeMetricToMillions(raiseRaw);
          if (committedRaw) hsProps["committed_funding_in_millions"] = normalizeMetricToMillions(committedRaw);
          if (valuationRaw) hsProps["deal_valuation_post_money_in_millions"] = normalizeMetricToMillions(valuationRaw);
          if (arrRaw) {
            // portco_arr is a number field in HubSpot — store as plain dollars
            const arrDollars = arrRaw.replace(/[$,\s]/g, "").toLowerCase().replace(/^([\d.]+)([kmb]?)$/, (_, n, s) => {
              const v = parseFloat(n);
              if (s === "b") return String(Math.round(v * 1_000_000_000));
              if (s === "m") return String(Math.round(v * 1_000_000));
              if (s === "k") return String(Math.round(v * 1_000));
              return String(Math.round(v));
            });
            if (arrDollars && !isNaN(Number(arrDollars))) hsProps["portco_arr"] = arrDollars;
          }
          if (Object.keys(hsProps).length > 0) {
            fetch("/api/hubspot/deal", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ dealId: linkedDealId, properties: hsProps }),
            }).catch((err) => console.warn("HubSpot metric sync failed (non-blocking):", err));
          }
        }

        const shouldRescore = window.confirm(
          "Key metrics saved. Re-score now to refresh AI scores and details?"
        );
        if (shouldRescore) {
          await handleRescore();
        }
      } else {
        setError(data.error || "Failed to save metrics");
      }
    } catch (err) {
      console.error("Error saving metrics:", err);
      setError("Failed to save metrics");
    } finally {
      setSavingMetrics(false);
    }
  };

  const getLinkIngestBadge = (doc: any) => {
    if (!doc.externalUrl) return null;
    if (doc.linkIngestStatus === "ingested") {
      return <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">Link Parsed</span>;
    }
    if (doc.linkIngestStatus === "email_required") {
      return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Email Required</span>;
    }
    if (doc.linkIngestStatus === "failed") {
      return <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">Parse Failed</span>;
    }
    return <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">Link</span>;
  };
  const failedDocsendDocuments = (record?.documents || []).filter(
    (doc: any) =>
      /docsend\.com/i.test(String(doc?.externalUrl || "")) &&
      (doc?.fileType === "link" || doc?.fileType === "url") &&
      doc?.linkIngestStatus !== "ingested"
  );
  const isUnreadableExtractedTextForDisplay = (text?: string): boolean => {
    const value = String(text || "").trim();
    if (!value) return true;
    return [
      /\[pdf was parsed but contains minimal extractable text/i,
      /\[pdf parsing failed:/i,
      /\[document could not be parsed\]/i,
      /\[image file - text extraction not available/i,
      /\[excel parsing error:/i,
      /\[powerpoint file appears to be empty/i,
      /\[docx appears to be empty\]/i,
    ].some((pattern) => pattern.test(value));
  };
  const getDocumentParseIssue = (doc: any): string | null => {
    const isLink = doc?.fileType === "link" || doc?.fileType === "url" || Boolean(doc?.externalUrl);
    if (isLink) {
      if (doc?.linkIngestStatus === "ingested") return null;
      if (doc?.linkIngestStatus === "email_required") {
        return doc?.linkIngestMessage || "Link needs an access email before content can be ingested.";
      }
      return doc?.linkIngestMessage || "Link could not be parsed and is not used in thesis/scoring.";
    }
    if (isUnreadableExtractedTextForDisplay(doc?.extractedText)) {
      return "Document content could not be read/parsed and is not used in thesis/scoring.";
    }
    return null;
  };
  const documentsWithParseIssues = (record?.documents || []).filter((doc: any) => Boolean(getDocumentParseIssue(doc)));
  const documentParseIssueCount = documentsWithParseIssues.length;

  const HubSpotIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" fill="#FF7A59" />
      <circle cx="18.5" cy="5.5" r="2.2" fill="#FF7A59" />
      <circle cx="5.4" cy="18.6" r="1.8" fill="#FF7A59" />
      <path d="M14.4 9.6L17 7.8M10 13.8L6.9 17M12 8.8V3.5" stroke="#FF7A59" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );

  const stripThesisTag = (line: string): string =>
    String(line || "")
      .replace(/\[(pillar|dealbreaker):\s*[a-z0-9_\- ]+\]\s*/gi, "")
      .replace(/\s+/g, " ")
      .trim();

  const sanitizeThesisLinesForDisplay = (lines: string[] = []): string[] =>
    lines.map((line) => stripThesisTag(line)).filter(Boolean);

  const resolveWhyMightFitItems = () => {
    const thesisAnswers = record?.score?.thesisAnswers;
    const fromScore = Array.isArray(thesisAnswers?.whyMightFit)
      ? thesisAnswers.whyMightFit
      : [];
    if (fromScore.length > 0) {
      return sanitizeThesisLinesForDisplay(fromScore);
    }
    const fromThesisFit = Array.isArray(record?.thesisFit?.whyFits)
      ? record.thesisFit.whyFits
      : [];
    if (fromThesisFit.length > 0) {
      return sanitizeThesisLinesForDisplay(fromThesisFit);
    }
    const fromExciting = Array.isArray(thesisAnswers?.exciting) ? thesisAnswers.exciting : [];
    return sanitizeThesisLinesForDisplay(fromExciting).slice(0, 3);
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

  const extractDomainFromWebsite = (value: string): string => {
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

  const getVisibleCompanyFieldEntries = (): Array<[string, string]> => {
    if (!hubspotCreatePreview) return [];
    const industryKeys = [
      "industry",
      "investment_sector",
      "what_industry_sector_do_you_operate_in___please_select_all_that_apply_",
    ] as const;
    const tamKeys = ["what_is_the_tam___sam___som_of_your_business_", "tam"] as const;
    const selectedIndustryKey =
      industryKeys.find((key) => {
        const value = String(hubspotCreateCompanyDraft[key] || "").trim();
        return value.length > 0;
      }) ||
      industryKeys.find((key) => key in hubspotCreateCompanyDraft) ||
      "industry";
    const selectedTamKey = tamKeys.find((key) => key in hubspotCreateCompanyDraft) || "what_is_the_tam___sam___som_of_your_business_";
    return COMPANY_FIELD_PRIORITY
      .filter((key) => !industryKeys.includes(key as any) || key === selectedIndustryKey)
      .filter((key) => !tamKeys.includes(key as any) || key === selectedTamKey)
      .map((key) => [key, hubspotCreateCompanyDraft[key] || ""]);
  };

  const getVisibleHubSpotCreateFieldEntries = (): Array<{ objectType: "company" | "deal"; key: string; value: string }> => {
    const seen = new Set<string>();
    const combined: Array<{ objectType: "company" | "deal"; key: string; value: string }> = [];
    const selectedDealStage = (hubspotCreateDealDraft.dealstage || "").trim().toLowerCase();
    const selectedDealStageLabel = (hubspotDealFieldOptions.dealstage || [])
      .find((option) => option.value === hubspotCreateDealDraft.dealstage)?.label?.toLowerCase() || "";
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
      const fieldMeta = hubspotCreatePreview?.deal.fields.find((field) => field.hubspotProperty === key);
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
    for (const [key, value] of getVisibleCompanyFieldEntries()) {
      const canonical = canonicalKey("company", key);
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      combined.push({ objectType: "company", key, value });
    }
    for (const [key, value] of Object.entries(hubspotCreateDealDraft).filter(([dealKey]) => !HIDDEN_DEAL_FIELD_KEYS.has(dealKey))) {
      const canonical = canonicalKey("deal", key);
      if (seen.has(canonical)) continue;
      if (!shouldShowFieldForStage("deal", key)) continue;
      seen.add(canonical);
      combined.push({ objectType: "deal", key, value: value || "" });
    }
    return combined
      .map((entry, idx) => {
        const fieldMeta = (entry.objectType === "company" ? hubspotCreatePreview?.company.fields : hubspotCreatePreview?.deal.fields)
          ?.find((field) => field.hubspotProperty === entry.key);
        return {
          ...entry,
          _idx: idx,
          _uiOrder: typeof fieldMeta?.uiOrder === "number" ? fieldMeta.uiOrder : Number.POSITIVE_INFINITY,
        };
      })
      .sort((a, b) => (a._uiOrder - b._uiOrder) || (a._idx - b._idx))
      .map(({ _idx, _uiOrder, ...entry }) => entry);
  };

  const normalizeWebsiteUrl = (value?: string): string | null => {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  };

  const getCompanyDescriptionForDisplay = (input: DiligenceRecord): string => {
    const companyData = input.hubspotCompanyData as any;
    const existing = (
      companyData?.description ||
      companyData?.descriptor ||
      companyData?.company_description ||
      companyData?.anythingElse ||
      input.companyDescription ||
      input.companyOneLiner ||
      ""
    );
    if (existing) return existing;
    const industry = (input.industry || companyData?.industry || "").trim();
    const website = (input.companyUrl || companyData?.website || "").trim();
    const industryPart = industry ? ` in the ${industry} space` : "";
    const websitePart = website ? ` Website: ${website}.` : "";
    return `${input.companyName} is a company under diligence review${industryPart}.${websitePart}`;
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <LoadingSpinner />
        </div>
      </DashboardLayout>
    );
  }

  if (error || !record) {
    return (
      <DashboardLayout>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <p className="text-red-800">{error || "Diligence record not found"}</p>
          <button
            onClick={() => router.push("/diligence")}
            className="mt-4 text-sm text-red-600 hover:text-red-800 underline"
          >
            Back to Diligence
          </button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/diligence')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
              title="Back to Diligence List"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="inline-flex items-center gap-2 text-3xl font-bold text-gray-900">
                <span>{record.companyName}</span>
                {normalizeWebsiteUrl(record.companyUrl) && (
                  <a
                    href={normalizeWebsiteUrl(record.companyUrl)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-500 hover:text-blue-600"
                    title="Visit company website"
                  >
                    <Globe className="h-5 w-5" />
                  </a>
                )}
                {record.hubspotDealId ? (
                  <a
                    href={`https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID}/record/0-3/${record.hubspotDealId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-500 hover:text-blue-600"
                    title="View in HubSpot"
                  >
                    <HubSpotIcon className="h-5 w-5" />
                  </a>
                ) : (
                  <button
                    onClick={() => {
                      setShowHubspotLinker(true);
                      setHubspotSearchQuery(record.companyName || "");
                      void handleSearchHubSpotDeals(record.companyName || "");
                    }}
                    className="text-gray-400 hover:text-gray-600 opacity-70 grayscale hover:opacity-100"
                    title="Link to HubSpot deal"
                  >
                    <HubSpotIcon className="h-5 w-5" />
                  </button>
                )}
              </h1>
              {getCompanyDescriptionForDisplay(record) && (
                <p className="mt-2 text-sm text-gray-700 max-w-2xl">
                  {getCompanyDescriptionForDisplay(record)}
                </p>
              )}
              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="font-medium">Founders:</span>
                  {record.founders && record.founders.filter((founder) => !isPlaceholderFounderName(founder.name)).length > 0 ? (
                    <>
                      {record.founders
                        .filter((founder) => !isPlaceholderFounderName(founder.name))
                        .map((founder, idx, founders) => (
                        <span key={idx}>
                          {resolveFounderLinkedInHref(founder) ? (
                            <a
                              href={resolveFounderLinkedInHref(founder)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1"
                            >
                              {founder.name}
                              {founder.title && <span className="text-gray-500"> ({founder.title})</span>}
                            </a>
                          ) : (
                            <span>
                              {founder.name}
                              {founder.title && <span className="text-gray-500"> ({founder.title})</span>}
                            </span>
                          )}
                          {idx < founders.length - 1 && <span className="text-gray-400">, </span>}
                        </span>
                      ))}
                    </>
                  ) : (
                    <span className="text-gray-400 italic">Not specified</span>
                  )}
                  <button
                    onClick={() => setShowFoundersModal(true)}
                    className="ml-2 text-blue-600 hover:text-blue-800"
                    title="Edit founders"
                  >
                    <Edit2 className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="font-medium">Industry:</span>
                  {hubspotIndustryOptions.length > 0 ? (
                    <select
                      value={mapIndustryGuessToOptionValue(preferredIndustry || "", hubspotIndustryOptions) || ""}
                      onChange={(e) => void saveIndustryValue(e.target.value)}
                      disabled={savingIndustry || hubspotIndustryOptionsLoading}
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 disabled:opacity-60"
                    >
                      <option value="" disabled>
                        Select industry
                      </option>
                      {hubspotIndustryOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={preferredIndustry ? '' : 'text-gray-400 italic'}>
                      {mapIndustryValueToDisplayLabel(preferredIndustry || "") || 'Not set'}
                    </span>
                  )}
                  {savingIndustry && <span className="text-xs text-gray-500">Saving...</span>}
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="font-medium">Priority:</span>
                  {editingPriorityField && hubspotPriorityOptions.length > 0 ? (
                    <select
                      value={preferredPriority}
                      onChange={(e) => {
                        void savePriorityValue(e.target.value);
                      }}
                      onBlur={() => setEditingPriorityField(false)}
                      disabled={savingPriority || hubspotPriorityOptionsLoading}
                      autoFocus
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 disabled:opacity-60"
                    >
                      <option value="">Select priority</option>
                      {hubspotPriorityOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div
                      onClick={() => {
                        if (hubspotPriorityOptions.length > 0 && !hubspotPriorityOptionsLoading) {
                          setEditingPriorityField(true);
                        }
                      }}
                    >
                      {getPriorityBadge(preferredPriority, hubspotPriorityOptions.length > 0)}
                    </div>
                  )}
                  {savingPriority && <span className="text-xs text-gray-500">Saving...</span>}
                </div>
                {record.hubspotDealId && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="font-medium">HubSpot Stage:</span>
                    {loadingHubspotStages ? (
                      <span className="inline-flex items-center gap-1 text-gray-500">
                        <LoadingSpinner />
                        Loading stages...
                      </span>
                    ) : editingHubspotStageField && activeHubSpotStages.length > 0 ? (
                      <select
                        value={record.hubspotDealStageId || ""}
                        onChange={(e) => void handleSelectHubSpotStage(e.target.value)}
                        onBlur={() => setEditingHubspotStageField(false)}
                        disabled={updatingHubspotStage}
                        autoFocus
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 disabled:opacity-60"
                      >
                        <option value="" disabled>
                          Select stage
                        </option>
                        {activeHubSpotStages.map((stage) => (
                          <option key={stage.id} value={stage.id}>
                            {stage.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div
                        onClick={() => {
                          if (activeHubSpotStages.length > 0 && !loadingHubspotStages) {
                            setEditingHubspotStageField(true);
                          }
                        }}
                      >
                        {getHubSpotStageBadge(
                          record.hubspotDealStageId,
                          record.hubspotDealStageLabel,
                          activeHubSpotStages.length > 0
                        )}
                      </div>
                    )}
                    {updatingHubspotStage && (
                      <span className="text-xs text-gray-500">Updating...</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowDocumentsModal(true)}
              className={`flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-medium hover:bg-gray-50 ${
                documentParseIssueCount > 0
                  ? "border-amber-300 text-amber-800"
                  : "border-gray-300 text-gray-700"
              }`}
              title="View documents"
            >
              <span className="relative">
                <Folder className={`h-4 w-4 ${documentParseIssueCount > 0 ? "text-amber-700" : ""}`} />
                {documentParseIssueCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
                    {documentParseIssueCount > 9 ? "9+" : documentParseIssueCount}
                  </span>
                )}
              </span>
              Documents ({record.documents.length})
            </button>
            <button
              onClick={() => setShowChatModal(true)}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              title="AI Discussion"
            >
              <MessageCircle className="h-4 w-4" />
              AI Chat
            </button>
            <button
              onClick={() => setShowPdfModal(true)}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              title="Export as PDF"
            >
              <Download className="h-4 w-4" />
              Export PDF
            </button>
            <div className="relative">
              <div className="flex">
                <button
                  onClick={() => handleRescore(false)}
                  disabled={rescoring}
                  className="flex items-center gap-2 rounded-l-lg bg-purple-600 px-4 py-2 text-sm font-bold text-white hover:bg-purple-700 disabled:opacity-50"
                  title="Incremental re-score (default)"
                >
                  {rescoring ? <LoadingSpinner /> : <TrendingUp className="h-4 w-4" />}
                  {rescoring ? "Re-scoring..." : "Re-score"}
                </button>
                <button
                  onClick={() => setShowRescoreMenu(!showRescoreMenu)}
                  disabled={rescoring}
                  className="rounded-r-lg border-l border-purple-500 bg-purple-600 px-2 py-2 text-white hover:bg-purple-700 disabled:opacity-50"
                  title="More re-score options"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
              {showRescoreMenu && (
                <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-gray-200 bg-white shadow-lg">
                  <button
                    onClick={() => handleRescore(false)}
                    className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Re-score (incremental)
                  </button>
                  <button
                    onClick={() => handleRescore(true)}
                    className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Full re-score (force refresh)
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={handleDelete}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700"
              title="Delete this diligence record"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        </div>

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

        {rescoring && rescoreProgress && (
          <div className="mt-3 rounded-lg border border-purple-200 bg-purple-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <LoadingSpinner />
              <p className="text-sm text-purple-800">{rescoreProgress}</p>
            </div>
          </div>
        )}

        {showDeleteDialog && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
              <div className="border-b border-gray-200 p-4">
                <h3 className="text-lg font-semibold text-gray-900">Delete Diligence Record</h3>
                <p className="mt-1 text-sm text-gray-600">{record.companyName}</p>
              </div>
              <div className="space-y-3 p-4 text-sm text-gray-700">
                <p>This will delete the diligence record from the app.</p>
                {record.googleDriveFolderId ? (
                  <p>Choose what to do with the Google Drive folder:</p>
                ) : (
                  <p>No Google Drive folder found for this record.</p>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-gray-200 p-4">
                <button
                  type="button"
                  onClick={async () => {
                    setShowDeleteDialog(false);
                    await performDelete('archive');
                  }}
                  disabled={!record.googleDriveFolderId}
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Archive
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setShowDeleteDialog(false);
                    await performDelete(record.googleDriveFolderId ? 'delete' : 'keep');
                  }}
                  className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteDialog(false)}
                  className="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {showRescoreDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-gray-200 p-4">
                <h3 className="text-lg font-semibold text-gray-900">What Changed in This Re-score</h3>
                <button
                  onClick={() => setShowRescoreDialog(false)}
                  className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  aria-label="Close re-score details"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto p-4">
                <p className="whitespace-pre-line text-sm text-gray-700">{rescoreDialogText}</p>
              </div>
              <div className="flex justify-end border-t border-gray-200 p-4">
                <button
                  onClick={() => setShowRescoreDialog(false)}
                  className="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Three Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Column 1: Score & Metrics */}
          <div className="space-y-4">
            {record.score ? (
              <>
                {/* Overall Score */}
                <div className={`rounded-lg border p-6 shadow-sm ${getScoreBgColor(effectiveScoreModel.overall)}`}>
                  <p className="text-sm font-medium text-gray-600 mb-2">Overall Score</p>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-5xl font-bold ${getScoreColor(effectiveScoreModel.overall)}`}>
                      {effectiveScoreModel.overall}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-gray-600">
                    Data Quality: {record.score.dataQuality}
                  </p>
                </div>

                {/* Metrics */}
                <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">Key Metrics</h3>
                    <div className="flex items-center gap-2">
                      {!editingMetrics ? (
                        <button
                          onClick={startEditingMetrics}
                          className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Edit
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={cancelEditingMetrics}
                            className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSaveMetrics}
                            disabled={savingMetrics}
                            className="rounded-md bg-purple-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
                          >
                            {savingMetrics ? "Saving..." : "Save"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {metricFields.map((field) => {
                      const metric = record.metrics?.[field.key];
                      const value = editingMetrics ? metricsDraft[field.key] : (metric?.value || "");
                      const metricSourceLabel =
                        metric?.source === "auto"
                          ? metric?.sourceDetail === "notes"
                            ? "Source: Auto (notes)"
                            : metric?.sourceDetail === "facts"
                              ? "Source: Auto (extracted facts)"
                              : metric?.sourceDetail === "market_research"
                                ? "Source: Auto (market research)"
                                : "Source: Auto"
                          : metric?.source === "manual"
                            ? "Source: Manual"
                            : undefined;
                      return (
                        <div key={field.key} className="rounded-md border border-gray-200 px-2 py-1.5">
                          <div className="mb-1">
                            <span className="text-xs font-medium text-gray-700">{field.label}</span>
                          </div>
                          {editingMetrics ? (
                            <div>
                              <input
                                value={value}
                                onChange={(e) =>
                                  setMetricsDraft((prev) => ({ ...prev, [field.key]: e.target.value }))
                                }
                                placeholder={field.placeholder}
                                className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 placeholder:text-gray-400 focus:border-purple-500 focus:outline-none"
                              />
                              {(field.key === "currentRunway" || field.key === "postFundingRunway") && (
                                <p className="mt-1 text-[10px] text-gray-500">
                                  Prefer months (example: 12 months). Ranges still work if needed (example: 6 - 12 months).
                                </p>
                              )}
                              {(field.key === "fundingAmount" || field.key === "committed" || field.key === "valuation") && (
                                <p className="mt-1 text-[10px] text-gray-500">
                                  Enter in millions — e.g. <span className="font-mono">4</span> or <span className="font-mono">$4M</span>. Saved to HubSpot when linked.
                                </p>
                              )}
                            </div>
                          ) : (
                            <div>
                              <p
                                className={`text-xs ${value ? "text-gray-900" : "text-gray-400 italic"}`}
                                title={metricSourceLabel}
                              >
                                {value ? formatMetricValueForDisplay(field.key, value) : "Not set"}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

              </>
            ) : (
              <div className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
                <TrendingUp className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-4 text-sm text-gray-600">
                  No score available yet.
                </p>
              </div>
            )}
          </div>

          {/* Column 2: Investment Thesis (Positive Aspects) */}
          <div className="space-y-4">
            {record.score?.thesisAnswers && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-blue-900">Investment Thesis</h3>
                    {record.score.thesisAnswers.manuallyEdited && (
                      <span className="text-xs px-2 py-0.5 bg-blue-200 text-blue-800 rounded">Edited</span>
                    )}
                  </div>
                  {!editingThesis && (
                    <button
                      onClick={handleEditThesis}
                      className="text-blue-600 hover:text-blue-800"
                      title="Edit thesis"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                
                {!editingThesis ? (
                  <div className="space-y-3">
                    <div>
                      <h4 className="text-xs font-semibold text-blue-800 mb-1">What problem are they solving?</h4>
                      <p className="text-xs text-blue-900">{record.score.thesisAnswers.problemSolving}</p>
                    </div>
                    
                    <div>
                      <h4 className="text-xs font-semibold text-blue-800 mb-1">How are they solving this problem?</h4>
                      <p className="text-xs text-blue-900">{record.score.thesisAnswers.solution}</p>
                    </div>
                    
                    <div>
                      <h4 className="text-xs font-semibold text-blue-800 mb-1">What is their ideal customer profile?</h4>
                      <p className="text-xs text-blue-900">{record.score.thesisAnswers.idealCustomer}</p>
                    </div>
                    
                    <div className="rounded-md bg-green-100 p-3">
                      <h4 className="text-xs font-semibold text-green-800 mb-2">Why might this be a thesis fit?</h4>
                      <ul className="text-xs text-green-900 space-y-1.5 ml-3 mb-3">
                        {resolveWhyMightFitItems().map((item, idx) => (
                          <li key={`why-might-fit-${idx}`} className="flex gap-2">
                            <span className="flex-shrink-0">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                      <h4 className="text-xs font-semibold text-green-800 mb-2">What is exciting about this deal?</h4>
                      <ul className="text-xs text-green-900 space-y-1.5 ml-3">
                        {Array.isArray(record.score.thesisAnswers.exciting) ? (
                          sanitizeThesisLinesForDisplay(record.score.thesisAnswers.exciting).map((item, idx) => (
                            <li key={idx} className="flex gap-2">
                              <span className="flex-shrink-0">•</span>
                              <span>{item}</span>
                            </li>
                          ))
                        ) : (
                          <li className="flex gap-2">
                            <span className="flex-shrink-0">•</span>
                            <span>{stripThesisTag(String(record.score.thesisAnswers.exciting || ""))}</span>
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-blue-800 mb-1">What problem are they solving?</label>
                      <textarea
                        value={editedThesisAnswers.problemSolving}
                        onChange={(e) => setEditedThesisAnswers({...editedThesisAnswers, problemSolving: e.target.value})}
                        className="w-full px-3 py-2 text-xs border border-blue-300 rounded-md focus:ring-2 focus:ring-blue-500"
                        rows={3}
                      />
                    </div>
                    
                    <div>
                      <label className="block text-xs font-semibold text-blue-800 mb-1">How are they solving this problem?</label>
                      <textarea
                        value={editedThesisAnswers.solution}
                        onChange={(e) => setEditedThesisAnswers({...editedThesisAnswers, solution: e.target.value})}
                        className="w-full px-3 py-2 text-xs border border-blue-300 rounded-md focus:ring-2 focus:ring-blue-500"
                        rows={3}
                      />
                    </div>
                    
                    <div>
                      <label className="block text-xs font-semibold text-blue-800 mb-1">What is their ideal customer profile?</label>
                      <textarea
                        value={editedThesisAnswers.idealCustomer}
                        onChange={(e) => setEditedThesisAnswers({...editedThesisAnswers, idealCustomer: e.target.value})}
                        className="w-full px-3 py-2 text-xs border border-blue-300 rounded-md focus:ring-2 focus:ring-blue-500"
                        rows={2}
                      />
                    </div>
                    
                    <div className="rounded-md bg-green-50 p-3 border border-green-200">
                      <label className="block text-xs font-semibold text-green-800 mb-2">Why might this be a thesis fit?</label>
                      <div className="space-y-2 mb-4">
                        {(Array.isArray(editedThesisAnswers.whyMightFit) ? editedThesisAnswers.whyMightFit : []).map((item: string, idx: number) => (
                          <div key={`edited-why-fit-${idx}`} className="flex gap-2">
                            <input
                              type="text"
                              value={item}
                              onChange={(e) => {
                                const next = Array.isArray(editedThesisAnswers.whyMightFit)
                                  ? [...editedThesisAnswers.whyMightFit]
                                  : [];
                                next[idx] = e.target.value;
                                setEditedThesisAnswers({ ...editedThesisAnswers, whyMightFit: next });
                              }}
                              className="flex-1 px-2 py-1 text-xs border border-green-300 rounded focus:ring-2 focus:ring-green-500"
                            />
                            <button
                              onClick={() => {
                                const next = (Array.isArray(editedThesisAnswers.whyMightFit) ? editedThesisAnswers.whyMightFit : [])
                                  .filter((_: string, i: number) => i !== idx);
                                setEditedThesisAnswers({ ...editedThesisAnswers, whyMightFit: next });
                              }}
                              className="text-red-600 hover:text-red-800"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            const next = [
                              ...(Array.isArray(editedThesisAnswers.whyMightFit) ? editedThesisAnswers.whyMightFit : []),
                              "",
                            ];
                            setEditedThesisAnswers({ ...editedThesisAnswers, whyMightFit: next });
                          }}
                          className="text-xs text-green-700 hover:text-green-900 font-medium"
                        >
                          + Add fit point
                        </button>
                      </div>
                      <label className="block text-xs font-semibold text-green-800 mb-2">What is exciting about this deal?</label>
                      <div className="space-y-2">
                        {editedThesisAnswers.exciting.map((item: string, idx: number) => (
                          <div key={idx} className="flex gap-2">
                            <input
                              type="text"
                              value={item}
                              onChange={(e) => {
                                const newExciting = [...editedThesisAnswers.exciting];
                                newExciting[idx] = e.target.value;
                                setEditedThesisAnswers({...editedThesisAnswers, exciting: newExciting});
                              }}
                              className="flex-1 px-2 py-1 text-xs border border-green-300 rounded focus:ring-2 focus:ring-green-500"
                            />
                            <button
                              onClick={() => {
                                const newExciting = editedThesisAnswers.exciting.filter((_: any, i: number) => i !== idx);
                                setEditedThesisAnswers({...editedThesisAnswers, exciting: newExciting});
                              }}
                              className="text-red-600 hover:text-red-800"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            const newExciting = [...editedThesisAnswers.exciting, ''];
                            setEditedThesisAnswers({...editedThesisAnswers, exciting: newExciting});
                          }}
                          className="text-xs text-green-700 hover:text-green-900 font-medium"
                        >
                          + Add point
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={handleSaveThesis}
                        disabled={savingThesis}
                        className="flex-1 px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
                      >
                        {savingThesis ? 'Saving...' : 'Save Changes'}
                      </button>
                      <button
                        onClick={handleCancelEditThesis}
                        className="flex-1 px-3 py-2 bg-gray-200 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Column 3: Concerns & Due Diligence Follow-up */}
          <div className="space-y-4">
            {record.score?.thesisAnswers && (
              <>
                <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 shadow-sm">
                  <h4 className="text-xs font-semibold text-yellow-800 mb-2">What is concerning about this deal?</h4>
                  {!editingThesis ? (
                    <ul className="text-xs text-yellow-900 space-y-1.5 ml-3">
                      {Array.isArray(record.score.thesisAnswers.concerning) ? (
                        sanitizeThesisLinesForDisplay(record.score.thesisAnswers.concerning).map((item, idx) => (
                          <li key={idx} className="flex gap-2">
                            <span className="flex-shrink-0">•</span>
                            <span>{item}</span>
                          </li>
                        ))
                      ) : (
                        <li className="flex gap-2">
                          <span className="flex-shrink-0">•</span>
                          <span>{stripThesisTag(String(record.score.thesisAnswers.concerning || ""))}</span>
                        </li>
                      )}
                    </ul>
                  ) : (
                    <div className="space-y-2">
                      {editedThesisAnswers.concerning.map((item: string, idx: number) => (
                        <div key={idx} className="flex gap-2">
                          <input
                            type="text"
                            value={item}
                            onChange={(e) => {
                              const newConcerning = [...editedThesisAnswers.concerning];
                              newConcerning[idx] = e.target.value;
                              setEditedThesisAnswers({...editedThesisAnswers, concerning: newConcerning});
                            }}
                            className="flex-1 px-2 py-1 text-xs border border-yellow-300 rounded focus:ring-2 focus:ring-yellow-500"
                          />
                          <button
                            onClick={() => {
                              const newConcerning = editedThesisAnswers.concerning.filter((_: any, i: number) => i !== idx);
                              setEditedThesisAnswers({...editedThesisAnswers, concerning: newConcerning});
                            }}
                            className="text-red-600 hover:text-red-800"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          const newConcerning = [...editedThesisAnswers.concerning, ''];
                          setEditedThesisAnswers({...editedThesisAnswers, concerning: newConcerning});
                        }}
                        className="text-xs text-yellow-700 hover:text-yellow-900 font-medium"
                      >
                        + Add concern
                      </button>
                    </div>
                  )}
                </div>

                {/* Founder Questions Section */}
                {record.score.thesisAnswers.founderQuestions && (
                  <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 shadow-sm">
                    <h4 className="text-xs font-semibold text-purple-900 mb-3">🎯 Due Diligence Follow-up</h4>
                    
                    {!editingThesis ? (
                      <div className="space-y-3">
                        <div>
                          <h5 className="text-xs font-semibold text-purple-800 mb-1.5">Top 3 Questions for the Founder:</h5>
                          <ol className="text-xs text-purple-900 space-y-1.5 ml-4">
                            {record.score.thesisAnswers.founderQuestions.questions.map((q, idx) => {
                              const answeredQuestions = questions.filter(isQuestionClosed);
                              const isAnswered = answeredQuestions.some(qt => isQuestionSimilar(q, qt.question));
                              const openQuestions = questions.filter(isQuestionOpen);
                              const isAlreadyOpen = openQuestions.some(qt => isQuestionSimilar(q, qt.question));
                              
                              return (
                                <li key={idx} className="flex gap-2 items-start group">
                                  <span className="flex-shrink-0 font-semibold">{idx + 1}.</span>
                                  <span className="flex-1">{q}</span>
                                  {!isAnswered && !isAlreadyOpen && (
                                    <button
                                      onClick={() => handleAddAiQuestionToTracker(q)}
                                      disabled={savingQuestions}
                                      className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 p-1 text-purple-600 hover:bg-purple-100 rounded text-xs disabled:opacity-50"
                                      title="Add to Open Questions"
                                    >
                                      <Plus className="h-3 w-3" />
                                    </button>
                                  )}
                                  {isAnswered && (
                                    <span className="flex-shrink-0 text-green-600 text-xs" title="This question has been answered">
                                      <CheckCircle className="h-3 w-3" />
                                    </span>
                                  )}
                                  {isAlreadyOpen && (
                                    <span className="flex-shrink-0 text-orange-600 text-xs" title="Already in open questions">
                                      <AlertCircle className="h-3 w-3" />
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ol>
                        </div>

                        <div className="border-t border-purple-200 pt-2">
                          <h5 className="text-xs font-semibold text-purple-800 mb-1">Primary Concern:</h5>
                          <p className="text-xs text-purple-900 italic">
                            {stripThesisTag(String(record.score.thesisAnswers.founderQuestions.primaryConcern || ""))}
                          </p>
                        </div>

                        <div className="border-t border-purple-200 pt-2">
                          <h5 className="text-xs font-semibold text-purple-800 mb-1">Critical Information Gaps:</h5>
                          <p className="text-xs text-purple-900">{record.score.thesisAnswers.founderQuestions.keyGaps}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-purple-800 mb-1">Top questions for the founder:</label>
                          <div className="space-y-2">
                            {editedThesisAnswers.founderQuestions?.questions.map((q: string, idx: number) => (
                              <input
                                key={idx}
                                type="text"
                                value={q}
                                onChange={(e) => {
                                  const newQuestions = [...editedThesisAnswers.founderQuestions.questions];
                                  newQuestions[idx] = e.target.value;
                                  setEditedThesisAnswers({
                                    ...editedThesisAnswers,
                                    founderQuestions: {
                                      ...editedThesisAnswers.founderQuestions,
                                      questions: newQuestions
                                    }
                                  });
                                }}
                                placeholder={`Question ${idx + 1}`}
                                className="w-full px-2 py-1 text-xs border border-purple-300 rounded focus:ring-2 focus:ring-purple-500"
                              />
                            ))}
                          </div>
                        </div>

                        <div className="border-t border-purple-200 pt-2">
                          <label className="block text-xs font-semibold text-purple-800 mb-1">Primary concern:</label>
                          <textarea
                            value={editedThesisAnswers.founderQuestions?.primaryConcern}
                            onChange={(e) => setEditedThesisAnswers({
                              ...editedThesisAnswers,
                              founderQuestions: {
                                ...editedThesisAnswers.founderQuestions,
                                primaryConcern: e.target.value
                              }
                            })}
                            className="w-full px-2 py-1 text-xs border border-purple-300 rounded focus:ring-2 focus:ring-purple-500"
                            rows={2}
                          />
                        </div>

                        <div className="border-t border-purple-200 pt-2">
                          <label className="block text-xs font-semibold text-purple-800 mb-1">Key information gaps:</label>
                          <textarea
                            value={editedThesisAnswers.founderQuestions?.keyGaps}
                            onChange={(e) => setEditedThesisAnswers({
                              ...editedThesisAnswers,
                              founderQuestions: {
                                ...editedThesisAnswers.founderQuestions,
                                keyGaps: e.target.value
                              }
                            })}
                            className="w-full px-2 py-1 text-xs border border-purple-300 rounded focus:ring-2 focus:ring-purple-500"
                            rows={2}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Scoring Grid - Full Width */}
        {record.score && (
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between p-4">
              <button
                onClick={() => setIsScoringGridExpanded(!isScoringGridExpanded)}
                className="flex items-center gap-3"
              >
                <TrendingUp className="h-5 w-5 text-gray-600" />
                <div className="text-left">
                  <h2 className="text-lg font-semibold text-gray-900">Scoring Grid</h2>
                  <p className="text-xs text-gray-500">
                    Question / Answer / Score / Details
                  </p>
                </div>
              </button>
              <div className="flex items-center gap-2">
                {isScoringGridExpanded && (
                  <button
                    onClick={() =>
                      setExpandedScoringCategories(
                        expandedScoringCategories.size === (record.score?.categories.length ?? 0)
                          ? new Set()
                          : new Set((record.score?.categories ?? []).map((category) => category.category))
                      )
                    }
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {expandedScoringCategories.size === (record.score?.categories.length ?? 0) ? "Collapse all" : "Expand all"}
                  </button>
                )}
                <button
                  onClick={() => setIsScoringGridExpanded(!isScoringGridExpanded)}
                  className="p-1"
                  aria-label="Toggle scoring grid"
                >
                  {isScoringGridExpanded ? (
                    <ChevronUp className="h-5 w-5 text-gray-600" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-gray-600" />
                  )}
                </button>
              </div>
            </div>

            {isScoringGridExpanded && (
              <div className="border-t border-gray-200 p-4">
                <div className="space-y-3">
                  {record.score.categories.map((category) => {
                    const categoryScore = effectiveScoreModel.categoryScores[category.category] ?? category.score;
                    const isCategoryExpanded = expandedScoringCategories.has(category.category);

                    return (
                      <div key={category.category} className="rounded-lg border border-gray-200">
                        <div className="flex w-full items-center justify-between px-4 py-3 hover:bg-gray-50">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => toggleScoringCategory(category.category)}
                              className="text-sm font-semibold text-gray-900 hover:text-gray-700"
                            >
                              {category.category}
                            </button>
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                              Weight: {category.weight}%
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-bold ${getScoreColor(categoryScore)}`}>{categoryScore}</span>
                            <button
                              onClick={() => void handleRescoreCategory(category.category)}
                              disabled={rescoring || Boolean(rescoringCategoryName)}
                              className="inline-flex items-center rounded-md border border-gray-300 px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                              title={`Re-score ${category.category}`}
                              aria-label={`Re-score ${category.category}`}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => toggleScoringCategory(category.category)}
                              className="p-0.5"
                              aria-label={isCategoryExpanded ? "Collapse category" : "Expand category"}
                            >
                              {isCategoryExpanded ? (
                                <ChevronUp className="h-4 w-4 text-gray-500" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-gray-500" />
                              )}
                            </button>
                          </div>
                        </div>

                        {isCategoryExpanded && (
                          <div className="border-t border-gray-200">
                            <div className="overflow-x-auto">
                              <table className="min-w-full table-fixed divide-y divide-gray-200 text-sm">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="w-[22%] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Question</th>
                                    <th className="w-[24%] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Answer</th>
                                    <th className="w-[12%] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Score</th>
                                    <th className="w-[42%] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">Details</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 bg-white">
                                  {category.criteria.length === 0 ? (
                                    <tr>
                                      <td className="px-3 py-3 text-gray-500 italic" colSpan={4}>
                                        No criteria configured for this category.
                                      </td>
                                    </tr>
                                  ) : (
                                    category.criteria.map((criterion) => {
                                      const rowKey = scoringGridRowKey(category.category, criterion.name);
                                      const answerBuilder = getAnswerBuilderForCriterion(category.category, criterion.name);
                                      const composedAnswer = answerBuilder
                                        ? composeAnswer(
                                            answerBuilder,
                                            record.metrics,
                                            hubspotCompanyData || record.hubspotCompanyData,
                                            record.score,
                                            criterion.name,
                                            record.industry,
                                            record.teamResearch
                                          )
                                        : (criterion.answer || "");
                                      const details = criterion.reasoning || "No AI rationale available.";
                                      const isDetailsExpanded = expandedScoringDetails.has(rowKey);
                                      const effectiveScore = criterion.manualOverride ?? criterion.score;
                                      const scoreDraft = getCriterionScoreInputValue(rowKey, criterion);
                                      const parsedDraftScore = scoreDraft.trim().length > 0 ? Number(scoreDraft) : NaN;
                                      const previewScore = Number.isFinite(parsedDraftScore)
                                        ? Math.max(0, Math.min(100, Math.round(parsedDraftScore)))
                                        : effectiveScore;
                                      const scoreInputStyle =
                                        `${getScoreBgColor(previewScore)} ${getScoreColor(previewScore)} font-semibold`;

                                      return (
                                        <tr key={rowKey}>
                                          <td className="px-3 py-3 align-top text-sm text-gray-900">
                                            {criterion.name}
                                          </td>
                                          <td className="px-3 py-3 align-top text-xs text-gray-700">
                                            {composedAnswer ? (
                                              <p className="whitespace-pre-wrap">{composedAnswer}</p>
                                            ) : (
                                              <p className="italic text-gray-400">No answer builder configured</p>
                                            )}
                                          </td>
                                          <td className="px-3 py-3 align-top">
                                            <input
                                              type="number"
                                              min={0}
                                              max={100}
                                              value={scoreDraft}
                                              onChange={(e) =>
                                                setCriterionScoreDrafts((prev) => ({ ...prev, [rowKey]: e.target.value }))
                                              }
                                              onBlur={(e) =>
                                                void saveCriterionManualScore(category.category, criterion.name, e.target.value)
                                              }
                                              className={`w-20 rounded-md border px-2 py-1 text-xs focus:border-blue-500 focus:outline-none ${scoreInputStyle}`}
                                            />
                                            {savingCriterionScoreKey === rowKey && (
                                              <p className="mt-1 text-[11px] text-gray-500">Saving...</p>
                                            )}
                                          </td>
                                          <td className="px-3 py-3 align-top text-xs text-gray-700">
                                            <textarea
                                              value={scoringPerspectiveDrafts[rowKey] ?? ""}
                                              onChange={(e) =>
                                                setScoringPerspectiveDrafts((prev) => ({ ...prev, [rowKey]: e.target.value }))
                                              }
                                              onBlur={(e) =>
                                                void saveCriterionPerspective(category.category, criterion.name, e.target.value)
                                              }
                                              placeholder="Add your perspective / edits..."
                                              rows={3}
                                              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
                                            />
                                            {savingScoringPerspectiveKey === rowKey && (
                                              <p className="mt-1 text-[11px] text-gray-500">Saving...</p>
                                            )}
                                            <div className="mt-2 rounded-md bg-gray-50 p-2">
                                              <button
                                                onClick={() => toggleScoringDetail(rowKey)}
                                                className="flex w-full items-center justify-between text-left"
                                                aria-label="Toggle AI Details"
                                              >
                                                <p className="font-medium text-gray-600">
                                                  AI Details
                                                  <span className="ml-2 text-[11px] font-normal text-gray-500">
                                                    AI Score: {criterion.score}
                                                  </span>
                                                </p>
                                                {isDetailsExpanded ? (
                                                  <ChevronUp className="h-4 w-4 text-gray-500" />
                                                ) : (
                                                  <ChevronDown className="h-4 w-4 text-gray-500" />
                                                )}
                                              </button>
                                              {isDetailsExpanded && (
                                                <p className="mt-2 whitespace-pre-wrap">{details}</p>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Categorized Notes Section - Full Width Below */}
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors rounded-t-lg">
            <button
              onClick={() => setIsNotesExpanded(!isNotesExpanded)}
              className="flex items-center gap-3 flex-1"
            >
              <FileText className="h-5 w-5 text-gray-600" />
              <div className="text-left">
                <h2 className="text-lg font-semibold text-gray-900">Notes</h2>
                <p className="text-xs text-gray-500">
                  {categorizedNotes.length > 0 ? `${categorizedNotes.length} notes` : "No notes yet"}
                </p>
              </div>
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (!isNotesExpanded) {
                    setIsNotesExpanded(true);
                  }
                  setIsAddingNote(true);
                }}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Note
              </button>
              <button
                onClick={() => setIsNotesExpanded(!isNotesExpanded)}
                className="p-1"
              >
                {isNotesExpanded ? (
                  <ChevronUp className="h-5 w-5 text-gray-600" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-gray-600" />
                )}
              </button>
            </div>
          </div>
          
          {isNotesExpanded && (
            <div className="p-4 border-t border-gray-200">
              <CategorizedNotes
                notes={categorizedNotes}
                categories={noteCategories}
                onNotesChange={setCategorizedNotes}
                onSave={() => handleSaveNotes(true)}
                saving={savingNotes}
                isAdding={isAddingNote}
                onAddNote={() => setIsAddingNote(false)}
              />
            </div>
          )}
        </div>

        {/* Open Questions Section - Full Width Below */}
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors rounded-t-lg">
            <button
              onClick={() => setIsQuestionsExpanded(!isQuestionsExpanded)}
              className="flex items-center gap-3 flex-1"
            >
              <HelpCircle className="h-5 w-5 text-gray-600" />
              <div className="text-left">
                <h2 className="text-lg font-semibold text-gray-900">Questions & Answers</h2>
                <p className="text-xs text-gray-500">
                  {questions.length > 0 
                    ? `${questions.filter(isQuestionOpen).length} open, ${questions.filter(isQuestionClosed).length} closed` 
                    : 'No questions yet'}
                </p>
              </div>
            </button>
            <div className="flex items-center gap-2">
              <select
                value={questionStatusFilter}
                onChange={(e) => setQuestionStatusFilter(e.target.value as "open" | "closed" | "both")}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                title="Filter questions by status"
              >
                <option value="both">Open + Closed</option>
                <option value="open">Open only</option>
                <option value="closed">Closed only</option>
              </select>
              <button
                onClick={() => void handleCopyFilteredQuestions()}
                disabled={filteredQuestions.length === 0}
                className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Copy currently filtered questions"
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedQuestions ? "Copied" : "Copy Filtered"}
              </button>
              <button
                onClick={() => {
                  if (!isQuestionsExpanded) {
                    setIsQuestionsExpanded(true);
                  }
                  setIsAddingQuestion(true);
                }}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Question
              </button>
              <button
                onClick={() => setIsQuestionsExpanded(!isQuestionsExpanded)}
                className="p-1"
              >
                {isQuestionsExpanded ? (
                  <ChevronUp className="h-5 w-5 text-gray-600" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-gray-600" />
                )}
              </button>
            </div>
          </div>
          
          {isQuestionsExpanded && (
            <div className="p-4 border-t border-gray-200">
              {/* Questions List */}
              {filteredQuestions.length === 0 && !isAddingQuestion ? (
                <div className="text-center py-8 text-sm text-gray-500">
                  <p>
                    {questionStatusFilter === "open"
                      ? "No open questions."
                      : questionStatusFilter === "closed"
                        ? "No closed questions."
                        : "No questions yet."}
                  </p>
                  <p className="text-xs mt-2">Add questions to track key information gaps and due diligence follow-ups.</p>
                </div>
              ) : (
                <div className="rounded-md border border-gray-200 overflow-hidden">
                  <div className="grid grid-cols-[140px_1fr_1fr_100px_60px] bg-gray-50 border-b border-gray-200">
                    <div className="px-4 py-2 text-xs font-semibold text-gray-700 uppercase tracking-wide">Category</div>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-700 uppercase tracking-wide">Question</div>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-700 uppercase tracking-wide">Answer</div>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-700 uppercase tracking-wide">Status</div>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-700 uppercase tracking-wide"></div>
                  </div>
                  
                  {/* New Question Row */}
                  {isAddingQuestion && (
                    <div className="grid grid-cols-[140px_1fr_1fr_100px_60px] border-b border-gray-100 bg-blue-50/40">
                      <div className="px-4 py-3 border-r border-gray-100">
                        <select
                          value={newCategory}
                          onChange={(e) => setNewCategory(e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          {record?.score?.categories?.map(cat => (
                            <option key={cat.category} value={cat.category}>{cat.category}</option>
                          ))}
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      <div className="px-4 py-3 border-r border-gray-100">
                        <textarea
                          value={newQuestion}
                          onChange={(e) => setNewQuestion(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Tab' && !e.shiftKey) {
                              e.preventDefault();
                              const answerTextarea = e.currentTarget.parentElement?.nextElementSibling?.querySelector('textarea');
                              if (answerTextarea) (answerTextarea as HTMLTextAreaElement).focus();
                            }
                          }}
                          placeholder="Enter your question..."
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[90px]"
                          autoFocus
                        />
                      </div>
                      <div className="px-4 py-3 border-r border-gray-100">
                        <textarea
                          value={newAnswer}
                          onChange={(e) => setNewAnswer(e.target.value)}
                          placeholder="Enter answer (optional)..."
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[90px]"
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={handleAddQuestion}
                            disabled={!newQuestion.trim() || savingQuestions}
                            className="flex-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {savingQuestions ? <LoadingSpinner /> : 'Save'}
                          </button>
                          <button
                            onClick={handleCancelAddQuestion}
                            className="flex-1 rounded-md bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-300"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                      <div className="px-4 py-3 border-r border-gray-100"></div>
                      <div className="px-4 py-3"></div>
                    </div>
                  )}

                  {filteredQuestions.map((q, idx) => {
                    const isEditingQuestion = editingCell?.questionId === q.id && editingCell?.field === 'question';
                    const isEditingAnswer = editingCell?.questionId === q.id && editingCell?.field === 'answer';
                    
                    return (
                      <div
                        key={q.id}
                        className={`group grid grid-cols-[140px_1fr_1fr_100px_60px] border-b border-gray-100 last:border-b-0 ${
                          isQuestionClosed(q)
                            ? 'bg-green-50/40'
                            : idx % 2 === 0
                              ? 'bg-white'
                              : 'bg-orange-50/40'
                        }`}
                      >
                        {/* Category Column */}
                        <div className="px-4 py-3 border-r border-gray-100">
                          <select
                            value={q.category || "Other"}
                            onChange={(e) => handleUpdateCategory(q.id, e.target.value)}
                            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            {record?.score?.categories?.map(cat => (
                              <option key={cat.category} value={cat.category}>{cat.category}</option>
                            ))}
                            <option value="Other">Other</option>
                          </select>
                        </div>

                        {/* Question Column */}
                        <div className="px-4 py-3 border-r border-gray-100">
                          {isEditingQuestion ? (
                            <textarea
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              onBlur={handleSaveEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Tab' && !e.shiftKey) {
                                  e.preventDefault();
                                  handleSaveEdit();
                                  setTimeout(() => {
                                    const answerDiv = e.currentTarget.parentElement?.nextElementSibling;
                                    if (answerDiv) (answerDiv as HTMLElement).click();
                                  }, 50);
                                }
                              }}
                              className="w-full rounded-md border border-blue-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[90px]"
                              autoFocus
                            />
                          ) : (
                            <div
                              onClick={() => handleStartEdit(q.id, 'question')}
                              className="cursor-text hover:bg-white/50 rounded px-2 py-1 -mx-2 -my-1 transition-colors"
                            >
                              <p className="text-sm font-medium text-gray-900 whitespace-pre-wrap">{q.question}</p>
                              <p className="text-xs text-gray-500 mt-1">
                                {isQuestionClosed(q) && q.answeredAt
                                  ? `Answered ${new Date(q.answeredAt).toLocaleDateString()}`
                                  : `Added ${new Date(q.createdAt).toLocaleDateString()}`}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Answer Column */}
                        <div className="px-4 py-3 border-r border-gray-100">
                          {isEditingAnswer ? (
                            <textarea
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              onBlur={handleSaveEdit}
                              placeholder="Enter answer..."
                              className="w-full rounded-md border border-blue-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[90px]"
                              autoFocus
                            />
                          ) : (
                            <div
                              onClick={() => handleStartEdit(q.id, 'answer')}
                              className="cursor-text hover:bg-white/50 rounded px-2 py-1 -mx-2 -my-1 transition-colors min-h-[24px]"
                            >
                              {q.answer ? (
                                <p className="text-sm text-gray-900 whitespace-pre-wrap">{q.answer}</p>
                              ) : (
                                <p className="text-sm text-gray-400 italic">Click to add answer...</p>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Status Column */}
                        <div className="px-4 py-3 border-r border-gray-100 flex items-center">
                          <select
                            value={getQuestionUiStatus(q)}
                            onChange={(e) => void handleUpdateQuestionStatusUi(q.id, e.target.value as "open" | "closed")}
                            className={`w-full rounded-md border px-2 py-1.5 text-xs font-medium focus:outline-none focus:ring-1 ${
                              isQuestionClosed(q)
                                ? 'border-green-300 bg-green-50 text-green-700 focus:border-green-500 focus:ring-green-500'
                                : 'border-orange-300 bg-orange-50 text-orange-700 focus:border-orange-500 focus:ring-orange-500'
                            }`}
                          >
                            <option value="open">Open</option>
                            <option value="closed">Closed</option>
                          </select>
                        </div>

                        {/* Actions Column */}
                        <div className="px-4 py-3 flex items-center justify-center">
                          <button
                            onClick={() => handleDeleteQuestion(q.id)}
                            disabled={savingQuestions}
                            className="p-1.5 text-red-600 hover:bg-red-100 rounded-md transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100"
                            title="Delete question"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Documents Modal */}
        {showDocumentsModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={() => setShowDocumentsModal(false)}>
            <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">Documents ({record.documents.length})</h2>
                  {record.googleDriveFolderId && (
                    <a
                      href={`https://drive.google.com/drive/folders/${record.googleDriveFolderId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
                      title="Open full diligence folder in Google Drive"
                    >
                      <Folder className="h-4 w-4" />
                      Open Folder
                    </a>
                  )}
                </div>
                <button onClick={() => setShowDocumentsModal(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="p-4 overflow-y-auto max-h-[60vh]">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={(e) => handleUploadDocuments(e.target.files)}
                  accept=".pdf,.docx,.pptx,.ppt,.xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg"
                  className="hidden"
                />
                
                {/* Add Document / Link Buttons */}
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex-1 flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {uploading ? <LoadingSpinner /> : <Upload className="h-4 w-4" />}
                    Upload Document
                  </button>
                  <button
                    onClick={() => setAddingLink(!addingLink)}
                    disabled={uploading}
                    className="flex-1 flex items-center justify-center gap-2 rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Add Link
                  </button>
                </div>

                {/* Add Link Form */}
                {addingLink && (
                  <div className="mb-4 p-3 bg-gray-50 rounded-md border border-gray-200">
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="Link Name (e.g., 'Pitch Deck' or 'Founder Call')"
                        value={linkName}
                        onChange={(e) => setLinkName(e.target.value)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                        placeholder="Access Email (optional - for DocSend/email-gated links)"
                        value={linkEmail}
                        onChange={(e) => setLinkEmail(e.target.value)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleAddLink}
                          disabled={!linkName.trim() || !linkUrl.trim() || uploading}
                          className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          Add Link
                        </button>
                        <button
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

                {/* Documents List */}
                {failedDocsendDocuments.length > 0 && (
                  <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
                    <p className="text-xs font-semibold text-amber-900">
                      DocSend warning: {failedDocsendDocuments.length} link
                      {failedDocsendDocuments.length > 1 ? "s were" : " was"} not ingested.
                    </p>
                    <p className="mt-0.5 text-xs text-amber-800">
                      These links will not be used in thesis/scoring until ingest succeeds.
                    </p>
                  </div>
                )}
                {documentParseIssueCount > 0 && (
                  <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2">
                    <p className="text-xs font-semibold text-red-900">
                      Parse warning: {documentParseIssueCount} document
                      {documentParseIssueCount > 1 ? "s have" : " has"} unreadable or unparsed content.
                    </p>
                    <p className="mt-0.5 text-xs text-red-800">
                      These items are highlighted below and will be excluded from thesis/scoring until fixed.
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  {record.documents.map((doc) => {
                    const parseIssue = getDocumentParseIssue(doc);
                    return (
                    <div
                      key={doc.id}
                      className={`rounded-md border px-3 py-2 ${
                        parseIssue ? "border-red-200 bg-red-50/40" : "border-gray-200 bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <a
                          href={doc.externalUrl || doc.googleDriveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 flex-1 min-w-0 hover:text-blue-600 transition-colors"
                        >
                          <FileText className={`h-4 w-4 flex-shrink-0 ${parseIssue ? "text-red-500" : "text-gray-400"}`} />
                          <p className="text-sm font-medium truncate">{doc.name}</p>
                          {getLinkIngestBadge(doc)}
                          <ExternalLink className="h-3 w-3 text-gray-400 flex-shrink-0" />
                        </a>
                        <button
                          onClick={async () => {
                            if (confirm(`Delete "${doc.name}"?`)) {
                              try {
                                const updatedDocs = record.documents.filter(d => d.id !== doc.id);
                                const response = await fetch(`/api/diligence/${id}`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ documents: updatedDocs }),
                                });
                                const data = await response.json();
                                if (data.success) {
                                  setRecord(data.record);
                                } else {
                                  alert('Failed to delete document');
                                }
                              } catch (err) {
                                console.error('Error deleting document:', err);
                                alert('Failed to delete document');
                              }
                            }
                          }}
                          className="ml-2 p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Delete document"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      {doc.accessEmail && (
                        <div className="mt-2 pt-2 border-t border-gray-200">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">Access email:</span>
                              <span className="text-xs font-mono text-gray-700">{doc.accessEmail}</span>
                            </div>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(doc.accessEmail!);
                              }}
                              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                              title="Copy email"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      )}
                      {parseIssue && (
                        <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">
                          <span className="font-semibold">Warning:</span> {parseIssue}
                        </div>
                      )}
                      {doc.externalUrl && doc.linkIngestMessage && (
                        <div className="mt-2 text-xs text-gray-600">
                          Ingest detail: {doc.linkIngestMessage}
                          {doc.linkIngestedAt && (
                            <span className="ml-2 text-gray-500">
                              ({new Date(doc.linkIngestedAt).toLocaleString()})
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )})}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Chat Modal */}
        {showChatModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={() => setShowChatModal(false)}>
            <div className="bg-white rounded-lg max-w-2xl w-full h-[600px] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">AI Discussion</h2>
                  <p className="text-xs text-gray-500">Ask questions about the diligence</p>
                </div>
                <button onClick={() => setShowChatModal(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {record.chatHistory.length === 0 ? (
                  <div className="text-center text-sm text-gray-500 mt-8">
                    <p>Start a conversation about this diligence.</p>
                    <p className="text-xs mt-2">Ask about scores, concerns, or get recommendations.</p>
                  </div>
                ) : (
                  record.chatHistory.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-lg px-4 py-2 ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        <p className="text-xs mt-1 opacity-70">{new Date(msg.timestamp).toLocaleTimeString()}</p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>
              <form onSubmit={handleSendMessage} className="border-t border-gray-200 p-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    disabled={chatLoading}
                    placeholder="Ask about the diligence..."
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                  />
                  <button
                    type="submit"
                    disabled={chatLoading || !chatMessage.trim()}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {chatLoading ? <LoadingSpinner /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* PDF Export Modal */}
        {showPdfModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={() => setShowPdfModal(false)}>
            <div className="bg-white rounded-lg max-w-md w-full" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">Export to PDF</h2>
                <button onClick={() => setShowPdfModal(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="p-6">
                <p className="text-sm text-gray-600 mb-4">Select which sections to include in the PDF:</p>
                
                <div className="mb-4">
                  <button
                    onClick={toggleAllPdfSections}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    {selectedPdfSections.size === 8 ? 'Deselect All' : 'Select All'}
                  </button>
                </div>

                <div className="space-y-2 mb-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPdfSections.has('overview')}
                      onChange={() => togglePdfSection('overview')}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Company Overview</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPdfSections.has('score')}
                      onChange={() => togglePdfSection('score')}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Overall Score + Data Quality</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPdfSections.has('metrics')}
                      onChange={() => togglePdfSection('metrics')}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Key Metrics</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPdfSections.has('categories')}
                      onChange={() => togglePdfSection('categories')}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Scoring Grid</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPdfSections.has('thesis')}
                      onChange={() => togglePdfSection('thesis')}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Investment Thesis</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPdfSections.has('followup')}
                      onChange={() => togglePdfSection('followup')}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Due Diligence Follow-up</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPdfSections.has('questions')}
                      onChange={() => togglePdfSection('questions')}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Open Questions & Answers</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPdfSections.has('notes')}
                      onChange={() => togglePdfSection('notes')}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Notes</span>
                  </label>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleGeneratePdf}
                    disabled={selectedPdfSections.size === 0}
                    className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Generate PDF
                  </button>
                  <button
                    onClick={() => setShowPdfModal(false)}
                    className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PDF Export Component (hidden) */}
        {generatingPdf && record && (
          <DiligencePdfExport
            record={record}
            selectedSections={selectedPdfSections}
            onComplete={() => setGeneratingPdf(false)}
          />
        )}

        {/* Score Override Modal */}
        {editingCategory && (
          <ScoreOverrideModal
            category={editingCategory}
            onClose={() => setEditingCategory(null)}
            onSave={handleSaveOverride}
            onRemove={handleRemoveOverride}
          />
        )}

        {/* HubSpot Link Modal */}
        {showHubspotLinker && record && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div
              className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
              style={{ transform: `translate(${hubspotCreateModalOffset.x}px, ${hubspotCreateModalOffset.y}px)` }}
            >
              <div
                className="flex items-center justify-between p-6 border-b border-gray-200 cursor-move"
                onMouseDown={handleHubSpotCreateModalDragStart}
              >
                <h2 className="text-xl font-semibold text-gray-900">
                  Link HubSpot Deal
                </h2>
                <button
                  onClick={() => setShowHubspotLinker(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Search HubSpot deals</label>
                  <div className="flex items-center gap-2">
                    <input
                      value={hubspotSearchQuery}
                      onChange={(e) => setHubspotSearchQuery(e.target.value)}
                      placeholder="Search by company/deal name"
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    />
                    <button
                      onClick={() => handleSearchHubSpotDeals()}
                      disabled={searchingHubspotDeals}
                      className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {searchingHubspotDeals ? "Searching..." : "Search"}
                    </button>
                  </div>
                </div>

                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {hubspotSearchResults.map((deal) => (
                    <button
                      key={deal.id}
                      onClick={() => handleLinkHubSpotDeal(deal)}
                      disabled={linkingHubspotDeal}
                      className="w-full rounded border border-gray-200 px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-50"
                    >
                      <div className="text-sm font-medium text-gray-900">{deal.name}</div>
                      <div className="text-xs text-gray-600">
                        {deal.stageLabel || "Unknown stage"} • {deal.amount || "No amount"}
                      </div>
                    </button>
                  ))}
                  {!searchingHubspotDeals && hubspotSearchAttempted && hubspotSearchResults.length === 0 && (
                    <p className="text-sm text-gray-500">No matching deals found.</p>
                  )}
                </div>
                {record.hubspotDealId && (
                  <div className="rounded bg-blue-50 px-3 py-2 text-xs text-blue-800">
                    Currently linked to deal {record.hubspotDealId}. Selecting a deal above will replace the link.
                  </div>
                )}

                {hubspotCreateError && (
                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {hubspotCreateError}
                  </div>
                )}

                {hubspotCreatePreview && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="rounded border border-gray-200 bg-white p-3">
                      <h4 className="mb-2 text-xs font-semibold text-gray-800">Fields</h4>
                      <div className="max-h-72 space-y-2 overflow-y-auto">
                        {getVisibleHubSpotCreateFieldEntries().map(({ objectType, key, value }) => {
                          const fieldMeta = (objectType === "company" ? hubspotCreatePreview.company.fields : hubspotCreatePreview.deal.fields)
                            .find((field) => field.hubspotProperty === key);
                          const fieldDescription = hubspotFieldDescriptions[`${objectType}:${key}`];
                          const hoverDescription =
                            fieldDescription ||
                            String(fieldMeta?.notes || "").trim() ||
                            `HubSpot property: ${key}`;
                          const selectedDealPipeline = hubspotPipelineOptions.find(
                            (pipeline) => pipeline.id === (hubspotCreateDealDraft.pipeline || "")
                          );
                          const dealStageOptions = [...(selectedDealPipeline?.stages || [])]
                            .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
                            .filter((stage) => stage.id && stage.label)
                            .map((stage) => ({ label: stage.label, value: stage.id }));
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
                                  onChange={(e) => updateHubSpotCreateDraft(objectType, key, e.target.value)}
                                  rows={2}
                                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                                  disabled={hubspotCreateSaving}
                                />
                              ) : key === "hubspot_owner_id" ? (
                                <select
                                  value={value}
                                  onChange={(e) => updateHubSpotCreateDraft(objectType, key, e.target.value)}
                                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                                  disabled={hubspotCreateSaving || hubspotOwnerOptionsLoading}
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
                                  onChange={(e) => updateHubSpotCreateDraft(objectType, key, e.target.value)}
                                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                                  disabled={hubspotCreateSaving || hubspotIndustryOptionsLoading}
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
                                  onChange={(e) => updateHubSpotCreateDraft(objectType, key, e.target.value)}
                                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                                  disabled={hubspotCreateSaving}
                                >
                                  {US_STATE_OPTIONS.map((option) => (
                                    <option key={option || "blank"} value={option}>
                                      {option || "Select state"}
                                    </option>
                                  ))}
                                </select>
                              ) : key === "pipeline" && dealFlowPipelineOptions.length > 0 ? (
                                <select
                                  value={value}
                                  onChange={(e) => updateHubSpotCreateDraft(objectType, key, e.target.value)}
                                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                                  disabled={hubspotCreateSaving}
                                >
                                  <option value="">Select deal-flow pipeline</option>
                                  {dealFlowPipelineOptions.map((pipeline) => (
                                    <option key={pipeline.id} value={pipeline.id}>
                                      {pipeline.label}
                                    </option>
                                  ))}
                                </select>
                              ) : key === "dealstage" && dealStageOptions.length > 0 ? (
                                <select
                                  value={value}
                                  onChange={(e) => updateHubSpotCreateDraft(objectType, key, e.target.value)}
                                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                                  disabled={hubspotCreateSaving}
                                >
                                  <option value="">Select deal stage</option>
                                  {dealStageOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (key === "hs_all_collaborator_owner_ids" || key === "original_mudita_source") && hubspotOwnerOptions.length > 0 ? (
                                <select
                                  value={value}
                                  onChange={(e) => updateHubSpotCreateDraft(objectType, key, e.target.value)}
                                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                                  disabled={hubspotCreateSaving || hubspotOwnerOptionsLoading}
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
                                  onChange={(e) => updateHubSpotCreateDraft(objectType, key, e.target.value)}
                                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                                  disabled={hubspotCreateSaving}
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
                                  onChange={(e) => updateHubSpotCreateDraft(objectType, key, e.target.value)}
                                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                                  disabled={hubspotCreateSaving}
                                />
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
                <button
                  onClick={() => {
                    if (hubspotCreatePreview) {
                      void handleCommitHubSpotCreate();
                    } else {
                      void handlePrepareHubSpotCreate();
                    }
                  }}
                  disabled={hubspotCreateLoading || hubspotCreateSaving}
                  className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {hubspotCreateSaving
                    ? "Creating..."
                    : hubspotCreateLoading
                      ? "Preparing..."
                      : "Create HubSpot Records"}
                </button>
                <button
                  onClick={() => setShowHubspotLinker(false)}
                  className="px-4 py-2 text-gray-700 hover:text-gray-900 font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {showClosedLostStageModal && pendingClosedLostStage && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
              <div className="flex items-center justify-between p-5 border-b border-gray-200">
                <h3 className="text-base font-semibold text-gray-900">Complete Closed Lost Details</h3>
                <button
                  onClick={() => {
                    setShowClosedLostStageModal(false);
                    setPendingClosedLostStage(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="p-5 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Deal Reject Reasons</label>
                  <select
                    multiple
                    value={closedLostReasonsDraft}
                    onChange={(e) => {
                      const selected = Array.from(e.target.selectedOptions).map((option) => option.value);
                      setClosedLostReasonsDraft(selected);
                    }}
                    className="w-full min-h-24 rounded border border-gray-300 px-2 py-1 text-xs"
                  >
                    {(closedLostReasonOptions.length > 0
                      ? closedLostReasonOptions
                      : [{ label: "No options loaded", value: "" }])
                      .filter((option) => option.value)
                      .map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Closed Lost Reason Notes</label>
                  <textarea
                    value={closedLostReasonNotesDraft}
                    onChange={(e) => setClosedLostReasonNotesDraft(e.target.value)}
                    rows={3}
                    className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Round Still Open <span className="text-red-600">*</span></label>
                  <select
                    value={roundStillOpenDraft}
                    onChange={(e) => setRoundStillOpenDraft(e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                  >
                    <option value="">Select Yes or No</option>
                    {(roundStillOpenOptions.length > 0
                      ? roundStillOpenOptions
                      : [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }]).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-200 bg-gray-50">
                <button
                  onClick={() => {
                    setShowClosedLostStageModal(false);
                    setPendingClosedLostStage(null);
                  }}
                  className="px-3 py-2 text-sm text-gray-700 hover:text-gray-900"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void confirmClosedLostStageUpdate()}
                  className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Save and Set Stage
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Founders Edit Modal */}
        {showFoundersModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">Edit Founders</h2>
                <button
                  onClick={() => setShowFoundersModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {editingFounders.map((founder, idx) => (
                  <div key={idx} className="p-4 border border-gray-200 rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-gray-900">Founder {idx + 1}</h3>
                      {editingFounders.length > 1 && (
                        <button
                          onClick={() => {
                            const newFounders = editingFounders.filter((_, i) => i !== idx);
                            setEditingFounders(newFounders);
                          }}
                          className="text-red-600 hover:text-red-800"
                          title="Remove founder"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Name *
                      </label>
                      <input
                        type="text"
                        value={founder.name}
                        onChange={(e) => {
                          const newFounders = [...editingFounders];
                          newFounders[idx].name = e.target.value;
                          setEditingFounders(newFounders);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="e.g., John Doe"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Title
                      </label>
                      <input
                        type="text"
                        value={founder.title}
                        onChange={(e) => {
                          const newFounders = [...editingFounders];
                          newFounders[idx].title = e.target.value;
                          setEditingFounders(newFounders);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="e.g., CEO, CTO"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        LinkedIn URL
                      </label>
                      <input
                        type="url"
                        value={founder.linkedinUrl}
                        onChange={(e) => {
                          const newFounders = [...editingFounders];
                          newFounders[idx].linkedinUrl = e.target.value;
                          setEditingFounders(newFounders);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="https://www.linkedin.com/in/..."
                      />
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => {
                    setEditingFounders([...editingFounders, { name: '', linkedinUrl: '', title: '' }]);
                  }}
                  className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors"
                >
                  + Add Another Founder
                </button>
              </div>

              <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
                <button
                  onClick={() => setShowFoundersModal(false)}
                  className="px-4 py-2 text-gray-700 hover:text-gray-900 font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveFounders}
                  disabled={savingFounders || !editingFounders.some(f => f.name.trim())}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {savingFounders ? 'Saving...' : 'Save Founders'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
