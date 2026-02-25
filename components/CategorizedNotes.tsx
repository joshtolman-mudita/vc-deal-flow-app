"use client";

import { useState, useEffect } from "react";
import { Plus, Edit2, Trash2, Save, X, ChevronDown, ChevronRight } from "lucide-react";
import { DiligenceNote } from "@/types/diligence";
import RichTextEditor from "@/components/RichTextEditor";

interface CategorizedNotesProps {
  notes: DiligenceNote[];
  categories: string[]; // From criteria + "Overall"
  onNotesChange: (notes: DiligenceNote[]) => void;
  onSave: () => void;
  saving: boolean;
  isAdding: boolean; // Controlled from parent
  onAddNote?: () => void; // Callback to close add form
  showSaveButton?: boolean;
  showEmptyMessage?: boolean;
}

export default function CategorizedNotes({ 
  notes, 
  categories, 
  onNotesChange, 
  onSave,
  saving,
  isAdding,
  onAddNote,
  showSaveButton = true,
  showEmptyMessage = true
}: CategorizedNotesProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newNote, setNewNote] = useState({ category: categories[0] || "Overall", title: "", content: "" });
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  const stripHtml = (value: string): string =>
    (value || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h1|h2|h3|pre)>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim();

  const hasMeaningfulContent = (value: string): boolean => stripHtml(value).length > 0;

  const handleAddNote = () => {
    if (!newNote.title?.trim() || !hasMeaningfulContent(newNote.content)) return;

    const note: DiligenceNote = {
      id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      category: newNote.category,
      title: newNote.title.trim(),
      content: newNote.content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onNotesChange([...notes, note]);
    setNewNote({ category: categories[0] || "Overall", title: "", content: "" });
    if (onAddNote) onAddNote();
  };

  const handleEditNote = (noteId: string) => {
    const note = notes.find(n => n.id === noteId);
    if (note) {
      setEditingId(noteId);
      setEditTitle(note.title || getNoteTitle(note));
      setEditContent(note.content);
    }
  };

  const handleSaveEdit = (noteId: string) => {
    if (!editTitle?.trim() || !hasMeaningfulContent(editContent)) return;

    const updatedNotes = notes.map(note =>
      note.id === noteId
        ? { ...note, title: editTitle.trim(), content: editContent, updatedAt: new Date().toISOString() }
        : note
    );

    onNotesChange(updatedNotes);
    setEditingId(null);
    setEditTitle("");
    setEditContent("");
  };

  const handleDeleteNote = (noteId: string) => {
    if (!confirm("Are you sure you want to delete this note?")) return;
    onNotesChange(notes.filter(n => n.id !== noteId));
  };

  const toggleNoteExpansion = (noteId: string) => {
    const newExpanded = new Set(expandedNotes);
    if (newExpanded.has(noteId)) {
      newExpanded.delete(noteId);
    } else {
      newExpanded.add(noteId);
    }
    setExpandedNotes(newExpanded);
  };

  // Fallback for legacy notes without titles
  const getNoteTitle = (note: DiligenceNote): string => {
    if (note.title) return note.title;
    // For legacy notes, use first 50 chars of content as title
    return note.content.substring(0, 50) + (note.content.length > 50 ? "..." : "");
  };

  // Render legacy markdown/plain text notes; for HTML notes, render as-is.
  const renderNoteContent = (text: string): string => {
    if (!text) return "";
    if (/<[a-z][\s\S]*>/i.test(text)) {
      return text
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
        .replace(/\son\w+="[^"]*"/gi, "")
        .replace(/\son\w+='[^']*'/gi, "")
        .replace(/javascript:/gi, "");
    }

    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    
    // Headings
    html = html.replace(/^### (.*$)/gim, '<h3 class="text-sm font-semibold text-gray-900 mt-2 mb-1">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 class="text-base font-semibold text-gray-900 mt-3 mb-1">$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 class="text-lg font-bold text-gray-900 mt-3 mb-2">$1</h1>');
    
    // Legacy markdown support
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>');
    
    // Italic (single asterisk, but not part of **)
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em class="italic">$1</em>');
    
    // Code
    html = html.replace(/`(.*?)`/g, '<code class="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">$1</code>');
    
    // Links
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" class="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">$1</a>');
    
    // Bullet lists
    const lines = html.split('\n');
    let inList = false;
    const processedLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('- ')) {
        if (!inList) {
          processedLines.push('<ul class="list-disc list-inside space-y-0.5 my-1">');
          inList = true;
        }
        processedLines.push(`<li class="text-sm">${line.trim().substring(2)}</li>`);
      } else {
        if (inList) {
          processedLines.push('</ul>');
          inList = false;
        }
        if (line.trim()) {
          processedLines.push(`<p class="text-sm my-0.5">${line}</p>`);
        } else {
          processedLines.push('<br/>');
        }
      }
    }
    
    if (inList) {
      processedLines.push('</ul>');
    }
    
    return processedLines.join('\n');
  };

  // Group notes by category
  const notesByCategory = notes.reduce((acc, note) => {
    if (!acc[note.category]) acc[note.category] = [];
    acc[note.category].push(note);
    return acc;
  }, {} as Record<string, DiligenceNote[]>);

  // Sort categories: Overall first, then alphabetically
  const sortedCategories = [...categories].sort((a, b) => {
    if (a === "Overall") return -1;
    if (b === "Overall") return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-4">
      {/* Add Note Form */}
      {isAdding && (
        <div className="border border-blue-200 rounded-lg p-4 bg-blue-50">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category
              </label>
              <select
                value={newNote.category}
                onChange={(e) => setNewNote({ ...newNote, category: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {sortedCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title
              </label>
              <input
                type="text"
                value={newNote.title}
                onChange={(e) => setNewNote({ ...newNote, title: e.target.value })}
                placeholder="Brief title for this note..."
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
            </div>
            <div>
              <RichTextEditor
                label="Note"
                value={newNote.content}
                onChange={(content) => setNewNote({ ...newNote, content })}
                placeholder="Add your observations, concerns, questions, or insights..."
                rows={4}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAddNote}
                disabled={!newNote.title?.trim() || !hasMeaningfulContent(newNote.content)}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="h-4 w-4 inline mr-1" />
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onAddNote) onAddNote();
                  setNewNote({ category: categories[0] || "Overall", title: "", content: "" });
                }}
                className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-300"
              >
                <X className="h-4 w-4 inline mr-1" />
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Display Notes by Category */}
      {sortedCategories.map(category => {
        const categoryNotes = notesByCategory[category] || [];
        if (categoryNotes.length === 0) return null;

        return (
          <div key={category} className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-900 border-b border-gray-200 pb-1">
              {category}
            </h4>
            <div className="space-y-2 ml-3">
              {categoryNotes.map(note => (
                <div key={note.id} className="group relative">
                  {editingId === note.id ? (
                    <div className="space-y-2 border border-blue-200 rounded-lg p-3 bg-blue-50">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Title
                        </label>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          autoFocus
                        />
                      </div>
                      <div>
                        <RichTextEditor
                          label="Content"
                          value={editContent}
                          onChange={setEditContent}
                          rows={4}
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(note.id)}
                          disabled={!editTitle?.trim() || !hasMeaningfulContent(editContent)}
                          className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
                        >
                          <Save className="h-3 w-3 inline mr-1" />
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setEditTitle("");
                            setEditContent("");
                          }}
                          className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-300"
                        >
                          <X className="h-3 w-3 inline mr-1" />
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors">
                      {/* Title Bar - Clickable */}
                      <button
                        type="button"
                        onClick={() => toggleNoteExpansion(note.id)}
                        className="w-full flex items-start gap-2 p-3 text-left"
                      >
                        {expandedNotes.has(note.id) ? (
                          <ChevronDown className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="flex-1">
                          <div className="font-medium text-sm text-gray-900">
                            {getNoteTitle(note)}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {new Date(note.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </button>
                      
                      {/* Action Buttons */}
                      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditNote(note.id);
                          }}
                          className="p-1 text-gray-400 hover:text-blue-600 bg-white rounded"
                          title="Edit"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteNote(note.id);
                          }}
                          className="p-1 text-gray-400 hover:text-red-600 bg-white rounded"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Expanded Content */}
                      {expandedNotes.has(note.id) && (
                        <div className="px-3 pb-3 pt-0">
                          <div 
                            className="text-sm text-gray-700 border-t border-gray-100 pt-2 prose prose-sm max-w-none"
                            dangerouslySetInnerHTML={{ __html: renderNoteContent(note.content) }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* No Notes Message */}
      {showEmptyMessage && notes.length === 0 && !isAdding && (
        <p className="text-sm text-gray-400 italic text-center py-4">
          No notes yet. Click "Add Note" to record your thoughts, concerns, or observations about this deal.
        </p>
      )}

      {/* Save Button */}
      {showSaveButton && notes.length > 0 && (
        <div className="pt-3 border-t border-gray-200">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving..." : "Save Notes & Re-score"}
          </button>
          <p className="mt-2 text-xs text-gray-500 text-center">
            💡 Saving will update the AI scoring with your notes
          </p>
        </div>
      )}
    </div>
  );
}
