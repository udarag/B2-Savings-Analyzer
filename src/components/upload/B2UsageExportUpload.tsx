'use client';

import { useCallback, useState } from 'react';
import type { ParsedUsageFields } from '@/lib/analysis/usage-fields';

interface B2UsageExportUploadProps {
  analysisId: string;
  /** Called with the extracted fields when the export is read successfully, so the form pre-fills. */
  onParsed?: (parsed: ParsedUsageFields) => void;
}

/**
 * The default way to fill the commit-upsell form: upload the account's B2 usage export. A PDF
 * printed from Bzadmin's Usage page is parsed deterministically server-side; a screenshot image is
 * read via Claude vision when that's configured. Either way, on success the form pre-fills and the
 * AE reviews; on any failure it shows a neutral note and the AE fills the fields in by hand.
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

  return (
    <div>
      <div
        className={`rounded-xl border-2 border-dashed bg-c-surface px-4 py-6 text-center transition-colors ${
          status === 'uploading' ? 'pointer-events-none opacity-60' : 'cursor-pointer border-c-border2 hover:border-c-red'
        }`}
        onClick={() => {
          if (status === 'uploading') return;
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'application/pdf,image/png,image/jpeg';
          input.onchange = () => {
            const file = input.files?.[0];
            if (file) void handleFile(file);
          };
          input.click();
        }}
      >
        {status === 'uploading' ? (
          <p className="text-sm text-c-muted">Reading usage export…</p>
        ) : (
          <>
            <p className="text-sm font-semibold text-c-text">Upload the account&apos;s B2 usage export</p>
            <p className="mt-1 text-xs text-c-muted">PDF (recommended) or a screenshot — PNG/JPEG</p>
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-c-subtle">
        In Bzadmin, open <span className="font-medium text-c-muted">Usage</span>{' '}for the account, print the page to PDF, and upload it here — we&apos;ll fill in the fields below.
      </p>
      {status === 'parsed' && (
        <p className="mt-1 text-xs text-c-green">Read the export and filled in the fields below — double-check them before saving.</p>
      )}
      {status === 'manual' && (
        <p className="mt-1 text-xs text-c-subtle">Couldn&apos;t auto-read this — please fill in the fields below.</p>
      )}
      {status === 'error' && (
        <p className="mt-1 text-xs text-c-red">Couldn&apos;t upload the file — please fill in the fields below.</p>
      )}
    </div>
  );
}
