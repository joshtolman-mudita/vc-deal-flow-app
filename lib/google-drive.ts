import { google } from 'googleapis';
import { Readable } from 'stream';

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
    const configuredScope = process.env.GOOGLE_DRIVE_SCOPE?.trim();
    const scopes = [configuredScope || 'https://www.googleapis.com/auth/drive'];

    return new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes,
    });
  } catch (error) {
    // Catch OpenSSL errors from invalid private keys
    if (error instanceof Error && error.message.includes('DECODER')) {
      throw new Error('Invalid Google private key format. Please ensure you copied the complete private key from your service account JSON file, including the BEGIN and END markers. See DILIGENCE_SETUP_GUIDE.md for help.');
    }
    throw error;
  }
}

// Get Drive client
function getDriveClient() {
  const auth = getGoogleAuth();
  return google.drive({ version: 'v3', auth });
}

/**
 * Upload a file to Google Drive
 */
export async function uploadFileToDrive(
  file: Buffer,
  fileName: string,
  mimeType: string,
  parentFolderId?: string
): Promise<{ id: string; webViewLink: string }> {
  const drive = getDriveClient();

  const fileMetadata: any = {
    name: fileName,
  };

  if (parentFolderId) {
    fileMetadata.parents = [parentFolderId];
  }

  const media = {
    mimeType: mimeType,
    body: Readable.from(file),
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });

  if (!response.data.id || !response.data.webViewLink) {
    throw new Error('Failed to upload file to Google Drive');
  }

  // Note: For Shared Drives, permissions are inherited from the drive itself
  // We don't need to (and can't) set individual file permissions
  // For regular folders, we could set permissions, but it's optional

  return {
    id: response.data.id,
    webViewLink: response.data.webViewLink,
  };
}

/**
 * Download a file from Google Drive
 * For Google Sheets, exports as Excel format
 */
export async function downloadFileFromDrive(fileId: string, mimeType?: string): Promise<Buffer> {
  const drive = getDriveClient();

  // Check if it's a Google Sheets document
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    // Export as Excel format
    const response = await drive.files.export(
      {
        fileId: fileId,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      { responseType: 'arraybuffer' }
    );
    return Buffer.from(response.data as ArrayBuffer);
  }

  // Regular file download
  const response = await drive.files.get(
    {
      fileId: fileId,
      alt: 'media',
    },
    { responseType: 'arraybuffer' }
  );

  return Buffer.from(response.data as ArrayBuffer);
}

/**
 * Best-effort OCR for uploaded files (PDF/images) via Google Drive conversion.
 * Creates a temporary Google Doc, exports text, then deletes the temp file.
 */
export async function extractTextWithGoogleDriveOcr(
  file: Buffer,
  mimeType: string,
  fileName = 'ocr-source'
): Promise<string | undefined> {
  if (!isGoogleDriveConfigured()) return undefined;
  const drive = getDriveClient();
  const parentFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  const tempName = `${fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 80)}_ocr_${Date.now()}`;
  let tempFileId: string | undefined;
  try {
    const createResponse = await drive.files.create({
      requestBody: {
        name: tempName,
        mimeType: 'application/vnd.google-apps.document',
        ...(parentFolderId ? { parents: [parentFolderId] } : {}),
      },
      media: {
        mimeType,
        body: Readable.from(file),
      },
      fields: 'id',
      supportsAllDrives: true,
      ocrLanguage: 'en',
    });
    tempFileId = createResponse.data.id || undefined;
    if (!tempFileId) return undefined;
    const exported = await drive.files.export(
      {
        fileId: tempFileId,
        mimeType: 'text/plain',
      },
      { responseType: 'arraybuffer' }
    );
    const text = Buffer.from(exported.data as ArrayBuffer).toString('utf-8').trim();
    return text || undefined;
  } catch (error) {
    console.warn('Google Drive OCR fallback failed:', error);
    return undefined;
  } finally {
    if (tempFileId) {
      try {
        await drive.files.delete({
          fileId: tempFileId,
          supportsAllDrives: true,
        });
      } catch {
        // Ignore cleanup failures for temp OCR docs.
      }
    }
  }
}

