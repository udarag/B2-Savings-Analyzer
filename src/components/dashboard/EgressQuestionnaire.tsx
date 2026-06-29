'use client';

// AE-facing form that captures the egress assumptions the cost model can't read off the bill:
// whether hyperscaler compute sits in the storage path (creating new B2<->hyperscaler transfer),
// how much data is served to end users, and whether a partner CDN/compute alliance applies.
// Volumes are entered in TB but the EgressConfig and cost model work in GB, so inputs are scaled
// by 1000 on the way in and divided by 1000 for display throughout this file.

import { useState } from 'react';
import Image from 'next/image';
import type { ComputeSignal, EgressConfig, EgressProfileSuggestion } from '@/types/analysis';
import type { PartnerComputeScenario } from '@/types/model';
import b2Pricing from '@/lib/pricing/b2.json';
import { formatCurrency } from '../shared/FormatCurrency';
import { Collapse } from '../shared/Collapse';

interface EgressQuestionnaireProps {
  config: EgressConfig;
  onChange: (config: EgressConfig) => void;
  partnerComputeScenario?: PartnerComputeScenario | null;
  /** B2's free egress headroom in GB (3x migrated storage); overage above it is what the model charges for. */
  b2FreeAllowanceGb?: number;
  /** Compute/delivery services spotted in the bill, surfaced as clues to help the AE answer these questions. */
  computeSignals?: ComputeSignal[];
  /** Bill-derived starting point for the egress config, which the AE can apply and then refine. */
  egressProfileSuggestion?: EgressProfileSuggestion;
}

