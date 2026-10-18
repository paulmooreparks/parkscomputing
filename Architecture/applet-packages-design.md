# Applet packages: applets that any PUDL host can install

Status: proposed, 2026-10-18. This takes over P5 of `applet-platform-design.md`, which sketched a `pudl-applets` repo and a host interface, and makes it concrete. The occasion is PUDLSplash, a collection of classic games that must play on parkscomputing.com at once and install on PUDL Desktop, which is a Go service, without either host knowing anything about the games.

## What the problem is

Today an applet is five things scattered across this repo: a `define()` call in `js/applets.js`, a script and stylesheet under `wwwroot`, a hand-written page body in `content/<slug>.html`, an entry in `sitenav.xfer` with the window's size, and sometimes an action manifest under `js/actions/`. A few applets also reach for globals the site provides (`pcAppletIdentity`, `pcSnapshot`, `pcSiteFs`), and `continuity.js` names the applets it saves state for. None of that moves with a script when it is copied somewhere else, which is why PUDL Desktop's proposal says not to copy scripts into a new catalog.

A package has to carry everything the applet needs the host to know, and the host has to provide what the applet needs from it through one documented object rather than through whatever globals happen to exist.

## The package

A package is a folder, one per applet, that a host copies into its web root. Its contents:

```
sudoku/
  applet.json        what the applet is and what it needs
  sudoku.js          calls pudlApplets.register('sudoku', …)
  sudoku.css
  page.html          the page body: the mount and any copy around it
  actions.json       the published actions (optional)
  actions.js         the actions' module (optional)
  help.md            Help menu copy and the catalogue description (optional)
  icon.svg           (optional)
  vendor/            third-party libraries the applet loads (optional)
```

`applet.json` is the manifest, and it is the only file a host reads:

```json
{
  "name": "sudoku",
  "title": "Sudoku",
  "version": "1.4.0",
  "description": "Nine-by-nine puzzles with hints and a timer.",
  "license": "Apache-2.0",
  "src": "sudoku.js",
  "css": "sudoku.css",
  "page": { "body": "page.html", "fit": "fill" },
  "window": { "size": [720, 820], "min": [360, 480] },
  "handles": {},
  "actions": "actions.json",
  "continuity": true,
  "needs": [],
  "wants": ["snapshot"],
  "tags": ["game", "puzzle"]
}
```

`src`, `css`, `handles` and `page.fit` are PUDL's own `define()` fields, relative to the folder. `version` becomes the `?v=` stamp, so a host stops hand-bumping `ver`. `window` moves the sizes out of `sitenav.xfer`. `continuity: true` tells the host to keep the applet's state across pages the way `continuity.js` does for three named applets today. `needs` lists host services the applet cannot run without, and `wants` lists ones it uses when present; a host that lacks a `needs` entry does not offer the applet.

A collection is a repo holding several package folders that share code, with the shared code in a sibling folder each package names in a `shared` list (`"shared": ["../barcode-engine"]`), copied beside the packages. The barcode tool, scanner and flash cards share the engine and become the collection `pudl-barcodes`. Sudoku and Conway's Game of Life share nothing and become single-applet repos. PUDLSplash is a collection because its games will share an input layer and a score board. A host never sees the difference, since what it installs is always package folders.

Releases are git tags and npm packages, the way PUDL ships `dist/`. A site takes a release by copying its `dist/` into `wwwroot/applets/`, which on parkscomputing.com is the live content volume, so installing an applet is a copy and a restart, as installing PUDL is. The published scope is Paul's to choose; `@pudl/splash`, `@pudl/sudoku` and so on if the scope is free.

## The host interface

An applet may use PUDL's runtime (`pudlApplets`, `pudlWindows`, `pudlMenubar`, the theme events) and the browser. Everything else it needs from the site arrives on one object, `window.pudlHost`, which a host builds before `pudl-applets.js` runs. Its members, each optional unless an applet's `needs` says otherwise:

| Member | What it is | On parkscomputing.com today |
|---|---|---|
| `identity(root, entries)` | the applet's first menu title, built from the host's window commands | `pcAppletIdentity` |
| `action(root, selector, label)` | a menu item that presses a button inside the applet | `pcAppletAction` |
| `snapshot` | `join(root, fn)` and `leave(root)`, state kept across a reload | `pcSnapshot` |
| `fs` | the file service: read, write, make a folder and hear of changes, with the host's Open and Save as dialogs | `pcSiteFs` and `pcFileBrowser` |
| `service(name)` | the address of a named service on the host's server, or null | the controllers under `/api/` |
| `config` | the host's settings store | `pcConfig` |
| `notify(text, kind)` | a status line or toast | the site's `say` patterns |
| `pages` | where applet pages live, for links the applet writes | `pcWorkspacePages` |

