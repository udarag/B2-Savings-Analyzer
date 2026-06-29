'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUpload } from '@/components/upload/FileUpload';
import { useDocumentTitle } from '@/components/shared/useDocumentTitle';

/**
 * Two-step "new opportunity" flow: first create the analysis record (POST /api/analyses), then,
 * once we have an id, swap the form for the bill uploader. We create up front rather than on upload
 * so the file has an analysis to attach to.
 */
export default function NewAnalysisPage() {
  const router = useRouter();
  const [prospectName, setProspectName] = useState('');
  const [notes, setNotes] = useState('');
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  useDocumentTitle(analysisId ? `${prospectName} upload` : 'New opportunity');

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
        body: JSON.stringify({ prospectName: prospectName.trim(), notes: notes.trim() || undefined }),
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

  return (
    <div className="max-w-2xl mx-auto px-6 py-6 sm:py-8 lg:py-10">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New opportunity</h1>

      {!analysisId ? (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Opportunity name
            </label>
            <input
              type="text"
              value={prospectName}
              onChange={(e) => setProspectName(e.target.value)}
              placeholder="e.g., Acme Corp"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-bb-red focus:border-transparent"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <p className="mt-1 text-xs text-gray-500">
              Used as the customer company name by default; you can edit the company name later on the analysis page.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any context about this deal..."
              rows={3}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-bb-red focus:border-transparent"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            onClick={handleCreate}
            disabled={creating}
            className="w-full py-2.5 bg-bb-red text-white font-medium rounded-lg hover:bg-bb-red-dark disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create opportunity'}
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-green-50 rounded-lg p-4">
            <p className="text-sm text-green-800">
              Opportunity created for <strong>{prospectName}</strong>. Now upload a bill.
            </p>
          </div>
          <FileUpload
            analysisId={analysisId}
            onUploadComplete={() => router.push(`/analyses/${analysisId}`)}
            onError={setError}
          />
          {error && (
            <div className="bg-red-50 rounded-lg p-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
