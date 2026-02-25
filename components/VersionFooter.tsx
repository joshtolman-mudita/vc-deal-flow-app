"use client";

import { useState } from 'react';
import packageJson from '../package.json';
import ReleaseNotesModal from './ReleaseNotesModal';

export default function VersionFooter() {
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const version = packageJson.version;
  const releaseDate = '2026-02-19'; // Update this with each release

  return (
    <>
      <footer className="mt-auto py-4 px-6 text-center text-sm text-gray-500 border-t border-gray-200 bg-gray-50">
        <p>
          VC Deal Flow App{' '}
          <button
            onClick={() => setShowReleaseNotes(true)}
            className="text-blue-600 hover:text-blue-800 hover:underline font-medium transition-colors"
            aria-label="View release notes"
          >
            v{version}
          </button>
          {' '}({releaseDate}) | Mudita Venture Partners
        </p>
      </footer>

      <ReleaseNotesModal
        isOpen={showReleaseNotes}
        onClose={() => setShowReleaseNotes(false)}
      />
    </>
  );
}