/**
 * Create a folder in Google Drive
 */
export async function createFolder(
  folderName: string,
  parentFolderId?: string
): Promise<string> {
  const drive = getDriveClient();

  const fileMetadata: any = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };

  if (parentFolderId) {
    fileMetadata.parents = [parentFolderId];
  }

  const response = await drive.files.create({
    requestBody: fileMetadata,
    fields: 'id',
    supportsAllDrives: true,
  });

  if (!response.data.id) {
    throw new Error('Failed to create folder in Google Drive');
  }

  // Note: For Shared Drives, permissions are inherited from the drive itself
  // We don't need to set folder permissions separately

  return response.data.id;
}

/**
 * Get the environment-specific root folder
 * Creates "Dev Diligence" or "Prod Diligence" subfolder if needed
 */
async function getEnvironmentRootFolder(): Promise<string> {
  const drive = getDriveClient();
  const baseFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!baseFolderId) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID not configured');
  }

  // Determine environment
  const isDev = process.env.NODE_ENV === 'development';
  const envFolderName = isDev ? 'Dev Diligence' : 'Prod Diligence';

  console.log(`Environment: ${isDev ? 'Development' : 'Production'}`);
  console.log(`Looking for environment folder: "${envFolderName}"`);

  // Check if environment folder exists
  const searchResponse = await drive.files.list({
    q: `name='${envFolderName}' and '${baseFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    corpora: 'allDrives',
  });

  if (searchResponse.data.files && searchResponse.data.files.length > 0) {
    const folderId = searchResponse.data.files[0].id!;
    console.log(`✓ Using existing environment folder: ${folderId}`);
    return folderId;
  } else {
    // Create environment folder
    const folderId = await createFolder(envFolderName, baseFolderId);
    console.log(`✓ Created new environment folder: ${folderId}`);
    return folderId;
  }
}

/**
 * Create a diligence folder structure
 * Creates or reuses: Diligence Root / [Dev|Prod] Diligence / Company Name
 */
export async function createDiligenceFolder(companyName: string): Promise<string> {
  const drive = getDriveClient();
  
  // Get environment-specific root folder
  const envRootFolderId = await getEnvironmentRootFolder();

  // Sanitize company name for folder name
  const sanitizedName = companyName.replace(/[^a-z0-9\s\-\_]/gi, '_');

  console.log(`\n=== DILIGENCE FOLDER CREATION ===`);
  console.log(`Original company name: "${companyName}"`);
  console.log(`Sanitized folder name: "${sanitizedName}"`);
  console.log(`Environment root folder ID: ${envRootFolderId}`);

  // Check if company folder already exists
  // Note: includeItemsFromAllDrives and supportsAllDrives are needed for Shared Drives
  const query = `name='${sanitizedName}' and '${envRootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  console.log(`Search query: ${query}`);
  
  const searchResponse = await drive.files.list({
    q: query,
    fields: 'files(id, name)',
    spaces: 'drive',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    corpora: 'allDrives',
  });

  console.log(`Found ${searchResponse.data.files?.length || 0} matching folders`);
  if (searchResponse.data.files && searchResponse.data.files.length > 0) {
    searchResponse.data.files.forEach((file, idx) => {
      console.log(`  [${idx}] "${file.name}" (ID: ${file.id})`);
    });
  }

  let companyFolderId: string;

  if (searchResponse.data.files && searchResponse.data.files.length > 0) {
    // Use existing company folder
    companyFolderId = searchResponse.data.files[0].id!;
    console.log(`✓ Reusing existing folder: "${sanitizedName}" (ID: ${companyFolderId})`);
  } else {
    // Create new company folder
    companyFolderId = await createFolder(sanitizedName, envRootFolderId);
    console.log(`✓ Created new folder: "${sanitizedName}" (ID: ${companyFolderId})`);
  }
  console.log(`=== END FOLDER CREATION ===\n`);

  return companyFolderId;
}

/**
 * Get the web view link for a Google Drive folder
 */
export async function getFolderWebViewLink(folderId: string): Promise<string> {
  const drive = getDriveClient();
  
  const response = await drive.files.get({
    fileId: folderId,
    fields: 'webViewLink',
    supportsAllDrives: true,
  });

  return response.data.webViewLink || `https://drive.google.com/drive/folders/${folderId}`;
}

/**
 * List files in a folder
 */
export async function listFilesInFolder(folderId: string): Promise<Array<{
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  size?: number;
}>> {
  const drive = getDriveClient();

  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, mimeType, webViewLink, size, shortcutDetails)',
    spaces: 'drive',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'allDrives',
  });

  return (response.data.files || []).map(file => ({
    id: file.id!,
    name: file.name!,
    mimeType: file.mimeType!,
    webViewLink: file.webViewLink!,
    size: file.size ? parseInt(file.size) : undefined,
  }));
}

