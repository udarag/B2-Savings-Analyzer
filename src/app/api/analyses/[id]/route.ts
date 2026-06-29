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

/** Load one analysis in full: metadata, parsed bill, and saved model config. */
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
    // parsed/modelConfig may be null for a freshly created analysis with no bill yet; only missing
    // metadata counts as a 404.
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

/**
 * Partially update an analysis. Each of `meta`, `parsed`, and `modelConfig` in the body is optional
 * and applied independently, so the client can save just the slice it changed (e.g. an edited tier
 * selection) without resending the rest.
 */
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
      // Merge onto the stored record (not a blind overwrite) so the client can send only changed
      // fields; updatedAt is always refreshed and the incoming patch can't override it.
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

/** Delete an analysis and all its stored artifacts (bill, config, snapshots, uploaded file). */
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
