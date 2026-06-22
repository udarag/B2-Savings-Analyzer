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
  const [editing, setEditing] = useState(false);
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
      setEditing(false);
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
      <button
        onClick={() => { setShowPanel(!showPanel); setEditing(false); setNameInput(profile?.displayName || emailToDisplayName(email)); setTitleInput(profile?.title || ''); }}
        className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
      >
        <div className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center">
          <span className="text-xs font-semibold text-white">{initials}</span>
        </div>
        <span className="text-sm text-gray-300 hidden sm:inline">{displayName}</span>
        <svg className="w-3 h-3 text-gray-400 hidden sm:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M19 9l-7 7-7-7" /></svg>
      </button>

      {/* Profile setup prompt (first login) */}
      {showSetup && !showPanel && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-lg shadow-xl border p-4 z-50">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Welcome! Set Up Your Profile</h3>
          <p className="text-xs text-gray-500 mb-3">Your name will appear on customer reports.</p>
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Full Name"
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

      {/* Profile panel */}
      {showPanel && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden z-50">
          <div className="px-4 pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-bb-navy flex items-center justify-center shrink-0">
                <span className="text-sm font-semibold text-white">{initials}</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{displayName}</p>
                <p className="text-xs text-gray-400 truncate">{profile?.title || email}</p>
              </div>
            </div>
          </div>
          {editing ? (
            <div className="px-4 pb-3 border-t border-gray-100 pt-3">
              <div className="space-y-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Full Name"
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-bb-red focus:border-transparent"
                  autoFocus
                />
                <input
                  type="text"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  placeholder="Title (e.g. Solutions Engineer)"
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-bb-red focus:border-transparent"
                />
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => { setEditing(false); setNameInput(profile?.displayName || emailToDisplayName(email!)); setTitleInput(profile?.title || ''); }}
                  className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveProfile}
                  disabled={!nameInput.trim() || saving}
                  className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-bb-red rounded-md hover:bg-bb-red-dark disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="border-t border-gray-100">
              <button
                onClick={() => setEditing(true)}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
                Edit Profile
              </button>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3-3h-9m9 0l-3-3m3 3l-3 3" /></svg>
                Sign Out
              </button>
            </div>
          )}
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