/**
 * Recursively list all files in a folder and its subfolders
 * Follows shortcuts to folders
 */
export async function listFilesRecursively(folderId: string, processedFolders = new Set<string>(), depth = 0): Promise<Array<{
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  size?: number;
  path?: string;
}>> {
  const indent = '  '.repeat(depth);
  
  // Prevent infinite loops from circular shortcuts
  if (processedFolders.has(folderId)) {
    console.log(`${indent}⚠️ Skipping already processed folder: ${folderId}`);
    return [];
  }
  processedFolders.add(folderId);

  console.log(`${indent}📁 Scanning folder: ${folderId} (depth: ${depth})`);

  const drive = getDriveClient();
  const allFiles: Array<{
    id: string;
    name: string;
    mimeType: string;
    webViewLink: string;
    size?: number;
    path?: string;
  }> = [];

  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, webViewLink, size, shortcutDetails)',
      spaces: 'drive',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'allDrives',
    });

    const items = response.data.files || [];
    console.log(`${indent}   Found ${items.length} item(s) in this folder`);
    
    for (const item of items) {
      const mimeType = item.mimeType!;
      
      // Handle shortcuts
      if (mimeType === 'application/vnd.google-apps.shortcut') {
        const targetId = item.shortcutDetails?.targetId;
        const targetMimeType = item.shortcutDetails?.targetMimeType;
        
        console.log(`${indent}   🔗 Shortcut found: "${item.name}" (type: ${targetMimeType || 'unknown'})`);
        
        if (!targetId) {
          console.log(`${indent}      ❌ No target ID, skipping`);
          continue;
        }
        
        // If shortcut points to a folder, recursively scan it
        if (targetMimeType === 'application/vnd.google-apps.folder') {
          console.log(`${indent}      ✓ Following to folder: ${targetId}`);
          const subFiles = await listFilesRecursively(targetId, processedFolders, depth + 1);
          allFiles.push(...subFiles.map(f => ({
            ...f,
            path: `${item.name}/${f.path || f.name}`,
          })));
        } else {
          // Shortcut to a file - add the target file
          console.log(`${indent}      ✓ Adding file target`);
          allFiles.push({
            id: targetId,
            name: item.name!,
            mimeType: targetMimeType!,
            webViewLink: item.webViewLink!,
            size: item.size ? parseInt(item.size) : undefined,
          });
        }
      }
      // Handle regular folders - recursively scan
      else if (mimeType === 'application/vnd.google-apps.folder') {
        console.log(`${indent}   📁 Subfolder: "${item.name}"`);
        const subFiles = await listFilesRecursively(item.id!, processedFolders, depth + 1);
        allFiles.push(...subFiles.map(f => ({
          ...f,
          path: `${item.name}/${f.path || f.name}`,
        })));
      }
      // Regular file - add it
      else {
        console.log(`${indent}   📄 File: "${item.name}" (${mimeType})`);
        allFiles.push({
          id: item.id!,
          name: item.name!,
          mimeType: mimeType,
          webViewLink: item.webViewLink!,
          size: item.size ? parseInt(item.size) : undefined,
        });
      }
    }
    
    console.log(`${indent}   ✓ Total files collected from this level: ${allFiles.length}`);
  } catch (error) {
    console.error(`${indent}   ❌ Error listing files in folder ${folderId}:`, error);
  }

  return allFiles;
}

