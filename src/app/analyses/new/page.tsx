'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUpload } from '@/components/upload/FileUpload';

export default function NewAnalysisPage() {
  const router = useRouter();
  const [prospectName, setProspectName] = useState('');
  const [notes, setNotes] = useState('');
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    if (!prospectName.trim()) {
      setError('Please enter a prospect name');
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

      if (!res.ok) throw new Error('Failed to create analysis');
      const data = await res.json();
      setAnalysisId(data.id);
    } catch {
      setError('Failed to create analysis. Check B2 connection.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">New Analysis</h1>

      {!analysisId ? (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Prospect / Customer Name
            </label>
            <input
              type="text"
              value={prospectName}
              onChange={(e) => setProspectName(e.target.value)}
              placeholder="e.g., Acme Corp"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-bb-red focus:border-transparent"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
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
            {creating ? 'Creating...' : 'Continue'}
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-green-50 rounded-lg p-4">
            <p className="text-sm text-green-800">
              Analysis created for <strong>{prospectName}</strong>. Now upload a bill.
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
