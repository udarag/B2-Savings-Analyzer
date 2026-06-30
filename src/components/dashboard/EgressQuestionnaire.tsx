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
    // Design-system card: rounded-2xl surface with a hairline border and soft shadow.
    <div className="overflow-hidden rounded-2xl border border-c-border bg-c-surface shadow-sm">
      {/* Header carries a purple left-accent rail and an amber "Internal" pill to flag this as an AE-only tool. */}
      <div className="border-b border-c-border border-l-[3px] border-l-[#3430ff] px-6 py-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-c-text">Egress Configuration</h3>
          <span className="rounded-full bg-c-amber-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-c-amber">Internal</span>
        </div>
        <p className="mt-1 text-sm text-c-muted">
          Model whether moving storage to B2 creates a new hyperscaler data-transfer path.
        </p>
      </div>
      <div className="space-y-5 p-6">
        {/* Modeled data-flow diagram is anchored at the top of the card so it holds a fixed position
            while the questionnaire below expands/collapses; it still updates live from the current
            answers (and re-animates when an answer reshapes the path). */}
        <DataFlowPreview
          config={config}
          b2FreeAllowanceGb={b2FreeAllowanceGb}
        />

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
          <p className="mb-3 font-medium text-c-text">
            Does the customer run compute in the hyperscaler?
          </p>
          <div className="space-y-2">
            {/* Selected radio card: red border + red-soft fill with a filled red accent dot. Unselected: neutral surface. */}
            <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${
              !config.hasHyperscalerCompute ? 'border-[#e20626] bg-c-red-soft' : 'border-c-border2 bg-c-surface hover:bg-c-surface2'
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
                className="h-4 w-4 accent-[#e20626]"
              />
              <div>
                <p className="text-sm font-medium text-c-text">No hyperscaler compute in the storage path</p>
                <p className="text-xs text-c-muted">Applications write directly to object storage, so no new inter-cloud egress applies.</p>
              </div>
            </label>
            <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${
              config.hasHyperscalerCompute ? 'border-[#e20626] bg-c-red-soft' : 'border-c-border2 bg-c-surface hover:bg-c-surface2'
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
                className="h-4 w-4 accent-[#e20626]"
              />
              <div>
                <p className="text-sm font-medium text-c-text">Yes, compute is part of the stack</p>
                <p className="text-xs text-c-muted">Confirm whether processed data is written back to object storage.</p>
              </div>
            </label>
          </div>
        </div>

        {config.hasHyperscalerCompute && (
          <div>
            <p className="mb-3 font-medium text-c-text">
              Does that compute write processed data back to object storage?
            </p>
            <div className="space-y-2">
              {/* Selected radio card: red border + red-soft fill with a filled red accent dot. Unselected: neutral surface. */}
              <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${
                config.hyperscalerComputeFeedsStorage ? 'border-[#e20626] bg-c-red-soft' : 'border-c-border2 bg-c-surface hover:bg-c-surface2'
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
                  className="h-4 w-4 accent-[#e20626]"
                />
                <div>
                  <p className="text-sm font-medium text-c-text">Yes, processed data lands in storage</p>
                  <p className="text-xs text-c-muted">Moving storage to B2 creates a hyperscaler-to-B2 write path.</p>
                </div>
              </label>
              <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${
                !config.hyperscalerComputeFeedsStorage ? 'border-[#e20626] bg-c-red-soft' : 'border-c-border2 bg-c-surface hover:bg-c-surface2'
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
                  className="h-4 w-4 accent-[#e20626]"
                />
                <div>
                  <p className="text-sm font-medium text-c-text">No, compute does not write back to storage</p>
                  <p className="text-xs text-c-muted">Common for AI/GPU workflows where models or artifacts stay in compute.</p>
                </div>
              </label>
            </div>
          </div>
        )}

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

            {/* Alliance toggle: a checked checkbox fills purple (matches the bandwidth-alliance modeling semantics). */}
            <label className="flex items-center gap-3 rounded-lg border border-c-border2 bg-c-surface p-3">
              <input
                type="checkbox"
                checked={config.computeMovingToPartner}
                onChange={(e) => onChange({
                  ...config,
                  computeMovingToPartner: e.target.checked,
                })}
                className="h-4 w-4 rounded accent-c-purple"
              />
              <div>
                <p className="text-sm font-medium text-c-text">
                  Model primary case with B2 bandwidth alliance compute
                </p>
                <p className="text-xs text-c-muted">
                  Use this only when the customer is moving the write path to a partner such as CoreWeave, Vultr, or Equinix Metal.
                </p>
              </div>
            </label>

            {/* Three states: the partner write path is baked into the primary model; it's quantified
                as optional upside (volume known but path not yet committed); or we still need the
                volume before either egress drag or upside can be sized. The two savings states use the
                green-soft success tint; the missing-volume prompt uses the amber-soft caution tint. */}
            {config.computeMovingToPartner ? (
              <div className="rounded-lg border border-c-border bg-c-green-soft p-4">
                <p className="text-sm font-semibold text-c-green">Partner compute modeled in primary savings</p>
                <p className="mt-1 text-sm text-c-text">
                  Hyperscaler-to-B2 processed-data egress is removed from the primary cost model.
                </p>
              </div>
            ) : partnerComputeScenario ? (
              <div className="rounded-lg border border-c-border bg-c-green-soft p-4">
                <p className="text-sm font-semibold text-c-green">Bandwidth alliance upside</p>
                <p className="mt-1 text-sm text-c-text">
                  Moving this write path to partner compute would avoid {formatCurrency(partnerComputeScenario.monthlyEgressAvoided)}/month and raise modeled savings to {formatCurrency(partnerComputeScenario.monthlySavings)}/month.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-c-border bg-c-amber-soft p-4">
                <p className="text-sm font-semibold text-c-amber">Processed-data volume needed</p>
                <p className="mt-1 text-sm text-c-text">
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
              {/* CDN toggle: a checked checkbox fills green because B2 -> CDN-partner egress is free. */}
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={config.usesPartnerCdn}
                  onChange={(e) => onChange({
                    ...config,
                    usesPartnerCdn: e.target.checked,
                  })}
                  className="h-4 w-4 rounded accent-c-green"
                />
                <div>
                  <p className="text-sm font-medium text-c-text">
                    Uses or Plans to Use a B2 CDN Partner (Cloudflare, Fastly, bunny.net)
                  </p>
                  <p className="text-xs text-c-muted">
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
    // Bill-derived guess sits in a purple-tinted panel to read as a system suggestion, distinct from
    // the AE's own answers; the primary "Apply" action is a solid purple button.
    <div className="rounded-xl border border-c-purple bg-c-purple-soft p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-c-purple">Bill Guess</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-c-text">
              Bill-Derived Egress Guess
            </p>
            <span className="rounded-full bg-c-purple-soft px-2 py-0.5 text-[11px] font-medium text-c-purple ring-1 ring-c-purple/40">
              {suggestion.confidence} confidence
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-c-text">{aeSummary}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1.5 rounded-md border border-c-border2 bg-c-surface px-3 py-2 text-sm font-semibold text-c-text shadow-sm hover:bg-c-surface2"
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
            className="rounded-md bg-c-purple px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Apply Bill Guess
          </button>
        </div>
      </div>

      <Collapse open={expanded}>
        <div className="mt-4 border-t border-c-purple/30 pt-4">
          <p className="text-xs leading-5 text-c-text">{suggestion.summary}</p>

          {suggestion.metrics.length > 0 && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {suggestion.metrics.map((metric) => (
                <div key={metric.label} className="rounded-md bg-c-surface p-3 ring-1 ring-c-border">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-c-purple">{metric.label}</p>
                  <p className="mt-1 text-base font-semibold text-c-text">{metric.value}</p>
                  <p className="mt-1 text-xs leading-5 text-c-muted">{metric.detail}</p>
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
      <p className="text-xs font-semibold text-c-text">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-xs leading-5 text-c-muted">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-c-purple" />
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
    // Neutral read-only "bill clues" panel: sits on the subdued surface2 tint so it reads as
    // context rather than an actionable form field.
    <div className="rounded-xl border border-c-border bg-c-surface2 p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-c-subtle">Bill Clues</p>
          <p className="mt-1 text-sm font-semibold text-c-text">
            Compute and Delivery Services Detected
          </p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-c-muted">
            Found {signals.length} bill clue{signals.length === 1 ? '' : 's'}
            {topSignalNames.length > 0 ? ` including ${topSignalNames.join(', ')}` : ''}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border border-c-border2 bg-c-surface px-3 py-2 text-sm font-semibold text-c-text shadow-sm hover:bg-c-surface2"
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
            <p className="mb-3 text-xs text-c-muted">
              {hiddenCount} more signal{hiddenCount === 1 ? '' : 's'} hidden
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {visibleSignals.map((signal) => (
              <div key={signal.service} className="min-w-0 border-l-2 border-c-border2 pl-3">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-c-text">{signal.service}</p>
                    <p className="mt-0.5 text-xs text-c-muted">
                      {formatSignalType(signal.signalType)} - {formatCurrency(signal.costUsd)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-c-surface px-2 py-0.5 text-[11px] font-medium text-c-muted ring-1 ring-c-border">
                    {signal.confidence}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-c-muted">{signal.egressHint}</p>
                {signal.regions?.length ? (
                  <p className="mt-1 truncate text-[11px] text-c-subtle">
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

type FlowEdgeTone = 'free' | 'charge' | 'neutral';
type FlowNodeKind = 'b2' | 'cloud' | 'endpoint';

interface FlowNode {
  label: string;
  detail: string;
  kind: FlowNodeKind;
}

interface FlowEdge {
  label: string;
  detail: string;
  tone: FlowEdgeTone;
}

// The diagram is always a three-node / two-edge row: a source, Backblaze B2, and the
// downstream target, with one connecting edge between each pair.
interface DataFlow {
  nodes: [FlowNode, FlowNode, FlowNode];
  edges: [FlowEdge, FlowEdge];
}

// Live diagram of the data path implied by the current answers. It pairs a node-colour legend
// (Backblaze B2 / hyperscaler / customer) with a free/chargeable/needs-input edge key so the AE
// can see at a glance which transfers are billable before trusting the savings number.
function DataFlowPreview({
  config,
  b2FreeAllowanceGb,
}: {
  config: EgressConfig;
  b2FreeAllowanceGb: number;
}) {
  const flow = getDataFlow(config, b2FreeAllowanceGb);
  // Keying the panel on the modeled case remounts it whenever the AE changes an option that
  // reshapes the path, which replays the panel pulse and the staggered node/edge enters (see
  // globals.css). The key deliberately ignores volume fields so typing doesn't restart the stagger.
  const animationKey = getFlowAnimationKey(config);

  return (
    <div
      key={animationKey}
      className="egress-flow-panel rounded-xl border border-c-border bg-c-bg p-4"
    >
      {/* Header: section eyebrow on the left, node-colour legend on the right. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-c-subtle">Modeled data flow</p>
        <div className="flex flex-wrap items-center gap-3">
          <FlowLegendItem swatchClass="bg-[#e20626]" label="Backblaze B2" />
          <FlowLegendItem swatchClass="border border-c-border2 bg-[#11113a]" label="Hyperscaler" />
          <FlowLegendItem swatchClass="border border-c-border2 bg-c-surface" label="Customer" />
        </div>
      </div>

      {/* Flow row: three nodes joined by two edge pills, revealed left to right (sequence 0-4).
          Stacks vertically on narrow screens. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <FlowNodeCard node={flow.nodes[0]} sequence={0} />
        <FlowEdgePill edge={flow.edges[0]} sequence={1} />
        <FlowNodeCard node={flow.nodes[1]} sequence={2} />
        <FlowEdgePill edge={flow.edges[1]} sequence={3} />
        <FlowNodeCard node={flow.nodes[2]} sequence={4} />
      </div>

      {/* Key: maps each edge colour to free / chargeable / needs-input. */}
      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-c-border pt-2.5">
        <FlowKeyItem arrowClass="text-c-green" label="Free path" />
        <FlowKeyItem arrowClass="text-c-red" label="Chargeable egress" />
        <FlowKeyItem arrowClass="text-c-subtle" label="Needs input" />
      </div>
    </div>
  );
}

// Coarse key for the modeled case — compute / writeback / alliance / CDN, but not the volume
// values. Used as the React key on the panel (above) so the diagram re-animates when an option
// reshapes the path, yet stays put while the AE types volumes into the fields.
function getFlowAnimationKey(config: EgressConfig): string {
  if (!config.hasHyperscalerCompute) {
    return `direct-${config.usesPartnerCdn ? 'cdn' : 'users'}`;
  }

  if (!config.hyperscalerComputeFeedsStorage) {
    return 'training';
  }

  return [
    'pipeline',
    config.computeMovingToPartner ? 'partner' : 'hyperscaler',
    config.usesPartnerCdn ? 'cdn' : 'users',
  ].join('-');
}

// A coloured swatch + label in the top-right legend, keyed to the node fills used in the row.
function FlowLegendItem({ swatchClass, label }: { swatchClass: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-c-muted">
      <span className={`h-2.5 w-2.5 rounded-[3px] ${swatchClass}`} />
      {label}
    </span>
  );
}

// A coloured arrow + label in the bottom key, keyed to the edge tones used between nodes.
function FlowKeyItem({ arrowClass, label }: { arrowClass: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-c-muted">
      <span className={`text-[13px] leading-none ${arrowClass}`}>&rarr;</span>
      {label}
    </span>
  );
}

// Node card: a centred label + detail tinted by role. Backblaze B2 nodes carry the white flame
// above the label; navy compute and neutral endpoint nodes are text-only. Cards stretch to equal
// height in the row (sm:items-stretch on the parent) and shrink past their content with min-w-0.
function FlowNodeCard({ node, sequence }: { node: FlowNode; sequence: number }) {
  const skin = flowNodeClasses(node.kind);

  return (
    <div className={`egress-flow-node ${flowDelayClass(sequence)} flex min-w-0 flex-1 flex-col items-center justify-center rounded-[10px] px-2.5 py-3 text-center ${skin.box}`}>
      {node.kind === 'b2' && (
        <Image
          src="/flame-white.png"
          alt=""
          width={9}
          height={15}
          className="mb-[5px] h-[15px] w-auto object-contain"
        />
      )}
      <p className={`text-xs font-semibold leading-tight ${skin.title}`}>{node.label}</p>
      <p className={`mt-[3px] text-[10.5px] leading-snug ${skin.sub}`}>{node.detail}</p>
    </div>
  );
}

// Edge pill: a tone-coloured arrow + bold label over a muted sub-detail. The edge tracks sit
// slightly narrower than the nodes they connect (flex-[0.85] vs flex-1).
function FlowEdgePill({ edge, sequence }: { edge: FlowEdge; sequence: number }) {
  const accent = flowEdgeAccent(edge.tone);

  return (
    <div className={`egress-flow-edge ${flowDelayClass(sequence)} flex min-w-0 flex-[0.85] flex-col items-center justify-center rounded-[10px] px-1.5 py-2 text-center ${flowEdgeSurface(edge.tone)}`}>
      <span className={`text-sm leading-none ${accent}`}>&rarr;</span>
      <p className={`mt-[3px] text-[10.5px] font-bold leading-tight ${accent}`}>{edge.label}</p>
      <p className="mt-px text-[9.5px] leading-tight text-c-muted">{edge.detail}</p>
    </div>
  );
}

// Staggered reveal: cells animate in left to right. Clamped at 4 (the last delay class) because the
// row is always five cells — node, edge, node, edge, node.
function flowDelayClass(sequence: number): string {
  return `egress-flow-delay-${Math.min(sequence, 4)}`;
}

// Builds the three-node / two-edge diagram for the current answers. The branch order mirrors the
// form's gating (no compute -> direct write; compute without writeback -> training reads; compute
// with writeback -> partner alliance vs. chargeable hyperscaler egress) so the picture always
// matches the case the cost model is scoring.
function getDataFlow(config: EgressConfig, b2FreeAllowanceGb: number): DataFlow {
  const b2OutboundEdge = getB2OutboundEdge(config, b2FreeAllowanceGb);
  const downstreamNode: FlowNode = {
    label: config.usesPartnerCdn ? 'CDN → end users' : 'End users',
    detail: 'Customer-facing',
    kind: 'endpoint',
  };

  // Case 1 — no hyperscaler compute: applications write straight to B2, then B2 serves downstream.
  if (!config.hasHyperscalerCompute) {
    return {
      nodes: [
        { label: 'Applications', detail: 'Write to object storage', kind: 'endpoint' },
        { label: 'Backblaze B2', detail: formatStoredDetail(b2FreeAllowanceGb), kind: 'b2' },
        downstreamNode,
      ],
      edges: [
        { label: 'Direct write', detail: 'No new egress', tone: 'free' },
        b2OutboundEdge,
      ],
    };
  }

  // Case 2 — compute that does not write back: training/inference reads pull out of B2 and results
  // stay in compute, so the only new traffic is the read leg checked against the free allowance.
  if (!config.hyperscalerComputeFeedsStorage) {
    const trainingEgressGb = getTrainingEgressGb(config.trainingRunsPerMonth, config.trainingDataTbPerRun);
    const trainingOverageGb = Math.max(0, trainingEgressGb - b2FreeAllowanceGb);
    const trainingReadDetail = trainingEgressGb > 0
      ? trainingOverageGb > 0
        ? `${formatCurrency(getB2EgressOverageCost(trainingOverageGb))}/mo overage`
        : `${formatVolume(trainingEgressGb / 1000)} TB/mo under 3×`
      : 'Enter runs';

    return {
      nodes: [
        { label: 'Backblaze B2', detail: 'Training data at rest', kind: 'b2' },
        { label: 'Hyperscaler compute', detail: 'GPU / training', kind: 'cloud' },
        { label: 'Results stay in compute', detail: 'Models / artifacts', kind: 'endpoint' },
      ],
      edges: [
        { label: 'Training reads', detail: trainingReadDetail, tone: trainingOverageGb > 0 ? 'charge' : 'free' },
        { label: 'No writeback', detail: 'No new egress', tone: 'free' },
      ],
    };
  }

  // Case 3 — compute writes processed data back to B2: free via a bandwidth-alliance partner, or
  // new chargeable hyperscaler egress otherwise. B2 then serves the same downstream node.
  const writebackEdge: FlowEdge = config.computeMovingToPartner
    ? { label: 'Alliance path', detail: 'Free egress', tone: 'free' }
    : config.gbPerMonthHyperscalerToB2 > 0
      ? { label: 'Chargeable egress', detail: `${formatVolume(config.gbPerMonthHyperscalerToB2 / 1000)} TB/mo writeback`, tone: 'charge' }
      : { label: 'Writeback', detail: 'Enter volume', tone: 'neutral' };

  return {
    nodes: [
      { label: 'Hyperscaler compute', detail: 'Processing pipeline', kind: 'cloud' },
      { label: 'Backblaze B2', detail: 'Processed data', kind: 'b2' },
      downstreamNode,
    ],
    edges: [writebackEdge, b2OutboundEdge],
  };
}

// Backblaze B2 holds the migrated storage in the direct-write case. The free egress allowance is a
// fixed multiple of that stored volume, so we recover the stored amount by dividing the multiple
// back out (falling back to a plain label when no allowance has been computed yet).
function formatStoredDetail(b2FreeAllowanceGb: number): string {
  const storedTb = b2FreeAllowanceGb / b2Pricing.egress.freeMultiplier / 1000;
  return storedTb > 0 ? `${formatVolume(storedTb)} TB stored` : 'Migration target';
}

// The B2 -> downstream edge: free over a partner CDN, free while served volume stays under the 3×
// allowance, otherwise priced at the B2 overage rate. Same allowance logic the cost model applies,
// so the diagram and the savings summary always agree.
function getB2OutboundEdge(config: EgressConfig, b2FreeAllowanceGb: number): FlowEdge {
  if (config.usesPartnerCdn) {
    return { label: 'Partner CDN', detail: 'Free egress', tone: 'free' };
  }

  if (config.gbPerMonthServedToUsers <= 0) {
    return { label: 'B2 egress', detail: 'Enter volume', tone: 'neutral' };
  }

  const overageGb = Math.max(0, config.gbPerMonthServedToUsers - b2FreeAllowanceGb);
  if (overageGb <= 0) {
    return { label: 'B2 egress', detail: 'Under free 3×', tone: 'free' };
  }

  return {
    label: 'B2 egress',
    detail: `${formatCurrency(getB2EgressOverageCost(overageGb))}/mo overage`,
    tone: 'charge',
  };
}

// Node skins per the data-flow design: Backblaze B2 fills brand red with the white flame, the
// hyperscaler compute node fills navy, and customer/endpoint nodes sit on the plain surface. The
// title/detail colours are returned separately so each role keeps legible text on its fill.
function flowNodeClasses(kind: FlowNodeKind): { box: string; title: string; sub: string } {
  switch (kind) {
    case 'b2':
      // Backblaze B2 = brand-red node with a soft red glow, white text.
      return {
        box: 'border border-[#e20626] bg-[#e20626] shadow-[0_4px_14px_rgba(226,6,38,0.30)]',
        title: 'text-white',
        sub: 'text-white/80',
      };
    case 'cloud':
      // Hyperscaler compute = navy node, white text.
      return {
        box: 'border border-white/15 bg-[#11113a]',
        title: 'text-white',
        sub: 'text-white/60',
      };
    case 'endpoint':
    default:
      // Customer / endpoint node on the plain surface.
      return {
        box: 'border border-c-border2 bg-c-surface',
        title: 'text-c-text',
        sub: 'text-c-subtle',
      };
  }
}

// Edge background per tone: free egress is green-soft, chargeable egress is red-soft, and anything
// still awaiting a volume stays on the neutral surface tint.
function flowEdgeSurface(tone: FlowEdgeTone): string {
  switch (tone) {
    case 'free':
      return 'bg-c-green-soft';
    case 'charge':
      return 'bg-c-red-soft';
    case 'neutral':
    default:
      return 'bg-c-surface2';
  }
}

// Arrow + label colour for each edge tone (the sub-detail always stays muted, per the design).
function flowEdgeAccent(tone: FlowEdgeTone): string {
  switch (tone) {
    case 'free':
      return 'text-c-green';
    case 'charge':
      return 'text-c-red';
    case 'neutral':
    default:
      return 'text-c-subtle';
  }
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
    // Allowance band tints with the same soft semantic tokens as the cost summary: neutral while
    // empty, green-soft when usage fits the free allowance, amber-soft when it spills into overage.
    <div className={`rounded-lg border p-4 ${
      !hasEgressInput
        ? 'border-c-border bg-c-surface2'
        : overageTb > 0
          ? 'border-c-border bg-c-amber-soft'
          : 'border-c-border bg-c-green-soft'
    }`}>
      <p className={`text-sm font-semibold ${
        !hasEgressInput
          ? 'text-c-text'
          : overageTb > 0
            ? 'text-c-amber'
            : 'text-c-green'
      }`}>
        {hasEgressInput
          ? overageTb > 0
            ? 'B2 egress exceeds the free allowance'
            : 'B2 egress fits under the free allowance'
          : 'Enter outbound B2 usage'}
      </p>
      <p className={`mt-1 text-sm ${
        !hasEgressInput
          ? 'text-c-muted'
          : overageTb > 0
            ? 'text-c-text'
            : 'text-c-text'
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

      {/* Same soft-token tinting as the served-data allowance band: neutral, then green/amber by overage. */}
      <div className={`rounded-lg border p-4 ${
        !hasTrainingInputs
          ? 'border-c-border bg-c-surface2'
          : overageTb > 0
            ? 'border-c-border bg-c-amber-soft'
            : 'border-c-border bg-c-green-soft'
      }`}>
        <p className={`text-sm font-semibold ${
          !hasTrainingInputs
            ? 'text-c-text'
            : overageTb > 0
              ? 'text-c-amber'
              : 'text-c-green'
        }`}>
          {hasTrainingInputs
            ? overageTb > 0
              ? 'Training reads exceed the B2 free allowance'
              : 'Training reads fit under the B2 free allowance'
            : 'Enter training run assumptions'}
        </p>
        <p className={`mt-1 text-sm ${
          !hasTrainingInputs
            ? 'text-c-muted'
            : overageTb > 0
              ? 'text-c-text'
              : 'text-c-text'
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
    // Labeled field card: subdued surface2 wrapper around a design-system input. The big number is
    // set in the display face; the input row borders red on focus to match the brand.
    <div className="rounded-lg border border-c-border bg-c-surface2 p-3">
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-c-subtle">
        {label}
      </label>
      <div className="flex items-center rounded-md border border-c-border2 bg-c-bg shadow-sm focus-within:border-[#e20626] focus-within:ring-2 focus-within:ring-[#e20626]/20">
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
          className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 font-display text-lg font-bold text-c-text outline-none placeholder:text-c-subtle"
          placeholder={placeholder}
        />
        <span className="pr-3 text-xs font-semibold uppercase tracking-wide text-c-subtle">{unit}</span>
      </div>
      <p className="mt-2 text-xs text-c-subtle">{helperText}</p>
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
