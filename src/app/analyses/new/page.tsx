'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Analysis, ParsedBill, ModelConfig, OpportunityType, Provider } from '@/types/analysis';
import { FileUpload, type UploadedFileMeta } from '@/components/upload/FileUpload';
import { ParseReview } from '@/components/upload/ParseReview';
import { B2UsageForm } from '@/components/upload/B2UsageForm';
import { useDocumentTitle } from '@/components/shared/useDocumentTitle';

// What POST /api/analyses/[id]/upload returns — enough to render the parse review inline.
interface UploadResult {
  parsed: ParsedBill;
  meta: Analysis;
  modelConfig: ModelConfig;
  overdriveVariant?: Analysis | null;
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
  const [opportunityType, setOpportunityType] = useState<OpportunityType>('migration');
  const [prospectName, setProspectName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [notes, setNotes] = useState('');
  const [createOverdriveVariant, setCreateOverdriveVariant] = useState(false);
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
          createOverdriveVariant: opportunityType === 'migration' && createOverdriveVariant,
          opportunityType,
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
      <h1 className="text-[28px] font-semibold text-c-text sm:text-[30px]">
        {opportunityType === 'commit-upsell' ? 'Pitch a B2 commitment upgrade' : 'Upload a customer bill'}
      </h1>
      <p className="mt-1.5 text-[15px] text-c-muted">
        {opportunityType === 'commit-upsell'
          ? 'For an existing B2 customer on Uncommitted — model the throughput gain from signing a contract.'
          : 'We isolate the addressable storage spend and model the move to Backblaze B2.'}
      </p>

      <Stepper current={currentStep} usageStep={opportunityType === 'commit-upsell'} className="mb-6 mt-6" />

      {!analysisId ? (
        <div className="space-y-4">
          <p className="text-[13px] font-semibold text-c-muted">Pick the motion — two different journeys</p>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <OpportunityTypeCard
              label="Migrating from another cloud"
              description="Parse an AWS / GCP / Azure bill → model the move to B2."
              nextLabel="upload a bill"
              icon={<MigrationIcon />}
              active={opportunityType === 'migration'}
              onClick={() => setOpportunityType('migration')}
            />
            <OpportunityTypeCard
              label="Existing B2 customer"
              description="Enter current usage → pitch a contract for higher throughput."
              nextLabel="enter usage"
              icon={<UpsellIcon />}
              active={opportunityType === 'commit-upsell'}
              onClick={() => setOpportunityType('commit-upsell')}
            />
          </div>
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
          {opportunityType === 'migration' && (
            /* Promoted add-on: the consequence (a second, linked opportunity) is easy to miss, so we
               show a live preview of the two linked opportunities ticking this will create. */
            <div className="rounded-xl border border-c-purple/30 bg-c-purple-soft/40 p-3.5">
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={createOverdriveVariant}
                  onChange={(e) => setCreateOverdriveVariant(e.target.checked)}
                  className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[#3430ff]"
                />
                <span>
                  <span className="font-bold text-c-text">Also build an Overdrive variant</span>
                  <span className="mt-0.5 block text-xs text-c-muted">
                    Walk in with a Standard <em>and</em> an Overdrive report, side by side.
                  </span>
                </span>
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-c-purple/30 pt-3">
                <span className="text-[10.5px] font-semibold text-c-purple">This creates</span>
                <span className="max-w-full truncate rounded-md border border-c-border bg-c-surface px-2 py-1 text-[10.5px] font-semibold text-c-text">
                  {(prospectName.trim() || 'This opportunity')} — Standard
                </span>
                <span className="text-c-subtle">+</span>
                <span className="max-w-full truncate rounded-md border border-c-purple/40 bg-c-surface px-2 py-1 text-[10.5px] font-semibold text-c-purple">
                  {(prospectName.trim() || 'This opportunity')} — Overdrive
                </span>
              </div>
            </div>
          )}
          {error && <p className="text-sm text-c-red">{error}</p>}
          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-[10px] bg-c-brand px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(226,6,38,0.28)] transition-colors hover:bg-c-brand-hover disabled:opacity-50"
            >
              {creating ? 'Creating…' : opportunityType === 'commit-upsell' ? 'Continue →' : 'Continue to upload →'}
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

          {opportunityType === 'commit-upsell' ? (
            <B2UsageForm analysisId={analysisId} onSaved={() => router.push(`/analyses/${analysisId}`)} />
          ) : (
            <>
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

                  {review.data.overdriveVariant && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-c-red/40 bg-c-red-soft px-4 py-3">
                      <p className="text-sm text-c-red-dark">Overdrive variant created for {review.data.overdriveVariant.prospectName}.</p>
                      <Link
                        href={`/analyses/${review.data.overdriveVariant.id}`}
                        className="shrink-0 text-sm font-semibold text-c-red underline hover:text-c-red-dark"
                      >
                        View it →
                      </Link>
                    </div>
                  )}

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
                      className="inline-flex items-center gap-2 rounded-[10px] bg-c-brand px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(226,6,38,0.28)] transition-colors hover:bg-c-brand-hover"
                    >
                      Build the model →
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Selectable card for the opportunity-type choice (migration vs. commit-upsell). This is the first
 * fork in the whole tool, so each card carries an icon and a "Next: …" line to make the two divergent
 * journeys (a bill upload vs. usage entry) legible before the AE commits.
 */
function OpportunityTypeCard({
  label,
  description,
  nextLabel,
  icon,
  active,
  onClick,
}: {
  label: string;
  description: string;
  nextLabel: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-2xl border bg-c-surface p-4 text-left shadow-sm transition-colors ${
        active ? 'border-2 border-c-red' : 'border border-c-border hover:border-c-border2'
      }`}
    >
      {active && <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-c-red" />}
      <span className={active ? 'text-c-red' : 'text-c-subtle'}>{icon}</span>
      <p className="mt-2.5 text-sm font-bold text-c-text">{label}</p>
      <p className="mt-1 text-xs text-c-muted">{description}</p>
      <p className={`mt-2 text-[10.5px] font-semibold ${active ? 'text-c-red' : 'text-c-subtle'}`}>Next: {nextLabel}</p>
    </button>
  );
}

/** Cloud-with-up-arrow: the migration motion (parse a bill from another cloud). */
function MigrationIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M3 15a4 4 0 0 0 4 4h9a5 5 0 0 0 1-9.9A6 6 0 0 0 5.2 9.5" />
      <path d="M12 18v-6" />
      <path d="m9.5 14.5 2.5-2.5 2.5 2.5" />
    </svg>
  );
}

/** Lightning bolt: the commit-upsell motion (unlock throughput headroom on B2). */
function UpsellIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
    </svg>
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

/** Three-step progress indicator: Details → Upload bill/Usage → Review (the modeled dashboard). */
function Stepper({ current, usageStep, className = '' }: { current: number; usageStep?: boolean; className?: string }) {
  const steps = ['Details', usageStep ? 'Usage' : 'Upload bill', 'Review'];
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
                      ? 'bg-c-brand text-white'
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
