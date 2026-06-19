'use client';

import { useState, useRef, useEffect } from 'react';

interface EditableCellProps {
  value: number;
  onSave: (value: number) => void;
  format?: (value: number) => string;
  className?: string;
}

export function EditableCell({ value, onSave, format, className = '' }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.select();
    }
  }, [editing]);

  if (!editing) {
    return (
      <span
        className={`cursor-pointer hover:bg-bb-red-light px-1 rounded ${className}`}
        onClick={() => {
          setDraft(String(value));
          setEditing(true);
        }}
        title="Click to edit"
      >
        {format ? format(value) : value}
      </span>
    );
  }

  return (
    <input
      ref={inputRef}
      type="number"
      step="any"
      className="w-24 px-1 py-0.5 border rounded text-sm"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const num = parseFloat(draft);
        if (!isNaN(num) && num !== value) onSave(num);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const num = parseFloat(draft);
          if (!isNaN(num) && num !== value) onSave(num);
          setEditing(false);
        }
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}