The two menu helpers are small and host-neutral, so the right home for them is PUDL itself; `pudl-proposal-applet-actions.md` already asks PUDL to take the `actions` key. Until PUDL has them, each host ships the same `pudl-host-kit.js` from the packages repo, so the helpers are written once.

An applet checks for what it wants and degrades without it: Sudoku without `snapshot` simply starts fresh on reload. Nothing in a package may reference a `pc*` global or a fixed `/api/…` address. That rule is what makes a package portable, and it is enforced by a check in the packages repo that greps each applet's script for `window.pc` and `/api/`.

## What a host does with a package

A host that is a server, such as this engine or PUDL Desktop, scans `wwwroot/applets/*/applet.json` at startup and generates what the site writes by hand today:

1. the `define()` calls, served as part of `applets.js` or as a `/applets/registry.js` the layout loads;
2. a page for each applet at the host's applet address (`/page/<name>` here), whose body is `page.html` wrapped in the host's applet page frame, with `<meta name="applet-page">` and the window sizes from the manifest;
3. the applet's entry in the launch menu and the Applets catalogue, from `title`, `description` and `tags`;
4. the list of action manifests the broker and `/mcp` read;
5. the continuity list, from the packages that say `continuity: true`.

A site may still write its own page for an applet, as the 2015 article embeds Conway's Game of Life with a mount and preset links; the generated page is the default, not the only way. The engine's scanner is a small service, `AppletCatalog`, with `SiteOptions` saying which installed applets a site offers (P6 of the platform design).

A static site with no server gets the same thing in the browser: the kit's `pudlHost.install('/applets/sudoku/applet.json')` fetches the manifest, calls `define()`, and the page author writes the mount. This belongs in PUDL eventually as `pudlApplets.install(url)`, and it is proposed as such, but the kit does it first so nothing waits on a PUDL release.

## PUDLSplash

PUDLSplash is a public repo, Apache-2.0 to match PUDL Desktop, holding a collection of classic games as packages. The first two are `invaders` (Space Invaders) and `asteroids`. Each is a canvas game that:

- draws in PUDL's theme tokens and redraws on `pudl:theme-change`, so it looks at home in light and dark;
- takes the keyboard, and on a touch screen draws its own controls;
- pauses when its window loses focus or the page is hidden, and has Game and Help menus through `identity` and `menus()`;
- keeps its high scores as a file in the reader's home directory, `~/.splash/scores.json`, through the host's `fs` service, so on parkscomputing.com they live wherever `~/` lives: this browser's storage for a guest, and the account once accounts have a home (see below); a host with no `fs` keeps them in `localStorage` under the applet's name;
- publishes a few actions (`start`, `pause`, `scores`) so the Terminal and `/mcp` can reach it, which also makes the games the first packages to prove actions travel with an applet.

The collection shares `splash-input.js` (keys and touch) and `splash-scores.js`, which reads and writes the scores file and is the only place the games touch storage.

**A home directory for accounts.** Paul's rule (2026-10-18): `~/` is this browser's storage for a guest and the account's own storage once the reader has one, and what a guest kept moves into the account when it is created. Today only the super-user has a server-backed home, through the admin mount; a signed-in member still has `/home/guest` in `localStorage`. The account half would be engine work of its own: a member's `/home/<name>` on the server, a copy of the guest home into it at sign-up or first sign-in, and the file service choosing the server home for a signed-in member. Paul chose to leave `~/` as it is for now (2026-10-18), so it is not scheduled. The games need nothing from it beyond `~/`, which is why they write there from the start. Both games open on parkscomputing.com at `/page/invaders` and `/page/asteroids`, in windows sized by their manifests, as soon as the engine's catalogue scanner lands and the packages are copied in.

## Order of work

1. **The kit and the manifest.** A `pudl-applet-packages` repo holds the manifest format, `pudl-host-kit.js`, the portability check and the packaging script that builds `dist/` from package folders. Conway's Game of Life is packaged first, since it touches no site service, and it proves the shape.
2. **The engine's catalogue.** `AppletCatalog` scans the folder and generates the registry, pages, menu entries, action list and continuity list. Conway is served from its package, its hand-written page and `define()` removed, and `compare-article-render.js` shows the article that embeds it unchanged.
3. **PUDLSplash.** The repo, the shared input and scores modules, Space Invaders, then Asteroids, each installed on parkscomputing.com as it is finished.
4. **PUDL Desktop installs a package.** The Go service gets the same scanner and a `pudlHost` with `identity`, `action` and `snapshot`, and installs PUDLSplash. Two hosts in two languages running one package is the proof the design asks for.
5. **The rest move out.** Sudoku, then the barcode collection (which needs `fs`), then Dice, Sight Reader, Theme Studio and Diff. The Terminal, Files and the Editor stay with the engine until the host interface has grown the services they need; they are the engine's own tools rather than applets a site installs.

