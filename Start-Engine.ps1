<#!
.SYNOPSIS
  Sets required environment variables and runs the ParksComputing engine in Release mode from source.

.DESCRIPTION
  Convenience script for local development when using Azure SQL / Entra ID passwordless auth and JWT auth.
  You can pass parameters or rely on existing environment variables. If a JWT secret is not provided
  and none is set, a secure random one is generated for the process lifetime.

.PARAMETER ConnectionString
  Full ADO.NET connection string for SQL Server (Azure SQL). If omitted the existing AUTH_CONNECTION_STRING
  environment variable is used. Required if no existing variable.

.PARAMETER JwtSecret
  32+ character secret for HMAC signing of JWTs. If omitted and not already set, a random 48 byte base64 value is generated.

.PARAMETER SeedUser
  Optional initial admin username to seed if the Users table is empty.

.PARAMETER SeedPassword
  Plain text password for the seed user. Mutually exclusive with SeedPasswordHash. A bcrypt hash is generated.

.PARAMETER SeedPasswordHash
  Pre-computed bcrypt hash for the seed user password. Takes precedence over SeedPassword if both supplied.

.PARAMETER Project
  Relative path to the engine csproj. Default: Application/parkscomputing-engine/parkscomputing-engine.csproj

.PARAMETER NoRun
  If specified, sets environment variables and builds Release but does not run.

.EXAMPLE
  ./Start-Engine.ps1 -ConnectionString "Server=tcp:...;Authentication=Active Directory Default;..." -SeedUser admin -SeedPassword "P@ssw0rd!"

.EXAMPLE
  $env:AUTH_CONNECTION_STRING="Server=tcp:..."; ./Start-Engine.ps1
#>
param(
  [string]$ConnectionString,
  [string]$JwtSecret,
  [string]$SeedUser,
  # Using SecureString to avoid plain text in process memory longer than needed; converted immediately for hashing.
  [System.Security.SecureString]$SeedPassword,
  # Change type to SecureString for security.
  [System.Security.SecureString]$SeedPasswordHash,
  [string]$Project = 'Application/parkscomputing-engine/parkscomputing-engine.csproj',
  [switch]$NoRun
)

$ErrorActionPreference = 'Stop'

function Write-Info([string]$msg){ Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Warn([string]$msg){ Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err([string]$msg){ Write-Host "[ERR ] $msg" -ForegroundColor Red }

# Resolve repo root (script location)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Connection string resolution
if (-not $ConnectionString) { $ConnectionString = $env:AUTH_CONNECTION_STRING }
if (-not $ConnectionString) {
  Write-Err 'Connection string not provided. Use -ConnectionString or set AUTH_CONNECTION_STRING.'
  exit 1
}
$env:AUTH_CONNECTION_STRING = $ConnectionString
Write-Info 'AUTH_CONNECTION_STRING set for this session.'

# JWT secret handling
if (-not $JwtSecret) { $JwtSecret = $env:JWT_SECRET }
if (-not $JwtSecret) {
  # Generate 48 random bytes -> base64 (will be > 32 chars)
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $JwtSecret = [Convert]::ToBase64String($bytes)
  Write-Info 'Generated random JWT secret (process scope).'
}
if ($JwtSecret.Length -lt 32) {
  Write-Err 'JWT secret must be at least 32 characters.'
  exit 1
}
$env:JWT_SECRET = $JwtSecret

# Seeding (optional)
if ($SeedUser) { $env:SEED_ADMIN_USERNAME = $SeedUser }
if ($SeedPasswordHash) {
  # Convert SecureString to plain text transiently for env var assignment.
  $ptrHash = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SeedPasswordHash)
  try {
    $plainHash = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptrHash)
    $env:SEED_ADMIN_PASSWORD_HASH = $plainHash
  }
  finally {
    if ($ptrHash -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptrHash) }
  }
}
elseif ($SeedPassword) {
  # Convert SecureString to plain text transiently for hashing.
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SeedPassword)
  try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  }
  finally {
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  }
  try {
    $hash = [BCrypt.Net.BCrypt]::HashPassword($plain)
    $env:SEED_ADMIN_PASSWORD_HASH = $hash
  }
  catch {
    Write-Warn 'Failed to generate bcrypt hash (BCrypt.Net not loaded yet). Building project then retrying hash.'
    dotnet build $Project -c Release | Out-Null
    try {
      $hash = [BCrypt.Net.BCrypt]::HashPassword($plain)
      $env:SEED_ADMIN_PASSWORD_HASH = $hash
    }
    catch {
      Write-Err 'Still failed to hash seed password.'
      exit 1
    }
  }
  # Clear transient plain variable
  if ($plain) { [System.Array]::Clear($plain.ToCharArray(),0,$plain.Length) | Out-Null }
}

if ($SeedUser -and -not $env:SEED_ADMIN_PASSWORD_HASH) {
  Write-Warn 'Seed user provided but no password/password hash specified; user will not be created.'
}

# Build
Write-Info 'Building (Release)...'
dotnet build $Project -c Release
if ($LASTEXITCODE -ne 0) { Write-Err 'Build failed.'; exit $LASTEXITCODE }

if ($NoRun) {
  Write-Info 'Skipping run (NoRun specified).'
  exit 0
}

Write-Info 'Starting engine (Release)...'
# Use --no-build since we just built
$runCmd = "dotnet run --no-build --configuration Release --project `"$Project`""
Write-Host "Command: $runCmd" -ForegroundColor DarkGray
& dotnet run --no-build --configuration Release --project $Project
