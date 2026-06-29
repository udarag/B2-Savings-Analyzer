import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { storageErrorResponse } from '@/lib/api/route-helpers';
import { rerunAllAnalyses } from '@/lib/analysis/rerun';

/**
 * Recompute every one of the AE's analyses — used after a pricing or model-version change (e.g. a
 * new TIER_SELECTION_VERSION) so stored snapshots reflect the current model. Returns 207
 * Multi-Status when some analyses fail, so a partial failure is distinguishable from a clean run.
 */
export async function POST() {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await rerunAllAnalyses(userEmail);
    // 207 signals "ran, but at least one analysis failed"; the body breaks down per-analysis status.
    return NextResponse.json(result, {
      status: result.failed > 0 ? 207 : 200,
    });
  } catch (error) {
    return storageErrorResponse(error, 'Failed to rerun analyses');
  }
}
