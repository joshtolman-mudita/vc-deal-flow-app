# Deploy VC Deal Flow App to Google Cloud Run using Cloud Build
# This script builds the Docker image in the cloud (no local Docker required)
# Usage: .\scripts\deploy-cloudbuild.ps1

$ErrorActionPreference = "Stop"

# Add gcloud to PATH if not already available
$gcloudPath = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin"
if (-not ($env:Path -like "*$gcloudPath*")) {
    $env:Path += ";$gcloudPath"
    Write-Host "Added gcloud to PATH for this session" -ForegroundColor Gray
}

# Read version from package.json
$packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
$VERSION = $packageJson.version

Write-Host "=== Deploying VC Deal Flow App to Google Cloud Run (Cloud Build) ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Version: $VERSION" -ForegroundColor Magenta
Write-Host ""

# Configuration
$PROJECT_ID = if ($env:GCP_PROJECT_ID) { $env:GCP_PROJECT_ID } else { "natural-byway-486020-f2" }
$REGION = if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }
$SERVICE_NAME = "vc-deal-flow-prod"
$TIMESTAMP = Get-Date -Format "yyyyMMdd-HHmmss"
$IMAGE_TAG = "gcr.io/$PROJECT_ID/vc-deal-flow:$TIMESTAMP"

Write-Host "Project: $PROJECT_ID"
Write-Host "Region: $REGION"
Write-Host "Service: $SERVICE_NAME"
Write-Host "Image: $IMAGE_TAG"
Write-Host ""

# Set project
gcloud config set project $PROJECT_ID

# Check if .env.production.yaml exists
if (-Not (Test-Path ".env.production.yaml")) {
    Write-Host "ERROR: .env.production.yaml not found!" -ForegroundColor Red
    Write-Host "Please create .env.production.yaml with your production environment variables"
    Write-Host "See DEPLOYMENT.md for format"
    exit 1
}

# Build the Docker image using Cloud Build (no local Docker needed!)
Write-Host "Building Docker image in the cloud..." -ForegroundColor Yellow
Write-Host "This will take 5-10 minutes for the first build..." -ForegroundColor Gray
Write-Host ""

gcloud builds submit --tag $IMAGE_TAG .

# Tag as latest
Write-Host ""
Write-Host "Tagging as latest..." -ForegroundColor Yellow
gcloud container images add-tag $IMAGE_TAG gcr.io/$PROJECT_ID/vc-deal-flow:latest --quiet

# Deploy to Cloud Run using env-vars-file
Write-Host ""
Write-Host "Deploying to Cloud Run..." -ForegroundColor Yellow

gcloud run deploy $SERVICE_NAME `
  --image=$IMAGE_TAG `
  --region=$REGION `
  --platform=managed `
  --memory=512Mi `
  --cpu=1 `
  --timeout=300s `
  --min-instances=0 `
  --max-instances=3 `
  --env-vars-file=.env.production.yaml `
  --allow-unauthenticated

# Get the service URL
$SERVICE_URL = gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)'

Write-Host ""
Write-Host "=== Deployment Complete! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Version: v$VERSION" -ForegroundColor Magenta
Write-Host "Service URL: $SERVICE_URL" -ForegroundColor Cyan
Write-Host ""
Write-Host "Authentication: Password-protected (APP_PASSWORD)" -ForegroundColor Green
Write-Host "All users must enter the team password to access the app" -ForegroundColor Green
Write-Host ""
Write-Host "To view logs:"
Write-Host "  gcloud run services logs read $SERVICE_NAME --region=$REGION"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Test the deployment at the URL above"
Write-Host "  2. If this is a release, create a git tag: git tag -a v$VERSION -m 'Release v$VERSION'"
Write-Host "  3. Push the tag: git push --tags"
Write-Host ""
