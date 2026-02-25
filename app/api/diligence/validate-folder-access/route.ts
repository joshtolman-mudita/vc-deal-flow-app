import { NextRequest, NextResponse } from 'next/server';
import { validateFolderAccess } from '@/lib/google-drive';

/**
 * GET /api/diligence/validate-folder-access?folderId=xxx
 * Returns Drive capability checks for folder and child files.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const folderId = searchParams.get('folderId');

    if (!folderId) {
      return NextResponse.json(
        { success: false, error: 'folderId query parameter required' },
        { status: 400 }
      );
    }

    const result = await validateFolderAccess(folderId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to validate folder access',
      },
      { status: 500 }
    );
  }
}
