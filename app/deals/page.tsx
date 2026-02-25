"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import DealsTable from "@/components/DealsTable";
import DealFilters from "@/components/DealFilters";
import TableSkeleton from "@/components/TableSkeleton";
import EmailGeneratorModal from "@/components/EmailGeneratorModal";
import { Deal } from "@/types";
import { RefreshCw, AlertCircle, CheckCircle, Mail } from "lucide-react";
import { filterDeals } from "@/lib/hubspot-utils";
import { useDataCache } from "@/lib/hooks/useDataCache";

interface Partner {
  id: string;
  name: string;
  [key: string]: any;
}

export default function DealsPage() {
  const dataCache = useDataCache();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [filteredDeals, setFilteredDeals] = useState<Deal[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hubspotConfigured, setHubspotConfigured] = useState(true);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [portalId, setPortalId] = useState<string | null>(dataCache.portalId);
  
  // Email generation
  const [selectedDealIds, setSelectedDealIds] = useState<string[]>([]);
  const [showEmailModal, setShowEmailModal] = useState(false);
  
  // Get selected deal objects
  const selectedDeals = useMemo(
    () => deals.filter(deal => selectedDealIds.includes(deal.id)),
    [deals, selectedDealIds]
  );

  // Memoize unique industries and stages to avoid recalculation
  const industries = useMemo(
    () => Array.from(new Set(deals.map((d) => d.industry).filter((i) => i && i !== "N/A"))),
    [deals]
  );
  
  const stages = useMemo(
    () => Array.from(new Set(deals.map((d) => d.stage).filter((s) => s && s !== "N/A"))),
    [deals]
  );

  // Fetch data function (not memoized to avoid stale closure issues)
  const fetchData = async (forceRefresh = false) => {
      // Check cache first (unless forcing refresh)
      if (!forceRefresh) {
        const cachedDeals = dataCache.getCachedDeals();
        const cachedPartners = dataCache.getCachedPartners();

        if (cachedDeals && cachedPartners) {
          setDeals(cachedDeals);
          setFilteredDeals(cachedDeals);
          setPartners(cachedPartners);
          setHubspotConfigured(true);
          setError(null);
          setLoading(false);
          setSyncing(false);
          setLastSynced(new Date().toISOString());
          return;
        }
      }

      try {
        // Fetch both deals and partners in parallel for better performance
        const [dealsResponse, partnersResponse] = await Promise.all([
          fetch("/api/hubspot/deals"),
          fetch("/api/hubspot/partners"),
        ]);

        const [dealsData, partnersData] = await Promise.all([
          dealsResponse.json(),
          partnersResponse.json(),
        ]);

        // Process deals
        if (!dealsData.configured) {
          setHubspotConfigured(false);
          setError(dealsData.error || "HubSpot is not configured");
          setDeals([]);
          setFilteredDeals([]);
        } else if (dealsData.deals) {
          setDeals(dealsData.deals);
          setFilteredDeals(dealsData.deals);
          setHubspotConfigured(true);
          setError(null);
          setLastSynced(dealsData.synced_at);
          if (dealsData.portalId) {
            setPortalId(dealsData.portalId);
          }
          // Cache the deals
          dataCache.setDeals(dealsData.deals, dealsData.portalId);
        } else {
          setError(dealsData.error || "Failed to fetch deals");
        }

        // Process partners
        if (partnersData.partners) {
          setPartners(partnersData.partners);
          // Cache the partners
          dataCache.setPartners(partnersData.partners);
        }
      } catch (err) {
        const error = err as Error;
        setError(error.message || "Failed to connect to API");
        setHubspotConfigured(false);
      } finally {
        setLoading(false);
        setSyncing(false);
      }
  };

  // Initial load
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Sync handler
  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    // Force refresh to bypass cache
    await fetchData(true);
  };

  const handleFilterChange = useCallback(
    (filters: any) => {
      const filtered = filterDeals(deals, filters);
      setFilteredDeals(filtered);
    },
    [deals]
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Deals</h1>
            <p className="mt-1 text-sm text-gray-600">
              {hubspotConfigured
                ? `Manage and filter deals from HubSpot (${deals.length} total)`
                : "Configure HubSpot to start syncing deals"}
            </p>
          </div>
          <div className="flex gap-2">
            {selectedDealIds.length > 0 && (
              <button
                onClick={() => setShowEmailModal(true)}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
                title="Generate AI email for selected deals"
              >
                <Mail className="h-4 w-4" />
                Generate Email ({selectedDealIds.length})
              </button>
            )}
            <button
              onClick={handleSync}
              disabled={syncing || !hubspotConfigured}
              className="flex items-center gap-2 rounded-lg bg-yellow-400 px-4 py-2 text-sm font-bold text-black hover:bg-yellow-500 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing..." : "Sync from HubSpot"}
            </button>
          </div>
        </div>

        {/* Status Messages */}
        {lastSynced && !error && (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <p className="text-sm text-green-800">
              Last synced: {new Date(lastSynced).toLocaleString()}
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-yellow-800">
                  HubSpot Configuration Required
                </h3>
                <p className="mt-1 text-sm text-yellow-700">{error}</p>
                <div className="mt-3 text-xs text-yellow-700">
                  <p className="font-semibold">To connect HubSpot:</p>
                  <ol className="mt-1 ml-4 list-decimal space-y-1">
                    <li>Create a <code className="bg-yellow-100 px-1 rounded">.env.local</code> file in your project root</li>
                    <li>Add: <code className="bg-yellow-100 px-1 rounded">HUBSPOT_ACCESS_TOKEN=your_token_here</code></li>
                    <li>Get your token from: <a href="https://app.hubspot.com/settings/api-key" target="_blank" rel="noopener noreferrer" className="underline">HubSpot Settings</a></li>
                    <li>Restart your dev server</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <>
            {/* Filters Skeleton */}
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm animate-pulse">
              <div className="space-y-4">
                <div>
                  <div className="h-4 bg-gray-200 rounded w-32 mb-3"></div>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="h-9 w-24 bg-gray-200 rounded-md"></div>
                    ))}
                  </div>
                </div>
                <div className="pt-4 border-t border-gray-200">
                  <div className="h-4 bg-gray-200 rounded w-32 mb-3"></div>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-9 w-28 bg-gray-200 rounded-md"></div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Table Skeleton */}
            <TableSkeleton rows={8} />
          </>
        ) : (
          <>
            {/* Filters */}
            {hubspotConfigured && deals.length > 0 && (
              <DealFilters
                onFilterChange={handleFilterChange}
                industries={industries}
                stages={stages}
              />
            )}

            {/* Deals Table */}
            <DealsTable 
              deals={filteredDeals} 
              portalId={portalId || undefined} 
              partners={partners}
              selectedDeals={selectedDealIds}
              onSelectionChange={setSelectedDealIds}
            />

            {/* Results Count */}
            {hubspotConfigured && deals.length > 0 && (
              <div className="text-center text-sm text-gray-600">
                Showing {filteredDeals.length} of {deals.length} deals
                {selectedDealIds.length > 0 && (
                  <span className="ml-2 text-blue-600 font-medium">
                    • {selectedDealIds.length} selected
                  </span>
                )}
              </div>
            )}
          </>
        )}

        {/* Email Generator Modal */}
        {showEmailModal && selectedDeals.length > 0 && (
          <EmailGeneratorModal
            selectedDeals={selectedDeals}
            onClose={() => {
              setShowEmailModal(false);
              setSelectedDealIds([]);
            }}
          />
        )}
      </div>
    </DashboardLayout>
  );
}



