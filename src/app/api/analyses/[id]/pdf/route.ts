import { NextResponse } from 'next/server';
import { v4 as uuid } from 'uuid';
import {
  getAnalysisMeta,
  getParsedBill,
  getModelConfig,
  saveReportSnapshot,
  getUserProfile,
} from '@/lib/storage/storage';
import { requireUser } from '@/lib/auth/session';
import { buildTierInventory } from '@/lib/engine/tier-inventory';
import { applyTierSelectionConfig } from '@/lib/engine/tier-selection';
import { computeCostModel } from '@/lib/engine/cost-model';
import { normalizeEgressConfig } from '@/types/analysis';
import type { ReportSnapshot } from '@/types/model';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await requireUser();
  const { id } = await params;
  const cookieHeader = req.headers.get('cookie') || '';

  const [meta, parsed, modelConfig] = await Promise.all([
    getAnalysisMeta(userEmail, id),
    getParsedBill(userEmail, id),
    getModelConfig(userEmail, id),
  ]);

  if (!meta) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Save a snapshot of the current analysis state
  if (parsed && modelConfig) {
    try {
      const tiers = applyTierSelectionConfig(
        buildTierInventory(parsed.lineItems, modelConfig.b2PricePerTb),
        modelConfig,
      );
      const egressConfig = normalizeEgressConfig(modelConfig.egressConfig);
      const costModel = computeCostModel(
        parsed.lineItems, tiers, egressConfig, modelConfig.b2PricePerTb,
      );
      const migratedTiers = tiers.filter((t) => t.migrateToB2);

      const snapshot: ReportSnapshot = {
        id: uuid(),
        analysisId: id,
        createdAt: new Date().toISOString(),
        trigger: 'pdf-download',
        monthlySavings: costModel.monthlySavings,
        annualSavings: costModel.annualSavings,
        savingsPercent: costModel.savingsPercent,
        totalStorageGb: migratedTiers.reduce((s, t) => s + t.gbStored, 0),
        migratedTierCount: migratedTiers.length,
        b2PricePerTb: modelConfig.b2PricePerTb,
        termMonths: modelConfig.projectionTermMonths,
        growthMode: egressConfig.dataGrowthMode,
        growthRatePercent: egressConfig.dataGrowthRatePercent,
        growthFixedTbPerMonth: egressConfig.dataGrowthFixedTbPerMonth,
        udmEnabled: egressConfig.udmEnabled,
      };
      await saveReportSnapshot(userEmail, id, snapshot);
    } catch {
      // Non-critical — don't fail PDF generation if snapshot fails
    }
  }

  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
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
      margin: { top: '0.5in', bottom: '0.5in', left: '0.65in', right: '0.65in' },
    });

    await context.close();
    await browser.close();

    const filename = `${meta.prospectName.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '-')}-B2-Analysis.pdf`;

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
