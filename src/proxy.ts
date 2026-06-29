// Edge auth gate: the first line of defense that runs before any page or API route. It verifies
// the session cookie and bounces unauthenticated traffic, so the whole tool is locked down to
// signed-in AEs. In-handler checks (src/lib/auth/session.ts) still re-verify; this is not the only
// guard. Re-verifies the JWT here rather than calling tokens.ts because edge runtime can't import
// the Node-only modules that file pulls in.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// Must match the cookie name written at sign-in and read by src/lib/auth/session.ts.
const COOKIE_NAME = 'b2sa_session';

// Routes reachable without a session: the login page and the auth API (magic-link request/verify).
// A signed-out user has to be able to reach these to sign in at all.
const PUBLIC_PATHS = ['/login', '/api/auth/'];

const STATIC_EXT = /\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|woff2?|ttf|eot)$/;

function isPublic(pathname: string): boolean {
  if (STATIC_EXT.test(pathname)) return true;
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

function isApiRequest(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

// API callers get a 401 JSON they can handle; browsers get redirected to the login page.
function unauthorizedResponse(req: NextRequest): NextResponse {
  if (isApiRequest(req.nextUrl.pathname)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', req.url));
}

/** Edge entry point: allow framework/static/public paths through, otherwise require a valid session JWT. */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || isPublic(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return unauthorizedResponse(req);
  }

  // Fail closed: a missing signing secret means we can't trust any token, so deny rather than
  // accidentally serving the app unauthenticated.
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return unauthorizedResponse(req);
  }

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    if (payload.purpose !== 'session' || !payload.email) {
      return unauthorizedResponse(req);
    }

    return NextResponse.next();
  } catch {
    // Token present but invalid/expired: clear the stale cookie so the browser stops resending it
    // on every request and the user gets a clean login.
    const response = unauthorizedResponse(req);
    response.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
    return response;
  }
}

// Run the proxy on everything except Next's build assets and the favicon; the in-handler checks
// above further exclude public paths. Keep in sync with isPublic().
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
