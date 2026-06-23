import type { ComputeSignal, EgressProfileMetric, EgressProfileSuggestion, ParsedLineItem } from '@/types/analysis';

interface Aggregate {
  costUsd: number;
  gb: number;
}

interface QuantityAggregate {
  costUsd: number;
  quantity: number;
}

export function buildEgressProfileSuggestion(
  lineItems: ParsedLineItem[],
  computeSignals: ComputeSignal[] = [],
): EgressProfileSuggestion | undefined {
  const internet = aggregateItems(lineItems, (item) =>
    item.category === 'egress' && item.subcategory === 'Internet Egress'
  );
  const interRegionOut = aggregateItems(lineItems, (item) =>
    item.category === 'egress' &&
    item.subcategory === 'Inter-region Transfer' &&
    item.sku.includes('-AWS-Out-Bytes')
  );
  const intraRegion = aggregateItems(lineItems, (item) =>
    item.category === 'out-of-scope' && item.subcategory === 'Intra-region Transfer'
  );
  const natGateway = aggregateItems(lineItems, (item) =>
    item.description.toLowerCase().includes('nat gateway') &&
    item.usageUnit?.toLowerCase() === 'gb'
  );
  const s3Retrieval = aggregateItems(lineItems, (item) =>
    isS3Service(item.service) && item.category === 'retrieval'
  );
  const s3ManagedProcessing = aggregateItems(lineItems, (item) => {
    const text = `${item.sku} ${item.description}`.toLowerCase();
    return isS3Service(item.service) && (
      text.includes('select-') ||
      text.includes('processedbytes') ||
      text.includes('bytes processed by s3 vectors')
    );
  });
  const analyticsScan = aggregateItems(lineItems, (item) => {
    const text = `${item.service} ${item.sku} ${item.description}`.toLowerCase();
    return text.includes('athena') && text.includes('datascanned');
  });
  const writeRequests = aggregateQuantity(lineItems, (item) =>
    isS3Service(item.service) &&
    item.category === 'operations' &&
    item.subcategory === 'PUT/COPY/POST/LIST' &&
    isRequestUnit(item.usageUnit)
  );
  const readRequests = aggregateQuantity(lineItems, (item) =>
    isS3Service(item.service) &&
    item.category === 'operations' &&
    ['GET/SELECT', 'Standard-IA Requests', 'One Zone-IA Requests', 'Glacier Deep Archive Requests', 'Glacier IR Requests'].includes(item.subcategory || '') &&
    isRequestUnit(item.usageUnit)
  );

  const hasCompute = computeSignals.some((signal) =>
    ['compute', 'container', 'serverless', 'ai-ml', 'analytics', 'database'].includes(signal.signalType)
  );
  const hasDataPipelineSignals = computeSignals.some((signal) =>
    ['container', 'serverless', 'ai-ml', 'analytics'].includes(signal.signalType)
  );
  const hasCloudFront = lineItems.some((item) =>
    item.service.toLowerCase().includes('cloudfront') ||
    item.description.toLowerCase().includes('cloudfront')
  );
  const likelyStorageReadOrProcessingGb = s3Retrieval.gb + s3ManagedProcessing.gb + analyticsScan.gb;
  const hasWriteRequestSignal = writeRequests.quantity >= 100_000;
  const hasReadOrProcessingSignal = likelyStorageReadOrProcessingGb > 100 || readRequests.quantity >= 100_000;
  const likelyComputeStorageWorkflow = hasDataPipelineSignals && (hasWriteRequestSignal || hasReadOrProcessingSignal);

  if (!hasCompute && internet.gb <= 0 && interRegionOut.gb <= 0) {
    return undefined;
  }

  const metrics: EgressProfileMetric[] = [];
  if (internet.gb > 0 || internet.costUsd > 0) {
    metrics.push({
      label: 'Internet egress',
      value: `${formatTb(internet.gb)} TB/mo`,
      detail: `${formatUsd(internet.costUsd)}/mo currently billed as internet data transfer out.`,
    });
  }
  if (interRegionOut.gb > 0 || interRegionOut.costUsd > 0) {
    metrics.push({
      label: 'Inter-region egress',
      value: `${formatTb(interRegionOut.gb)} TB/mo`,
      detail: `${formatUsd(interRegionOut.costUsd)}/mo across AWS region-to-region transfer rows.`,
    });
  }
  if (intraRegion.gb > 0 || intraRegion.costUsd > 0) {
    metrics.push({
      label: 'Regional/AZ transfer',
      value: `${formatTb(intraRegion.gb)} TB/mo`,
      detail: `${formatUsd(intraRegion.costUsd)}/mo in regional, AZ, elastic IP, or ELB transfer rows.`,
    });
  }
  if (natGateway.gb > 0 || natGateway.costUsd > 0) {
    metrics.push({
      label: 'NAT processing',
      value: `${formatTb(natGateway.gb)} TB/mo`,
      detail: `${formatUsd(natGateway.costUsd)}/mo in NAT Gateway data processing rows.`,
    });
  }
  if (s3Retrieval.gb > 0 || s3Retrieval.costUsd > 0) {
    metrics.push({
      label: 'S3 retrieval',
      value: `${formatTb(s3Retrieval.gb)} TB/mo`,
      detail: `${formatUsd(s3Retrieval.costUsd)}/mo in retrieval-fee rows; identifies storage reads, not the requester.`,
    });
  }
  if (s3ManagedProcessing.gb + analyticsScan.gb > 0 || s3ManagedProcessing.costUsd + analyticsScan.costUsd > 0) {
    metrics.push({
      label: 'Managed processing',
      value: `${formatTb(s3ManagedProcessing.gb + analyticsScan.gb)} TB/mo`,
      detail: 'S3 Select/Tables/Vectors or Athena scan bytes; useful workload evidence, not EC2-to-S3 transfer.',
    });
  }
  if (writeRequests.quantity > 0) {
    metrics.push({
      label: 'Write-class requests',
      value: formatCount(writeRequests.quantity),
      detail: 'PUT/COPY/POST/LIST-class S3 requests; proves write activity but not payload GB.',
    });
  }

  const topComputeSignals = computeSignals.slice(0, 4);
  const evidence = [
    internet.gb > 0
      ? `${formatTb(internet.gb)} TB/mo of current internet egress (${formatUsd(internet.costUsd)}/mo).`
      : '',
    s3Retrieval.gb > 0
      ? `${formatTb(s3Retrieval.gb)} TB/mo of billable S3 retrieval activity.`
      : '',
    writeRequests.quantity > 0
      ? `${formatCount(writeRequests.quantity)} write-class S3 requests.`
      : '',
    topComputeSignals.length > 0
      ? `Compute/data-path services present: ${topComputeSignals.map((signal) => signal.service).join(', ')}.`
      : '',
    hasCloudFront
      ? 'CloudFront rows are present, so a CDN path should be confirmed before modeling B2 outbound overage.'
      : '',
  ].filter(Boolean);

  const assumptions = [
    internet.gb > 0
      ? `Pre-fill B2 external served volume at ${formatTb(internet.gb)} TB/mo from billable AWS internet data-transfer-out.`
      : 'Leave B2 external served volume at 0 because the bill has no billable internet data-transfer-out volume.',
    hasCompute
      ? `Pre-select hyperscaler compute because the bill includes ${topComputeSignals.map((signal) => signal.service).join(', ') || 'compute services'}.`
      : 'Do not pre-select hyperscaler compute; no compute service signal was found.',
    likelyComputeStorageWorkflow
      ? 'Pre-select a compute-to-storage workflow shape because data-processing services and S3 read/write signals appear together.'
      : 'Do not pre-select processed writeback from compute; the bill has insufficient read/write workflow evidence.',
    hasCloudFront
      ? 'Do not assume a B2 CDN partner just because CloudFront is present.'
      : 'Do not assume a B2 CDN partner unless the customer confirms one.',
  ];

  const questions = [
    'The bill does not expose EC2/ECS/SageMaker-to-S3 payload GB by bucket or prefix.',
    'S3 request counts show read/write activity, but AWS billing does not include bytes per PUT/GET for standard request rows.',
    'NAT, regional/AZ, and inter-region transfer rows show architecture pressure, but not whether the destination is S3.',
    'Keep processed data written from hyperscaler compute to B2 at 0 until S3 request metrics, access logs, VPC Flow Logs, or customer telemetry provide a monthly GB value.',
  ];

  return {
    confidence: internet.gb > 0 && hasCompute ? 'medium' : 'low',
    summary: buildSummary(
      internet,
      hasCompute,
      likelyComputeStorageWorkflow,
      hasCloudFront,
      s3Retrieval,
      writeRequests,
    ),
    suggestedConfig: {
      hasHyperscalerCompute: hasCompute,
      hyperscalerComputeFeedsStorage: likelyComputeStorageWorkflow,
      computeStaysInHyperscaler: likelyComputeStorageWorkflow,
      computeMovingToPartner: false,
      gbPerMonthHyperscalerToB2: 0,
      gbPerMonthServedToUsers: Math.round(internet.gb * 100) / 100,
      usesPartnerCdn: false,
    },
    metrics,
    evidence,
    assumptions,
    questions,
  };
}

