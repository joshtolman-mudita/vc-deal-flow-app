import { NextResponse } from 'next/server';
import { clearCriteriaCache } from '@/lib/google-sheets';

/**
 * POST /api/diligence/criteria/refresh - Clear in-memory criteria cache
 */
export async function POST() {
  try {
    clearCriteriaCache();
    return NextResponse.json({
      success: true,
      message: 'Diligence criteria cache refreshed.',
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error refreshing criteria cache:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to refresh criteria cache',
      },
      { status: 500 }
    );
  }
}
