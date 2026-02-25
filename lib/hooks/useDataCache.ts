import { useState, useEffect, useCallback } from "react";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface DataCache {
  deals: any[] | null;
  partners: any[] | null;
  dealsTimestamp: number | null;
  partnersTimestamp: number | null;
  portalId: string | null;
}

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const CACHE_KEY = "hubspot_data_cache";

/**
 * Custom hook to cache HubSpot data across page navigation
 * Data is cached for 5 minutes to reduce API calls
 */
export function useDataCache() {
  const [cache, setCache] = useState<DataCache>(() => {
    // Load from sessionStorage on mount
    if (typeof window !== "undefined") {
      try {
        const stored = sessionStorage.getItem(CACHE_KEY);
        if (stored) {
          return JSON.parse(stored);
        }
      } catch (e) {
        console.error("Error loading cache:", e);
      }
    }
    return {
      deals: null,
      partners: null,
      dealsTimestamp: null,
      partnersTimestamp: null,
      portalId: null,
    };
  });

  // Persist cache to sessionStorage whenever it changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      } catch (e) {
        console.error("Error saving cache:", e);
      }
    }
  }, [cache]);

  const isCacheValid = useCallback(
    (type: "deals" | "partners"): boolean => {
      const timestamp =
        type === "deals" ? cache.dealsTimestamp : cache.partnersTimestamp;
      if (!timestamp) return false;
      return Date.now() - timestamp < CACHE_DURATION;
    },
    [cache.dealsTimestamp, cache.partnersTimestamp]
  );

  const getCachedDeals = useCallback(() => {
    if (isCacheValid("deals") && cache.deals) {
      return cache.deals;
    }
    return null;
  }, [cache.deals, isCacheValid]);

  const getCachedPartners = useCallback(() => {
    if (isCacheValid("partners") && cache.partners) {
      return cache.partners;
    }
    return null;
  }, [cache.partners, isCacheValid]);

  const setDeals = useCallback((deals: any[], portalId?: string) => {
    setCache((prev) => ({
      ...prev,
      deals,
      dealsTimestamp: Date.now(),
      portalId: portalId || prev.portalId,
    }));
  }, []);

  const setPartners = useCallback((partners: any[]) => {
    setCache((prev) => ({
      ...prev,
      partners,
      partnersTimestamp: Date.now(),
    }));
  }, []);

  const clearCache = useCallback(() => {
    setCache({
      deals: null,
      partners: null,
      dealsTimestamp: null,
      partnersTimestamp: null,
      portalId: null,
    });
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(CACHE_KEY);
    }
  }, []);

  return {
    getCachedDeals,
    getCachedPartners,
    setDeals,
    setPartners,
    clearCache,
    isCacheValid,
    portalId: cache.portalId,
    hasDeals: cache.deals !== null,
    hasPartners: cache.partners !== null,
  };
}
