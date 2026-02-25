"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, CheckCircle, AlertTriangle } from "lucide-react";
import { DiligenceScore } from "@/types/diligence";

interface ScoreCardProps {
  score: DiligenceScore;
  companyName: string;
}

export default function ScoreCard({ score, companyName }: ScoreCardProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const toggleCategory = (categoryName: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryName)) {
        newSet.delete(categoryName);
      } else {
        newSet.add(categoryName);
      }
      return newSet;
    });
  };

  const getScoreColor = (scoreValue: number) => {
    if (scoreValue >= 75) return "text-green-600";
    if (scoreValue >= 50) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBgColor = (scoreValue: number) => {
    if (scoreValue >= 75) return "bg-green-50 border-green-200";
    if (scoreValue >= 50) return "bg-yellow-50 border-yellow-200";
    return "bg-red-50 border-red-200";
  };

  return (
    <div className="space-y-4">
      {/* Overall Score */}
      <div className={`rounded-lg border p-6 shadow-sm ${getScoreBgColor(score.overall)}`}>
        <p className="text-sm font-medium text-gray-600 mb-2">
          Overall Score for {companyName}
        </p>
        <div className="flex items-baseline gap-2">
          <span className={`text-5xl font-bold ${getScoreColor(score.overall)}`}>
            {score.overall}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs text-gray-600">
          <span>Data Quality: {score.dataQuality}</span>
          <span>•</span>
          <span>Scored {new Date(score.scoredAt).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Category Scores */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Category Breakdown</h3>
        <div className="space-y-3">
          {score.categories.map((category) => (
            <div key={category.category} className="border-b border-gray-100 last:border-0 pb-3 last:pb-0">
              <button
                onClick={() => toggleCategory(category.category)}
                className="w-full flex items-center justify-between hover:bg-gray-50 p-2 rounded-md transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">
                    {category.category}
                  </span>
                  <span className="text-xs text-gray-500">
                    (Weight: {category.weight}%)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${getScoreColor(category.score)}`}>
                    {category.score}
                  </span>
                  {expandedCategories.has(category.category) ? (
                    <ChevronUp className="h-4 w-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                  )}
                </div>
              </button>

              {/* Expanded Criteria Details */}
              {expandedCategories.has(category.category) && (
                <div className="mt-2 ml-4 space-y-3 border-l-2 border-gray-200 pl-4">
                  {category.criteria.map((criterion) => (
                    <div key={criterion.name} className="text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-gray-700">
                          {criterion.name}
                        </span>
                        <span className={`font-bold ${getScoreColor(criterion.score)}`}>
                          {criterion.score}
                        </span>
                      </div>
                      <p className="text-gray-600 mb-2">{criterion.reasoning}</p>
                      {criterion.evidence.length > 0 && (
                        <div className="mt-2 space-y-1">
                          <p className="text-gray-500 font-medium">Evidence:</p>
                          {criterion.evidence.map((ev, i) => (
                            <p key={i} className="text-gray-500 italic pl-2 border-l-2 border-gray-300">
                              "{ev}"
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Strengths */}
      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle className="h-5 w-5 text-green-600" />
          <h3 className="text-sm font-semibold text-green-900">Key Strengths</h3>
        </div>
        <ul className="space-y-2">
          {score.strengths?.map((strength, i) => (
            <li key={i} className="text-sm text-green-800 flex items-start gap-2">
              <span className="text-green-600 font-bold">•</span>
              <span>{strength}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Concerns */}
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-5 w-5 text-yellow-600" />
          <h3 className="text-sm font-semibold text-yellow-900">Key Concerns</h3>
        </div>
        <ul className="space-y-2">
          {score.concerns?.map((concern, i) => (
            <li key={i} className="text-sm text-yellow-800 flex items-start gap-2">
              <span className="text-yellow-600 font-bold">•</span>
              <span>{concern}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