/**
 * "Delete" a folder by moving it to Google Drive Trash.
 * This matches user expectations and avoids requiring hard-delete permissions.
 */
export async function deleteDriveFolder(folderId: string): Promise<void> {
  const drive = getDriveClient();

  // Preflight: check if all direct children are trashaable by this service account.
  // If any child is not trashaable, moving the parent to trash may fail.
  const childrenResponse = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,capabilities/canTrash)',
    spaces: 'drive',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'allDrives',
  });

  const blockedChildren = (childrenResponse.data.files || []).filter(
    (f: any) => f.capabilities?.canTrash === false
  );

  if (blockedChildren.length > 0) {
    const blockedSummary = blockedChildren
      .slice(0, 5)
      .map((f: any) => `${f.name || 'Unnamed'} (${f.id})`)
      .join(', ');
    throw new Error(
      `Insufficient Drive trash permissions on ${blockedChildren.length} child file(s). ` +
      `Share those files with the service account as Editor or remove them from the folder first. ` +
      `Blocked: ${blockedSummary}`
    );
  }
  
  await drive.files.update({
    fileId: folderId,
    requestBody: { trashed: true },
    supportsAllDrives: true,
  });

  try {
    await drive.files.get({
      fileId: folderId,
      fields: 'id, trashed',
      supportsAllDrives: true,
    });
  } catch (verifyError: any) {
    // Folder may become inaccessible after trash based on permissions/visibility.
  }
}

