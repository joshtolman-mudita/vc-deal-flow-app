"use client";

import { TrendingUp } from "lucide-react";
import { CategoryScore } from "@/types/diligence";

interface ScoreDisplayCardProps {
  overallScore: number;
  categoryScores: CategoryScore[];
  manualOverrides?: Record<string, number>;
  onEditScore?: (category: CategoryScore) => void;
}

/**
 * Displays the overall score and category breakdown
 * with color-coded indicators and manual override support
 */
export default function ScoreDisplayCard({
  overallScore,
  categoryScores,
  manualOverrides = {},
  onEditScore,
}: ScoreDisplayCardProps) {
  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600 bg-green-100";
    if (score >= 60) return "text-yellow-600 bg-yellow-100";
    return "text-red-600 bg-red-100";
  };

  const getScoreBorderColor = (score: number) => {
    if (score >= 80) return "border-green-600";
    if (score >= 60) return "border-yellow-600";
    return "border-red-600";
  };

  return (
    <div className={`rounded-lg border-2 ${getScoreBorderColor(overallScore)} bg-white p-6 shadow-sm`}>
      {/* Overall Score */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-5 w-5 text-gray-600" />
            <h3 className="text-lg font-semibold text-gray-900">Overall Score</h3>
          </div>
          <p className="text-sm text-gray-500">AI-powered diligence assessment</p>
        </div>
        <div className={`text-4xl font-bold ${getScoreColor(overallScore).split(' ')[0]}`}>
          {overallScore}
        </div>
      </div>

      {/* Category Scores */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Category Breakdown</h4>
        {categoryScores.map((category) => {
          const hasManualOverride = manualOverrides[category.category] !== undefined;
          const displayScore = hasManualOverride
            ? manualOverrides[category.category]
            : category.score;

          return (
            <div key={category.category} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">{category.category}</span>
                  <span className="text-xs text-gray-400">
                    ({category.weight}% weight)
                  </span>
                  {hasManualOverride && (
                    <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">
                      Manual
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${getScoreColor(displayScore).split(' ')[0]}`}>
                    {displayScore}
                  </span>
                  {hasManualOverride && (
                    <span className="text-xs text-gray-400" title={`AI Score: ${category.score}`}>
                      (AI: {category.score})
                    </span>
                  )}
                </div>
                {onEditScore && (
                  <button
                    onClick={() => onEditScore(category)}
                    className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                  >
                    Edit
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
