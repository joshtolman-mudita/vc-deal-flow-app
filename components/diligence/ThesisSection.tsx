"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Edit2, Save, X } from "lucide-react";

interface ThesisAnswer {
  problem?: string;
  solution?: string;
  exciting?: string[];
  concerns?: string[];
  idealCustomer?: string;
  followUpQuestions?: string[];
  manuallyEdited?: boolean;
}

interface ThesisSectionProps {
  thesisAnswers: ThesisAnswer;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSave: (answers: ThesisAnswer) => Promise<void>;
}

export default function ThesisSection({
  thesisAnswers,
  isExpanded,
  onToggleExpand,
  onSave,
}: ThesisSectionProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedAnswers, setEditedAnswers] = useState<ThesisAnswer>(thesisAnswers);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        ...editedAnswers,
        manuallyEdited: true,
      });
      setIsEditing(false);
    } catch (error) {
      console.error("Error saving thesis:", error);
      alert("Failed to save thesis. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedAnswers(thesisAnswers);
    setIsEditing(false);
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-gray-900">Investment Thesis</h3>
          {thesisAnswers.manuallyEdited && (
            <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-md font-medium flex items-center gap-1">
              <Edit2 className="h-3 w-3 text-blue-600 fill-blue-600" />
              Edited
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && isExpanded && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center gap-1"
            >
              <Edit2 className="h-3.5 w-3.5" />
              Edit
            </button>
          )}
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-gray-600" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-600" />
          )}
        </div>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="p-6 border-t border-gray-200 space-y-6">
          {isEditing ? (
            <>
              {/* Edit Mode */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  What problem are they solving?
                </label>
                <textarea
                  value={editedAnswers.problem || ""}
                  onChange={(e) =>
                    setEditedAnswers({ ...editedAnswers, problem: e.target.value })
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  How are they solving it?
                </label>
                <textarea
                  value={editedAnswers.solution || ""}
                  onChange={(e) =>
                    setEditedAnswers({ ...editedAnswers, solution: e.target.value })
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  What is their ideal customer profile?
                </label>
                <textarea
                  value={editedAnswers.idealCustomer || ""}
                  onChange={(e) =>
                    setEditedAnswers({ ...editedAnswers, idealCustomer: e.target.value })
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  What's exciting about this deal?
                </label>
                <textarea
                  value={(editedAnswers.exciting || []).join("\n")}
                  onChange={(e) =>
                    setEditedAnswers({
                      ...editedAnswers,
                      exciting: e.target.value.split("\n").filter((l) => l.trim()),
                    })
                  }
                  placeholder="One point per line"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  rows={4}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  What's concerning about this deal?
                </label>
                <textarea
                  value={(editedAnswers.concerns || []).join("\n")}
                  onChange={(e) =>
                    setEditedAnswers({
                      ...editedAnswers,
                      concerns: e.target.value.split("\n").filter((l) => l.trim()),
                    })
                  }
                  placeholder="One point per line"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  rows={4}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Follow-up questions for founders
                </label>
                <textarea
                  value={(editedAnswers.followUpQuestions || []).join("\n")}
                  onChange={(e) =>
                    setEditedAnswers({
                      ...editedAnswers,
                      followUpQuestions: e.target.value.split("\n").filter((l) => l.trim()),
                    })
                  }
                  placeholder="One question per line"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  rows={4}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-4 border-t">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-400 flex items-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  {saving ? "Saving..." : "Save Changes"}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors disabled:bg-gray-100 flex items-center gap-2"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              {/* View Mode */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">
                  What problem are they solving?
                </h4>
                <p className={`text-sm text-gray-600 ${thesisAnswers.manuallyEdited ? "italic" : ""}`}>
                  {thesisAnswers.problem || "Not available"}
                </p>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">
                  How are they solving it?
                </h4>
                <p className={`text-sm text-gray-600 ${thesisAnswers.manuallyEdited ? "italic" : ""}`}>
                  {thesisAnswers.solution || "Not available"}
                </p>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">
                  What is their ideal customer profile?
                </h4>
                <p className={`text-sm text-gray-600 ${thesisAnswers.manuallyEdited ? "italic" : ""}`}>
                  {thesisAnswers.idealCustomer || "Not available"}
                </p>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">
                  What's exciting about this deal?
                </h4>
                <ul className="list-disc list-inside space-y-1">
                  {thesisAnswers.exciting && thesisAnswers.exciting.length > 0 ? (
                    thesisAnswers.exciting.map((item, idx) => (
                      <li key={idx} className={`text-sm text-gray-600 ${thesisAnswers.manuallyEdited ? "italic" : ""}`}>
                        {item}
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-gray-400">No data available</li>
                  )}
                </ul>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">
                  What's concerning about this deal?
                </h4>
                <ul className="list-disc list-inside space-y-1">
                  {thesisAnswers.concerns && thesisAnswers.concerns.length > 0 ? (
                    thesisAnswers.concerns.map((item, idx) => (
                      <li key={idx} className={`text-sm text-gray-600 ${thesisAnswers.manuallyEdited ? "italic" : ""}`}>
                        {item}
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-gray-400">No concerns identified</li>
                  )}
                </ul>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">
                  Follow-up questions for founders
                </h4>
                <ul className="list-disc list-inside space-y-1">
                  {thesisAnswers.followUpQuestions && thesisAnswers.followUpQuestions.length > 0 ? (
                    thesisAnswers.followUpQuestions.map((question, idx) => (
                      <li key={idx} className={`text-sm text-gray-600 ${thesisAnswers.manuallyEdited ? "italic" : ""}`}>
                        {question}
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-gray-400">No questions generated</li>
                  )}
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
