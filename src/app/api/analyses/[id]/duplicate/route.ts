import { NextResponse } from 'next/server';
import { v4 as uuid } from 'uuid';
import {
  getAnalysisMeta,
  getParsedBill,
  getModelConfig,
  saveAnalysisMeta,
  saveParsedBill,
  saveModelConfig,
} from '@/lib/storage/storage';
import { requireUser } from '@/lib/auth/session';

export async function POST(
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

  const newId = uuid();
  const now = new Date().toISOString();
  const newMeta = {
    ...meta,
    id: newId,
    prospectName: `${meta.prospectName} (Copy)`,
    createdAt: now,
    updatedAt: now,
  };

  await saveAnalysisMeta(userEmail, newId, newMeta);
  if (parsed) await saveParsedBill(userEmail, newId, parsed);
  if (modelConfig) await saveModelConfig(userEmail, newId, modelConfig);

  return NextResponse.json(newMeta, { status: 201 });
}
