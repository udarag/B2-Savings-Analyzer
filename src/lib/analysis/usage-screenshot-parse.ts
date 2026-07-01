// Server-only. Extracts B2 usage numbers from a screenshot of a customer's B2 usage summary
// (the daily-rows + summary table AEs receive from the backend) into the fields B2UsageForm
// pre-fills, using Claude vision. Never import this from client code — it pulls in the Anthropic
// SDK and reads ANTHROPIC_API_KEY, both of which must stay server-side.
import Anthropic from '@anthropic-ai/sdk';
import type { B2UsageInput } from '@/types/analysis';

/** What the AE-facing form needs pre-filled — a subset of B2UsageInput. `source` is stamped by the caller. */
export type ParsedUsageFields = Pick<
  B2UsageInput,
  'currentStorageTb' | 'currentMonthlySpendUsd' | 'dataGrowthMode' | 'dataGrowthRatePercent' | 'dataGrowthPeriod'
>;

/** True when a screenshot parse can actually run (an API key is configured). */
export function isUsageScreenshotParsingEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Claude reads only these raw cells off the table — a small, unambiguous extraction task — and we
// derive the storage/spend/growth fields from them in code, so the model never has to do math.
export interface RawExtraction {
  /** Most recent (or estimate) row's "total stored", in GB. */
  latestTotalStoredGb: number;
  /** Oldest row's "total stored", in GB — used with latest to derive the growth trend. */
  earliestTotalStoredGb: number;
  /** Number of days the table spans (rows in the daily breakdown). */
  daysInPeriod: number;
  /** The summary-row grand "total" spend for the whole period, in USD. */
  monthlyTotalSpendUsd: number;
}

const EXTRACTION_PROMPT = `You are reading a screenshot of a Backblaze B2 usage summary. It has one row per day plus a summary row at the bottom, with columns including "total stored" (a storage volume, usually in GB) and "total" (a dollar amount).

Read these four values off the table and return ONLY a JSON object, no prose, no markdown fences:
{
  "latestTotalStoredGb": <the most recent row's "total stored" value in GB — use the top/estimate row if present, as a plain number without commas or units>,
  "earliestTotalStoredGb": <the oldest row's "total stored" value in GB, as a plain number>,
  "daysInPeriod": <how many daily rows the table covers, as an integer>,
  "monthlyTotalSpendUsd": <the summary row's grand "total" dollar amount for the whole period, as a plain number without the $ sign>
}

If a value genuinely cannot be read, use null for that field. Do not guess or fabricate numbers.`;

/**
 * Extract usage fields from a screenshot. Returns null when parsing is disabled (no API key) or
 * fails — the caller falls back to manual entry, so a failure here is never fatal.
 */
export async function parseUsageScreenshot(
  imageBase64: string,
  mediaType: 'image/png' | 'image/jpeg',
): Promise<ParsedUsageFields | null> {
  if (!isUsageScreenshotParsingEnabled()) return null;

  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
    });

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    const raw = parseRawExtraction(text);
    if (!raw) return null;

    return deriveUsageFields(raw);
  } catch (error) {
    console.error('Usage screenshot parse failed:', error);
    return null;
  }
}

// Pull the JSON object out of the model's reply (tolerant of stray prose or code fences) and confirm
// the two load-bearing numbers are usable. Storage and spend are required; the growth inputs are
// optional and only affect the derived growth rate. Exported for unit testing.
export function parseRawExtraction(text: string): RawExtraction | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }

  const latest = toPositiveNumber(obj.latestTotalStoredGb);
  const spend = toPositiveNumber(obj.monthlyTotalSpendUsd);
  if (latest === null || spend === null) return null;

  return {
    latestTotalStoredGb: latest,
    earliestTotalStoredGb: toPositiveNumber(obj.earliestTotalStoredGb) ?? latest,
    daysInPeriod: toPositiveNumber(obj.daysInPeriod) ?? 30,
    monthlyTotalSpendUsd: spend,
  };
}

// Turn the raw cell readings into the form's fields. Exported for unit testing.
export function deriveUsageFields(raw: RawExtraction): ParsedUsageFields {
  // App basis is decimal TB (1 TB = 1000 GB), matching every other TB figure in the app.
  const currentStorageTb = round2(raw.latestTotalStoredGb / 1000);

  // Annualize the observed storage trend by compounding the per-day growth over a year. Clamped to a
  // sane ceiling so a short, noisy window can't seed an absurd default; the AE reviews and edits it.
  let dataGrowthRatePercent = 10;
  if (raw.earliestTotalStoredGb > 0 && raw.daysInPeriod > 1 && raw.latestTotalStoredGb > 0) {
    const dailyRate = Math.pow(raw.latestTotalStoredGb / raw.earliestTotalStoredGb, 1 / raw.daysInPeriod) - 1;
    const annualPercent = (Math.pow(1 + dailyRate, 365) - 1) * 100;
    dataGrowthRatePercent = Math.round(Math.min(Math.max(annualPercent, 0), 300));
  }

  return {
    currentStorageTb,
    currentMonthlySpendUsd: round2(raw.monthlyTotalSpendUsd),
    dataGrowthMode: 'percent',
    dataGrowthRatePercent,
    dataGrowthPeriod: 'yearly',
  };
}

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
