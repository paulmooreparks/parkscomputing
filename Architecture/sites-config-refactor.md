# Sites Configuration Refactor Proposal

## 1. Goals

1. Restructure `sites.json` to clearly separate production and development definitions.
2. Support two development execution modes:
   - Running from a Docker image (container-based dev).
   - Running directly from a local build (`dotnet watch` / process execution).
3. Make the active runtime mode *obvious* across tools, UI, and logs.
4. Avoid accidental content edits against production-mounted volumes.

---
## 2. Problems With Current Structure

Current layout:
```json
{
  "sqlServer": { ... },
  "shared": { ... },
  "development": { "enginePath": "...", "connectionString": "...", "devContentPath": "..." },
  "sites": { "parkscomputing": { ... }, "padmajairam": { ... } }
}
```
Issues:
- Conflates *global development helpers* with *site definitions*.
- No explicit distinction between dev-from-image vs dev-from-local-build.
- Scripts must special-case the top-level `development` section.
- Harder to extend (e.g., staging, perf, ephemeral preview environments).

---
## 3. Differentiating Runtime Modes

| Signal | Image Mode | Local Build Mode | Purpose |
|--------|------------|------------------|---------|
| Environment var | `RUNTIME_SOURCE=image` | `RUNTIME_SOURCE=local` | Single authoritative flag. |
| Port convention (optional) | Keep existing (e.g., 8080) | Offset (e.g., 8180) | Visual differentiation via URL. |
| Container name | `parkscomputing-dev` | (none) | Presence of container indicates image mode. |
| Volume mount | Read-only prod-like content | Internal project `wwwroot` | Prevent accidental prod content edits. |
| UI watermark (dev only) | Optional or suppressed | Visible badge `LOCAL BUILD` | Prevent screenshot confusion. |
| Response header | `X-Runtime-Source: image` | `X-Runtime-Source: local` | Tooling / health check clarity. |
| Startup log line | Includes `source=image` | Includes `source=local` | Log audits & grep. |

Implementation quick wins:
- Add `RUNTIME_SOURCE` into site config environment blocks.
- Small middleware or startup filter to add header + console line.
- Optional view condition to inject watermark div.

---
## 4. Structure Options

### Option 1 – Basic Split (Production vs Development)
```jsonc
{
  "sqlServer": { ... },
  "shared": { ... },
  "sites": {
    "production": {
      "parkscomputing": { ... },
      "padmajairam": { ... }
    },
    "development": {
      "parkscomputing": { /* dev variant */ },
      "padmajairam": { /* dev variant */ }
    }
  }
}
```
Pros: Simple.  Cons: Doesn't distinguish dev image vs local build.

### Option 2 – Dev Split Into `image` and `local` (Recommended)
```jsonc
{
  "sqlServer": { ... },
  "shared": { ... },
  "sites": {
    "production": { ... },
    "development": {
      "image": {
        "parkscomputing": { ... },
        "padmajairam": { ... }
      },
      "local": {
        "parkscomputing": { ... },
        "padmajairam": { ... }
      }
    }
  }
}
```
Pros: Explicit selection, no custom merge logic. Scales to more dev modes.  Cons: Some duplication.

### Option 3 – Inheritance / Overrides
```jsonc
{
  "sqlServer": { ... },
  "shared": { ... },
  "sites": {
    "production": { ... },
    "development": {
      "$inherits": "production",
      "overrides": {
        "parkscomputing": { "contentPath": "...local...", "environment": { "ASPNETCORE_ENVIRONMENT": "Development", "RUNTIME_SOURCE": "image" } }
      }
    }
  }
}
```
Pros: DRY.  Cons: Requires implementing merge logic; less transparent.

---
## 5. Field-Level Differences for Development

| Field | Production | Dev Image | Dev Local |
|-------|------------|-----------|----------|
| `containerName` | Present | Present (maybe suffix `-img`) | Omit / null |
| `imageName` | Present | Present | Omit (not needed) |
| `enginePath` | (n/a) | (optional) | Required (from old top-level) |
| `contentPath` | OneDrive prod content | Same or alternate read-only mirror | Project `...engine\\wwwroot` |
| `environment.ASPNETCORE_ENVIRONMENT` | `Production` | `Development` | `Development` |
| `environment.RUNTIME_SOURCE` | (omit) | `image` | `local` |
| `environment.AUTH_CONNECTION_STRING` | host.docker.internal | host.docker.internal | localhost (non-container) |
| `volumes` | read-only mount | same or relaxed | none (or dev-specific bind) |
| `devPort` | Provided | Could reuse or differentiate | Could use offset (optional) |