## As built

**Step 1, the kit and the engine's catalogue (2026-10-18).** The repo `pudl-applet-packages` (local at `C:\Users\paul\source\repos\pudl-applet-packages`, Apache-2.0) holds the manifest's schema, `kit/pudl-host-kit.js`, `tools/pack.js` and the example package `examples/hello`. The kit gives `identity`, `action`, `host(services)` and `install(url)`; the engine takes a copy at `wwwroot/js/pudl-host-kit.js`, as it takes PUDL's dist. The packing tool checks a collection's manifests against the schema's rules in plain code, refuses a script that reaches `window.pc…` or a fixed `/api/` address, and copies the packages and their shared folders to `dist/`.

Two things changed from the design above as written. The window's sizes in the manifest are `window.shape` (fractions of the desktop, as the site's `win`) and `window.min` and `window.max` in pixels, not a pixel `size`, so a package says the same thing a nav entry does. An action module calls `pudlActions.provide`, a host-neutral name the broker and the server's runner both answer to, since `pcActions` was a site global.

In the engine, `Pages/Services/AppletCatalog.cs` scans `wwwroot/applets/*/applet.json`, applies the manifest's rules, logs and leaves out a package that breaks them, and watches the folder as `NavService` watches `sitenav.xfer`. From it: `/applets/registry.js` (`Controllers/AppletRegistryController.cs`, loaded by both layouts after `js/applets.js` and kept by ETag) writes each package's `define()` with its files at `/applets/<name>/…`, its page at `/page/<name>` and its version as the stamp, and asks `continuity.js` to keep the applet's state where the manifest says so; `/page/<name>` and a window on the desktop take the page the catalogue writes from `page.html`, or a bare mount, when no content file has the name (`page.cshtml.cs`, `ArticleContentService`); the packages join the Applets section of the navigation after the file's entries, with title, description, tags and window shape, and a site with no such section gets one; and the MCP runner reads the packages' action manifests beside the site's, running a package's module from its own folder (`Mcp/AppletRunner.cs`). `js/applets.js` builds `window.pudlHost` from the kit with the site's snapshot, its file service as `readText`, `writeText` and `mkdir` under `~`, and its settings files, each loading when first asked.

Checks: six unit tests over a temporary web root (`AppletCatalogTests`), and `Tools/test-applet-packages.js` (18, on the test instance with the Hello package installed): the registry and its ETag, the page and its applet, `pudlHost`, a file kept under `~`, continuity, the Applets menu, a window with the manifest's shape and least size and the applet's menu, and the package's action through the broker. `test-mcp.js` gained two checks, the package's actions discovered and one run on the server. Live on parkscomputing.com with no package installed, so the registry is empty and every page renders as before (102 articles compared).

**Step 2, PUDLSplash and Space Invaders (2026-10-18).** The repo `PUDLSplash` (local at `C:\Users\paul\source\repos\PUDLSplash`, Apache-2.0) holds `packages/invaders` and `packages/shared`, with `tools/pack.js` copied from the kit. The shared folder sits inside `packages/` beside the games, not beside the repo's root, because the packing tool reads a collection as one folder; the manifest's `shared: ["../shared"]` points there. `splash-input.js` reads keys on the applet's own root, so a game in one window never takes keys from another, draws a touch pad when the pointer is a finger, and reports when the keyboard leaves; `splash-scores.js` keeps the ten best of each game in `~/.splash/scores.json` through `pudlHost.fs`, or in this browser's storage on a host without one.

Space Invaders draws the 1978 game on a canvas of 224 by 256 in PUDL's theme tokens, with a five-by-seven pixel font for its words, since a text font rasterised at that size and scaled looked nothing like the arcade. It pauses when it loses the keyboard, keeps its sound setting through `pudlHost.config`, and answers a `play` request with a level. Its one published action, `splash.invaders/play@1`, opens it; the games have no pure action yet, so nothing of theirs runs over `/mcp`.

Two things the first package taught the host. A page body must not set the mount's fit, since a window is built from the same body and PUDL then honours it; the host decides. And the site now gives any mount PUDL marks `data-applet-fit="fill"` a definite box (`pudl-site.css`), which every site applet had been doing for itself under a class of its own, so a package's stylesheet sizes only its own insides.

