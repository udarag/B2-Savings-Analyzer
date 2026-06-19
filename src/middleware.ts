import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE_NAME = 'b2sa_session';

const PUBLIC_PATHS = ['/login', '/api/auth/'];

const STATIC_EXT = /\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|woff2?|ttf|eot)$/;

function isPublic(pathname: string): boolean {
  if (STATIC_EXT.test(pathname)) return true;
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Static assets and public paths don't need auth
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || isPublic(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    if (payload.purpose !== 'session' || !payload.email) {
      return NextResponse.redirect(new URL('/login', req.url));
    }

    // Pass the user email in a header so API routes can read it without re-verifying
    const response = NextResponse.next();
    response.headers.set('x-user-email', payload.email as string);
    return response;
  } catch {
    // Invalid or expired token — clear cookie and redirect
    const response = NextResponse.redirect(new URL('/login', req.url));
    response.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
    return response;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
