// Deterministic parser for a B2 usage summary PDF — the page an AE prints from Bzadmin's "Usage"
// view. Because that's a printed web page, the PDF has real extractable text (via pdftotext), so we
// read the numbers directly with no LLM, API key, or data egress. This is the preferred/default
// path; the Claude-vision screenshot parser is only for AEs who have an image instead.
import { deriveUsageFields, type ParsedUsageFields } from './usage-fields';

// Comma-or-plain decimal (e.g. "1,248,849.89" or "850.32"), NOT preceded by "$" so dollar columns
// are excluded. The usage table's volume columns are all bare GB numbers; the money columns are
// all $-prefixed, so this cleanly separates volumes from dollars regardless of layout wrapping.
const VOLUME_NUMBER = /(?<!\$)(?<![\d.])\d[\d,]*\.\d+/g;
const DOLLAR_NUMBER = /\$[\d,]+\.\d+/g;
const DATE_RANGE = /\((\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})\)/;

/**
 * Parse the pdftotext output of a B2 usage summary into the form's fields, or null if the two
 * load-bearing values (current storage and monthly spend) can't be found.
 *
 * Anchors used, in order of reliability:
 *  - Monthly spend: the last dollar amount on the "summary" row (its grand total).
 *  - Current storage: the largest volume number in the table. "total stored" is cumulative, so the
 *    latest/estimate row's value is the max; per-day upload/download figures for an established
 *    customer are far smaller. Robust for the large customers this flow targets.
 *  - Growth: derived from the total-stored trend — the earliest value is the smallest number that's
 *    still in the same magnitude cluster as the max (> half the max), which isolates the cumulative
 *    total-stored column from the per-day volumes. Best-effort; the AE reviews it.
 *  - Period: the "(YYYY-MM-DD to YYYY-MM-DD)" range in the report title.
 */
export function parseUsagePdfText(text: string): ParsedUsageFields | null {
  const lines = text.split('\n');
  const summaryLine = lines.find((line) => /\bsummary\b/i.test(line));

  const monthlyTotalSpendUsd = summaryLine ? lastDollarAmount(summaryLine) : null;
  if (monthlyTotalSpendUsd === null) return null;

  // Volume numbers from every non-summary line (the summary row's own totals aren't per-day storage).
  const volumes: number[] = [];
  for (const line of lines) {
    if (line === summaryLine) continue;
    for (const match of line.matchAll(VOLUME_NUMBER)) {
      const n = Number(match[0].replace(/,/g, ''));
      if (Number.isFinite(n) && n > 0) volumes.push(n);
    }
  }
  if (volumes.length === 0) return null;

  const latestTotalStoredGb = Math.max(...volumes);
  // The cumulative total-stored values cluster near the max; per-day volumes sit well below it.
  const storedCluster = volumes.filter((n) => n > latestTotalStoredGb * 0.5);
  const earliestTotalStoredGb = Math.min(...storedCluster);

  return deriveUsageFields({
    latestTotalStoredGb,
    earliestTotalStoredGb,
    daysInPeriod: daysInPeriodFromTitle(text),
    monthlyTotalSpendUsd,
  });
}

function lastDollarAmount(line: string): number | null {
  const matches = line.match(DOLLAR_NUMBER);
  if (!matches || matches.length === 0) return null;
  const n = Number(matches[matches.length - 1].replace(/[$,]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function daysInPeriodFromTitle(text: string): number {
  const match = text.match(DATE_RANGE);
  if (!match) return 30;
  const from = Date.parse(match[1]);
  const to = Date.parse(match[2]);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return 30;
  return Math.round((to - from) / 86_400_000);
}
