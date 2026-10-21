# Migrating the engine to XferLang 1.0

This brief is for the agent that works on this repository. It covers moving the engine from the legacy XferLang 0.x library, `ParksComputing.Xfer.Lang` 0.15.25-prerelease, to the XferLang 1.0 library, `ParksComputing.XferLang`. The site's two XferLang documents move from the 0.x syntax to 1.0 at the same time. It was written on 2026-10-21 by the session that built the 1.0 library. Everything it states was checked against the code and the live files on that date.

Paul's requirement is that the change is tested on beta.parkscomputing.com before production, and that production changes only when he says so.

## What changes

The legacy library and the 1.0 library are different packages with different namespaces, and the two syntaxes are not compatible: the 1.0 parser refuses a 0.x document, and the 0.x parser refuses a 1.0 one. So the code change and the conversion of the documents have to land together, on beta and later on production.

The places that change are these.

| Where | What it does with XferLang |
|---|---|
| `Application/parkscomputing-engine/parkscomputing-engine.csproj`, line 40 | References `ParksComputing.Xfer.Lang` 0.15.25-prerelease. Line 55 has an older reference commented out. |
| `Pages/Services/NavNode.cs` | The type both documents are read into. Its members carry the legacy `[XferProperty("...")]` attribute. |
| `Pages/Services/NavService.cs`, line 207 | Reads `wwwroot/sitenav.xfer` with `XferConvert.Deserialize<NavNode>`. |
| `Identity/AdminMenu.cs`, lines 109 and 127 | Reads the admin menu, and the built-in default menu, the same way. A menu that does not parse is logged and skipped in favour of the next one (line 112), so a 0.x menu read by the new engine does not crash anything; it silently falls back to the default. |
| `Identity/ServerFiles.cs`, line 40 | `DefaultAdminMenu`, the built-in admin menu as a 0.x string constant. Line 114 writes it to `etc/admin-menu.xfer` when that file does not exist. |
| `Xfer/XferService.cs` | The wrapper behind the `application/xfer` media type: `Serialize`, `SerializeAsync` and `Deserialize`, generic and by `Type`, with a `compact` option. |
| `Xfer/XferInputFormatter.cs`, `Xfer/XferOutputFormatter.cs` | Read and write API bodies as `application/xfer` through `IXferService`. The output formatter accepts any type (`CanWriteType` returns true). |
| `Xfer/XferSwaggerFilters.cs` | Writes Swagger examples with `XferConvert.Serialize`. |
| `Startup.cs`, lines 57 to 65 and 189 to 194 | Registers the service, the formatters and the Swagger filters. Nothing here names the library, so it should not need to change. |
| `parkscomputing-engine.UnitTests/SiteMenuTests.cs`, lines 52 and 121 | Tests that deserialize a 0.x string, `Nav`, through `XferConvert`. The string needs converting to 1.0. |

No JavaScript on the site parses XferLang; `js/site.js`, `js/files.js`, `js/sitefs.js`, `js/terminal.js` and `js/commands.js` only treat `.xfer` as a text file type. The static-file mapping of `.xfer` to `text/plain` in `Startup.cs` stays as it is.

The two documents on the server are the only XferLang files there (a search of the whole OneDrive tree found no others, including under `home`):

- `C:\Users\paul\OneDrive\Documents\parkscomputing.com\wwwroot\sitenav.xfer`, mounted in production as `/app/wwwroot/sitenav.xfer`;
- `C:\Users\paul\OneDrive\Documents\parkscomputing.com\etc\admin-menu.xfer`, mounted in production as `/app/etc/admin-menu.xfer`.

No admin has a personal menu yet (`AdminMenu.cs` line 74 would read `~/.config/admin-menu.xfer`).

## The new library

`ParksComputing.XferLang` 0.1.0-next.0 is on nuget.org, published 2026-10-21. It targets .NET 10 and has no dependencies. Its source, design record and tests are at https://github.com/paulmooreparks/xfer-dotnet, checked out locally at `C:\Users\paul\source\repos\xfer-dotnet`; its README shows the API, and `DESIGN.md` section 10 specifies the object mapper. The specification is https://github.com/paulmooreparks/xferlang (`spec/xferlang.md`), checked out at `C:\Users\paul\source\repos\xferlang`.

The command line tool is `ParksComputing.XferLang.Tool` 0.1.0-next.0: `dotnet tool install --global ParksComputing.XferLang.Tool --prerelease`, then `xfer validate FILE`, `xfer fmt --write FILE` and `xfer to-json FILE`. In the first minutes after a release nuget.org may not resolve `--prerelease` yet; `--version 0.1.0-next.0` works then. The repository's `nuget.config` maps every package to nuget.org, which is where this package is, so the reference needs no source change.

### From the legacy API to the new one

