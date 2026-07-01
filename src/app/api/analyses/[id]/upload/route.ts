import { NextResponse } from 'next/server';
import {
  getAnalysisMeta,
  saveAnalysisMeta,
  saveParsedBill,
  saveModelConfig,
  uploadFile,
} from '@/lib/storage/storage';
import { getSessionUser } from '@/lib/auth/session';
import { storageErrorResponse } from '@/lib/api/route-helpers';
import { detectAndParse } from '@/lib/parsers/detect';
import { buildTierState } from '@/lib/analysis/analysis-model';
import { createOverdriveVariant } from '@/lib/analysis/variant';
import { DEFAULT_MODEL_CONFIG } from '@/types/analysis';

/**
 * Upload a customer's cloud bill into an existing analysis: store the raw file, parse it into a
 * bill, then seed the detected metadata and a default tier-selection model config. Returns the
 * parsed bill plus the initial tier state for the dashboard to render immediately.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let meta;
  try {
    meta = await getAnalysisMeta(userEmail, id);
  } catch (error) {
    return storageErrorResponse(error, `Failed to load analysis ${id}`);
  }
  if (!meta) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
  }

  // Store the original upload before parsing, so a parse failure still retains the file.
  try {
    await uploadFile(userEmail, id, file.name, buffer, file.type);
  } catch (error) {
    return storageErrorResponse(error, `Failed to store upload for ${id}`);
  }

  let result: ReturnType<typeof detectAndParse>;
  try {
    result = detectAndParse({
      filename: file.name,
      content: buffer,
      mimeType: file.type,
    });
  } catch (error) {
    // Log the real parse error server-side for triage, but return a generic 422 — the underlying
    // message can reference internal parser/file details we don't want to surface to the client.
    console.error(`Failed to parse uploaded bill for ${id}:`, error);
    return NextResponse.json(
      { error: 'Could not parse the uploaded bill. Check the file format and try again.' },
      { status: 422 },
    );
  }

  try {
    await saveParsedBill(userEmail, id, result.parsedBill);

    // Overwrite the seed metadata from create-time with what the parser actually detected — the
    // detected provider/billType are authoritative over the AE's initial guess.
    meta.provider = result.provider;
    meta.billType = result.billType;
    meta.billingPeriod = result.billingPeriod;
    meta.accountId = result.accountId;
    meta.detectionSignals = result.detectionSignals;
    meta.updatedAt = new Date().toISOString();
    await saveAnalysisMeta(userEmail, id, meta);

    // Derive the initial tier inventory + model config (default migrate-all selection, default
    // pricing) from the freshly parsed bill so the dashboard has something to render right away.
    const { tiers, modelConfig } = buildTierState(result.parsedBill, DEFAULT_MODEL_CONFIG);
    await saveModelConfig(userEmail, id, modelConfig);

    // Fulfill a "also create an Overdrive variant" checkbox ticked at New Opportunity creation:
    // this is the first point a parsed bill exists to clone. Best-effort — a clone failure here
    // shouldn't fail the upload the AE is actually waiting on.
    let overdriveVariant = null;
    if (meta.pendingOverdriveVariant) {
      try {
        overdriveVariant = await createOverdriveVariant(userEmail, id);
        // createOverdriveVariant wrote these onto the original's stored meta; mirror them onto the
        // in-memory copy so this response reflects the link without a second read-back.
        meta.linkedAnalysisId = overdriveVariant.id;
        meta.serviceTierVariant = meta.serviceTierVariant ?? 'standard';
        meta.pendingOverdriveVariant = undefined;
      } catch (error) {
        console.error(`Failed to auto-create Overdrive variant for ${id}:`, error);
      }
    }

    return NextResponse.json({
      parsed: result.parsedBill,
      meta,
      modelConfig,
      tiers,
      overdriveVariant,
    });
  } catch (error) {
    return storageErrorResponse(error, `Failed to save parsed analysis ${id}`);
  }
}
