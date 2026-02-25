"use client";

import { Deal } from "@/types";
import { ExternalLink, ArrowUpDown, ArrowUp, ArrowDown, X, Sparkles } from "lucide-react";
import { useState, useMemo, useEffect, useCallback } from "react";
import MatchResults from "./MatchResults";
import { useAppSettings } from "@/lib/hooks/useAppSettings";
import { useRouter } from "next/navigation";

interface DealsTableProps {
  deals: Deal[];
  selectedDeals?: string[];
  onSelectionChange?: (selectedIds: string[]) => void;
}

type SortField = "name" | "industry" | "description" | "stageName" | "nextSteps" | "dealTerms";
type SortDirection = "asc" | "desc" | null;

interface DealsTablePropsWithPortal extends DealsTableProps {
  portalId?: string;
  partners?: any[];
}

export default function DealsTable({ 
  deals, 
  portalId, 
  partners = [], 
  selectedDeals = [], 
  onSelectionChange 
}: DealsTablePropsWithPortal) {
  const router = useRouter();
  const [sortField, setSortField] = useState<SortField | null>("stageName");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [matchingDeal, setMatchingDeal] = useState<Deal | null>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [matchDataQuality, setMatchDataQuality] = useState<any>(null);
  
  // Use custom hook for settings to avoid repeated localStorage reads
  const { settings } = useAppSettings();

  // Selection handlers
  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    if (selectedDeals.length === filteredAndSortedDeals.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(filteredAndSortedDeals.map(d => d.id));
    }
  };

  const handleSelectDeal = (dealId: string) => {
    if (!onSelectionChange) return;
    if (selectedDeals.includes(dealId)) {
      onSelectionChange(selectedDeals.filter(id => id !== dealId));
    } else {
      onSelectionChange([...selectedDeals, dealId]);
    }
  };

  // Get unique stages from all deals
  const uniqueStages = useMemo(() => {
    const stages = deals.map((deal) => deal.stageName || deal.stage).filter(Boolean);
    return Array.from(new Set(stages)).sort();
  }, [deals]);

  // Initialize filters
  // Stages: pre-select non-paused stages
  // Industries: start with none selected (shows all)
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);

  // Get deals filtered by stage only
  const stageFilteredDeals = useMemo(() => {
    if (selectedStages.length === 0 || selectedStages.length === uniqueStages.length) {
      return deals;
    }
    return deals.filter((deal) => {
      const stageName = deal.stageName || deal.stage || "";
      return selectedStages.includes(stageName);
    });
  }, [deals, selectedStages, uniqueStages.length]);

  // Get industries from stage-filtered deals only
  const uniqueIndustries = useMemo(() => {
    const industries = stageFilteredDeals
      .map((deal) => deal.industry)
      .filter((i) => i && i !== "N/A");
    return Array.from(new Set(industries)).sort();
  }, [stageFilteredDeals]);

  // Initialize stage filter on first load (pre-select non-paused stages)
  useEffect(() => {
    if (deals.length > 0 && selectedStages.length === 0) {
      const nonPausedStages = uniqueStages.filter(stage => !stage.toLowerCase().includes("paused"));
      setSelectedStages(nonPausedStages);
    }
  }, [deals.length, uniqueStages, selectedStages.length]);

  // Memoize callbacks to prevent unnecessary re-renders
  const toggleStage = useCallback((stage: string) => {
    setSelectedStages((prev) =>
      prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage]
    );
  }, []);

  const toggleIndustry = useCallback((industry: string) => {
    setSelectedIndustries((prev) =>
      prev.includes(industry) ? prev.filter((i) => i !== industry) : [...prev, industry]
    );
  }, []);

  const clearAllFilters = useCallback(() => {
    setSelectedStages(uniqueStages.filter(stage => !stage.toLowerCase().includes("paused")));
    setSelectedIndustries([]);
  }, [uniqueStages]);

  // Memoize the AI matching handler to avoid recreation
  const handleFindMatches = useCallback(
    async (deal: Deal) => {
      setMatchingDeal(deal);
      setMatches([]);
      setMatchDataQuality(null);
      setLoadingMatches(true);

      try {
        const response = await fetch("/api/match", {
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

        const data = await response.json();
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

  // Memoize sort handler
  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        // Cycle through: asc -> desc -> null
        if (sortDirection === "asc") {
          setSortDirection("desc");
        } else if (sortDirection === "desc") {
          setSortDirection(null);
          setSortField(null);
        }
      } else {
        setSortField(field);
        setSortDirection("asc");
      }
    },
    [sortField, sortDirection]
  );

  // Filter and sort deals
  const filteredAndSortedDeals = useMemo(() => {
    // Start with stage-filtered deals
    let filtered = stageFilteredDeals;

    // Filter by selected industries (only if some are selected)
    // Empty selection = show all industries
    if (selectedIndustries.length > 0) {
      filtered = filtered.filter((deal) => {
        return selectedIndustries.includes(deal.industry);
      });
    }

    // Sort if a field is selected
    if (sortField && sortDirection) {
      filtered = [...filtered].sort((a, b) => {
        let aVal = "";
        let bVal = "";

        if (sortField === "name") {
          aVal = a.name || "";
          bVal = b.name || "";
        } else if (sortField === "industry") {
          aVal = a.industry || "";
          bVal = b.industry || "";
        } else if (sortField === "description") {
          aVal = a.description || "";
          bVal = b.description || "";
        } else if (sortField === "stageName") {
          aVal = a.stageName || a.stage || "";
          bVal = b.stageName || b.stage || "";
        } else if (sortField === "nextSteps") {
          aVal = a.nextSteps || "";
          bVal = b.nextSteps || "";
        } else if (sortField === "dealTerms") {
          aVal = a.dealTerms || "";
          bVal = b.dealTerms || "";
        }

        const comparison = aVal.localeCompare(bVal);
        return sortDirection === "asc" ? comparison : -comparison;
      });
    }

    return filtered;
  }, [stageFilteredDeals, selectedIndustries, sortField, sortDirection]);

  // Memoize sort icon rendering
  const getSortIcon = useCallback((field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    }
    if (sortDirection === "asc") {
      return <ArrowUp className="h-3 w-3" />;
    }
    return <ArrowDown className="h-3 w-3" />;
  }, [sortField, sortDirection]);

  if (deals.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-12 text-center shadow-sm">
        <p className="text-gray-500">No deals found. Try adjusting your filters or sync from HubSpot.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters - Multi-select above the table */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        {/* Stage Filter */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-gray-700">
              Filter by Deal Stage:
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedStages(uniqueStages)}
                className="text-xs text-gray-600 hover:text-gray-900 underline"
              >
                Select All
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={() => setSelectedStages([])}
                className="text-xs text-gray-600 hover:text-gray-900 underline"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {uniqueStages.map((stage) => (
              <button
                key={stage}
                onClick={() => toggleStage(stage)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  selectedStages.includes(stage)
                    ? "bg-yellow-400 text-black font-semibold"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {stage}
              </button>
            ))}
          </div>
        </div>

        {/* Industry Filter */}
        <div className="pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-gray-700">
              Filter by Industry:
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedIndustries(uniqueIndustries)}
                className="text-xs text-gray-600 hover:text-gray-900 underline"
              >
                Select All
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={() => setSelectedIndustries([])}
                className="text-xs text-gray-600 hover:text-gray-900 underline"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {uniqueIndustries.map((industry) => (
              <button
                key={industry}
                onClick={() => toggleIndustry(industry)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  selectedIndustries.includes(industry)
                    ? "bg-green-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {industry}
              </button>
            ))}
          </div>
        </div>

        {/* Clear All & Results Count */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
          <div className="text-sm text-gray-600">
            Showing {filteredAndSortedDeals.length} of {deals.length} deals
            {selectedIndustries.length > 0 && (
              <span className="text-gray-500"> • {selectedIndustries.length} {selectedIndustries.length === 1 ? 'industry' : 'industries'} selected</span>
            )}
          </div>
          {((selectedStages.length > 0 && selectedStages.length < uniqueStages.length) || 
            selectedIndustries.length > 0) && (
            <button
              onClick={clearAllFilters}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              <X className="h-3 w-3" />
              Reset to defaults
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                {onSelectionChange && (
                  <th className="px-6 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedDeals.length === filteredAndSortedDeals.length && filteredAndSortedDeals.length > 0}
                      onChange={handleSelectAll}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <button
                    onClick={() => handleSort("name")}
                    className="flex items-center gap-1 hover:text-gray-700"
                  >
                    Deal Name
                    {getSortIcon("name")}
                  </button>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <button
                    onClick={() => handleSort("industry")}
                    className="flex items-center gap-1 hover:text-gray-700"
                  >
                    Industry
                    {getSortIcon("industry")}
                  </button>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <button
                    onClick={() => handleSort("description")}
                    className="flex items-center gap-1 hover:text-gray-700"
                  >
                    Description
                    {getSortIcon("description")}
                  </button>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <button
                    onClick={() => handleSort("stageName")}
                    className="flex items-center gap-1 hover:text-gray-700"
                  >
                    Deal Stage
                    {getSortIcon("stageName")}
                  </button>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <button
                    onClick={() => handleSort("nextSteps")}
                    className="flex items-center gap-1 hover:text-gray-700"
                  >
                    Next Steps
                    {getSortIcon("nextSteps")}
                  </button>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <button
                    onClick={() => handleSort("dealTerms")}
                    className="flex items-center gap-1 hover:text-gray-700"
                  >
                    Deal Terms
                    {getSortIcon("dealTerms")}
                  </button>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Diligence
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
                  <td className="px-6 py-4">
                    <input
                      type="checkbox"
                      checked={selectedDeals.includes(deal.id)}
                      onChange={() => handleSelectDeal(deal.id)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </td>
                )}
                <td className="px-6 py-4">
                  <div className="text-sm font-medium text-gray-900">
                    {deal.name}
                  </div>
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <div className="text-sm text-gray-600">
                    {deal.industry}
                  </div>
                </td>
                <td className="px-6 py-4 max-w-xs">
                  <div className="text-sm text-gray-600">
                    {deal.description || "—"}
                  </div>
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <div className="text-sm text-gray-600">
                    {deal.stageName || deal.stage}
                  </div>
                </td>
                <td className="px-6 py-4 max-w-xs">
                  <div className="text-sm text-gray-600">
                    {deal.nextSteps || "—"}
                  </div>
                </td>
                <td className="px-6 py-4 max-w-xs">
                  <div className="text-sm text-gray-600">
                    {deal.dealTerms || "—"}
                  </div>
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  {deal.diligenceId ? (
                    <div className="flex flex-col gap-1">
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
                            `/diligence/new?companyName=${encodeURIComponent(deal.name)}`
                            + `${deal.description ? `&companyDescription=${encodeURIComponent(deal.description)}` : ""}`
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

