"use client";

import { useState, useEffect, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import DealsTable from "@/components/DealsTable";
import TableSkeleton from "@/components/TableSkeleton";
import EmailGeneratorModal from "@/components/EmailGeneratorModal";
import { Deal } from "@/types";
import { RefreshCw, AlertCircle, Mail } from "lucide-react";
import { useDataCache } from "@/lib/hooks/useDataCache";

interface Partner {
  id: string;
  name: string;
  [key: string]: any;
}

export default function DealsPage() {
  const dataCache = useDataCache();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hubspotConfigured, setHubspotConfigured] = useState(true);
  const [portalId, setPortalId] = useState<string | null>(dataCache.portalId);
  
  // Email generation
  const [selectedDealIds, setSelectedDealIds] = useState<string[]>([]);
  const [showEmailModal, setShowEmailModal] = useState(false);
  
  // Get selected deal objects
  const selectedDeals = useMemo(
    () => deals.filter(deal => selectedDealIds.includes(deal.id)),
    [deals, selectedDealIds]
  );

  // Fetch data function (not memoized to avoid stale closure issues)
  const fetchData = async (forceRefresh = false) => {
      // Check cache first (unless forcing refresh)
      if (!forceRefresh) {
        const cachedDeals = dataCache.getCachedDeals();
        const cachedPartners = dataCache.getCachedPartners();

        if (cachedDeals && cachedPartners) {
          const seenCache = new Set<string>();
          setDeals(cachedDeals.filter((d: Deal) => { if (seenCache.has(d.id)) return false; seenCache.add(d.id); return true; }));
          setPartners(cachedPartners);
          setHubspotConfigured(true);
          setError(null);
          setLoading(false);
          setSyncing(false);
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
        } else if (dealsData.deals) {
          // Deduplicate by HubSpot id (API occasionally returns the same deal twice across pages)
          const seen = new Set<string>();
          const uniqueDeals = (dealsData.deals as Deal[]).filter((d) => {
            if (seen.has(d.id)) return false;
            seen.add(d.id);
            return true;
          });
          setDeals(uniqueDeals);
          setHubspotConfigured(true);
          setError(null);
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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Deal Flow</h1>
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
          <TableSkeleton rows={8} />
        ) : (
          <DealsTable
            deals={deals}
            portalId={portalId || undefined}
            partners={partners}
            selectedDeals={selectedDealIds}
            onSelectionChange={setSelectedDealIds}
          />
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