| Legacy (`ParksComputing.Xfer.Lang`) | 1.0 (`ParksComputing.XferLang`, `ParksComputing.XferLang.Serialization`) |
|---|---|
| `XferConvert.Deserialize<T>(text)` | `XferSerializer.Deserialize<T>(text)` |
| `XferConvert.Deserialize(text, type)` | `XferSerializer.Deserialize(text, type)` |
| `XferConvert.Serialize(value, Formatting.Pretty)` | `XferSerializer.Serialize(value)` |
| `XferConvert.Serialize(value, Formatting.None)` | No equivalent. 1.0 has one output form, the canonical form, so `compact` in `XferService` has nothing to select and should be dropped or ignored. |
| `XferConvert.SerializeAsync(value, writer, formatting, ct)` | No `TextWriter` overload. `XferSerializer.SerializeAsync(stream, value, options, ct)` writes UTF-8 to a `Stream`, or serialize to a string and write that. |
| `[XferProperty("slug")]` | `[XferPropertyName("slug")]` |
| A second property that shadows another to accept an older key (`Link` for `Url`, `Links` for `Nav`) | `[XferPropertyName("url", Aliases = ["link"])]` on the real member, and `[XferIgnore]` on the shadow. An alias is read and never written. |

Behaviour to know about:

- **Errors.** A document that does not parse, or a value that does not fit its target, throws `XferException`, whose `Diagnostics` hold the code, position and message (`XFER0801` wrong kind, `XFER0802` unknown key under `Disallow`, `XFER0803` missing required member, `XFER0804` two keys for one member, `XFER0303` out of range). A type the mapper cannot build is an `InvalidOperationException`. Unknown keys are skipped by default, as before.
- **Output ends with a line feed,** and `Serialize(null)` gives `null` and a line feed. `XferService` returns an empty string for null today; keep that guard if callers rely on it.
- **Member order on writing** is by `[XferPropertyOrder]` and then by key, ordinally, never by declaration order (reflection does not promise one). This changes the order of members in `application/xfer` API responses, not in JSON ones.
- **Types the mapper refuses on writing:** a dictionary whose keys are not strings and a multidimensional array are `InvalidOperationException`; a reference cycle is `XFER0602`. Since the output formatter offers `application/xfer` for every response type, check the API endpoints with `Accept: application/xfer` after the change, especially anything returning a dictionary or a framework type.
- **Dates.** A date such as `2025-08-01` reads into `DateTime` as midnight with `DateTimeKind.Unspecified`, which is what the legacy library produced for these documents.

### NavNode in 1.0

`C:\Users\paul\source\repos\xfer-dotnet\test\ParksComputing.XferLang.Tests\Engine\NavNodes.cs` holds two copies of this repository's `NavNode`: `LegacyNavNode` with the legacy attributes, and `NavNode` with the 1.0 ones, `Url` and `Nav` using aliases and `Link`, `Links` and `DerivedUrl` marked `[XferIgnore]`. The 1.0 copy is the target for `Pages/Services/NavNode.cs`. Copy its attributes, not its whole file, so that anything this repository's `NavNode` has gained since stays.

A test in that repository, `MapperTests.TheConvertedSiteDocumentsReadAsTheLegacyLibraryReadsTheOriginals`, reads the converted `sitenav.xfer` and `admin-menu.xfer` with the 1.0 library and the 0.x originals with the legacy one, and requires the two object graphs to serialize to the same `System.Text.Json` text. It passes. So for these two documents the new library and the new `NavNode` produce exactly what the engine gets today.

## Converting the documents

The 0.x constructs these documents use are few: the head `<! document { xferlang "0.15" } !>`, which becomes `<! xfer 1 !>`; `~true` and `~false`, which become `true` and `false`; and the wrappers `<"...">` and `<'...'>`, which become 1.0 strings with the delimiter the canonical writer would choose.

`C:\Users\paul\source\repos\xfer-dotnet\tools\fixtures\convert-legacy.mjs` does exactly this and refuses anything else it finds that looks like 0.x, so nothing is passed through unconverted:

```sh
node C:/Users/paul/source/repos/xfer-dotnet/tools/fixtures/convert-legacy.mjs <0.x file> <1.0 file>
xfer validate <1.0 file>
```

