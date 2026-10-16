# Applets as a platform: scripting, published actions, AI and MCP

Status: accepted with the decisions below, 2026-10-17; the Terminal port is under way. It brings GK Companion's terminal scripting and applet API back to parkscomputing.com, takes them further, and shapes the result so that other sites on the engine (padmajairam.com first) can use it.

## What exists, on each side

**GK Companion** (`C:\Users\paul\source\repos\gk-companion`) started its Terminal as a copy of this site's `terminal.js` and grew it in four ways.
- Interpreters plug in through `registerInterpreter({id, command, matches(path, text), run(source, ctx)})`. Each script runs in its own Web Worker and reaches the page only through `ctx.request(op, args)`, a narrow host API for files, environment, running commands and invoking applets (`frontend/terminal-applet.js:186-230, 999-1113`).
- Lua is the reference Lua 5.4 compiled to WebAssembly (wasmoon 1.16.0, MIT). The shell is mvdan.cc/sh, a POSIX shell with the common Bash additions, compiled from Go to WebAssembly (`tools/shwasm`, about 6.5 MB). Both run entirely in the browser. Go is needed only to rebuild the shell.
- The line parser gained environment variables, `export`, `;`, `&&`, `||`, input redirection, `PATH` lookup of `.sh` and `.lua` scripts, `source`, and `~/.profile`.
- Commands became asynchronous, because GK's file system pages from the host.

Its applet API is a separate layer. An applet publishes a manifest of actions (`applet/contract/contract.go`): each action has a reference such as `parks.barcode/generate@1`, a title and description, JSON Schema for its input and output, the capabilities it needs from a closed list the host grants (an applet cannot grant itself one), and a replay policy (`pure`, `human` or `once`). A broker turns every call into a durable, idempotent invocation record with a status, validates input and output against the schemas, and refuses any artifact the action did not declare. An action that needs a person returns a request that only the person can answer, in Notifications. GK Companion makes no model calls itself: its chat is an outside agent (Devin or Codex) which reaches the applets through an MCP server that exposes five generic tools, `applet_discover`, `applet_invoke`, `applet_status`, `applet_cancel` and `applet_artifact`, behind a per-chat bearer token on a loopback bridge.

**parkscomputing.com** has the PUDL applet runtime (`pudl/pudl-applets.js`: `define`, `register`, and `handles`/`request` routing for three verbs, open, browse and shell), eighteen applets in `js/applets.js`, and the original Terminal: quoting, globs, pipes, output redirection and positional parameters in scripts, but no variables, conditionals or loops (`Architecture/terminal-design.md`). No applet publishes its operations. No API accepts a token an outside client could hold: every admin API is cookie, antiforgery and origin bound. The engine is shared with padmajairam.com, which runs in brochure mode and loads no applets.

## The aim

Every applet should be drivable three ways, by the same published actions. A person drives it through its window, a script drives it from the Terminal, and an AI drives it through MCP. A site chooses which applets it carries, and the applets live outside any one site.

## Decisions proposed

**P1. The Terminal takes GK Companion's scripting whole.** The interpreter interface, the worker host and its request API, the line parser's additions, wasmoon and the shell WebAssembly come across, with the site's command interface widened to `async run(args, io)` as GK's was. The shell's 6.5 MB loads only the first time `sh` or a `.sh` script runs, and like every file under `js/vendor` it is cached for a year. The site's `sitefs` stays the file system behind the host API, so `/site`, `~`, and for an admin `/wwwroot`, `/home/<name>` and `/etc`, are what scripts see. The existing sandbox rule stands: a script can do only what commands can. GK's bundled `/bin` scripts that are about Confluence, Jira or flows stay behind; its `json.lua` and `cli.lua` libraries come with the engines.

Taking it further than GK has:
- `/etc/profile` for the site and `~/.profile` for the reader, so a site can ship aliases and functions.
- `applets` from both languages backed by the site's action broker (P2), so a script can generate a barcode, open a file in the Editor or read the site tree through published actions rather than private calls.
- Scripts in `/site/bin` written in shell or Lua, so a site's own commands need no JavaScript and no review of code that runs with the page's rights.

**P2. Applets publish actions, in GK's contract, inside PUDL's registry.** `pudlApplets.define` gains `actions`, a manifest in GK's shape (reference, title, description, input and output schema, capabilities, replay), and an applet's module may export headless handlers for them, which run without opening a window. A small broker in the page validates input and output, enforces the capability list the host grants, records invocations, and turns a `human` action into a PUDL notification that only the person can answer. This is a PUDL proposal, because the registry is PUDL's; the site builds it first behind a marked workaround and deletes the workaround when PUDL ships it, as with earlier proposals. The existing `handles` verbs become ordinary actions in the same manifest. Schema validation uses a documented JSON Schema validator vendored like OSMD, not a hand-written subset.

