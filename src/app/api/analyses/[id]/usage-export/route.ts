import { NextResponse } from 'next/server';
import { getAnalysisMeta, uploadFile } from '@/lib/storage/storage';
import { getSessionUser } from '@/lib/auth/session';
import { storageErrorResponse } from '@/lib/api/route-helpers';
import { extractPdfText } from '@/lib/parsers/pdf-text';
import { parseUsagePdfText } from '@/lib/analysis/usage-pdf-parse';
import { isUsageScreenshotParsingEnabled, parseUsageScreenshot } from '@/lib/analysis/usage-screenshot-parse';

/**
 * Accepts a customer's B2 usage export and pre-fills the commit-upsell form from it. Two input
 * shapes, in order of preference:
 *  - A PDF printed from Bzadmin's Usage page (the default): parsed deterministically via pdftotext,
 *    so it needs no API key and the data never leaves the box.
 *  - A screenshot image: read via Claude vision, only when ANTHROPIC_API_KEY is configured.
 * The file is always stored regardless. Parsing is best-effort: on any failure the client falls
 * back to manual entry, so this never blocks the AE.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const meta = await getAnalysisMeta(userEmail, id);
  if (!meta) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    await uploadFile(userEmail, id, file.name, buffer, file.type);
  } catch (error) {
    return storageErrorResponse(error, `Failed to store usage export for ${id}`);
  }

  const isPdf = file.type === 'application/pdf'
    || file.name.toLowerCase().endsWith('.pdf')
    || buffer.subarray(0, 4).toString('latin1') === '%PDF';

  if (isPdf) {
    // Deterministic — no API key, no egress. This is the default AE workflow (print Bzadmin's Usage
    // page to PDF and upload it here).
    try {
      const parsed = parseUsagePdfText(extractPdfText(buffer));
      if (parsed) return NextResponse.json({ status: 'parsed', parsed });
    } catch (error) {
      console.error(`Failed to parse usage PDF for ${id}:`, error);
    }
    return NextResponse.json({
      status: 'failed',
      message: "Couldn't read this PDF — please enter the numbers below.",
    });
  }

  // Image fallback: Claude vision, only when configured.
  if (!isUsageScreenshotParsingEnabled()) {
    return NextResponse.json({
      status: 'unavailable',
      message: "Reading screenshots isn't set up here — upload the PDF export instead, or enter the numbers below.",
    });
  }

  const mediaType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const parsed = await parseUsageScreenshot(buffer.toString('base64'), mediaType);
  if (!parsed) {
    return NextResponse.json({
      status: 'failed',
      message: "Couldn't read this screenshot — please enter the numbers below.",
    });
  }

  return NextResponse.json({ status: 'parsed', parsed });
}
