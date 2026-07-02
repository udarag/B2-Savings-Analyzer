import { NextResponse } from 'next/server';
import { getAnalysisMeta, getB2UsageInput, saveB2UsageInput } from '@/lib/storage/storage';
import { getSessionUser } from '@/lib/auth/session';
import { storageErrorResponse } from '@/lib/api/route-helpers';
import type { B2UsageInput } from '@/types/analysis';

/** Load the saved B2 usage input for a commit-upsell analysis. Null until the AE fills in the form. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  try {
    const usage = await getB2UsageInput(userEmail, id);
    return NextResponse.json({ usage });
  } catch (error) {
    return storageErrorResponse(error, `Failed to load B2 usage input for ${id}`);
  }
}

/** Save the AE-entered B2 usage input (current storage/spend, growth, target tier). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const meta = await getAnalysisMeta(userEmail, id);
    if (!meta) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const existing = await getB2UsageInput(userEmail, id);
    const usage: B2UsageInput = {
      currentStorageTb: Number(body.currentStorageTb) || 0,
      currentMonthlySpendUsd: Number(body.currentMonthlySpendUsd) || 0,
      dataGrowthMode: body.dataGrowthMode === 'fixed-tb' ? 'fixed-tb' : 'percent',
      dataGrowthRatePercent: Number(body.dataGrowthRatePercent) || 0,
      dataGrowthFixedTbPerMonth: Number(body.dataGrowthFixedTbPerMonth) || 0,
      dataGrowthPeriod: body.dataGrowthPeriod === 'monthly' ? 'monthly' : 'yearly',
      targetTier: 'committed', // commit-upsell always targets Committed; Overdrive isn't part of this flow
      committedDiscountPercent: Number(body.committedDiscountPercent) || 0,
      contractTermMonths: Number(body.contractTermMonths) || 12,
      source: 'manual',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await saveB2UsageInput(userEmail, id, usage);
    return NextResponse.json({ usage });
  } catch (error) {
    return storageErrorResponse(error, `Failed to save B2 usage input for ${id}`);
  }
}
