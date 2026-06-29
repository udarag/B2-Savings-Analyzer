'use client';

import { useEffect, useState, useCallback, useMemo, useRef, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import type { AnalysisSummary } from './api/analyses/route';
import { useDocumentTitle } from '@/components/shared/useDocumentTitle';
import { AnimatedMetricValue } from '@/components/shared/AnimatedMetricValue';
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
        <div className="relative w-12 h-12 mb-4">
          <div className="absolute inset-0 rounded-full border-4 border-gray-200" />
          <div className="absolute inset-0 rounded-full border-4 border-bb-red border-t-transparent animate-spin" />
        </div>
        <p className="text-gray-500 text-sm">Loading your opportunities...</p>
      </div>
    );
  }

  if (loadError && analyses.length === 0) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 lg:py-10">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <h1 className="text-lg font-semibold text-red-900">Could not load opportunities</h1>
          <p className="mt-2 text-sm text-red-700">{loadError}</p>
          <button
            onClick={() => loadAnalyses(true)}
            className="mt-4 rounded-lg bg-bb-red px-4 py-2 text-sm font-medium text-white hover:bg-bb-red-dark"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 lg:py-10">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Opportunities</h1>
          <p className="text-gray-500 mt-1">Track modeled B2 savings opportunities</p>
        </div>
        {analyses.length > 0 && (
          <button
            onClick={handleRerunAll}
            disabled={rerunning || !hasRunnableAnalyses}
            title={hasRunnableAnalyses ? 'Reparse stored bills and create fresh snapshots with the current analysis logic' : 'Upload a bill before rerunning analysis'}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg className={`h-4 w-4 ${rerunning ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M8.977 14.652H3.985m17.03-10.296v4.992m0 0h-4.992m4.992 0-3.181-3.183a8.25 8.25 0 0 0-13.803 3.7" />
            </svg>
            {rerunning ? 'Rerunning...' : 'Rerun all'}
          </button>
        )}
      </div>

      {(loadError || rerunMessage || rerunError) && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
          loadError || rerunError
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-green-200 bg-green-50 text-green-700'
        }`}>
          {loadError || rerunError || rerunMessage}
        </div>
      )}

      {analyses.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <PortfolioMetric
            label="Open opportunities"
            value={portfolioStats.opportunities}
            formatter={formatInteger}
            caption={`${pipelineCounts['closed-won'] + pipelineCounts['closed-lost']} Closed`}
          />
          <PortfolioMetric
            label="Reports ready"
            value={portfolioStats.reportReady}
            formatter={formatInteger}
            caption="Latest snapshots"
          />
          <PortfolioMetric
            label="Potential TCV"
            value={portfolioStats.potentialTcv}
            formatter={formatCurrency}
            caption="Modeled B2 storage revenue"
            tone="pipeline"
          />
          <PortfolioMetric
            label="Storage modeled"
            value={portfolioStats.modeledStorageGb}
            formatter={formatModeledStorage}
            caption="Report-ready scope"
          />
        </div>
      )}

      {analyses.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex w-full flex-wrap rounded-lg border border-gray-200 bg-white p-1 shadow-sm sm:w-auto" role="group" aria-label="Opportunity status filter">
            {PIPELINE_FILTERS.map((filter) => {
              const selected = pipelineFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setPipelineFilter(filter.id)}
                  className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:flex-none ${
                    selected
                      ? 'bg-bb-red text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <span>{filter.label}</span>
                  <span className={selected ? 'text-white/80' : 'text-gray-400'}>{pipelineCounts[filter.id]}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-sm">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="text"
              placeholder="Search prospects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-bb-red focus:border-transparent"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-bb-red focus:border-transparent"
          >
            <option value="recent">Most recent</option>
            <option value="oldest">Oldest</option>
            <option value="tcv">Highest potential TCV</option>
            <option value="alpha">Alphabetical</option>
          </select>
          </div>
        </div>
      )}

      {analyses.length === 0 ? (
        <div className="text-center py-10 sm:py-12 bg-white rounded-lg shadow">
          <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No opportunities yet</h3>
          <p className="text-gray-500 mb-6">Upload a customer cloud bill to get started.</p>
          <Link
            href="/analyses/new"
            className="inline-flex items-center px-4 py-2 bg-bb-red text-white text-sm font-medium rounded-lg hover:bg-bb-red-dark"
          >
            New opportunity
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAnalyses.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              {getFilterEmptyMessage(pipelineFilter, searchQuery)}
            </div>
          )}
          {filteredAnalyses.map((a) => {
            // Readiness is independent of pipeline status: a deal progresses draft (no bill) →
            // active (bill uploaded, not yet modeled) → reported (has a saved snapshot).
            const readinessStatus = a.latestSnapshot ? 'reported' : a.hasBill ? 'active' : 'draft';
            const pipelineStatus = getPipelineStatus(a);
            const storageTcv = analysisTcvById.get(a.id) ?? 0;
            return (
              <div
                key={a.id}
                data-analysis-id={a.id}
                className="bg-white rounded-lg shadow hover:shadow-md transition-shadow"
              >
                <div className="flex items-stretch">
                  {/* Main clickable area */}
                  <a href={`/analyses/${a.id}`} className="flex-1 p-5 min-w-0">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                          <h3 className="font-semibold text-gray-900 truncate">{a.prospectName}</h3>
                          {readinessStatus === 'draft' && (
                            <span className="shrink-0 text-xs font-medium px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">Draft</span>
                          )}
                          {readinessStatus === 'active' && (
                            <span className="shrink-0 text-xs font-medium px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full">In progress</span>
                          )}
                          {readinessStatus === 'reported' && (
                            <span className="shrink-0 text-xs font-medium px-2 py-0.5 bg-green-50 text-green-700 rounded-full">Report ready</span>
                          )}
                          {pipelineStatus !== 'open' && (
                            <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                              pipelineStatus === 'closed-won'
                                ? 'bg-blue-50 text-blue-700'
                                : 'bg-gray-100 text-gray-500'
                            }`}>
                              {getPipelineStatusLabel(pipelineStatus)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-sm text-gray-500">
                          <span className="text-xs font-semibold px-2 py-0.5 bg-gray-100 rounded">
                            {PROVIDER_LABELS[a.provider] || a.provider}
                          </span>
                          {a.billingPeriod && <span>{a.billingPeriod}</span>}
                          <span className="text-gray-400">Updated {timeAgo(a.updatedAt)}</span>
                        </div>
                      </div>

                      {/* Savings preview from latest snapshot */}
                      {a.latestSnapshot && (
                        <div className="min-w-0 sm:shrink-0 sm:text-right">
                          <p className="text-lg font-bold text-bb-red-dark">
                            {formatCurrency(storageTcv)}
                            <span className="text-xs font-normal text-gray-400"> potential TCV</span>
                          </p>
                          <p className="mt-0.5 text-xs leading-snug text-gray-500">
                            {formatCurrency(a.latestSnapshot.annualSavings)}/yr savings · {formatGb(a.latestSnapshot.totalStorageGb)}
                          </p>
                        </div>
                      )}

                      {!a.latestSnapshot && a.hasBill && (
                        <div className="min-w-0 sm:shrink-0 sm:text-right">
                          <p className="text-sm text-gray-400 italic">Bill uploaded</p>
                          <p className="text-xs text-gray-400">No report yet</p>
                        </div>
                      )}

                      {!a.hasBill && (
                        <div className="min-w-0 sm:shrink-0 sm:text-right">
                          <p className="text-sm text-gray-400 italic">Awaiting bill</p>
                        </div>
                      )}
                    </div>
                  </a>

                  {/* Actions */}
                  <div className="flex flex-col items-center justify-center gap-1 px-3 border-l border-gray-100">
                    {pipelineStatus === 'open' ? (
                      <>
                        <OpportunityActionButton
                          label="Closed won"
                          toneClass="hover:text-green-700 hover:bg-green-100 focus-visible:text-green-700 focus-visible:bg-green-100"
                          tooltipClass="group-hover:bg-green-700 group-focus-visible:bg-green-700"
                          onClick={(e) => {
                            e.preventDefault();
                            void handlePipelineStatusChange(a.id, 'closed-won');
                          }}
                          disabled={updatingPipelineStatus === a.id}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                          </svg>
                        </OpportunityActionButton>
                        <OpportunityActionButton
                          label="Closed lost"
                          toneClass="hover:text-red-700 hover:bg-red-100 focus-visible:text-red-700 focus-visible:bg-red-100"
                          tooltipClass="group-hover:bg-red-700 group-focus-visible:bg-red-700"
                          onClick={(e) => {
                            e.preventDefault();
                            void handlePipelineStatusChange(a.id, 'closed-lost');
                          }}
                          disabled={updatingPipelineStatus === a.id}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                          </svg>
                        </OpportunityActionButton>
                      </>
                    ) : (
                      <OpportunityActionButton
                        label="Reopen"
                        toneClass="hover:text-green-700 hover:bg-green-100 focus-visible:text-green-700 focus-visible:bg-green-100"
                        tooltipClass="group-hover:bg-green-700 group-focus-visible:bg-green-700"
                        onClick={(e) => {
                          e.preventDefault();
                          void handlePipelineStatusChange(a.id, 'open');
                        }}
                        disabled={updatingPipelineStatus === a.id}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992m0 0V4.356m0 4.992-3.181-3.183a8.25 8.25 0 1 0 2.188 7.912" />
                        </svg>
                      </OpportunityActionButton>
                    )}
                    <OpportunityActionButton
                      label="Trash"
                      toneClass="hover:text-red-700 hover:bg-red-100 focus-visible:text-red-700 focus-visible:bg-red-100"
                      tooltipClass="group-hover:bg-red-700 group-focus-visible:bg-red-700"
                      onClick={(e) => {
                        e.preventDefault();
                        setDeleteTarget(a.id);
                      }}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </OpportunityActionButton>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete opportunity?</h3>
            <p className="text-sm text-gray-600 mb-1">
              This will permanently delete <span className="font-medium">{analyses.find((a) => a.id === deleteTarget)?.prospectName}</span> and all associated data including uploaded bills, snapshots, and reports.
            </p>
            <p className="text-sm text-red-600 mb-5">This action cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
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

/** A single portfolio rollup tile with an animated value. `tone="pipeline"` tints revenue figures. */
function PortfolioMetric({
  label,
  value,
  formatter,
  caption,
  tone = 'default',
}: {
  label: string;
  value: number;
  formatter: (value: number) => string;
  caption?: string;
  tone?: 'default' | 'pipeline';
}) {
  const valueClass = tone === 'pipeline' ? 'text-bb-red-dark' : 'text-gray-900';

  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <p className="truncate text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-bold sm:text-2xl ${valueClass}`}>
        <AnimatedMetricValue value={value} formatter={formatter} />
      </p>
      {caption && <p className="mt-1 truncate text-xs text-gray-500">{caption}</p>}
    </div>
  );
}

/** Icon-only row action (won/lost/reopen/trash) with a hover tooltip. `label` doubles as aria-label. */
function OpportunityActionButton({
  label,
  children,
  disabled,
  onClick,
  toneClass,
  tooltipClass = '',
}: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  toneClass: string;
  tooltipClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`group relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-300 transition-colors disabled:cursor-wait disabled:opacity-50 ${toneClass}`}
    >
      {children}
      <span className={`pointer-events-none absolute left-full top-1/2 z-20 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-semibold text-white opacity-0 shadow-lg transition-all group-hover:opacity-100 group-focus-visible:opacity-100 ${tooltipClass}`}>
        {label}
      </span>
    </button>
  );
}