Checks: `tools/test-invaders.js` (20, against any host with the package installed): the page, a game started, moved, fired, paused by the key, by losing the keyboard and by the button, the dialogs, the scores file ranked and kept under `~`, and the game in a window with its shape and menu. Live on parkscomputing.com at `/page/invaders` and in the Applets menu, installed by copying `dist/invaders` and `dist/shared` into the live content's `wwwroot/applets/`.

**Step 3, the shell and Asteroids (2026-10-18).** What the two games would have duplicated is one module, `packages/shared/splash-shell.js`: the canvas and the bar, the status line, the High scores and Help dialogs, the scores file, the sound setting and the beeps, the frame loop, pausing when the keyboard leaves, the theme's colours, the pixel font (`splash-font.js`) and the Game and Help menus, with the look in `splash.css`, which each game's stylesheet imports. A game gives the shell its size, help, touch pad, and `newGame`, `newWave`, `respawn`, `update`, `draw` and `press`, and gets the PUDL instance back.

Loading the shared modules at run time turned out to break PUDL's contract, which boots a mount once the applet's script has registered it, so a script that registered after its modules arrived registered too late and the window's menu was empty. The manifest gained `bundle`, scripts the packing tool writes in front of `src`, so the installed script is one file and registers as it loads; the built manifest leaves `bundle` out. `shared` still copies the folder beside the games, for the stylesheet the games import.

Asteroids draws in lines on a screen of 640 by 480. With `crisp` the shell sizes the canvas to what it is shown at and scales the drawing, so the lines stay sharp at any size. The ship turns, thrusts and drifts with drag, wraps at the edges and has hyperspace with its one-in-six risk; rocks of three sizes break in two until they are dust; the big saucer shoots anywhere and the small one aims, better as the score climbs; the ship comes back when the middle is clear; the heartbeat quickens as a wave goes on. Its test (`tools/test-asteroids.js`, 18 checks) runs like Invaders'. A package's `icon` file became part of the manifest with these two games, shown in the launch menu (PUDL 0.64.0), the window's title bar and the taskbar. Both games are live on parkscomputing.com.

**Step 4, PUDL Desktop as the second host (2026-10-18).** The Go service (`C:\Users\paul\source\repos\pudl-desktop`) gained `-applets`, a folder of installed packages, and `internal/web/applets.go`, its catalogue: the same manifest rules, read again when a manifest or page body changes, a refused package said once in the log. From the manifests the desktop writes `/applets/registry.js`, serves each package's files under `/applets/<name>/`, gives each a Classic page at `/app/<name>` and a window `app-<name>` (a new key kind, since a package's name may hold hyphens) with the manifest's least and largest sizes, and lists it in the Applets menu with its icon. The desktop's pages load `pudl-applets.js`, the vendored host kit, `host.js`, which builds `pudlHost` from the kit with `pages: '/app/'`, and the registry, in that order. The desktop has no file service, settings files or snapshots for applets, so `pudlHost` carries none, and the games keep their scores and sound setting in the browser, as the shared modules do without those services. Two tests cover it: the registry, page, files, keys and the refused package over HTTP, and Hello running in a window from the Applets menu with the host object, in Chromium. PUDLSplash's `dist/` installed on a local run shows both games in windows and on their pages, unchanged from parkscomputing.com: one folder, two hosts in two languages.

**Step 5, Sudoku and the barcode collection (2026-10-18).** Sudoku moved first, to the repo `pudl-sudoku` (MIT, as its code always was), with its page left in `content/sudoku.html` for the web-app manifest it links and its state still under `pc-sudoku`.

The Barcode Tool, the Barcode Scanner and the flash cards moved together to the repo `pudl-barcodes` (local at `C:\Users\paul\source\repos\pudl-barcodes`, Apache-2.0), since all three are built on one engine. The engine and the scanner's lookup are in `packages/engine`, which is not a package, and each package bundles what it uses; the tool's actions module bundles the engine too, which needed `bundle` to take an object of script to list as well as a plain list for `src`. The packing tool now checks the scripts a package bundles, and refuses a host's own event names such as `pc:fs-change`, which the old scanner had listened for. The scanner's decoder and the flash cards' scans are in their own packages. The globals lost their `pc` prefix (`barcodeEngine`, `barcodeLibrary`, `barcodeLookup`, `barcodeLookupUI`, `barcodeScannerCore`); the layout file's format string, `pc-barcode-layouts`, is data and stays.

