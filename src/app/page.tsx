'use client';

import { useEffect, useState, useCallback, useMemo, useRef, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AnalysisSummary } from './api/analyses/route';
import { useDocumentTitle } from '@/components/shared/useDocumentTitle';
import { AnimatedMetricValue } from '@/components/shared/AnimatedMetricValue';
import { Reveal } from '@/components/shared/Reveal';
import { projectStorageGbForMonth } from '@/lib/engine/projections';
import type { PipelineStatus } from '@/types/analysis';

const PROVIDER_LABELS: Record<string, string> = {
  aws: 'AWS',
  gcp: 'GCP',
  azure: 'Azure',
  r2: 'R2',
};

interface RerunAllResponse {
  total: number;
  rerun: number;
  skipped: number;
  failed: number;
  results: Array<{
    parsedUpdated?: boolean;
  }>;
}

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function formatGb(gb: number): string {
  if (gb >= 1000) return `${(gb / 1000).toFixed(1)} TB`;
  return `${Math.round(gb)} GB`;
}

// Storage is tracked in GB internally; display as TB (÷1000, decimal not binary) for portfolio rollups.
function formatModeledStorage(gb: number): string {
  return `${(gb / 1000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} TB`;
}

function formatInteger(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

type SummarySnapshot = NonNullable<AnalysisSummary['latestSnapshot']>;
type PipelineFilter = PipelineStatus | 'all';

const PIPELINE_FILTERS: Array<{ id: PipelineFilter; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'closed-won', label: 'Won' },
  { id: 'closed-lost', label: 'Lost' },
  { id: 'all', label: 'All' },
];
const OPPORTUNITIES_LOAD_TIMEOUT_MS = 60000;

// Estimate total contract value of the B2 *storage* line over the deal term (not full-bill TCV):
// sum each month's projected stored TB times the modeled B2 $/TB-month. Growth is compounded per
// month via the same projection helper the dashboard uses, so the list-view number matches the
// dashboard's. Defaults (12-month term, snapshot price) cover snapshots saved before those fields existed.
function estimateStorageTcv(snapshot: SummarySnapshot): number {
  const termMonths = Math.max(1, Math.round(snapshot.termMonths || 12));
  const pricePerTb = Math.max(0, snapshot.b2PricePerTb || 0);
  let tcv = 0;

  for (let month = 1; month <= termMonths; month++) {
    const projectedStorageGb = projectStorageGbForMonth({
      baseStorageGb: snapshot.totalStorageGb,
      fixedGrowthTbPerMonth: snapshot.growthFixedTbPerMonth || 0,
      annualGrowthPercent: snapshot.growthRatePercent || 0,
      growthMode: snapshot.growthMode || 'percent',
      month,
    });
    tcv += (projectedStorageGb / 1000) * pricePerTb;
  }

  return tcv;
}

function getPipelineStatus(analysis: Pick<AnalysisSummary, 'pipelineStatus'>): PipelineStatus {
  return analysis.pipelineStatus ?? 'open';
}

function getPipelineStatusLabel(status: PipelineStatus): string {
  switch (status) {
    case 'closed-won':
      return 'Closed won';
    case 'closed-lost':
      return 'Closed lost';
    case 'open':
      return 'Open';
  }
}

function getFilterEmptyMessage(filter: PipelineFilter, searchQuery: string): string {
  const scope = filter === 'all' ? 'opportunities' : `${getFilterEmptyLabel(filter)} opportunities`;
  if (searchQuery.trim()) return `No ${scope} matching "${searchQuery}".`;
  return `No ${scope}.`;
}

