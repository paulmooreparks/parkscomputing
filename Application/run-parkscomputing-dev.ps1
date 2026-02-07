#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Launch Parks Computing site in development mode
.DESCRIPTION
    Runs the parkscomputing site locally on port 8080 using OneDrive content
#>

param(
    [switch]$Watch = $false
)

$ErrorActionPreference = 'Stop'

# Set working directory to the engine project
$projectPath = Split-Path $PSScriptRoot -Parent
$enginePath = Join-Path $projectPath "parkscomputing-engine"
Set-Location $enginePath

# Load configuration
$configFile = Join-Path $projectPath ".config" "parkscomputing-dev.json"
$config = Get-Content $configFile | ConvertFrom-Json

# Set environment variables
$env:ASPNETCORE_URLS = $config.ASPNETCORE_URLS
$env:ASPNETCORE_ENVIRONMENT = $config.ASPNETCORE_ENVIRONMENT
$env:AUTH_CONNECTION_STRING = $config.Auth.ConnectionString
$env:JWT_SECRET = $config.Jwt.Secret

# Override web root to use OneDrive content
$env:ASPNETCORE_WEBROOT = $config.WebRootPath

Write-Host "Starting Parks Computing site..." -ForegroundColor Green
Write-Host "URL: $($config.ASPNETCORE_URLS)" -ForegroundColor Cyan
Write-Host "Content: $($config.WebRootPath)" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

if ($Watch) {
    dotnet watch run --project "parkscomputing-engine.csproj"
} else {
    dotnet run --project "parkscomputing-engine.csproj"
}
