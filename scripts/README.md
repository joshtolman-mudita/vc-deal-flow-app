# Deployment Scripts

## Windows (PowerShell)

### One-Time Setup
```powershell
.\scripts\setup-gcp.ps1
```

### Deploy to Production
```powershell
.\scripts\deploy.ps1
```

## Linux/Mac (Bash)

### One-Time Setup
```bash
chmod +x scripts/*.sh
./scripts/setup-gcp.sh
```

### Deploy to Production
```bash
./scripts/deploy.sh
```

## What Each Script Does

### setup-gcp (One-Time)
- Creates Google Cloud Storage bucket
- Enables required APIs (Cloud Run, Container Registry, Storage)
- Configures IAM permissions
- Sets up bucket versioning

### deploy (Every Deployment)
- Builds Docker image
- Pushes to Container Registry
- Deploys to Cloud Run
- Outputs production URL

## Prerequisites

1. **Google Cloud SDK** installed
   - Download: https://cloud.google.com/sdk/docs/install
   - Verify: `gcloud --version`

2. **Docker** installed
   - Download: https://www.docker.com/products/docker-desktop
   - Verify: `docker --version`

3. **Authenticated** with Google Cloud
   ```powershell
   gcloud auth login
   gcloud config set project natural-byway-486020-f2
   ```

## Environment Variables

Set these before running scripts (optional - defaults provided):

```powershell
# PowerShell
$env:GCP_PROJECT_ID="natural-byway-486020-f2"
$env:GCP_REGION="us-central1"
$env:GOOGLE_CLIENT_EMAIL="diligence-app-service@natural-byway-486020-f2.iam.gserviceaccount.com"

# Bash
export GCP_PROJECT_ID="natural-byway-486020-f2"
export GCP_REGION="us-central1"
export GOOGLE_CLIENT_EMAIL="diligence-app-service@natural-byway-486020-f2.iam.gserviceaccount.com"
```

## Troubleshooting

### "gcloud: command not found"
Install Google Cloud SDK: https://cloud.google.com/sdk/docs/install

### "docker: command not found"
Install Docker: https://www.docker.com/products/docker-desktop

### ".env.production not found"
Create it from template: `cp .env.production.template .env.production`

### "Permission denied"
Linux/Mac only: `chmod +x scripts/*.sh`

### Build fails
Run locally first: `npm run build`

## Next Steps

After successful deployment:
1. Get your URL: `gcloud run services describe vc-deal-flow-prod --region=us-central1 --format='value(status.url)'`
2. Test the app
3. Restrict access (see DEPLOYMENT.md)
4. Set up monitoring alerts

## Quick Reference

```powershell
# View logs
gcloud run services logs read vc-deal-flow-prod --region=us-central1

# List revisions (for rollback)
gcloud run revisions list --service=vc-deal-flow-prod --region=us-central1

# Check service status
gcloud run services describe vc-deal-flow-prod --region=us-central1
```
