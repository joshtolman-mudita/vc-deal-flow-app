"use client";

import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { SortSpec } from "@/lib/hooks/useMultiSort";

interface SortableHeaderProps {
  field: string;
  label: string;
  sorts: SortSpec[];
  onSort: (field: string, e: React.MouseEvent) => void;
  className?: string;
}

/**
 * A column header button that shows the current sort state.
 *
 * - Unsorted: faded up/down arrows
 * - Active (single sort): coloured arrow indicating direction
 * - Active (multi-sort): coloured arrow + numbered badge showing sort priority (1, 2, …)
 *
 * Plain click = make this the sole sort column.
 * Shift+click = add / toggle as secondary sort.
 */
export default function SortableHeader({
  field,
  label,
  sorts,
  onSort,
  className = "",
}: SortableHeaderProps) {
  const index = sorts.findIndex((s) => s.field === field);
  const active = index >= 0 ? sorts[index] : null;
  const isMulti = sorts.length > 1;

  return (
    <button
      onClick={(e) => onSort(field, e)}
      title={
        active
          ? `Sorted ${active.direction === "asc" ? "ascending" : "descending"}. Click to ${active.direction === "asc" ? "sort descending" : "clear sort"}. Shift+click to add as secondary sort.`
          : `Sort by ${label}. Shift+click to add as secondary sort.`
      }
      className={`inline-flex items-center gap-1 select-none transition-colors hover:text-gray-900 ${
        active ? "text-blue-600 font-semibold" : "text-gray-500"
      } ${className}`}
    >
      <span>{label}</span>
      <span className="inline-flex items-center gap-0.5">
        {!active ? (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        ) : active.direction === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )}
        {active && isMulti && (
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-600 text-[9px] font-bold text-white leading-none flex-shrink-0">
            {index + 1}
          </span>
        )}
      </span>
    </button>
  );
}
