'use client';

import { useState, useRef, useEffect } from 'react';

interface InlineEditTextProps {
  value: string;
  /** Fired only on a real, non-empty change (trimmed value differs from current). */
  onSave: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Render a textarea (Cmd/Ctrl+Enter to save) instead of a single-line input (Enter to save). */
  multiline?: boolean;
  maxLength?: number;
}

/**
 * Click-to-edit text used for AE-editable report fields (customer name, notes, etc.).
 * Displays the value with a hover pencil; clicking swaps to an input/textarea that
 * commits on blur or Enter and discards on Escape.
 */
export function InlineEditText({
  value,
  onSave,
  placeholder = 'Click to Edit',
  className = '',
  multiline = false,
  maxLength,
}: InlineEditTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const save = () => {
    // Skip onSave when the draft is empty or unchanged, so blurring a field the
    // AE only glanced at doesn't clobber it with a blank or fire a no-op write.
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (!editing) {
    return (
      <span
        className={`cursor-pointer hover:bg-bb-red-light px-1 -mx-1 rounded transition-colors group ${className}`}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        title="Click to Edit"
      >
        {value || <span className="text-gray-400 italic">{placeholder}</span>}
        <svg className="inline-block w-3 h-3 ml-1.5 opacity-0 group-hover:opacity-40 transition-opacity" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
        </svg>
      </span>
    );
  }

  if (multiline) {
    return (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        className="w-full px-2 py-1 border rounded text-sm resize-none"
        rows={3}
        value={draft}
        maxLength={maxLength}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
          if (e.key === 'Escape') cancel();
        }}
      />
    );
  }

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type="text"
      className={`px-1 py-0.5 border rounded ${className}`}
      value={draft}
      maxLength={maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') cancel();
      }}
    />
  );
}
