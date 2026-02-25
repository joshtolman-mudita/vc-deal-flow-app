"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Save, Info, RefreshCw } from "lucide-react";

type ThesisFeedbackAuditEntry = {
  id: string;
  diligenceId: string;
  companyName: string;
  reviewerFit: string;
  reviewerCruxQuestion?: string;
  reviewerWhyFits?: string[];
  reviewerWhyNotFit?: string[];
  createdAt: string;
};

export default function SettingsPage() {
  const [matchingGuidance, setMatchingGuidance] = useState("");
  const [minMatchScore, setMinMatchScore] = useState(50);
  
  // New scoring settings
  const [industryWeight, setIndustryWeight] = useState(30);
  const [thesisWeight, setThesisWeight] = useState(30);
  const [stageWeight, setStageWeight] = useState(25);
  const [checkSizeWeight, setCheckSizeWeight] = useState(15);
  const [checkSizeFilterStrictness, setCheckSizeFilterStrictness] = useState(25);
  const [minDataQuality, setMinDataQuality] = useState(30);
  
  // Email settings
  const [emailHeading, setEmailHeading] = useState("");
  const [emailFooter, setEmailFooter] = useState("");
  const [emailPrompt, setEmailPrompt] = useState("");
  const [summarizeTranscriptNotesForScoring, setSummarizeTranscriptNotesForScoring] = useState(false);
  const [enableScoringFeedback, setEnableScoringFeedback] = useState(true);
  const [showThesisFeedbackAudit, setShowThesisFeedbackAudit] = useState(false);
  const [loadingThesisFeedbackAudit, setLoadingThesisFeedbackAudit] = useState(false);
  const [thesisFeedbackAuditError, setThesisFeedbackAuditError] = useState<string | null>(null);
  const [thesisFeedbackAuditEntries, setThesisFeedbackAuditEntries] = useState<ThesisFeedbackAuditEntry[]>([]);
  
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refreshingCriteria, setRefreshingCriteria] = useState(false);
  const [criteriaRefreshMessage, setCriteriaRefreshMessage] = useState<string | null>(null);
  
  // Memoize total weight calculation
  const totalWeight = useMemo(
    () => industryWeight + thesisWeight + stageWeight + checkSizeWeight,
    [industryWeight, thesisWeight, stageWeight, checkSizeWeight]
  );

  // Memoize load functions
  const loadFromLocalStorage = useCallback(() => {
    const savedGuidance = localStorage.getItem("matchingGuidance") || "";
    const savedMinScore = localStorage.getItem("minMatchScore") || "50";
    setMatchingGuidance(savedGuidance);
    setMinMatchScore(parseInt(savedMinScore, 10));
    
    // Try to load new settings from appSettings object
    try {
      const appSettings = localStorage.getItem("appSettings");
      if (appSettings) {
        const parsed = JSON.parse(appSettings);
        if (parsed.scoringWeights) {
          setIndustryWeight(parsed.scoringWeights.industry || 30);
          setThesisWeight(parsed.scoringWeights.thesis || 30);
          setStageWeight(parsed.scoringWeights.stage || 25);
          setCheckSizeWeight(parsed.scoringWeights.checkSize || 15);
        }
        setCheckSizeFilterStrictness(parsed.checkSizeFilterStrictness || 25);
        setMinDataQuality(parsed.minDataQuality || 30);
        setEmailHeading(parsed.emailHeading || "");
        setEmailFooter(parsed.emailFooter || "");
        setEmailPrompt(parsed.emailPrompt || "");
        setSummarizeTranscriptNotesForScoring(Boolean(parsed.summarizeTranscriptNotesForScoring));
        setEnableScoringFeedback(parsed.enableScoringFeedback !== false);
      }
    } catch (e) {
      console.error("Error parsing appSettings:", e);
    }
  }, []);

  // Load settings from server (file) and localStorage
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Try to load from server file first
        const response = await fetch("/api/settings");
        if (response.ok) {
          const data = await response.json();
          const settings = data.settings;
          
          setMatchingGuidance(settings.matchingGuidance || "");
          setMinMatchScore(settings.minMatchScore || 50);
          
          // Load new scoring settings
          if (settings.scoringWeights) {
            setIndustryWeight(settings.scoringWeights.industry || 30);
            setThesisWeight(settings.scoringWeights.thesis || 30);
            setStageWeight(settings.scoringWeights.stage || 25);
          setCheckSizeWeight(settings.scoringWeights.checkSize || 15);
        }
        setCheckSizeFilterStrictness(settings.checkSizeFilterStrictness || 25);
        setMinDataQuality(settings.minDataQuality || 30);
        setEmailHeading(settings.emailHeading || "");
        setEmailFooter(settings.emailFooter || "");
        setEmailPrompt(settings.emailPrompt || "");
        setSummarizeTranscriptNotesForScoring(Boolean(settings.summarizeTranscriptNotesForScoring));
        setEnableScoringFeedback(settings.enableScoringFeedback !== false);
        
        // Also save to localStorage for quick access
        localStorage.setItem("appSettings", JSON.stringify(settings));
        } else {
          // Fallback to localStorage if server fails
          loadFromLocalStorage();
        }
      } catch (error) {
        console.error("Error loading settings from server:", error);
        // Fallback to localStorage
        loadFromLocalStorage();
      }
    };
    
    loadSettings();
  }, [loadFromLocalStorage]);

  // Memoize save handler
  const handleSave = useCallback(async () => {
    setSaving(true);
    
    const settings = {
      matchingGuidance,
      minMatchScore,
      scoringWeights: {
        industry: industryWeight,
        thesis: thesisWeight,
        stage: stageWeight,
        checkSize: checkSizeWeight,
      },
      checkSizeFilterStrictness,
      minDataQuality,
      emailHeading,
      emailFooter,
      emailPrompt,
      summarizeTranscriptNotesForScoring,
      enableScoringFeedback,
    };
    
    try {
      // Save to server file (persistent across rebuilds)
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      
      if (!response.ok) {
        throw new Error("Failed to save settings to server");
      }
      
      // Also save to localStorage (quick access)
      localStorage.setItem("appSettings", JSON.stringify(settings));
      
      // Keep old format for backward compatibility
      localStorage.setItem("matchingGuidance", matchingGuidance);
      localStorage.setItem("minMatchScore", minMatchScore.toString());
      
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error("Error saving settings:", error);
      alert("Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [
    matchingGuidance,
    minMatchScore,
    industryWeight,
    thesisWeight,
    stageWeight,
    checkSizeWeight,
    checkSizeFilterStrictness,
    minDataQuality,
    emailHeading,
    emailFooter,
    emailPrompt,
    summarizeTranscriptNotesForScoring,
    enableScoringFeedback,
  ]);

  const handleRefreshDiligenceCriteria = useCallback(async () => {
    setRefreshingCriteria(true);
    setCriteriaRefreshMessage(null);
    try {
      const response = await fetch("/api/diligence/criteria/refresh", {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setCriteriaRefreshMessage(data?.error || "Failed to refresh criteria");
        return;
      }
      setCriteriaRefreshMessage("Diligence criteria refreshed.");
    } catch (error) {
      console.error("Error refreshing diligence criteria:", error);
      setCriteriaRefreshMessage("Failed to refresh criteria");
    } finally {
      setRefreshingCriteria(false);
    }
  }, []);

  const loadThesisFeedbackAudit = useCallback(async () => {
    setLoadingThesisFeedbackAudit(true);
    setThesisFeedbackAuditError(null);
    try {
      const response = await fetch("/api/diligence/thesis-fit-feedback?limit=150");
      const data = await response.json();
      if (!response.ok || !data?.success) {
        setThesisFeedbackAuditError(data?.error || "Failed to load thesis feedback audit entries");
        return;
      }
      const entries = Array.isArray(data?.entries) ? data.entries : [];
      setThesisFeedbackAuditEntries(entries);
    } catch (error) {
      console.error("Error loading thesis feedback audit entries:", error);
      setThesisFeedbackAuditError("Failed to load thesis feedback audit entries");
    } finally {
      setLoadingThesisFeedbackAudit(false);
    }
  }, []);

  useEffect(() => {
    if (!showThesisFeedbackAudit || thesisFeedbackAuditEntries.length > 0) return;
    void loadThesisFeedbackAudit();
  }, [showThesisFeedbackAudit, thesisFeedbackAuditEntries.length, loadThesisFeedbackAudit]);

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
        {/* Page Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-600">
            Configure AI matching, email generation, and other preferences
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Diligence Criteria</h2>
          <p className="text-sm text-gray-600 mb-4">
            After updating the Google Sheet, refresh the in-memory criteria cache so new scoring rules apply immediately.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefreshDiligenceCriteria}
              disabled={refreshingCriteria}
              className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshingCriteria ? "animate-spin" : ""}`} />
              Refresh criteria
            </button>
            {criteriaRefreshMessage && (
              <span className="text-xs text-gray-500">{criteriaRefreshMessage}</span>
            )}
          </div>
          <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={summarizeTranscriptNotesForScoring}
                onChange={(e) => setSummarizeTranscriptNotesForScoring(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <p className="text-sm font-medium text-gray-800">Summarize long transcript-style notes for scoring context</p>
                <p className="text-xs text-gray-600">
                  When enabled, long notes are summarized only for AI scoring prompts. Your saved notes are never modified.
                </p>
              </div>
            </label>
          </div>
          <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={enableScoringFeedback}
                onChange={(e) => setEnableScoringFeedback(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <p className="text-sm font-medium text-gray-800">Enable Scoring Feedback in Thesis Check</p>
                <p className="text-xs text-gray-600">
                  When disabled, thesis-check scoring feedback controls are hidden from the diligence flow.
                </p>
              </div>
            </label>
          </div>
          <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3">
            <button
              onClick={() => setShowThesisFeedbackAudit((prev) => !prev)}
              className="flex w-full items-center justify-between text-left"
            >
              <div>
                <p className="text-sm font-medium text-gray-800">Admin: Thesis Check Feedback Audit</p>
                <p className="text-xs text-gray-600">
                  Review saved thesis-check updates (fit judgments, crux questions, and concern deltas).
                </p>
              </div>
              <span className="text-xs font-medium text-gray-600">
                {showThesisFeedbackAudit ? "Hide" : "Show"}
              </span>
            </button>

            {showThesisFeedbackAudit && (
              <div className="mt-3 space-y-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={loadThesisFeedbackAudit}
                    disabled={loadingThesisFeedbackAudit}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {loadingThesisFeedbackAudit ? "Refreshing..." : "Refresh audit entries"}
                  </button>
                  <span className="text-xs text-gray-500">
                    Entries: {thesisFeedbackAuditEntries.length}
                  </span>
                </div>

                {thesisFeedbackAuditError && (
                  <p className="text-xs text-red-600">{thesisFeedbackAuditError}</p>
                )}

                {!thesisFeedbackAuditError && thesisFeedbackAuditEntries.length === 0 && !loadingThesisFeedbackAudit && (
                  <p className="text-xs text-gray-600">No thesis feedback entries found yet.</p>
                )}

                {thesisFeedbackAuditEntries.length > 0 && (
                  <div className="max-h-80 space-y-2 overflow-y-auto rounded-md border border-gray-200 bg-white p-2">
                    {thesisFeedbackAuditEntries.slice(0, 80).map((entry) => (
                      <details key={entry.id} className="rounded border border-gray-200 bg-gray-50 p-2">
                        <summary className="cursor-pointer text-xs text-gray-800">
                          <span className="font-semibold">{entry.companyName || "Unknown company"}</span>
                          <span className="ml-2 text-gray-600">({entry.reviewerFit || "mixed"})</span>
                          <span className="ml-2 text-gray-500">{new Date(entry.createdAt).toLocaleString()}</span>
                        </summary>
                        <div className="mt-2 space-y-1 text-xs text-gray-700">
                          <p><span className="font-medium">Diligence ID:</span> {entry.diligenceId || "N/A"}</p>
                          <p>
                            <span className="font-medium">Crux question:</span>{" "}
                            {String(entry.reviewerCruxQuestion || "").trim() || "Not provided"}
                          </p>
                          {Array.isArray(entry.reviewerWhyFits) && entry.reviewerWhyFits.length > 0 && (
                            <p>
                              <span className="font-medium">Why might fit:</span> {entry.reviewerWhyFits.join(" | ")}
                            </p>
                          )}
                          {Array.isArray(entry.reviewerWhyNotFit) && entry.reviewerWhyNotFit.length > 0 && (
                            <p>
                              <span className="font-medium">Why might not fit:</span> {entry.reviewerWhyNotFit.join(" | ")}
                            </p>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Email Settings */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Email Generation Settings
          </h2>
          
          {/* Email Heading */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email Heading / Introduction
            </label>
            <p className="text-sm text-gray-600 mb-3">
              Opening text that will appear at the start of generated emails
            </p>
            <textarea
              value={emailHeading}
              onChange={(e) => setEmailHeading(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Example: Hi [Name], hope you're doing well! I wanted to share a few exciting opportunities we're actively looking at..."
            />
          </div>

          {/* Email Content Prompt */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Content Generation Prompt
            </label>
            <p className="text-sm text-gray-600 mb-3">
              Instructions and examples for what the AI should include in the email body
            </p>
            <textarea
              value={emailPrompt}
              onChange={(e) => setEmailPrompt(e.target.value)}
              rows={8}
              className="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Example prompt:

For each deal, include:
- Company name and what they do (1 sentence)
- Key traction metrics (revenue, growth, customers)
- Why we're excited about this opportunity
- Investment terms if available
- A clear next step or call to action

Keep it concise and highlight the most compelling aspects. Focus on what makes each deal unique and investable."
            />
          </div>

          {/* Email Footer */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email Footer / Signature
            </label>
            <p className="text-sm text-gray-600 mb-3">
              Closing text that will be appended to all generated emails
            </p>
            <textarea
              value={emailFooter}
              onChange={(e) => setEmailFooter(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Best regards,
Your Name
Your Title
Your Firm
your.email@firm.com"
            />
          </div>
        </div>

        {/* VC Matching Settings */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            VC Matching Settings
          </h2>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Custom Matching Guidance
            </label>
            <p className="text-sm text-gray-600 mb-4">
              Provide specific instructions to guide the AI matching algorithm. This helps tailor matches to your specific needs and preferences.
            </p>
            <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4 mb-4">
              <div className="flex gap-2">
                <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-900">
                  <p className="font-medium mb-2">Examples of good guidance:</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-800">
                    <li>"Prioritize deals where the founding team has prior startup experience"</li>
                    <li>"Consider geography less important if the thesis is a strong match"</li>
                    <li>"Give extra weight to B2B SaaS companies with proven revenue"</li>
                    <li>"Fund of Funds should only match with deals at Series A or later"</li>
                    <li>"Family Offices prefer sustainable/impact-focused companies"</li>
                  </ul>
                </div>
              </div>
            </div>
            <textarea
              value={matchingGuidance}
              onChange={(e) => setMatchingGuidance(e.target.value)}
              rows={8}
              className="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Enter your custom matching guidance here...

Example:
- Prioritize VCs who have invested in similar companies
- Consider check size a hard requirement (don't match if outside range)
- Give higher scores to deals where industry is an exact match
- For Family Offices, emphasize long-term value over growth metrics"
            />
          </div>

          {/* Minimum Match Score */}
          <div className="pt-6 border-t border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Minimum Match Score
            </label>
            <p className="text-sm text-gray-600 mb-4">
              Only show matches with a score at or above this threshold.
            </p>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="30"
                max="80"
                step="5"
                value={minMatchScore}
                onChange={(e) => setMinMatchScore(parseInt(e.target.value))}
                className="flex-1"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="30"
                  max="80"
                  value={minMatchScore}
                  onChange={(e) => setMinMatchScore(parseInt(e.target.value))}
                  className="w-20 rounded-md border border-gray-300 px-3 py-2 text-center focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-gray-600">%</span>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Current: {minMatchScore}% - {minMatchScore >= 70 ? "High quality matches only" : minMatchScore >= 50 ? "Balanced" : "Show more potential matches"}
            </p>
          </div>

          {/* Scoring Weights */}
          <div className="pt-6 border-t border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Scoring Factor Weights
            </label>
            <p className="text-sm text-gray-600 mb-4">
              Adjust how much each factor contributes to the overall match score. Total should equal 100%.
            </p>
            
            <div className="space-y-4">
              {/* Industry Weight */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-gray-700">Industry Alignment</label>
                  <span className="text-sm font-semibold text-gray-900">{industryWeight}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  step="5"
                  value={industryWeight}
                  onChange={(e) => setIndustryWeight(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>

              {/* Thesis Weight */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-gray-700">Thesis Alignment</label>
                  <span className="text-sm font-semibold text-gray-900">{thesisWeight}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  step="5"
                  value={thesisWeight}
                  onChange={(e) => setThesisWeight(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>

              {/* Stage Weight */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-gray-700">Stage Alignment</label>
                  <span className="text-sm font-semibold text-gray-900">{stageWeight}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  step="5"
                  value={stageWeight}
                  onChange={(e) => setStageWeight(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>

              {/* Check Size Weight */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-gray-700">Check Size Fit</label>
                  <span className="text-sm font-semibold text-gray-900">{checkSizeWeight}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  step="5"
                  value={checkSizeWeight}
                  onChange={(e) => setCheckSizeWeight(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>

            <div className={`mt-4 rounded-lg p-3 ${
              totalWeight === 100 
                ? 'bg-green-50 border border-green-200' 
                : 'bg-yellow-50 border border-yellow-200'
            }`}>
              <p className="text-sm font-medium">
                Total: {totalWeight}%
                {totalWeight !== 100 && (
                  <span className="text-yellow-700 ml-2">⚠️ Should equal 100%</span>
                )}
              </p>
            </div>
          </div>

          {/* Filter Settings */}
          <div className="pt-6 border-t border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Check Size Filter Strictness
            </label>
            <p className="text-sm text-gray-600 mb-4">
              How far outside the VC's check size range should deals be allowed? Lower = stricter filtering.
            </p>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={checkSizeFilterStrictness}
                onChange={(e) => setCheckSizeFilterStrictness(parseInt(e.target.value))}
                className="flex-1"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={checkSizeFilterStrictness}
                  onChange={(e) => setCheckSizeFilterStrictness(parseInt(e.target.value))}
                  className="w-20 rounded-md border border-gray-300 px-3 py-2 text-center focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-gray-600">%</span>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Example: 25% allows deals from $750K-$1.25M for a VC with $1M check size
            </p>
          </div>

          {/* Data Quality Threshold */}
          <div className="pt-6 border-t border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Minimum Data Quality Threshold
            </label>
            <p className="text-sm text-gray-600 mb-4">
              Skip matching for deals/VCs below this data quality score. Lower = more lenient.
            </p>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="0"
                max="70"
                step="5"
                value={minDataQuality}
                onChange={(e) => setMinDataQuality(parseInt(e.target.value))}
                className="flex-1"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="70"
                  value={minDataQuality}
                  onChange={(e) => setMinDataQuality(parseInt(e.target.value))}
                  className="w-20 rounded-md border border-gray-300 px-3 py-2 text-center focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-gray-600">%</span>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {minDataQuality === 0 ? "No minimum - match everything" : 
               minDataQuality < 30 ? "Very lenient - allow sparse data" :
               minDataQuality < 50 ? "Balanced - require some data" :
               "Strict - require detailed data"}
            </p>
          </div>

          {/* Save Button */}
          <div className="flex items-center justify-between mt-6 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-600">
              Settings are saved locally in your browser
            </p>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex items-center gap-2 rounded-lg px-6 py-2 text-sm font-medium text-white transition-colors ${
                saved
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-yellow-400 hover:bg-yellow-500"
              } disabled:opacity-50`}
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : saved ? "Saved!" : "Save Settings"}
            </button>
          </div>
        </div>

        {/* Data Quality Tips */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Tips for Better Matches
          </h2>
          
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-2">For Deals in HubSpot:</h3>
              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                <li>Write detailed, clear descriptions (100+ words)</li>
                <li>Include specific industry/sector information</li>
                <li>Add key metrics (ARR, growth rate, customer count)</li>
                <li>Specify geographic location/market</li>
                <li>Include founder background if relevant</li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-2">For VC Partners in HubSpot:</h3>
              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                <li><strong>Investment Thesis</strong> is the most important field - be specific!</li>
                <li>List specific industries/sectors they focus on</li>
                <li>Include examples of past investments if possible</li>
                <li>Specify any exclusions or dealbreakers</li>
                <li>Note any special interests (e.g., impact, diversity, sustainability)</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
