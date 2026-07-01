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

// Just the headline figures the analyses-list cards render — keeps the list payload small instead
// of shipping the full snapshot for every analysis.
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

/** An analysis enriched for the list view with whether a bill is uploaded and its latest saved snapshot. */
export interface AnalysisSummary extends Analysis {
  /** Whether a parsed bill exists yet — drives the "needs upload" vs. ready state in the list. */
  hasBill: boolean;
  latestSnapshot: AnalysisSummarySnapshot | null;
}

/** List the signed-in AE's analyses, each enriched with bill status and latest-snapshot headlines. */
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

  // Two extra storage reads per analysis (bill presence + latest snapshot); bound the fan-out so a
  // large list doesn't open a read per analysis all at once. Per-item failures degrade to
  // false/null rather than failing the whole list.
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

/** Create an empty analysis (metadata only) for the AE to upload a bill into next. */
export async function POST(req: Request) {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const id = uuid();
  const now = new Date().toISOString();

  // Provider/billType are seeded from the create form but are authoritative only as defaults — the
  // upload step overwrites them with what the parser actually detected from the bill.
  const meta: Analysis = {
    id,
    prospectName: body.prospectName || 'Untitled',
    companyName: body.companyName || body.prospectName || 'Untitled',
    notes: body.notes,
    provider: body.provider || 'aws',
    billType: body.billType || 'detailed-statement',
    pipelineStatus: 'open',
    // Fulfilled by the upload route once a bill is parsed — there's no parsed bill to clone yet.
    pendingOverdriveVariant: body.createOverdriveVariant ? true : undefined,
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

// Run `mapper` over `items` with at most `limit` in flight, preserving input order in the result.
// Workers share a cursor (nextIndex) and pull the next item until the list is drained.
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
