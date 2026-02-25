import { useState, useEffect } from "react";
import { AppSettings, DEFAULT_SETTINGS } from "@/lib/settings";

/**
 * Custom hook to manage app settings
 * Loads settings once and memoizes them to avoid repeated localStorage reads
 */
export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadSettings = () => {
      try {
        const appSettingsStr = localStorage.getItem("appSettings");
        if (appSettingsStr) {
          const parsed = JSON.parse(appSettingsStr);
          setSettings({ ...DEFAULT_SETTINGS, ...parsed });
        }
      } catch (e) {
        console.error("Error loading settings:", e);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  return { settings, isLoading };
}
