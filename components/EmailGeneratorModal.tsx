"use client";

import { useState, useEffect } from "react";
import { X, Copy, CheckCircle, Mail, Sparkles, Loader2 } from "lucide-react";
import { Deal } from "@/types";
import dynamic from "next/dynamic";

const RichTextEditor = dynamic(() => import("./RichTextEditor"), {
  ssr: false,
  loading: () => <div className="h-[200px] border border-gray-300 rounded-md animate-pulse bg-gray-50" />,
});

interface EmailGeneratorModalProps {
  selectedDeals: Deal[];
  onClose: () => void;
}

export default function EmailGeneratorModal({ selectedDeals, onClose }: EmailGeneratorModalProps) {
  const [emailContent, setEmailContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [emailSettings, setEmailSettings] = useState<{
    emailHeading?: string;
    emailFooter?: string;
    emailPrompt?: string;
  }>({});

  // Load email settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch("/api/settings");
        if (response.ok) {
          const data = await response.json();
          setEmailSettings(data.settings || {});
        }
      } catch (error) {
        console.error("Error loading settings:", error);
      }
    };
    loadSettings();
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    setEmailContent("");

    try {
      const response = await fetch("/api/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deals: selectedDeals,
          customInstructions: customInstructions.trim(),
          emailHeading: emailSettings.emailHeading,
          emailFooter: emailSettings.emailFooter,
          emailPrompt: emailSettings.emailPrompt,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setEmailContent(data.email);
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error("Error generating email:", error);
      alert("Failed to generate email. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    try {
      // Create a temporary element to convert HTML to plain text for clipboard
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = emailContent;
      const plainText = tempDiv.innerText || tempDiv.textContent || "";
      
      // Copy HTML to clipboard for rich text paste
      const blob = new Blob([emailContent], { type: "text/html" });
      const htmlBlob = new Blob([plainText], { type: "text/plain" });
      
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": blob,
          "text/plain": htmlBlob,
        }),
      ]);
      
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      // Fallback to plain text copy
      try {
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = emailContent;
        await navigator.clipboard.writeText(tempDiv.innerText || tempDiv.textContent || "");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Failed to copy:", err);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="relative w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <Mail className="h-6 w-6 text-blue-600" />
            <div>
              <h2 className="text-xl font-bold text-gray-900">Generate Deal Email</h2>
              <p className="text-sm text-gray-600">
                {selectedDeals.length} deal{selectedDeals.length > 1 ? "s" : ""} selected
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-6 space-y-6" style={{ maxHeight: "calc(90vh - 160px)" }}>
          {/* Selected Deals Summary */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Selected Deals:</h3>
            <div className="space-y-2">
              {selectedDeals.map((deal) => (
                <div key={deal.id} className="flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  <div className="flex-1">
                    <span className="text-sm font-medium text-gray-900">{deal.name}</span>
                    <span className="text-sm text-gray-600 ml-2">
                      ({deal.industry})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Generation Options */}
          {!emailContent && (
            <div className="space-y-4">
              {/* Settings Info */}
              {(emailSettings.emailHeading || emailSettings.emailFooter || emailSettings.emailPrompt) && (
                <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
                  <p className="text-sm text-blue-900">
                    💡 Using your configured email template from Settings
                  </p>
                </div>
              )}

              {/* Custom Instructions */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Additional Instructions (Optional)
                </label>
                <p className="text-sm text-gray-600 mb-2">
                  Add specific guidance for this email
                </p>
                <textarea
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="e.g., Emphasize the sustainability angle, mention we're targeting Series A co-investors, focus on near-term revenue traction..."
                />
              </div>

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Generating Email...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-5 w-5" />
                    Generate Email
                  </>
                )}
              </button>
            </div>
          )}

          {/* Generated Email */}
          {emailContent && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Generated Email:</h3>
                <div className="flex gap-2">
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
                  >
                    {copied ? (
                      <>
                        <CheckCircle className="h-4 w-4" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        Copy to Clipboard
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setEmailContent("");
                      setCustomInstructions("");
                    }}
                    className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                  >
                    Regenerate
                  </button>
                </div>
              </div>

              <div className="rounded-lg bg-white">
                <RichTextEditor
                  content={emailContent}
                  onChange={setEmailContent}
                  placeholder="Generated email will appear here..."
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 bg-gray-50">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-600">
              💡 Tip: Review and customize the email before sending
            </p>
            <button
              onClick={onClose}
              className="rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
