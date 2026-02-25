import { NextRequest, NextResponse } from 'next/server';
import { loadDiligenceRecord, updateDiligenceRecord } from '@/lib/diligence-storage';
import { Founder } from '@/types/diligence';

/**
 * POST /api/diligence/[id]/founders - Update founder information
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { founders } = body as { founders: Founder[] };

    if (!id) {
      return NextResponse.json(
        { error: 'Diligence ID is required', success: false },
        { status: 400 }
      );
    }

    // Load the record
    const record = await loadDiligenceRecord(id);
    if (!record) {
      return NextResponse.json(
        { error: 'Diligence record not found', success: false },
        { status: 404 }
      );
    }

    // Validate founders data
    const validFounders = founders
      .filter(f => f.name && f.name.trim())
      .map(f => ({
        name: f.name.trim(),
        linkedinUrl: f.linkedinUrl?.trim() || undefined,
        title: f.title?.trim() || undefined,
      }));

    // Update the record
    const updatedRecord = await updateDiligenceRecord(id, {
      founders: validFounders.length > 0 ? validFounders : undefined,
    });

    return NextResponse.json({
      success: true,
      record: updatedRecord,
    });

  } catch (error) {
    console.error('Error updating founders:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update founders',
        success: false,
      },
      { status: 500 }
    );
  }
}
