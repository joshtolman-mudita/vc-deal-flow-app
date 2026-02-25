// Settings management with persistent storage

export interface ScoringWeights {
  industry: number;  // 0-100, default 30
  thesis: number;    // 0-100, default 30
  stage: number;     // 0-100, default 25
  checkSize: number; // 0-100, default 15
}

export interface AppSettings {
  matchingGuidance: string;
  minMatchScore: number;
  // Scoring settings
  scoringWeights: ScoringWeights;
  checkSizeFilterStrictness: number; // 0-100, how far outside range to allow (default 25%)
  minDataQuality: number; // 0-100, minimum data quality to proceed with matching (default 30%)
}

export const DEFAULT_SETTINGS: AppSettings = {
  matchingGuidance: "",
  minMatchScore: 50,
  scoringWeights: {
    industry: 30,
    thesis: 30,
    stage: 25,
    checkSize: 15,
  },
  checkSizeFilterStrictness: 25, // Allow 25% outside range
  minDataQuality: 30, // Minimum 30% data quality
};

// Get settings from localStorage (browser-side)
export function getSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  
  try {
    const stored = localStorage.getItem("appSettings");
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (error) {
    console.error("Error loading settings:", error);
  }
  
  return DEFAULT_SETTINGS;
}

// Save settings to localStorage (browser-side)
export function saveSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem("appSettings", JSON.stringify(settings));
  } catch (error) {
    console.error("Error saving settings:", error);
  }
}

// Migrate old settings to new format
export function migrateOldSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  
  const settings: AppSettings = { ...DEFAULT_SETTINGS };
  
  try {
    // Check for old individual localStorage keys
    const oldMatchingGuidance = localStorage.getItem("matchingGuidance");
    const oldMinMatchScore = localStorage.getItem("minMatchScore");
    const oldEmailHeader = localStorage.getItem("emailHeader");
    const oldEmailFooter = localStorage.getItem("emailFooter");
    const oldEmailPromptGuidance = localStorage.getItem("emailPromptGuidance");
    
    if (oldMatchingGuidance) settings.matchingGuidance = oldMatchingGuidance;
    if (oldMinMatchScore) settings.minMatchScore = parseInt(oldMinMatchScore);
    
    // Save to new format
    saveSettings(settings);
    
    // Clean up old keys
    localStorage.removeItem("matchingGuidance");
    localStorage.removeItem("minMatchScore");
    
    return settings;
  } catch (error) {
    console.error("Error migrating settings:", error);
    return DEFAULT_SETTINGS;
  }
}


