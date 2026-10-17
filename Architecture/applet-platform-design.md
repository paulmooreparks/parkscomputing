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
- Status: P1 (the Terminal port), P2 (published actions) and P3's tokens, `/mcp`, site tools and pure actions on the server are live. The queue to the admin's desktop is next, then OAuth.

## Decisions on P3 (Paul, 2026-10-17)

- **Publishing is a capability of the token.** A token may write to the content folder only if it was minted with the capability that allows it, and those writes take effect at once, as an admin's own edits on the edit origin do. A token minted without it can still draft in the admin's home folder. There is no separate draft-and-publish step on the server.
- **The first build is tokens, the site tools and the five applet tools.** Jint for pure applet actions and the queue to the admin's desktop come after it. Until then `applet_invoke` refuses an applet action with a plain "not available over MCP yet", while `applet_discover` already lists every action so a client can see what is coming.

## Rules this follows

The design relies on no undocumented behaviour: wasmoon, mvdan.cc/sh, Jint, the MCP C# SDK and the JSON Schema validator are all used through their documented interfaces. The capability list is closed and granted by the host, never by a manifest. Nothing that changes data runs without either a person's action or a token an admin minted for it.

## P1, the Terminal port: what was built (2026-10-17)

The terminal on parkscomputing.com now has GK Companion's scripting, merged into its own code rather than replacing it, so the site's commands, ssh, the snapshot, the settings and the pager stay as they were.

- **The line.** `parse(line, lookup)` is GK's: `;`, `&&`, `||`, `|`, `<`, `>` and `>>`, `$NAME`, `${NAME}`, `${NAME:-default}`, `$?`, a script's `$0` to `$9`, `$@` and `$#`, single and double quotes, and `#` comments. Each pipeline's expansions are made as it starts, so an export or a status earlier on the line is seen.
- **Variables.** `export`, `unset` and `env`, with `HOME`, `PWD`, `OLDPWD` and `USER` fixed and `PATH` defaulting to `~/bin:/site/bin`. They live with the terminal and come back with its snapshot after a reload. `cd -` goes back.
- **New commands.** `true`, `false`, `date` (with `-I` for ISO 8601), `which`, `stat`, `basename`, `dirname`, `tee`, `source` and `.`, `exit`, and `echo -n`.
- **Scripts.** A name is looked up as it is, then with `.sh`, then with `.lua`, in each directory of `PATH`, after the current directory and `/site/applets`. A file ending in `.sh` or `.lua` in the reader's own files is a script wherever it is. `content/bin` on the server now keeps the `.sh` and `.lua` extensions (`Controllers/TerminalController.cs`), so the site's own scripts can be shell or Lua, and their `--` comments give `man` its text.
- **Interpreters.** `pcTerminal.registerInterpreter` with GK's interface; `js/terminal-lua.js` and `js/terminal-sh.js` register Lua 5.4 (wasmoon 1.16.0, `js/vendor/wasmoon-1.16.0`) and the POSIX shell (mvdan.cc/sh, `js/vendor/gosh-f1115436`, the folder named for the hash of its source so a rebuild never meets a cached copy). Each script runs in a worker of its own and reaches the page only through the host's requests. The shell's 6.5 MB loads the first time a shell script runs.
- **Lua modules.** `require` looks in the script's directory, `~/lib/lua`, `/site/lib/lua`, and last the modules that come with the terminal (`js/terminal-lib/lua`, json and cli from GK). Those files end in `.lua.txt`, because the server serves no file of a type it does not know.
- **~/.profile** is sourced when a terminal starts afresh, not after a reload, whose snapshot already holds the variables.
- **Not yet.** Scripts cannot call applets' actions until P2; the host answers `applets` and `invoke` with that. The account pages' content security policy has no `'wasm-unsafe-eval'`, which WebAssembly needs; no terminal runs on those pages today, and one that did would need it added.

Checks: `Tools/test-terminal-scripting.js` (24, on the test instance and the live site), with the snapshot suites and the applet sizing test unchanged.

