import { NextResponse } from 'next/server';
import { v4 as uuid } from 'uuid';
import { saveReportSnapshot, listReportSnapshots } from '@/lib/storage/storage';
import { requireUser } from '@/lib/auth/session';
import type { ReportSnapshot } from '@/types/model';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await requireUser();
  const { id } = await params;
  const body = await req.json();

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
    b2PricePerTb: body.b2PricePerTb ?? 6.95,
    termMonths: body.termMonths ?? 36,
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
