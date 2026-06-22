import { NextResponse } from 'next/server';
import {
  getAnalysisMeta,
  saveAnalysisMeta,
  saveParsedBill,
  saveModelConfig,
  uploadFile,
} from '@/lib/storage/storage';
import { requireUser } from '@/lib/auth/session';
import { detectAndParse } from '@/lib/parsers/detect';
import { buildTierInventory } from '@/lib/engine/tier-inventory';
import { DEFAULT_MODEL_CONFIG, TIER_SELECTION_VERSION } from '@/types/analysis';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await requireUser();
  const { id } = await params;

  const meta = await getAnalysisMeta(userEmail, id);
  if (!meta) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  await uploadFile(userEmail, id, file.name, buffer, file.type);

  const result = detectAndParse({
    filename: file.name,
    content: buffer,
    mimeType: file.type,
  });

  await saveParsedBill(userEmail, id, result.parsedBill);

  meta.provider = result.provider;
  meta.billType = result.billType;
  meta.billingPeriod = result.billingPeriod;
  meta.accountId = result.accountId;
  meta.detectionSignals = result.detectionSignals;
  meta.updatedAt = new Date().toISOString();
  await saveAnalysisMeta(userEmail, id, meta);

  const tiers = buildTierInventory(result.parsedBill.lineItems);
  const tierToggles: Record<string, boolean> = {};
  for (const tier of tiers) {
    tierToggles[tier.id] = tier.migrateToB2;
  }

  const modelConfig = {
    ...DEFAULT_MODEL_CONFIG,
    tierToggles,
    tierSelectionVersion: TIER_SELECTION_VERSION,
  };
  await saveModelConfig(userEmail, id, modelConfig);

  return NextResponse.json({
    parsed: result.parsedBill,
    meta,
    modelConfig,
    tiers,
  });
}