---
## 6. Suggested Dev `run-dev.ps1` Enhancements

Add params:
```powershell
param(
  [Parameter(Mandatory)][string]$Site,
  [ValidateSet('image','local')][string]$Mode = 'local'
)
```
Resolution logic:
```powershell
$config = Get-Content $configPath | ConvertFrom-Json
$siteConfig = $config.sites.development.$Mode.$Site
if (-not $siteConfig) { throw "Site '$Site' mode '$Mode' not found." }
```
Behavior branches:
- `image`: build (if missing) + run container with env vars & volumes.
- `local`: set env vars (`ASPNETCORE_ENVIRONMENT`, `RUNTIME_SOURCE`, connection string, content path export) then run `dotnet watch` using `enginePath`.

Optional: auto-select `Mode` based on presence of `--image` flag.

---
## 7. Application Runtime Hooks

1. Response header middleware:
   - Adds `X-Runtime-Source` from env.
2. Console banner on startup:
   - `Console.WriteLine($"[RuntimeMode] source={runtimeSource} env={env} contentRoot={contentRoot}");`
3. Razor watermark (dev only):
```cshtml
@if (Environment.GetEnvironmentVariable("RUNTIME_SOURCE") == "local") {
  <div style="position:fixed;top:0;left:0;z-index:9999;background:#c00;color:#fff;font:11px monospace;padding:2px 6px;opacity:.85;pointer-events:none;">LOCAL BUILD</div>
}
```
4. Add build info service (later): embed commit SHA into `AssemblyInformationalVersion`.

---
## 8. Recommendation

Adopt **Option 2** now:
- Fast to implement.
- Explicit, no merge code.
- Clean extension path (add `development.testdata` later, etc.).

---
## 9. Migration Plan

1. Create new `sites.production` by moving existing entries.
2. Create `sites.development.image` by cloning production entries and adjusting environment & runtime flags.
3. Create `sites.development.local` by cloning development.image then removing container- and image-specific fields, adding `enginePath` + local `contentPath` + local connection string.
4. Remove obsolete top-level `development` node.
5. Update `run-dev.ps1` to use new path.
6. (Optional) Add middleware/watermark.
7. Test matrix:
   - Local: `run-dev.ps1 -Site parkscomputing -Mode local`
   - Image: `run-dev.ps1 -Site parkscomputing -Mode image`

---
## 10. Decision Checklist (Fill Before Applying)

- [ ] Confirm Option (expected: 2)
- [ ] Decide on port offset for local mode (Yes/No; value: ____)
- [ ] Decide container name suffix for image mode (e.g., `-img` or keep same)
- [ ] Enable watermark? (Yes/No)
- [ ] Add response header? (Yes/No)
- [ ] Add startup console banner? (Yes/No)

---
## 11. Sample Option 2 Snippet (Abbreviated)

