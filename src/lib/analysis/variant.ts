import { v4 as uuid } from 'uuid';
import {
  getAnalysisMeta,
  getParsedBill,
  getModelConfig,
  saveAnalysisMeta,
  saveParsedBill,
  saveModelConfig,
} from '@/lib/storage/storage';
import { getServiceTierSpec } from '@/lib/pricing/service-levels';
import type { Analysis, ModelConfig } from '@/types/analysis';

/** Thrown by createOverdriveVariant for the two expected failure cases, carrying the HTTP status
 *  the caller should respond with. */
export class OverdriveVariantError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'OverdriveVariantError';
  }
}

/**
 * Clone a fully-parsed analysis into a second, linked opportunity modeled at B2 Overdrive
 * pricing, so an AE can hand a customer a Standard report and an Overdrive report side by side.
 * Shared by the New Opportunity upload flow (automatic, when the AE checked the box at creation)
 * and the dedicated API route (for triggering it later on an existing analysis).
 */
export async function createOverdriveVariant(userEmail: string, sourceId: string): Promise<Analysis> {
  const [meta, parsed, modelConfig] = await Promise.all([
    getAnalysisMeta(userEmail, sourceId),
    getParsedBill(userEmail, sourceId),
    getModelConfig(userEmail, sourceId),
  ]);

  if (!meta) {
    throw new OverdriveVariantError('Analysis not found', 404);
  }
  if (!parsed || !modelConfig) {
    throw new OverdriveVariantError('Analysis has no parsed bill yet', 400);
  }

  const newId = uuid();
  const now = new Date().toISOString();

  const newModelConfig: ModelConfig = {
    ...modelConfig,
    b2ServiceTier: 'overdrive',
    b2PricePerTb: getServiceTierSpec('overdrive').startingPerTbMonth ?? modelConfig.b2PricePerTb,
    // Reset: this was confirmed against the Standard price, not Overdrive's.
    pricingDiscountConfirmed: false,
  };

  const newMeta: Analysis = {
    ...meta,
    id: newId,
    // No "(Copy)" rename — same deal, distinguished by the tag rather than the name.
    serviceTierVariant: 'overdrive',
    linkedAnalysisId: sourceId,
    pendingOverdriveVariant: undefined,
    createdAt: now,
    updatedAt: now,
  };

  // The original didn't know its sibling's id when it was first created, so link it back here.
  const updatedSourceMeta: Analysis = {
    ...meta,
    linkedAnalysisId: newId,
    serviceTierVariant: meta.serviceTierVariant ?? 'standard',
    pendingOverdriveVariant: undefined,
    updatedAt: now,
  };

  await Promise.all([
    saveAnalysisMeta(userEmail, newId, newMeta),
    saveParsedBill(userEmail, newId, parsed),
    saveModelConfig(userEmail, newId, newModelConfig),
    saveAnalysisMeta(userEmail, sourceId, updatedSourceMeta),
  ]);

  return newMeta;
}
