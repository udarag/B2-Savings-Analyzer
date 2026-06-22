'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { EgressConfig } from '@/types/analysis';
import type { PartnerComputeScenario } from '@/types/model';
import b2Pricing from '@/lib/pricing/b2.json';
import { formatCurrency } from '../shared/FormatCurrency';

interface EgressQuestionnaireProps {
  config: EgressConfig;
  onChange: (config: EgressConfig) => void;
  partnerComputeScenario?: PartnerComputeScenario | null;
  b2FreeAllowanceGb?: number;
}

export function EgressQuestionnaire({ config, onChange, partnerComputeScenario, b2FreeAllowanceGb = 0 }: EgressQuestionnaireProps) {
  const hasPipelineStorageWrite = config.hasHyperscalerCompute && config.hyperscalerComputeFeedsStorage;
  const isTrainingWorkflow = config.hasHyperscalerCompute && !config.hyperscalerComputeFeedsStorage;

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Egress Configuration</h3>
        <p className="text-sm text-gray-500 mt-1">
          Model whether moving storage to B2 creates a new hyperscaler data-transfer path.
        </p>
      </div>
      <div className="p-6 space-y-6">
        <div>
          <p className="font-medium text-gray-900 mb-3">
            Does the customer run compute in the hyperscaler?
          </p>
          <div className="space-y-2">
            <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-gray-50 ${
              !config.hasHyperscalerCompute ? 'border-bb-red bg-bb-red-light/40' : 'border-gray-200'
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
                <p className="text-sm font-medium text-gray-900">No hyperscaler compute in the storage path</p>
                <p className="text-xs text-gray-500">Applications write directly to object storage, so no new inter-cloud egress applies.</p>
              </div>
            </label>
            <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-gray-50 ${
              config.hasHyperscalerCompute ? 'border-bb-red bg-bb-red-light/40' : 'border-gray-200'
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
                <p className="text-sm font-medium text-gray-900">Yes, compute is part of the stack</p>
                <p className="text-xs text-gray-500">Confirm whether processed data is written back to object storage.</p>
              </div>
            </label>
          </div>
        </div>

        {config.hasHyperscalerCompute && (
          <div>
            <p className="font-medium text-gray-900 mb-3">
              Does that compute write processed data back to object storage?
            </p>
            <div className="space-y-2">
              <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-gray-50 ${
                config.hyperscalerComputeFeedsStorage ? 'border-bb-red bg-bb-red-light/40' : 'border-gray-200'
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
                  <p className="text-sm font-medium text-gray-900">Yes, processed data lands in storage</p>
                  <p className="text-xs text-gray-500">Moving storage to B2 creates a hyperscaler-to-B2 write path.</p>
                </div>
              </label>
              <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-gray-50 ${
                !config.hyperscalerComputeFeedsStorage ? 'border-bb-red bg-bb-red-light/40' : 'border-gray-200'
              }`}>
                <input
                  type="radio"
                  name="hyperscalerComputeFeedsStorage"
                  checked={!config.hyperscalerComputeFeedsStorage}
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
                  <p className="text-sm font-medium text-gray-900">No, compute does not write back to storage</p>
                  <p className="text-xs text-gray-500">Common for AI/GPU workflows where models or artifacts stay in compute.</p>
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

            <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-3">
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
                <p className="text-sm font-medium text-gray-900">
                  Model primary case with B2 bandwidth alliance compute
                </p>
                <p className="text-xs text-gray-500">
                  Use this only when the customer is moving the write path to a partner such as CoreWeave, Vultr, or Equinix Metal.
                </p>
              </div>
            </label>

            {config.computeMovingToPartner ? (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                <p className="text-sm font-semibold text-green-900">Partner compute modeled in primary savings</p>
                <p className="mt-1 text-sm text-green-800">
                  Hyperscaler-to-B2 processed-data egress is removed from the primary cost model.
                </p>
              </div>
            ) : partnerComputeScenario ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-sm font-semibold text-emerald-900">Bandwidth alliance upside</p>
                <p className="mt-1 text-sm text-emerald-800">
                  Moving this write path to partner compute would avoid {formatCurrency(partnerComputeScenario.monthlyEgressAvoided)}/month and raise modeled savings to {formatCurrency(partnerComputeScenario.monthlySavings)}/month.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">Processed-data volume needed</p>
                <p className="mt-1 text-sm text-amber-800">
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
                  <p className="text-sm font-medium text-gray-900">
                    Uses or Plans to Use a B2 CDN Partner (Cloudflare, Fastly, bunny.net)
                  </p>
                  <p className="text-xs text-gray-500">
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
          ? 'text-gray-900'
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
          ? 'text-gray-500'
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
            ? 'text-gray-900'
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
            ? 'text-gray-500'
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
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => formatVolumeInput(value));
  const displayValue = focused ? draft : formatVolumeInput(value);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </label>
      <div className="flex items-center rounded-md border border-gray-300 bg-white shadow-sm focus-within:border-bb-red focus-within:ring-2 focus-within:ring-red-100">
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
          className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-lg font-bold text-bb-navy outline-none"
          placeholder={placeholder}
        />
        <span className="pr-3 text-xs font-semibold uppercase tracking-wide text-gray-400">{unit}</span>
      </div>
      <p className="mt-2 text-xs text-gray-400">{helperText}</p>
    </div>
  );
}

function formatVolumeInput(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function getTrainingEgressGb(trainingRunsPerMonth: number, trainingDataTbPerRun: number): number {
  return Math.max(0, trainingRunsPerMonth) * Math.max(0, trainingDataTbPerRun) * 1000;
}

function getB2EgressOverageCost(overageGb: number): number {
  return Math.max(0, overageGb) * b2Pricing.egress.overagePerGb;
}
