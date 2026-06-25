import { NextResponse } from 'next/server';
import { v4 as uuid } from 'uuid';
import {
  listAnalyses,
  saveAnalysisMeta,
  hasParsedBill,
  getLatestSnapshot,
  getStorageErrorDetails,
} from '@/lib/storage/storage';
import { getSessionUser } from '@/lib/auth/session';
import type { Analysis } from '@/types/analysis';
import type { ReportSnapshot } from '@/types/model';

type AnalysisSummarySnapshot = Pick<
  ReportSnapshot,
  | 'annualSavings'
  | 'totalStorageGb'
  | 'b2PricePerTb'
  | 'termMonths'
  | 'growthMode'
  | 'growthRatePercent'
  | 'growthFixedTbPerMonth'
>;

export interface AnalysisSummary extends Analysis {
  hasBill: boolean;
  latestSnapshot: AnalysisSummarySnapshot | null;
}

export async function GET() {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let analyses: Analysis[];
  try {
    analyses = await listAnalyses(userEmail);
  } catch (error) {
    console.error('Failed to list analyses:', error);
    const details = getStorageErrorDetails(error);
    return NextResponse.json(
      { error: details.message, code: details.code },
      { status: details.status },
    );
  }

  const summaries: AnalysisSummary[] = await mapWithConcurrency(
    analyses,
    8,
    async (a) => {
      const [parsed, snapshot] = await Promise.all([
        hasParsedBill(userEmail, a.id).catch(() => false),
        getLatestSnapshot(userEmail, a.id).catch(() => null),
      ]);
      return {
        ...a,
        hasBill: parsed,
        latestSnapshot: snapshot
          ? {
              annualSavings: snapshot.annualSavings,
              totalStorageGb: snapshot.totalStorageGb,
              b2PricePerTb: snapshot.b2PricePerTb,
              termMonths: snapshot.termMonths,
              growthMode: snapshot.growthMode,
              growthRatePercent: snapshot.growthRatePercent,
              growthFixedTbPerMonth: snapshot.growthFixedTbPerMonth,
            }
          : null,
      };
    },
  );

  return NextResponse.json(summaries);
}

export async function POST(req: Request) {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const id = uuid();
  const now = new Date().toISOString();

  const meta: Analysis = {
    id,
    prospectName: body.prospectName || 'Untitled',
    companyName: body.companyName || body.prospectName || 'Untitled',
    notes: body.notes,
    provider: body.provider || 'aws',
    billType: body.billType || 'detailed-statement',
    pipelineStatus: 'open',
    createdAt: now,
    updatedAt: now,
  };

  try {
    await saveAnalysisMeta(userEmail, id, meta);
  } catch (error) {
    console.error('Failed to create analysis:', error);
    const details = getStorageErrorDetails(error);
    return NextResponse.json(
      { error: details.message, code: details.code },
      { status: details.status },
    );
  }

  return NextResponse.json(meta, { status: 201 });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex]);
      }
    }),
  );

  return results;
}
