#!/bin/bash
# One-time Google Cloud Platform setup script
# Run this once to configure GCP resources for production

set -e

echo "=== Google Cloud Platform Setup for VC Deal Flow App ==="
echo ""

# Configuration
PROJECT_ID=${GCP_PROJECT_ID:-"natural-byway-486020-f2"}
REGION=${GCP_REGION:-"us-central1"}
BUCKET_NAME="mudita-vc-diligence-prod"
SERVICE_NAME="vc-deal-flow-prod"
SERVICE_ACCOUNT_EMAIL=${GOOGLE_CLIENT_EMAIL}

echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo "Bucket Name: $BUCKET_NAME"
echo "Service Account: $SERVICE_ACCOUNT_EMAIL"
echo ""

# Set the project
echo "Setting GCP project..."
gcloud config set project $PROJECT_ID

# Enable required APIs
echo ""
echo "Enabling required Google Cloud APIs..."
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable containerregistry.googleapis.com
gcloud services enable storage.googleapis.com

# Create GCS bucket for diligence data
echo ""
echo "Creating Cloud Storage bucket: $BUCKET_NAME"
if gsutil ls -b gs://$BUCKET_NAME 2>/dev/null; then
  echo "Bucket already exists, skipping creation"
else
  gsutil mb -p $PROJECT_ID -l $REGION gs://$BUCKET_NAME
  echo "Bucket created successfully"
fi

# Enable versioning on bucket (for data protection)
echo ""
echo "Enabling versioning on bucket..."
gsutil versioning set on gs://$BUCKET_NAME

# Set bucket permissions for service account
echo ""
echo "Setting bucket IAM permissions for service account..."
gsutil iam ch serviceAccount:$SERVICE_ACCOUNT_EMAIL:roles/storage.objectAdmin gs://$BUCKET_NAME

# Grant service account access to Cloud Run
echo ""
echo "Granting Cloud Run permissions to service account..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/run.invoker" \
  --condition=None

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "Next steps:"
echo "1. Configure secrets in Google Secret Manager (recommended) or use environment variables"
echo "2. Run './scripts/deploy.sh' to deploy to production"
echo ""
