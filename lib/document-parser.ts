import mammoth from 'mammoth';
import AdmZip from 'adm-zip';
import { parseStringPromise } from 'xml2js';
import * as XLSX from 'xlsx';
import { extractTextWithGoogleDriveOcr } from '@/lib/google-drive';

const UNREADABLE_DOC_PATTERNS = [
  /\[pdf was parsed but contains minimal extractable text/i,
  /\[pdf parsing failed:/i,
  /\[document could not be parsed\]/i,
  /\[image file - text extraction not available/i,
  /\[excel parsing error:/i,
  /\[powerpoint file appears to be empty/i,
  /\[docx appears to be empty\]/i,
];

export function isUnreadableExtractedText(text?: string): boolean {
  const value = String(text || '').trim();
  if (!value) return true;
  return UNREADABLE_DOC_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Parse various document formats and extract text
 * Updated to use dynamic imports for better module compatibility
 */
export async function parseDocument(
  buffer: Buffer,
  fileType: string
): Promise<string> {
  const extension = fileType.toLowerCase().replace('.', '');

  switch (extension) {
    case 'pdf':
      return await parsePDF(buffer);
    case 'docx':
      return await parseDOCX(buffer);
    case 'pptx':
    case 'ppt':
      return await parsePPTX(buffer);
    case 'xlsx':
    case 'xls':
    case 'csv':
      return await parseExcel(buffer, extension);
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return await parseImageWithOcrFallback(buffer, extension);
    case 'txt':
      return buffer.toString('utf-8');
    default:
      throw new Error(`Unsupported file type: ${extension}`);
  }
}

/**
 * Parse PDF document
 */
async function parsePDF(buffer: Buffer): Promise<string> {
  const extractedText = await parsePdfWithPdf2Json(buffer);
  if (extractedText.length >= 50) {
    console.log(`Successfully extracted ${extractedText.length} characters from PDF`);
    return extractedText;
  }
  const ocrText = await extractTextWithGoogleDriveOcr(buffer, 'application/pdf', 'uploaded_pdf');
  if (ocrText && ocrText.trim().length >= 80) {
    console.log(`Recovered ${ocrText.length} characters via Google Drive OCR fallback`);
    return ocrText.trim();
  }
  console.warn('PDF parsing returned minimal or no text after OCR fallback. Text length:', extractedText.length);
  return '[PDF was parsed but contains minimal extractable text. The document may be image-based or encrypted.]';
}

async function parsePdfWithPdf2Json(buffer: Buffer): Promise<string> {
  try {
    // Use pdf2json which works better with Next.js
    const PDFParser = require('pdf2json');
    
    return new Promise((resolve, reject) => {
      const pdfParser = new PDFParser();
      
      pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
        try {
          // Extract text from all pages
          let text = '';
          if (pdfData?.Pages) {
            for (const page of pdfData.Pages) {
              if (page.Texts) {
                for (const textItem of page.Texts) {
                  if (textItem.R) {
                    for (const run of textItem.R) {
                      if (run.T) {
                        // Decode URI-encoded text, but keep raw text if malformed encoding appears
                        try {
                          text += decodeURIComponent(run.T) + ' ';
                        } catch {
                          text += String(run.T) + ' ';
                        }
                      }
                    }
                  }
                }
                text += '\n';
              }
            }
          }
          
          const extractedText = text.trim();
          resolve(extractedText);
        } catch (err) {
          reject(err);
        }
      });
      
      pdfParser.on('pdfParser_dataError', (errData: any) => {
        reject(new Error(errData?.parserError || 'PDF parsing failed'));
      });
      
      // Parse the buffer
      pdfParser.parseBuffer(buffer);
    });
  } catch (error) {
    console.error('Error parsing PDF with pdf2json:', error);
    return '';
  }
}

async function parseImageWithOcrFallback(buffer: Buffer, extension: string): Promise<string> {
  const mimeType = extension === 'png'
    ? 'image/png'
    : extension === 'gif'
      ? 'image/gif'
      : extension === 'webp'
        ? 'image/webp'
        : 'image/jpeg';
  const ocrText = await extractTextWithGoogleDriveOcr(buffer, mimeType, `uploaded_image.${extension}`);
  if (ocrText && ocrText.trim().length >= 30) {
    return ocrText.trim();
  }
  return '[Image file - text extraction not available. Consider adding text description manually.]';
}

/**
 * Parse DOCX document
 */
async function parseDOCX(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '[DOCX appears to be empty]';
  } catch (error) {
    console.error('Error parsing DOCX:', error);
    throw new Error('Failed to parse DOCX document');
  }
}

/**
 * Parse PPTX document
 * PPTX files are ZIP archives containing XML files
 */
async function parsePPTX(buffer: Buffer): Promise<string> {
  try {
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();

    const textContent: string[] = [];

    // Extract text from all slide XML files
    for (const entry of zipEntries) {
      if (entry.entryName.match(/ppt\/slides\/slide\d+\.xml/)) {
        const xmlContent = entry.getData().toString('utf8');
        const text = await extractTextFromSlideXML(xmlContent);
        if (text) {
          textContent.push(text);
        }
      }
    }

    if (textContent.length === 0) {
      return '[PowerPoint file appears to be empty or could not be parsed]';
    }

    return textContent.join('\n\n---\n\n');
  } catch (error) {
    console.error('Error parsing PPTX:', error);
    throw new Error('Failed to parse PowerPoint document');
  }
}

/**
 * Extract text from PowerPoint slide XML
 */
async function extractTextFromSlideXML(xmlContent: string): Promise<string> {
  try {
    const parsed = await parseStringPromise(xmlContent);
    const texts: string[] = [];

    // Recursively extract all text elements
    const extractText = (obj: any) => {
      if (typeof obj === 'string') {
        texts.push(obj);
      } else if (Array.isArray(obj)) {
        obj.forEach(extractText);
      } else if (obj && typeof obj === 'object') {
        // Look for 'a:t' (text) elements in PowerPoint XML
        if (obj['a:t']) {
          if (Array.isArray(obj['a:t'])) {
            obj['a:t'].forEach((t: any) => {
              if (typeof t === 'string') texts.push(t);
            });
          } else if (typeof obj['a:t'] === 'string') {
            texts.push(obj['a:t']);
          }
        }
        Object.values(obj).forEach(extractText);
      }
    };

    extractText(parsed);

    return texts.join(' ').trim();
  } catch (error) {
    console.error('Error extracting text from slide XML:', error);
    return '';
  }
}

/**
 * Get supported file extensions
 */
export function getSupportedExtensions(): string[] {
  return ['pdf', 'docx', 'pptx', 'ppt', 'xlsx', 'xls', 'csv', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp'];
}

/**
 * Validate file type
 */
export function isFileTypeSupported(fileName: string): boolean {
  const extension = fileName.split('.').pop()?.toLowerCase();
  return extension ? getSupportedExtensions().includes(extension) : false;
}

/**
 * Parse Excel/CSV files
 */
async function parseExcel(buffer: Buffer, extension: string): Promise<string> {
  try {
    let workbook;
    
    if (extension === 'csv') {
      // Parse CSV
      const csvText = buffer.toString('utf-8');
      workbook = XLSX.read(csvText, { type: 'string' });
    } else {
      // Parse Excel (xlsx, xls)
      workbook = XLSX.read(buffer, { type: 'buffer' });
    }

    const allSheetText: string[] = [];

    // Process each sheet
    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      
      // Convert sheet to CSV format for structured text
      const csvText = XLSX.utils.sheet_to_csv(sheet);
      
      allSheetText.push(`\n=== Sheet: ${sheetName} ===\n${csvText}`);
    });

    const fullText = allSheetText.join('\n\n');
    
    if (!fullText.trim()) {
      return '[Excel file appears to be empty or could not be parsed]';
    }

    return fullText;
  } catch (error) {
    console.error('Error parsing Excel:', error);
    return `[Excel parsing error: ${error instanceof Error ? error.message : 'Unknown error'}]`;
  }
}

/**
 * Get MIME type from file extension
 */
export function getMimeType(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase();

  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppt: 'application/vnd.ms-powerpoint',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    csv: 'text/csv',
    txt: 'text/plain',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  };

  return mimeTypes[extension || ''] || 'application/octet-stream';
}
