import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { storageErrorResponse } from '@/lib/api/route-helpers';
import { createOverdriveVariant, OverdriveVariantError } from '@/lib/analysis/variant';

/**
 * Clone an existing, fully-parsed analysis into a second, linked opportunity modeled at B2
 * Overdrive pricing. The New Opportunity upload flow calls the shared helper directly when the AE
 * opts in at creation time; this route exists for triggering the same clone later, from an
 * already-existing analysis.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  try {
    const newMeta = await createOverdriveVariant(userEmail, id);
    return NextResponse.json(newMeta, { status: 201 });
  } catch (error) {
    if (error instanceof OverdriveVariantError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return storageErrorResponse(error, `Failed to create Overdrive variant for ${id}`);
  }
}
