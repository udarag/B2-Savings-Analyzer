'use client';

import { useCallback, useState } from 'react';

interface B2UsageScreenshotUploadProps {
  analysisId: string;
}

/**
 * Optional, supplementary affordance next to the manual B2UsageForm fields: upload a screenshot
 * of the customer's B2 usage dashboard. Screenshot parsing is NOT implemented — the backend route
 * stores the image and returns 501, which this component treats as an expected, neutral outcome
 * (not an error) since the AE is always expected to fill in the manual fields regardless.
 */
export function B2UsageScreenshotUpload({ analysisId }: B2UsageScreenshotUploadProps) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'not-implemented' | 'error'>('idle');

  const handleFile = useCallback(async (file: File) => {
    setStatus('uploading');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/analyses/${analysisId}/usage-screenshot`, {
        method: 'POST',
        body: formData,
      });
      setStatus(res.status === 501 ? 'not-implemented' : res.ok ? 'not-implemented' : 'error');
    } catch {
      setStatus('error');
    }
  }, [analysisId]);

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
          <p className="text-sm text-c-muted">Uploading…</p>
        ) : (
          <>
            <p className="text-sm font-semibold text-c-text">
              Upload a screenshot of the customer&apos;s B2 usage dashboard
            </p>
            <p className="mt-1 text-xs text-c-muted">PNG or JPEG</p>
          </>
        )}
      </div>
      {status === 'not-implemented' && (
        <p className="mt-2 text-xs text-c-subtle">Couldn&apos;t auto-read this yet — please fill in the fields below.</p>
      )}
      {status === 'error' && (
        <p className="mt-2 text-xs text-c-red">Couldn&apos;t upload the screenshot — please fill in the fields below.</p>
      )}
    </div>
  );
}