function getFilterEmptyLabel(filter: Exclude<PipelineFilter, 'all'>): string {
  switch (filter) {
    case 'closed-won':
      return 'closed-won';
    case 'closed-lost':
      return 'closed-lost';
    case 'open':
      return 'open';
  }
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    return typeof body.error === 'string' && body.error.trim() ? body.error : fallback;
  } catch {
    return fallback;
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// Readiness drives the status pill + card accent: draft (no bill) → active (bill, no model) →
// reported (a saved snapshot exists).
type ReadinessStatus = 'reported' | 'active' | 'draft';

// Left accent bar color for a card: pipeline state wins (won = purple, lost = muted), otherwise the
// readiness tone (reported = brand red, active = orange, draft = muted).
function cardAccent(readiness: ReadinessStatus, pipeline: PipelineStatus): string {
  if (pipeline === 'closed-won') return 'var(--c-purple)';
  if (pipeline === 'closed-lost') return 'var(--c-border2)';
  if (readiness === 'reported') return 'var(--c-red)';
  if (readiness === 'active') return 'var(--c-accent)';
  return 'var(--c-border2)';
}

/**
 * Opportunities list: the AE's landing page. Loads all analyses, shows portfolio rollups (scoped to
 * open deals), and supports filtering/sorting, pipeline status changes, delete, and a bulk reparse.
 */
export default function HomePage() {
  useDocumentTitle('Opportunities');

  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [rerunMessage, setRerunMessage] = useState<string | null>(null);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'oldest' | 'tcv' | 'alpha'>('recent');
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilter>('open');
  const [updatingPipelineStatus, setUpdatingPipelineStatus] = useState<string | null>(null);
  const analysesRef = useRef<AnalysisSummary[]>([]);
  const loadRequestIdRef = useRef(0);

  type SortKey = typeof sortBy;
  const hasRunnableAnalyses = analyses.some((a) => a.hasBill);
  const openAnalyses = useMemo(() => analyses.filter((analysis) => getPipelineStatus(analysis) === 'open'), [analyses]);
  const pipelineCounts = useMemo(() => {
    const counts: Record<PipelineFilter, number> = {
      all: analyses.length,
      open: 0,
      'closed-won': 0,
      'closed-lost': 0,
    };

    for (const analysis of analyses) {
      counts[getPipelineStatus(analysis)] += 1;
    }

    return counts;
  }, [analyses]);
  const analysisTcvById = useMemo(() => {
    const tcvById = new Map<string, number>();
    for (const analysis of analyses) {
      if (analysis.latestSnapshot) {
        tcvById.set(analysis.id, estimateStorageTcv(analysis.latestSnapshot));
      }
    }
    return tcvById;
  }, [analyses]);
  // Rollups intentionally cover only OPEN opportunities, so closed-won/lost deals don't inflate the
  // pipeline metrics shown at the top of the page.
  const portfolioStats = useMemo(() => {
    const reportReady = openAnalyses.filter((analysis) => analysis.latestSnapshot).length;
    const potentialTcv = openAnalyses.reduce((sum, analysis) => (
      sum + (analysisTcvById.get(analysis.id) ?? 0)
    ), 0);
    const modeledStorageGb = openAnalyses.reduce((sum, analysis) => sum + (analysis.latestSnapshot?.totalStorageGb ?? 0), 0);

    return {
      modeledStorageGb,
      opportunities: openAnalyses.length,
      potentialTcv,
      reportReady,
    };
  }, [analysisTcvById, openAnalyses]);

  const filteredAnalyses = useMemo(() => {
    let result = pipelineFilter === 'all'
      ? analyses
      : analyses.filter((analysis) => getPipelineStatus(analysis) === pipelineFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((a) => a.prospectName.toLowerCase().includes(q));
    }
    const sorted = [...result];
    switch (sortBy) {
      case 'recent':
        sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        break;
      case 'oldest':
        sorted.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
        break;
      case 'tcv':
        sorted.sort((a, b) => (analysisTcvById.get(b.id) ?? -Infinity) - (analysisTcvById.get(a.id) ?? -Infinity));
        break;
      case 'alpha':
        sorted.sort((a, b) => a.prospectName.localeCompare(b.prospectName));
        break;
    }
    return sorted;
  }, [analyses, analysisTcvById, pipelineFilter, searchQuery, sortBy]);

  useEffect(() => {
    analysesRef.current = analyses;
  }, [analyses]);

  const fetchAnalyses = useCallback((signal: AbortSignal, requestId: number, didTimeout: () => boolean) => (
    fetch('/api/analyses', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    })
      .then(async (r) => {
        if (r.status === 401) {
          window.location.assign('/login');
          throw new Error('Unauthorized');
        }
        if (!r.ok) throw new Error(await readApiError(r, 'Failed to load opportunities'));
        return r.json() as Promise<AnalysisSummary[]>;
      })
      .then((nextAnalyses) => {
        analysesRef.current = nextAnalyses;
        setAnalyses(nextAnalyses);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === 'Unauthorized') return;
        const aborted = error instanceof DOMException && error.name === 'AbortError';
        const currentRequest = requestId === loadRequestIdRef.current;

        // Suppress the error banner when (a) a newer load has superseded this one, or (b) the abort
        // was a deliberate unmount/refresh rather than the timeout, or (c) the timeout fired but we
        // already have data to keep showing. Only a timeout with nothing on screen surfaces an error.
        if (!currentRequest || (aborted && (!didTimeout() || analysesRef.current.length > 0))) {
          return;
        }

        setLoadError(aborted
          ? 'Loading opportunities timed out. Please retry.'
          : error instanceof Error && error.message
            ? error.message
            : 'Could not load opportunities. Please retry.');
      })
      .finally(() => {
        if (requestId === loadRequestIdRef.current) {
          setLoading(false);
        }
      })
  ), []);

  // Kick off a load guarded by a monotonic request id (so a stale in-flight response can't clobber a
  // newer one) and a timeout that aborts the fetch. Returns a cleanup that cancels both.
  const beginAnalysesFetch = useCallback(() => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, OPPORTUNITIES_LOAD_TIMEOUT_MS);

    void fetchAnalyses(controller.signal, requestId, () => timedOut).finally(() => {
      window.clearTimeout(timeout);
    });

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [fetchAnalyses]);

  const loadAnalyses = useCallback((showSpinner = false) => {
    if (showSpinner) setLoading(true);
    setLoadError(null);
    beginAnalysesFetch();
  }, [beginAnalysesFetch]);

  useEffect(() => {
    return beginAnalysesFetch();
  }, [beginAnalysesFetch]);

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await fetch(`/api/analyses/${id}`, { method: 'DELETE' });
      setAnalyses((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // Silently handle — user can retry
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  // Optimistically move the card to its new pipeline status (and reorder by the bumped updatedAt),
  // then roll the whole list back to its prior state if the PATCH fails.
  const handlePipelineStatusChange = async (id: string, pipelineStatus: PipelineStatus) => {
    const previousAnalyses = analyses;
    const updatedAt = new Date().toISOString();

    setUpdatingPipelineStatus(id);
    setRerunError(null);
    setAnalyses((prev) => prev.map((analysis) => (
      analysis.id === id ? { ...analysis, pipelineStatus, updatedAt } : analysis
    )));

    try {
      const res = await fetch(`/api/analyses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta: { pipelineStatus } }),
      });

      if (!res.ok) throw new Error(await readApiError(res, 'Failed to update opportunity status'));
    } catch (error) {
      setAnalyses(previousAnalyses);
      setRerunError(error instanceof Error && error.message ? error.message : 'Failed to update opportunity status. Please try again.');
    } finally {
      setUpdatingPipelineStatus(null);
    }
  };

  // Bulk-reparse every stored bill and regenerate snapshots with the current analysis logic — used
  // after the model/parsers change so existing opportunities pick up the new numbers in one click.
  const handleRerunAll = async () => {
    setRerunning(true);
    setRerunMessage(null);
    setRerunError(null);

    try {
      const res = await fetch('/api/analyses/rerun', { method: 'POST' });
      const result = await res.json() as RerunAllResponse;

      if (!res.ok) {
        throw new Error('Rerun failed');
      }

      const parts = [
        `${result.rerun} rerun`,
        `${result.results.filter((item) => item.parsedUpdated).length} reparsed`,
        `${result.skipped} skipped`,
      ];
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      setRerunMessage(`Rerun complete: ${parts.join(', ')}.`);
      loadAnalyses();
    } catch {
      setRerunError('Rerun failed. Please try again.');
    } finally {
      setRerunning(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex flex-1 flex-col items-center justify-center px-4 py-6 sm:px-6 sm:py-8 lg:py-10">
        <div className="relative mb-4 h-12 w-12">
          <div className="absolute inset-0 rounded-full border-4 border-c-border" />
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-c-red border-t-transparent" />
        </div>
        <p className="text-sm text-c-muted">Loading your opportunities...</p>
      </div>
    );
  }

  if (loadError && analyses.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-6 lg:py-10">
        <div className="rounded-2xl border border-c-red/40 bg-c-red-soft p-6 text-center">
          <h1 className="text-lg font-semibold text-c-red-dark">Could not load opportunities</h1>
          <p className="mt-2 text-sm text-c-muted">{loadError}</p>
          <button
            onClick={() => loadAnalyses(true)}
            className="mt-4 rounded-[10px] bg-c-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-c-brand-hover"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pb-16 pt-7 sm:px-6 sm:pt-8">
      {/* Page header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 font-display text-xs font-semibold uppercase tracking-[0.14em] text-c-red">Pipeline</p>
          <h1 className="text-[28px] font-semibold text-c-text sm:text-[34px]">Opportunities</h1>
          <p className="mt-1.5 text-[15px] text-c-muted">Modeled Backblaze B2 savings across your active deals.</p>
        </div>
        {analyses.length > 0 && (
          <button
            onClick={handleRerunAll}
            disabled={rerunning || !hasRunnableAnalyses}
            title={hasRunnableAnalyses ? 'Reparse stored bills and create fresh snapshots with the current analysis logic' : 'Upload a bill before rerunning analysis'}
            className="inline-flex shrink-0 items-center gap-2 rounded-[10px] border border-c-border2 bg-c-surface px-[15px] py-[9px] text-[13px] font-semibold text-c-text shadow-sm transition-colors hover:bg-c-surface2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg className={`h-4 w-4 ${rerunning ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M8.977 14.652H3.985m17.03-10.296v4.992m0 0h-4.992m4.992 0-3.181-3.183a8.25 8.25 0 0 0-13.803 3.7" />
            </svg>
            {rerunning ? 'Rerunning...' : 'Rerun all'}
          </button>
        )}
      </div>

      {(loadError || rerunMessage || rerunError) && (
        <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
          loadError || rerunError
            ? 'border-c-red/40 bg-c-red-soft text-c-red-dark'
            : 'border-c-green/40 bg-c-green-soft text-c-green'
        }`}>
          {loadError || rerunError || rerunMessage}
        </div>
      )}

      {analyses.length > 0 && (
        <div className="mb-3.5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <PortfolioMetric
            label="Open opportunities"
            value={portfolioStats.opportunities}
            formatter={formatInteger}
            caption={`${pipelineCounts['closed-won'] + pipelineCounts['closed-lost']} closed`}
            bar="var(--c-red)"
          />
          <PortfolioMetric
            label="Reports ready"
            value={portfolioStats.reportReady}
            formatter={formatInteger}
            caption="Latest snapshots saved"
            bar="var(--c-purple)"
          />
          <PortfolioMetric
            label="Potential TCV"
            value={portfolioStats.potentialTcv}
            formatter={formatCurrency}
            caption="Open-pipeline B2 storage revenue"
            bar="var(--c-red)"
            tone="pipeline"
          />
          <PortfolioMetric
            label="Storage modeled"
            value={portfolioStats.modeledStorageGb}
            formatter={formatModeledStorage}
            caption="Report-ready scope"
            bar="var(--c-accent)"
          />
        </div>
      )}

      {analyses.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex w-full rounded-[11px] border border-c-border bg-c-surface p-1 shadow-sm sm:w-auto" role="group" aria-label="Opportunity status filter">
            {PIPELINE_FILTERS.map((filter) => {
              const selected = pipelineFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setPipelineFilter(filter.id)}
                  className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors sm:flex-none ${
                    selected
                      ? 'bg-c-brand text-white'
                      : 'text-c-muted hover:bg-c-surface2 hover:text-c-text'
                  }`}
                >
                  <span>{filter.label}</span>
                  <span className={selected ? 'text-white/70' : 'text-c-subtle'}>{pipelineCounts[filter.id]}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2 rounded-[10px] border border-c-border2 bg-c-surface px-3 py-2 sm:w-[230px]">
              <svg className="h-4 w-4 shrink-0 text-c-subtle" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <input
                type="text"
                placeholder="Search prospects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent! text-[13px] text-c-text outline-none placeholder:text-c-subtle"
              />
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="rounded-[10px] border border-c-border2 bg-c-surface px-3 py-2 text-[13px] font-semibold text-c-text outline-none focus:border-c-red"
            >
              <option value="tcv">Highest TCV</option>
              <option value="recent">Most recent</option>
              <option value="oldest">Oldest</option>
              <option value="alpha">Alphabetical</option>
            </select>
          </div>
        </div>
      )}

      {analyses.length === 0 ? (
        <div className="rounded-2xl border border-c-border bg-c-surface py-12 text-center shadow-sm">
          <svg className="mx-auto mb-4 h-12 w-12 text-c-subtle" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <h3 className="mb-2 text-lg font-semibold text-c-text">No opportunities yet</h3>
          <p className="mb-6 text-c-muted">Upload a customer cloud bill to get started.</p>
          <Link
            href="/analyses/new"
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-c-brand px-4 py-2.5 text-sm font-semibold text-white transition-[background-color,box-shadow] duration-200 hover:bg-c-brand-hover hover:shadow-[0_8px_22px_rgba(226,6,38,0.4)]"
          >
            <span className="text-[15px] leading-none">+</span>New opportunity
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredAnalyses.length === 0 && (
            <div className="py-8 text-center text-c-muted">
              {getFilterEmptyMessage(pipelineFilter, searchQuery)}
            </div>
          )}
          {(() => {
            // Group linked Standard/Overdrive twins into one bracketed block so the pair reads as a
            // set. Pairing only fires when both halves survive the current filter/search, so a
            // filtered-out twin gracefully degrades to a normal single card.
            const consumed = new Set<string>();
            type Row = { kind: 'single'; a: AnalysisSummary } | { kind: 'pair'; std: AnalysisSummary; od: AnalysisSummary };
            const rows: Row[] = [];
            for (const a of filteredAnalyses) {
              if (consumed.has(a.id)) continue;
              const twin = a.linkedAnalysisId
                ? filteredAnalyses.find((x) => x.id === a.linkedAnalysisId && !consumed.has(x.id))
                : undefined;
              if (twin) {
                consumed.add(a.id);
                consumed.add(twin.id);
                const od = a.serviceTierVariant === 'overdrive' ? a : twin;
                const std = a.serviceTierVariant === 'overdrive' ? twin : a;
                rows.push({ kind: 'pair', std, od });
              } else {
                consumed.add(a.id);
                rows.push({ kind: 'single', a });
              }
            }
            const cardProps = (a: AnalysisSummary) => ({
              a,
              storageTcv: analysisTcvById.get(a.id) ?? 0,
              updatingPipelineStatus,
              onPipelineStatusChange: (id: string, status: PipelineStatus) => { void handlePipelineStatusChange(id, status); },
              onDelete: setDeleteTarget,
            });
            return rows.map((row, i) =>
              row.kind === 'single' ? (
                <Reveal key={row.a.id} index={i}>
                  <OpportunityCard {...cardProps(row.a)} />
                </Reveal>
              ) : (
                <Reveal key={`${row.std.id}:${row.od.id}`} index={i}>
                  <div className="rounded-2xl border border-c-purple/40 bg-c-purple-soft/40 p-2.5">
                    <div className="px-1.5 pb-2 pt-0.5">
                      <div className="flex items-center gap-1.5">
                        <LinkedPairIcon />
                        <span className="text-[10.5px] font-bold text-c-purple">Linked pair · shown to the customer side by side</span>
                      </div>
                      {/* The two halves can diverge — Overdrive often saves the customer more (unlimited
                          egress) while its storage TCV differs from Standard — so name that up front. */}
                      <p className="mt-0.5 pl-[19px] text-[10px] text-c-subtle">Overdrive can save the customer more while its storage TCV differs — compare both.</p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <OpportunityCard {...cardProps(row.std)} inPair />
                      <OpportunityCard {...cardProps(row.od)} inPair />
                    </div>
                  </div>
                </Reveal>
              ),
            );
          })()}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-c-border bg-c-surface p-6 shadow-xl">
            <h3 className="mb-2 text-lg font-semibold text-c-text">Delete opportunity?</h3>
            <p className="mb-1 text-sm text-c-muted">
              This will permanently delete <span className="font-medium text-c-text">{analyses.find((a) => a.id === deleteTarget)?.prospectName}</span> and all associated data including uploaded bills, snapshots, and reports.
            </p>
            <p className="mb-5 text-sm text-c-red">This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="rounded-[10px] bg-c-surface2 px-4 py-2 text-sm font-semibold text-c-text transition-colors hover:opacity-80 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                disabled={deleting}
                className="rounded-[10px] bg-c-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-c-brand-hover disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One opportunity row. Chip hierarchy is deliberately flattened per the design review: deal type is a
 * leading left label, readiness is a single status dot, the Standard/Overdrive variant is a small tag
 * on the name, and the pipeline pill shows only when the deal is closed. `inPair` hides the cross-link
 * action inside a bracketed linked pair, where the twin is already shown right alongside.
 */
function OpportunityCard({
  a,
  storageTcv,
  updatingPipelineStatus,
  onPipelineStatusChange,
  onDelete,
  inPair = false,
}: {
  a: AnalysisSummary;
  storageTcv: number;
  updatingPipelineStatus: string | null;
  onPipelineStatusChange: (id: string, status: PipelineStatus) => void;
  onDelete: (id: string) => void;
  inPair?: boolean;
}) {
  const router = useRouter();
  // Readiness is independent of pipeline status: draft (no bill/usage) → active (input, not modeled) →
  // reported (has a saved snapshot). commit-upsell analyses have no bill, so hasB2Usage is their signal.
  const hasInput = a.hasBill || a.hasB2Usage;
  const readinessStatus: ReadinessStatus = a.latestSnapshot ? 'reported' : hasInput ? 'active' : 'draft';
  const pipelineStatus = getPipelineStatus(a);
  const isUpsell = a.opportunityType === 'commit-upsell';
  const dealTypeLabel = isUpsell ? 'B2 upsell' : `${PROVIDER_LABELS[a.provider] || a.provider} migration`;

  return (
    <div
      data-analysis-id={a.id}
      className="flex items-stretch overflow-hidden rounded-2xl border border-c-border bg-c-surface shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
    >
      {/* Status accent bar (readiness-toned). */}
      <div className="w-1 shrink-0" style={{ background: cardAccent(readinessStatus, pipelineStatus) }} />

      {/* Main clickable area — Next Link so navigation is client-side (keeps the layout/header
          mounted, which lets the header margins animate to the dashboard width). */}
      <Link href={`/analyses/${a.id}`} className="flex min-w-0 flex-1 flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* Deal type — the leading left label answers "what kind of deal is this?" at a glance. */}
          <span className={`shrink-0 whitespace-nowrap rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.03em] ${a.opportunityType === 'commit-upsell' ? 'border-c-amber/40 bg-c-amber-soft text-c-amber' : 'border-c-border2 bg-c-surface2 text-c-muted'}`}>
            {dealTypeLabel}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-[18px] font-semibold text-c-text">{a.prospectName}</h3>
              {a.serviceTierVariant && (
                <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.03em] ${a.serviceTierVariant === 'overdrive' ? 'bg-c-purple text-white' : 'bg-c-purple-soft text-c-purple'}`}>
                  {a.serviceTierVariant === 'overdrive' ? 'Overdrive' : 'Standard'}
                </span>
              )}
              {/* Readiness = one status dot instead of a competing text pill. */}
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${readinessStatus === 'reported' ? 'bg-c-green' : readinessStatus === 'active' ? 'bg-c-accent' : 'bg-c-border2'}`}
                title={readinessStatus === 'reported' ? 'Report ready' : readinessStatus === 'active' ? 'In progress' : 'Draft'}
              />
              {pipelineStatus !== 'open' && (
                <StatusPill className={pipelineStatus === 'closed-won' ? 'bg-c-purple-soft text-c-purple' : 'bg-c-surface2 text-c-subtle'}>
                  {getPipelineStatusLabel(pipelineStatus)}
                </StatusPill>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[12.5px] text-c-muted">
              {a.billingPeriod && <span>{a.billingPeriod}</span>}
              <span className="text-c-subtle">Updated {timeAgo(a.updatedAt)}</span>
            </div>
          </div>
        </div>

        {/* Savings preview from latest snapshot */}
        {a.latestSnapshot && (
          <div className="min-w-0 sm:min-w-[180px] sm:text-right">
            <p className="font-display text-[24px] font-semibold text-c-text">
              {formatCurrency(storageTcv)}
              <span className="text-xs font-medium text-c-subtle"> potential TCV</span>
            </p>
            {/* Only show a "/yr saved" line when there's a real dollar delta. A commit-upsell at a flat
                Committed rate has no savings (the value is throughput), so showing "$0/yr saved" would
                read as a dead deal — fall back to a neutral storage/tier line instead. */}
            {a.latestSnapshot.annualSavings > 0 ? (
              <p className="mt-0.5 text-[12.5px] font-semibold text-c-green">
                {formatCurrency(a.latestSnapshot.annualSavings)}/yr saved · {formatGb(a.latestSnapshot.totalStorageGb)}
              </p>
            ) : (
              <p className="mt-0.5 text-[12.5px] font-semibold text-c-muted">
                {formatGb(a.latestSnapshot.totalStorageGb)} {isUpsell ? 'on Committed' : 'modeled'}
              </p>
            )}
          </div>
        )}

        {!a.latestSnapshot && hasInput && (
          <div className="min-w-0 sm:min-w-[180px] sm:text-right">
            <p className="text-sm italic text-c-subtle">{a.hasB2Usage && !a.hasBill ? 'Usage entered' : 'Bill uploaded'}</p>
            <p className="text-xs text-c-subtle">No report yet</p>
          </div>
        )}

        {!hasInput && (
          <div className="min-w-0 sm:min-w-[180px] sm:text-right">
            <p className="text-sm italic text-c-subtle">
              {a.opportunityType === 'commit-upsell' ? 'Awaiting usage details' : 'Awaiting bill'}
            </p>
          </div>
        )}
      </Link>

      {/* Row actions */}
      <div className="flex flex-col items-center justify-center gap-1.5 border-l border-c-border px-3">
        {a.linkedAnalysisId && !inPair && (
          <OpportunityActionButton
            label={`View ${a.serviceTierVariant === 'overdrive' ? 'Standard' : 'Overdrive'} variant`}
            toneClass="hover:bg-c-red-soft hover:text-c-red focus-visible:bg-c-red-soft focus-visible:text-c-red"
            onClick={(e) => {
              e.preventDefault();
              router.push(`/analyses/${a.linkedAnalysisId}`);
            }}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5A3.375 3.375 0 0 0 6.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0 0 15 2.25h-1.5a2.251 2.251 0 0 0-2.15 1.586m5.65 0a2.25 2.25 0 0 1 1.586 2.152v1.276M12 21.75a9.75 9.75 0 1 0 0-19.5" />
            </svg>
          </OpportunityActionButton>
        )}
        {pipelineStatus === 'open' ? (
          <>
            <OpportunityActionButton
              label="Mark closed won"
              toneClass="hover:bg-c-green-soft hover:text-c-green focus-visible:bg-c-green-soft focus-visible:text-c-green"
              onClick={(e) => {
                e.preventDefault();
                onPipelineStatusChange(a.id, 'closed-won');
              }}
              disabled={updatingPipelineStatus === a.id}
            >
              <svg className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </OpportunityActionButton>
            <OpportunityActionButton
              label="Mark closed lost"
              toneClass="hover:bg-c-red-soft hover:text-c-red focus-visible:bg-c-red-soft focus-visible:text-c-red"
              onClick={(e) => {
                e.preventDefault();
                onPipelineStatusChange(a.id, 'closed-lost');
              }}
              disabled={updatingPipelineStatus === a.id}
            >
              <svg className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </OpportunityActionButton>
          </>
        ) : (
          <OpportunityActionButton
            label="Reopen"
            toneClass="hover:bg-c-green-soft hover:text-c-green focus-visible:bg-c-green-soft focus-visible:text-c-green"
            onClick={(e) => {
              e.preventDefault();
              onPipelineStatusChange(a.id, 'open');
            }}
            disabled={updatingPipelineStatus === a.id}
          >
            <svg className="h-[17px] w-[17px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992m0 0V4.356m0 4.992-3.181-3.183a8.25 8.25 0 1 0 2.188 7.912" />
            </svg>
          </OpportunityActionButton>
        )}
        <OpportunityActionButton
          label="Delete"
          toneClass="hover:bg-c-red-soft hover:text-c-red focus-visible:bg-c-red-soft focus-visible:text-c-red"
          onClick={(e) => {
            e.preventDefault();
            onDelete(a.id);
          }}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </OpportunityActionButton>
      </div>
    </div>
  );
}

/** Chain-link glyph for the linked-pair bracket header. */
function LinkedPairIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="shrink-0 text-c-purple" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17H7A5 5 0 0 1 7 7h2m6 0h2a5 5 0 0 1 0 10h-2m-7-5h8" />
    </svg>
  );
}

/** Small rounded status/pipeline pill. Color classes are supplied by the caller. */
function StatusPill({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-[3px] text-[11px] font-semibold ${className}`}>
      {children}
    </span>
  );
}

/** A single portfolio rollup tile with an animated value and a colored left accent bar. */
function PortfolioMetric({
  label,
  value,
  formatter,
  caption,
  bar,
  tone = 'default',
}: {
  label: string;
  value: number;
  formatter: (value: number) => string;
  caption?: string;
  bar: string;
  tone?: 'default' | 'pipeline';
}) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-2xl border border-c-border bg-c-surface px-[18px] py-4 shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <span className="absolute left-0 top-0 h-full w-[3px]" style={{ background: bar }} aria-hidden="true" />
      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-c-subtle">{label}</p>
      <p className={`mt-2 font-display text-[26px] font-semibold leading-[1.05] sm:text-[30px] ${tone === 'pipeline' ? 'text-c-red' : 'text-c-text'}`}>
        <AnimatedMetricValue value={value} formatter={formatter} />
      </p>
      {caption && <p className="mt-1.5 truncate text-xs text-c-muted">{caption}</p>}
    </div>
  );
}

/** Icon-only row action (won/lost/reopen/delete) with a hover tooltip. `label` doubles as aria-label. */
function OpportunityActionButton({
  label,
  children,
  disabled,
  onClick,
  toneClass,
}: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  toneClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`group relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-c-subtle transition-colors disabled:cursor-wait disabled:opacity-50 ${toneClass}`}
    >
      {children}
      <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-c-tooltip px-2 py-1 text-[11px] font-semibold text-white opacity-0 shadow-lg transition-all group-hover:opacity-100 group-focus-visible:opacity-100">
        {label}
      </span>
    </button>
  );
}
