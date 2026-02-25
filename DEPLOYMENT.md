# Deployment Guide

## Prerequisites

1. **Google Cloud SDK** installed and configured
   ```bash
   gcloud --version
   gcloud auth login
   ```

2. **Docker** installed
   ```bash
   docker --version
   ```

3. **Environment variables** configured (see below)

## First-Time Setup

### 1. Configure Production Environment Variables

Copy the template and fill in your secrets:

```bash
cp .env.production.template .env.production
```

Edit `.env.production` and add your actual:
- HubSpot access token
- OpenAI API key
- Google service account private key (from your existing setup)
- Serper API key (if using web search)

**Important**: Never commit `.env.production` to git!

### 2. Run GCP Setup Script

This creates the Cloud Storage bucket and configures permissions:

```bash
# Make scripts executable
chmod +x scripts/*.sh

# Run setup (only needed once)
./scripts/setup-gcp.sh
```

This will:
- Enable required Google Cloud APIs
- Create the Cloud Storage bucket
- Configure IAM permissions
- Set up bucket versioning

## Deploying Training Data to Production

### Thesis-fit feedback (always safe — do this every release)

Reviewer feedback examples are safe to sync every release — they only add/update feedback files and do not affect live deal records.

```powershell
$env:GCS_BUCKET_NAME = "mudita-vc-diligence-prod"
gsutil -m cp data/thesis-fit-feedback/*.json "gs://$($env:GCS_BUCKET_NAME)/thesis-fit-feedback/"
```

### Diligence records (intentional only — read carefully before running)

**Do NOT run this as part of a routine deployment.** Production is the source of truth for diligence records. Uploading local dev records to production will create duplicate entries for any company that already has a record in production.

Only run this when you explicitly want to promote specific local records to production — for example, a net-new record created in dev that has no production equivalent.

To promote a single specific record:
```powershell
$env:GCS_BUCKET_NAME = "mudita-vc-diligence-prod"
gsutil cp data/diligence/dd_<id>.json "gs://$($env:GCS_BUCKET_NAME)/diligence/"
```

If you do need to bulk-sync, first audit for duplicates:
```powershell
# List what's already in production
gsutil ls gs://$env:GCS_BUCKET_NAME/diligence/
# Then only copy files whose IDs are NOT already present in production
```

**Note**: All copies are one-way overwrites by filename. Production-only records (records created in production that don't exist locally) are never affected by a local upload.

## Deploying to Production

### Quick Deploy

```bash
./scripts/deploy.sh
```

This single command will:
1. Build the Docker image
2. Push to Google Container Registry
3. Deploy to Cloud Run
4. Output the production URL

### Manual Deploy (Alternative)

If you prefer step-by-step:

```bash
# 1. Build
docker build -t gcr.io/natural-byway-486020-f2/vc-deal-flow:latest .

# 2. Push
docker push gcr.io/natural-byway-486020-f2/vc-deal-flow:latest

# 3. Deploy
gcloud run deploy vc-deal-flow-prod \
  --image=gcr.io/natural-byway-486020-f2/vc-deal-flow:latest \
  --region=us-central1 \
  --platform=managed \
  --memory=512Mi \
  --timeout=300s \
  --env-vars-file=.env.production
```

## Development Workflow

### Local Development

```bash
npm run dev
```

- Uses local file storage (`data/diligence/`)
- No GCS required
- Fast iteration

### Testing Before Deploy

```bash
# 1. Test build
npm run build

# 2. Test production build locally
npm start

# 3. If all looks good, deploy
./scripts/deploy.sh
```

## Access Control

### Restrict to Your Google Workspace

After first deployment, restrict access to your organization:

```bash
# Replace YOUR-DOMAIN.com with your actual domain
gcloud run services add-iam-policy-binding vc-deal-flow-prod \
  --region=us-central1 \
  --member='domain:YOUR-DOMAIN.com' \
  --role='roles/run.invoker'

# Remove public access
gcloud run services remove-iam-policy-binding vc-deal-flow-prod \
  --region=us-central1 \
  --member='allUsers' \
  --role='roles/run.invoker'
```

### Restrict to Specific Users (4-5 people)

```bash
# Add specific users
gcloud run services add-iam-policy-binding vc-deal-flow-prod \
  --region=us-central1 \
  --member='user:person1@yourdomain.com' \
  --role='roles/run.invoker'

gcloud run services add-iam-policy-binding vc-deal-flow-prod \
  --region=us-central1 \
  --member='user:person2@yourdomain.com' \
  --role='roles/run.invoker'

# Repeat for all 4-5 users
```

## Monitoring

### View Logs

```bash
# Stream logs in real-time
gcloud run services logs read vc-deal-flow-prod --region=us-central1 --follow

# View recent logs
gcloud run services logs read vc-deal-flow-prod --region=us-central1 --limit=100
```

### Cloud Console

View metrics and logs at:
https://console.cloud.google.com/run/detail/us-central1/vc-deal-flow-prod

## Rollback

### Roll back to previous version

```bash
# List revisions
gcloud run revisions list --service=vc-deal-flow-prod --region=us-central1

# Roll back to specific revision
gcloud run services update-traffic vc-deal-flow-prod \
  --region=us-central1 \
  --to-revisions=vc-deal-flow-prod-00001-abc=100
```

## Troubleshooting

### Build fails

- Check that all dependencies are in `package.json`
- Ensure `npm run build` works locally first
- Check Docker build logs

### Deployment fails

- Verify environment variables in `.env.production`
- Check that GCS bucket exists and has correct permissions
- Ensure service account has necessary IAM roles

### App not working in production

- Check Cloud Run logs: `gcloud run services logs read vc-deal-flow-prod --region=us-central1`
- Verify all environment variables are set correctly
- Test GCS bucket access from Cloud Run

### Thesis feedback not improving model outputs

- Confirm production is running with `STORAGE_BACKEND=gcs` and `GCS_BUCKET_NAME` configured.
- Verify thesis feedback files are being written under `thesis-fit-feedback/` in the bucket.
- If migrating from local/dev, import/copy historical feedback from `data/thesis-fit-feedback/` so prior reviewer feedback remains available.
- Run one thesis-first pass and verify feedback can be saved and appears in settings audit.

### Deck unreadable / OCR fallback not working

- Confirm Drive service account has permission to create/export/delete temporary Google Docs in the configured Drive.
- Check logs for `Google Drive OCR fallback failed` warnings.
- Verify unreadable documents surface UI warnings during thesis check and scoring/rescore flows.

### Data not persisting

- Verify `STORAGE_BACKEND=gcs` is set in environment
- Check GCS bucket permissions for service account
- Review Cloud Run logs for storage errors

## Cost Optimization

Your current setup should cost approximately $10-20/month:

- Cloud Run scales to 0 when not in use (no idle costs)
- Storage costs are minimal for JSON files
- Consider setting up budget alerts in GCP Console

## Security Best Practices

1. **Never commit secrets** - Keep `.env.production` in `.gitignore`
2. **Use Secret Manager** - For enhanced security, migrate to Google Secret Manager
3. **Enable audit logs** - Track who accessed what and when
4. **Regular backups** - GCS versioning is enabled, but consider periodic exports
5. **Update dependencies** - Run `npm audit` and update packages regularly

## Next Steps

After deployment:

1. Test all features in production
2. Invite your 4-5 team members
3. Set up monitoring alerts
4. Consider migrating to Firestore when you need better querying (future)
