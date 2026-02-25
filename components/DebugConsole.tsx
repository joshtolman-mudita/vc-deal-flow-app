"use client";

import { useState } from "react";
import { Terminal, X } from "lucide-react";

export default function DebugConsole() {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  // Intercept console.log in the browser
  if (typeof window !== 'undefined' && isOpen && logs.length === 0) {
    const originalLog = console.log;
    console.log = (...args) => {
      originalLog(...args);
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      setLogs(prev => [...prev.slice(-50), `${new Date().toLocaleTimeString()}: ${message}`]);
    };
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-white shadow-lg hover:bg-gray-700"
        title="Open Debug Console"
      >
        <Terminal className="h-4 w-4" />
        Debug Console
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 max-h-96 rounded-lg bg-gray-900 text-white shadow-xl overflow-hidden flex flex-col">
      <div className="flex items-center justify-between bg-gray-800 px-4 py-2 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          <span className="text-sm font-medium">Browser Console</span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-gray-400 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1">
        {logs.length === 0 ? (
          <p className="text-gray-500">No logs yet. Generate a campaign to see debug output.</p>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="text-green-400">
              {log}
            </div>
          ))
        )}
      </div>
      <div className="bg-gray-800 px-4 py-2 border-t border-gray-700 text-xs text-gray-400">
        <p>💡 Tip: Check your terminal where you ran <code className="bg-gray-700 px-1 rounded">npm run dev</code> for server logs</p>
      </div>
    </div>
  );
}


