import { google } from 'googleapis';
import { DiligenceCriteria, CriteriaCategory, Criterion } from '@/types/diligence';

// Initialize Google Auth
function getGoogleAuth() {
  if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Google credentials not configured. Please set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY in .env.local');
  }

  // Check for placeholder values
  if (process.env.GOOGLE_CLIENT_EMAIL.includes('your-service-account') || 
      process.env.GOOGLE_PRIVATE_KEY.includes('YOUR_PRIVATE_KEY_HERE')) {
    throw new Error('Google credentials are still placeholder values. Please follow the setup guide in DILIGENCE_SETUP_GUIDE.md to configure your actual Google Cloud service account credentials.');
  }

  try {
    return new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  } catch (error) {
    // Catch OpenSSL errors from invalid private keys
    if (error instanceof Error && error.message.includes('DECODER')) {
      throw new Error('Invalid Google private key format. Please ensure you copied the complete private key from your service account JSON file, including the BEGIN and END markers. See DILIGENCE_SETUP_GUIDE.md for help.');
    }
    throw error;
  }
}

// Get Sheets client
function getSheetsClient() {
  const auth = getGoogleAuth();
  return google.sheets({ version: 'v4', auth });
}

// Cache criteria for 1 hour to reduce API calls
let cachedCriteria: DiligenceCriteria | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

/**
 * Load diligence criteria from Google Sheets
 * 
 * Expected sheet structure:
 * | Category | Weight | Criterion | Description | Scoring Guidance | Insufficient Evidence Cap | Field Registry Key | Answer Builder |
 * |----------|--------|-----------|-------------|------------------|---------------------------|--------------------|----------------|
 * | Team     | 25     | Founder Experience | ... | Look for... | 60 |                    |                |
 * | Team     |        | Team Completeness  | ... | Assess...   | 55 |                    |                |
 * | Product  | 30     | Market Fit        | ... | Evidence... | 60 | TAM                |                |
 *
 * Notes:
 *  - "Insufficient Evidence Cap" (column F) is optional and can be left blank.
 *  - "Field Registry Key" (column G) is optional. When present it should
 *    match a `field_name` value from config/field-registry.csv, creating a
 *    soft cross-reference between a scoring criterion and its underlying
 *    data field.
 *  - "Answer Builder" (column H) is optional. When present, it defines a
 *    template used by the UI to auto-compose a read-only criterion answer
 *    from metrics (for example: "Raising {fundingAmount} at {valuation}.").
 */
export async function loadDiligenceCriteria(forceRefresh = false): Promise<DiligenceCriteria> {
  // Check cache first
  if (!forceRefresh && cachedCriteria && Date.now() - cacheTimestamp < CACHE_DURATION) {
    return cachedCriteria;
  }

  const sheetId = process.env.DILIGENCE_CRITERIA_SHEET_ID;
  if (!sheetId) {
    throw new Error('DILIGENCE_CRITERIA_SHEET_ID not configured');
  }

  const sheets = getSheetsClient();

  // Read the sheet data
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'A2:H1000', // Skip header row, columns A-H, up to 1000 rows
  });

  const rows = response.data.values;
  if (!rows || rows.length === 0) {
    throw new Error('No data found in criteria sheet');
  }

  // Parse rows into structured criteria
  const categoriesMap = new Map<string, { weight: number; criteria: Criterion[] }>();
  let currentCategory = '';
  let currentWeight = 0;

  for (const row of rows) {
    const [category, weight, criterion, description, scoringGuidance, insufficientEvidenceCap, fieldRegistryKey, answerBuilder] = row;

    // Skip empty rows
    if (!category && !criterion) continue;

    // New category
    if (category && category.trim()) {
      currentCategory = category.trim();
      currentWeight = weight ? parseFloat(weight) : 0;

      if (!categoriesMap.has(currentCategory)) {
        categoriesMap.set(currentCategory, {
          weight: currentWeight,
          criteria: [],
        });
      }
    }

    // Add criterion to current category
    if (criterion && criterion.trim() && currentCategory) {
      const parsedCap = insufficientEvidenceCap !== undefined && insufficientEvidenceCap !== ''
        ? Number(insufficientEvidenceCap)
        : undefined;
      const parsedFieldRegistryKey = fieldRegistryKey?.trim() || undefined;
      const parsedAnswerBuilder = answerBuilder?.trim() || undefined;
      categoriesMap.get(currentCategory)!.criteria.push({
        name: criterion.trim(),
        description: description?.trim() || '',
        scoringGuidance: scoringGuidance?.trim() || '',
        insufficientEvidenceCap: Number.isFinite(parsedCap) ? parsedCap : undefined,
        fieldRegistryKey: parsedFieldRegistryKey,
        answerBuilder: parsedAnswerBuilder,
      });
    }
  }

  // Convert map to array
  const categories: CriteriaCategory[] = Array.from(categoriesMap.entries()).map(
    ([name, data]) => ({
      name,
      weight: data.weight,
      criteria: data.criteria,
    })
  );

  // Validate total weight = 100%
  const totalWeight = categories.reduce((sum, cat) => sum + cat.weight, 0);
  if (Math.abs(totalWeight - 100) > 0.1) {
    console.warn(`Warning: Total category weights = ${totalWeight}%, expected 100%`);
  }

  const criteria: DiligenceCriteria = {
    categories,
    lastUpdated: new Date().toISOString(),
  };

  // Cache the result
  cachedCriteria = criteria;
  cacheTimestamp = Date.now();

  return criteria;
}

/**
 * Check if Google Sheets is configured
 */
export function isGoogleSheetsConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.DILIGENCE_CRITERIA_SHEET_ID
  );
}

/**
 * Clear the criteria cache (useful for testing)
 */
export function clearCriteriaCache(): void {
  cachedCriteria = null;
  cacheTimestamp = 0;
}
