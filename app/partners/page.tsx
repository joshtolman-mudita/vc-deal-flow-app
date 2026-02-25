"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import CardSkeleton from "@/components/CardSkeleton";
import DealMatchResults from "@/components/DealMatchResults";
import { Partner } from "@/types";
import { RefreshCw, ExternalLink, Building2, DollarSign, TrendingUp, MapPin, Sparkles } from "lucide-react";
import { useAppSettings } from "@/lib/hooks/useAppSettings";
import { useDataCache } from "@/lib/hooks/useDataCache";

interface Deal {
  id: string;
  name: string;
  [key: string]: any;
}

export default function PartnersPage() {
  const dataCache = useDataCache();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hubspotConfigured, setHubspotConfigured] = useState(true);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [matchingPartner, setMatchingPartner] = useState<Partner | null>(null);
  const [dealMatches, setDealMatches] = useState<any[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [portalId, setPortalId] = useState<string>(dataCache.portalId || "21880552");
  const [matchDataQuality, setMatchDataQuality] = useState<any>(null);
  
  // Use custom hook for settings
  const { settings } = useAppSettings();

  // Fetch both partners and deals in parallel (not memoized to avoid stale closure issues)
  const fetchData = async (forceRefresh = false) => {
      // Check cache first (unless forcing refresh)
      if (!forceRefresh) {
        const cachedPartners = dataCache.getCachedPartners();
        const cachedDeals = dataCache.getCachedDeals();

        if (cachedPartners && cachedDeals) {
          setPartners(cachedPartners);
          setDeals(cachedDeals);
          setHubspotConfigured(true);
          setError(null);
          setLoading(false);
          setSyncing(false);
          setLastSynced(new Date().toISOString());
          return;
        }
      }

      try {
        const [partnersResponse, dealsResponse] = await Promise.all([
          fetch("/api/hubspot/partners"),
          fetch("/api/hubspot/deals"),
        ]);

        const [partnersData, dealsData] = await Promise.all([
          partnersResponse.json(),
          dealsResponse.json(),
        ]);

        // Process partners
        if (!partnersData.configured) {
          setHubspotConfigured(false);
          setError(partnersData.error || "HubSpot is not configured");
          setPartners([]);
        } else if (partnersData.partners) {
          setPartners(partnersData.partners);
          setHubspotConfigured(true);
          setError(null);
          setLastSynced(partnersData.synced_at);
          // Cache the partners
          dataCache.setPartners(partnersData.partners);
        } else {
          setError(partnersData.error || "Failed to fetch partners");
        }

        // Process deals
        if (dealsData.deals) {
          setDeals(dealsData.deals);
          if (dealsData.portalId) {
            setPortalId(dealsData.portalId);
          }
          // Cache the deals
          dataCache.setDeals(dealsData.deals, dealsData.portalId);
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

  // Memoize AI matching handler
  const handleFindDeals = useCallback(
    async (partner: Partner) => {
      setMatchingPartner(partner);
      setDealMatches([]);
      setMatchDataQuality(null);
      setLoadingMatches(true);

      try {
        const response = await fetch("/api/match-deals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            partner,
            deals,
            customGuidance: settings.matchingGuidance,
            minMatchScore: settings.minMatchScore,
            scoringWeights: settings.scoringWeights,
            checkSizeFilterStrictness: settings.checkSizeFilterStrictness,
            minDataQuality: settings.minDataQuality,
          }),
        });

        const data = await response.json();
        setDealMatches(data.matches || []);
        setMatchDataQuality(data.dataQuality || null);
      } catch (error) {
        console.error("Error finding deals:", error);
      } finally {
        setLoadingMatches(false);
      }
    },
    [deals, settings]
  );

  // Initial load
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Memoize filtered partners for better performance
  const filteredPartners = useMemo(() => {
    if (!searchTerm) return partners;
    
    const term = searchTerm.toLowerCase();
    return partners.filter(
      (partner) =>
        partner.name.toLowerCase().includes(term) ||
        partner.type.toLowerCase().includes(term) ||
        partner.investmentSpace.toLowerCase().includes(term)
    );
  }, [searchTerm, partners]);

  // Sync handler
  const handleSync = async () => {
    setSyncing(true);
    // Force refresh to bypass cache
    await fetchData(true);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">VC Partners</h1>
            <p className="mt-1 text-sm text-gray-600">
              Manage your VC partners and their investment preferences
            </p>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 rounded-lg bg-yellow-400 px-4 py-2 text-sm font-bold text-black hover:bg-yellow-500 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync from HubSpot"}
          </button>
        </div>

        {/* Error State */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Stats */}
        {loading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm animate-pulse">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 bg-gray-200 rounded-lg"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-24"></div>
                  <div className="h-6 bg-gray-200 rounded w-16"></div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="rounded-lg bg-yellow-50 p-3 border border-yellow-200">
                  <Building2 className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Partners</p>
                  <p className="text-2xl font-bold">{partners.length}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Search */}
        {loading ? (
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm animate-pulse">
            <div className="h-10 bg-gray-200 rounded-md"></div>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <input
              type="text"
              placeholder="Search partners by name, type, or industry..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}

        {/* Partners List */}
        {loading ? (
          <CardSkeleton count={9} />
        ) : filteredPartners.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-12 text-center shadow-sm">
            <Building2 className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-4 text-gray-500">
              {searchTerm ? "No partners match your search" : "No VC partners found in HubSpot"}
            </p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filteredPartners.map((partner) => (
              <div
                key={partner.id}
                className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900">{partner.name}</h3>
                    <p className="text-sm text-gray-600">{partner.type}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {deals.length > 0 && (
                      <button
                        onClick={() => handleFindDeals(partner)}
                        className="rounded-lg p-2 text-purple-600 hover:bg-purple-50"
                        title="Find matching deals"
                      >
                        <Sparkles className="h-4 w-4" />
                      </button>
                    )}
                    {partner.hubspotId && (
                      <a
                        href={`https://app.hubspot.com/contacts/21880552/record/0-2/${partner.hubspotId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-blue-600"
                        title="View in HubSpot"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Investment Details */}
                <div className="space-y-3">
                  <div className="flex items-start gap-2">
                    <DollarSign className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="text-gray-500">Check Size</p>
                      <p className="font-medium text-gray-900">{partner.checkSize}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <TrendingUp className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="text-gray-500">Investment Stage</p>
                      <p className="font-medium text-gray-900">{partner.investmentStage}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <Building2 className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="text-gray-500">Investment Space</p>
                      <p className="font-medium text-gray-900">{partner.investmentSpace}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="text-gray-500">Regions</p>
                      <p className="font-medium text-gray-900">{partner.regions}</p>
                    </div>
                  </div>

                  {partner.thesis && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <p className="text-xs text-gray-500 mb-1">Investment Thesis</p>
                      <p className="text-sm text-gray-700 line-clamp-3">{partner.thesis}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Last Synced */}
        {lastSynced && (
          <p className="text-xs text-gray-500 text-center">
            Last synced: {new Date(lastSynced).toLocaleString()}
          </p>
        )}
      </div>

      {/* Deal Match Results Modal */}
      {matchingPartner && (
        <DealMatchResults
          partnerName={matchingPartner.name}
          matches={dealMatches}
          onClose={() => setMatchingPartner(null)}
          loading={loadingMatches}
          portalId={portalId}
          dataQuality={matchDataQuality}
        />
      )}
    </DashboardLayout>
  );
}
