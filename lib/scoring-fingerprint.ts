import { createHash } from 'crypto';
import { DiligenceCriteria, DiligenceDocument, DiligenceMetrics, DiligenceNote } from '@/types/diligence';

interface FingerprintInput {
  companyName: string;
  companyUrl?: string;
  companyDescription?: string;
  notes?: string;
  categorizedNotes?: DiligenceNote[];
  metrics?: DiligenceMetrics;
  documents: DiligenceDocument[];
  criteria: DiligenceCriteria;
  scorerVersion: string;
  summarizeTranscriptNotesForScoring: boolean;
}

function normalizeMetrics(metrics?: DiligenceMetrics): Record<string, string> {
  return {
    arr: metrics?.arr?.value?.trim() || '',
    arrSource: metrics?.arr?.source || '',
    tam: metrics?.tam?.value?.trim() || '',
    tamSource: metrics?.tam?.source || '',
    acv: metrics?.acv?.value?.trim() || '',
    acvSource: metrics?.acv?.source || '',
    yoyGrowthRate: metrics?.yoyGrowthRate?.value?.trim() || '',
    yoyGrowthRateSource: metrics?.yoyGrowthRate?.source || '',
  };
}

function normalizeNotes(notes?: DiligenceNote[]): Array<{ category: string; title: string; content: string }> {
  return (notes || [])
    .map(note => ({
      category: note.category || '',
      title: note.title || '',
      content: note.content || '',
    }))
    .sort((a, b) => `${a.category}:${a.title}`.localeCompare(`${b.category}:${b.title}`));
}

function normalizeDocuments(documents: DiligenceDocument[]): Array<{ name: string; type: string; text: string }> {
  return (documents || [])
    .map(doc => ({
      name: doc.name || '',
      type: doc.type || 'other',
      text: doc.extractedText || '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildScoringFingerprint(input: FingerprintInput): string {
  const payload = {
    companyName: input.companyName || '',
    companyUrl: input.companyUrl || '',
    companyDescription: input.companyDescription || '',
    notes: input.notes || '',
    categorizedNotes: normalizeNotes(input.categorizedNotes),
    metrics: normalizeMetrics(input.metrics),
    documents: normalizeDocuments(input.documents),
    criteria: input.criteria,
    scorerVersion: input.scorerVersion,
    summarizeTranscriptNotesForScoring: input.summarizeTranscriptNotesForScoring,
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
