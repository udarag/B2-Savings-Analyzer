import type { ComputeSignal, ComputeSignalConfidence, ComputeSignalType } from '@/types/analysis';

export interface AwsComputeSignalInput {
  name: string;
  amountUsd: number;
  regions?: string[];
  evidence?: string[];
}

interface AwsComputeSignalRule {
  service: string;
  signalType: ComputeSignalType;
  egressHint: string;
  confidence: ComputeSignalConfidence;
}

const MAX_COMPUTE_SIGNALS = 12;

export function buildAwsComputeSignals(inputs: AwsComputeSignalInput[]): ComputeSignal[] {
  const signals = new Map<string, ComputeSignal>();

  for (const input of inputs) {
    const rule = classifyAwsComputeSignal(input.name);
    if (!rule || input.amountUsd <= 0) continue;

    const existing = signals.get(rule.service);
    const evidence = input.evidence?.length ? input.evidence : [`Bill line: ${input.name}`];
    const regions = input.regions?.filter(Boolean) || [];

    if (existing) {
      existing.costUsd += input.amountUsd;
      existing.regions = mergeUnique(existing.regions || [], regions).slice(0, 5);
      existing.evidence = mergeUnique(existing.evidence, evidence).slice(0, 4);
      existing.confidence = strongerConfidence(existing.confidence, rule.confidence);
      continue;
    }

    signals.set(rule.service, {
      provider: 'aws',
      service: rule.service,
      signalType: rule.signalType,
      costUsd: input.amountUsd,
      regions: regions.length ? mergeUnique([], regions).slice(0, 5) : undefined,
      evidence: mergeUnique([], evidence).slice(0, 4),
      egressHint: rule.egressHint,
      confidence: rule.confidence,
    });
  }

  return [...signals.values()]
    .map((signal) => ({
      ...signal,
      costUsd: Math.round(signal.costUsd * 100) / 100,
      regions: signal.regions?.length ? signal.regions : undefined,
    }))
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, MAX_COMPUTE_SIGNALS);
}

export function getAwsComputeSignalService(rawName: string): string | null {
  return classifyAwsComputeSignal(rawName)?.service || null;
}

function classifyAwsComputeSignal(rawName: string): AwsComputeSignalRule | null {
  const name = rawName.trim();
  const lower = name.toLowerCase();

  if (lower === 'elastic container service') {
    return {
      service: 'Elastic Container Service',
      signalType: 'container',
      confidence: 'high',
      egressHint: 'Container workloads are present. Confirm whether ECS tasks read from S3 and write processed output back to object storage.',
    };
  }

  if (lower === 'elastic compute cloud') {
    return {
      service: 'Elastic Compute Cloud',
      signalType: 'compute',
      confidence: 'high',
      egressHint: 'EC2 spend suggests application or worker compute near the data. Confirm whether instances read datasets from S3 or write generated data back to storage.',
    };
  }

  if (lower.startsWith('amazon elastic compute cloud natgateway')) {
    return {
      service: 'EC2 NAT Gateway',
      signalType: 'networking',
      confidence: 'medium',
      egressHint: 'NAT Gateway usage suggests private workloads reaching external services. Check whether storage migration changes that outbound path.',
    };
  }

  if (lower === 'lambda') {
    return {
      service: 'Lambda',
      signalType: 'serverless',
      confidence: 'medium',
      egressHint: 'Serverless functions often transform objects or serve event pipelines. Confirm whether Lambda writes artifacts to S3.',
    };
  }

  if (lower === 'elastic container registry') {
    return {
      service: 'Elastic Container Registry',
      signalType: 'container',
      confidence: 'medium',
      egressHint: 'Container image storage is present. This is usually not B2-addressable data, but it supports the container-workload signal.',
    };
  }

  if (lower === 'sagemaker' || lower === 'bedrock' || lower.includes('claude') || lower.includes('anthropic')) {
    return {
      service: lower.includes('claude') || lower.includes('anthropic') ? 'Bedrock Marketplace AI' : titleCaseService(name),
      signalType: 'ai-ml',
      confidence: 'high',
      egressHint: 'AI/ML services can read training data or produce artifacts. Confirm whether datasets move from object storage into compute and where outputs land.',
    };
  }

  if (lower === 'glue' || lower === 'athena' || lower === 'emr' || lower === 'redshift' || lower === 'quicksight') {
    return {
      service: titleCaseService(name),
      signalType: 'analytics',
      confidence: 'high',
      egressHint: 'Analytics services commonly scan object storage and write query or ETL outputs. Confirm S3 read/write volumes tied to this workload.',
    };
  }

  if (lower === 'relational database service' || lower === 'dynamodb' || lower === 'documentdb' || lower === 'elasticsearch service' || lower === 'opensearch service') {
    return {
      service: titleCaseService(name),
      signalType: 'database',
      confidence: 'medium',
      egressHint: 'Database services may export backups, logs, or analytical extracts to object storage. Confirm whether those exports are in the migration path.',
    };
  }

  if (lower === 'cloudfront') {
    return {
      service: 'CloudFront',
      signalType: 'delivery',
      confidence: 'high',
      egressHint: 'CloudFront indicates content delivery. Confirm whether B2 would serve through a bandwidth alliance CDN path.',
    };
  }

  if (lower === 'elastic load balancing' || lower === 'api gateway') {
    return {
      service: titleCaseService(name),
      signalType: 'networking',
      confidence: 'medium',
      egressHint: 'Public application entry points are present. Confirm whether end-user delivery should be modeled as B2 outbound or CDN partner traffic.',
    };
  }

  return null;
}

function titleCaseService(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word.length <= 3 && word === word.toUpperCase()
      ? word
      : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function mergeUnique<T>(base: T[], next: T[]): T[] {
  return [...new Set([...base, ...next])];
}

function strongerConfidence(a: ComputeSignalConfidence, b: ComputeSignalConfidence): ComputeSignalConfidence {
  const score: Record<ComputeSignalConfidence, number> = { low: 1, medium: 2, high: 3 };
  return score[b] > score[a] ? b : a;
}
