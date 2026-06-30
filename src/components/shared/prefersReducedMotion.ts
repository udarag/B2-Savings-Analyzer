/**
 * True when the user has asked the OS to minimize motion. SSR-safe: returns
 * false when `window`/`matchMedia` is unavailable, so it can be read during
 * render (e.g. a lazy useState initializer) as well as inside effects.
 *
 * Shared by every JS-driven motion path (count-up metrics, scroll reveals,
 * chart draw-on) so the reduced-motion opt-out is decided in exactly one place.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
