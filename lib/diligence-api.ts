/**
 * API utility functions for diligence operations
 * Centralizes API calls to reduce code duplication
 */

import { DiligenceRecord, DiligenceNote } from '@/types/diligence';

interface ApiResponse<T = any> {
  success: boolean;
  record?: DiligenceRecord;
  error?: string;
  data?: T;
}

/**
 * Update a diligence record with partial data
 */
export async function updateDiligenceRecord(
  id: string,
  updates: Partial<DiligenceRecord>
): Promise<ApiResponse> {
  const response = await fetch(`/api/diligence/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });

  return response.json();
}

/**
 * Save categorized notes
 */
export async function saveCategorizedNotes(
  id: string,
  notes: DiligenceNote[]
): Promise<ApiResponse> {
  return updateDiligenceRecord(id, { categorizedNotes: notes });
}

/**
 * Save thesis answers
 */
export async function saveThesisAnswers(
  id: string,
  thesisAnswers: any
): Promise<ApiResponse> {
  return updateDiligenceRecord(id, { thesisAnswers } as any);
}

/**
 * Save founders information
 */
export async function saveFounders(
  id: string,
  founders: Array<{ name: string; linkedinUrl?: string; title?: string }>
): Promise<ApiResponse> {
  return updateDiligenceRecord(id, { founders } as any);
}

/**
 * Save manual score overrides
 */
export async function saveManualOverrides(
  id: string,
  manualOverrides: Record<string, number>
): Promise<ApiResponse> {
  return updateDiligenceRecord(id, { manualOverrides } as any);
}

/**
 * Upload file to diligence record
 */
export async function uploadDiligenceFile(
  diligenceId: string,
  file: File
): Promise<ApiResponse> {
  const formData = new FormData();
  formData.append('diligenceId', diligenceId);
  formData.append('files', file);

  const response = await fetch('/api/diligence/upload', {
    method: 'POST',
    body: formData,
  });

  return response.json();
}

/**
 * Add document link to diligence record
 */
export async function addDocumentLink(
  id: string,
  link: {
    name: string;
    url: string;
    email?: string;
  }
): Promise<ApiResponse> {
  const response = await fetch('/api/diligence/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      diligenceId: id,
      documentLinks: JSON.stringify([link]),
    }),
  });

  return response.json();
}

/**
 * Send chat message to AI
 */
export async function sendChatMessage(
  id: string,
  message: string
): Promise<ApiResponse<{ response: string }>> {
  const response = await fetch('/api/diligence/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ diligenceId: id, message }),
  });

  return response.json();
}

/**
 * Open diligence folder in Google Drive
 */
export async function openDiligenceFolder(id: string): Promise<void> {
  const response = await fetch(`/api/diligence/${id}/folder`, {
    method: 'GET',
  });

  const data = await response.json();

  if (data.success && data.folderUrl) {
    window.open(data.folderUrl, '_blank');
  } else {
    throw new Error(data.error || 'Failed to get folder URL');
  }
}
