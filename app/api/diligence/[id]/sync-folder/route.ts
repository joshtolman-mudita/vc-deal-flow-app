import { NextRequest, NextResponse } from 'next/server';
import { loadDiligenceRecord, updateDiligenceRecord } from '@/lib/diligence-storage';
import { listFilesRecursively, downloadFileFromDrive } from '@/lib/google-drive';
import { parseDocument, getMimeType } from '@/lib/document-parser';
import { DiligenceDocument } from '@/types/diligence';

/**
 * POST /api/diligence/[id]/sync-folder - Scan Google Drive folder for new files
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Load the record
    const record = await loadDiligenceRecord(id);
    if (!record) {
      return NextResponse.json(
        { error: 'Diligence record not found', success: false },
        { status: 404 }
      );
    }

    if (!record.googleDriveFolderId) {
      return NextResponse.json(
        { error: 'No Google Drive folder associated with this diligence', success: false },
        { status: 400 }
      );
    }

    console.log(`Scanning Google Drive folder: ${record.googleDriveFolderId}`);

    // Get all files in folder (including subfolders)
    const driveFiles = await listFilesRecursively(record.googleDriveFolderId);
    
    console.log(`Found ${driveFiles.length} files in Drive folder`);

    // Filter out Google Workspace files and folders
    const processableFiles = driveFiles.filter(file => 
      !file.mimeType.startsWith('application/vnd.google-apps.') ||
      file.mimeType === 'application/vnd.google-apps.document' ||
      file.mimeType === 'application/vnd.google-apps.spreadsheet'
    );

    console.log(`${processableFiles.length} processable files`);

    // Get existing document IDs to avoid duplicates
    const existingFileIds = new Set(record.documents.map(doc => doc.googleDriveId).filter(Boolean));
    
    // Process new files not already in the record
    const newDocuments: DiligenceDocument[] = [];
    let processedCount = 0;
    let skippedCount = 0;

    for (const driveFile of processableFiles) {
      // Skip if already in record
      if (existingFileIds.has(driveFile.id)) {
        skippedCount++;
        continue;
      }

      try {
        console.log(`Processing new file: ${driveFile.name}`);
        
        // Download and parse the file
        const fileBuffer = await downloadFileFromDrive(driveFile.id);
        const fileExtension = driveFile.name.split('.').pop() || '';
        const parsedText = await parseDocument(fileBuffer, fileExtension);

        if (parsedText && parsedText.trim().length > 0) {
          const newDoc: DiligenceDocument = {
            id: `doc_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            name: driveFile.name,
            type: 'other',
            fileType: fileExtension,
            googleDriveId: driveFile.id,
            googleDriveUrl: driveFile.webViewLink,
            extractedText: parsedText,
            uploadedAt: new Date().toISOString(),
          };

          newDocuments.push(newDoc);
          processedCount++;
          console.log(`✓ Added: ${driveFile.name} (${parsedText.length} chars extracted)`);
        } else {
          console.log(`⚠ Skipped ${driveFile.name}: No text extracted`);
          skippedCount++;
        }
      } catch (error) {
        console.error(`Error processing ${driveFile.name}:`, error);
        skippedCount++;
      }
    }

    // Update record with new documents
    if (newDocuments.length > 0) {
      const updatedDocuments = [...record.documents, ...newDocuments];
      await updateDiligenceRecord(id, { documents: updatedDocuments });
      
      console.log(`✓ Added ${newDocuments.length} new documents to record`);
    }

    return NextResponse.json({
      success: true,
      newDocumentsCount: processedCount,
      skippedCount,
      totalDocuments: record.documents.length + newDocuments.length,
      message: processedCount > 0 
        ? `Added ${processedCount} new document(s) from folder`
        : 'No new documents found in folder',
    });

  } catch (error) {
    console.error('Error syncing folder:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to sync folder',
        success: false,
      },
      { status: 500 }
    );
  }
}
