import fs from 'fs/promises';
import path from 'path';
import { Storage } from '@google-cloud/storage';
import { DiligenceRecord } from '@/types/diligence';

const STORAGE_DIR = path.join(process.cwd(), 'data', 'diligence');
const STORAGE_BACKEND = process.env.STORAGE_BACKEND || 'local';
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME || '';

// Initialize Google Cloud Storage client (only if using GCS backend)
let gcsStorage: Storage | null = null;
if (STORAGE_BACKEND === 'gcs') {
  gcsStorage = new Storage({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
  });
  console.log(`Using Google Cloud Storage backend: ${GCS_BUCKET_NAME}`);
} else {
  console.log('Using local filesystem backend');
}

/**
 * Ensure storage directory exists (local filesystem only)
 */
async function ensureStorageDir(): Promise<void> {
  if (STORAGE_BACKEND === 'local') {
    try {
      await fs.mkdir(STORAGE_DIR, { recursive: true });
    } catch (error) {
      console.error('Error creating storage directory:', error);
      throw new Error('Failed to initialize diligence storage');
    }
  }
}

/**
 * Get GCS bucket instance
 */
function getGCSBucket() {
  if (!gcsStorage || !GCS_BUCKET_NAME) {
    throw new Error('Google Cloud Storage not configured');
  }
  return gcsStorage.bucket(GCS_BUCKET_NAME);
}

/**
 * Save a diligence record to storage
 */
export async function saveDiligenceRecord(record: DiligenceRecord): Promise<void> {
  const content = JSON.stringify(record, null, 2);
  
  if (STORAGE_BACKEND === 'gcs') {
    // Google Cloud Storage
    try {
      const bucket = getGCSBucket();
      const file = bucket.file(`diligence/${record.id}.json`);
      await file.save(content, {
        contentType: 'application/json',
        metadata: {
          cacheControl: 'no-cache',
        },
      });
    } catch (error) {
      console.error('Error saving to GCS:', error);
      throw new Error('Failed to save diligence record');
    }
  } else {
    // Local filesystem
    await ensureStorageDir();
    const filePath = path.join(STORAGE_DIR, `${record.id}.json`);
    
    try {
      await fs.writeFile(filePath, content, 'utf-8');
    } catch (error) {
      console.error('Error saving diligence record:', error);
      throw new Error('Failed to save diligence record');
    }
  }
}

/**
 * Load a specific diligence record
 */
export async function loadDiligenceRecord(id: string): Promise<DiligenceRecord | null> {
  try {
    let data: string;
    
    if (STORAGE_BACKEND === 'gcs') {
      // Google Cloud Storage
      const bucket = getGCSBucket();
      const file = bucket.file(`diligence/${id}.json`);
      
      const exists = await file.exists();
      if (!exists[0]) {
        return null;
      }
      
      const [contents] = await file.download();
      data = contents.toString('utf-8');
    } else {
      // Local filesystem
      const filePath = path.join(STORAGE_DIR, `${id}.json`);
      data = await fs.readFile(filePath, 'utf-8');
    }
    
    const record = JSON.parse(data) as DiligenceRecord;
    
    // Ensure categorizedNotes exists (for backward compatibility)
    if (!record.categorizedNotes) {
      record.categorizedNotes = [];
    }
    
    return record;
  } catch (error) {
    // File doesn't exist or can't be read
    return null;
  }
}

/**
 * List all diligence records
 */
export async function listDiligenceRecords(): Promise<DiligenceRecord[]> {
  try {
    let jsonFiles: string[] = [];
    
    if (STORAGE_BACKEND === 'gcs') {
      // Google Cloud Storage
      const bucket = getGCSBucket();
      const [files] = await bucket.getFiles({ prefix: 'diligence/' });
      jsonFiles = files
        .filter(file => file.name.endsWith('.json'))
        .map(file => file.name);
    } else {
      // Local filesystem
      await ensureStorageDir();
      const files = await fs.readdir(STORAGE_DIR);
      jsonFiles = files.filter(file => file.endsWith('.json'));
    }
    
    const records = await Promise.all(
      jsonFiles.map(async (fileName) => {
        try {
          let data: string;
          
          if (STORAGE_BACKEND === 'gcs') {
            const bucket = getGCSBucket();
            const file = bucket.file(fileName);
            const [contents] = await file.download();
            data = contents.toString('utf-8');
          } else {
            const filePath = path.join(STORAGE_DIR, fileName);
            data = await fs.readFile(filePath, 'utf-8');
          }
          
          const record = JSON.parse(data) as DiligenceRecord;
          
          // Ensure categorizedNotes exists (for backward compatibility)
          if (!record.categorizedNotes) {
            record.categorizedNotes = [];
          }
          
          return record;
        } catch {
          return null;
        }
      })
    );
    
    // Filter out null records and sort by updatedAt (newest first)
    return records
      .filter((record): record is DiligenceRecord => record !== null)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      
  } catch (error) {
    console.error('Error listing diligence records:', error);
    return [];
  }
}

/**
 * Delete a diligence record
 */
export async function deleteDiligenceRecord(id: string): Promise<void> {
  try {
    if (STORAGE_BACKEND === 'gcs') {
      // Google Cloud Storage
      const bucket = getGCSBucket();
      const file = bucket.file(`diligence/${id}.json`);
      await file.delete();
    } else {
      // Local filesystem
      const filePath = path.join(STORAGE_DIR, `${id}.json`);
      await fs.unlink(filePath);
    }
  } catch (error) {
    console.error('Error deleting diligence record:', error);
    throw new Error('Failed to delete diligence record');
  }
}

/**
 * Update a diligence record
 */
export async function updateDiligenceRecord(
  id: string,
  updates: Partial<DiligenceRecord>
): Promise<DiligenceRecord> {
  const record = await loadDiligenceRecord(id);
  
  if (!record) {
    throw new Error('Diligence record not found');
  }
  
  const updatedRecord: DiligenceRecord = {
    ...record,
    ...updates,
    id: record.id, // Ensure ID doesn't change
    updatedAt: new Date().toISOString(),
  };
  
  await saveDiligenceRecord(updatedRecord);
  
  return updatedRecord;
}

/**
 * Generate a unique ID for a new record
 */
export function generateDiligenceId(): string {
  return `dd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Search diligence records by company name
 */
export async function searchDiligenceRecords(query: string): Promise<DiligenceRecord[]> {
  const allRecords = await listDiligenceRecords();
  const lowerQuery = query.toLowerCase();
  
  return allRecords.filter(record =>
    record.companyName.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Find the first diligence record linked to a given HubSpot deal ID
 */
export async function findDiligenceRecordByHubspotDealId(
  hubspotDealId: string
): Promise<DiligenceRecord | null> {
  const allRecords = await listDiligenceRecords();
  return allRecords.find((r) => r.hubspotDealId === hubspotDealId) ?? null;
}
