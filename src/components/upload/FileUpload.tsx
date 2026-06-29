'use client';

import { useState, useCallback } from 'react';

interface FileUploadProps {
  analysisId: string;
  /** Receives the parse response from the upload endpoint on success. */
  onUploadComplete: (data: unknown) => void;
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
    setProgress('Uploading and Parsing Bill...');

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
      onUploadComplete(data);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [analysisId, onUploadComplete, onError]);

  return (
    <div
      className={`
        border-2 border-dashed rounded-lg p-12 text-center transition-colors
        ${dragging ? 'border-bb-red bg-bb-red-light' : 'border-gray-300 hover:border-gray-400'}
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
          <div className="animate-spin inline-block w-8 h-8 border-4 border-bb-red border-t-transparent rounded-full mb-3" />
          <p className="text-gray-600">{progress}</p>
        </div>
      ) : (
        <div>
          <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <p className="text-lg font-medium text-gray-700 mb-1">
            Drop a Cloud Bill Here
          </p>
          <p className="text-sm text-gray-500">
            PDF, CSV, or Excel — AWS or GCP Billing Export
          </p>
        </div>
      )}
    </div>
  );
}
