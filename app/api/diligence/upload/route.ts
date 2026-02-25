import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import Busboy from 'busboy';
import { 
  uploadFileToDrive, 
  createDiligenceFolder,
  isGoogleDriveConfigured 
} from '@/lib/google-drive';
import { parseDocument, isFileTypeSupported, getMimeType, isUnreadableExtractedText } from '@/lib/document-parser';
import { 
  loadDiligenceRecord, 
  updateDiligenceRecord,
  generateDiligenceId 
} from '@/lib/diligence-storage';
import { DiligenceDocument } from '@/types/diligence';
import { ingestExternalLink } from '@/lib/external-link-ingest';

// Configure route segment for larger uploads
export const maxDuration = 60; // 60 seconds timeout for file processing
export const runtime = 'nodejs';

/**
 * Parse multipart/form-data with support for files larger than 10MB
 */
async function parseMultipartForm(request: NextRequest): Promise<{
  fields: Record<string, string>;
  files: Array<{ name: string; data: Buffer; mimeType: string }>;
}> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    const files: Array<{ name: string; data: Buffer; mimeType: string }> = [];

    const contentType = request.headers.get('content-type');
    if (!contentType) {
      reject(new Error('No content-type header'));
      return;
    }

    const busboy = Busboy({ 
      headers: { 'content-type': contentType },
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
      },
    });

    busboy.on('field', (fieldname, value) => {
      fields[fieldname] = value;
    });

    busboy.on('file', (fieldname, fileStream, fileInfo) => {
      const chunks: Buffer[] = [];
      
      fileStream.on('data', (chunk) => {
        chunks.push(chunk);
      });

      fileStream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        files.push({
          name: fileInfo.filename,
          data: buffer,
          mimeType: fileInfo.mimeType,
        });
      });

      fileStream.on('error', (error) => {
        reject(error);
      });
    });

    busboy.on('finish', () => {
      resolve({ fields, files });
    });

    busboy.on('error', (error) => {
      reject(error);
    });

    // Convert ReadableStream to Node.js Readable
    if (request.body) {
      const reader = request.body.getReader();
      const stream = new Readable({
        async read() {
          try {
            const { done, value } = await reader.read();
            if (done) {
              this.push(null);
            } else {
              this.push(Buffer.from(value));
            }
          } catch (error) {
            this.destroy(error as Error);
          }
        },
      });

      stream.pipe(busboy);
    } else {
      reject(new Error('No request body'));
    }
  });
}

/**
 * POST /api/diligence/upload - Upload and process documents
 */
