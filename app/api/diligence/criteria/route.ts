import { NextResponse } from 'next/server';
import { loadDiligenceCriteria } from '@/lib/google-sheets';

export const dynamic = 'force-dynamic';

/**
 * GET /api/diligence/criteria
 * Returns current diligence criteria metadata from Google Sheets.
 */
export async function GET() {
  try {
    const criteria = await loadDiligenceCriteria();
    return NextResponse.json({
      success: true,
      criteria,
    });
  } catch (error) {
    console.error('Error loading diligence criteria:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load diligence criteria',
      },
      { status: 500 }
    );
  }
}
