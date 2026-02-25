"use client";

import { X, TrendingUp, CheckCircle, AlertCircle, ExternalLink, AlertTriangle, Info } from "lucide-react";

interface DealMatch {
  dealId: string;
  dealName: string;
  dealStage: string;
  dealIndustry: string;
  dealAmount: string;
  score: number;
  reasoning: string;
  strengths: string[];
  concerns: string[];
  dealbreakers?: string[];
  industryScore?: number;
  thesisScore?: number;
  stageScore?: number;
  checkSizeScore?: number;
  dataQuality?: {
    deal: number;
    partner: number;
  };
  diligenceEnriched?: boolean;
}

interface DealMatchResultsProps {
  partnerName: string;
  matches: DealMatch[];
  onClose: () => void;
  loading: boolean;
  portalId?: string;
  dataQuality?: {
    partner: number;
    deals: number;
    warnings: string[];
    recommendation: string;
  };
}

export default function DealMatchResults({ partnerName, matches, onClose, loading, portalId, dataQuality }: DealMatchResultsProps) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Backdrop */}
        <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
        
        {/* Modal */}
        <div className="relative w-full max-w-4xl rounded-lg bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 p-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Recommended Deals</h2>
              <p className="mt-1 text-sm text-gray-600">{partnerName}</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="max-h-[70vh] overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600"></div>
                  <p className="mt-4 text-sm text-gray-600">Analyzing deals with AI...</p>
                  <p className="mt-1 text-xs text-gray-500">Using multi-factor weighted scoring - this may take 10-30 seconds</p>
                </div>
              </div>
            ) : matches.length === 0 ? (
              <div className="py-12 text-center">
                <AlertCircle className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-4 text-gray-600">No strong matches found</p>
                <p className="mt-1 text-sm text-gray-500">Try adjusting deal criteria or check size</p>
                {dataQuality && dataQuality.warnings.length > 0 && (
                  <div className="mt-4 rounded-lg bg-yellow-50 border border-yellow-200 p-4 text-left max-w-md mx-auto">
                    <div className="flex gap-2">
                      <Info className="h-5 w-5 text-yellow-600 flex-shrink-0" />
                      <div className="text-sm text-yellow-900">
                        <p className="font-medium mb-1">Data Quality Issues:</p>
                        <ul className="list-disc list-inside space-y-1 text-yellow-800">
                          {dataQuality.warnings.map((warning, idx) => (
                            <li key={idx}>{warning}</li>
                          ))}
                        </ul>
                        <p className="mt-2 text-yellow-800">{dataQuality.recommendation}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Data Quality Banner */}
                {dataQuality && (dataQuality.partner < 60 || dataQuality.deals < 60) && (
                  <div className="mb-6 rounded-lg bg-yellow-50 border border-yellow-200 p-4">
                    <div className="flex gap-2">
                      <Info className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-yellow-900">
                        <p className="font-medium mb-1">Data Quality Notice</p>
                        <p className="text-yellow-800 mb-2">
                          Partner quality: {dataQuality.partner}% | Deal avg quality: {dataQuality.deals}%
                        </p>
                        <p className="text-yellow-800">{dataQuality.recommendation}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mb-6 rounded-lg bg-purple-50 border border-purple-200 p-4">
                  <p className="text-sm text-purple-900">
                    <strong>{matches.length} strong matches</strong> found using multi-factor weighted scoring
                    {matches[0]?.industryScore && (
                      <span className="block mt-1 text-xs text-purple-700">
                        Weights can be adjusted in Settings
                      </span>
                    )}
                  </p>
                </div>

                {matches.map((match) => (
                  <div
                    key={match.dealId}
                    className="rounded-lg border border-gray-200 bg-white p-6 hover:shadow-md transition-shadow"
                  >
                    {/* Header with Score */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-gray-900">{match.dealName}</h3>
                          {portalId && match.dealId && (
                            <a
                              href={`https://app.hubspot.com/contacts/${portalId}/record/0-3/${match.dealId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800"
                              title="View in HubSpot"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-600">
                          <span>{match.dealIndustry}</span>
                          <span>•</span>
                          <span>{match.dealStage}</span>
                          <span>•</span>
                          <span>{match.dealAmount}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-medium ${
                            match.diligenceEnriched
                              ? "bg-indigo-100 text-indigo-800"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {match.diligenceEnriched ? "Diligence Enriched" : "Basic Match"}
                        </span>
                        <div className={`flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ${
                          match.score >= 80 ? 'bg-green-100 text-green-800' :
                          match.score >= 70 ? 'bg-blue-100 text-blue-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          <TrendingUp className="h-4 w-4" />
                          {match.score}% Match
                        </div>
                      </div>
                    </div>

                    {/* Score Breakdown */}
                    {(match.industryScore || match.thesisScore || match.stageScore || match.checkSizeScore) && (
                      <div className="mb-4 rounded-lg bg-gray-50 p-3">
                        <p className="text-xs font-medium text-gray-500 mb-2">Score Breakdown:</p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {match.industryScore !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Industry:</span>
                              <span className="font-semibold text-gray-900">{match.industryScore}</span>
                            </div>
                          )}
                          {match.thesisScore !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Thesis:</span>
                              <span className="font-semibold text-gray-900">{match.thesisScore}</span>
                            </div>
                          )}
                          {match.stageScore !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Stage:</span>
                              <span className="font-semibold text-gray-900">{match.stageScore}</span>
                            </div>
                          )}
                          {match.checkSizeScore !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Check Size:</span>
                              <span className="font-semibold text-gray-900">{match.checkSizeScore}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Reasoning */}
                    <p className="mb-4 text-sm text-gray-700">{match.reasoning}</p>

                    {/* Dealbreakers */}
                    {match.dealbreakers && match.dealbreakers.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-medium text-red-600 mb-2">⚠️ Dealbreakers:</p>
                        <ul className="space-y-1">
                          {match.dealbreakers.map((dealbreaker, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm text-red-700">
                              <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                              {dealbreaker}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Strengths */}
                    {match.strengths.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-medium text-gray-500 mb-2">Strengths:</p>
                        <ul className="space-y-1">
                          {match.strengths.map((strength, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm text-gray-700">
                              <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                              {strength}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Concerns */}
                    {match.concerns.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-2">Considerations:</p>
                        <ul className="space-y-1">
                          {match.concerns.map((concern, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm text-gray-600">
                              <AlertCircle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                              {concern}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 p-6">
            <button
              onClick={onClose}
              className="w-full rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

