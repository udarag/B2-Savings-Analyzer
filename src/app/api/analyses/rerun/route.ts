import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { storageErrorResponse } from '@/lib/api/route-helpers';
import { rerunAllAnalyses } from '@/lib/analysis/rerun';

export async function POST() {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await rerunAllAnalyses(userEmail);
    return NextResponse.json(result, {
      status: result.failed > 0 ? 207 : 200,
    });
  } catch (error) {
    return storageErrorResponse(error, 'Failed to rerun analyses');
  }
}