export async function POST(request: NextRequest) {
  try {
    // Check if Google Drive is configured
    if (!isGoogleDriveConfigured()) {
      return NextResponse.json(
        { 
          error: 'Google Drive not configured. Please set up Google Cloud credentials in .env.local',
          success: false 
        },
        { status: 503 }
      );
    }

    // Parse multipart form data with busboy (supports >10MB files)
    const { fields, files: uploadedFiles } = await parseMultipartForm(request);

    const diligenceId = fields.diligenceId;
    const companyName = fields.companyName;
    const documentLinks = fields.documentLinks;
    
    if (!companyName) {
      return NextResponse.json(
        { error: 'Company name is required', success: false },
        { status: 400 }
      );
    }

    // Get the diligence record
    const record = diligenceId ? await loadDiligenceRecord(diligenceId) : null;
    
    if (diligenceId && !record) {
      return NextResponse.json(
        { error: 'Diligence record not found', success: false },
        { status: 404 }
      );
    }

    // Process all uploaded files
    const documentArray: DiligenceDocument[] = [];
    const errors: string[] = [];

    // Process document links if provided
    if (documentLinks && documentLinks.trim()) {
      try {
        // Try to parse as JSON (new format with names and optional email)
        const linksArray = JSON.parse(documentLinks) as Array<{ name: string; url: string; email?: string }>;
        
        for (const link of linksArray) {
          let extractedText = '';
          let resolvedUrl = link.url;
          let ingestStatus: DiligenceDocument['linkIngestStatus'] = 'failed';
          let ingestMessage: string | undefined;
          const ingestedAt = new Date().toISOString();
          try {
            const ingested = await ingestExternalLink(link.url, link.email);
            if (ingested.success && ingested.extractedText) {
              extractedText = ingested.extractedText;
              ingestStatus = 'ingested';
              ingestMessage = 'Content extracted successfully.';
            } else {
              ingestStatus = ingested.status === 'email_required' ? 'email_required' : 'failed';
              ingestMessage = ingested.error;
            }
            if (ingested.error) {
              errors.push(`${link.name || link.url}: ${ingested.error}`);
            }
            if (ingested.resolvedUrl) {
              resolvedUrl = ingested.resolvedUrl;
            }
          } catch (linkError) {
            ingestStatus = 'failed';
            ingestMessage =
              linkError instanceof Error
                ? `Link ingest failed: ${linkError.message}`
                : 'Link ingest failed: unknown error';
            errors.push(
              `${link.name || link.url}: failed to ingest external link (${linkError instanceof Error ? linkError.message : 'unknown error'})`
            );
          }

          const linkDoc: DiligenceDocument = {
            id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`,
            name: link.name,
            type: 'other',
            fileType: 'link',
            externalUrl: resolvedUrl,
            accessEmail: link.email || undefined,
            linkIngestStatus: ingestStatus,
            linkIngestMessage: ingestMessage,
            linkIngestedAt: ingestedAt,
            uploadedAt: new Date().toISOString(),
            extractedText: extractedText || undefined,
          };
          documentArray.push(linkDoc);
        }
      } catch (e) {
        // Fallback to old format (plain URLs, one per line)
        const links = documentLinks.split('\n')
          .map(link => link.trim())
          .filter(link => link.length > 0);
        
        for (const link of links) {
          let extractedText = '';
          let resolvedUrl = link;
          let ingestStatus: DiligenceDocument['linkIngestStatus'] = 'failed';
          let ingestMessage: string | undefined;
          const ingestedAt = new Date().toISOString();
          try {
            const ingested = await ingestExternalLink(link);
            if (ingested.success && ingested.extractedText) {
              extractedText = ingested.extractedText;
              ingestStatus = 'ingested';
              ingestMessage = 'Content extracted successfully.';
            } else {
              ingestStatus = ingested.status === 'email_required' ? 'email_required' : 'failed';
              ingestMessage = ingested.error;
            }
            if (ingested.error) {
              errors.push(`${link}: ${ingested.error}`);
            }
            if (ingested.resolvedUrl) {
              resolvedUrl = ingested.resolvedUrl;
            }
          } catch (linkError) {
            ingestStatus = 'failed';
            ingestMessage =
              linkError instanceof Error
                ? `Link ingest failed: ${linkError.message}`
                : 'Link ingest failed: unknown error';
            errors.push(
              `${link}: failed to ingest external link (${linkError instanceof Error ? linkError.message : 'unknown error'})`
            );
          }

          const linkDoc: DiligenceDocument = {
            id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`,
            name: link.split('/').pop() || 'External Document',
            type: 'other',
            fileType: 'url',
            externalUrl: resolvedUrl,
            linkIngestStatus: ingestStatus,
            linkIngestMessage: ingestMessage,
            linkIngestedAt: ingestedAt,
            uploadedAt: new Date().toISOString(),
            extractedText: extractedText || undefined,
          };
          documentArray.push(linkDoc);
        }
      }
    }
    
    // Check for duplicate file names in existing documents
    const existingFileNames = new Set(
      (record?.documents || []).map(doc => doc.name.toLowerCase())
    );
    
    // If no files and no document links, return early (but successfully)
    if (uploadedFiles.length === 0 && documentArray.length === 0) {
      // Still update the record with empty documents array
      if (record) {
        await updateDiligenceRecord(diligenceId, {
          documents: documentArray,
          updatedAt: new Date().toISOString(),
        });
      }
      return NextResponse.json(
        { 
          success: true,
          documents: documentArray
        }
      );
    }

    // Create Google Drive folder only if we have files to upload
    let folderId: string | undefined;
    if (uploadedFiles.length > 0) {
      folderId = await createDiligenceFolder(companyName);
    }

    // Process uploaded files
    if (uploadedFiles.length > 0 && !folderId) {
      return NextResponse.json(
        { error: 'No files uploaded', success: false },
        { status: 400 }
      );
    }

    const processedDocuments: DiligenceDocument[] = [];

    for (const file of uploadedFiles) {
      try {
        // Check for duplicate file name
        if (existingFileNames.has(file.name.toLowerCase())) {
          errors.push(`${file.name}: File already exists`);
          continue;
        }

        // Validate file type
        if (!isFileTypeSupported(file.name)) {
          errors.push(`${file.name}: Unsupported file type`);
          continue;
        }

        // Validate file size (50MB max)
        if (file.data.length > 50 * 1024 * 1024) {
          errors.push(`${file.name}: File too large (max 50MB)`);
          continue;
        }

        // Upload to Google Drive
        const mimeType = getMimeType(file.name);
        const driveFile = await uploadFileToDrive(file.data, file.name, mimeType, folderId);

        // Parse document to extract text
        const extension = file.name.split('.').pop() || '';
        let extractedText = '';
        try {
          extractedText = await parseDocument(file.data, extension);
        } catch (parseError) {
          console.error(`Error parsing ${file.name}:`, parseError);
          extractedText = '[Document could not be parsed]';
        }
        if (isUnreadableExtractedText(extractedText)) {
          errors.push(
            `${file.name}: Text extraction was insufficient. Thesis/scoring may ignore this document until a readable version is provided.`
          );
        }

        // Determine document type from file name or user input
        let docType: 'deck' | 'financial' | 'legal' | 'other' = 'other';
        const fileName = file.name.toLowerCase();
        if (fileName.includes('pitch') || fileName.includes('deck') || fileName.includes('presentation')) {
          docType = 'deck';
        } else if (fileName.includes('financial') || fileName.includes('p&l') || fileName.includes('balance')) {
          docType = 'financial';
        } else if (fileName.includes('legal') || fileName.includes('contract') || fileName.includes('agreement')) {
          docType = 'legal';
        }

        const document: DiligenceDocument = {
          id: `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          name: file.name,
          type: docType,
          fileType: extension,
          googleDriveId: driveFile.id,
          googleDriveUrl: driveFile.webViewLink,
          uploadedAt: new Date().toISOString(),
          extractedText,
          size: file.data.length,
        };

        processedDocuments.push(document);

      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error);
        errors.push(`${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Combine document links with uploaded files
    const allDocuments = [...documentArray, ...processedDocuments];

    if (allDocuments.length === 0) {
      return NextResponse.json(
        { 
          error: 'Failed to process any files', 
          details: errors,
          success: false 
        },
        { status: 400 }
      );
    }

    // Update diligence record with new documents
    let finalRecord;
    if (record) {
      // Add to existing record
      const updateData: any = {
        documents: [...record.documents, ...allDocuments],
      };
      
      // Store folder ID if it was created and not already stored
      if (folderId && !record.googleDriveFolderId) {
        updateData.googleDriveFolderId = folderId;
      }
      
      finalRecord = await updateDiligenceRecord(record.id, updateData);
    } else {
      // This shouldn't happen as frontend should create record first,
      // but handle it gracefully
      return NextResponse.json(
        { error: 'Diligence record must be created before uploading files', success: false },
        { status: 400 }
      );
    }

    return NextResponse.json({
      diligenceId: finalRecord.id,
      documents: allDocuments,
      totalDocuments: finalRecord.documents.length,
      errors: errors.length > 0 ? errors : undefined,
      success: true,
    });

  } catch (error) {
    console.error('Error in upload endpoint:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to upload documents',
        success: false 
      },
      { status: 500 }
    );
  }
}
