"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

export default function Header({
  isSidebarHidden,
  onToggleSidebar,
}: {
  isSidebarHidden: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-start justify-between border-b border-gray-200 bg-white px-6 shadow-sm">
      <div className="flex flex-1 items-start pt-3">
        {isSidebarHidden && (
          <button
            onClick={onToggleSidebar}
            className="inline-flex items-center rounded-md border border-gray-200 p-2 text-gray-700 hover:bg-gray-100"
            title="Show menu"
            aria-label="Show menu"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
      </div>
    </header>
  );
}



