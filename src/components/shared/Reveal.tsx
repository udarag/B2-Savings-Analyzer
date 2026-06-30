'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { prefersReducedMotion } from './prefersReducedMotion';

interface RevealProps {
  children: ReactNode;
  /**
   * Position within a group of siblings. Scales the entrance delay so items
   * cascade in top-to-bottom. Capped so long lists don't build up a long lag.
   */
  index?: number;
  /** Extra classes merged onto the reveal wrapper. */
  className?: string;
}

// useLayoutEffect warns when run on the server; fall back to useEffect there.
// We need the layout variant on the client so the above-the-fold decision is
// made before the browser paints (no flash of the pre-reveal opacity:0 state).
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Wraps content in a one-shot entrance animation (see `.bb-reveal` in
 * globals.css). The element fades + rises into view the first time it scrolls
 * into the viewport — or immediately, with no flash, if it is already above the
 * fold on first paint. The reveal fires once and then stops observing, so a
 * parent re-render (e.g. an AE dragging a slider) never replays it. Honors
 * prefers-reduced-motion by showing content straight away.
 */
export function Reveal({ children, index = 0, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Reduced motion: reveal immediately and skip the observer entirely. (The CSS
    // opt-out also forces opacity:1, so content is safe even before this runs.)
    if (prefersReducedMotion()) {
      setRevealed(true);
      return;
    }

    // Already on screen at first paint → reveal now so the entrance plays from
    // frame one, rather than waiting on the observer's async first callback and
    // briefly flashing the opacity:0 resting state.
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const rect = el.getBoundingClientRect();
    if (rect.top < viewportHeight && rect.bottom > 0) {
      setRevealed(true);
      return;
    }

    // No IntersectionObserver (very old browser) → just show it.
    if (typeof IntersectionObserver !== 'function') {
      setRevealed(true);
      return;
    }

    // Below the fold → reveal once it scrolls in, then disconnect (fire-once).
    // Also reveal if the element has been scrolled *past* (top above the viewport):
    // a single large jump (End key, find-in-page, scroll restoration) can move an
    // element from below the fold to above it without ever leaving an intersecting
    // frame, which would otherwise strand it at opacity:0 forever.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting || entry.boundingClientRect.top < 0)) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`bb-reveal${revealed ? ' in-view' : ''}${className ? ` ${className}` : ''}`}
      style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}
    >
      {children}
    </div>
  );
}
