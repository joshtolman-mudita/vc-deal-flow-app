"use client";

import { useEffect, useRef } from "react";
import {
  Bold,
  Italic,
  List,
  Link as LinkIcon,
  Heading1,
  Heading2,
  Code,
} from "lucide-react";

interface RichTextEditorProps {
  value?: string;
  content?: string; // Backward compatibility
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  autoFocus?: boolean;
  label?: string;
}

export default function RichTextEditor({
  value: valueProp,
  content: contentProp,
  onChange,
  placeholder,
  rows = 3,
  className = "",
  autoFocus = false,
  label
}: RichTextEditorProps) {
  // Support both 'value' and 'content' props for backward compatibility
  const value = valueProp ?? contentProp ?? "";
  const editorRef = useRef<HTMLDivElement>(null);

  const normalizeEditorHtml = (html: string): string => {
    return html
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
      .replace(/\son\w+="[^"]*"/gi, "")
      .replace(/\son\w+='[^']*'/gi, "")
      .replace(/javascript:/gi, "")
      .trim();
  };

  const toEditorHtml = (input: string): string => {
    const raw = input || "";
    if (!raw.trim()) return "";

    // Already HTML from newer notes/email content.
    if (/<[a-z][\s\S]*>/i.test(raw)) {
      return normalizeEditorHtml(raw);
    }

    // Legacy markdown/plain text -> HTML for WYSIWYG editing.
    let html = raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    html = html.replace(
      /^### (.*)$/gim,
      '<h3 class="text-sm font-semibold text-gray-900">$1</h3>'
    );
    html = html.replace(
      /^## (.*)$/gim,
      '<h2 class="text-base font-semibold text-gray-900">$1</h2>'
    );
    html = html.replace(
      /^# (.*)$/gim,
      '<h1 class="text-lg font-bold text-gray-900">$1</h1>'
    );
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold">$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong class="font-bold">$1</strong>');
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
    html = html.replace(/`(.*?)`/g, "<code>$1</code>");
    html = html.replace(
      /\[(.*?)\]\((.*?)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    const lines = html.split("\n");
    const processed: string[] = [];
    let inList = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- ")) {
        if (!inList) {
          processed.push("<ul>");
          inList = true;
        }
        processed.push(`<li>${trimmed.slice(2)}</li>`);
      } else {
        if (inList) {
          processed.push("</ul>");
          inList = false;
        }
        processed.push(trimmed ? `<p>${line}</p>` : "<p><br></p>");
      }
    }
    if (inList) processed.push("</ul>");
    return normalizeEditorHtml(processed.join(""));
  };

  const isMeaningful = (html: string): boolean => {
    const text = html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h1|h2|h3)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim();
    return text.length > 0;
  };

  const runCommand = (command: string, commandValue?: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    document.execCommand(command, false, commandValue);
    const html = normalizeEditorHtml(el.innerHTML);
    onChange(html);
  };

  const insertLink = () => {
    const url = window.prompt("Enter link URL");
    if (!url) return;
    runCommand("createLink", url);
  };

  const setHeading = (tag: "H1" | "H2") => runCommand("formatBlock", tag);

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const isMod = e.ctrlKey || e.metaKey;
    if (!isMod) return;
    const key = e.key.toLowerCase();

    if (key === "b") {
      e.preventDefault();
      runCommand("bold");
      return;
    }
    if (key === "i") {
      e.preventDefault();
      runCommand("italic");
      return;
    }
    if (key === "k") {
      e.preventDefault();
      insertLink();
      return;
    }
    if (key === "7" && e.shiftKey) {
      e.preventDefault();
      runCommand("insertUnorderedList");
      return;
    }
  };

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const editorHtml = toEditorHtml(value);
    if (el.innerHTML !== editorHtml) {
      el.innerHTML = editorHtml;
    }
  }, [value]);

  useEffect(() => {
    if (autoFocus && editorRef.current) {
      editorRef.current.focus();
    }
  }, [autoFocus]);

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 bg-gray-50 border border-gray-300 rounded-t-md">
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            runCommand("bold");
          }}
          className="p-1.5 hover:bg-gray-200 rounded transition-colors"
          title="Bold (Ctrl/Cmd+B)"
        >
          <Bold className="h-4 w-4 text-gray-600" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            runCommand("italic");
          }}
          className="p-1.5 hover:bg-gray-200 rounded transition-colors"
          title="Italic (Ctrl/Cmd+I)"
        >
          <Italic className="h-4 w-4 text-gray-600" />
        </button>
        <div className="w-px h-6 bg-gray-300 mx-1" />
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            setHeading("H1");
          }}
          className="p-1.5 hover:bg-gray-200 rounded transition-colors"
          title="Heading 1"
        >
          <Heading1 className="h-4 w-4 text-gray-600" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            setHeading("H2");
          }}
          className="p-1.5 hover:bg-gray-200 rounded transition-colors"
          title="Heading 2"
        >
          <Heading2 className="h-4 w-4 text-gray-600" />
        </button>
        <div className="w-px h-6 bg-gray-300 mx-1" />
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            runCommand("insertUnorderedList");
          }}
          className="p-1.5 hover:bg-gray-200 rounded transition-colors"
          title="Bullet List"
        >
          <List className="h-4 w-4 text-gray-600" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            insertLink();
          }}
          className="p-1.5 hover:bg-gray-200 rounded transition-colors"
          title="Link (Ctrl/Cmd+K)"
        >
          <LinkIcon className="h-4 w-4 text-gray-600" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            runCommand("formatBlock", "PRE");
          }}
          className="p-1.5 hover:bg-gray-200 rounded transition-colors"
          title="Inline Code"
        >
          <Code className="h-4 w-4 text-gray-600" />
        </button>
      </div>

      <div className={`relative w-full rounded-b-md border border-t-0 border-gray-300 bg-white ${className}`}>
        {!isMeaningful(value) && placeholder && (
          <div className="pointer-events-none absolute left-3 top-2 text-sm text-gray-400">
            {placeholder}
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onKeyDown={handleEditorKeyDown}
          onInput={() => {
            const el = editorRef.current;
            if (!el) return;
            onChange(normalizeEditorHtml(el.innerHTML));
          }}
          className="prose prose-sm max-w-none px-3 py-2 focus:outline-none [&_strong]:font-bold [&_b]:font-bold [&_em]:italic [&_h1]:font-bold [&_h2]:font-semibold [&_h3]:font-semibold"
          style={{ minHeight: `${rows * 24}px` }}
        />
      </div>

      {/* Help Text */}
      <p className="text-xs text-gray-500">
        Rich text: bold, italic, headings, bullets, links, and code block.
      </p>
    </div>
  );
}
