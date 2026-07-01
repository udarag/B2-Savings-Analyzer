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
import { buildTierState, computeAnalysisView, type AnalysisTierState } from './analysis-model';
import type { Analysis, ModelConfig, ParsedBill } from '@/types/analysis';
import type { CostModelResult, ReportSnapshot } from '@/types/model';

// Re-runs stored analyses through the current engine so saved deals pick up parser fixes, pricing
// updates, and tier-selection version bumps. When the original upload is still on hand it re-parses
// from the source bytes (the most accurate refresh); otherwise it recomputes from the stored parsed
// bill. Each run writes a fresh report snapshot, and the model config is re-saved only when it
// actually changed, to avoid churning storage on no-op reruns.

interface AnalysisModelRun extends AnalysisTierState {
  costModel: CostModelResult;
}

interface BuildAnalysisSnapshotOptions {
  analysisId: string;
  parsed: ParsedBill;
  modelConfig?: ModelConfig | null;
  trigger: ReportSnapshot['trigger'];
  now?: Date;
}

/** Outcome of re-running one stored analysis. `skipped` means there was nothing to recompute;
 *  `failed` carries the error in `reason`. */
export interface RerunAnalysisResult {
  analysisId: string;
  prospectName: string;
  status: 'rerun' | 'skipped' | 'failed';
  reason?: string;
  /** True when the bill was re-parsed from the original upload (vs. reused from storage). */
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

/** Aggregate tallies plus per-analysis detail for a full rerun pass. */
export interface RerunAllAnalysesResult {
  total: number;
  rerun: number;
  skipped: number;
  failed: number;
  results: RerunAnalysisResult[];
}

/** Build a report snapshot (and the underlying model run) from a parsed bill and its stored config.
 *  `now` is injectable for deterministic timestamps in tests. */
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
      b2ServiceTier: modelRun.modelConfig.b2ServiceTier,
    },
  };
}

/** Re-run every stored analysis for a user and return aggregate results. Processed sequentially so a
 *  bulk refresh doesn't hammer storage with concurrent reads/writes. */
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

    // Prefer re-parsing the original upload: it captures any parser improvements since the bill was
    // first ingested. Falls through to the stored parsed bill only when no upload was kept.
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

    // Re-save the config only when normalization actually changed it (e.g. a tier-selection version
    // bump or re-derived toggles), so an unchanged rerun doesn't needlessly rewrite storage.
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
  const { tiers, modelConfig } = buildTierState(parsed, storedModelConfig);
  const { costModel } = computeAnalysisView({
    lineItems: parsed.lineItems,
    discounts: parsed.discounts,
    tiers,
    egressConfig: modelConfig.egressConfig,
    b2PricePerTb: modelConfig.b2PricePerTb,
    b2ServiceTier: modelConfig.b2ServiceTier,
    termMonths: modelConfig.projectionTermMonths,
  });

  return { tiers, modelConfig, costModel };
}

// Field-by-field equality check (nested objects compared via JSON) to decide whether a rerun's
// normalized config differs from what's stored — used to skip redundant writes.
function hasModelConfigChanged(previous: ModelConfig, next: ModelConfig): boolean {
  return (
    previous.tierSelectionVersion !== next.tierSelectionVersion ||
    previous.b2PricePerTb !== next.b2PricePerTb ||
    previous.b2ServiceTier !== next.b2ServiceTier ||
    previous.projectionTermMonths !== next.projectionTermMonths ||
    Boolean(previous.pricingDiscountConfirmed) !== Boolean(next.pricingDiscountConfirmed) ||
    JSON.stringify(previous.egressConfig) !== JSON.stringify(next.egressConfig) ||
    JSON.stringify(previous.tierToggles ?? {}) !== JSON.stringify(next.tierToggles)
  );
}
