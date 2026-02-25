# ✅ Google Cloud Platform Setup Complete!

## What Was Configured

1. **Google Cloud Storage Bucket**: `mudita-vc-diligence-prod`
   - Location: `us-central1`
   - Versioning: Enabled
   - Service Account Access: Configured

2. **APIs Enabled**:
   - Cloud Run API
   - Cloud Build API
   - Container Registry API
   - Cloud Storage API

3. **Service Account Permissions**:
   - `diligence-app-service@natural-byway-486020-f2.iam.gserviceaccount.com`
   - Has `storage.objectAdmin` role on the bucket

## Next Steps

### 1. Fix PATH Issue (One-Time)

To make `gcloud` available in all PowerShell sessions, run this **once**:

```powershell
.\scripts\add-gcloud-to-path.ps1
```

Then follow the instructions to add it permanently.

### 2. Deploy to Production

Now you're ready to deploy! Run:

```powershell
.\scripts\deploy.ps1
```

This will:
- Build your Docker image
- Push to Google Container Registry
- Deploy to Cloud Run
- Output your production URL

### 3. Test Locally First (Recommended)

Before deploying, test the production build locally:

```powershell
npm run build
```

If the build succeeds, you're ready to deploy!

## Troubleshooting

### "gcloud: command not found"

Run this in your PowerShell session:

```powershell
.\scripts\add-gcloud-to-path.ps1
```

### Check Bucket Status

```powershell
gsutil ls -L gs://mudita-vc-diligence-prod
```

### View Service Account Permissions

```powershell
gsutil iam get gs://mudita-vc-diligence-prod
```

## What Happens in Production

- **Storage**: Diligence records will be stored in Google Cloud Storage instead of local files
- **Scaling**: Cloud Run will automatically scale from 0 to 3 instances based on traffic
- **Cost**: Approximately $10-20/month for 4-5 users
- **Access**: You can restrict to your Google Workspace domain after deployment

## Ready to Deploy?

See [DEPLOYMENT_QUICKSTART.md](DEPLOYMENT_QUICKSTART.md) for deployment instructions!
