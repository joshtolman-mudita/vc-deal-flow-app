# Authentication Setup

## Overview

The VC Deal Flow app uses simple password-based authentication for team access. This provides a balance between security and ease of use for a small internal team.

## How It Works

1. **Login Page**: Users are automatically redirected to `/login` when accessing the app
2. **Team Password**: All team members share a single password
3. **Session Cookie**: After successful login, a secure cookie is set for 30 days
4. **Auto-redirect**: After login, users are redirected back to the page they were trying to access

## Team Password

**Current Password**: `MuditaVC2026!`

Share this password with your team members. They only need to enter it once per device (cookie lasts 30 days).

## Changing the Password

To change the team password:

1. Update `APP_PASSWORD` in `.env.production.yaml`
2. Redeploy: `.\scripts\deploy-cloudbuild.ps1`

## Security Notes

- The app is publicly accessible but requires password authentication
- Password is stored as an environment variable
- Session cookies are HTTP-only and secure in production
- For enhanced security, consider implementing:
  - Individual user accounts with NextAuth.js
  - Two-factor authentication
  - OAuth with Google Workspace

## Logging Out

Users can log out by clearing their browser cookies or by implementing a logout button (API endpoint already exists at `/api/auth/logout`).

## Adding a Logout Button

To add a logout button to your app, add this to your navigation:

```tsx
<button
  onClick={async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }}
  className="text-gray-600 hover:text-gray-900"
>
  Logout
</button>
```

## Troubleshooting

**Issue**: Users see "Forbidden" error
- **Solution**: Make sure `allUsers` is in the Cloud Run IAM policy (app handles auth internally)

**Issue**: Infinite redirect loop
- **Solution**: Check that `/login` page is excluded from middleware matcher

**Issue**: Can't login
- **Solution**: Verify `APP_PASSWORD` environment variable is set correctly in production