These applets needed three things the host interface did not have, which kit 0.2.0 adds and which Paul agreed before they were built. `fs.open` and `fs.save` show the host's own dialogs and give back the file or write it, so an applet never sees the host's file tree; here they are the site's `pcFileBrowser.pick` over `pcSiteFs`, with a picture offered as a download where `~` keeps only text. `fs.onChange` says a file changed, here or in another tab. `service(name)` gives the address of something on the host's server, here `barcode-products` at `/api/barcode-products/`, the Open Food Facts proxy; a host without it simply does not offer that source.

The layout library changed shape. It had been the tool's own browser storage, which the site's file service showed as a special `~/barcode-layouts.json` that could not be deleted or moved, checked against the barcode engine whenever it was saved. It is now an ordinary file in `~`, read and written through `pudlHost.fs`, so it follows `~` wherever that goes, including into an account if members ever get a home of their own. A library kept in the browser moves into the file the first time it is read, and the browser's copy is kept aside under `pc-barcode-layouts-moved`, which also stops it moving twice. A host with no file system keeps the library in the browser as before. A file that cannot be read is reported and never written over. As a result, `sitefs.js`, the Editor, Files and the Terminal no longer know anything about barcodes; the Editor checks the file as JSON only, and the tool reports any other problem.

Checks: in the collection, `tools/test-lookup.js` and `tools/test-scanner.js` (moved from this repo's `Tools/`) and `tools/test-tool.js`, the last two on a bare page that builds `pudlHost` from the kit with its files in memory; in this repo, `Tools/test-barcodes-package.js` (18, on the test instance and live): each page runs its package, the layouts move into the file and reach the scanner, the site's dialogs and lookup service, the flash cards' scans, and the tool's window, icon, menus and continuity under `pc-barcodes`. `test-applet-actions.js`, `test-mcp.js` (the barcode drawn on the server from the package's module), `test-applet-packages.js` and `test-sudoku-package.js` pass. Live on parkscomputing.com.

**Step 6, Conway, Dice, the Theme Studio and the Diff Viewer (2026-10-18).** Conway is the repo `pudl-conway`, Dice `pudl-dice`, and the Theme Studio and the Diff Viewer are the collection `pudl-tools`, all Apache-2.0 and local under `C:\Users\paul\source\repos\`. Each moved with its icon, and the site's copies and `define()` calls are gone.

Conway's registered page had been its 2015 article, so that the board links shared since then open there. A package's page is `/page/<name>`, so the article's mount now says `data-applet-page="/page/conways-game-of-life"`, which PUDL documents as overriding the registry's page, and the links still open their boards in the article. The article lists the game's source from `/applets/conway/conway.js`. Share's "Open this board" had used the site's private hand-off to reopen the window with a board. It now uses PUDL's documented requests: the manifest declares `handles: { board: { param: "init", extra: [...] } }`, the state's own keys, and the game asks `request('board', …)`, which reaches the game in front or opens one.

The Theme Studio's preview frame had loaded `/pudl/pudl.css`, a path this site happens to use. Kit 0.3.0 adds `pudlHost.pudl`, where the host keeps its PUDL release (`/pudl/` here, `/static/pudl/` on PUDL Desktop); the studio passes it to its preview, which is now the package's own `preview.html`. The Diff Viewer opens files through `pudlHost.fs.open` and reads the paths its address keeps through `readText`. Its comparison, `textdiff.js`, had no other user on the site, so it moved into the collection as `packages/lib/textdiff.js` with the global `textDiff`, its checks with it. The site's `fs.open` now refuses a file that is not text, since it gives the applet text.

Checks: `Tools/test-small-packages.js` (12, on the test instance and live): each page runs its package, the article opens a 2015-style link with its five live cells and lists the source, a board request reaches Conway in its window, Dice rolls, the preview loads the site's PUDL and takes the palette, and the Diff Viewer reads two paths and opens a file through the site's dialog. `test-applet-actions.js` and `test-mcp.js` (Dice's roll, now from its package) pass.

Sight Reader is the last to move, and waits on where its sample scores live: the site lists them live from `content/scores` through its own listing API, which a package cannot call.

## Decisions for Paul

1. The package shape and `pudlHost` as set out above.
2. Apache-2.0 for the packages repo and PUDLSplash, matching PUDL Desktop and the Terminal.
3. The npm scope.
4. Whether the engine generates applet pages and menu entries from manifests, replacing the hand-written `content/<slug>.html` and `sitenav.xfer` entries for packaged applets. This document assumes yes.
5. Whether to propose `pudlApplets.install(url)` and the two menu helpers to PUDL now, or after the kit has run on two hosts.
