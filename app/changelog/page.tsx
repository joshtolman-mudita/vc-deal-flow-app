"use client";

import DashboardLayout from "@/components/DashboardLayout";
import { CHANGELOG, ChangelogVersion } from "@/lib/changelog-data";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export default function ChangelogPage() {
  const router = useRouter();

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
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Release Notes</h1>
            <p className="text-sm text-gray-600 mt-1">What's new in VC Deal Flow App</p>
          </div>
        </div>

        {/* Changelog Content */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8">
          {CHANGELOG.map(version => renderVersion(version))}
        </div>
      </div>
    </DashboardLayout>
  );
}