**P3. An MCP endpoint on the site, for an admin, with tokens the admin mints.** The engine hosts MCP over Streamable HTTP at `/mcp`, using the official C# SDK (`ModelContextProtocol.AspNetCore`). It exposes GK's five generic tools plus a small set of site tools that need no browser: read and write files under the content volume and `~`, read the site tree and sitenav, list and moderate the comment queue, read the server log. Access is by personal access token: an admin mints one in Account after a fresh passkey tap, gives it a name, an expiry and a set of capabilities from the same closed list, and can revoke it. Only a hash is stored. Tokens are rate limited like the admin APIs and every call is logged with the token's name. MCP's own authorization (OAuth 2.1) is the standard path for clients such as claude.ai connectors and comes second, on the same token store.

Which actions MCP can run needs care, because applet actions run in a browser and MCP calls arrive at the server. Three kinds are separated:
- Site actions written in C# (the site tools above) run on the server.
- Pure applet actions (barcode generation, dice, a sudoku check) run on the server in Jint, a documented .NET JavaScript engine, from the same module the browser loads, which is GK's `applet/jsruntime` idea with Jint for goja. They get no host objects, a time limit and an output cap.
- Actions that need a window or a person (open this in the Editor, ask me to approve) are queued for the admin's open desktop, which picks them up, runs them and reports back. A queued action with nobody signed in waits and then times out; it never runs unseen.

**P4. AI chat comes after MCP, and may not be needed.** GK's experience is that an outside agent driving applets through MCP covers most of what an in-page chat would do, and costs no model integration in the site. Claude Code and Claude desktop can use `/mcp` the day P3 ships. An in-site chat applet (admin only, the model called from the server with the site's key, tools generated from the manifests, the same approval rule) is a later, separate decision.

**P5. The applets leave the site repo.** One repository, `pudl-applets`, holds every portable applet, the shared modules they use (`sitefs`, the file browser, `config`, the Terminal and its engines) and their manifests, with the Terminal as its largest member rather than a repo of its own: it shares too much with the Files applet and the Editor to version apart from them cleanly. Each applet gets an `applet.json` (name, version, files, handles, actions, and the host services it needs). What an applet needs from a site becomes a host interface the site provides, `fs`, `config`, `siteTree`, `notify`, instead of fixed `/api/site/*` addresses, so a different engine can host the same applets. Applets that are really pages of this site (account, moderation, logs, visits, comments) stay in the site repo.

Releases are tagged and published as npm packages under one scope, and a site takes a pinned release into `wwwroot` the way it takes PUDL's `dist`. An "applet store" is then an index of those packages with their manifests, which an admin can browse from the desktop and add to the site's registry; it needs nothing beyond the package metadata npm already serves.

**P6. Each site declares what it carries.** `SiteOptions` gains a feature list: which applets the site registers, whether the Terminal has scripting, whether `/mcp` is on. Features a site leaves out are absent from its pages, menus and routes, as the padmajairam port design already says. padmajairam.com could then carry `/mcp` alone, to let an AI manage its content, with none of the desktop.

## Order of work

1. The Terminal port (P1). Front end only, no engine change, and it is useful by itself.
2. Action manifests and the page broker (P2), with manifests for the applets that already have something worth calling: barcodes, dice, sudoku, sight-reader (open a score), files and editor (through `fs`), and the Terminal itself (run a script). The Terminal's `applets` command lands here.
3. Access tokens and `/mcp` with the site tools, then Jint for pure actions, then the desktop queue (P3).
4. The applets repository, the host interface and the first npm release (P5). Doing this after P2 means the manifest format is settled before it becomes a published contract.
5. Site feature lists, and padmajairam.com with `/mcp` (P6).
6. The in-site chat applet and the store index, if wanted (P4, P5).

## Decisions (Paul, 2026-10-17)

- **No in-site AI chat for now.** MCP only (P4).
- **Repositories stay open.** Some applets may be bundled together and a large one such as the Terminal may get a repository of its own; the choice is kept in view, not made. For now everything stays in the parkscomputing.com repository, and the work is shaped so that applets can be split out later: each applet's files, manifest and host needs are kept self-contained, and nothing an applet needs from the site is reached except through the host interface (P5).
- **Public npm packages** when applets are published (P5).
- **Personal access tokens first, then OAuth** for MCP (P3).
- Status: P1 (the Terminal port) is started.

## Rules this follows

The design relies on no undocumented behaviour: wasmoon, mvdan.cc/sh, Jint, the MCP C# SDK and the JSON Schema validator are all used through their documented interfaces. The capability list is closed and granted by the host, never by a manifest. Nothing that changes data runs without either a person's action or a token an admin minted for it.
