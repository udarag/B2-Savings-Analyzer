import { v4 as uuid } from 'uuid';
import {
  getLatestUploadedFile,
  getModelConfig,
  getParsedBill,
  listAnalyses,
  saveAnalysisMeta,
  saveModelConfig,
  saveParsedBill,
  saveReportSnapshot,
} from '@/lib/storage/storage';
import { detectAndParse } from '@/lib/parsers/detect';
import { computeCostModel } from '@/lib/engine/cost-model';
import { buildTierInventory } from '@/lib/engine/tier-inventory';
import { applyTierSelectionConfig } from '@/lib/engine/tier-selection';
import {
  DEFAULT_MODEL_CONFIG,
  TIER_SELECTION_VERSION,
  normalizeEgressConfig,
  type Analysis,
  type ModelConfig,
  type ParsedBill,
} from '@/types/analysis';
import type { CostModelResult, ReportSnapshot } from '@/types/model';

interface AnalysisModelRun {
  tiers: ReturnType<typeof buildTierInventory>;
  modelConfig: ModelConfig;
  costModel: CostModelResult;
}

interface BuildAnalysisSnapshotOptions {
  analysisId: string;
  parsed: ParsedBill;
  modelConfig?: ModelConfig | null;
  trigger: ReportSnapshot['trigger'];
  now?: Date;
}

export interface RerunAnalysisResult {
  analysisId: string;
  prospectName: string;
  status: 'rerun' | 'skipped' | 'failed';
  reason?: string;
  parsedUpdated?: boolean;
  modelConfigUpdated?: boolean;
  snapshot?: Pick<
    ReportSnapshot,
    | 'id'
    | 'createdAt'
    | 'monthlySavings'
    | 'annualSavings'
    | 'savingsPercent'
    | 'totalStorageGb'
    | 'migratedTierCount'
  >;
}

export interface RerunAllAnalysesResult {
  total: number;
  rerun: number;
  skipped: number;
  failed: number;
  results: RerunAnalysisResult[];
}

export function buildAnalysisSnapshot({
  analysisId,
  parsed,
  modelConfig,
  trigger,
  now = new Date(),
}: BuildAnalysisSnapshotOptions): { snapshot: ReportSnapshot; modelRun: AnalysisModelRun } {
  const modelRun = buildAnalysisModel(parsed, modelConfig);
  const migratedTiers = modelRun.tiers.filter((t) => t.migrateToB2);
  const { costModel } = modelRun;

  return {
    modelRun,
    snapshot: {
      id: uuid(),
      analysisId,
      createdAt: now.toISOString(),
      trigger,
      monthlySavings: costModel.monthlySavings,
      annualSavings: costModel.annualSavings,
      savingsPercent: costModel.savingsPercent,
      totalStorageGb: migratedTiers.reduce((sum, tier) => sum + tier.gbStored, 0),
      migratedTierCount: migratedTiers.length,
      b2PricePerTb: modelRun.modelConfig.b2PricePerTb,
      termMonths: modelRun.modelConfig.projectionTermMonths,
      growthMode: modelRun.modelConfig.egressConfig.dataGrowthMode,
      growthRatePercent: modelRun.modelConfig.egressConfig.dataGrowthRatePercent,
      growthFixedTbPerMonth: modelRun.modelConfig.egressConfig.dataGrowthFixedTbPerMonth,
      udmEnabled: modelRun.modelConfig.egressConfig.udmEnabled,
    },
  };
}

export async function rerunAllAnalyses(userEmail: string): Promise<RerunAllAnalysesResult> {
  const analyses = await listAnalyses(userEmail);
  const results: RerunAnalysisResult[] = [];

  for (const analysis of analyses) {
    results.push(await rerunStoredAnalysis(userEmail, analysis));
  }

  return {
    total: results.length,
    rerun: results.filter((result) => result.status === 'rerun').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    failed: results.filter((result) => result.status === 'failed').length,
    results,
  };
}

