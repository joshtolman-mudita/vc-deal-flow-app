# ⚠️ Google Cloud Setup Required

You're seeing this error because the **Diligence Module requires Google Cloud credentials** to function.

## The Error You're Seeing

```
error:1E08010C:DECODER routines::unsupported
```

This OpenSSL error occurs because the Google Cloud service account credentials in your `.env.local` file are still **placeholder values**.

---

## Quick Fix (5 minutes)

### Option 1: Complete Google Cloud Setup

Follow the detailed guide: **[DILIGENCE_SETUP_GUIDE.md](./DILIGENCE_SETUP_GUIDE.md)**

**Quick steps:**
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a service account
3. Download the JSON key file
4. Copy `client_email` and `private_key` to `.env.local`
5. Create a Google Drive folder and share it with the service account
6. Create a Google Sheet with your criteria and share it
7. Restart your dev server

### Option 2: Use Without Google Drive (Temporary)

If you want to test the module without Google Drive:

1. **Comment out Google Drive calls** in `app/api/diligence/upload/route.ts`
2. **Skip document storage** (files won't be saved to Drive)
3. **Use local storage only** for metadata

**Note:** This is NOT recommended for production use.

---

## Why Google Cloud?

The Diligence Module uses:
- **Google Drive (Shared Drive)**: Store uploaded documents (pitch decks, financials)
- **Google Sheets**: Load your investment criteria dynamically
- **Service Account**: Secure, server-side authentication

**⚠️ Important**: Service accounts require a **Shared Drive** (Google Workspace) or using the service account's own Drive space. Regular folders won't work!

---

## Current Configuration Status

Check your `.env.local` file:

```bash
# ❌ These are PLACEHOLDER values (won't work):
GOOGLE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----"

# ✅ Real values look like this:
GOOGLE_CLIENT_EMAIL=diligence-app@my-project-123456.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----"
```

---

## Need Help?

1. **Setup Guide**: [DILIGENCE_SETUP_GUIDE.md](./DILIGENCE_SETUP_GUIDE.md) - Complete walkthrough
2. **Quick Start**: [DILIGENCE_QUICK_START.md](./DILIGENCE_QUICK_START.md) - 5-minute version
3. **Testing Guide**: [DILIGENCE_TESTING_GUIDE.md](./DILIGENCE_TESTING_GUIDE.md) - After setup

---

**Status**: ⏳ Waiting for Google Cloud credentials  
**Next Step**: Follow [DILIGENCE_SETUP_GUIDE.md](./DILIGENCE_SETUP_GUIDE.md)
