import { NextResponse } from 'next/server';
import {
  getAnalysisMeta,
  getParsedBill,
  getModelConfig,
  saveAnalysisMeta,
  saveModelConfig,
  saveParsedBill,
  deleteAnalysis,
} from '@/lib/storage/storage';
import { requireUser } from '@/lib/auth/session';
import type { ModelConfig } from '@/types/analysis';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await requireUser();
  const { id } = await params;
  const [meta, parsed, modelConfig] = await Promise.all([
    getAnalysisMeta(userEmail, id),
    getParsedBill(userEmail, id),
    getModelConfig(userEmail, id),
  ]);

  if (!meta) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ meta, parsed, modelConfig });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await requireUser();
  const { id } = await params;
  const body = await req.json();

  if (body.meta) {
    const existing = await getAnalysisMeta(userEmail, id);
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await saveAnalysisMeta(userEmail, id, {
      ...existing,
      ...body.meta,
      updatedAt: new Date().toISOString(),
    });
  }

  if (body.parsed) {
    await saveParsedBill(userEmail, id, body.parsed);
  }

  if (body.modelConfig) {
    await saveModelConfig(userEmail, id, body.modelConfig as ModelConfig);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await requireUser();
  const { id } = await params;
  await deleteAnalysis(userEmail, id);
  return NextResponse.json({ ok: true });
}
