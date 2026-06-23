import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { rerunAllAnalyses } from '@/lib/analysis/rerun';

export async function POST() {
  const userEmail = await requireUser();
  const result = await rerunAllAnalyses(userEmail);

  return NextResponse.json(result, {
    status: result.failed > 0 ? 207 : 200,
  });
}
