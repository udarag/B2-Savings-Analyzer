import { NextResponse } from 'next/server';
import { v4 as uuid } from 'uuid';
import { saveReportSnapshot, listReportSnapshots } from '@/lib/storage/storage';
import { requireUser } from '@/lib/auth/session';
import type { ReportSnapshot } from '@/types/model';
import { DEFAULT_EGRESS_CONFIG } from '@/types/analysis';
import b2Pricing from '@/lib/pricing/b2.json';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await requireUser();
  const { id } = await params;
  const body = await req.json();
  const growthRatePercent = readNumber(body.growthRatePercent, DEFAULT_EGRESS_CONFIG.dataGrowthRatePercent);
  const growthFixedTbPerMonth = readNumber(body.growthFixedTbPerMonth, DEFAULT_EGRESS_CONFIG.dataGrowthFixedTbPerMonth);

  const snapshot: ReportSnapshot = {
    id: uuid(),
    analysisId: id,
    createdAt: new Date().toISOString(),
    trigger: body.trigger || 'report-view',
    monthlySavings: body.monthlySavings ?? 0,
    annualSavings: body.annualSavings ?? 0,
    savingsPercent: body.savingsPercent ?? 0,
    totalStorageGb: body.totalStorageGb ?? 0,
    migratedTierCount: body.migratedTierCount ?? 0,
    b2PricePerTb: body.b2PricePerTb ?? b2Pricing.storage.perTbMonth,
    termMonths: body.termMonths ?? 12,
    growthMode: body.growthMode === 'fixed-tb' ? 'fixed-tb' : DEFAULT_EGRESS_CONFIG.dataGrowthMode,
    growthRatePercent,
    growthFixedTbPerMonth,
    udmEnabled: body.udmEnabled ?? false,
  };

  await saveReportSnapshot(userEmail, id, snapshot);
  return NextResponse.json(snapshot, { status: 201 });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await requireUser();
  const { id } = await params;
  const snapshots = await listReportSnapshots(userEmail, id);
  return NextResponse.json(snapshots);
}

function readNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
