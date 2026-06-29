import { NextResponse } from 'next/server';
import {
  getAnalysisMeta,
  getParsedBill,
  getModelConfig,
  saveReportSnapshot,
  getUserProfile,
} from '@/lib/storage/storage';
import { getSessionUser } from '@/lib/auth/session';
import { storageErrorResponse } from '@/lib/api/route-helpers';
import { buildAnalysisSnapshot } from '@/lib/analysis/rerun';
import { buildReportFilename } from '@/lib/report-filename';
import { getAppBaseUrl } from '@/lib/app-base-url';
import type { Analysis, ParsedBill, ModelConfig } from '@/types/analysis';

/**
 * Render the customer-facing report to a PDF. Drives a headless browser to the report page and
 * prints it, rather than re-deriving layout server-side, so the PDF is pixel-identical to what the
 * AE sees on screen. Returns the PDF as a file attachment.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  // Forwarded to the headless browser so it loads the report page as the same authenticated AE.
  const cookieHeader = req.headers.get('cookie') || '';

  let loaded: [Analysis | null, ParsedBill | null, ModelConfig | null];
  try {
    loaded = await Promise.all([
      getAnalysisMeta(userEmail, id),
      getParsedBill(userEmail, id),
      getModelConfig(userEmail, id),
    ]);
  } catch (error) {
    return storageErrorResponse(error, `Failed to load analysis ${id} for PDF`);
  }
  const [meta, parsed, modelConfig] = loaded;

  if (!meta) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Record the exact figures going out the door as a snapshot before printing — a downloaded PDF is
  // a customer artifact, so we want an audit record of what it contained. Best-effort: a snapshot
  // failure must not block the download.
  if (parsed && modelConfig) {
    try {
      const { snapshot } = buildAnalysisSnapshot({
        analysisId: id,
        parsed,
        modelConfig,
        trigger: 'pdf-download',
      });
      await saveReportSnapshot(userEmail, id, snapshot);
    } catch {
      // Non-critical — don't fail PDF generation if snapshot fails
    }
  }

  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const baseUrl = getAppBaseUrl();
    const url = new URL(baseUrl);

    // Replay the caller's cookies into the browser context so the report page authenticates as this
    // AE. rest.join('=') preserves '=' chars inside the value (e.g. base64 session tokens).
    const sessionCookies = cookieHeader.split(';').map(c => c.trim()).filter(Boolean).map(c => {
      const [name, ...rest] = c.split('=');
      return { name: name.trim(), value: rest.join('='), domain: url.hostname, path: '/' };
    });

    const context = await browser.newContext();
    if (sessionCookies.length) await context.addCookies(sessionCookies);
    const page = await context.newPage();

    // Stamp the AE's identity (name/title) onto the report via query params so the customer-facing
    // PDF is signed by a person, not just an email.
    const profile = await getUserProfile(userEmail);
    const reportParams = new URLSearchParams({ ae: userEmail });
    if (profile?.displayName) reportParams.set('aeName', profile.displayName);
    if (profile?.title) reportParams.set('aeTitle', profile.title);
    await page.goto(`${baseUrl}/analyses/${id}/report?${reportParams}`, {
      waitUntil: 'networkidle',
    });

    // Settle late client-side rendering (charts/fonts) that finishes after networkidle, so they
    // aren't captured half-drawn.
    await page.waitForTimeout(1000);

    // scale 0.94 and these margins are tuned so the report's fixed-width layout fits US Letter
    // without overflow clipping; printBackground keeps the branded fills/colors.
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      scale: 0.94,
      margin: { top: '0.5in', bottom: '0.5in', left: '0.65in', right: '0.65in' },
    });

    await context.close();
    await browser.close();

    const filename = buildReportFilename(meta);

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error('PDF generation failed:', e);
    return NextResponse.json(
      { error: 'PDF generation failed. Make sure Playwright browsers are installed.' },
      { status: 500 },
    );
  }
}
