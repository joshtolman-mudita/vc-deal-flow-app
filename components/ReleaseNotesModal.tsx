"use client";

import { X } from "lucide-react";
import { CHANGELOG, ChangelogVersion } from "@/lib/changelog-data";

interface ReleaseNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ReleaseNotesModal({ isOpen, onClose }: ReleaseNotesModalProps) {
  if (!isOpen) return null;

  const renderSection = (title: string, items: string[] | undefined) => {
    if (!items || items.length === 0) return null;

    return (
      <div className="mb-6">
        <h4 className="text-sm font-semibold text-gray-900 mb-3">{title}</h4>
        <ul className="space-y-2">
          {items.map((item, idx) => (
            <li key={idx} className="text-sm text-gray-700 pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-blue-600">
              {item}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const renderVersion = (version: ChangelogVersion) => {
    return (
      <div key={version.version} className="mb-8 pb-8 border-b border-gray-200 last:border-0">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-lg font-bold text-gray-900">Version {version.version}</h3>
          <span className="text-sm text-gray-500">{version.date}</span>
        </div>

        {renderSection("✨ Added", version.sections.added)}
        {renderSection("🔄 Changed", version.sections.changed)}
        {renderSection("🐛 Fixed", version.sections.fixed)}
        {renderSection("🗑️ Removed", version.sections.removed)}
      </div>
    );
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Release Notes</h2>
              <p className="text-sm text-gray-600 mt-1">What's new in VC Deal Flow App</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5 text-gray-600" />
            </button>
          </div>

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-y-auto p-6">
            {CHANGELOG.map(version => renderVersion(version))}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
