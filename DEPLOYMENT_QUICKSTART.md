# Quick Start: Deploy to Production

## TL;DR - Deploy in 3 Steps

### 1. One-Time Setup (5 minutes)

```powershell
# Run the GCP setup script
.\scripts\setup-gcp.ps1
```

This creates the Cloud Storage bucket and configures permissions.

### 2. Deploy to Production (10 minutes)

```powershell
# Deploy the app
.\scripts\deploy.ps1
```

This builds, pushes, and deploys your app to Google Cloud Run.

### 3. Restrict Access (2 minutes)

After deployment, restrict to your team:

```powershell
# Get your service URL first
$SERVICE_URL = gcloud run services describe vc-deal-flow-prod --region=us-central1 --format='value(status.url)'
Write-Host "Your app is at: $SERVICE_URL"

# Restrict to your Google Workspace domain
gcloud run services add-iam-policy-binding vc-deal-flow-prod `
  --region=us-central1 `
  --member='domain:yourdomain.com' `
  --role='roles/run.invoker'

# Remove public access
gcloud run services remove-iam-policy-binding vc-deal-flow-prod `
  --region=us-central1 `
  --member='allUsers' `
  --role='roles/run.invoker'
```

## That's It!

Your app is now live and accessible only to your team at the Cloud Run URL.

## Daily Workflow

### Making Changes

1. **Develop locally**: `npm run dev` (uses local storage)
2. **Test changes**: Verify everything works on localhost:3000
3. **Deploy**: `.\scripts\deploy.ps1` (pushes to production)

### Monitoring

```powershell
# View recent logs
gcloud run services logs read vc-deal-flow-prod --region=us-central1 --limit=50

# Stream logs in real-time
gcloud run services logs read vc-deal-flow-prod --region=us-central1 --follow
```

### Rollback (if needed)

```powershell
# List recent versions
gcloud run revisions list --service=vc-deal-flow-prod --region=us-central1

# Rollback to previous version
gcloud run services update-traffic vc-deal-flow-prod `
  --region=us-central1 `
  --to-revisions=PREVIOUS_REVISION_NAME=100
```

## Cost

Expected: **$10-20/month** for 4-5 users

- Scales to zero when not in use
- Pay only for actual usage
- Storage costs are minimal

## Support

- Full documentation: See [DEPLOYMENT.md](DEPLOYMENT.md)
- Architecture diagrams: See deployment plan
- Troubleshooting: Check Cloud Run logs

## What Was Changed

### Storage System
- **Development**: Uses local files in `data/diligence/`
- **Production**: Uses Google Cloud Storage bucket `mudita-vc-diligence-prod`
- Automatically switches based on `STORAGE_BACKEND` environment variable

### All Features Work
- HubSpot integration ✓
- OpenAI scoring ✓
- Google Drive uploads ✓
- Google Sheets criteria ✓
- Web search ✓
- Email generation ✓
- All UI features ✓

No feature changes needed - everything works as-is!
