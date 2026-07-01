import { NextResponse } from 'next/server';
import { getAnalysisMeta, uploadFile } from '@/lib/storage/storage';
import { getSessionUser } from '@/lib/auth/session';
import { storageErrorResponse } from '@/lib/api/route-helpers';
import { isUsageScreenshotParsingEnabled, parseUsageScreenshot } from '@/lib/analysis/usage-screenshot-parse';

/**
 * Accepts a screenshot of a customer's B2 usage summary, stores it, and — when an Anthropic API key
 * is configured — extracts the usage numbers via Claude vision so the form can pre-fill. Extraction
 * is best-effort: with no key, or on a parse failure, the client falls back to manual entry, so this
 * never blocks the AE. The image is always stored regardless, so a later run can reprocess it.
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
  const mediaType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';

  const meta = await getAnalysisMeta(userEmail, id);
  if (!meta) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    await uploadFile(userEmail, id, file.name, buffer, file.type);
  } catch (error) {
    return storageErrorResponse(error, `Failed to store usage screenshot for ${id}`);
  }

  if (!isUsageScreenshotParsingEnabled()) {
    return NextResponse.json({
      status: 'unavailable',
      message: "Screenshot reading isn't set up on this deployment — please enter the numbers below.",
    });
  }

  const parsed = await parseUsageScreenshot(buffer.toString('base64'), mediaType);
  if (!parsed) {
    return NextResponse.json({
      status: 'failed',
      message: "Couldn't read this screenshot — please enter the numbers below.",
    });
  }

  return NextResponse.json({ status: 'parsed', parsed });
}
