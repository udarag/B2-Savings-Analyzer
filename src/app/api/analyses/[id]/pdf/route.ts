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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
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

  // Save a snapshot of the current analysis state
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

    const sessionCookies = cookieHeader.split(';').map(c => c.trim()).filter(Boolean).map(c => {
      const [name, ...rest] = c.split('=');
      return { name: name.trim(), value: rest.join('='), domain: url.hostname, path: '/' };
    });

    const context = await browser.newContext();
    if (sessionCookies.length) await context.addCookies(sessionCookies);
    const page = await context.newPage();

    const profile = await getUserProfile(userEmail);
    const reportParams = new URLSearchParams({ ae: userEmail });
    if (profile?.displayName) reportParams.set('aeName', profile.displayName);
    if (profile?.title) reportParams.set('aeTitle', profile.title);
    await page.goto(`${baseUrl}/analyses/${id}/report?${reportParams}`, {
      waitUntil: 'networkidle',
    });

    await page.waitForTimeout(1000);

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
