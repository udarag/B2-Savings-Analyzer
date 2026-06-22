'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import type { AnalysisSummary } from './api/analyses/route';

const PROVIDER_LABELS: Record<string, string> = {
  aws: 'AWS',
  gcp: 'GCP',
  azure: 'Azure',
  r2: 'R2',
};

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function formatGb(gb: number): string {
  if (gb >= 1000) return `${(gb / 1000).toFixed(1)} TB`;
  return `${Math.round(gb)} GB`;
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

export default function HomePage() {
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'oldest' | 'savings' | 'alpha'>('recent');

  type SortKey = typeof sortBy;

  const filteredAnalyses = useMemo(() => {
    let result = analyses;
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
      case 'savings':
        sorted.sort((a, b) => (b.latestSnapshot?.annualSavings ?? -Infinity) - (a.latestSnapshot?.annualSavings ?? -Infinity));
        break;
      case 'alpha':
        sorted.sort((a, b) => a.prospectName.localeCompare(b.prospectName));
        break;
    }
    return sorted;
  }, [analyses, searchQuery, sortBy]);

  const loadAnalyses = useCallback(() => {
    fetch('/api/analyses')
      .then((r) => r.json())
      .then(setAnalyses)
      .catch(() => setAnalyses([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadAnalyses(); }, [loadAnalyses]);

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

  const handleDuplicate = async (id: string) => {
    setDuplicating(id);
    try {
      await fetch(`/api/analyses/${id}/duplicate`, { method: 'POST' });
      loadAnalyses();
    } catch {
      // Silently handle — user can retry
    } finally {
      setDuplicating(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="relative w-12 h-12 mb-4">
          <div className="absolute inset-0 rounded-full border-4 border-gray-200" />
          <div className="absolute inset-0 rounded-full border-4 border-bb-red border-t-transparent animate-spin" />
        </div>
        <p className="text-gray-500 text-sm">Loading your opportunities...</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Opportunities</h1>
          <p className="text-gray-500 mt-1">Upload a Cloud Bill to Model B2 Savings</p>
        </div>
      </div>

      {analyses.length > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="text"
              placeholder="Search Prospects..."
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
            <option value="recent">Most Recent</option>
            <option value="oldest">Oldest</option>
            <option value="savings">Highest Savings</option>
            <option value="alpha">Alphabetical</option>
          </select>
        </div>
      )}

      {analyses.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg shadow">
          <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Opportunities Yet</h3>
          <p className="text-gray-500 mb-6">Upload a Customer&apos;s Cloud Bill to Get Started</p>
          <Link
            href="/analyses/new"
            className="inline-flex items-center px-4 py-2 bg-bb-red text-white text-sm font-medium rounded-lg hover:bg-bb-red-dark"
          >
            New Analysis
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAnalyses.length === 0 && searchQuery && (
            <div className="text-center py-8 text-gray-500">
              No Opportunities Matching &ldquo;{searchQuery}&rdquo;
            </div>
          )}
          {filteredAnalyses.map((a) => {
            const status = a.latestSnapshot ? 'reported' : a.hasBill ? 'active' : 'draft';
            return (
              <div key={a.id} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow">
                <div className="flex items-stretch">
                  {/* Main clickable area */}
                  <a href={`/analyses/${a.id}`} className="flex-1 p-5 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                          <h3 className="font-semibold text-gray-900 truncate">{a.prospectName}</h3>
                          {status === 'draft' && (
                            <span className="shrink-0 text-xs font-medium px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">Draft</span>
                          )}
                          {status === 'active' && (
                            <span className="shrink-0 text-xs font-medium px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full">In Progress</span>
                          )}
                          {status === 'reported' && (
                            <span className="shrink-0 text-xs font-medium px-2 py-0.5 bg-green-50 text-green-700 rounded-full">Reported</span>
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
                        <div className="shrink-0 text-right">
                          <p className="text-lg font-bold text-green-700">
                            {formatCurrency(a.latestSnapshot.annualSavings)}
                            <span className="text-xs font-normal text-gray-400">/yr</span>
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {formatGb(a.latestSnapshot.totalStorageGb)} migrated
                          </p>
                        </div>
                      )}

                      {!a.latestSnapshot && a.hasBill && (
                        <div className="shrink-0 text-right">
                          <p className="text-sm text-gray-400 italic">Bill Uploaded</p>
                          <p className="text-xs text-gray-400">No Report Yet</p>
                        </div>
                      )}

                      {!a.hasBill && (
                        <div className="shrink-0 text-right">
                          <p className="text-sm text-gray-400 italic">Awaiting Bill</p>
                        </div>
                      )}
                    </div>
                  </a>

                  {/* Actions */}
                  <div className="flex flex-col items-center justify-center gap-1 px-3 border-l border-gray-100">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        handleDuplicate(a.id);
                      }}
                      disabled={duplicating === a.id}
                      className="p-2 text-gray-300 hover:text-bb-red rounded-lg hover:bg-bb-red-light transition-colors disabled:opacity-50"
                      title="Duplicate Opportunity"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        setDeleteTarget(a.id);
                      }}
                      className="p-2 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                      title="Delete Opportunity"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
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
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Opportunity?</h3>
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
