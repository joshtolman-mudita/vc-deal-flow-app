'use client';

import { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { CategoryScore } from '@/types/diligence';

interface ScoreOverrideModalProps {
  category: CategoryScore;
  onClose: () => void;
  onSave: (overrideScore: number, reason: string, suppressRiskTopics: string[]) => Promise<void>;
  onRemove: () => Promise<void>;
}

export default function ScoreOverrideModal({
  category,
  onClose,
  onSave,
  onRemove,
}: ScoreOverrideModalProps) {
  const [overrideScore, setOverrideScore] = useState<string>(
    category.manualOverride?.toString() || category.score.toString()
  );
  const [reason, setReason] = useState(category.overrideReason || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suppressRiskTopics, setSuppressRiskTopics] = useState<string[]>(
    category.overrideSuppressTopics || []
  );

  const riskTopicOptions = [
    "burn",
    "runway",
    "churn",
    "competition",
    "valuation",
    "market growth",
    "team",
  ];

  const hasOverride = category.manualOverride !== undefined;
  const effectiveScore = category.manualOverride ?? category.score;

  const handleSave = async () => {
    const scoreNum = parseInt(overrideScore);
    if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > 100) {
      setError('Score must be between 0 and 100');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSave(scoreNum, reason, suppressRiskTopics);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save override');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm('Are you sure you want to revert to the AI-generated score?')) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onRemove();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove override');
    } finally {
      setSaving(false);
    }
  };

  const toggleTopic = (topic: string) => {
    setSuppressRiskTopics((prev) =>
      prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic]
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            Override Score: {category.category}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={saving}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* AI Score Display */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start">
              <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 mr-3 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-blue-900">AI-Generated Score</p>
                <p className="text-2xl font-bold text-blue-600 mt-1">{category.score}</p>
                {category.manualOverride !== undefined && (
                  <p className="text-xs text-blue-700 mt-1">
                    Overridden on {new Date(category.overridedAt!).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Override Score Input */}
          <div>
            <label htmlFor="override-score" className="block text-sm font-medium text-gray-700 mb-2">
              Your Score (0-100)
            </label>
            <input
              id="override-score"
              type="number"
              min="0"
              max="100"
              value={overrideScore}
              onChange={(e) => setOverrideScore(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter score 0-100"
            />
          </div>

          {/* Reason Text Area */}
          <div>
            <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-2">
              Reason for Override (Optional)
            </label>
            <textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Why are you adjusting this score?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Suppress auto-generated concern topics (optional)
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Use this when you have specific context and do not want these topics resurfacing in concerns/follow-ups.
            </p>
            <div className="flex flex-wrap gap-2">
              {riskTopicOptions.map((topic) => {
                const active = suppressRiskTopics.includes(topic);
                return (
                  <button
                    key={topic}
                    type="button"
                    onClick={() => toggleTopic(topic)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      active
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {topic}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Score Preview */}
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-600">
              Effective Score: <span className="font-semibold text-gray-900">{overrideScore || 0}</span>
            </p>
            <p className="text-sm text-gray-600 mt-1">
              Weight: {category.weight.toFixed(1)}%
            </p>
            <p className="text-sm text-gray-600 mt-1">
              Contribution to Overall: <span className="font-semibold text-gray-900">
                {((parseInt(overrideScore) || 0) * category.weight / 100).toFixed(1)} points
              </span>
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
          <div>
            {hasOverride && (
              <button
                onClick={handleRemove}
                disabled={saving}
                className="text-sm text-red-600 hover:text-red-700 disabled:text-red-400 font-medium"
              >
                Revert to AI Score
              </button>
            )}
          </div>
          <div className="flex space-x-3">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-gray-700 hover:text-gray-900 disabled:text-gray-400 font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : 'Save Override'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