export async function validateFolderAccess(folderId: string): Promise<{
  serviceAccountEmail: string;
  folder: {
    id: string;
    name: string;
    driveId?: string;
    canEdit?: boolean;
    canDelete?: boolean;
    canTrash?: boolean;
    owners?: string[];
  };
  children: Array<{
    id: string;
    name: string;
    canEdit?: boolean;
    canDelete?: boolean;
    canTrash?: boolean;
  }>;
  blockedChildren: Array<{ id: string; name: string }>;
  summary: {
    totalChildren: number;
    blockedChildCount: number;
    scope: string;
  };
  diagnostics: {
    folderPermissions?: Array<{ emailAddress?: string; role?: string; type?: string }>;
    blockedFilePermissions?: Record<string, Array<{ emailAddress?: string; role?: string; type?: string }>>;
  };
}> {
  const drive = getDriveClient();
  const configuredScope = process.env.GOOGLE_DRIVE_SCOPE?.trim();
  const activeScope = configuredScope || 'https://www.googleapis.com/auth/drive';
  const serviceAccountEmail = process.env.GOOGLE_CLIENT_EMAIL || 'unknown';

  const folderResponse = await drive.files.get({
    fileId: folderId,
    fields: 'id,name,driveId,owners(emailAddress),capabilities(canEdit,canDelete,canTrash)',
    supportsAllDrives: true,
  });

  const childrenResponse = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,capabilities(canEdit,canDelete,canTrash))',
    spaces: 'drive',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'allDrives',
  });

  const children = (childrenResponse.data.files || []).map((f: any) => ({
    id: f.id as string,
    name: f.name as string,
    canEdit: f.capabilities?.canEdit,
    canDelete: f.capabilities?.canDelete,
    canTrash: f.capabilities?.canTrash,
  }));

  const blockedChildren = children
    .filter((f) => f.canTrash === false)
    .map((f) => ({ id: f.id, name: f.name }));

  // Best-effort permission diagnostics (can fail depending on Drive visibility settings)
  let folderPermissions: Array<{ emailAddress?: string; role?: string; type?: string }> | undefined;
  const blockedFilePermissions: Record<string, Array<{ emailAddress?: string; role?: string; type?: string }>> = {};

  try {
    const folderPerms = await drive.permissions.list({
      fileId: folderId,
      fields: 'permissions(emailAddress,role,type)',
      supportsAllDrives: true,
    });
    folderPermissions = (folderPerms.data.permissions || []).map((p: any) => ({
      emailAddress: p.emailAddress,
      role: p.role,
      type: p.type,
    }));
  } catch {
    folderPermissions = undefined;
  }

  for (const blocked of blockedChildren.slice(0, 5)) {
    try {
      const filePerms = await drive.permissions.list({
        fileId: blocked.id,
        fields: 'permissions(emailAddress,role,type)',
        supportsAllDrives: true,
      });
      blockedFilePermissions[blocked.id] = (filePerms.data.permissions || []).map((p: any) => ({
        emailAddress: p.emailAddress,
        role: p.role,
        type: p.type,
      }));
    } catch {
      blockedFilePermissions[blocked.id] = [];
    }
  }

  return {
    serviceAccountEmail,
    folder: {
      id: folderResponse.data.id || folderId,
      name: folderResponse.data.name || 'Unknown',
      driveId: folderResponse.data.driveId || undefined,
      canEdit: folderResponse.data.capabilities?.canEdit,
      canDelete: folderResponse.data.capabilities?.canDelete,
      canTrash: folderResponse.data.capabilities?.canTrash,
      owners: (folderResponse.data.owners || [])
        .map((o) => o.emailAddress)
        .filter((v): v is string => Boolean(v)),
    },
    children,
    blockedChildren,
    summary: {
      totalChildren: children.length,
      blockedChildCount: blockedChildren.length,
      scope: activeScope,
    },
    diagnostics: {
      folderPermissions,
      blockedFilePermissions,
    },
  };
}

/**
 * Move a folder to an "Archived Diligence" folder
 */
export async function moveDriveFolderToArchive(folderId: string, companyName: string): Promise<void> {
  const drive = getDriveClient();
  
  // Get environment-specific root folder
  const envRootFolderId = await getEnvironmentRootFolder();

  // Check if "Archived Diligence" folder exists, create if not
  const archiveFolderName = 'Archived Diligence';
  const searchResponse = await drive.files.list({
    q: `name='${archiveFolderName}' and '${envRootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    corpora: 'allDrives',
  });

  let archiveFolderId: string;
  if (searchResponse.data.files && searchResponse.data.files.length > 0) {
    archiveFolderId = searchResponse.data.files[0].id!;
    console.log(`Using existing archive folder: ${archiveFolderId}`);
  } else {
    archiveFolderId = await createFolder(archiveFolderName, envRootFolderId);
    console.log(`Created archive folder: ${archiveFolderId}`);
  }

  // Get current folder details to find its current parent
  const folderDetails = await drive.files.get({
    fileId: folderId,
    fields: 'parents',
    supportsAllDrives: true,
  });

  const previousParents = folderDetails.data.parents?.join(',') || '';

  // Move the folder to archive by updating its parent
  await drive.files.update({
    fileId: folderId,
    addParents: archiveFolderId,
    removeParents: previousParents,
    supportsAllDrives: true,
  });

  console.log(`Moved folder ${folderId} to archive`);
}

/**
 * Check if Google Drive is configured
 */
export function isGoogleDriveConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.GOOGLE_DRIVE_FOLDER_ID
  );
}