## P2, published actions: the design as built (2026-10-17)

An applet's actions are described in a manifest file of their own, beside the applet, rather than inside `js/applets.js`. Every page loads `applets.js`, and the barcode tool's schemas alone are several kilobytes that only a script or an AI ever reads. A manifest is also the part of an applet that the server will read for MCP (P3) and that `applet.json` will carry when applets leave the repository (P5), so it is plain JSON that any reader can parse without running the applet's code. The applet's `define` points to it:

```js
pudlApplets.define('barcodes', { src: '/js/barcode-tool.js', ..., ver: '31',
    actions: '/js/actions/barcode.json' });
```

The manifest is GK's `Manifest` (`id`, `version`, `apiVersion: 1`, `title`, `description`, `actions`), and each action is GK's `Action` (`ref`, `title`, `description`, `inputSchema`, `outputSchema`, `capabilities`, `replay`). Two optional fields are the site's. `module` is a script beside the manifest whose handlers run the actions without a window, and an action's `handles` says that it is one of the applet's `handles` verbs, which the broker carries out by asking PUDL for the window rather than by calling a handler. That is how the existing verbs become ordinary actions.

Provider ids start with `parks.`, as GK's barcode provider already did, so the barcode actions have the same references on both sites.

**The broker** is `js/applet-actions.js`, loaded only when something asks for it (the Terminal's `applets` command, a Lua or shell script, and later the desktop's MCP queue). It is `window.pcActions`:

- `catalog()` gives the manifests in GK's shape, and `describe(ref)` one action.
- `invoke(ref, input, opts)` starts an invocation and resolves when it has finished, failed or begun waiting for a person. `run(ref, input, opts)` waits until the end and gives the output, or throws.
- `status(id)`, `wait(id)`, `cancel(id)`, `artifact(id)` and `invocations()` read and control the records.
- `provide(id, handlers)` is what an applet's module calls to hand over its handlers.

Before a handler runs, the broker checks that the action exists, that the caller was granted every capability the action declares, and that the input is valid JSON of at most 1 MB that its input schema accepts. Afterwards it checks the output the same way. Artifacts are put into the output as descriptors (`id`, `invocationId`, `name`, `mime`, `size`, and `sha256` where the browser offers hashing), so the whole output, artifacts included, is checked against the schema. GK skips that check when an action makes artifacts. A handler that makes an artifact without declaring `artifact.create`, or asks a person a question without `attention.request` and `replay: "human"`, fails.

**Capabilities** are a closed list in the broker: `artifact.create`, `attention.request` and `notification.post` from GK, and the site's `files.read`, `files.write` and `window.open`. A manifest that declares anything else is refused when the catalog loads. A handler's context contains only the services its action declared, so an action without `files.write` has no way to write. The caller's grant is the other half of the check: the Terminal grants the whole list, because its reader can do all of it by hand, and an MCP token (P3) will grant what the admin chose when minting it.

**Replay** keeps GK's meaning. A `pure` action has no effects and can be run again. A `once` action has effects, so an invocation started with a caller's own `id` is never run twice: asking again with the same id returns the record. A `human` action waits for a person. In the page its question appears as a PUDL dialog with the fields the handler asked for, and nobody but the person at the page can answer it.

**Records** live in the page for as long as the page does, the most recent 200 of them. GK keeps its records on disk, because its broker outlives any window. In the page there is nothing for a record to outlive, and the records that must survive (an MCP call queued for the desktop) will be the server's, in P3.

**Validation** uses `@cfworker/json-schema` 4.1.1 (MIT), vendored in `js/vendor/cfworker-json-schema-4.1.1` and loaded as an ES module. Ajv was ruled out because it compiles schemas into code with `new Function`, which the admin pages' content security policy forbids. Schemas are draft 2020-12, as GK's are, and a `$ref` that points outside the schema is refused when the catalog loads, as GK's closed loader refuses one.

