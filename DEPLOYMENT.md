# ParksComputing Local Deployment

This directory contains scripts and configurations for managing your local ParksComputing deployment.

## Quick Start

### Deployment
```powershell
# Build and deploy updated container
.\deploy-simple.ps1

# Or use Docker Compose directly
docker-compose up -d parkscomputing
```

### Daily Operations
```powershell
# View logs
docker-compose logs -f parkscomputing

# Restart container
docker-compose restart parkscomputing

# Stop/start all services
docker-compose stop
docker-compose start

# Check status
docker-compose ps
```

## Files Overview

- **`deploy-simple.ps1`** - Simple deployment script (build image + restart container)
- **`docker-compose.yml`** - Docker Compose configuration for all services

## Deployment Process

### Standard Deployment (`.\deploy-simple.ps1`)
1. 🏗️ **Build** - Creates Docker image `parkscomputing-local:dev`
2. 🚀 **Deploy** - Restarts container with new image via docker-compose

The script automatically:
- Builds the .NET application
- Creates a new Docker image
- Restarts the container with the updated image
- Mounts production content from OneDrive

## Container Configuration

### Application Container
- **Name**: `parkscomputing-dev`
- **Port**: 80 (host) → 8080 (container)
- **Image**: `parkscomputing-local:dev`
- **Production Content**: Mounted from `C:\Users\paul\OneDrive\Documents\parkscomputing.com\wwwroot` (read-only)
- **URL**: http://localhost

### SQL Server Container
- **Name**: `sqlserver-local`
- **Port**: 1433
- **Image**: `mcr.microsoft.com/mssql/server:2022-latest`
- **Edition**: Developer (free, full-featured)
- **Data**: Persistent Docker volume `sqlserver-data`

## Environment Variables

Content editing is done directly in the OneDrive folder, which is mounted as a read-only volume in the container.

| Variable | Value |
|----------|-------|
| `AUTH_CONNECTION_STRING` | `Server=sqlserver,1433;Database=ParksComputingAuth;User Id=sa;Password=ParksComputing123!;TrustServerCertificate=true;Encrypt=false;` |
| `JWT_SECRET` | `DVL5rfK4o4g1KYai7OHjJlG4RbaP3f2kPQ/GAt4CASU=` |
| `ASPNETCORE_ENVIRONMENT` | `Production` |

## Troubleshooting

### Container Won't Start
```powershell
# Check logs
docker logs parkscomputing-dev -f

# Check if SQL Server is running
docker ps --filter "name=sqlserver-local"

# Restart SQL Server if needed
docker restart sqlserver-local

# Check all services
docker-compose ps
```

### Database Connection Issues
```powershell
# Connect to SQL Server
docker exec -it sqlserver-local /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "ParksComputing123!" -C

# Check database exists
docker exec -it sqlserver-local /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "ParksComputing123!" -Q "SELECT name FROM sys.databases" -C
```

### Port Conflicts
If port 80 is in use:
```powershell
# Find what's using port 80
netstat -ano | findstr :80

# Stop IIS if running
Stop-Service W3SVC -Force
```

### Content Not Updating
Content is mounted from OneDrive at:
```
C:\Users\paul\OneDrive\Documents\parkscomputing.com\wwwroot
```
Edit files directly in this folder - changes appear immediately (read-only mount).

## Docker Compose Commands

```powershell
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# View logs for specific service
docker-compose logs -f parkscomputing

# Stop all services
docker-compose down

# Rebuild and restart application
docker-compose up -d --build parkscomputing

# Restart a service
docker-compose restart parkscomputing

# Check status
docker-compose ps
```

## Migration from Azure

Successfully migrated:
- ✅ Database: Azure SQL → Local SQL Server 2022
- ✅ Hosting: Azure App Service → Local Docker
- ✅ Content: Azure Storage → OneDrive (local filesystem)
- ✅ DNS: Azure DNS → Cloudflare Tunnel
