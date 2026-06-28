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
import { DEFAULT_MODEL_CONFIG } from '@/types/analysis';

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
    console.error(`Failed to parse uploaded bill for ${id}:`, error);
    return NextResponse.json(
      { error: 'Could not parse the uploaded bill. Check the file format and try again.' },
      { status: 422 },
    );
  }

  try {
    await saveParsedBill(userEmail, id, result.parsedBill);

    meta.provider = result.provider;
    meta.billType = result.billType;
    meta.billingPeriod = result.billingPeriod;
    meta.accountId = result.accountId;
    meta.detectionSignals = result.detectionSignals;
    meta.updatedAt = new Date().toISOString();
    await saveAnalysisMeta(userEmail, id, meta);

    const { tiers, modelConfig } = buildTierState(result.parsedBill, DEFAULT_MODEL_CONFIG);
    await saveModelConfig(userEmail, id, modelConfig);

    return NextResponse.json({
      parsed: result.parsedBill,
      meta,
      modelConfig,
      tiers,
    });
  } catch (error) {
    return storageErrorResponse(error, `Failed to save parsed analysis ${id}`);
  }
}
