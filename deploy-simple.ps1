#!/usr/bin/env pwsh

# Simple deployment script for ParksComputing
# Builds new image and updates the running container

Write-Host "🏗️  Building new image..." -ForegroundColor Cyan
docker build -t parkscomputing-local:dev -f Application/parkscomputing-engine/Dockerfile Application

if ($LASTEXITCODE -eq 0) {
    Write-Host "🚀 Deploying updated container..." -ForegroundColor Green
    docker-compose up -d parkscomputing
    Write-Host "✅ Deployment complete! Check http://localhost" -ForegroundColor Green
}
else {
    Write-Host "❌ Build failed - deployment cancelled" -ForegroundColor Red
}
