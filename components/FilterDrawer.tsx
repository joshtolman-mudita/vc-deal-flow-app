"use client";

import { useEffect } from "react";
import { X, SlidersHorizontal } from "lucide-react";

interface FilterDrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Number of active filters — shown as badge on the trigger and in the drawer header */
  activeCount: number;
  onClearAll: () => void;
  children: React.ReactNode;
}

/** The button that opens the drawer — render this above your table. */
export function FilterDrawerTrigger({
  onClick,
  activeCount,
}: {
  onClick: () => void;
  activeCount: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
        activeCount > 0
          ? "border-blue-500 bg-blue-50 text-blue-700 hover:bg-blue-100"
          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
      }`}
    >
      <SlidersHorizontal className="h-4 w-4" />
      Filters
      {activeCount > 0 && (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
          {activeCount}
        </span>
      )}
    </button>
  );
}

/**
 * A left-side slide-over filter drawer.
 *
 * - Slides in from the left as a fixed overlay (no layout shift).
 * - Closes on Escape key or clicking the backdrop.
 * - All filters inside fire onChange in real-time (no Apply button).
 * - "Clear All Filters" button in the footer.
 */
export default function FilterDrawer({
  open,
  onClose,
  title = "Filters",
  activeCount,
  onClearAll,
  children,
}: FilterDrawerProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        className={`fixed left-0 top-0 z-50 flex h-full w-80 flex-col bg-white shadow-xl transition-transform duration-200 ease-in-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        role="dialog"
        aria-label={title}
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-gray-600" />
            <span className="font-semibold text-gray-900">{title}</span>
            {activeCount > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                {activeCount}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Close filters"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {children}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-gray-200 px-4 py-3">
          <button
            onClick={onClearAll}
            disabled={activeCount === 0}
            className="w-full rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            Clear All Filters
          </button>
        </div>
      </div>
    </>
  );
}

/** A reusable labelled filter section used inside the drawer. */
export function FilterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </h3>
      {children}
    </div>
  );
}
