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

export interface AnalysisSummary extends Analysis {
  hasBill: boolean;
  latestSnapshot: {
    createdAt: string;
    monthlySavings: number;
    annualSavings: number;
    savingsPercent: number;
    totalStorageGb: number;
  } | null;
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
              createdAt: snapshot.createdAt,
              monthlySavings: snapshot.monthlySavings,
              annualSavings: snapshot.annualSavings,
              savingsPercent: snapshot.savingsPercent,
              totalStorageGb: snapshot.totalStorageGb,
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
