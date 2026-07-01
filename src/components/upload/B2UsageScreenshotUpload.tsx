'use client';

import { useCallback, useState } from 'react';
import type { ParsedUsageFields } from '@/lib/analysis/usage-screenshot-parse';

interface B2UsageScreenshotUploadProps {
  analysisId: string;
  /** Called with the extracted fields when the screenshot is read successfully, so the form pre-fills. */
  onParsed?: (parsed: ParsedUsageFields) => void;
}

/**
 * Optional, supplementary affordance next to the manual B2UsageForm fields: upload a screenshot of
 * the customer's B2 usage summary. When the backend has vision parsing configured it extracts the
 * numbers and pre-fills the form; otherwise (or on failure) it shows a neutral note and the AE fills
 * the fields in by hand. Either way this never blocks manual entry.
 */
export function B2UsageScreenshotUpload({ analysisId, onParsed }: B2UsageScreenshotUploadProps) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'parsed' | 'manual' | 'error'>('idle');

  const handleFile = useCallback(async (file: File) => {
    setStatus('uploading');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/analyses/${analysisId}/usage-screenshot`, {
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
        // 'unavailable' (no key configured) or 'failed' (couldn't read) — both fall back to manual.
        setStatus('manual');
      }
    } catch {
      setStatus('error');
    }
  }, [analysisId, onParsed]);

  return (
    <div>
      <div className="my-3 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-c-subtle">
        <span className="h-px flex-1 bg-c-border" />
        or
        <span className="h-px flex-1 bg-c-border" />
      </div>
      <div
        className={`rounded-xl border-2 border-dashed bg-c-surface px-4 py-5 text-center transition-colors ${
          status === 'uploading' ? 'pointer-events-none opacity-60' : 'cursor-pointer border-c-border2 hover:border-c-red'
        }`}
        onClick={() => {
          if (status === 'uploading') return;
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/png,image/jpeg';
          input.onchange = () => {
            const file = input.files?.[0];
            if (file) void handleFile(file);
          };
          input.click();
        }}
      >
        {status === 'uploading' ? (
          <p className="text-sm text-c-muted">Reading screenshot…</p>
        ) : (
          <>
            <p className="text-sm font-semibold text-c-text">
              Upload a screenshot of the customer&apos;s B2 usage dashboard
            </p>
            <p className="mt-1 text-xs text-c-muted">PNG or JPEG</p>
          </>
        )}
      </div>
      {status === 'parsed' && (
        <p className="mt-2 text-xs text-c-green">Read the screenshot and filled in the fields below — double-check them before saving.</p>
      )}
      {status === 'manual' && (
        <p className="mt-2 text-xs text-c-subtle">Couldn&apos;t auto-read this — please fill in the fields below.</p>
      )}
      {status === 'error' && (
        <p className="mt-2 text-xs text-c-red">Couldn&apos;t upload the screenshot — please fill in the fields below.</p>
      )}
    </div>
  );
}
