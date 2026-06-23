import type { Analysis } from '@/types/analysis';

const PROVIDER_LABELS: Record<Analysis['provider'], string> = {
  aws: 'AWS',
  gcp: 'Google-Cloud',
  azure: 'Azure',
  r2: 'Cloudflare-R2',
};

export function buildReportFilename(meta: Pick<Analysis, 'prospectName' | 'companyName' | 'provider' | 'billingPeriod'>, generatedAt = new Date()): string {
  const parts = [
    sanitizeFilenamePart(meta.companyName || meta.prospectName, 'Prospect'),
    'B2-Savings-Report',
    PROVIDER_LABELS[meta.provider],
    meta.billingPeriod ? sanitizeFilenamePart(meta.billingPeriod, '') : '',
    formatDatePart(generatedAt),
  ].filter(Boolean);

  return `${parts.join('-')}.pdf`;
}

export function getFilenameFromContentDisposition(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;

  const encodedMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    const decoded = safeDecodeURIComponent(encodedMatch[1]);
    if (decoded) return normalizePdfFilename(decoded);
  }

  const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  if (filenameMatch?.[1]) {
    return normalizePdfFilename(filenameMatch[1]);
  }

  return null;
}

function sanitizeFilenamePart(value: string, fallback: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return sanitized || fallback;
}

function normalizePdfFilename(filename: string): string | null {
  const basename = filename.split(/[\\/]/).pop()?.trim();
  if (!basename) return null;

  const withoutExtension = basename.replace(/\.pdf$/i, '');
  const sanitized = sanitizeFilenamePart(withoutExtension, 'B2-Savings-Report');
  return `${sanitized}.pdf`;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function formatDatePart(date: Date): string {
  return date.toISOString().slice(0, 10);
}
