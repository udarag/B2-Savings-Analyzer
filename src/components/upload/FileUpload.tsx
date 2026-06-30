'use client';

import { useState, useCallback } from 'react';

/** Lightweight file facts surfaced to the caller so it can render an "uploaded file" row. */
export interface UploadedFileMeta {
  name: string;
  sizeBytes: number;
  /** Wall-clock time from POST to parsed response, used for the "Parsed in Ns" label. */
  elapsedMs: number;
}

interface FileUploadProps {
  analysisId: string;
  /** Receives the parse response from the upload endpoint on success, plus the uploaded file's facts. */
  onUploadComplete: (data: unknown, fileMeta: UploadedFileMeta) => void;
  onError: (error: string) => void;
}

/**
 * Drag-and-drop / click-to-pick uploader for a customer's cloud bill (AWS or GCP,
 * as PDF/CSV/Excel). Validates the file type client-side, then POSTs it to the
 * analysis upload endpoint where the server-side parser does the real work.
 */
export function FileUpload({ analysisId, onUploadComplete, onError }: FileUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');

  const handleFile = useCallback(async (file: File) => {
    const validTypes = [
      'application/pdf',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    const validExts = ['.pdf', '.csv', '.xlsx', '.xls'];
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));

    // Accept on EITHER a known MIME type or a known extension: browsers and OSes
    // report inconsistent (or empty) MIME types for CSV/Excel, so the extension
    // is the reliable fallback. Server-side detection is the real gate.
    if (!validTypes.includes(file.type) && !validExts.includes(ext)) {
      onError('Unsupported file type. Please upload a PDF, CSV, or Excel file.');
      return;
    }

    setUploading(true);
    setProgress('Uploading and parsing bill…');
    const startedAt = performance.now();

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`/api/analyses/${analysisId}/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }

      const data = await res.json();
      setProgress('Done!');
      onUploadComplete(data, { name: file.name, sizeBytes: file.size, elapsedMs: performance.now() - startedAt });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [analysisId, onUploadComplete, onError]);

  return (
    <div
      className={`
        rounded-2xl border-2 border-dashed bg-c-surface p-8 text-center transition-colors
        ${dragging ? 'border-c-red bg-c-red-soft' : 'border-c-border2 hover:border-c-red'}
        ${uploading ? 'pointer-events-none opacity-60' : 'cursor-pointer'}
      `}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      }}
      onClick={() => {
        if (uploading) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pdf,.csv,.xlsx,.xls';
        input.onchange = () => {
          const file = input.files?.[0];
          if (file) handleFile(file);
        };
        input.click();
      }}
    >
      {uploading ? (
        <div>
          <div className="mb-3 inline-block h-8 w-8 animate-spin rounded-full border-4 border-c-red border-t-transparent" />
          <p className="text-c-muted">{progress}</p>
        </div>
      ) : (
        <div>
          {/* Upload glyph in a soft-red tile, per the design. */}
          <div className="mx-auto mb-3.5 flex h-[54px] w-[54px] items-center justify-center rounded-[14px] bg-c-red-soft">
            <svg className="h-[26px] w-[26px] text-c-red" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4m0 0L8 8m4-4 4 4" />
              <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
            </svg>
          </div>
          <p className="text-base font-semibold text-c-text">
            Drop your cloud bill here, or <span className="text-c-red">browse</span>
          </p>
          <p className="mt-1.5 text-[12.5px] text-c-muted">PDF, CSV, or Excel — AWS or GCP billing export</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {['AWS detailed PDF', 'S3 cost CSV', 'GCP cost CSV', 'Excel → CSV'].map((label) => (
              <span key={label} className="rounded-full bg-c-surface2 px-2.5 py-1 text-[11px] font-semibold text-c-muted">
                {label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
