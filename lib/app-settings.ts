import { promises as fs } from 'fs';
import path from 'path';

const SETTINGS_FILE = path.join(process.cwd(), 'app-settings.json');

export interface AppSettings {
  matchingGuidance: string;
  minMatchScore: number;
  scoringWeights: {
    industry: number;
    thesis: number;
    stage: number;
    checkSize: number;
  };
  checkSizeFilterStrictness: number;
  minDataQuality: number;
  emailHeading?: string;
  emailFooter?: string;
  emailPrompt?: string;
  summarizeTranscriptNotesForScoring?: boolean;
  enableScoringFeedback?: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  matchingGuidance: '',
  minMatchScore: 50,
  scoringWeights: {
    industry: 30,
    thesis: 30,
    stage: 25,
    checkSize: 15,
  },
  checkSizeFilterStrictness: 25,
  minDataQuality: 30,
  summarizeTranscriptNotesForScoring: false,
  enableScoringFeedback: true,
};

export async function loadAppSettings(): Promise<AppSettings> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    return {
      ...DEFAULT_APP_SETTINGS,
      ...parsed,
      scoringWeights: {
        ...DEFAULT_APP_SETTINGS.scoringWeights,
        ...(parsed?.scoringWeights || {}),
      },
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}
