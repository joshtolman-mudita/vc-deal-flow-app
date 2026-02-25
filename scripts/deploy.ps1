# Deploy VC Deal Flow App to Google Cloud Run (Windows PowerShell)
# Usage: .\scripts\deploy.ps1

$ErrorActionPreference = "Stop"

# Add gcloud to PATH if not already available
$gcloudPath = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin"
if (-not ($env:Path -like "*$gcloudPath*")) {
    $env:Path += ";$gcloudPath"
    Write-Host "Added gcloud to PATH for this session" -ForegroundColor Gray
}

Write-Host "=== Deploying VC Deal Flow App to Google Cloud Run ===" -ForegroundColor Cyan
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

# Check if .env.production exists
if (-Not (Test-Path ".env.production")) {
    Write-Host "ERROR: .env.production not found!" -ForegroundColor Red
    Write-Host "Please copy .env.production.template to .env.production and fill in your secrets"
    exit 1
}

# Build the Docker image
Write-Host "Building Docker image..." -ForegroundColor Yellow
docker build -t $IMAGE_TAG .

# Tag as latest
docker tag $IMAGE_TAG gcr.io/$PROJECT_ID/vc-deal-flow:latest

# Push to Google Container Registry
Write-Host ""
Write-Host "Pushing image to Container Registry..." -ForegroundColor Yellow
docker push $IMAGE_TAG
docker push gcr.io/$PROJECT_ID/vc-deal-flow:latest

# Read environment variables from .env.production
Write-Host ""
Write-Host "Reading environment variables from .env.production..." -ForegroundColor Yellow
$envVars = Get-Content .env.production | Where-Object { $_ -notmatch '^#' -and $_ -match '\S' } | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Join-String -Separator ','

# Deploy to Cloud Run
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
  --set-env-vars=$envVars `
  --allow-unauthenticated

# Get the service URL
$SERVICE_URL = gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)'

Write-Host ""
Write-Host "=== Deployment Complete! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Service URL: $SERVICE_URL" -ForegroundColor Cyan
Write-Host ""
Write-Host "To restrict access to your Google Workspace:"
Write-Host "  gcloud run services add-iam-policy-binding $SERVICE_NAME \"
Write-Host "    --region=$REGION \"
Write-Host "    --member='domain:YOUR-DOMAIN.com' \"
Write-Host "    --role='roles/run.invoker'"
Write-Host ""
Write-Host "To view logs:"
Write-Host "  gcloud run services logs read $SERVICE_NAME --region=$REGION"
Write-Host ""