```jsonc
{
  "sqlServer": { "containerName": "sqlserver-local", "port": 1433, "password": "<from .env>" },
  "shared": { "jwtSecret": "<from .env>" },
  "sites": {
    "production": {
      "parkscomputing": { "containerName": "parkscomputing-dev", "imageName": "parkscomputing-local:dev", "port": 80, "devPort": 8080, "healthUrl": "http://localhost", "database": "ParksComputingAuth", "contentPath": "C:\\Users\\paul\\OneDrive\\Documents\\parkscomputing.com\\wwwroot", "environment": { "ASPNETCORE_ENVIRONMENT": "Production", "AUTH_CONNECTION_STRING": "Server=host.docker.internal,1433;Database=ParksComputingAuth;User Id=sa;Password=<from .env>;TrustServerCertificate=true;Encrypt=false;", "JWT_SECRET": "<from .env>" }, "volumes": [ "C:\\Users\\paul\\OneDrive\\Documents\\parkscomputing.com\\wwwroot:/app/wwwroot:ro" ] },
      "padmajairam": { "containerName": "padmajairam-dev", "imageName": "padmajairam-local:dev", "port": 8081, "devPort": 8082, "healthUrl": "http://localhost:8081", "database": "PadmaJairamSite", "contentPath": "C:\\Users\\paul\\OneDrive\\Documents\\padmajairam.com\\wwwroot", "environment": { "ASPNETCORE_ENVIRONMENT": "Production", "AUTH_CONNECTION_STRING": "Server=host.docker.internal,1433;Database=PadmaJairamSite;User Id=sa;Password=<from .env>;TrustServerCertificate=true;Encrypt=false;", "JWT_SECRET": "<from .env>" }, "volumes": [ "C:\\Users\\paul\\OneDrive\\Documents\\padmajairam.com\\wwwroot:/app/wwwroot:ro" ] }
    },
    "development": {
      "image": {
        "parkscomputing": { "containerName": "parkscomputing-dev-img", "imageName": "parkscomputing-local:dev", "port": 80, "devPort": 8080, "healthUrl": "http://localhost", "database": "ParksComputingAuth", "contentPath": "C:\\Users\\paul\\OneDrive\\Documents\\parkscomputing.com\\wwwroot", "environment": { "ASPNETCORE_ENVIRONMENT": "Development", "RUNTIME_SOURCE": "image", "AUTH_CONNECTION_STRING": "Server=host.docker.internal,1433;Database=ParksComputingAuth;User Id=sa;Password=<from .env>;TrustServerCertificate=true;Encrypt=false;", "JWT_SECRET": "<from .env>" }, "volumes": [ "C:\\Users\\paul\\OneDrive\\Documents\\parkscomputing.com\\wwwroot:/app/wwwroot:ro" ] },
        "padmajairam": { "containerName": "padmajairam-dev-img", "imageName": "padmajairam-local:dev", "port": 8081, "devPort": 8082, "healthUrl": "http://localhost:8081", "database": "PadmaJairamSite", "contentPath": "C:\\Users\\paul\\OneDrive\\Documents\\padmajairam.com\\wwwroot", "environment": { "ASPNETCORE_ENVIRONMENT": "Development", "RUNTIME_SOURCE": "image", "AUTH_CONNECTION_STRING": "Server=host.docker.internal,1433;Database=PadmaJairamSite;User Id=sa;Password=<from .env>;TrustServerCertificate=true;Encrypt=false;", "JWT_SECRET": "<from .env>" }, "volumes": [ "C:\\Users\\paul\\OneDrive\\Documents\\padmajairam.com\\wwwroot:/app/wwwroot:ro" ] }
      },
      "local": {
        "parkscomputing": { "enginePath": "C:\\Users\\paul\\source\\repos\\paulmooreparks\\parkscomputing\\Application\\parkscomputing-engine", "database": "ParksComputingAuth", "contentPath": "C:\\Users\\paul\\source\\repos\\paulmooreparks\\parkscomputing\\Application\\parkscomputing-engine\\wwwroot", "environment": { "ASPNETCORE_ENVIRONMENT": "Development", "RUNTIME_SOURCE": "local", "AUTH_CONNECTION_STRING": "Server=localhost,1433;Database=ParksComputingAuth;User Id=sa;Password=<from .env>;TrustServerCertificate=true;Encrypt=false;", "JWT_SECRET": "<from .env>" } },
        "padmajairam": { "enginePath": "C:\\Users\\paul\\source\\repos\\paulmooreparks\\parkscomputing\\Application\\parkscomputing-engine", "database": "PadmaJairamSite", "contentPath": "C:\\Users\\paul\\source\\repos\\paulmooreparks\\parkscomputing\\Application\\parkscomputing-engine\\wwwroot", "environment": { "ASPNETCORE_ENVIRONMENT": "Development", "RUNTIME_SOURCE": "local", "AUTH_CONNECTION_STRING": "Server=localhost,1433;Database=PadmaJairamSite;User Id=sa;Password=<from .env>;TrustServerCertificate=true;Encrypt=false;", "JWT_SECRET": "<from .env>" } }
      }
    }
  }
}
```

