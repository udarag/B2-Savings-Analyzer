import { NextResponse } from 'next/server';
import { v4 as uuid } from 'uuid';
import { listAnalyses, saveAnalysisMeta, getParsedBill, getLatestSnapshot } from '@/lib/storage/storage';
import { requireUser } from '@/lib/auth/session';
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
  const userEmail = await requireUser();
  const analyses = await listAnalyses(userEmail);

  const summaries: AnalysisSummary[] = await Promise.all(
    analyses.map(async (a) => {
      const [parsed, snapshot] = await Promise.all([
        getParsedBill(userEmail, a.id),
        getLatestSnapshot(userEmail, a.id),
      ]);
      return {
        ...a,
        hasBill: parsed !== null,
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
    }),
  );

  return NextResponse.json(summaries);
}

export async function POST(req: Request) {
  const userEmail = await requireUser();
  const body = await req.json();
  const id = uuid();
  const now = new Date().toISOString();

  const meta: Analysis = {
    id,
    prospectName: body.prospectName || 'Untitled',
    notes: body.notes,
    provider: body.provider || 'aws',
    billType: body.billType || 'detailed-statement',
    createdAt: now,
    updatedAt: now,
  };

  await saveAnalysisMeta(userEmail, id, meta);
  return NextResponse.json(meta, { status: 201 });
}
