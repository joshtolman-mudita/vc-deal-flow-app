"use client";

import { Deal } from "@/types";
import { ExternalLink, X, Sparkles, Search } from "lucide-react";
import { useState, useMemo, useEffect, useCallback } from "react";
import MatchResults from "./MatchResults";
import FilterDrawer, { FilterDrawerTrigger, FilterSection } from "./FilterDrawer";
import ActiveFilterBar, { FilterChip } from "./ActiveFilterBar";
import SortableHeader from "./SortableHeader";
import { useMultiSort, SortSpec } from "@/lib/hooks/useMultiSort";
import { useAppSettings } from "@/lib/hooks/useAppSettings";
import { useRouter } from "next/navigation";

// Fields that default to descending on first click
const DEFAULT_DESC_FIELDS = [
  "stageName",
  "raiseAmount",
  "committedFunding",
  "dealValuation",
  "diligenceScore",
  "arr",
];

interface DealsTableProps {
  deals: Deal[];
  selectedDeals?: string[];
  onSelectionChange?: (selectedIds: string[]) => void;
}

interface DealsTablePropsWithPortal extends DealsTableProps {
  portalId?: string;
  partners?: any[];
}

type FinancialField = "raiseAmount" | "committedFunding" | "dealValuation";

const FINANCIAL_HUBSPOT_PROPS: Record<FinancialField, string> = {
  raiseAmount: "raise_amount_in_millions",
  committedFunding: "committed_funding_in_millions",
  dealValuation: "deal_valuation_post_money_in_millions",
};

function getStageColor(stageName: string = ""): string {
  const n = stageName.toLowerCase();
  if (n.includes("deal 0")) return "bg-slate-100 text-slate-600";
  if (n.includes("deal 1")) return "bg-blue-100 text-blue-700";
  if (n.includes("deal 2")) return "bg-cyan-100 text-cyan-700";
  if (n.includes("deal 3")) return "bg-violet-100 text-violet-700";
  if (n.includes("deal 4")) return "bg-orange-100 text-orange-700";
  if (n.includes("deal 5")) return "bg-amber-100 text-amber-700";
  if (n.includes("deal 6")) return "bg-green-100 text-green-700";
  if (n.includes("deal 7") || n.includes("closed won")) return "bg-emerald-100 text-emerald-800";
  if (n.includes("paused")) return "bg-yellow-100 text-yellow-700";
  if (n.includes("closed") || n.includes("passed") || n.includes("declined")) return "bg-red-100 text-red-700";
  return "bg-gray-100 text-gray-700";
}

/** Parse ARR strings like "$1.2M", "$500K", "$2B", "1200000" → number in millions (or null) */
function parseArrToMillions(s: string | undefined | null): number | null {
  if (!s) return null;
  const clean = s.replace(/[$,\s]/g, "").toUpperCase();
  const match = clean.match(/^([\d.]+)([KMB]?)$/);
  if (!match) return null;
  const n = parseFloat(match[1]);
  if (isNaN(n)) return null;
  if (match[2] === "K") return n / 1000;
  if (match[2] === "B") return n * 1000;
  if (match[2] === "M") return n;
  // No suffix — treat raw number: if > 10000 assume dollars, else assume millions
  return n > 10000 ? n / 1_000_000 : n;
}

