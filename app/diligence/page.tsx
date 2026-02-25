"use client";

import { useState, useEffect, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import LoadingSpinner from "@/components/LoadingSpinner";
import { FileSearch, Plus, Eye, Trash2, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, Globe } from "lucide-react";
import { DiligenceRecord } from "@/types/diligence";
import { useRouter } from "next/navigation";

type SortField = 'company' | 'priority' | 'stage' | 'score' | 'date';
type SortDirection = 'asc' | 'desc';
type PriorityFilter = 'all' | 'high' | 'medium' | 'low';

interface HubSpotStage {
  id: string;
  label: string;
  displayOrder: number;
}

interface HubSpotPipeline {
  id: string;
  label: string;
  stages: HubSpotStage[];
}
interface HubSpotSelectOption {
  label: string;
  value: string;
}

type HubSpotAutoLinkStatus = {
  status: "linked" | "no_match" | "ambiguous" | "error";
  message?: string;
};

function HubSpotIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" fill="#FF7A59" />
      <circle cx="18.5" cy="5.5" r="2.2" fill="#FF7A59" />
      <circle cx="5.4" cy="18.6" r="1.8" fill="#FF7A59" />
      <path d="M14.4 9.6L17 7.8M10 13.8L6.9 17M12 8.8V3.5" stroke="#FF7A59" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function DiligencePage() {
  const router = useRouter();
  const [records, setRecords] = useState<DiligenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [pipelines, setPipelines] = useState<HubSpotPipeline[]>([]);
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [showUnlinked, setShowUnlinked] = useState(true);
  const [showOffThesisOnly, setShowOffThesisOnly] = useState(false);
  const [editingStageRecordId, setEditingStageRecordId] = useState<string | null>(null);
  const [editingIndustryRecordId, setEditingIndustryRecordId] = useState<string | null>(null);
  const [editingPriorityRecordId, setEditingPriorityRecordId] = useState<string | null>(null);
  const [hubspotIndustryOptions, setHubspotIndustryOptions] = useState<HubSpotSelectOption[]>([]);
  const [hubspotPriorityOptions, setHubspotPriorityOptions] = useState<HubSpotSelectOption[]>([]);
  const [savingIndustryRecordId, setSavingIndustryRecordId] = useState<string | null>(null);
  const [savingPriorityRecordId, setSavingPriorityRecordId] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [hubspotAutoLinkStatuses, setHubspotAutoLinkStatuses] = useState<Record<string, HubSpotAutoLinkStatus>>({});
  const [deleteDialog, setDeleteDialog] = useState<{
    id: string;
    companyName: string;
    hasDriveFolder: boolean;
  } | null>(null);

  // Helper functions to calculate effective scores (matching detail page logic)
  const getEffectiveCriterionScore = (criterion: any) => criterion?.manualOverride ?? criterion?.score ?? 0;

  const getComputedCategoryScoreFromCriteria = (category: any): number => {
    if (!category?.criteria || category.criteria.length === 0) return category?.score ?? 0;
    const total = category.criteria.reduce((sum: number, criterion: any) => sum + getEffectiveCriterionScore(criterion), 0);
    return Math.round(total / category.criteria.length);
  };

  const getEffectiveCategoryScore = (category: any) => getComputedCategoryScoreFromCriteria(category);

  const getEffectiveOverallScore = (record: DiligenceRecord): number => {
    if (!record.score?.categories || record.score.categories.length === 0) {
      return record.score?.overall ?? 0;
    }
    const totalWeight = record.score.categories.reduce((sum, category) => sum + (category.weight || 0), 0);
    if (totalWeight <= 0) return record.score?.overall ?? 0;
    const weightedTotal = record.score.categories.reduce(
      (sum, category) => sum + (getEffectiveCategoryScore(category) * (category.weight || 0)),
      0
    );
    return Math.round(weightedTotal / totalWeight);
  };

  useEffect(() => {
    fetchRecords();
    fetchStages();
    fetchIndustryOptions();
    fetchPriorityOptions();
  }, []);

  const fetchRecords = async () => {
    try {
      const response = await fetch("/api/diligence");
      const data = await response.json();

      if (data.success) {
        setRecords(data.records || []);
        setHubspotAutoLinkStatuses(data.hubspotAutoLinkStatuses || {});
      } else {
        setError(data.error || "Failed to load diligence records");
      }
    } catch (err) {
      console.error("Error fetching diligence records:", err);
      setError("Failed to connect to API");
    } finally {
      setLoading(false);
    }
  };

  const fetchStages = async () => {
    try {
      const response = await fetch("/api/hubspot/stages");
      const data = await response.json();

      if (data.success && data.pipelines) {
        // Filter to only Fund II Deal Flow pipeline
        const fundIIPipeline = data.pipelines.find((p: HubSpotPipeline) => 
          p.label === "Fund II Deal Flow"
        );
        
        if (fundIIPipeline) {
          setPipelines([fundIIPipeline]);
          // Default to showing stages deal 0: through deal 6: (excluding deal 7:)
          const defaultStages = fundIIPipeline.stages
            .filter((s: HubSpotStage) => {
              const label = s.label.toLowerCase();
              // Include stages starting with "deal 0:" through "deal 6:"
              for (let i = 0; i <= 6; i++) {
                if (label.startsWith(`deal ${i}:`)) {
                  return true;
                }
              }
              return false;
            })
            .map((s: HubSpotStage) => s.id);
          setSelectedStages(defaultStages);
        } else {
          console.warn("Fund II Deal Flow pipeline not found");
          setPipelines([]);
        }
      }
    } catch (err) {
      console.error("Error fetching HubSpot stages:", err);
    }
  };

  const fetchIndustryOptions = async () => {
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
    } catch (err) {
      console.warn("Error fetching HubSpot industry options:", err);
    }
  };

  const fetchPriorityOptions = async () => {
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
    } catch (err) {
      console.warn("Error fetching HubSpot priority options:", err);
    }
  };

  const sortRecords = (recordsToSort: DiligenceRecord[], field: SortField, direction: SortDirection) => {
    const sorted = [...recordsToSort].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (field) {
        case 'company':
          aValue = a.companyName.toLowerCase();
          bValue = b.companyName.toLowerCase();
          break;
        case 'stage':
          // Sort by stage display order if available
          const aStage = pipelines.flatMap(p => p.stages).find(s => s.id === a.hubspotDealStageId);
          const bStage = pipelines.flatMap(p => p.stages).find(s => s.id === b.hubspotDealStageId);
          aValue = aStage?.displayOrder ?? 999;
          bValue = bStage?.displayOrder ?? 999;
          break;
        case 'priority': {
          const rank = (record: DiligenceRecord) => {
            const normalized = normalizePriorityKey(resolvePriorityValue(record));
            if (normalized === 'high') return 3;
            if (normalized === 'medium') return 2;
            if (normalized === 'low') return 1;
            return 0;
          };
          aValue = rank(a);
          bValue = rank(b);
          break;
        }
        case 'score':
          aValue = a.score ? getEffectiveOverallScore(a) : -1; // Put unscored at the end
          bValue = b.score ? getEffectiveOverallScore(b) : -1;
          break;
        case 'date':
          aValue = new Date(a.createdAt).getTime();
          bValue = new Date(b.createdAt).getTime();
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  };

  const handleSort = (field: SortField) => {
    let newDirection: SortDirection = 'asc';
    
    if (sortField === field) {
      // Toggle direction if clicking the same field
      newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      // Default to desc for score and date, asc for others
      newDirection = (field === 'score' || field === 'date' || field === 'priority') ? 'desc' : 'asc';
    }
    
    setSortField(field);
    setSortDirection(newDirection);
  };

  const toggleStageFilter = (stageId: string) => {
    setSelectedStages(prev => {
      if (prev.includes(stageId)) {
        return prev.filter(s => s !== stageId);
      }
      return [...prev, stageId];
    });
  };

  const updateRecordStage = async (id: string, stageId: string, stageLabel: string) => {
    try {
      const response = await fetch(`/api/diligence/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          hubspotDealStageId: stageId,
          hubspotDealStageLabel: stageLabel,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setRecords(prev => prev.map(record => (record.id === id ? data.record : record)));
      } else {
        const errorText = `Failed to update stage:\n\n${data.error || 'Unknown error'}`;
        console.error('Update failed:', data.error);
        alert(errorText);
      }
    } catch (error: any) {
      const errorText = `Failed to update stage:\n\n${error?.message || error || 'Network error'}`;
      console.error('Error updating stage:', error);
      alert(errorText);
    }
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

  const inferIndustryFromRecord = (record: DiligenceRecord): string => {
    if (hubspotIndustryOptions.length === 0) return "";
    const corpus = [
      record.companyName || "",
      record.companyOneLiner || "",
      record.companyDescription || "",
      record.hubspotCompanyData?.description || "",
      record.hubspotCompanyData?.industrySector || "",
      record.hubspotCompanyData?.investmentSector || "",
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

  const normalizePriorityKey = (rawPriority?: string): PriorityFilter => {
    const normalized = String(rawPriority || "").trim().toLowerCase();
    if (!normalized) return "all";
    if (normalized.includes("high")) return "high";
    if (normalized.includes("medium")) return "medium";
    if (normalized.includes("low")) return "low";
    return "all";
  };

  const resolvePriorityValue = (record: DiligenceRecord): string => {
    const anyRecord = record as any;
    return String(
      record.priority ||
        anyRecord?.hubspotData?.priority ||
        anyRecord?.hubspotDealData?.priority ||
        anyRecord?.hubspotCompanyData?.hs_priority ||
        ""
    ).trim();
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

  const chooseIndustryValue = (record: DiligenceRecord): string => {
    const preferred = resolvePreferredIndustry(record);
    const mapped = preferred ? mapIndustryGuessToOptionValue(preferred, hubspotIndustryOptions) : "";
    if (mapped) return mapped;
    const inferred = inferIndustryFromRecord(record);
    if (inferred) return inferred;
    const other = hubspotIndustryOptions.find((option) => /other/i.test(option.label));
    if (other?.value) return other.value;
    return "";
  };

  const updateRecordIndustry = async (id: string, industryValue: string) => {
    setSavingIndustryRecordId(id);
    try {
      const response = await fetch(`/api/diligence/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry: industryValue }),
      });
      const data = await response.json();
      if (data.success) {
        setRecords(prev => prev.map(record => (record.id === id ? data.record : record)));
      } else {
        throw new Error(data.error || "Failed to update industry");
      }
    } catch (err: any) {
      alert(`Failed to update industry: ${err?.message || 'Unknown error'}`);
    } finally {
      setSavingIndustryRecordId(null);
    }
  };

  const updateRecordPriority = async (id: string, priorityValue: string) => {
    setSavingPriorityRecordId(id);
    try {
      const response = await fetch(`/api/diligence/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: priorityValue }),
      });
      const data = await response.json();
      if (data.success) {
        setRecords((prev) => prev.map((record) => (record.id === id ? data.record : record)));
      } else {
        throw new Error(data.error || "Failed to update priority");
      }
    } catch (err: any) {
      alert(`Failed to update priority: ${err?.message || "Unknown error"}`);
    } finally {
      setSavingPriorityRecordId(null);
    }
  };

  const displayedRecords = useMemo(() => {
    const filtered = records.filter(record => {
      if (priorityFilter !== "all") {
        const normalizedPriority = normalizePriorityKey(resolvePriorityValue(record));
        if (normalizedPriority !== priorityFilter) {
          return false;
        }
      }
      if (showOffThesisOnly && record.thesisFit?.fit !== "off_thesis") {
        return false;
      }
      // Show unlinked records if showUnlinked is true
      if (!record.hubspotDealId || !record.hubspotDealStageId) {
        return showUnlinked;
      }
      // Show records with selected stages
      return selectedStages.includes(record.hubspotDealStageId);
    });
    return sortRecords(filtered, sortField, sortDirection);
  }, [records, selectedStages, showUnlinked, showOffThesisOnly, sortField, sortDirection, pipelines, priorityFilter]);

  const thesisFitLabel = (fit?: "on_thesis" | "mixed" | "off_thesis") => {
    if (fit === "on_thesis") return "On thesis";
    if (fit === "off_thesis") return "Off thesis";
    return "Mixed";
  };

  const thesisFitBadgeClass = (fit?: string) => {
    if (fit === "on_thesis") return "bg-green-100 text-green-800";
    if (fit === "off_thesis") return "bg-red-100 text-red-800";
    if (fit === "mixed") return "bg-amber-100 text-amber-800";
    return "bg-gray-100 text-gray-700";
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-4 w-4 text-gray-400" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="h-4 w-4 text-blue-600" />
      : <ArrowDown className="h-4 w-4 text-blue-600" />;
  };

  const performDelete = async (id: string, folderAction: 'keep' | 'archive' | 'delete') => {
    try {
      const response = await fetch(`/api/diligence/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderAction }),
      });

      const data = await response.json();

      if (data.success) {
        // Refresh the list
        fetchRecords();
      } else {
        alert(`Failed to delete: ${data.error}`);
      }
    } catch (err) {
      console.error('Error deleting record:', err);
      alert('Failed to delete record');
    }
  };

  const handleDelete = async (id: string, companyName: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent navigation to detail page
    const record = records.find(r => r.id === id);
    setDeleteDialog({
      id,
      companyName,
      hasDriveFolder: !!record?.googleDriveFolderId,
    });
  };

  const getStageBadge = (stageId: string | undefined, stageLabel: string | undefined, isClickable: boolean = false) => {
    if (!stageId || !stageLabel) {
      return (
        <span className={`px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-600 ${isClickable ? 'cursor-not-allowed' : ''}`}>
          Not Linked
        </span>
      );
    }

    // Color code based on stage progression (rough heuristic)
    const lowerLabel = stageLabel.toLowerCase();
    let colorClass = "bg-blue-100 text-blue-800";
    
    if (lowerLabel.includes('closed') && lowerLabel.includes('won')) {
      colorClass = "bg-green-100 text-green-800";
    } else if (lowerLabel.includes('closed') || lowerLabel.includes('lost')) {
      colorClass = "bg-red-100 text-red-800";
    } else if (lowerLabel.includes('qualified') || lowerLabel.includes('presentation')) {
      colorClass = "bg-yellow-100 text-yellow-800";
    }

    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${colorClass} ${isClickable ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}>
        {stageLabel}
      </span>
    );
  };

  const getPriorityBadge = (rawPriority: string | undefined, isClickable: boolean = false) => {
    const normalized = normalizePriorityKey(rawPriority);
    let colorClass = "bg-gray-100 text-gray-600";
    let label = "Not set";
    if (normalized === "high") {
      colorClass = "bg-red-100 text-red-800";
      label = "High";
    } else if (normalized === "medium") {
      colorClass = "bg-yellow-100 text-yellow-800";
      label = "Medium";
    } else if (normalized === "low") {
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

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getCompanyDescriptionForList = (record: DiligenceRecord): string => {
    const companyData = record.hubspotCompanyData as any;
    const existing = (
      companyData?.description ||
      companyData?.descriptor ||
      companyData?.company_description ||
      companyData?.anythingElse ||
      record.companyDescription ||
      record.companyOneLiner ||
      ""
    );
    if (existing) return existing;
    const industry = (record.industry || companyData?.industry || "").trim();
    const website = (record.companyUrl || companyData?.website || "").trim();
    const industryPart = industry ? ` in the ${industry} space` : "";
    const websitePart = website ? ` Website: ${website}.` : "";
    return `${record.companyName} is a company under diligence review${industryPart}.${websitePart}`;
  };

  const resolvePreferredIndustry = (record: DiligenceRecord): string => {
    const company = record.hubspotCompanyData;
    return (
      record.industry?.trim() ||
      company?.industrySector?.trim() ||
      company?.investmentSector?.trim() ||
      company?.industry?.trim() ||
      ""
    );
  };

  useEffect(() => {
    if (hubspotIndustryOptions.length === 0 || records.length === 0) return;
    const missing = records.filter((record) => !resolvePreferredIndustry(record));
    if (missing.length === 0) return;
    void (async () => {
      for (const record of missing.slice(0, 5)) {
        const fallback = chooseIndustryValue(record);
        if (!fallback) continue;
        await updateRecordIndustry(record.id, fallback);
      }
    })();
  }, [hubspotIndustryOptions, records]);

  const normalizeWebsiteUrl = (value?: string): string | null => {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Due Diligence</h1>
            <p className="mt-1 text-sm text-gray-600">
              AI-powered diligence scoring and analysis
            </p>
          </div>
          <button
            onClick={() => router.push("/diligence/new")}
            className="flex items-center gap-2 rounded-lg bg-yellow-400 px-4 py-2 text-sm font-bold text-black hover:bg-yellow-500"
          >
            <Plus className="h-4 w-4" />
            New Diligence
          </button>
        </div>

        {/* Error State */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Stage Filter:</span>
            <button
              onClick={() => setShowUnlinked(!showUnlinked)}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${
                showUnlinked
                  ? 'bg-gray-200 text-gray-800'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              Not Linked
            </button>
            {pipelines.flatMap(pipeline => 
              pipeline.stages.map(stage => (
                <button
                  key={stage.id}
                  onClick={() => toggleStageFilter(stage.id)}
                  className={`rounded-md px-3 py-1 text-xs font-semibold ${
                    selectedStages.includes(stage.id)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                  title={`${pipeline.label}: ${stage.label}`}
                >
                  {stage.label}
                </button>
              ))
            )}
            <label className="ml-2 text-sm font-medium text-gray-700" htmlFor="priority-filter">
              Priority:
            </label>
            <select
              id="priority-filter"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as PriorityFilter)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-700"
              title="Filter records by priority"
            >
              <option value="all">All</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            {priorityFilter !== "all" && (
              <button
                onClick={() => setPriorityFilter("all")}
                className="rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-200"
                title="Clear priority filter"
              >
                Clear priority
              </button>
            )}
            <button
              onClick={() => setShowOffThesisOnly(!showOffThesisOnly)}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${
                showOffThesisOnly
                  ? "bg-red-600 text-white"
                  : "bg-red-50 text-red-700"
              }`}
              title="Show only records whose thesis-first/fit result is off thesis"
            >
              Off-thesis only
            </button>
          </div>
        </div>

        {/* Records List */}
        {displayedRecords.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-12 text-center shadow-sm">
            <FileSearch className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-4 text-lg font-semibold text-gray-900">
              No Matching Diligence Records
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              Adjust the stage filter or create a new diligence record.
            </p>
            <button
              onClick={() => router.push("/diligence/new")}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-yellow-400 px-4 py-2 text-sm font-bold text-black hover:bg-yellow-500"
            >
              <Plus className="h-4 w-4" />
              New Diligence
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => handleSort('company')}
                    >
                      <div className="flex items-center gap-2">
                        <span>Company</span>
                        {getSortIcon('company')}
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Description
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Industry
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => handleSort('priority')}
                    >
                      <div className="flex items-center gap-2">
                        <span>Priority</span>
                        {getSortIcon('priority')}
                      </div>
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => handleSort('stage')}
                    >
                      <div className="flex items-center gap-2">
                        <span>HubSpot Stage</span>
                        {getSortIcon('stage')}
                      </div>
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => handleSort('score')}
                    >
                      <div className="flex items-center gap-2">
                        <span>Score</span>
                        {getSortIcon('score')}
                      </div>
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => handleSort('date')}
                    >
                      <div className="flex items-center gap-2">
                        <span>Date</span>
                        {getSortIcon('date')}
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {displayedRecords.map((record) => (
                    <tr key={record.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                          <button
                            onClick={() => router.push(`/diligence/${record.id}`)}
                            className="hover:text-blue-600 hover:underline"
                            title="Open diligence record"
                          >
                            {record.companyName}
                          </button>
                          {hubspotAutoLinkStatuses[record.id] &&
                            hubspotAutoLinkStatuses[record.id].status !== "linked" && (
                              <span
                                title={hubspotAutoLinkStatuses[record.id].message || "HubSpot auto-link issue"}
                                className="inline-flex items-center text-amber-600"
                              >
                                <AlertTriangle className="h-4 w-4" />
                              </span>
                            )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div
                          className="text-sm text-gray-600 max-w-xs truncate"
                          title={getCompanyDescriptionForList(record)}
                        >
                          {getCompanyDescriptionForList(record) || <span className="italic text-gray-400">No company description</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {editingIndustryRecordId === record.id ? (
                          <select
                            value={mapIndustryGuessToOptionValue(resolvePreferredIndustry(record), hubspotIndustryOptions) || ""}
                            onChange={(e) => {
                              void updateRecordIndustry(record.id, e.target.value);
                              setEditingIndustryRecordId(null);
                            }}
                            onBlur={() => setEditingIndustryRecordId(null)}
                            autoFocus
                            disabled={savingIndustryRecordId === record.id}
                            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                          >
                            <option value="" disabled>
                              Select industry...
                            </option>
                            {hubspotIndustryOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div
                            className="text-sm text-gray-600 cursor-pointer hover:text-blue-600"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (hubspotIndustryOptions.length > 0) {
                                setEditingIndustryRecordId(record.id);
                              }
                            }}
                            title="Click to edit industry"
                          >
                            {mapIndustryValueToDisplayLabel(resolvePreferredIndustry(record)) || <span className="italic text-gray-400">Not set</span>}
                            {savingIndustryRecordId === record.id && (
                              <span className="ml-2 text-xs text-gray-500">Saving...</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {editingPriorityRecordId === record.id ? (
                          <select
                            value={resolvePriorityValue(record)}
                            onChange={(e) => {
                              void updateRecordPriority(record.id, e.target.value);
                              setEditingPriorityRecordId(null);
                            }}
                            onBlur={() => setEditingPriorityRecordId(null)}
                            autoFocus
                            disabled={savingPriorityRecordId === record.id}
                            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                          >
                            <option value="">Select priority...</option>
                            {(hubspotPriorityOptions.length > 0
                              ? hubspotPriorityOptions
                              : [
                                  { value: "HIGH", label: "High" },
                                  { value: "MEDIUM", label: "Medium" },
                                  { value: "LOW", label: "Low" },
                                ]
                            ).map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div
                            className="inline-flex"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingPriorityRecordId(record.id);
                            }}
                            title="Click to edit priority"
                          >
                            {getPriorityBadge(resolvePriorityValue(record), true)}
                            {savingPriorityRecordId === record.id && (
                              <span className="ml-2 text-xs text-gray-500">Saving...</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 relative">
                        {editingStageRecordId === record.id && record.hubspotDealId ? (
                          <select
                            value={record.hubspotDealStageId || ''}
                            onChange={(e) => {
                              const stageId = e.target.value;
                              const stage = pipelines.flatMap(p => p.stages).find(s => s.id === stageId);
                              if (stage) {
                                updateRecordStage(record.id, stage.id, stage.label);
                              }
                              setEditingStageRecordId(null);
                            }}
                            onBlur={() => setEditingStageRecordId(null)}
                            autoFocus
                            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
                          >
                            <option value="">Select stage...</option>
                            {pipelines.map(pipeline => (
                              <optgroup key={pipeline.id} label={pipeline.label}>
                                {pipeline.stages.map(stage => (
                                  <option key={stage.id} value={stage.id}>
                                    {stage.label}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        ) : (
                          <div onClick={(e) => {
                            e.stopPropagation();
                            if (record.hubspotDealId) {
                              setEditingStageRecordId(record.id);
                            }
                          }}>
                            {getStageBadge(record.hubspotDealStageId, record.hubspotDealStageLabel, !!record.hubspotDealId)}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {record.score ? (
                          <div className="text-sm">
                            <span className={`text-2xl font-bold ${getScoreColor(getEffectiveOverallScore(record))}`}>
                              {getEffectiveOverallScore(record)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">Not scored</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-600">
                          {new Date(record.updatedAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => router.push(`/diligence/${record.id}`)}
                            className="text-blue-600 hover:text-blue-800"
                            title="View details"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {record.hubspotDealId && (
                            <a
                              href={`https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID}/record/0-3/${record.hubspotDealId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-400 hover:text-blue-600"
                              title="View in HubSpot"
                            >
                              <HubSpotIcon className="h-4 w-4" />
                            </a>
                          )}
                          {normalizeWebsiteUrl(record.companyUrl) && (
                            <a
                              href={normalizeWebsiteUrl(record.companyUrl)!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-400 hover:text-blue-600"
                              title="Visit company website"
                            >
                              <Globe className="h-4 w-4" />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={(e) => handleDelete(record.id, record.companyName, e)}
                            className="text-gray-400 hover:text-red-600"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {deleteDialog && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
              <div className="border-b border-gray-200 p-4">
                <h3 className="text-lg font-semibold text-gray-900">Delete Diligence Record</h3>
                <p className="mt-1 text-sm text-gray-600">
                  {deleteDialog.companyName}
                </p>
              </div>
              <div className="space-y-3 p-4 text-sm text-gray-700">
                <p>This will delete the diligence record from the app.</p>
                {deleteDialog.hasDriveFolder ? (
                  <p>Choose what to do with the Google Drive folder:</p>
                ) : (
                  <p>No Google Drive folder found for this record.</p>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-gray-200 p-4">
                <button
                  type="button"
                  onClick={async () => {
                    const target = deleteDialog;
                    setDeleteDialog(null);
                    await performDelete(target.id, 'archive');
                  }}
                  disabled={!deleteDialog.hasDriveFolder}
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Archive
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const target = deleteDialog;
                    setDeleteDialog(null);
                    await performDelete(target.id, target.hasDriveFolder ? 'delete' : 'keep');
                  }}
                  className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteDialog(null)}
                  className="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stats */}
        {displayedRecords.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm text-gray-600">Visible Diligence</p>
              <p className="text-2xl font-bold text-gray-900">{displayedRecords.length}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm text-gray-600">Linked to HubSpot</p>
              <p className="text-2xl font-bold text-blue-600">
                {displayedRecords.filter(r => r.hubspotDealId).length}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm text-gray-600">Closed Won</p>
              <p className="text-2xl font-bold text-green-600">
                {displayedRecords.filter(r => 
                  r.hubspotDealStageLabel?.toLowerCase().includes('closed') && 
                  r.hubspotDealStageLabel?.toLowerCase().includes('won')
                ).length}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-sm text-gray-600">Avg Score</p>
              <p className="text-2xl font-bold text-gray-900">
                {displayedRecords.filter(r => r.score).length > 0
                  ? Math.round(
                      displayedRecords
                        .filter(r => r.score)
                        .reduce((sum, r) => sum + (r.score?.overall || 0), 0) /
                        displayedRecords.filter(r => r.score).length
                    )
                  : 'N/A'}
              </p>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
