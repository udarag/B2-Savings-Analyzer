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

function isApiRequest(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

function unauthorizedResponse(req: NextRequest): NextResponse {
  if (isApiRequest(req.nextUrl.pathname)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', req.url));
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || isPublic(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return unauthorizedResponse(req);
  }

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
    const response = unauthorizedResponse(req);
    response.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
    return response;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