function aggregateItems(
  lineItems: ParsedLineItem[],
  predicate: (item: ParsedLineItem) => boolean,
): Aggregate {
  return lineItems.filter(predicate).reduce(
    (sum, item) => ({
      costUsd: sum.costUsd + item.costUsd,
      gb: sum.gb + quantityToGb(item.usageQuantity || 0, item.usageUnit),
    }),
    { costUsd: 0, gb: 0 },
  );
}

function aggregateQuantity(
  lineItems: ParsedLineItem[],
  predicate: (item: ParsedLineItem) => boolean,
): QuantityAggregate {
  return lineItems.filter(predicate).reduce(
    (sum, item) => ({
      costUsd: sum.costUsd + item.costUsd,
      quantity: sum.quantity + (item.usageQuantity || 0),
    }),
    { costUsd: 0, quantity: 0 },
  );
}

function buildSummary(
  internet: Aggregate,
  hasCompute: boolean,
  likelyComputeStorageWorkflow: boolean,
  hasCloudFront: boolean,
  s3Retrieval: Aggregate,
  writeRequests: QuantityAggregate,
): string {
  const pieces = [];
  if (internet.gb > 0) {
    pieces.push(`${formatTb(internet.gb)} TB/mo of billable internet egress can pre-fill external served volume`);
  }
  if (hasCompute) {
    pieces.push('hyperscaler compute is present');
  }
  if (likelyComputeStorageWorkflow) {
    pieces.push('storage read/write signals make a compute-to-storage workflow likely');
  }
  if (s3Retrieval.gb > 0) {
    pieces.push(`${formatTb(s3Retrieval.gb)} TB/mo of S3 retrieval supports an active read path`);
  }
  if (writeRequests.quantity > 0) {
    pieces.push(`${formatCount(writeRequests.quantity)} write-class requests support an active write path`);
  }
  if (hasCloudFront) {
    pieces.push('CloudFront is present but not treated as a B2 partner CDN');
  }

  return pieces.length
    ? `${pieces.join('; ')}.`
    : 'The bill gives limited egress evidence; keep the egress profile mostly empty until customer telemetry is available.';
}

function isS3Service(service: string): boolean {
  return service.includes('Simple Storage Service') || service.includes('S3 Glacier');
}

function isRequestUnit(unit?: string): boolean {
  return unit?.toLowerCase() === 'requests' || unit?.toLowerCase() === 'request';
}

function quantityToGb(quantity: number, unit?: string): number {
  const normalized = unit?.toLowerCase();
  if (normalized === 'gb') return quantity;
  if (normalized === 'tb' || normalized === 'terabytes' || normalized === 'terabyte') return quantity * 1000;
  return 0;
}

function formatTb(gb: number): string {
  const tb = gb / 1000;
  if (!Number.isFinite(tb)) return '0';
  return Number.isInteger(tb) ? String(tb) : String(Number(tb.toFixed(2)));
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}