Converted copies already exist in `C:\Users\paul\source\repos\xfer-dotnet\test\ParksComputing.XferLang.Tests\fixtures\` as `sitenav.xfer` and `admin-menu.xfer`, beside the 0.x originals they came from (`sitenav.legacy.xfer`, `admin-menu.legacy.xfer`). On 2026-10-21 both originals were byte for byte the live files. Before using a converted copy, check that the live file still matches its original (`cmp`); if either has changed, convert the live file again instead.

`DefaultAdminMenu` in `ServerFiles.cs` and the `Nav` string in `SiteMenuTests.cs` are 0.x text inside C# and need the same conversion. Converting them through the script (write the text to a file, convert, paste back) is the safe way, and `xfer validate` should pass on the result.

## Testing on beta first

beta.parkscomputing.com is run by `Tools/beta-run.sh`, which builds `parkscomputing-local:beta` from a checkout and runs it as the container `parkscomputing-identity-test` on 127.0.0.1:8100, where cloudflared routes beta. `Tools/beta-webroot.sh` stages its web root, and `CARRYOVER.md` section "Deployed beta" describes the rest. On 2026-10-21 that container had been stopped for 12 days, so beta answered 502; its database container, `parkscomputing-identity-test-sql`, was running.

**Beta as it stands is not safe for this test.** By design it mounts production's own folders, writable: the live web root at `/app/site`, and production's `home`, `etc` and `history` folders. Its staging script also copies `sitenav.xfer` from the live tree, so beta would get the 0.x file. A 1.0 engine on beta would therefore read production's 0.x admin menu and fall back to the default, and anything on beta that wrote `etc/admin-menu.xfer` in 1.0 would break production's admin menu while production still runs the 0.x engine.

For this test, run beta against copies:

1. Make a copy of `C:\Users\paul\OneDrive\Documents\parkscomputing.com\home`, `etc` and `history`, and of `wwwroot` for the `/app/site` mount, outside OneDrive (under the ignored `.local/beta/` for example, which `beta-run.sh` already uses).
2. In the copies, replace `etc/admin-menu.xfer` and `wwwroot/sitenav.xfer` with the converted 1.0 files.
3. Stage beta's web root as usual, then put the 1.0 `sitenav.xfer` into `.local/beta/wwwroot/` (the staging script copies the live 0.x one).
4. Run the container as `beta-run.sh` does, but with its `/app/site`, `/app/home`, `/app/etc` and `/app/history` mounts pointed at the copies. The read-only `content`, `images` and `audio` mounts from the live tree can stay as they are. A variant of `beta-run.sh` for this, rather than an edit to it, keeps the normal beta unchanged.
5. Check on beta: the navigation and menus render as on production; the admin menu shows production's entries, not the built-in default (the logs would say "does not parse; using the next one" if it fell back); the site editor opens `sitenav.xfer`; and the API answers with `Accept: application/xfer`, including the Swagger examples. Then let Paul test.

Production keeps running the 0.x engine with the 0.x files throughout, untouched.

## What the migration found

The code change is on the branch `xferlang-1.0` and stays there until the production cutover. These points came up while doing it, on 2026-10-21, and add to or correct what is above.

- `AdminMenuTests.cs` and `AppletCatalogTests.cs` also contain 0.x text (`~true`), which the table above missed. Both are converted, as are two comments that quoted `frame ~true`.
- `compact` is gone from `IXferService`. Nothing called it with `true`, and 1.0 has one written form.
- With accounts on, which is how production runs, `/admin` answers 404 and nothing reads `etc/admin-menu.xfer`. The admin menu matters only where accounts are off: the local edit origin, and the test instance. It is converted all the same so the files and the engine never disagree.
- padmajairam.com runs its own container from its own image, and its `sitenav.xfer` is 0.x. It keeps working until its image is rebuilt from this code, and that rebuild must convert its `sitenav.xfer` in the same step, as production's.
- Swagger answered 500 before the migration, on production too, because two controllers each have a nested type called `Body` and Swashbuckle gave both the same schema id. `Startup.cs` now uses the full type name as the schema id. The XferLang examples had also always read as the name of a type (`Microsoft.OpenApi.Any.OpenApiString`) and lost their quotes; they now show the 1.0 text.
- `application/xfer` responses now list members in key order and write `[ ]`, `null` and `false` where 0.x wrote `( )`, `?` and `~false`. No script on the site asks for `application/xfer`, so only an outside client would notice. Several endpoints (`/api/content`, the chat, poker and editor APIs) answer JSON whatever the request asks for; they did the same on production before the change.

Testing so far, on the local test instance with the converted files: the unit tests pass (130, 6 skipped); seventeen pages, signed out and signed in, are identical before and after; the RSS feed and sitemap are built in full from the 1.0 `sitenav.xfer`; and Swagger answers 200 with every XferLang example present.

`Tools/beta-run-copies.sh` runs beta on copies as described under "Testing on beta first". It makes the copies under `.local/beta/copies` once and converts the two documents in them, and later runs keep the copies.

## Production, when Paul says so

Production is the `parkscomputing` service in `docker-compose.yml`, container `parkscomputing-dev`, image `parkscomputing-local:dev`, built and started by `deploy-simple.ps1`. It mounts the OneDrive tree directly (`wwwroot`, `home`, `etc`, `history`, and `config` read-only), so the two files are converted in place, in the same minute as the new image starts.

1. Tag the running image for rollback, as was done on 2026-10-05 (`parkscomputing-local:prev-<stamp>`), and keep copies of the two 0.x files.
2. Build the new image.
3. Write the converted `sitenav.xfer` and `admin-menu.xfer` into the OneDrive tree and start the new container (`deploy-simple.ps1`).
4. Check the same things as on beta, on parkscomputing.com.

To roll back, put the 0.x files back and start the previous image. The two syntaxes cannot coexist, so the files and the image always move together.

parkscomputing.com moved to XferLang 1.0 on 2026-10-21, after Paul tried the change on beta. The previous image is `parkscomputing-local:prev-20261021-155922`, and the 0.x files are in the ignored `.local/xfer-0x-backup-20261021-155922`. Both live files matched the tested fixtures' originals, and their conversions matched the fixtures byte for byte. padmajairam.com was left on 0.x, since it has its own image and beta and 1.0 has not been tried there.
