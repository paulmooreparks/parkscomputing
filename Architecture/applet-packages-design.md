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
| `fs` | the file service: tree, read, write, with the file browser | `pcSiteFs` and `pcFileBrowser` |
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

**A home directory for accounts.** Paul's rule (2026-10-18): `~/` is this browser's storage for a guest and the account's own storage once the reader has one, and what a guest kept moves into the account when it is created. Today only the super-user has a server-backed home, through the admin mount; a signed-in member still has `/home/guest` in `localStorage`. The account half is engine work of its own, outside this design: a member's `/home/<name>` on the server, a copy of the guest home into it at sign-up or first sign-in, and the file service choosing the server home for a signed-in member. The games need nothing from it beyond `~/`, which is why they write there from the start. Both games open on parkscomputing.com at `/page/invaders` and `/page/asteroids`, in windows sized by their manifests, as soon as the engine's catalogue scanner lands and the packages are copied in.

## Order of work

1. **The kit and the manifest.** A `pudl-applet-packages` repo holds the manifest format, `pudl-host-kit.js`, the portability check and the packaging script that builds `dist/` from package folders. Conway's Game of Life is packaged first, since it touches no site service, and it proves the shape.
2. **The engine's catalogue.** `AppletCatalog` scans the folder and generates the registry, pages, menu entries, action list and continuity list. Conway is served from its package, its hand-written page and `define()` removed, and `compare-article-render.js` shows the article that embeds it unchanged.
3. **PUDLSplash.** The repo, the shared input and scores modules, Space Invaders, then Asteroids, each installed on parkscomputing.com as it is finished.
4. **PUDL Desktop installs a package.** The Go service gets the same scanner and a `pudlHost` with `identity`, `action` and `snapshot`, and installs PUDLSplash. Two hosts in two languages running one package is the proof the design asks for.
5. **The rest move out.** Sudoku, then the barcode collection (which needs `fs`), then Dice, Sight Reader, Theme Studio and Diff. The Terminal, Files and the Editor stay with the engine until the host interface has grown the services they need; they are the engine's own tools rather than applets a site installs.

## Decisions for Paul

1. The package shape and `pudlHost` as set out above.
2. Apache-2.0 for the packages repo and PUDLSplash, matching PUDL Desktop and the Terminal.
3. The npm scope.
4. Whether the engine generates applet pages and menu entries from manifests, replacing the hand-written `content/<slug>.html` and `sitenav.xfer` entries for packaged applets. This document assumes yes.
5. Whether to propose `pudlApplets.install(url)` and the two menu helpers to PUDL now, or after the kit has run on two hosts.
