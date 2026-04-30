#!/bin/bash

# Deployment script for taskboard
# This script is executed remotely via SSH from GitHub Actions
# It must be idempotent and include healthcheck

set -e  # Exit on any error

echo "Starting deployment..."

# Registry and image info (passed as env vars or hardcoded)
REGISTRY="ghcr.io"
REPO="${GITHUB_REPOSITORY:-acarol/taskboard}"  # Replace with actual repo
TAG="${TAG:-main}"  # Tag from GitHub Actions

IMAGE="${REGISTRY}/${REPO}:${TAG}"

echo "Pulling image: $IMAGE"
docker pull "$IMAGE"

echo "Stopping existing containers..."
docker stop taskboard-app taskboard-db 2>/dev/null || true
docker rm taskboard-app taskboard-db 2>/dev/null || true

echo "Starting database..."
docker run -d \
  --name taskboard-db \
  -e POSTGRES_USER=taskboard \
  -e POSTGRES_PASSWORD=taskboard123 \
  -e POSTGRES_DB=taskboard \
  -v postgres_data:/var/lib/postgresql/data \
  -p 5432:5432 \
  postgres:16-alpine

# Wait for DB to be ready
echo "Waiting for database to be healthy..."
for i in {1..30}; do
  if docker exec taskboard-db pg_isready -U taskboard >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! docker exec taskboard-db pg_isready -U taskboard >/dev/null 2>&1; then
  echo "Database failed to start"
  exit 1
fi

echo "Starting application..."
docker run -d \
  --name taskboard-app \
  --link taskboard-db:db \
  -e DATABASE_URL=postgresql://taskboard:taskboard123@db:5432/taskboard \
  -e JWT_SECRET=secret-key-for-development-only \
  -e PORT=3000 \
  -p 3000:3000 \
  "$IMAGE"

echo "Waiting for application to be healthy..."
for i in {1..30}; do
  if curl -f http://localhost:3000/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl -f http://localhost:3000/health >/dev/null 2>&1; then
  echo "Application healthcheck failed"
  exit 1
fi

echo "Deployment successful!"