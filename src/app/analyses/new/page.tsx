'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Analysis, ParsedBill, ModelConfig, Provider } from '@/types/analysis';
import { FileUpload, type UploadedFileMeta } from '@/components/upload/FileUpload';
import { ParseReview } from '@/components/upload/ParseReview';
import { useDocumentTitle } from '@/components/shared/useDocumentTitle';

// What POST /api/analyses/[id]/upload returns — enough to render the parse review inline.
interface UploadResult {
  parsed: ParsedBill;
  meta: Analysis;
  modelConfig: ModelConfig;
}

function formatBytes(bytes: number): string {
  const mb = bytes / 1_048_576;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fileTypeBadge(name: string): string {
  const ext = name.toLowerCase().slice(name.lastIndexOf('.') + 1);
  if (ext === 'pdf') return 'PDF';
  if (ext === 'csv') return 'CSV';
  if (ext === 'xlsx' || ext === 'xls') return 'XLS';
  return ext.toUpperCase().slice(0, 3) || 'DOC';
}

/**
 * "New opportunity" flow, all on one page:
 *   1. Details — create the analysis record (POST /api/analyses).
 *   2. Upload bill — drop a bill; on parse it stays here and renders the parse review inline.
 *   3. Review — confirm the detected source and categorized spend, then "Build the model" to open
 *      the dashboard. We deliberately don't auto-jump to the dashboard so the AE can sanity-check
 *      the parse first.
 */
export default function NewAnalysisPage() {
  const router = useRouter();
  const [prospectName, setProspectName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [notes, setNotes] = useState('');
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState<{ data: UploadResult; file: UploadedFileMeta } | null>(null);
  const [pricingDiscountConfirmed, setPricingDiscountConfirmed] = useState(false);
  const [showSourceOverride, setShowSourceOverride] = useState(false);
  useDocumentTitle(analysisId ? `${prospectName} upload` : 'New opportunity');

  // Stepper matches the upload mock: Details done, Upload bill active while the bill is dropped and
  // reviewed here, Review (the modeled dashboard) still ahead.
  const currentStep = analysisId ? 2 : 1;

  async function handleCreate() {
    if (!prospectName.trim()) {
      setError('Please enter an opportunity name.');
      return;
    }

    setCreating(true);
    setError('');

    try {
      const res = await fetch('/api/analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospectName: prospectName.trim(),
          companyName: companyName.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });

      if (!res.ok) throw new Error('Failed to create opportunity');
      const data = await res.json();
      setAnalysisId(data.id);
    } catch {
      // Analyses are persisted to a B2 bucket, so a creation failure is most often a B2
      // connectivity/credentials problem — point the AE at that rather than a generic error.
      setError('Failed to create opportunity. Check B2 connection.');
    } finally {
      setCreating(false);
    }
  }

  // Persist the discount confirmation into the freshly-created model config so it carries into the
  // dashboard, mirroring the dashboard's own autosave shape.
  function handlePricingDiscountConfirmedChange(confirmed: boolean) {
    setPricingDiscountConfirmed(confirmed);
    if (!analysisId || !review) return;
    void fetch(`/api/analyses/${analysisId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelConfig: { ...review.data.modelConfig, pricingDiscountConfirmed: confirmed } }),
    });
  }

  // "Fix source": override the detected provider when auto-detection is clearly wrong, the same
  // lever the dashboard exposes. Updates the local review so the parse-review labels follow.
  function handleSourceOverride(provider: Provider) {
    if (!analysisId || !review) return;
    setReview((prev) => (prev ? { ...prev, data: { ...prev.data, meta: { ...prev.data.meta, provider } } } : prev));
    void fetch(`/api/analyses/${analysisId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: { provider } }),
    });
  }

  return (
    <div className="mx-auto max-w-[880px] px-4 pb-16 pt-7 sm:px-6 sm:pt-8">
      <p className="mb-2 font-display text-xs font-semibold uppercase tracking-[0.14em] text-c-red">New opportunity</p>
      <h1 className="text-[28px] font-semibold text-c-text sm:text-[30px]">Upload a customer bill</h1>
      <p className="mt-1.5 text-[15px] text-c-muted">
        We isolate the addressable storage spend and model the move to Backblaze B2.
      </p>

      <Stepper current={currentStep} className="mb-6 mt-6" />

      {!analysisId ? (
        <div className="space-y-4">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <FieldCard label="Opportunity name">
              <input
                type="text"
                value={prospectName}
                onChange={(e) => setProspectName(e.target.value)}
                placeholder="e.g. Aperture Studios — Q3"
                className="w-full rounded-[9px] border border-c-border2 bg-c-bg px-3 py-2.5 text-sm font-medium text-c-text outline-none focus:border-c-red"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
            </FieldCard>
            <FieldCard label="Company name" hint="Optional">
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Aperture Studios, Inc."
                className="w-full rounded-[9px] border border-c-border2 bg-c-bg px-3 py-2.5 text-sm font-medium text-c-text outline-none focus:border-c-red"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </FieldCard>
          </div>
          <FieldCard label="Notes" hint="Optional">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any context about this deal…"
              rows={3}
              className="w-full resize-none rounded-[9px] border border-c-border2 bg-c-bg px-3 py-2.5 text-sm text-c-text outline-none focus:border-c-red"
            />
          </FieldCard>
          {error && <p className="text-sm text-c-red">{error}</p>}
          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-[10px] bg-[#e20626] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(226,6,38,0.28)] transition-colors hover:bg-[#b40a23] disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Continue to upload →'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Entered details, surfaced read-only above the dropzone. */}
          <div className="grid gap-3.5 sm:grid-cols-2">
            <FieldCard label="Opportunity name">
              <p className="text-sm font-medium text-c-text">{prospectName}</p>
            </FieldCard>
            <FieldCard label="Company name">
              <p className="text-sm font-medium text-c-text">{companyName.trim() || prospectName}</p>
            </FieldCard>
          </div>

          {/* Dropzone stays visible so the AE can swap the bill; dropping a new file re-parses. */}
          <FileUpload
            analysisId={analysisId}
            onUploadComplete={(data, file) => {
              setError('');
              setReview({ data: data as UploadResult, file });
            }}
            onError={setError}
          />

          {error && (
            <div className="rounded-xl border border-c-red/40 bg-c-red-soft px-4 py-3">
              <p className="text-sm text-c-red-dark">{error}</p>
            </div>
          )}

          {review && (
            <>
              {/* Uploaded-file row */}
              <div className="flex items-center gap-3.5 rounded-xl border border-c-border bg-c-surface px-4 py-3.5 shadow-sm">
                <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[9px] bg-c-red-soft text-[13px] font-bold text-c-red">
                  {fileTypeBadge(review.file.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-c-text">{review.file.name}</p>
                  <p className="text-xs text-c-subtle">
                    {formatBytes(review.file.sizeBytes)} · Parsed in {(review.file.elapsedMs / 1000).toFixed(1)}s
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-c-green-soft px-2.5 py-1 text-[11px] font-semibold text-c-green">✓ Parsed</span>
              </div>

              <ParseReview
                parsed={review.data.parsed}
                billType={review.data.meta.billType}
                provider={review.data.meta.provider}
                pricingDiscountConfirmed={pricingDiscountConfirmed}
                onPricingDiscountConfirmedChange={handlePricingDiscountConfirmedChange}
              />

              {showSourceOverride && (
                <div className="flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-c-border bg-c-surface2 px-3 py-2">
                  <label htmlFor="new-source-override" className="text-xs font-medium text-c-muted">Parser source override</label>
                  <select
                    id="new-source-override"
                    value={review.data.meta.provider}
                    onChange={(e) => handleSourceOverride(e.target.value as Provider)}
                    className="cursor-pointer rounded-md border border-c-border2 bg-c-surface px-2 py-1 pr-7 text-sm font-semibold text-c-text focus:border-c-red focus:outline-none"
                  >
                    <option value="aws">Amazon Web Services (AWS)</option>
                    <option value="gcp">Google Cloud Platform (GCP)</option>
                    <option value="azure">Microsoft Azure</option>
                    <option value="r2">Cloudflare R2</option>
                  </select>
                  <span className="text-xs text-c-subtle">Use only when the detected source is clearly wrong.</span>
                </div>
              )}

              <div className="flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowSourceOverride((shown) => !shown)}
                  aria-expanded={showSourceOverride}
                  className="rounded-[10px] border border-c-border2 bg-c-surface px-4 py-2.5 text-[13px] font-semibold text-c-muted transition-colors hover:bg-c-surface2"
                >
                  Fix source
                </button>
                <button
                  type="button"
                  onClick={() => router.push(`/analyses/${analysisId}`)}
                  className="inline-flex items-center gap-2 rounded-[10px] bg-[#e20626] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(226,6,38,0.28)] transition-colors hover:bg-[#b40a23]"
                >
                  Build the model →
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A labeled surface card wrapping a single form control or value. */
function FieldCard({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-c-border bg-c-surface p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <label className="text-xs font-semibold text-c-muted">{label}</label>
        {hint && <span className="text-[11px] text-c-subtle">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Three-step progress indicator: Details → Upload bill → Review (the modeled dashboard). */
function Stepper({ current, className = '' }: { current: number; className?: string }) {
  const steps = ['Details', 'Upload bill', 'Review'];
  return (
    <div className={`flex items-center ${className}`}>
      {steps.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <div key={label} className="flex items-center">
            <div className="flex items-center gap-2.5">
              <span
                className={`flex h-[26px] w-[26px] items-center justify-center rounded-full text-[13px] font-bold ${
                  done
                    ? 'bg-c-green text-white'
                    : active
                      ? 'bg-[#e20626] text-white'
                      : 'bg-c-surface2 text-c-subtle'
                }`}
              >
                {done ? '✓' : step}
              </span>
              <span className={`text-[13px] font-semibold ${active || done ? 'text-c-text' : 'text-c-subtle'}`}>{label}</span>
            </div>
            {step < steps.length && (
              <div className={`mx-3 h-0.5 w-12 max-w-[80px] flex-1 ${done ? 'bg-c-green' : 'bg-c-border2'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