/** Egress-assumptions questionnaire that drives the cross-cloud and B2 outbound costs in the savings model. */
export function EgressQuestionnaire({
  config,
  onChange,
  partnerComputeScenario,
  b2FreeAllowanceGb = 0,
  computeSignals = [],
  egressProfileSuggestion,
}: EgressQuestionnaireProps) {
  // Two mutually exclusive shapes once compute exists: a pipeline that writes processed data back
  // to storage (new chargeable hyperscaler->B2 egress), versus a training/inference workflow where
  // results stay in compute and the only B2 traffic is reads pulled out for each run.
  const hasPipelineStorageWrite = config.hasHyperscalerCompute && config.hyperscalerComputeFeedsStorage;
  const isTrainingWorkflow = config.hasHyperscalerCompute && !config.hyperscalerComputeFeedsStorage;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm ring-1 ring-black/[0.02] dark:border-gray-800 dark:bg-[#11141a] dark:ring-white/[0.04]">
      <div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4 dark:border-gray-800 dark:bg-[#171b22]">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Egress Configuration</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Model whether moving storage to B2 creates a new hyperscaler data-transfer path.
        </p>
      </div>
      <div className="space-y-5 p-6 dark:bg-[#11141a]">
        {computeSignals.length > 0 && (
          <ComputeSignalsPanel signals={computeSignals} />
        )}

        {egressProfileSuggestion && (
          <EgressStarterProfilePanel
            suggestion={egressProfileSuggestion}
            onApply={() => onChange({
              ...config,
              ...egressProfileSuggestion.suggestedConfig,
            })}
          />
        )}

        <div>
          <p className="mb-3 font-medium text-gray-900 dark:text-gray-100">
            Does the customer run compute in the hyperscaler?
          </p>
          <div className="space-y-2">
            <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-gray-50 dark:hover:bg-[#171b22] ${
              !config.hasHyperscalerCompute ? 'border-bb-red bg-bb-red-light/40 dark:bg-bb-red-light/40' : 'border-gray-200 dark:border-gray-700'
            }`}>
              <input
                type="radio"
                name="hasHyperscalerCompute"
                checked={!config.hasHyperscalerCompute}
                onChange={() => onChange({
                  ...config,
                  hasHyperscalerCompute: false,
                  hyperscalerComputeFeedsStorage: false,
                  computeStaysInHyperscaler: false,
                  computeMovingToPartner: false,
                  gbPerMonthHyperscalerToB2: 0,
                })}
                className="h-4 w-4 text-bb-red accent-bb-red"
              />
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">No hyperscaler compute in the storage path</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Applications write directly to object storage, so no new inter-cloud egress applies.</p>
              </div>
            </label>
            <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-gray-50 dark:hover:bg-[#171b22] ${
              config.hasHyperscalerCompute ? 'border-bb-red bg-bb-red-light/40 dark:bg-bb-red-light/40' : 'border-gray-200 dark:border-gray-700'
            }`}>
              <input
                type="radio"
                name="hasHyperscalerCompute"
                checked={config.hasHyperscalerCompute}
                onChange={() => onChange({
                  ...config,
                  hasHyperscalerCompute: true,
                  hyperscalerComputeFeedsStorage: true,
                  computeStaysInHyperscaler: true,
                })}
                className="h-4 w-4 text-bb-red accent-bb-red"
              />
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Yes, compute is part of the stack</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Confirm whether processed data is written back to object storage.</p>
              </div>
            </label>
          </div>
        </div>

        {config.hasHyperscalerCompute && (
          <div>
            <p className="mb-3 font-medium text-gray-900 dark:text-gray-100">
              Does that compute write processed data back to object storage?
            </p>
            <div className="space-y-2">
              <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-gray-50 dark:hover:bg-[#171b22] ${
                config.hyperscalerComputeFeedsStorage ? 'border-bb-red bg-bb-red-light/40 dark:bg-bb-red-light/40' : 'border-gray-200 dark:border-gray-700'
              }`}>
                <input
                  type="radio"
                  name="hyperscalerComputeFeedsStorage"
                  checked={config.hyperscalerComputeFeedsStorage}
                  onChange={() => onChange({
                    ...config,
                    hyperscalerComputeFeedsStorage: true,
                    computeStaysInHyperscaler: true,
                  })}
                  className="h-4 w-4 text-bb-red accent-bb-red"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Yes, processed data lands in storage</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Moving storage to B2 creates a hyperscaler-to-B2 write path.</p>
                </div>
              </label>
              <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-gray-50 dark:hover:bg-[#171b22] ${
                !config.hyperscalerComputeFeedsStorage ? 'border-bb-red bg-bb-red-light/40 dark:bg-bb-red-light/40' : 'border-gray-200 dark:border-gray-700'
              }`}>
                <input
                  type="radio"
                  name="hyperscalerComputeFeedsStorage"
                  checked={!config.hyperscalerComputeFeedsStorage}
                  // Switching to the training workflow clears the writeback/partner fields and
                  // repoints served-to-users at the derived training read volume; CDN is forced off
                  // because training reads land in compute, not a CDN.
                  onChange={() => onChange({
                    ...config,
                    hyperscalerComputeFeedsStorage: false,
                    computeStaysInHyperscaler: false,
                    computeMovingToPartner: false,
                    gbPerMonthHyperscalerToB2: 0,
                    gbPerMonthServedToUsers: getTrainingEgressGb(config.trainingRunsPerMonth, config.trainingDataTbPerRun),
                    usesPartnerCdn: false,
                  })}
                  className="h-4 w-4 text-bb-red accent-bb-red"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">No, compute does not write back to storage</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Common for AI/GPU workflows where models or artifacts stay in compute.</p>
                </div>
              </label>
            </div>
          </div>
        )}

        <DataFlowPreview
          config={config}
          partnerComputeScenario={partnerComputeScenario}
          b2FreeAllowanceGb={b2FreeAllowanceGb}
        />

        {hasPipelineStorageWrite && (
          <div className="space-y-4">
            <VolumeInput
              label="Processed Data Written from Hyperscaler Compute to B2"
              unit="TB/mo"
              value={config.gbPerMonthHyperscalerToB2 / 1000}
              placeholder="0"
              helperText="Applies hyperscaler data-transfer-out pricing to the new B2 write path."
              onValueChange={(value) => onChange({
                ...config,
                gbPerMonthHyperscalerToB2: value * 1000,
              })}
            />

            <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <input
                type="checkbox"
                checked={config.computeMovingToPartner}
                onChange={(e) => onChange({
                  ...config,
                  computeMovingToPartner: e.target.checked,
                })}
                className="h-4 w-4 text-bb-red accent-bb-red rounded"
              />
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  Model primary case with B2 bandwidth alliance compute
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Use this only when the customer is moving the write path to a partner such as CoreWeave, Vultr, or Equinix Metal.
                </p>
              </div>
            </label>

            {/* Three states: the partner write path is baked into the primary model; it's quantified
                as optional upside (volume known but path not yet committed); or we still need the
                volume before either egress drag or upside can be sized. */}
            {config.computeMovingToPartner ? (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-400/30 dark:bg-green-950/30">
                <p className="text-sm font-semibold text-green-900 dark:text-green-200">Partner compute modeled in primary savings</p>
                <p className="mt-1 text-sm text-green-800 dark:text-green-200">
                  Hyperscaler-to-B2 processed-data egress is removed from the primary cost model.
                </p>
              </div>
            ) : partnerComputeScenario ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-400/30 dark:bg-emerald-950/30">
                <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">Bandwidth alliance upside</p>
                <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">
                  Moving this write path to partner compute would avoid {formatCurrency(partnerComputeScenario.monthlyEgressAvoided)}/month and raise modeled savings to {formatCurrency(partnerComputeScenario.monthlySavings)}/month.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-400/30 dark:bg-amber-950/30">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Processed-data volume needed</p>
                <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                  Enter the monthly write volume to quantify the hyperscaler egress drag and partner-compute upside.
                </p>
              </div>
            )}
          </div>
        )}

        {isTrainingWorkflow ? (
          <TrainingEgressInputs
            config={config}
            b2FreeAllowanceGb={b2FreeAllowanceGb}
            onChange={onChange}
          />
        ) : (
          <>
            <VolumeInput
              label="Estimated Data Served to End Users or External Consumers"
              unit="TB/mo"
              value={config.gbPerMonthServedToUsers / 1000}
              placeholder="0"
              helperText="Used to estimate B2 egress after the 3x stored-data free allowance. Any overage is included in the savings summary."
              onValueChange={(value) => onChange({
                ...config,
                gbPerMonthServedToUsers: value * 1000,
              })}
            />
            {!config.usesPartnerCdn && (
              <B2OutboundAllowanceSummary
                monthlyEgressGb={config.gbPerMonthServedToUsers}
                b2FreeAllowanceGb={b2FreeAllowanceGb}
              />
            )}

            <div>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={config.usesPartnerCdn}
                  onChange={(e) => onChange({
                    ...config,
                    usesPartnerCdn: e.target.checked,
                  })}
                  className="h-4 w-4 text-bb-red accent-bb-red rounded"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Uses or Plans to Use a B2 CDN Partner (Cloudflare, Fastly, bunny.net)
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    B2 egress to CDN partners is free
                  </p>
                </div>
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Surfaces the bill-derived egress guess: a plain-language summary up top with a one-click apply,
// plus expandable detail separating what came from the bill from what the AE still needs to confirm.
function EgressStarterProfilePanel({
  suggestion,
  onApply,
}: {
  suggestion: EgressProfileSuggestion;
  onApply: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const aeSummary = buildAeFriendlySuggestionSummary(suggestion);

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-4 shadow-sm ring-1 ring-blue-100/60 dark:border-blue-400/30 dark:bg-blue-950/20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300">Bill Guess</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-blue-950 dark:text-blue-100">
              Bill-Derived Egress Guess
            </p>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:ring-blue-400/30">
              {suggestion.confidence} confidence
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-blue-900 dark:text-blue-200">{aeSummary}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-800 shadow-sm hover:bg-blue-50 dark:border-blue-400/30 dark:bg-blue-950/30 dark:text-blue-100"
          >
            <svg
              className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
            </svg>
            {expanded ? 'Hide Details' : 'Show Details'}
          </button>
          <button
            type="button"
            onClick={onApply}
            className="rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Apply Bill Guess
          </button>
        </div>
      </div>

      <Collapse open={expanded}>
        <div className="mt-4 border-t border-blue-200 pt-4 dark:border-blue-400/20">
          <p className="text-xs leading-5 text-blue-900 dark:text-blue-200">{suggestion.summary}</p>

          {suggestion.metrics.length > 0 && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {suggestion.metrics.map((metric) => (
                <div key={metric.label} className="rounded-md bg-white/80 p-3 ring-1 ring-blue-100 dark:bg-[#11141a] dark:ring-blue-400/20">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-500 dark:text-blue-300">{metric.label}</p>
                  <p className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">{metric.value}</p>
                  <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-300">{metric.detail}</p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <StarterProfileList title="Pre-filled from bill" items={suggestion.assumptions} />
            <StarterProfileList title="Not bill-backed" items={suggestion.questions} />
          </div>
        </div>
      </Collapse>
    </div>
  );
}

// Turns the raw suggestion into one AE-readable sentence, deliberately hedged ("appears to",
// "starting point") so the inferred numbers are never presented to the AE as fact.
function buildAeFriendlySuggestionSummary(suggestion: EgressProfileSuggestion): string {
  const servedGb = suggestion.suggestedConfig.gbPerMonthServedToUsers || 0;
  const foundCompute = Boolean(suggestion.suggestedConfig.hasHyperscalerCompute);
  const pieces: string[] = [];

  if (servedGb > 0) {
    pieces.push(`about ${formatVolume(servedGb / 1000)} TB/month of customer-facing outbound usage`);
  }
  if (foundCompute) {
    pieces.push('cloud services that may be part of the storage workflow');
  }

  if (pieces.length === 0) {
    return 'The bill had limited outbound-usage clues, so this is only a light starting point for the customer conversation.';
  }

  return `The bill appears to show ${pieces.join(' and ')}. Apply this as a starting point, then confirm the details with the customer.`;
}

function StarterProfileList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold text-blue-900 dark:text-blue-200">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-xs leading-5 text-blue-900 dark:text-blue-200">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-blue-500" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Read-only panel listing compute/delivery services found in the bill as hints for answering the
// questionnaire. Caps the detail view at 6 signals to keep it scannable, noting how many are hidden.
function ComputeSignalsPanel({ signals }: { signals: ComputeSignal[] }) {
  const [expanded, setExpanded] = useState(false);
  const visibleSignals = signals.slice(0, 6);
  const hiddenCount = Math.max(0, signals.length - visibleSignals.length);
  const topSignalNames = visibleSignals.slice(0, 3).map((signal) => signal.service);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm ring-1 ring-slate-100 dark:border-gray-700 dark:bg-[#101218]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-gray-500">Bill Clues</p>
          <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
            Compute and Delivery Services Detected
          </p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-500 dark:text-gray-400">
            Found {signals.length} bill clue{signals.length === 1 ? '' : 's'}
            {topSignalNames.length > 0 ? ` including ${topSignalNames.join(', ')}` : ''}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-gray-700 dark:bg-[#11141a] dark:text-gray-100"
        >
          <svg
            className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.8}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
          </svg>
          {expanded ? 'Hide Details' : 'Show Details'}
        </button>
      </div>

      <Collapse open={expanded}>
        <div className="mt-3">
          {hiddenCount > 0 && (
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
              {hiddenCount} more signal{hiddenCount === 1 ? '' : 's'} hidden
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {visibleSignals.map((signal) => (
              <div key={signal.service} className="min-w-0 border-l-2 border-gray-200 pl-3 dark:border-gray-700">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{signal.service}</p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {formatSignalType(signal.signalType)} - {formatCurrency(signal.costUsd)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    {signal.confidence}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-gray-600 dark:text-gray-300">{signal.egressHint}</p>
                {signal.regions?.length ? (
                  <p className="mt-1 truncate text-[11px] text-gray-400 dark:text-gray-500">
                    Regions: {signal.regions.join(', ')}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </Collapse>
    </div>
  );
}

function formatSignalType(type: ComputeSignal['signalType']): string {
  switch (type) {
    case 'ai-ml':
      return 'AI / ML';
    case 'serverless':
      return 'Serverless';
    case 'container':
      return 'Container';
    case 'analytics':
      return 'Analytics';
    case 'database':
      return 'Database';
    case 'delivery':
      return 'Delivery';
    case 'networking':
      return 'Networking';
    case 'compute':
    default:
      return 'Compute';
  }
}

type FlowTone = 'neutral' | 'compute' | 'storage' | 'output' | 'chargeable' | 'free';
type FlowIcon = 'source' | 'compute' | 'gpu' | 'backblaze' | 'target' | 'training' | 'artifact';

interface FlowNode {
  label: string;
  detail: string;
  tone: FlowTone;
  icon: FlowIcon;
}

interface FlowEdge {
  label: string;
  detail: string;
  tone: FlowTone;
}

interface DataFlow {
  animationKey: string;
  title: string;
  summary: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

type FlowStep =
  | { kind: 'node'; node: FlowNode; sequence: number }
  | { kind: 'edge'; edge: FlowEdge; sequence: number };

// Live node-and-edge diagram of the data path implied by the current answers, so the AE can see at
// a glance which transfers are free vs. chargeable before trusting the savings number.
function DataFlowPreview({
  config,
  partnerComputeScenario,
  b2FreeAllowanceGb,
}: {
  config: EgressConfig;
  partnerComputeScenario?: PartnerComputeScenario | null;
  b2FreeAllowanceGb: number;
}) {
  const flow = getDataFlow(config, partnerComputeScenario, b2FreeAllowanceGb);
  const flowSteps = getFlowSteps(flow);
  const gridLayout = getFlowGridLayout(flowSteps.length);

  return (
    <div
      className="egress-flow-panel rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-[#101218] lg:h-[230px] lg:overflow-hidden"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between lg:min-h-[54px]">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Data Flow Preview</p>
          <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{flow.title}</p>
        </div>
        <p className="max-w-lg text-xs text-gray-500 dark:text-gray-400 sm:text-right">{flow.summary}</p>
      </div>

      <div
        key={flow.animationKey}
        style={{ gridTemplateColumns: gridLayout.templateColumns }}
        className="mt-4 flex flex-col gap-2 lg:grid lg:h-[118px] lg:items-stretch"
      >
        {flowSteps.map((step, index) => (
          step.kind === 'node' ? (
            <FlowNodeCard
              key={`${step.node.label}-${index}`}
              node={step.node}
              sequence={step.sequence}
              gridColumnStart={index === 0 ? gridLayout.startColumn : undefined}
            />
          ) : (
            <FlowEdgePill
              key={`${step.edge.label}-${index}`}
              edge={step.edge}
              sequence={step.sequence}
              gridColumnStart={index === 0 ? gridLayout.startColumn : undefined}
            />
          )
        ))}
      </div>
    </div>
  );
}

// Keeps the diagram centered regardless of how many steps a case has. Shorter flows (3 nodes /
// 2 edges = 5 steps) get narrow spacer tracks on each side so they don't stretch full width;
// the 7-step flow fills the grid edge to edge.
function getFlowGridLayout(stepCount: number): { templateColumns: string; startColumn: number } {
  const nodeTrack = 'minmax(0,1.25fr)';
  const edgeTrack = 'minmax(0,0.58fr)';

  if (stepCount <= 5) {
    return {
      templateColumns: [
        'minmax(0,0.34fr)',
        nodeTrack,
        edgeTrack,
        nodeTrack,
        edgeTrack,
        nodeTrack,
        'minmax(0,0.34fr)',
      ].join(' '),
      startColumn: 2,
    };
  }

  return {
    templateColumns: [nodeTrack, edgeTrack, nodeTrack, edgeTrack, nodeTrack, edgeTrack, nodeTrack].join(' '),
    startColumn: 1,
  };
}

function getFlowSteps(flow: DataFlow): FlowStep[] {
  return flow.nodes.flatMap((node, index) => {
    const steps: FlowStep[] = [{ kind: 'node', node, sequence: index * 2 }];
    const edge = flow.edges[index];

    if (edge) {
      steps.push({ kind: 'edge', edge, sequence: (index * 2) + 1 });
    }

    return steps;
  });
}

function FlowNodeCard({
  node,
  sequence,
  gridColumnStart,
}: {
  node: FlowNode;
  sequence: number;
  gridColumnStart?: number;
}) {
  return (
    <div
      style={gridColumnStart ? { gridColumnStart } : undefined}
      className={`egress-flow-item ${flowDelayClass(sequence)} flex items-center justify-center rounded-lg border px-3 py-2.5 lg:h-[118px] lg:min-w-0 lg:overflow-hidden ${flowNodeClasses(node.tone)}`}
    >
      <div className="flex max-w-full items-center gap-2.5">
        <FlowNodeIcon icon={node.icon} tone={node.tone} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{node.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{node.detail}</p>
        </div>
      </div>
    </div>
  );
}

function FlowNodeIcon({ icon, tone }: { icon: FlowIcon; tone: FlowTone }) {
  const iconClass = `mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${flowIconClasses(tone)}`;

  if (icon === 'backblaze') {
    return (
      <span className={iconClass}>
        <Image
          src="/backblaze-flame.png"
          alt=""
          width={20}
          height={20}
          className="h-5 w-5 object-contain"
        />
      </span>
    );
  }

  return (
    <span className={iconClass} aria-hidden="true">
      <FlowNodeSvg icon={icon} />
    </span>
  );
}

function FlowNodeSvg({ icon }: { icon: Exclude<FlowIcon, 'backblaze'> }) {
  const common = {
    className: 'h-4 w-4',
    fill: 'none',
    viewBox: '0 0 24 24',
    strokeWidth: 1.8,
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (icon) {
    case 'compute':
      return (
        <svg {...common}>
          <rect x="6" y="6" width="12" height="12" rx="2" />
          <path d="M9 1.5v3M15 1.5v3M9 19.5v3M15 19.5v3M1.5 9h3M1.5 15h3M19.5 9h3M19.5 15h3M10 10h4v4h-4z" />
        </svg>
      );
    case 'gpu':
      return (
        <svg {...common}>
          <rect x="4" y="7" width="16" height="10" rx="2" />
          <path d="M8 11h3M8 14h5M15 10.5h1.5M15 13.5h1.5M7 4v3M12 4v3M17 4v3M7 17v3M12 17v3M17 17v3" />
        </svg>
      );
    case 'target':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
      );
    case 'training':
      return (
        <svg {...common}>
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
          <path d="M4 5.5v15M8 7h8M8 10h6" />
        </svg>
      );
    case 'artifact':
      return (
        <svg {...common}>
          <path d="M12 3 4.5 7.25v9.5L12 21l7.5-4.25v-9.5z" />
          <path d="m4.5 7.25 7.5 4.25 7.5-4.25M12 11.5V21" />
        </svg>
      );
    case 'source':
    default:
      return (
        <svg {...common}>
          <path d="M4 7h16M4 12h10M4 17h7" />
          <path d="M17 13.5 20.5 17 17 20.5" />
        </svg>
      );
  }
}

function flowIconClasses(tone: FlowTone): string {
  switch (tone) {
    case 'compute':
      return 'border-blue-200 bg-white text-blue-700 dark:border-blue-400/30 dark:bg-blue-950/40 dark:text-blue-300';
    case 'storage':
      return 'border-red-200 bg-white text-bb-red dark:border-red-400/30 dark:bg-red-950/30 dark:text-red-300';
    case 'chargeable':
      return 'border-amber-200 bg-white text-amber-700 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-300';
    case 'free':
      return 'border-green-200 bg-white text-green-700 dark:border-green-400/30 dark:bg-green-950/40 dark:text-green-300';
    case 'output':
    case 'neutral':
    default:
      return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-[#101218] dark:text-gray-300';
  }
}

function FlowEdgePill({
  edge,
  sequence,
  gridColumnStart,
}: {
  edge: FlowEdge;
  sequence: number;
  gridColumnStart?: number;
}) {
  return (
    <div
      style={gridColumnStart ? { gridColumnStart } : undefined}
      className={`egress-flow-edge ${flowDelayClass(sequence)} flex items-center gap-2 rounded-md border px-3 py-2 text-xs lg:h-[118px] lg:min-w-0 lg:flex-col lg:justify-center lg:overflow-hidden lg:text-center ${flowEdgeClasses(edge.tone)}`}
    >
      <span className="shrink-0 font-mono text-sm leading-none md:text-base">&gt;</span>
      <span>
        <span className="block font-semibold">{edge.label}</span>
        <span className="block whitespace-pre-line text-[11px] font-normal opacity-80">{edge.detail}</span>
      </span>
    </div>
  );
}

// Builds the node/edge diagram for the current answers. The branch order matters: it mirrors the
// form's gating (no compute -> direct write; compute without writeback -> training reads; compute
// with writeback -> partner alliance vs. chargeable hyperscaler egress) so the picture always
// matches the case the cost model is scoring.
function getDataFlow(config: EgressConfig, partnerComputeScenario?: PartnerComputeScenario | null, b2FreeAllowanceGb = 0): DataFlow {
  const animationKey = getFlowAnimationKey(config);
  const b2OutboundEdge = getB2OutboundEdge(config, b2FreeAllowanceGb);
  const externalNode: FlowNode = {
    label: 'Target',
    detail: config.usesPartnerCdn
      ? 'CDN partner, users, external customers, etc. B2 partner CDN path modeled as free egress.'
      : formatServedDataDetail(config.gbPerMonthServedToUsers),
    tone: config.usesPartnerCdn ? 'free' : 'output',
    icon: 'target',
  };

  if (!config.hasHyperscalerCompute) {
    return {
      animationKey,
      title: 'Direct write to B2',
      summary: 'No hyperscaler compute write-out path is modeled, so this remains a pure storage migration case.',
      nodes: [
        { label: 'App Data Source', detail: 'Data is written directly to object storage.', tone: 'neutral', icon: 'source' },
        { label: 'Backblaze B2', detail: 'New storage target for the selected tiers.', tone: 'storage', icon: 'backblaze' },
        externalNode,
      ],
      edges: [
        { label: 'Direct write', detail: 'No new egress', tone: 'free' },
        b2OutboundEdge,
      ],
    };
  }

  if (!config.hyperscalerComputeFeedsStorage) {
    const monthlyTrainingEgressGb = getTrainingEgressGb(config.trainingRunsPerMonth, config.trainingDataTbPerRun);
    const trainingOverageGb = Math.max(0, monthlyTrainingEgressGb - b2FreeAllowanceGb);
    const trainingOverageCost = getB2EgressOverageCost(trainingOverageGb);

    return {
      animationKey,
      title: 'Training data read from Backblaze B2',
      summary: 'Training data is stored in B2 and read into hyperscaler compute for each run; the model checks those reads against B2 free egress.',
      nodes: [
        { label: 'Backblaze B2', detail: 'Training Data', tone: 'storage', icon: 'backblaze' },
        { label: 'GPU Cluster', detail: 'Data is processed inside the hyperscaler.', tone: 'compute', icon: 'gpu' },
        { label: 'Model / Compute Artifacts', detail: 'Results remain in the compute environment instead of writing back to object storage.', tone: 'output', icon: 'artifact' },
      ],
      edges: [
        {
          label: 'B2 egress',
          detail: monthlyTrainingEgressGb > 0
            ? trainingOverageGb > 0
              ? `Training read\n${formatCurrency(trainingOverageCost)}/mo overage`
              : `Training read\n${formatVolume(monthlyTrainingEgressGb / 1000)} TB/mo under 3x`
            : 'Training read\nEnter runs',
          tone: trainingOverageGb > 0 ? 'chargeable' : 'free',
        },
        { label: 'No writeback', detail: 'No new egress', tone: 'free' },
      ],
    };
  }

  if (config.computeMovingToPartner) {
    return {
      animationKey,
      title: 'Partner compute with B2 storage',
      summary: 'The primary model assumes the write path moves to a B2 bandwidth alliance partner, avoiding hyperscaler egress on processed data.',
      nodes: [
        { label: 'App Data Source', detail: 'Workload input enters the compute path.', tone: 'neutral', icon: 'source' },
        { label: 'Hyperscaler Compute', detail: 'Modeled as a B2 bandwidth alliance partner for this scenario.', tone: 'free', icon: 'compute' },
        { label: 'Backblaze B2', detail: 'Processed data lands in B2 without hyperscaler write-out fees.', tone: 'storage', icon: 'backblaze' },
        externalNode,
      ],
      edges: [
        { label: 'Process', detail: 'Partner stack', tone: 'free' },
        { label: 'Alliance path', detail: 'Free egress', tone: 'free' },
        b2OutboundEdge,
      ],
    };
  }

  const writeVolumeDetail = config.gbPerMonthHyperscalerToB2 > 0
    ? `${formatVolume(config.gbPerMonthHyperscalerToB2 / 1000)} TB/mo`
    : 'Enter volume';
  const chargeDetail = partnerComputeScenario
    ? `${formatCurrency(partnerComputeScenario.monthlyEgressAvoided)}/mo`
    : writeVolumeDetail;

  return {
    animationKey,
    title: 'Hyperscaler compute writes to B2',
    summary: 'The compute-to-B2 write path is modeled as new hyperscaler egress and reduces the primary savings estimate.',
    nodes: [
      { label: 'App Data Source', detail: 'Data enters the hyperscaler compute workflow.', tone: 'neutral', icon: 'source' },
      { label: 'Hyperscaler Compute', detail: 'Processing remains in the current hyperscaler.', tone: 'compute', icon: 'compute' },
      { label: 'Backblaze B2', detail: 'Processed data is written out to B2.', tone: 'storage', icon: 'backblaze' },
      externalNode,
    ],
    edges: [
      { label: 'Process', detail: 'In hyperscaler', tone: 'neutral' },
      { label: 'Chargeable egress', detail: chargeDetail, tone: 'chargeable' },
      b2OutboundEdge,
    ],
  };
}

// The B2 -> users edge: free over a partner CDN, free while served volume stays under the 3x
// allowance, otherwise priced at the B2 overage rate. Same allowance logic the cost model applies.
function getB2OutboundEdge(config: EgressConfig, b2FreeAllowanceGb: number): FlowEdge {
  if (config.usesPartnerCdn) {
    return { label: 'Partner CDN', detail: 'Free egress', tone: 'free' };
  }

  if (config.gbPerMonthServedToUsers <= 0) {
    return { label: 'B2 egress', detail: 'Enter volume', tone: 'neutral' };
  }

  const overageGb = Math.max(0, config.gbPerMonthServedToUsers - b2FreeAllowanceGb);
  if (overageGb <= 0) {
    return {
      label: 'B2 egress',
      detail: `${formatVolume(config.gbPerMonthServedToUsers / 1000)} TB/mo under 3x`,
      tone: 'free',
    };
  }

  return {
    label: 'B2 egress',
    detail: `${formatCurrency(getB2EgressOverageCost(overageGb))}/mo overage`,
    tone: 'chargeable',
  };
}

function getFlowAnimationKey(config: EgressConfig): string {
  if (!config.hasHyperscalerCompute) {
    return `direct-${config.usesPartnerCdn ? 'cdn' : 'users'}`;
  }

  if (!config.hyperscalerComputeFeedsStorage) {
    return 'compute-no-writeback';
  }

  return [
    'compute-writeback',
    config.computeMovingToPartner ? 'partner' : 'hyperscaler',
    config.usesPartnerCdn ? 'cdn' : 'users',
  ].join('-');
}

// Staggered reveal of each step; clamped at 6 because that's the last delay class defined in CSS.
function flowDelayClass(sequence: number): string {
  return `egress-flow-delay-${Math.min(sequence, 6)}`;
}

function flowNodeClasses(tone: FlowTone): string {
  switch (tone) {
    case 'compute':
      return 'border-blue-200 bg-blue-50 dark:border-blue-400/30 dark:bg-blue-950/30';
    case 'storage':
      return 'border-bb-red/30 bg-bb-red-light/50 dark:border-red-400/30 dark:bg-red-950/20';
    case 'chargeable':
      return 'border-amber-200 bg-amber-50 dark:border-amber-400/30 dark:bg-amber-950/30';
    case 'free':
      return 'border-green-200 bg-green-50 dark:border-green-400/30 dark:bg-green-950/30';
    case 'output':
      return 'border-gray-200 bg-white dark:border-gray-700 dark:bg-[#11141a]';
    case 'neutral':
    default:
      return 'border-gray-200 bg-white dark:border-gray-700 dark:bg-[#11141a]';
  }
}

function flowEdgeClasses(tone: FlowTone): string {
  switch (tone) {
    case 'chargeable':
      return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-300';
    case 'free':
      return 'border-green-200 bg-green-50 text-green-800 dark:border-green-400/30 dark:bg-green-950/30 dark:text-green-300';
    case 'compute':
      return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-950/30 dark:text-blue-300';
    case 'storage':
      return 'border-bb-red/30 bg-bb-red-light/50 text-bb-red-dark dark:border-red-400/30 dark:bg-red-950/20 dark:text-red-300';
    case 'output':
    case 'neutral':
    default:
      return 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-[#11141a] dark:text-gray-300';
  }
}

function formatServedDataDetail(gbPerMonth: number): string {
  if (gbPerMonth <= 0) return 'External serving volume is not entered yet.';
  return `${formatVolume(gbPerMonth / 1000)} TB/mo served from Backblaze B2.`;
}

function formatVolume(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

// Shows served-to-users volume against the 3x free allowance and, when over, the resulting overage
// (which the cost model already folds into the savings summary, hence the reassurance in the copy).
function B2OutboundAllowanceSummary({
  monthlyEgressGb,
  b2FreeAllowanceGb,
}: {
  monthlyEgressGb: number;
  b2FreeAllowanceGb: number;
}) {
  const monthlyEgressTb = monthlyEgressGb / 1000;
  const freeAllowanceTb = b2FreeAllowanceGb / 1000;
  const overageTb = Math.max(0, monthlyEgressTb - freeAllowanceTb);
  // Display math is in TB; convert the overage back to GB because the cost helper is priced per GB.
  const overageCost = getB2EgressOverageCost(overageTb * 1000);
  const hasEgressInput = monthlyEgressGb > 0;

  return (
    <div className={`rounded-lg border p-4 ${
      !hasEgressInput
        ? 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-[#101218]'
        : overageTb > 0
          ? 'border-amber-200 bg-amber-50 dark:border-amber-400/30 dark:bg-amber-950/30'
          : 'border-green-200 bg-green-50 dark:border-green-400/30 dark:bg-green-950/30'
    }`}>
      <p className={`text-sm font-semibold ${
        !hasEgressInput
          ? 'text-gray-900 dark:text-gray-100'
          : overageTb > 0
            ? 'text-amber-900 dark:text-amber-300'
            : 'text-green-900 dark:text-green-300'
      }`}>
        {hasEgressInput
          ? overageTb > 0
            ? 'B2 egress exceeds the free allowance'
            : 'B2 egress fits under the free allowance'
          : 'Enter outbound B2 usage'}
      </p>
      <p className={`mt-1 text-sm ${
        !hasEgressInput
          ? 'text-gray-500 dark:text-gray-400'
          : overageTb > 0
            ? 'text-amber-800 dark:text-amber-300'
            : 'text-green-800 dark:text-green-300'
      }`}>
        {hasEgressInput
          ? `${formatVolume(monthlyEgressTb)} TB/month from B2 versus ${formatVolume(freeAllowanceTb)} TB/month free allowance.`
          : `B2 free allowance is ${formatVolume(freeAllowanceTb)} TB/month based on migrated storage.`}
        {hasEgressInput && overageTb > 0
          ? ` Estimated overage: ${formatVolume(overageTb)} TB/month, or ${formatCurrency(overageCost)}/month. This is included in the savings summary.`
          : ''}
      </p>
    </div>
  );
}

// Inputs for the training/inference case: runs/month and data/run, from which monthly B2 read
// egress is derived and checked against the free allowance. The derived volume is mirrored into
// gbPerMonthServedToUsers so the rest of the model treats training reads as the served volume.
function TrainingEgressInputs({
  config,
  b2FreeAllowanceGb,
  onChange,
}: {
  config: EgressConfig;
  b2FreeAllowanceGb: number;
  onChange: (config: EgressConfig) => void;
}) {
  const monthlyTrainingEgressGb = getTrainingEgressGb(config.trainingRunsPerMonth, config.trainingDataTbPerRun);
  const monthlyTrainingEgressTb = monthlyTrainingEgressGb / 1000;
  const freeAllowanceTb = b2FreeAllowanceGb / 1000;
  const overageTb = Math.max(0, monthlyTrainingEgressTb - freeAllowanceTb);
  const overageCost = getB2EgressOverageCost(overageTb * 1000);
  const hasTrainingInputs = config.trainingRunsPerMonth > 0 && config.trainingDataTbPerRun > 0;

  const updateTrainingEgress = (updates: Partial<Pick<EgressConfig, 'trainingRunsPerMonth' | 'trainingDataTbPerRun'>>) => {
    const trainingRunsPerMonth = updates.trainingRunsPerMonth ?? config.trainingRunsPerMonth;
    const trainingDataTbPerRun = updates.trainingDataTbPerRun ?? config.trainingDataTbPerRun;

    onChange({
      ...config,
      trainingRunsPerMonth,
      trainingDataTbPerRun,
      gbPerMonthServedToUsers: getTrainingEgressGb(trainingRunsPerMonth, trainingDataTbPerRun),
      usesPartnerCdn: false,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <VolumeInput
          label="Training Runs per Month"
          unit="runs/mo"
          value={config.trainingRunsPerMonth}
          placeholder="0"
          helperText="How many times the training dataset is read from B2 each month."
          onValueChange={(value) => updateTrainingEgress({ trainingRunsPerMonth: value })}
        />
        <VolumeInput
          label="Training Data per Run"
          unit="TB/run"
          value={config.trainingDataTbPerRun}
          placeholder="0"
          helperText="The amount of B2-hosted training data read by each run."
          onValueChange={(value) => updateTrainingEgress({ trainingDataTbPerRun: value })}
        />
      </div>

      <div className={`rounded-lg border p-4 ${
        !hasTrainingInputs
          ? 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-[#101218]'
          : overageTb > 0
            ? 'border-amber-200 bg-amber-50 dark:border-amber-400/30 dark:bg-amber-950/30'
            : 'border-green-200 bg-green-50 dark:border-green-400/30 dark:bg-green-950/30'
      }`}>
        <p className={`text-sm font-semibold ${
          !hasTrainingInputs
            ? 'text-gray-900 dark:text-gray-100'
            : overageTb > 0
              ? 'text-amber-900 dark:text-amber-300'
              : 'text-green-900 dark:text-green-300'
        }`}>
          {hasTrainingInputs
            ? overageTb > 0
              ? 'Training reads exceed the B2 free allowance'
              : 'Training reads fit under the B2 free allowance'
            : 'Enter training run assumptions'}
        </p>
        <p className={`mt-1 text-sm ${
          !hasTrainingInputs
            ? 'text-gray-500 dark:text-gray-400'
            : overageTb > 0
              ? 'text-amber-800 dark:text-amber-300'
              : 'text-green-800 dark:text-green-300'
        }`}>
          {hasTrainingInputs
            ? `${formatVolume(monthlyTrainingEgressTb)} TB/month read from B2 versus ${formatVolume(freeAllowanceTb)} TB/month free allowance.`
            : `B2 free allowance is ${formatVolume(freeAllowanceTb)} TB/month based on migrated storage.`}
          {hasTrainingInputs && overageTb > 0
            ? ` Estimated overage: ${formatVolume(overageTb)} TB/month, or ${formatCurrency(overageCost)}/month at B2 overage rates. This is included in the savings summary.`
            : ''}
        </p>
      </div>
    </div>
  );
}

// Reusable numeric field for the volume inputs. Parses to a non-negative number and reports it via
// onValueChange; the unit shown is cosmetic, so callers handle any TB<->GB scaling themselves.
function VolumeInput({
  label,
  unit,
  value,
  placeholder,
  helperText,
  onValueChange,
}: {
  label: string;
  unit: string;
  value: number;
  placeholder: string;
  helperText: string;
  onValueChange: (value: number) => void;
}) {
  // While focused, show the user's raw keystrokes (the draft) so in-progress entries like "1." or
  // "0.0" aren't clobbered by reformatting; on blur, fall back to the canonical formatted value.
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => formatVolumeInput(value));
  const displayValue = focused ? draft : formatVolumeInput(value);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-[#101218]">
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </label>
      <div className="flex items-center rounded-md border border-gray-300 bg-white shadow-sm focus-within:border-bb-red focus-within:ring-2 focus-within:ring-red-100 dark:border-gray-700 dark:bg-[#11141a] dark:focus-within:ring-red-400/20">
        <input
          type="text"
          inputMode="decimal"
          value={displayValue}
          onFocus={() => {
            setFocused(true);
            setDraft(formatVolumeInput(value));
          }}
          onBlur={() => {
            setFocused(false);
            setDraft(formatVolumeInput(value));
          }}
          onChange={(e) => {
            const nextDraft = e.target.value;
            setDraft(nextDraft);

            if (nextDraft.trim() === '') {
              onValueChange(0);
              return;
            }

            const parsed = Number(nextDraft);
            if (Number.isFinite(parsed) && parsed >= 0) {
              onValueChange(parsed);
            }
          }}
          className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-lg font-bold text-bb-navy outline-none dark:text-gray-100"
          placeholder={placeholder}
        />
        <span className="pr-3 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{unit}</span>
      </div>
      <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">{helperText}</p>
    </div>
  );
}

function formatVolumeInput(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

// Training reads the full dataset once per run, so monthly B2 egress = runs x data/run (TB->GB).
// Negatives are floored to 0 to keep half-entered inputs from producing nonsense volumes.
function getTrainingEgressGb(trainingRunsPerMonth: number, trainingDataTbPerRun: number): number {
  return Math.max(0, trainingRunsPerMonth) * Math.max(0, trainingDataTbPerRun) * 1000;
}

// Prices only the GB above the free allowance at B2's per-GB overage rate; the allowance itself
// is netted out by the caller. Mirrors the cost model so the diagram and savings summary agree.
function getB2EgressOverageCost(overageGb: number): number {
  return Math.max(0, overageGb) * b2Pricing.egress.overagePerGb;
}