async function rerunStoredAnalysis(userEmail: string, analysis: Analysis): Promise<RerunAnalysisResult> {
  try {
    const [storedParsed, storedModelConfig, upload] = await Promise.all([
      getParsedBill(userEmail, analysis.id),
      getModelConfig(userEmail, analysis.id),
      getLatestUploadedFile(userEmail, analysis.id),
    ]);

    if (!storedParsed && !upload) {
      return {
        analysisId: analysis.id,
        prospectName: analysis.prospectName,
        status: 'skipped',
        reason: 'No parsed bill or uploaded bill found',
      };
    }

    let parsed = storedParsed;
    let parsedUpdated = false;
    let reason: string | undefined;

    if (upload) {
      const parseResult = detectAndParse({
        filename: upload.filename,
        content: upload.content,
        mimeType: upload.contentType,
      });
      parsed = parseResult.parsedBill;
      parsedUpdated = true;
      await Promise.all([
        saveParsedBill(userEmail, analysis.id, parsed),
        saveAnalysisMeta(userEmail, analysis.id, {
          ...analysis,
          provider: parseResult.provider,
          billType: parseResult.billType,
          billingPeriod: parseResult.billingPeriod,
          accountId: parseResult.accountId,
          detectionSignals: parseResult.detectionSignals,
        }),
      ]);
    } else {
      reason = 'No original upload found; refreshed snapshot from stored parsed bill';
    }

    if (!parsed) {
      return {
        analysisId: analysis.id,
        prospectName: analysis.prospectName,
        status: 'skipped',
        reason: 'No parsed bill found',
      };
    }

    const { snapshot, modelRun } = buildAnalysisSnapshot({
      analysisId: analysis.id,
      parsed,
      modelConfig: storedModelConfig,
      trigger: 'analysis-rerun',
    });

    const modelConfigUpdated = !storedModelConfig || hasModelConfigChanged(storedModelConfig, modelRun.modelConfig);
    if (modelConfigUpdated) {
      await saveModelConfig(userEmail, analysis.id, modelRun.modelConfig);
    }
    await saveReportSnapshot(userEmail, analysis.id, snapshot);

    return {
      analysisId: analysis.id,
      prospectName: analysis.prospectName,
      status: 'rerun',
      reason,
      parsedUpdated,
      modelConfigUpdated,
      snapshot: {
        id: snapshot.id,
        createdAt: snapshot.createdAt,
        monthlySavings: snapshot.monthlySavings,
        annualSavings: snapshot.annualSavings,
        savingsPercent: snapshot.savingsPercent,
        totalStorageGb: snapshot.totalStorageGb,
        migratedTierCount: snapshot.migratedTierCount,
      },
    };
  } catch (error) {
    return {
      analysisId: analysis.id,
      prospectName: analysis.prospectName,
      status: 'failed',
      reason: error instanceof Error ? error.message : 'Unknown rerun failure',
    };
  }
}

function buildAnalysisModel(parsed: ParsedBill, storedModelConfig?: ModelConfig | null): AnalysisModelRun {
  const modelConfig = normalizeModelConfig(storedModelConfig);
  const tiers = applyTierSelectionConfig(
    buildTierInventory(parsed.lineItems, modelConfig.b2PricePerTb),
    modelConfig,
  );
  const nextModelConfig: ModelConfig = {
    ...modelConfig,
    tierToggles: Object.fromEntries(tiers.map((tier) => [tier.id, tier.migrateToB2])),
    tierSelectionVersion: TIER_SELECTION_VERSION,
  };
  const costModel = computeCostModel(
    parsed.lineItems,
    tiers,
    nextModelConfig.egressConfig,
    nextModelConfig.b2PricePerTb,
  );

  return {
    tiers,
    modelConfig: nextModelConfig,
    costModel,
  };
}

function normalizeModelConfig(modelConfig?: ModelConfig | null): ModelConfig {
  return {
    ...DEFAULT_MODEL_CONFIG,
    ...modelConfig,
    tierToggles: modelConfig?.tierToggles ?? {},
    egressConfig: normalizeEgressConfig(modelConfig?.egressConfig),
    b2PricePerTb: readPositiveNumber(modelConfig?.b2PricePerTb, DEFAULT_MODEL_CONFIG.b2PricePerTb),
    projectionTermMonths: readPositiveNumber(
      modelConfig?.projectionTermMonths,
      DEFAULT_MODEL_CONFIG.projectionTermMonths,
    ),
    pricingDiscountConfirmed: Boolean(modelConfig?.pricingDiscountConfirmed),
  };
}

function hasModelConfigChanged(previous: ModelConfig, next: ModelConfig): boolean {
  return (
    previous.tierSelectionVersion !== next.tierSelectionVersion ||
    previous.b2PricePerTb !== next.b2PricePerTb ||
    previous.projectionTermMonths !== next.projectionTermMonths ||
    Boolean(previous.pricingDiscountConfirmed) !== Boolean(next.pricingDiscountConfirmed) ||
    JSON.stringify(previous.egressConfig) !== JSON.stringify(next.egressConfig) ||
    JSON.stringify(previous.tierToggles ?? {}) !== JSON.stringify(next.tierToggles)
  );
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}
