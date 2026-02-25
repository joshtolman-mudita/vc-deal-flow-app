# One-time Google Cloud Platform setup script for Windows
# Run this once to configure GCP resources for production

$ErrorActionPreference = "Stop"

Write-Host "=== Google Cloud Platform Setup for VC Deal Flow App ===" -ForegroundColor Cyan
Write-Host ""

# Configuration
$PROJECT_ID = if ($env:GCP_PROJECT_ID) { $env:GCP_PROJECT_ID } else { "natural-byway-486020-f2" }
$REGION = if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }
$BUCKET_NAME = "mudita-vc-diligence-prod"
$SERVICE_NAME = "vc-deal-flow-prod"
$SERVICE_ACCOUNT_EMAIL = $env:GOOGLE_CLIENT_EMAIL

Write-Host "Project ID: $PROJECT_ID"
Write-Host "Region: $REGION"
Write-Host "Bucket Name: $BUCKET_NAME"
Write-Host "Service Account: $SERVICE_ACCOUNT_EMAIL"
Write-Host ""

# Set the project
Write-Host "Setting GCP project..." -ForegroundColor Yellow
gcloud config set project $PROJECT_ID

# Enable required APIs
Write-Host ""
Write-Host "Enabling required Google Cloud APIs..." -ForegroundColor Yellow
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable containerregistry.googleapis.com
gcloud services enable storage.googleapis.com

# Create GCS bucket for diligence data
Write-Host ""
Write-Host "Creating Cloud Storage bucket: $BUCKET_NAME" -ForegroundColor Yellow

$bucketExists = gsutil ls -b gs://$BUCKET_NAME 2>$null
if ($bucketExists) {
    Write-Host "Bucket already exists, skipping creation" -ForegroundColor Green
} else {
    gsutil mb -p $PROJECT_ID -l $REGION gs://$BUCKET_NAME
    Write-Host "Bucket created successfully" -ForegroundColor Green
}

# Enable versioning on bucket (for data protection)
Write-Host ""
Write-Host "Enabling versioning on bucket..." -ForegroundColor Yellow
gsutil versioning set on gs://$BUCKET_NAME

# Set bucket permissions for service account
Write-Host ""
Write-Host "Setting bucket IAM permissions for service account..." -ForegroundColor Yellow
gsutil iam ch serviceAccount:${SERVICE_ACCOUNT_EMAIL}:roles/storage.objectAdmin gs://$BUCKET_NAME

# Grant service account access to Cloud Run
Write-Host ""
Write-Host "Granting Cloud Run permissions to service account..." -ForegroundColor Yellow
gcloud projects add-iam-policy-binding $PROJECT_ID `
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" `
  --role="roles/run.invoker"

Write-Host ""
Write-Host "=== Setup Complete! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Run '.\scripts\deploy.ps1' to deploy to production"
Write-Host ""
