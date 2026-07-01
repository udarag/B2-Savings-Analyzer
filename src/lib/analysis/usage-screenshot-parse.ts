// Server-only. Extracts B2 usage numbers from a *screenshot* (image) of a customer's usage summary
// via Claude vision, for AEs who only have an image rather than a printed PDF. The deterministic PDF
// path (usage-pdf-parse.ts) is preferred and needs no API key; this is the image fallback. Never
// import this from client code — it pulls in the Anthropic SDK and reads ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';
import { deriveUsageFields, toPositiveNumber, type ParsedUsageFields, type RawExtraction } from './usage-fields';

/** True when a screenshot parse can actually run (an API key is configured). */
export function isUsageScreenshotParsingEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
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
 * Extract usage fields from a screenshot image. Returns null when parsing is disabled (no API key)
 * or fails — the caller falls back to manual entry, so a failure here is never fatal.
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
