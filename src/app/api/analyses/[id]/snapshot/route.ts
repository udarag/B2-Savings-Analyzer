import { NextResponse } from 'next/server';
import {
  getModelConfig,
  getParsedBill,
  saveReportSnapshot,
  listReportSnapshots,
} from '@/lib/storage/storage';
import { requireUser } from '@/lib/auth/session';
import type { ReportSnapshot } from '@/types/model';
import { buildAnalysisSnapshot } from '@/lib/analysis/rerun';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await requireUser();
  const { id } = await params;

  let body: { trigger?: ReportSnapshot['trigger'] } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const [parsed, modelConfig] = await Promise.all([
    getParsedBill(userEmail, id),
    getModelConfig(userEmail, id),
  ]);

  if (!parsed) {
    return NextResponse.json({ error: 'Parsed bill not found' }, { status: 404 });
  }

  const trigger = body.trigger === 'pdf-download' || body.trigger === 'analysis-rerun'
    ? body.trigger
    : 'report-view';
  const { snapshot } = buildAnalysisSnapshot({
    analysisId: id,
    parsed,
    modelConfig,
    trigger,
  });

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
