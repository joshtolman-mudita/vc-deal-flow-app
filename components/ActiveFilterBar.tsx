"use client";

import { X } from "lucide-react";

export interface FilterChip {
  id: string;
  label: string;
  onRemove: () => void;
}

interface ActiveFilterBarProps {
  chips: FilterChip[];
  onClearAll: () => void;
}

/**
 * Renders active filter chips above the table.
 * Each chip shows a label and has an X to remove that individual filter.
 * Returns null (zero height) when no filters are active.
 */
export default function ActiveFilterBar({ chips, onClearAll }: ActiveFilterBarProps) {
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700"
        >
          {chip.label}
          <button
            onClick={chip.onRemove}
            className="ml-0.5 rounded-full p-0.5 hover:bg-blue-200 transition-colors"
            aria-label={`Remove ${chip.label} filter`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button
        onClick={onClearAll}
        className="ml-1 text-xs text-gray-400 underline hover:text-gray-600 transition-colors"
      >
        Clear all
      </button>
    </div>
  );
}
