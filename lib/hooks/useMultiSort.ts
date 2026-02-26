"use client";

import { useState, useCallback } from "react";

export interface SortSpec {
  field: string;
  direction: "asc" | "desc";
}

interface UseMultiSortOptions {
  defaultSorts?: SortSpec[];
  /** Fields that default to descending order on first click */
  defaultDescFields?: string[];
}

/**
 * Manages multi-column sort state.
 *
 * Plain click: replaces the current sort with this column (cycles asc → desc → clear when solo).
 * Shift+click: adds/toggles this column as a secondary/tertiary sort (cycles asc → desc → remove).
 */
export function useMultiSort({
  defaultSorts = [],
  defaultDescFields = [],
}: UseMultiSortOptions = {}) {
  const [sorts, setSorts] = useState<SortSpec[]>(defaultSorts);

  const handleSort = useCallback(
    (field: string, e: React.MouseEvent) => {
      const isShift = e.shiftKey;
      setSorts((prev) => {
        const existingIndex = prev.findIndex((s) => s.field === field);
        const defaultDir: "asc" | "desc" = defaultDescFields.includes(field) ? "desc" : "asc";

        if (!isShift) {
          if (prev.length === 1 && existingIndex === 0) {
            // Only sort: cycle direction then clear
            const cur = prev[0].direction;
            if (cur === "asc") return [{ field, direction: "desc" }];
            return [];
          }
          // Either multi-sort active or a different field: start fresh with this column
          return [{ field, direction: defaultDir }];
        } else {
          // Shift+click: add/toggle within multi-sort
          if (existingIndex >= 0) {
            const cur = prev[existingIndex].direction;
            if (cur === "asc") {
              const next = [...prev];
              next[existingIndex] = { field, direction: "desc" };
              return next;
            }
            // desc → remove from multi-sort
            return prev.filter((_, i) => i !== existingIndex);
          }
          // Not in sorts: append as next sort level
          return [...prev, { field, direction: defaultDir }];
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultDescFields.join(",")]
  );

  const resetSorts = useCallback(() => setSorts(defaultSorts), [defaultSorts]);

  return { sorts, setSorts, handleSort, resetSorts };
}
