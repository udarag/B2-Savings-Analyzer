'use client';

import { useCallback, useState } from 'react';
import type { ParsedUsageFields } from '@/lib/analysis/usage-fields';

interface B2UsageExportUploadProps {
  analysisId: string;
  /** Called with the extracted fields when the export is read successfully, so the form pre-fills. */
  onParsed?: (parsed: ParsedUsageFields) => void;
}

/**
 * The recommended way to fill the commit-upsell form: print the account's Bzadmin Usage page to PDF
 * and drop it in. A PDF is parsed deterministically on Backblaze servers — nothing leaves. A
 * screenshot is a clearly-secondary, opt-in path read by Claude vision (an external LLM), and only
 * works when an API key is configured — said plainly at the point of choice. Either path pre-fills
 * the form for AE review on success; any failure falls back to the manual fields below.
 */
export function B2UsageExportUpload({ analysisId, onParsed }: B2UsageExportUploadProps) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'parsed' | 'manual' | 'error'>('idle');

  const handleFile = useCallback(async (file: File) => {
    setStatus('uploading');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/analyses/${analysisId}/usage-export`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        setStatus('error');
        return;
      }
      const data = await res.json();
      if (data.status === 'parsed' && data.parsed) {
        onParsed?.(data.parsed as ParsedUsageFields);
        setStatus('parsed');
      } else {
        // 'unavailable' (image, no key) or 'failed' (couldn't read) — both fall back to manual.
        setStatus('manual');
      }
    } catch {
      setStatus('error');
    }
  }, [analysisId, onParsed]);

  // One shared file picker; the PDF and screenshot affordances differ only in the accepted types, so
  // the recommended path and the external-LLM path stay visually distinct but share the upload logic.
  const openPicker = useCallback((accept: string) => {
    if (status === 'uploading') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void handleFile(file);
    };
    input.click();
  }, [handleFile, status]);

  const uploading = status === 'uploading';

  return (
    <div>
      {/* Primary path: the Bzadmin PDF. Deterministic, stays inside Backblaze — given the most weight. */}
      <div className="rounded-xl border border-c-purple/30 bg-c-surface p-4 shadow-[0_6px_20px_rgba(52,48,255,0.08)]">
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-full bg-c-purple px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Recommended</span>
          <span className="text-[11px] font-semibold text-c-green">Stays inside Backblaze</span>
        </div>
        {/* 3-step Bzadmin mini-diagram: open Usage → print to PDF → drop it here. */}
        <div className="mb-3.5 flex items-center gap-2">
          <Step n="1" title="Bzadmin" caption="open Usage" />
          <Arrow />
          <Step n="2" title="Print" caption="save as PDF" />
          <Arrow />
          <Step n="3" title="Drop" caption="here" highlight />
        </div>
        <button
          type="button"
          onClick={() => openPicker('application/pdf')}
          disabled={uploading}
          className="w-full rounded-[10px] border-2 border-dashed border-c-purple/40 bg-c-purple-soft/40 px-4 py-5 text-center transition-colors hover:border-c-purple disabled:cursor-wait disabled:opacity-60"
        >
          {uploading ? (
            <p className="text-sm text-c-muted">Reading usage export…</p>
          ) : (
            <>
              <p className="text-sm font-semibold text-c-text">Drop the Usage PDF</p>
              <p className="mt-0.5 text-[11px] text-c-muted">Read on Backblaze servers — deterministic, nothing sent out</p>
            </>
          )}
        </button>
      </div>

      {/* Secondary path: a screenshot, read by an external LLM — stated honestly at the point of choice. */}
      <button
        type="button"
        onClick={() => openPicker('image/png,image/jpeg')}
        disabled={uploading}
        className="mt-2.5 flex w-full items-start gap-2.5 rounded-xl border border-c-border bg-c-surface px-3.5 py-3 text-left transition-colors hover:border-c-border2 disabled:opacity-60"
      >
        <ImageIcon />
        <span>
          <span className="block text-xs font-semibold text-c-text">Have a screenshot instead? <span className="font-normal text-c-muted">Read by Claude vision.</span></span>
          <span className="mt-0.5 block text-[10.5px] text-c-amber">The image is sent to an external LLM. Off unless an API key is set.</span>
        </span>
      </button>

      {status === 'parsed' && (
        <p className="mt-2 text-xs text-c-green">Read the export and filled in the fields below — double-check them before saving.</p>
      )}
      {status === 'manual' && (
        <p className="mt-2 text-xs text-c-subtle">Couldn&apos;t auto-read this — please fill in the fields below.</p>
      )}
      {status === 'error' && (
        <p className="mt-2 text-xs text-c-red">Couldn&apos;t upload the file — please fill in the fields below.</p>
      )}
    </div>
  );
}

/** One box in the Bzadmin mini-diagram. The final "Drop here" step is tinted to lead the eye. */
function Step({ n, title, caption, highlight }: { n: string; title: string; caption: string; highlight?: boolean }) {
  return (
    <div className={`flex-1 rounded-lg border px-2 py-2 text-center ${highlight ? 'border-c-purple/40 bg-c-purple-soft' : 'border-c-border'}`}>
      <div className={`text-[10px] font-bold ${highlight ? 'text-c-purple' : 'text-c-text'}`}>{n} · {title}</div>
      <div className={`text-[10px] ${highlight ? 'text-c-purple' : 'text-c-muted'}`}>{caption}</div>
    </div>
  );
}

function Arrow() {
  return <span className="shrink-0 text-c-subtle" aria-hidden="true">→</span>;
}

function ImageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mt-0.5 shrink-0 text-c-subtle" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="m21 15-4-4-9 8" />
    </svg>
  );
}
