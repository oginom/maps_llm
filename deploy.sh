#!/bin/bash
set -eu

# Configuration
PROJECT_ID=$PROJECT_ID
REGION="asia-northeast1"
SERVICE_NAME="mapsllm"
REPOSITORY_NAME="docker"

# Load environment variables from .env file
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "Error: .env file not found"
    exit 1
fi

# Build the container with platform specification
docker build --platform linux/amd64 -t $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY_NAME/$SERVICE_NAME .

# Push to Artifact Registry
docker push $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY_NAME/$SERVICE_NAME

# Deploy to Cloud Run
gcloud run deploy $SERVICE_NAME \
  --image $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY_NAME/$SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --project $PROJECT_ID \
  --port 3000 \
  --allow-unauthenticated \
  --set-env-vars "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}" \
  --set-env-vars "NEXT_PUBLIC_GOOGLE_MAPS_ID=${NEXT_PUBLIC_GOOGLE_MAPS_ID}" \
  --set-env-vars "OPENAI_API_KEY=${OPENAI_API_KEY}"