**What publishes actions now.** Barcodes (`generate`, `interpret`, GK's own), Dice (`roll`), Sudoku (`solve`), Files (`list`, `read`, `write`, and `browse`, its verb), the Editor (`open`), the Terminal (`shell`), Sight Reader (`open`, a new verb for scores), and the page itself (`parks.page/notify` and `parks.page/ask`, which an MCP client will use to tell or ask the admin something).

**From the Terminal.** `applets` lists the providers, `applets actions [id]` their actions, `applets describe <ref>` an action's whole manifest entry, `applets run <ref> [input]` runs one and prints its output, and `invoke`, `status`, `cancel`, `history` and `artifact <id> [file]` do the rest. The input is JSON, or `name=value` pairs for a flat object. Lua's `require "applets"` and the host's `applets` and `invoke` requests use the same broker, and a shell script runs the `applets` command like any other.

**The PUDL proposal** is `Architecture/pudl-proposal-applet-actions.md`. Until PUDL takes it, `js/applets.js` wraps `pudlApplets.define` to note each `actions` and `handles` declaration for the broker, because PUDL keeps its definitions private; that wrapper is marked as the workaround to delete.

**Two things found on the way.** The site never loaded PUDL's toasts, so the broker loads `pudl/pudl-toast.js` the first time a notice is posted. And the Terminal's line editor redrew only the row the cursor was on, so in a narrow window a typed line that wrapped was printed again on a new row at every key; it now goes back up over the wrapped rows before it redraws, and keeps working after the window is resized.

Checks: `Tools/test-applet-actions.js` (33, on the test instance and the live site: the Terminal command, Lua and the shell, grants, replay, output validation, a question answered and declined, a notice, and window actions in both views), with the Terminal's suites unchanged.

## P3, the first build: what was built (2026-10-17)

**Tokens.** `Identity/AccessTokens.cs` keeps personal access tokens in `SiteAccessTokens` (migration `AccessTokens`): the account, a name, the secret's first characters, its SHA-256, the capabilities, creation, expiry (7, 30, 90 or 365 days), last use and revocation. The secret (`pcmcp_` and 32 random bytes) is shown once. A token works only while its account may use the server's tools, so a super-user who stops being one takes every token with them. The super-user makes and revokes tokens in the Access tokens card of Account; making one asks for a passkey tap first, and the account is emailed that it was made. The operator can do the same on the server with `admin token <email> <name> <capabilities> [days]`, `admin tokens <email>` and `admin token-revoke <email> <id>`.

**The capabilities** a token can be given are a closed list (`TokenCapabilities`): `files.read`, `files.write` (~ only), `site.publish` (/wwwroot, live at once), `comments.moderate` and `logs.read` for the server's tools, and the broker's four applet capabilities for when applet actions run over MCP.

**The endpoint.** `Mcp/McpSetup.cs` maps `/mcp` with the official C# SDK 2.2.0 on a site with accounts and staff, and nowhere else. Only the token scheme (`Identity/AccessTokenAuthentication.cs`) counts there, so a browser's cookie session can't reach it. The SDK runs in its hybrid session mode: clients of the 2026-07-28 revision are served per request, and clients still using the initialize handshake, most of them today, get a session. Each capability is a policy, and each tool carries the policy it needs, so a token's tool list holds only what it may call. A token has 300 calls a minute, and every call is logged with the tool and the token's name.

**The tools.**
- `site_files_list`, `site_file_read` and `site_file_write` work on ~, /wwwroot and /etc as the admin mount shows them. Writing keeps the replaced version in the history and goes in the audit log as "the account (token name)", through the same `ServerFiles.ReplaceAsync` the admin mount's controller now uses. Neither /etc nor js/, css/ and pudl/ can be written over MCP, since on the desktop they need a passkey tap that a token can't give.
- `site_pages` gives the site's sections and pages with each page's source file.
- `comments_queue` and `comment_decide` are the moderation queue.
- `server_log` is the Server log applet's view.
- The five applet tools read the manifests in `wwwroot/js/actions`. `applet_invoke` says applet actions aren't available over MCP yet, as decided.

**Connecting.** `claude mcp add --transport http parkscomputing https://parkscomputing.com/mcp --header "Authorization: Bearer <secret>"`; the Account card shows that line with the secret filled in.

Checks: `Tools/test-mcp.js` (27 on the test instance, 23 on the live site, where the token has no `site.publish` so nothing reaches the public site). The live run's tokens were revoked straight after.

## P3, pure actions on the server (2026-10-17)

`applet_invoke` now runs an action on the server when it is pure and needs no capability beyond `artifact.create`: today that is Dice's roll, Sudoku's solve, and the Barcode Tool's generate and interpret. Any other action says it needs the admin's open desktop, which is the next step. `applet_discover` marks each action with `runsOverMcp`.

**One set of rules.** The checks that were inside the page's broker moved to `js/applet-actions-core.js`, which touches nothing of its host's: manifests, schemas, the artifact and question rules. The page's broker and the server's runner both run that file, so an action is checked the same way wherever it runs. Each host brings what only it can give: the page hashes artifacts with the browser's crypto, and the server with .NET.

**The runner** (`Mcp/AppletRunner.cs`) runs each invocation in a fresh Jint 4.16.4 engine, from the same files the page uses: the manifest, the action's module, the core and the schema library. The engine gets only four functions from .NET (`Mcp/AppletRunner.js` documents them), no access to .NET types, a 10-second limit, 256 MB of memory, 50 million statements and a recursion limit. A module may load scripts beside it under `wwwroot/js` and nothing else; an `import` is refused. A probe provider placed on the test instance and removed afterwards confirmed each limit: an endless loop, an endless allocation, a search for `require`, `System` and `fetch`, a load of `appsettings.json` and an `import` were all stopped, and the server went on serving.

**The validator** is the page's own, @cfworker/json-schema 4.1.1, run in Jint, as Paul chose over a .NET validator: JsonSchema.Net is now under a paid licence, and Corvus compiles C# at runtime. cfworker uses the web's `URL` class, which Jint lacks, so the runner provides the part of it the library calls (the constructor with a base, `href`, and `hash` read and set), backed by .NET's `System.Uri`. Manifests may only refer within themselves, so it only ever resolves `#…` against an absolute base. The barcode's output schema, which uses `$ref`, proves it in the checks.

**Records** are kept in memory, the latest 500, each with the token that made it, so a token sees only its own. A pure action has finished by the time `applet_invoke` answers, so nothing waits on a record a restart would lose. An `id` of the caller's own makes a retry safe, as in the page.

Checks: `Tools/test-mcp.js` now has 35, on the test instance and on the live site.

## Files, Open and Save as from GK Companion (2026-10-17)

The shared file browser (`js/filebrowser.js`) is now GK Companion's `vendor/parks-files/filebrowser.js`, kept as the site's titles and subtitles show them. Going to a folder can now wait on a loader (`F.load`, `F.lookup`) and returns a promise, a host can fence the browser into one folder (`navigationRoot`, `allowed`), long folders page with Load More, and Home is optional. These are what an applet in its own repository needs from a browser whose files are not the site's, so they belong to the split described in P5.

Open and Save as (`pcFileBrowser.pick`) gained four things from GK's dialogs:

- An optional `commit(choice)` that does the opening or saving while the dialog stays open and busy. When it throws, the dialog shows why and stays open to choose again, and Escape does nothing while it runs. The Editor uses it for Open and for Save as, so a save that fails is no longer a closed dialog and a red status line.
- A folder that can't take the file says so in a plain note under the list rather than as an error, turns off the name and Save, and makes Download the main button.
- New folder, wherever a file could be saved.
- The dialog can be resized from its corner, and opens at the size it was last given in that browser.

Diff, Settings and the barcode tool call `pick` without `commit`, so they still close at once and act afterwards; they gain the other three. Checks: `Tools/test-file-dialogs.js` (18, on the test instance and the live site), with the snapshot suites unchanged.
