import { NextResponse } from 'next/server';
import {
  getModelConfig,
  getParsedBill,
  saveReportSnapshot,
  listReportSnapshots,
} from '@/lib/storage/storage';
import { getSessionUser } from '@/lib/auth/session';
import { storageErrorResponse } from '@/lib/api/route-helpers';
import type { ReportSnapshot } from '@/types/model';
import { buildAnalysisSnapshot } from '@/lib/analysis/rerun';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  let body: { trigger?: ReportSnapshot['trigger'] } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const trigger = body.trigger === 'pdf-download' || body.trigger === 'analysis-rerun'
    ? body.trigger
    : 'report-view';

  try {
    const [parsed, modelConfig] = await Promise.all([
      getParsedBill(userEmail, id),
      getModelConfig(userEmail, id),
    ]);

    if (!parsed) {
      return NextResponse.json({ error: 'Parsed bill not found' }, { status: 404 });
    }

    const { snapshot } = buildAnalysisSnapshot({
      analysisId: id,
      parsed,
      modelConfig,
      trigger,
    });

    await saveReportSnapshot(userEmail, id, snapshot);
    return NextResponse.json(snapshot, { status: 201 });
  } catch (error) {
    return storageErrorResponse(error, `Failed to save snapshot for ${id}`);
  }
}

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
    const snapshots = await listReportSnapshots(userEmail, id);
    return NextResponse.json(snapshots);
  } catch (error) {
    return storageErrorResponse(error, `Failed to list snapshots for ${id}`);
  }
}