export default function DealsTable({
  deals,
  portalId,
  partners = [],
  selectedDeals = [],
  onSelectionChange,
}: DealsTablePropsWithPortal) {
  const router = useRouter();
  const { settings } = useAppSettings();

  // ── Multi-column sort ──────────────────────────────────────────────────────
  const { sorts, handleSort } = useMultiSort({
    defaultSorts: [{ field: "stageName", direction: "desc" }],
    defaultDescFields: DEFAULT_DESC_FIELDS,
  });

  // ── Filter drawer ──────────────────────────────────────────────────────────
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  // ── Filter state ───────────────────────────────────────────────────────────
  const [nameSearch, setNameSearch] = useState("");
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  // Independent Open / Closed toggles — both on or both off = show all
  const [filterOpen, setFilterOpen] = useState(true);
  const [filterClosed, setFilterClosed] = useState(false);
  const [valuationMin, setValuationMin] = useState("");
  const [valuationMax, setValuationMax] = useState("");
  const [roomLeftMin, setRoomLeftMin] = useState("");
  const [roomLeftMax, setRoomLeftMax] = useState("");
  // Whether the toolbar filter fields are in edit mode
  const [editingValMax, setEditingValMax] = useState(false);
  const [editingRoomMin, setEditingRoomMin] = useState(false);
  const [arrMin, setArrMin] = useState("");
  const [editingArrMin, setEditingArrMin] = useState(false);

  // ── Round-open inline toggle ───────────────────────────────────────────────
  const [updatingRoundOpen, setUpdatingRoundOpen] = useState<string | null>(null);

  // ── Inline edit (financial fields) ────────────────────────────────────────
  const [editingCell, setEditingCell] = useState<{ dealId: string; field: FinancialField } | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [financialOverrides, setFinancialOverrides] = useState<
    Record<string, Partial<Record<FinancialField, number>>>
  >();

  // ── Inline edit (stage) ───────────────────────────────────────────────────
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [stageOverrides, setStageOverrides] = useState<Record<string, { id: string; name: string }>>({});

  // ── AI matching ────────────────────────────────────────────────────────────
  const [matchingDeal, setMatchingDeal] = useState<Deal | null>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [matchDataQuality, setMatchDataQuality] = useState<any>(null);

  // ── Derived: unique stages from data ───────────────────────────────────────
  const uniqueStages = useMemo(() => {
    const stages = deals.map((d) => d.stageName || d.stage).filter(Boolean) as string[];
    return Array.from(new Set(stages)).sort();
  }, [deals]);

  // Stage ID ↔ name pairs for the inline-edit dropdown
  const stageOptions = useMemo(() => {
    const seen = new Map<string, string>();
    deals.forEach((d) => {
      if (d.stage) seen.set(d.stage, d.stageName || d.stage);
    });
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [deals]);

  // Default to non-paused stages on first load
  useEffect(() => {
    if (deals.length > 0 && selectedStages.length === 0) {
      const nonPaused = uniqueStages.filter((s) => !s.toLowerCase().includes("paused"));
      setSelectedStages(nonPaused);
    }
  }, [deals.length, uniqueStages, selectedStages.length]);

  // Stage-filtered pool (base for further filters)
  const stageFilteredDeals = useMemo(() => {
    if (selectedStages.length === 0 || selectedStages.length === uniqueStages.length) return deals;
    return deals.filter((d) => selectedStages.includes(d.stageName || d.stage || ""));
  }, [deals, selectedStages, uniqueStages.length]);

  // Industry options = everything matching current filters EXCEPT the industry filter itself
  // (faceted search — options shrink as you narrow other filters)
  const uniqueIndustries = useMemo(() => {
    let pool = stageFilteredDeals;

    if (nameSearch.trim() !== "") {
      const q = nameSearch.trim().toLowerCase();
      pool = pool.filter((d) => (d.name || "").toLowerCase().includes(q));
    }
    if (filterOpen && !filterClosed) {
      pool = pool.filter((d) => d.roundStillOpen !== "false");
    } else if (!filterOpen && filterClosed) {
      pool = pool.filter((d) => d.roundStillOpen === "false");
    }
    if (valuationMax !== "") {
      const vMax = parseFloat(valuationMax);
      if (!isNaN(vMax)) pool = pool.filter((d) => (d.dealValuation ?? Infinity) <= vMax);
    }
    if (roomLeftMin !== "") {
      const rlMin = parseFloat(roomLeftMin);
      if (!isNaN(rlMin)) pool = pool.filter((d) => {
        const raise = d.raiseAmount;
        if (raise == null) return false;
        return raise - (d.committedFunding ?? 0) >= rlMin;
      });
    }

    const industries = pool.map((d) => d.industry).filter((i) => i && i !== "N/A") as string[];
    return Array.from(new Set(industries)).sort();
  }, [stageFilteredDeals, nameSearch, filterOpen, filterClosed, valuationMax, roomLeftMin]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const formatMillions = (v: number | undefined | null): string => {
    if (v == null) return "—";
    const rounded = Math.round(v * 10) / 10;
    return `$${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}M`;
  };

  const formatDollars = (n: number): string => {
    if (n >= 1_000_000) {
      const m = n / 1_000_000;
      return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
    }
    if (n >= 1_000) return `$${Math.round(n / 1000)}K`;
    return `$${Math.round(n).toLocaleString()}`;
  };

  const getEffective = useCallback(
    (deal: Deal, field: FinancialField): number | undefined =>
      financialOverrides?.[deal.id]?.[field] ?? (deal[field] as number | undefined),
    [financialOverrides]
  );

  // ── Semantic multi-column sort ─────────────────────────────────────────────
  const sortDeals = useCallback(
    (list: Deal[], sortSpecs: SortSpec[]): Deal[] => {
      if (sortSpecs.length === 0) return list;
      return [...list].sort((a, b) => {
        for (const { field, direction } of sortSpecs) {
          const mult = direction === "asc" ? 1 : -1;
          let aVal: string | number = "";
          let bVal: string | number = "";

          switch (field) {
            case "name":
              aVal = (a.name || "").toLowerCase();
              bVal = (b.name || "").toLowerCase();
              break;
            case "industry":
              aVal = (a.industry || "").toLowerCase();
              bVal = (b.industry || "").toLowerCase();
              break;
            case "description":
              aVal = (a.description || "").toLowerCase();
              bVal = (b.description || "").toLowerCase();
              break;
            case "stageName":
              aVal = (stageOverrides[a.id]?.name || a.stageName || a.stage || "").toLowerCase();
              bVal = (stageOverrides[b.id]?.name || b.stageName || b.stage || "").toLowerCase();
              break;
            case "dealTerms":
              aVal = (a.dealTerms || "").toLowerCase();
              bVal = (b.dealTerms || "").toLowerCase();
              break;
            case "raiseAmount":
              aVal = getEffective(a, "raiseAmount") ?? -1;
              bVal = getEffective(b, "raiseAmount") ?? -1;
              break;
            case "committedFunding":
              aVal = getEffective(a, "committedFunding") ?? -1;
              bVal = getEffective(b, "committedFunding") ?? -1;
              break;
            case "dealValuation":
              aVal = getEffective(a, "dealValuation") ?? -1;
              bVal = getEffective(b, "dealValuation") ?? -1;
              break;
            case "roundStillOpen": {
              // Semantic order: Yes (2) > No (1) > Unknown (0)
              const rank = (v?: string) => (v === "true" ? 2 : v === "false" ? 1 : 0);
              aVal = rank(a.roundStillOpen);
              bVal = rank(b.roundStillOpen);
              break;
            }
            case "diligenceScore":
              aVal = a.diligenceScore ?? -1;
              bVal = b.diligenceScore ?? -1;
              break;
            case "diligenceStatus": {
              const r: Record<string, number> = { completed: 4, in_progress: 3, passed: 2, declined: 1 };
              aVal = r[a.diligenceStatus || ""] ?? 0;
              bVal = r[b.diligenceStatus || ""] ?? 0;
              break;
            }
            case "arr":
              aVal = parseArrToMillions(a.arr) ?? -1;
              bVal = parseArrToMillions(b.arr) ?? -1;
              break;
          }

          let cmp = 0;
          if (typeof aVal === "string" && typeof bVal === "string") {
            cmp = aVal.localeCompare(bVal);
          } else {
            cmp = (aVal as number) < (bVal as number) ? -1 : (aVal as number) > (bVal as number) ? 1 : 0;
          }
          if (cmp !== 0) return cmp * mult;
        }
        return 0;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getEffective, stageOverrides]
  );

  // ── Callbacks ──────────────────────────────────────────────────────────────
  const toggleStage = useCallback(
    (stage: string) =>
      setSelectedStages((prev) => (prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage])),
    []
  );

  const toggleIndustry = useCallback(
    (industry: string) =>
      setSelectedIndustries((prev) =>
        prev.includes(industry) ? prev.filter((i) => i !== industry) : [...prev, industry]
      ),
    []
  );

  const clearAllFilters = useCallback(() => {
    setNameSearch("");
    setSelectedStages(uniqueStages.filter((s) => !s.toLowerCase().includes("paused")));
    setSelectedIndustries([]);
    setFilterOpen(true);
    setFilterClosed(false);
    setValuationMin("");
    setValuationMax("");
    setRoomLeftMin("");
    setRoomLeftMax("");
    setArrMin("");
  }, [uniqueStages]);

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    if (selectedDeals.length === filteredAndSortedDeals.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(filteredAndSortedDeals.map((d) => d.id));
    }
  };

  const handleSelectDeal = (dealId: string) => {
    if (!onSelectionChange) return;
    onSelectionChange(
      selectedDeals.includes(dealId) ? selectedDeals.filter((id) => id !== dealId) : [...selectedDeals, dealId]
    );
  };

  const handleToggleRoundOpen = useCallback(async (deal: Deal) => {
    if (!deal.hubspotId) return;
    const newValue = deal.roundStillOpen === "true" ? "false" : "true";
    setUpdatingRoundOpen(deal.id);
    try {
      await fetch("/api/hubspot/deal", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: deal.hubspotId, properties: { round_still_open: newValue } }),
      });
      deal.roundStillOpen = newValue;
    } catch (err) {
      console.error("Failed to update round_still_open", err);
    } finally {
      setUpdatingRoundOpen(null);
    }
  }, []);

  const handleStartEdit = useCallback(
    (deal: Deal, field: FinancialField) => {
      if (!deal.hubspotId) return;
      const current = financialOverrides?.[deal.id]?.[field] ?? deal[field];
      setEditingCell({ dealId: deal.id, field });
      setEditingValue(current != null ? String(current) : "");
    },
    [financialOverrides]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditingValue("");
  }, []);

  const handleSaveStage = useCallback(async (deal: Deal, stageId: string, stageName: string) => {
    setEditingStageId(null);
    if (!deal.hubspotId) return;
    setStageOverrides((prev) => ({ ...prev, [deal.id]: { id: stageId, name: stageName } }));
    try {
      await fetch("/api/hubspot/deal", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: deal.hubspotId, properties: { dealstage: stageId } }),
      });
    } catch (err) {
      console.error("Failed to update deal stage", err);
      setStageOverrides((prev) => {
        const next = { ...prev };
        delete next[deal.id];
        return next;
      });
    }
  }, []);

  const handleSaveEdit = useCallback(
    async (deal: Deal, field: FinancialField) => {
      const trimmed = editingValue.trim();
      const parsed = trimmed === "" ? null : parseFloat(trimmed);
      setEditingCell(null);
      setEditingValue("");
      if (!deal.hubspotId) return;

      setFinancialOverrides((prev) => ({
        ...prev,
        [deal.id]: {
          ...(prev?.[deal.id] || {}),
          [field]: parsed != null && !isNaN(parsed) ? parsed : undefined,
        },
      }));

      try {
        await fetch("/api/hubspot/deal", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dealId: deal.hubspotId,
            properties: { [FINANCIAL_HUBSPOT_PROPS[field]]: parsed != null && !isNaN(parsed) ? String(parsed) : "" },
          }),
        });
      } catch (err) {
        console.error(`Failed to update ${FINANCIAL_HUBSPOT_PROPS[field]}`, err);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingValue]
  );

  const handleFindMatches = useCallback(
    async (deal: Deal) => {
      setMatchingDeal(deal);
      setMatches([]);
      setMatchDataQuality(null);
      setLoadingMatches(true);
      try {
        const res = await fetch("/api/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deal,
            partners,
            customGuidance: settings.matchingGuidance,
            minMatchScore: settings.minMatchScore,
            scoringWeights: settings.scoringWeights,
            checkSizeFilterStrictness: settings.checkSizeFilterStrictness,
            minDataQuality: settings.minDataQuality,
          }),
        });
        const data = await res.json();
        setMatches(data.matches || []);
        setMatchDataQuality(data.dataQuality || null);
      } catch (error) {
        console.error("Error finding matches:", error);
      } finally {
        setLoadingMatches(false);
      }
    },
    [partners, settings]
  );

  // ── Filtered + sorted deals ────────────────────────────────────────────────
  const filteredAndSortedDeals = useMemo(() => {
    let filtered = stageFilteredDeals;

    if (nameSearch.trim() !== "") {
      const q = nameSearch.trim().toLowerCase();
      filtered = filtered.filter((d) => (d.name || "").toLowerCase().includes(q));
    }

    if (selectedIndustries.length > 0) {
      filtered = filtered.filter((d) => selectedIndustries.includes(d.industry));
    }

    if (filterOpen && !filterClosed) {
      filtered = filtered.filter((d) => d.roundStillOpen !== "false");
    } else if (!filterOpen && filterClosed) {
      filtered = filtered.filter((d) => d.roundStillOpen === "false");
    }
    // both on or both off → show all

    // Post-money valuation range
    const vMin = valuationMin !== "" ? parseFloat(valuationMin) : null;
    const vMax = valuationMax !== "" ? parseFloat(valuationMax) : null;
    if (vMin !== null || vMax !== null) {
      filtered = filtered.filter((d) => {
        const val = getEffective(d, "dealValuation");
        if (val == null) return false;
        if (vMin !== null && val < vMin) return false;
        if (vMax !== null && val > vMax) return false;
        return true;
      });
    }

    // Room left in round (raise − committed)
    const rlMin = roomLeftMin !== "" ? parseFloat(roomLeftMin) : null;
    const rlMax = roomLeftMax !== "" ? parseFloat(roomLeftMax) : null;
    if (rlMin !== null || rlMax !== null) {
      filtered = filtered.filter((d) => {
        const raise = getEffective(d, "raiseAmount");
        if (raise == null) return false;
        const roomLeft = raise - (getEffective(d, "committedFunding") ?? 0);
        if (rlMin !== null && roomLeft < rlMin) return false;
        if (rlMax !== null && roomLeft > rlMax) return false;
        return true;
      });
    }

    // ARR minimum (filter input is in full dollars, deal.arr is parsed to millions then converted)
    if (arrMin !== "") {
      const arrMinDollars = parseFloat(arrMin);
      if (!isNaN(arrMinDollars)) {
        filtered = filtered.filter((d) => {
          const arrM = parseArrToMillions(d.arr);
          return arrM != null && arrM * 1_000_000 >= arrMinDollars;
        });
      }
    }

    return sortDeals(filtered, sorts);
  }, [
    stageFilteredDeals,
    nameSearch,
    selectedIndustries,
    filterOpen,
    filterClosed,
    valuationMin,
    valuationMax,
    roomLeftMin,
    roomLeftMax,
    arrMin,
    getEffective,
    sorts,
    sortDeals,
  ]);

  // ── Active filter chips (Stage & Industry — shown above the table) ──────────
  // Round/Valuation/Room Left are shown as always-visible inline quick-filters
  // so they don't need chips.
  const activeFilterChips = useMemo((): FilterChip[] => {
    const chips: FilterChip[] = [];

    if (selectedStages.length > 0 && selectedStages.length < uniqueStages.length) {
      if (selectedStages.length <= 3) {
        selectedStages.forEach((stage) =>
          chips.push({
            id: `stage-${stage}`,
            label: stage,
            onRemove: () => setSelectedStages((prev) => prev.filter((s) => s !== stage)),
          })
        );
      } else {
        chips.push({
          id: "stages",
          label: `Stages: ${selectedStages.length}/${uniqueStages.length}`,
          onRemove: () => setSelectedStages(uniqueStages),
        });
      }
    }

    if (selectedIndustries.length === 1) {
      chips.push({
        id: `industry-${selectedIndustries[0]}`,
        label: selectedIndustries[0],
        onRemove: () => setSelectedIndustries([]),
      });
    } else if (selectedIndustries.length > 1) {
      chips.push({
        id: "industries",
        label: `Industries: ${selectedIndustries.length}`,
        onRemove: () => setSelectedIndustries([]),
      });
    }

    return chips;
  }, [selectedStages, uniqueStages, selectedIndustries]);

  // Drawer badge only counts Stage & Industry (the two drawer-only filters)
  const activeDrawerFilterCount = useMemo(() => {
    let n = 0;
    if (selectedStages.length > 0 && selectedStages.length < uniqueStages.length) n++;
    if (selectedIndustries.length > 0) n++;
    return n;
  }, [selectedStages, uniqueStages, selectedIndustries]);

  // ── Empty state ────────────────────────────────────────────────────────────
  if (deals.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-12 text-center shadow-sm">
        <p className="text-gray-500">No deals found. Try adjusting your filters or sync from HubSpot.</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">

      {/* Filter Drawer — Stage & Industry only (secondary filters) */}
      <FilterDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        activeCount={activeDrawerFilterCount}
        onClearAll={() => {
          setSelectedStages(uniqueStages.filter((s) => !s.toLowerCase().includes("paused")));
          setSelectedIndustries([]);
        }}
      >
        <FilterSection title="Deal Stage">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">{selectedStages.length}/{uniqueStages.length} selected</span>
            <div className="flex gap-2">
              <button onClick={() => setSelectedStages(uniqueStages)} className="text-xs text-blue-600 hover:underline">All</button>
              <button onClick={() => setSelectedStages([])} className="text-xs text-gray-500 hover:underline">None</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {uniqueStages.map((stage) => (
              <button
                key={stage}
                onClick={() => toggleStage(stage)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedStages.includes(stage)
                    ? "bg-yellow-400 text-black"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {stage}
              </button>
            ))}
          </div>
        </FilterSection>

        <FilterSection title="Industry">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">
              {selectedIndustries.length === 0 ? "All showing" : `${selectedIndustries.length} selected`}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setSelectedIndustries(uniqueIndustries)} className="text-xs text-blue-600 hover:underline">All</button>
              <button onClick={() => setSelectedIndustries([])} className="text-xs text-gray-500 hover:underline">None</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {uniqueIndustries.map((industry) => (
              <button
                key={industry}
                onClick={() => toggleIndustry(industry)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedIndustries.includes(industry)
                    ? "bg-green-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {industry}
              </button>
            ))}
          </div>
        </FilterSection>
      </FilterDrawer>

      {/* ── Primary filter toolbar (always visible) ──────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">

        {/* Company search */}
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search company…"
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
            className="rounded border border-gray-300 pl-6 pr-6 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-40"
          />
          {nameSearch !== "" && (
            <button onClick={() => setNameSearch("")} className="absolute right-1.5 text-gray-400 hover:text-gray-600">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="h-5 w-px bg-gray-200 mx-1" />

        {/* Stage / Industry drawer trigger */}
        <FilterDrawerTrigger
          onClick={() => setFilterDrawerOpen(true)}
          activeCount={activeDrawerFilterCount}
        />

        <div className="h-5 w-px bg-gray-200 mx-1" />

        {/* Round Status — independent Open / Closed toggles */}
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-500 whitespace-nowrap">Round Status:</span>
          <button
            onClick={() => setFilterOpen((v) => !v)}
            className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
              filterOpen ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            Open
          </button>
          <button
            onClick={() => setFilterClosed((v) => !v)}
            className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
              filterClosed ? "bg-slate-600 text-white" : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            Closed
          </button>
        </div>

        <div className="h-5 w-px bg-gray-200 mx-1" />

        {/* Post-Money Max Valuation — click-to-edit */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-gray-500 whitespace-nowrap">Post Money Valuation (Max $M):</span>
          {editingValMax ? (
            <>
              <input
                type="number" min="0" step="1" autoFocus placeholder="e.g. 20"
                value={valuationMax}
                onChange={(e) => setValuationMax(e.target.value)}
                onBlur={() => setEditingValMax(false)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingValMax(false); }}
                className="w-20 rounded border border-blue-400 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {valuationMax !== "" && (
                <button onClick={() => { setValuationMax(""); setEditingValMax(false); }} className="text-gray-400 hover:text-gray-600">
                  <X className="h-3 w-3" />
                </button>
              )}
            </>
          ) : (
            <button
              onClick={() => setEditingValMax(true)}
              title="Click to set max valuation filter"
              className={`text-sm font-medium hover:underline ${valuationMax !== "" ? "text-blue-600" : "text-gray-400"}`}
            >
              {valuationMax !== "" ? formatMillions(parseFloat(valuationMax)) : "Any"}
            </button>
          )}
        </div>

        <div className="h-5 w-px bg-gray-200 mx-1" />

        {/* Remaining Round Minimum — click-to-edit */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-gray-500 whitespace-nowrap">Remaining Round (Min $M):</span>
          {editingRoomMin ? (
            <>
              <input
                type="number" min="0" step="0.5" autoFocus placeholder="e.g. 1"
                value={roomLeftMin}
                onChange={(e) => setRoomLeftMin(e.target.value)}
                onBlur={() => setEditingRoomMin(false)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingRoomMin(false); }}
                className="w-20 rounded border border-blue-400 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {roomLeftMin !== "" && (
                <button onClick={() => { setRoomLeftMin(""); setEditingRoomMin(false); }} className="text-gray-400 hover:text-gray-600">
                  <X className="h-3 w-3" />
                </button>
              )}
            </>
          ) : (
            <button
              onClick={() => setEditingRoomMin(true)}
              title="Click to set minimum remaining round filter"
              className={`text-sm font-medium hover:underline ${roomLeftMin !== "" ? "text-blue-600" : "text-gray-400"}`}
            >
              {roomLeftMin !== "" ? formatMillions(parseFloat(roomLeftMin)) : "Any"}
            </button>
          )}
        </div>

        <div className="h-5 w-px bg-gray-200 mx-1" />

        {/* ARR Minimum — click-to-edit */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-gray-500 whitespace-nowrap">ARR (Min $):</span>
          {editingArrMin ? (
            <>
              <input
                type="number" min="0" step="1000" autoFocus placeholder="e.g. 500000"
                value={arrMin}
                onChange={(e) => setArrMin(e.target.value)}
                onBlur={() => setEditingArrMin(false)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingArrMin(false); }}
                className="w-24 rounded border border-blue-400 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {arrMin !== "" && (
                <button onClick={() => { setArrMin(""); setEditingArrMin(false); }} className="text-gray-400 hover:text-gray-600">
                  <X className="h-3 w-3" />
                </button>
              )}
            </>
          ) : (
            <button
              onClick={() => setEditingArrMin(true)}
              title="Click to set minimum ARR filter (full dollar amount, e.g. 500000)"
              className={`text-sm font-medium hover:underline ${arrMin !== "" ? "text-blue-600" : "text-gray-400"}`}
            >
              {arrMin !== "" ? formatDollars(parseFloat(arrMin)) : "Any"}
            </button>
          )}
        </div>

        {/* Record count (right-aligned) */}
        <span className="ml-auto whitespace-nowrap text-sm text-gray-500">
          {filteredAndSortedDeals.length} of {deals.length} deals
          {selectedDeals.length > 0 && (
            <span className="ml-2 font-medium text-blue-600">• {selectedDeals.length} selected</span>
          )}
        </span>
      </div>

      {/* ── Active stage/industry chips ───────────────────────────────────────── */}
      {activeFilterChips.length > 0 && (
        <ActiveFilterBar chips={activeFilterChips} onClearAll={clearAllFilters} />
      )}

      {/* ── Table ─────────────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                {onSelectionChange && (
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={
                        selectedDeals.length === filteredAndSortedDeals.length &&
                        filteredAndSortedDeals.length > 0
                      }
                      onChange={handleSelectAll}
                      className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                  <SortableHeader field="name" label="Deal Name" sorts={sorts} onSort={handleSort} />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                  <SortableHeader field="industry" label="Industry" sorts={sorts} onSort={handleSort} />
                </th>
                <th className="w-72 px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                  <SortableHeader field="description" label="Description" sorts={sorts} onSort={handleSort} />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                  <SortableHeader field="stageName" label="Deal Stage" sorts={sorts} onSort={handleSort} />
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider">
                  <div className="flex justify-end">
                    <SortableHeader field="raiseAmount" label="Raising ($M)" sorts={sorts} onSort={handleSort} />
                  </div>
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider">
                  <div className="flex justify-end">
                    <SortableHeader field="committedFunding" label="Committed ($M)" sorts={sorts} onSort={handleSort} />
                  </div>
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider">
                  <div className="flex justify-end">
                    <SortableHeader field="dealValuation" label="Post-Money Val. ($M)" sorts={sorts} onSort={handleSort} />
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                  <SortableHeader field="dealTerms" label="Deal Terms" sorts={sorts} onSort={handleSort} />
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider">
                  <div className="flex justify-end">
                    <SortableHeader field="arr" label="ARR" sorts={sorts} onSort={handleSort} />
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                  <SortableHeader field="roundStillOpen" label="Round Open" sorts={sorts} onSort={handleSort} />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                  <SortableHeader field="diligenceScore" label="Diligence" sorts={sorts} onSort={handleSort} />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {filteredAndSortedDeals.map((deal) => (
                <tr key={deal.id} className="hover:bg-gray-50">
                  {onSelectionChange && (
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedDeals.includes(deal.id)}
                        onChange={() => handleSelectDeal(deal.id)}
                        className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                  )}
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900">{deal.name}</div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <div className="text-sm text-gray-600">{deal.industry}</div>
                  </td>
                  <td className="w-72 px-6 py-4">
                    <div
                      title={deal.description || undefined}
                      className="text-sm text-gray-600 overflow-hidden"
                      style={{ display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" }}
                    >
                      {deal.description || "—"}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    {editingStageId === deal.id ? (
                      <select
                        autoFocus
                        value={stageOverrides[deal.id]?.id ?? deal.stage}
                        onChange={(e) => {
                          const opt = stageOptions.find((s) => s.id === e.target.value);
                          if (!opt || !deal.hubspotId) return;
                          // Optimistic update
                          setStageOverrides((prev) => ({ ...prev, [deal.id]: { id: opt.id, name: opt.name } }));
                          setEditingStageId(null);
                          fetch("/api/hubspot/deal", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ dealId: deal.hubspotId, properties: { dealstage: opt.id } }),
                          }).catch((err) => {
                            console.error("Failed to update deal stage", err);
                            setStageOverrides((prev) => { const n = { ...prev }; delete n[deal.id]; return n; });
                          });
                        }}
                        onBlur={() => setEditingStageId(null)}
                        onKeyDown={(e) => { if (e.key === "Escape") setEditingStageId(null); }}
                        className="rounded border border-blue-400 px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        {stageOptions.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    ) : (
                      <button
                        type="button"
                        onClick={() => deal.hubspotId && setEditingStageId(deal.id)}
                        title={deal.hubspotId ? "Click to edit stage" : undefined}
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-opacity ${
                          getStageColor(stageOverrides[deal.id]?.name ?? deal.stageName ?? deal.stage)
                        } ${deal.hubspotId ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
                      >
                        {stageOverrides[deal.id]?.name ?? deal.stageName ?? deal.stage}
                      </button>
                    )}
                  </td>

                  {/* Financial cells (inline-editable) */}
                  {(["raiseAmount", "committedFunding", "dealValuation"] as FinancialField[]).map((field) => {
                    const effectiveValue = getEffective(deal, field);
                    const raiseVal = getEffective(deal, "raiseAmount");
                    const isEditing = editingCell?.dealId === deal.id && editingCell?.field === field;

                    let colorClass = "text-gray-700";
                    if (field === "committedFunding" && effectiveValue != null && raiseVal != null) {
                      colorClass =
                        effectiveValue >= raiseVal
                          ? "text-red-600"
                          : effectiveValue / raiseVal >= 0.75
                          ? "text-yellow-600"
                          : "text-green-600";
                    }

                    return (
                      <td key={field} className="whitespace-nowrap px-6 py-4 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            autoFocus
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={() => handleSaveEdit(deal, field)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit(deal, field);
                              if (e.key === "Escape") handleCancelEdit();
                            }}
                            className="w-20 rounded border border-blue-400 px-1 py-0.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="e.g. 2.5"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleStartEdit(deal, field)}
                            title="Click to edit"
                            className={`cursor-pointer text-sm font-medium ${colorClass} hover:underline`}
                          >
                            {formatMillions(effectiveValue)}
                          </button>
                        )}
                      </td>
                    );
                  })}

                  <td className="max-w-xs px-6 py-4">
                    <div className="text-sm text-gray-600">{deal.dealTerms || "—"}</div>
                  </td>

                  {/* ARR */}
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    <span className={`text-sm font-medium ${deal.arr ? "text-gray-700" : "text-gray-300"}`}>
                      {deal.arr || "—"}
                    </span>
                  </td>

                  {/* Round Open toggle */}
                  <td className="whitespace-nowrap px-6 py-4">
                    <button
                      type="button"
                      onClick={() => handleToggleRoundOpen(deal)}
                      disabled={updatingRoundOpen === deal.id || !deal.hubspotId}
                      title="Click to toggle round still open in HubSpot"
                      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                        deal.roundStillOpen === "true"
                          ? "bg-green-100 text-green-800 hover:bg-green-200"
                          : deal.roundStillOpen === "false"
                          ? "bg-gray-100 text-gray-500 hover:bg-gray-200"
                          : "bg-amber-50 text-amber-600 hover:bg-amber-100"
                      } ${updatingRoundOpen === deal.id ? "cursor-wait opacity-50" : "cursor-pointer"}`}
                    >
                      {updatingRoundOpen === deal.id
                        ? "…"
                        : deal.roundStillOpen === "true"
                        ? "Yes"
                        : deal.roundStillOpen === "false"
                        ? "No"
                        : "Unknown"}
                    </button>
                  </td>

                  {/* Diligence score + status */}
                  <td className="whitespace-nowrap px-6 py-4">
                    {deal.diligenceId ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-medium text-gray-800">
                          {deal.diligenceScore !== undefined ? deal.diligenceScore : "No score"}
                        </span>
                        <span className="text-xs text-gray-500">
                          {(deal.diligenceStatus || "in_progress").replace("_", " ")}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">Not started</span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="whitespace-nowrap px-6 py-4">
                    <div className="flex items-center gap-2">
                      {deal.diligenceId ? (
                        <button
                          onClick={() => router.push(`/diligence/${deal.diligenceId}`)}
                          className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800"
                          title="View linked diligence record"
                        >
                          <span className="text-xs">View Diligence</span>
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            router.push(
                              `/diligence/new?companyName=${encodeURIComponent(deal.name)}` +
                                (deal.description
                                  ? `&companyDescription=${encodeURIComponent(deal.description)}`
                                  : "")
                            )
                          }
                          className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800"
                          title="Start diligence for this deal"
                        >
                          <span className="text-xs">Start Diligence</span>
                        </button>
                      )}
                      {partners.length > 0 && (
                        <button
                          onClick={() => handleFindMatches(deal)}
                          className="flex items-center gap-1 text-purple-600 hover:text-purple-800"
                          title="Find matching VCs"
                        >
                          <Sparkles className="h-4 w-4" />
                          <span className="text-xs">Match</span>
                        </button>
                      )}
                      {deal.hubspotId && portalId && (
                        <a
                          href={`https://app.hubspot.com/contacts/${portalId}/record/0-3/${deal.hubspotId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-blue-600 hover:text-blue-700"
                          title="View in HubSpot"
                        >
                          <ExternalLink className="h-4 w-4" />
                          <span className="text-xs">View</span>
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Match Results Modal */}
      {matchingDeal && (
        <MatchResults
          dealName={matchingDeal.name}
          matches={matches}
          onClose={() => setMatchingDeal(null)}
          loading={loadingMatches}
          dataQuality={matchDataQuality}
        />
      )}
    </div>
  );
}
