#!/bin/bash
# Deploy VC Deal Flow App to Google Cloud Run
# Usage: ./scripts/deploy.sh

set -e

echo "=== Deploying VC Deal Flow App to Google Cloud Run ==="
echo ""

# Configuration
PROJECT_ID=${GCP_PROJECT_ID:-"natural-byway-486020-f2"}
REGION=${GCP_REGION:-"us-central1"}
SERVICE_NAME="vc-deal-flow-prod"
IMAGE_TAG="gcr.io/$PROJECT_ID/vc-deal-flow:$(date +%Y%m%d-%H%M%S)"

echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"
echo "Image: $IMAGE_TAG"
echo ""

# Set project
gcloud config set project $PROJECT_ID

# Build the Docker image
echo "Building Docker image..."
docker build -t $IMAGE_TAG .

# Tag as latest
docker tag $IMAGE_TAG gcr.io/$PROJECT_ID/vc-deal-flow:latest

# Push to Google Container Registry
echo ""
echo "Pushing image to Container Registry..."
docker push $IMAGE_TAG
docker push gcr.io/$PROJECT_ID/vc-deal-flow:latest

# Deploy to Cloud Run
echo ""
echo "Deploying to Cloud Run..."

# Check if .env.production exists
if [ ! -f ".env.production" ]; then
  echo "WARNING: .env.production not found. Creating template..."
  echo "Please fill in your secrets before deploying!"
  exit 1
fi

# Read environment variables from .env.production
ENV_VARS=$(cat .env.production | grep -v '^#' | grep -v '^$' | tr '\n' ',' | sed 's/,$//')

gcloud run deploy $SERVICE_NAME \
  --image=$IMAGE_TAG \
  --region=$REGION \
  --platform=managed \
  --memory=512Mi \
  --cpu=1 \
  --timeout=300s \
  --min-instances=0 \
  --max-instances=3 \
  --set-env-vars="$ENV_VARS" \
  --allow-unauthenticated

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)')

echo ""
echo "=== Deployment Complete! ==="
echo ""
echo "Service URL: $SERVICE_URL"
echo ""
echo "To restrict access to your Google Workspace:"
echo "  gcloud run services add-iam-policy-binding $SERVICE_NAME \\"
echo "    --region=$REGION \\"
echo "    --member='domain:YOUR-DOMAIN.com' \\"
echo "    --role='roles/run.invoker'"
echo ""
echo "To view logs:"
echo "  gcloud run services logs read $SERVICE_NAME --region=$REGION"
echo ""
