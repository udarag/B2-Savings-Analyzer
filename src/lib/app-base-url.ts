/**
 * Resolve the app's externally-reachable base URL for building absolute links (e.g. in emails/PDFs).
 * Prefers the server-only APP_BASE_URL, falls back to the client-exposed NEXT_PUBLIC_BASE_URL, then
 * to localhost for dev. Trailing slashes are stripped so callers can append "/path" without doubling up.
 */
export function getAppBaseUrl(): string {
  const raw =
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    'http://localhost:3000';

  return raw.replace(/\/+$/, '');
}