---
## 12. Next Step

Confirm decisions in the checklist; then we will:
1. Apply JSON update.
2. Adjust `run-dev.ps1`.
3. (Optionally) Add runtime banner & header injection.

---
*End of document.*

---
## 13. Implemented Refactor & Migration Notes (Applied State)

This section documents the actual changes performed versus the proposal above.

Every secret value shown in this document has been replaced with the placeholder `<from .env>`. The real SA password and the real JWT signing secrets live in the gitignored `.env` file beside `docker-compose.yml` on the host, and in `~/.config/docker-sites/sites.json`, which is also outside this repository. Local development reads its own distinct values from .NET user secrets. Do not paste a live value back into this file.

### Final Adopted Structure
We implemented Option 2 with slight key naming refinements:

```
sites.
  <site>.production
  <site>.development.image
  <site>.development.local
```

Differences from illustrative proposal:
- Production branch keeps `port` (not `devPort`).
- Development branches use `devPort` where differentiated; some reuse same port intentionally for simplicity.
- `RUNTIME_SOURCE` is present in all development branches and implicitly `image` for production where image-based runtime is assumed.
- `enginePath` only exists under `.development.local`.
- Environment objects include: `ASPNETCORE_ENVIRONMENT`, `AUTH_CONNECTION_STRING`, `JWT_SECRET`, `RUNTIME_SOURCE` (development only), future-ready for additional keys.

### Key Migration Steps Executed
1. Moved legacy top-level `development` values into new `development.local` branch per site.
2. Created `development.image` by cloning production site definition and altering `ASPNETCORE_ENVIRONMENT` + adding `RUNTIME_SOURCE=image`.
3. Added `RUNTIME_SOURCE=local` to `.development.local` environment blocks.
4. Updated `run-parkscomputing-dev.ps1` to accept a `Mode` parameter (`local|image|production`) and resolve the correct branch dynamically.
5. Updated Docker management script to reference `production` only (no accidental dev branch use).
6. Validated runtime start in both local and image modes: environment banner shows correct source, container runs with mounted content when image mode is used.

### Validation Outcomes
| Scenario | Result | Notes |
|----------|--------|-------|
| Local dev run | PASS | `dotnet watch` picks up `RUNTIME_SOURCE=local` |
| Image dev run | PASS | Container env shows `RUNTIME_SOURCE=image` |
| Production reference | PASS | Scripts isolate production branch |
| Accidental legacy key access | PASS | Removed obsolete top-level `development` node |

### Benefits Realized
- Clear separation of responsibilities (source vs image execution).
- Simpler future addition of `staging` branch using same pattern.
- Reduced conditional scripting complexity.
- Safer content editing (no production path collision in local mode).

### Follow-Up Recommendations
1. Add lightweight schema validation script (PowerShell or C#) to assert required keys exist per branch.
2. Introduce optional `staging` branch to exercise scalability of pattern.
3. Externalizing secrets (`JWT_SECRET`, connection strings) is done, under card pc-4, rather than pending. Container secrets come from a gitignored `.env` beside `docker-compose.yml`, and local development secrets come from .NET user secrets. No vault was adopted; the `VaultUri` entry that survives in `launchSettings.json` is vestigial and nothing reads it.
4. Add middleware to emit `X-Runtime-Source` header (if not already present) and a small health endpoint returning runtime metadata.
5. Unit test: parse `sites.json` and assert structural integrity (fail-fast on missing keys).

### Quick Reference Access Helpers (PowerShell)
```pwsh
$config = Get-Content $configPath | ConvertFrom-Json
$site = 'parkscomputing'
$prod = $config.sites.$site.production
$devLocal = $config.sites.$site.development.local
$devImage = $config.sites.$site.development.image
```

### Edge Cases Considered
- Missing requested mode: script throws explicit error rather than falling back silently.
- Future additional branch: naming convention keeps depth consistent; tooling can enumerate children of `.development`.
- Duplicate ports: intentional allowance; caller can override or extend with port checks.

### Completion Marker
Refactor is considered COMPLETE. Remaining enhancements tracked under follow-up recommendations.

