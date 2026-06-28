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
import { getSessionUser } from '@/lib/auth/session';
import { storageErrorResponse } from '@/lib/api/route-helpers';
import type { ModelConfig } from '@/types/analysis';

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
    const [meta, parsed, modelConfig] = await Promise.all([
      getAnalysisMeta(userEmail, id),
      getParsedBill(userEmail, id),
      getModelConfig(userEmail, id),
    ]);

    if (!meta) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ meta, parsed, modelConfig });
  } catch (error) {
    return storageErrorResponse(error, `Failed to load analysis ${id}`);
  }
}

export async function PATCH(
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
  } catch (error) {
    return storageErrorResponse(error, `Failed to update analysis ${id}`);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  try {
    await deleteAnalysis(userEmail, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return storageErrorResponse(error, `Failed to delete analysis ${id}`);
  }
}
