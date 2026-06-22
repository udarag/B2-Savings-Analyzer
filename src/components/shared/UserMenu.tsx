'use client';

import { useEffect, useState, useRef } from 'react';
import { usePathname } from 'next/navigation';
import {
  getPreferredTheme,
  setThemePreference,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from './ThemeController';

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
  const [theme, setTheme] = useState<ThemePreference>('light');
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

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncTheme = () => setTheme(getPreferredTheme());
    const handleSystemChange = () => {
      try {
        if (window.localStorage.getItem(THEME_STORAGE_KEY)) return;
      } catch {
        // Fall back to system preference if storage is unavailable.
      }
      syncTheme();
    };

    syncTheme();
    window.addEventListener('storage', syncTheme);
    window.addEventListener(THEME_CHANGE_EVENT, syncTheme);
    media.addEventListener('change', handleSystemChange);

    return () => {
      window.removeEventListener('storage', syncTheme);
      window.removeEventListener(THEME_CHANGE_EVENT, syncTheme);
      media.removeEventListener('change', handleSystemChange);
    };
  }, []);

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

  function toggleTheme() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    setThemePreference(nextTheme);
  }

  const displayName = profile?.displayName || email.split('@')[0];
  const initials = displayName.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const darkMode = theme === 'dark';

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
        <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden z-50">
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
                type="button"
                role="switch"
                aria-checked={darkMode}
                onClick={toggleTheme}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                    darkMode ? 'bg-bb-red/15 text-bb-red' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {darkMode ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 15.5A9.75 9.75 0 0 1 8.5 2.25a7.5 7.5 0 1 0 13.25 13.25Z" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m0 13.5V21m9-9h-2.25M5.25 12H3m15.364-6.364-1.591 1.591M7.227 16.773l-1.591 1.591m12.728 0-1.591-1.591M7.227 7.227 5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-700">Dark Mode</span>
                    <span className="block text-xs text-gray-400">{darkMode ? 'On' : 'Off'}</span>
                  </span>
                </span>
                <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-all ${
                  darkMode ? 'bg-bb-red shadow-[0_0_18px_rgba(209,35,42,0.35)]' : 'bg-gray-200'
                }`}>
                  <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                    darkMode ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </span>
              </button>
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
