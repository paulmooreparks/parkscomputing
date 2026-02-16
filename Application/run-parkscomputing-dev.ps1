#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Launch Parks Computing site in development mode
.DESCRIPTION
    Runs the parkscomputing site locally on port 8080 using OneDrive content
.PARAMETER Watch
    Use dotnet watch for hot reload during development
.EXAMPLE
    .\run-parkscomputing-dev.ps1
    .\run-parkscomputing-dev.ps1 -Watch
#>

param(
    [switch]$Watch = $false
)

$ErrorActionPreference = 'Stop'

try {
    # Set working directory to the engine project (with directory stack)
    $scriptDir = $PSScriptRoot
    $enginePath = Join-Path $scriptDir "parkscomputing-engine"

    if (-not (Test-Path $enginePath)) {
        throw "Engine project not found at: $enginePath"
    }

    Push-Location $enginePath

    # Load configuration
    $configFile = Join-Path $scriptDir ".config" "parkscomputing-dev.json"

    if (-not (Test-Path $configFile)) {
        throw "Configuration file not found at: $configFile"
    }

    $config = Get-Content $configFile | ConvertFrom-Json

    # Verify content path exists
    if (-not (Test-Path $config.WebRootPath)) {
        Write-Warning "Content path does not exist: $($config.WebRootPath)"
        Write-Warning "Please ensure your parkscomputing.com content is available at this location."
    }

    # Set environment variables
    $env:ASPNETCORE_URLS = $config.ASPNETCORE_URLS
    $env:ASPNETCORE_ENVIRONMENT = $config.ASPNETCORE_ENVIRONMENT
    $env:ASPNETCORE_WEBROOT = $config.WebRootPath
    $env:AUTH_CONNECTION_STRING = $config.Auth.ConnectionString
    $env:JWT_SECRET = $config.Jwt.Secret

    Write-Host "🚀 Starting Parks Computing site..." -ForegroundColor Green
    Write-Host "   URL: $($config.ASPNETCORE_URLS)" -ForegroundColor Cyan
    Write-Host "   Content: $($config.WebRootPath)" -ForegroundColor Cyan
    Write-Host "   Environment: $($config.ASPNETCORE_ENVIRONMENT)" -ForegroundColor Cyan
    if ($Watch) {
        Write-Host "   Mode: Watch (Hot Reload)" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "💡 Press Ctrl+C to stop" -ForegroundColor Yellow
    Write-Host ""

    if ($Watch) {
        dotnet watch run --project "parkscomputing-engine.csproj"
    }
    else {
        dotnet run --project "parkscomputing-engine.csproj"
    }
}
catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    # Restore original directory if we changed it
    Pop-Location -ErrorAction SilentlyContinue
}
