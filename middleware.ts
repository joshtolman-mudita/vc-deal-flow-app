import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Simple authentication middleware
// For production use, consider more robust solutions like NextAuth.js

const ALLOWED_EMAILS = [
  'jtolmie@muditavp.com',
  // Add other team members' emails here
];

const AUTH_PASSWORD = process.env.APP_PASSWORD || 'changeme';

export function middleware(request: NextRequest) {
  // Skip auth for all API routes (they handle their own auth)
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Check for auth cookie
  const authCookie = request.cookies.get('vc-deal-flow-auth');
  
  if (authCookie?.value === AUTH_PASSWORD) {
    return NextResponse.next();
  }

  // If not authenticated and not on login page, redirect to login
  if (!request.nextUrl.pathname.startsWith('/login')) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc)
     */
    '/((?!_next/static|_next/image|favicon.ico|images|icon.svg).*)',
  ],
};
