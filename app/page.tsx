"use client";

import { useState, useEffect, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import LoadingSpinner from "@/components/LoadingSpinner";
import { TrendingUp, Building2, Users, Award } from "lucide-react";
import { Deal } from "@/types";
import { DiligenceRecord } from "@/types/diligence";
import { useDataCache } from "@/lib/hooks/useDataCache";
import Link from "next/link";

export default function Home() {
  const dataCache = useDataCache();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [diligenceRecords, setDiligenceRecords] = useState<DiligenceRecord[]>([]);
  const [partnersCount, setPartnersCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingDiligence, setLoadingDiligence] = useState(true);
  const [hubspotConfigured, setHubspotConfigured] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Check cache first
        const cachedDeals = dataCache.getCachedDeals();
        const cachedPartners = dataCache.getCachedPartners();

        if (cachedDeals && cachedPartners) {
          // Use cached data
          setDeals(cachedDeals);
          setPartnersCount(cachedPartners.length);
          setHubspotConfigured(true);
          setLoading(false);
          return;
        }

        // Fetch both deals and partners in parallel for better performance
        const [dealsResponse, partnersResponse] = await Promise.all([
          fetch("/api/hubspot/deals"),
          fetch("/api/hubspot/partners"),
        ]);

        const [dealsData, partnersData] = await Promise.all([
          dealsResponse.json(),
          partnersResponse.json(),
        ]);

        // Process deals data
        if (dealsData.configured && dealsData.deals) {
          setDeals(dealsData.deals);
          setHubspotConfigured(true);
          // Cache the deals
          dataCache.setDeals(dealsData.deals, dealsData.portalId);
        } else {
          setHubspotConfigured(false);
        }

        // Process partners data
        if (partnersData.partners) {
          setPartnersCount(partnersData.partners.length);
          // Cache the partners
          dataCache.setPartners(partnersData.partners);
        }
      } catch (err) {
        console.error("Failed to fetch data:", err);
        setHubspotConfigured(false);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Fetch diligence records
  useEffect(() => {
    const fetchDiligence = async () => {
      try {
        const response = await fetch("/api/diligence");
        const data = await response.json();
        
        if (data.success && data.records) {
          setDiligenceRecords(data.records);
        }
      } catch (err) {
        console.error("Failed to fetch diligence records:", err);
      } finally {
        setLoadingDiligence(false);
      }
    };

    fetchDiligence();
  }, []);

  // Memoize expensive calculations to avoid recalculating on every render
  const { activeDeals, sharedDeals, recentDeals } = useMemo(() => {
    const active = deals.filter((d) => d.status === "Active").length;
    const shared = deals.filter((d) => d.status === "Shared").length;

    // Extract stage number helper
    const getStageNumber = (deal: Deal): number => {
      const stageName = deal.stageName || deal.stage || "";
      const match = stageName.match(/Deal (\d+):/);
      return match ? parseInt(match[1], 10) : 999;
    };

    // Get 5 most recently created deals at stage "Deal 2: Pitch" or later
    const recent = deals
      .filter((deal) => {
        const stageNumber = getStageNumber(deal);
        return stageNumber >= 2 && stageNumber <= 7; // Deal 2 through Deal 7
      })
      .sort((a, b) => {
        // Sort by HubSpot createdate (most recent first)
        const dateA = a.createdate ? new Date(a.createdate).getTime() : 0;
        const dateB = b.createdate ? new Date(b.createdate).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, 5);

    return { activeDeals: active, sharedDeals: shared, recentDeals: recent };
  }, [deals]);

  // Get top 3 highest scoring diligence companies
  const topDiligence = useMemo(() => {
    return diligenceRecords
      .filter((record) => record.score && record.score.overall > 0)
      .sort((a, b) => (b.score?.overall || 0) - (a.score?.overall || 0))
      .slice(0, 3);
  }, [diligenceRecords]);
  
  // Memoize stats to prevent recreation on every render
  const stats = useMemo(
    () => [
      {
        name: "Total Deals",
        value: loading ? "..." : deals.length.toString(),
        change: hubspotConfigured ? "Live from HubSpot" : "N/A",
        changeType: "positive" as const,
        icon: Building2,
      },
      {
        name: "Active Deals",
        value: loading ? "..." : activeDeals.toString(),
        change: hubspotConfigured ? `${sharedDeals} shared` : "N/A",
        changeType: "positive" as const,
        icon: TrendingUp,
      },
      {
        name: "VC Partners",
        value: loading ? "..." : partnersCount.toString(),
        change: hubspotConfigured ? "Live from HubSpot" : "N/A",
        changeType: "positive" as const,
        icon: Users,
      },
    ],
    [loading, deals.length, activeDeals, sharedDeals, partnersCount, hubspotConfigured]
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-600">
            Welcome back! Here's an overview of your deal flow activity.
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.name}
                className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-yellow-50">
                    <Icon className="h-6 w-6 text-yellow-600" />
                  </div>
                  <span
                    className={`text-sm font-semibold ${
                      stat.changeType === "positive"
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {stat.change}
                  </span>
                </div>
                <div className="mt-4">
                  <p className="text-sm font-medium text-gray-600">
                    {stat.name}
                  </p>
                  <p className="mt-1 text-3xl font-bold text-gray-900">
                    {stat.value}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Two Column Layout */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Recent Deals */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Recent Active Deals
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                {hubspotConfigured ? "Latest 5 deals at Deal 2: Pitch or later" : "Configure HubSpot to see deals"}
              </p>
            </div>
          
            {loading ? (
              <div className="flex items-center justify-center p-12">
                <LoadingSpinner />
              </div>
            ) : !hubspotConfigured ? (
              <div className="p-12 text-center">
                <p className="text-gray-500">
                  Connect HubSpot to start syncing deals
                </p>
                <Link
                  href="/deals"
                  className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  Go to Deals page for setup instructions →
                </Link>
              </div>
            ) : recentDeals.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-gray-500">No active deals at Deal 2: Pitch or later</p>
              </div>
            ) : (
              <>
                <div className="divide-y divide-gray-200">
                  {recentDeals.map((deal) => {
                    // Build HubSpot URL directly here as fallback
                    const portalId = "21880552"; // Your HubSpot portal ID
                    const dealUrl = deal.url || `https://app.hubspot.com/contacts/${portalId}/deal/${deal.id}`;
                    
                    return (
                      <a
                        key={deal.id}
                        href={dealUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block px-6 py-4 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <h3 className="text-sm font-semibold text-gray-900 hover:text-blue-600">
                                {deal.name}
                              </h3>
                              <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 flex-shrink-0">
                                {deal.stageName || deal.stage}
                              </span>
                            </div>
                            
                            <p className="text-xs text-gray-500 mb-2">
                              {deal.industry || "No industry"}
                            </p>
                            
                            {deal.description && (
                              <p className="text-sm text-gray-700 line-clamp-2 mb-2">
                                {deal.description}
                              </p>
                            )}
                            
                            {deal.dealTerms && (
                              <div className="mt-2 pt-2 border-t border-gray-100">
                                <p className="text-xs font-medium text-gray-600 mb-1">Deal Terms:</p>
                                <p className="text-xs text-gray-700 line-clamp-2">
                                  {deal.dealTerms}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </a>
                    );
                  })}
                </div>
                <div className="border-t border-gray-200 px-6 py-4">
                  <Link
                    href="/deals"
                    className="text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    View all deals →
                  </Link>
                </div>
              </>
            )}
          </div>

          {/* Top Diligence Companies */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Top Scoring Companies
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Highest scoring companies from diligence analysis
              </p>
            </div>
            
            {loadingDiligence ? (
              <div className="flex items-center justify-center p-12">
                <LoadingSpinner />
              </div>
            ) : topDiligence.length === 0 ? (
              <div className="p-12 text-center">
                <Award className="mx-auto h-12 w-12 text-gray-300" />
                <p className="mt-4 text-gray-500">No scored diligence companies yet</p>
                <Link
                  href="/diligence/new"
                  className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  Start diligence analysis →
                </Link>
              </div>
            ) : (
              <>
                <div className="divide-y divide-gray-200">
                  {topDiligence.map((record, index) => {
                    const score = record.score?.overall || 0;
                    const getScoreColor = (s: number) => {
                      if (s >= 80) return "text-green-600 bg-green-100";
                      if (s >= 60) return "text-yellow-600 bg-yellow-100";
                      return "text-red-600 bg-red-100";
                    };

                    return (
                      <Link
                        key={record.id}
                        href={`/diligence/${record.id}`}
                        className="block px-6 py-4 hover:bg-gray-50"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-100 flex-shrink-0">
                              <span className="text-sm font-bold text-yellow-800">
                                #{index + 1}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm font-semibold text-gray-900 truncate">
                                {record.companyName}
                              </h3>
                              <p className="mt-1 text-xs text-gray-500">
                                Scored {new Date(record.score?.scoredAt || record.updatedAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <div className="ml-4 flex-shrink-0">
                            <div className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-bold ${getScoreColor(score)}`}>
                              {score}
                            </div>
                          </div>
                        </div>
                        {record.score?.thesisAnswers?.problemSolving && (
                          <p className="mt-2 text-sm text-gray-600 line-clamp-2 ml-11">
                            {record.score.thesisAnswers.problemSolving}
                          </p>
                        )}
                      </Link>
                    );
                  })}
                </div>
                <div className="border-t border-gray-200 px-6 py-4">
                  <Link
                    href="/diligence"
                    className="text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    View all diligence →
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
