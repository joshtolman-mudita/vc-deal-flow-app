import { NextRequest, NextResponse } from 'next/server';

const AUTH_PASSWORD = process.env.APP_PASSWORD || 'changeme';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { password } = body;

    if (password === AUTH_PASSWORD) {
      const response = NextResponse.json({ success: true });
      
      // Set auth cookie (30 days expiry)
      response.cookies.set('vc-deal-flow-auth', AUTH_PASSWORD, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: '/',
      });

      return response;
    }

    return NextResponse.json(
      { success: false, error: 'Invalid password' },
      { status: 401 }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Login failed' },
      { status: 500 }
    );
  }
}
