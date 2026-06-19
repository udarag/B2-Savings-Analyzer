'use client';

import { useEffect, useState, useRef } from 'react';
import { usePathname } from 'next/navigation';

interface UserProfile {
  displayName: string;
  title?: string;
}

export function UserMenu() {
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === '/login') return;
    Promise.all([
      fetch('/api/auth/me').then((r) => r.json()),
      fetch('/api/auth/profile').then((r) => r.json()),
    ]).then(([me, prof]) => {
      const userEmail = me.user?.email ?? null;
      setEmail(userEmail);
      if (prof.profile) {
        setProfile(prof.profile);
        setNameInput(prof.profile.displayName);
        setTitleInput(prof.profile.title || '');
      } else if (userEmail) {
        setShowSetup(true);
        setNameInput(emailToDisplayName(userEmail));
      }
    }).catch(() => setEmail(null));
  }, [pathname]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowPanel(false);
      }
    }
    if (showPanel) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPanel]);

  if (!email) return null;

  async function saveProfile() {
    if (!nameInput.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: nameInput.trim(),
          title: titleInput.trim() || undefined,
        }),
      });
      const { profile: updated } = await res.json();
      setProfile(updated);
      setShowPanel(false);
      setShowSetup(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  const displayName = profile?.displayName || email.split('@')[0];
  const initials = displayName.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="relative" ref={panelRef}>
      <div className="flex items-center gap-3">
        <button
          onClick={() => { setShowPanel(!showPanel); setNameInput(profile?.displayName || emailToDisplayName(email)); setTitleInput(profile?.title || ''); }}
          className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
        >
          <div className="w-7 h-7 rounded-full bg-bb-red/20 flex items-center justify-center">
            <span className="text-xs font-semibold text-bb-red-light">{initials}</span>
          </div>
          <span className="text-sm text-gray-300 hidden sm:inline">{displayName}</span>
        </button>
        <button
          onClick={handleLogout}
          className="text-xs text-gray-400 hover:text-white transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* Profile setup prompt (first login) */}
      {showSetup && !showPanel && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-lg shadow-xl border p-4 z-50">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Welcome! Set up your profile</h3>
          <p className="text-xs text-gray-500 mb-3">Your name will appear on customer reports.</p>
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Full name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-bb-red focus:border-transparent"
              autoFocus
            />
            <input
              type="text"
              placeholder="Title (e.g. Solutions Engineer)"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-bb-red focus:border-transparent"
            />
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setShowSetup(false)}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              Later
            </button>
            <button
              onClick={saveProfile}
              disabled={!nameInput.trim() || saving}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-bb-red rounded-md hover:bg-bb-red-dark disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Profile edit panel */}
      {showPanel && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-lg shadow-xl border p-4 z-50">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Edit Profile</h3>
          <div className="space-y-2">
            <div>
              <label className="text-xs font-medium text-gray-600">Name</label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-bb-red focus:border-transparent mt-0.5"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Title</label>
              <input
                type="text"
                placeholder="e.g. Solutions Engineer"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-bb-red focus:border-transparent mt-0.5"
              />
            </div>
            <p className="text-xs text-gray-400">{email}</p>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setShowPanel(false)}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={saveProfile}
              disabled={!nameInput.trim() || saving}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-bb-red rounded-md hover:bg-bb-red-dark disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function emailToDisplayName(email: string): string {
  const local = email.split('@')[0];
  return local
    .split(/[._-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
