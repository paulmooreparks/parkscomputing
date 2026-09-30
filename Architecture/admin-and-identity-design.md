# Admin editing and identity

This document is the design for editing parkscomputing.com from the site itself, with the identity system that editing needs. The same system will later serve comments. The decisions below were settled with Paul on 2026-09-30. The phases after the first are described so the identity work doesn't have to be redone for them.

## Threat model

The site has one author and a public readership. It serves author HTML that carries its own scripts, the local container is production, and the content lives on a OneDrive-synced volume mounted into that container. Anyone who gets an admin session can therefore change what every visitor runs. With comments, strangers will also be putting text on the site's pages. The design assumes both, so it keeps the admin session hard to steal and confines where it can be used.

The attacker's goals are these:

- deface the site, or plant script that runs for every visitor;
- read what isn't public: configuration, secrets, anything near customer data;
- reach the Docker host through the mounted volume or an exposed port;
- take over the admin account through its recovery path.

## Decisions

### A1. Upgrade to .NET 10 first

The engine moves from .NET 8 to .NET 10, the current long-term-support release, before any identity work. ASP.NET Core Identity in .NET 10 supports passkeys natively, which keeps the sign-in path first-party and documented, as the rule against relying on undocumented behaviour requires. The upgrade stands on its own and ships on its own.

### A2. The first attempt is removed, not built on

The early comments attempt left a users table with bcrypt hashes, `/api/auth/token` issuing JWT bearer tokens, `[Authorize]` writes on `/api/content`, and the `SmartSamComments*` projects. The engine already stubs the comments library out and no longer references those projects. All of it is removed: the projects, the token endpoint, the JWT configuration and its 32-byte secret check, the write endpoints, and the old table, once a migration has dropped it. Bearer tokens held in script are the wrong shape for a browser session on a site that serves author scripts. Read-only content endpoints stay if anything reads them; that is checked during the removal.

Done 2026-09-30. The `InitialIdentity` migration drops the old `Users` table. `/api/content` is now read-only, and its hypermedia no longer advertises the update and delete actions it can't perform. The removal also found that its list accepted `includeDrafts=true` from anyone, so drafts were public; it now lists published items only, and a draft's own address answers 404.

### A3. One identity system, with roles

ASP.NET Core Identity holds every account, in the SQL Server database the site already uses for auth, at schema version 3, which adds passkeys. The data-protection keys live in the same database, so sign-in cookies and emailed links survive a container rebuild. Accounts carry roles. **Admin** can never be granted by any path a browser can reach. **Commenter**, in the comments phase, is what signing up gives.

An admin is made by a command run in the container, and by nothing else; there is no seed:

    docker exec parkscomputing-dev dotnet ParksComputing.Engine.dll admin enroll <email>
    docker exec parkscomputing-dev dotnet ParksComputing.Engine.dll admin list
    docker exec parkscomputing-dev dotnet ParksComputing.Engine.dll admin revoke <email>

`enroll` makes the account an admin and prints an enrollment link, good once within fifteen minutes, that registers a passkey and signs in. `revoke` removes the role and ends every session within a minute.

### A4. Sign-in: passkeys, recovery codes and email

These are the ways an account can sign in, strongest first:

1. Passkeys. The admin account registers at least two, such as a phone and a hardware key.
2. Printed recovery codes, each usable once.
3. A sign-in link sent by email through Resend, valid for fifteen minutes and usable once.

SMS is not offered, because a SIM swap can hijack it. A session that began with a recovery code or an email link is a **fallback session**. It can do everything except change sign-in methods, and every sign-in of any kind is emailed to the account's address.

The build refined the rule for changing sign-in methods, and it now applies to every session. Adding or removing a passkey, or making new recovery codes, needs a passkey tap within the last five minutes; a passkey sign-in counts as one. A fallback session can therefore change them only after tapping a passkey the account already has. An account's first passkey can only come from a server-issued enrollment link. So can a replacement when every passkey is lost, which makes recovery from total loss need access to the host, not merely to the mailbox. The last passkey can't be removed. The draft's 24-hour window is dropped, since a session lasts at most 12 hours.

An emailed link opens a page with a button, and only the press, a POST, spends it, because mail scanners fetch the links in messages. Asking for a link says the same thing whether or not the address has an account. Five wrong recovery codes lock the account for fifteen minutes.

### A5. Admin work happens on its own origin

Admin work happens at `edit.parkscomputing.com`, a second hostname routed by the same cloudflared tunnel to the same container. The server tells the two origins apart by host.

- The admin session cookie is `__Host-`, HttpOnly, Secure and SameSite=Strict, and belongs to the edit origin alone. Script on a public page, whether an article's own, a comment's if one ever slipped through, or anything injected, never has the cookie sent with its requests.
- Every admin endpoint, script and page answers only on the edit origin. On the public origin those routes do not exist.
- The edit origin sends a strict Content-Security-Policy, with no inline script and scripts from its own origin only.

Cloudflare ends TLS, so the site sees each request arrive over plain HTTP from cloudflared. Requests for the edit host can only come through the tunnel, because the site's port is bound to loopback. The site therefore treats them as arriving at the configured origin's scheme, rather than trusting a forwarded header. The configured origin must be HTTPS. Plain HTTP is accepted only for a `localhost` test origin, where the cookies drop `__Host-` and Secure because browsers won't set them over HTTP. Passkey ceremonies are bound to the configured origin: its host is the relying party, and an assertion from any other origin, or from inside a frame, is refused.

### A6. Cloudflare Access in front of the edit origin, verified by the app

**Deferred (Paul, 2026-09-30).** The edit origin starts with the passkey session as its only lock, and Access is added later without changing anything else. When `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are empty, the app does not look for the Access header. When they are set, it requires the header on every edit-origin request. Until the admin features ship, the edit hostname serves nothing admin-related, so the route that already exists in the tunnel exposes nothing. The rest of this section describes the design for when Access goes in.

A Cloudflare Access policy on `edit.parkscomputing.com` admits only Paul's identity, so nobody else reaches the app's sign-in page at all. The app does not rely on that. It verifies the `Cf-Access-Jwt-Assertion` header on every edit-origin request, against the team's published signing keys and the application's audience tag, as Cloudflare documents. It still requires its own passkey session on top.

The container's published port is bound to `127.0.0.1`, so the only way in from outside the host is the tunnel. Today it is published on every interface (`0.0.0.0:80`). Anything that could reach that port could send `Host: edit.parkscomputing.com` and skip Access entirely, which is why the app checks the header and doesn't trust where a request came from. The local SQL Server container is published the same way (`0.0.0.0:1433`) and is bound to `127.0.0.1` in the same change.

### A7. The `/wwwroot` mount

Once signed in as admin on the edit origin, the terminal and Files show `/wwwroot`: the site's web root, the content volume, writable in full. Everything under it is fair game, scripts and stylesheets included. They also show `/home`, described in A10, beside it.

**Two separate users (Paul, 2026-09-30).** An account on the public site and the root account on the edit origin are different users. Someone signed in on the public site, for comments, is a user like any other, with the public sandbox's browser-kept `~`. Root access exists only on the edit origin, and it is what creates and edits pages and, later, moderates comments. The two share nothing, including their home directories.

**What the edit origin's filesystem shows.** It shows the same root as the public sandbox, with `/site` read-only as the navigation describes it and `/bin` listing the terminal's commands. Beside them are the two server directories, `/wwwroot` and `/home`, and `~` is the admin's own directory under `/home` (`files-editor-design.md` has the root). Opening a read-only site page in the Editor offers **Edit the source**, which opens its file under `/wwwroot/content`. Applets other than the terminal, Files and the Editor open on the public site, in a new tab.

**How the listing loads.** The web root holds about 2,700 files in about 200 folders, so the mount loads its whole listing when it opens. Resolving a path stays instant, and only reading, writing, moving and deleting wait for the server. Those operations become asynchronous in `js/sitefs.js` for every tree, which the terminal, Files and the Editor follow.

- **Without admin, there is no mount at all.** It isn't hidden or refused; it doesn't exist. The public origin has no mount endpoints. The edit origin serves the mount's script only to an admin session and answers 404, never 403, to anyone else. The terminal's `mount` command and Files' mounted root come from that script, so a non-admin has nothing to type and nothing to press.
- **The filesystem API** lists, reads, writes, moves and deletes. Every path is canonicalised and must stay inside the web root, the same check `/src` gained on 2026-09-29. Files may be text or binary, up to 10 MB each. The Editor edits text, and Files uploads and downloads anything. Nothing outside the web root can be read, which keeps configuration, secrets and customer data out of reach.
- **A safety net.** Before a file is overwritten or deleted, the server keeps its previous version in a history folder outside the web root for 30 days. Files and the terminal can restore from it. OneDrive's own version history remains a second net.
- **Fresh assets.** A write through the mount clears the server's cached asset-version stamps, so a changed script or stylesheet reaches readers without a container restart.
- **An audit log** records every write, move and delete, with the account, the path, the time and the file's new hash.

### A10. `/home`: the root's own directories on the server

`/home` is a real directory on the server, a sibling of the web root, holding one directory for each admin (Paul, 2026-09-30). On the host they are `parkscomputing.com/home` beside `parkscomputing.com/wwwroot`, mounted into the container at `/app/home`, so they're on OneDrive with its version history and off-site copy. An admin's directory is named from their account, `/home/paul` for Paul, and it is their `~` wherever they sign in: a toolbox of scripts, notes and drafts that follows them from device to device. The same API serves it as serves `/wwwroot`, with the same checks, history and audit. Nothing under `/home` is ever served to the public; it is outside the web root.

### A11. Preview before publishing

A file under `/wwwroot` is live when it is saved, since the site reads its pages from their files on every request. To see a change before it goes live, the Editor has **Preview** for an article's source (a `.md` or `.html` file under `/wwwroot/content`). Preview sends the unsaved text to the server, which keeps it as a draft under a random 128-bit token for an hour. The Editor then shows `https://parkscomputing.com/preview/<token>` in a pane beside the text, and pressing Preview again refreshes it. **Save** is the publish step.

The preview is rendered on the public origin, not the edit origin, deliberately. An article may bring its own scripts, and on the edit origin they would run with the admin session. On the public origin they run exactly as they will once published, where no admin session exists. The edit origin's Content-Security-Policy allows framing that one public path. The preview page is `noindex` and never cached, and a token names one draft and nothing else. Anyone holding the token can see that one unpublished draft for the hour, which also makes a preview link something Paul can share on purpose.

Paul's own workflow needs little of this (2026-09-30). He edits live, and for a big change he copies the page to an unpublished copy that `sitenav.xfer` doesn't link, and works there. So the admin desktop (A12) gets no Preview window of its own; the Editor's Preview stays as it is inside the Editor.

### A12. The admin desktop

Tabs don't work for the admin workspace (Paul, 2026-09-30). Each tab is its own page, so switching away from the terminal and back restarts it, and nothing can sit side by side. The edit origin instead gets one desktop page at `/admin`, where every tool is a window and keeps running until it is closed. It is a place for making and changing content, not for reading it.

- **Windows.** The desktop uses PUDL's window manager, the one behind the public site's Window view, with the same behavior: a new window opens maximized, and a window can be restored to floating, snapped, minimized and closed. The window layout lives in the address, so a reload or a bookmark brings the same desktop back. A reload does restart the terminals, and each comes back in its own folder with its own history. Tiling is left out; more snap targets come instead (A13).
- **The sidebar is the file browser.** It is the shared tree from `js/filebrowser.js` (filled by `js/admin-desktop.js`), files included, over `~`, `/home` and `/wwwroot`, and it resizes as the public sidebar does. A click on a text file opens it in the Editor; a page, a picture or a link opens on the public site in a new tab. A menu on each entry, by right-click, the context-menu key or Shift+F10, opens a terminal in that folder, shows it in Files, or opens the entry on the public site. It reaches the tools through PUDL's requests (open, browse and shell), so it names no tool. The Editor's own Explorer pane stays available but starts hidden on the desktop, which says so with `<meta name="pc-file-sidebar">`.
- **The window bar sits in the top bar.** The desktop first had a taskbar along the bottom with a Start menu. Once the public site's logo became a menu at the top left, Paul moved everything up (2026-09-30): the logo menu, "Parks Computing Admin", replaced Start (A15), and beside it are the open windows, as PUDL's dock shows them, then minimize or restore all, and close all. The Barcode Tool isn't on the desktop yet; adding it needs its help text changed, since on the edit origin `~` is on the server rather than in the browser.
- **The windows come from templates in the page.** Each tool's window is a `<template>` rendered with the public site's `_Window` partial, and the layer's `data-win-src="#win-{key}"` makes PUDL copy it, numbering further terminals itself. The desktop needs no window endpoint on the server.
- **The top bar** has the logo menu at the left and, at the far right after a rule, the admin's name as a label. A session opened by an emailed link or a recovery code says so beside the name, where it is always seen. What the name's menu used to hold (the account, and signing out) is in the logo menu now. The account page is at `/admin/account`, and opens in a new tab from the desktop so the desktop stays as it is.
- **On a phone** the desktop works, though it is a poor fit, for urgent edits and comment moderation. PUDL's master-detail layout shows the tree or the windows, one at a time, with a back link from the windows to the tree.
- **Each tool keeps a page of its own** at `/admin/terminal`, `/admin/files` and `/admin/editor`, for a link or a browser tab, and a window's "open as a page" button leads there.
- **Shared with the public site.** Both sites render the same window bar (`Pages/Shared/_WindowBar.cshtml`, with `WindowBarModel`), styled in `css/window-bar.css`, and close-all and "New terminal" run in `js/window-bar.js`, all with no admin knowledge in them. Applet continuity, the tools' kept state, moved out of `js/site.js` into `js/continuity.js`, which both sites load.

### A14. Settings, and timeouts each admin sets

The desktop has a Settings window, opened from the logo menu like any tool, not a modal dialog, so it can stay open beside the tools (Paul, 2026-09-30). It holds only what belongs to the desktop: whether new windows open floating (the default) or maximized, the theme, the background, and the file tree's options. It keeps them in `~/.config/desktop.json`, which on the edit origin is on the server, so they follow the admin from device to device. Each tool keeps its own settings, behind its own controls, in its own file (`files-editor-design.md`), so Settings doesn't grow with every new tool.

- **The background** is a colour or a picture, which the desktop shows behind its windows. A picture in `~` is used where it is, and one from the computer is copied into `~/.config` first. It is read through the mount and shown from a `blob:` address, so the edit origin's CSP allows `blob:` images.
- **The timeouts are the admin's own, within bounds only the server's configuration can move.** They are the idle limit, the absolute limit, and the two passkey re-confirmation windows (A8). The configured values are each admin's defaults, and `Admin:IdleMinutesMin`, `Admin:IdleMinutesMax` and their siblings bound them. They are stored as claims on the Identity user, so no migration was needed, and cached for a minute.
- **Shortening is always allowed. Lengthening needs a session begun with a passkey, and a passkey tap within the confirmation window.** A session from an emailed link or a recovery code can only shorten. Every change goes to the audit log and is emailed to the admin, as a sign-in is.
- **How they apply.** The session cookie now lasts as long as the longest idle limit allowed. Each session carries a random id, `pc_session`, and the server keeps its last request time in memory, ending the session when it has been idle longer than its admin allows. This rests on the documented cookie validation event, not on how the cookie handler slides its own expiry. A session from before this change has no id, so it ends once and signs in again. After a restart the server has no last-seen times, so each session's idle clock starts again, still bounded by the cookie's own expiry.
- **What stays in the browser.** Only each terminal's last folder, which belongs to that window on that device, and a copy of the theme, so the page paints in the right theme before the settings file loads. The terminal's history moved to `~/.history`. The edit origin has no "Forget this browser's data"; signing out clears its browser storage instead, so a borrowed computer keeps nothing behind.

### A15. `/etc` and the admin menu

The admin site's logo menu is configurable in the same way as the public site's (Paul, 2026-09-30). It is written in the shape of the `menu` array in `sitenav.xfer`, in `/etc/admin-menu.xfer`, which every admin shares. An admin who wants a different menu puts a whole one in `~/.config/admin-menu.xfer`, which replaces the shared one for that admin; there is no merging, so what an admin sees is always one file they can read.

- **`/etc` is a new root on the admin mount**, beside `/wwwroot` and `/home`, for the edit origin's own configuration. It is a volume of its own (`/app/etc`, from `parkscomputing.com/etc` beside the web root), never served to the public, and the server seeds it with the default menu the first time it is listed. A change to anything in it needs a recent passkey tap, as a change to the site's scripts and styles does, and keeps history and the audit log.
- **An entry naming only a slug takes the rest from the admin site's own list**: `terminal` (a new one each time), `editor`, `files`, `settings`, `account`, `site` (the public site, in a new tab) and `signout`. Its title, description and icon can be overridden. An entry with a `url` is a link, in a new tab when it leads off the site, and an entry with a `nav` is a labelled group.
- **A mistake can't lock the admin out.** A file that doesn't parse is logged and skipped, so the menu falls back to `/etc`'s, then to the built-in default. The menu is read on each page, so an edit shows on the next one.
- **Off the desktop** the tools in the menu link to their own pages, and a first row leads back to the desktop.

### A16. SSH from the web terminal

The desktop is ephemeral: a reload ends every terminal. Paul weighed a server-side job runner, a real shell in a locked-down container, and chose SSH from the web terminal instead (2026-09-30). It reaches any machine he allows, the server included, and it exposes less. It was built on 2026-10-01.

- **The SSH client runs in the browser.** The site only relays encrypted bytes over a WebSocket to a destination on a list in the server's configuration. It never sees keystrokes or keys, so a stolen admin session is not enough on its own, because the far end's SSH login still stands.
- **Borrowed, not written.** The client is Go's `golang.org/x/crypto/ssh` (BSD-3) compiled to WebAssembly, over `coder/websocket` (ISC), which wraps the browser's WebSocket as a Go connection. Both are documented for this use. The source is `Application/ssh-wasm/`, about 300 lines of glue. The Docker build compiles it with a pinned Go toolchain (`golang:1.26.8`), with the modules pinned by `go.sum`, and takes Go's own `wasm_exec.js` from the same toolchain. The client is 6.8 MB, sent compressed as 1.9 MB, and it loads the first time `ssh` runs in a page. `c2FmZQ/sshterm` (MIT) builds the same stack and served as a reference.
- **The key is the browser's own.** `ssh-key` makes an Ed25519 key with WebCrypto as non-extractable, keeps it in IndexedDB, and shows the public half as the line for `~/.ssh/authorized_keys`. The Go client asks the page for each signature, so the private key can be used in that browser profile and never read, copied or sent. The first `ssh` makes the key if there is none and stops there, so the line can be added at the far end. `ssh-key --new` replaces it and `ssh-key --forget` removes it.
- **Destinations live in the server's own configuration**, `/app/config/ssh.json` (the `Admin:Ssh` section), from a read-only volume outside anything the admin mount shows, so nothing done through the site can point the relay somewhere new. Each destination has a name, host, port, usual login, and its pinned host keys. The browser's client offers only the pinned keys' algorithms and stops the handshake if the server presents any other key. An edit to the file applies without a restart.
- **Opening a connection takes two steps.** A POST for a ticket needs the antiforgery token and a passkey tap within the admin's confirmation window, the same rule as changing sign-in methods. The ticket is good once, for 30 seconds, for that session and destination. The WebSocket then opens with it, only from a page on the edit origin. The ticket exists because a browser's WebSocket carries no antiforgery header and tells the page nothing about why it was refused.
- **A relay lasts only as long as the session behind it.** Signing out ends the session's relays at once. Every 30 seconds the relay checks the session's absolute limit, its idle limit, and that the account is still an admin, so revoking an admin from the server's command line ends their relays within half a minute. Typing into a session counts as using it. One admin may have eight relays open.
- **Every connection is audited**, opened and closed, with the destination, the duration, the bytes each way and why it ended. Connections are not emailed, for the reason file changes aren't: sign-ins are emailed, and the far end keeps its own log.
- **Only the edit origin has any of it.** The client, its loader and the `ssh` and `ssh-key` commands are served from outside the web root, at `/admin/ssh/`, to a signed-in admin only; the public origin answers 404 for all of it, and its terminal has no `ssh` command. The edit origin's CSP gains `'wasm-unsafe-eval'`, which allows WebAssembly and not `eval`. Go's `wasm_exec.js` uses no `eval`, which was checked before building.
- **The terminal lends itself out.** A command run at the prompt may take the terminal over, getting every key (Ctrl+C included) and every resize until it gives it back. `ssh` is the first to use it; it lives in `wwwroot/js/terminal.js` as `io.takeOver`.
- **Persistence comes from the far end.** A session survives a reload by running `tmux` there and attaching again.
- **Rejected.** Microsoft's `dev-tunnels-ssh` runs in browsers but has no Ed25519 yet, and handing it a non-extractable key would lean on its undocumented internals. OpenSSH compiled to WebAssembly (`wassh`) reaches WebSockets only through Google's own relay protocols. Using a passkey as the SSH key rests on OpenSSH behavior found in its code but not in its documentation, so it is out under the rule against undocumented behavior.
- **Tested** by a browser suite against a disposable OpenSSH server on the Docker network. It covers the public origin having none of it, the key being non-extractable, a session end to end with its pty size and a resize, a wrongly pinned host key refused, another origin refused, a ticket used twice, signing out ending a session, and the audit log.

### A13. More snap targets, on both sites

PUDL windows can float, fill the layer, or snap to the left or right half. The desktop wants terminals and the Editor side by side in more shapes than that, so the site proposes more snap targets to PUDL in `pudl-proposal-snap-zones.md`, and both sites get them from PUDL rather than from site code.

### A8. A sliding scale for fresh sign-ins

Each action has a tier. When the last sign-in or passkey tap is older than the tier allows, the action first asks for a passkey tap.

| Action | Needs |
| --- | --- |
| Browse the mount and read files | an admin session |
| Save a file | an admin session active within the idle timeout |
| Delete, overwrite anything under `js/`, `css/` or `pudl/`, or change many files at once | a passkey tap within the last 15 minutes |
| Change sign-in methods, or add another admin | a passkey tap on the spot, every time |

The windows are settings, to be tuned with use.

### A9. Sessions, requests and notices

- An admin session times out after 30 minutes idle and ends after 12 hours whatever happens.
- Every write carries an antiforgery token.
- Sign-in endpoints are rate-limited per account and per client.
- Every admin sign-in, fallback sign-in and change of sign-in method is emailed to Paul through Resend. File changes go to the audit log instead (see step 5 below).
- While a session is elevated, the site shows it everywhere on the edit origin, in the way a root shell's prompt shows it. That state is a candidate for a PUDL proposal: a standard look for "you have elevated privileges".

## Phase 2: comments

This phase is designed once admin editing ships. It builds on the same identity and brings these commitments with it:

- Commenters sign in with an email link or a passkey, and get the Commenter role.
- Comments are written in a small Markdown subset and rendered to HTML through an allowlist sanitizer. No raw HTML is accepted.
- Every comment waits in a moderation queue for Paul's approval before it appears.
- Moderation happens on the edit origin, through the same sanitizer the public pages use, so a hostile comment can't reach the admin session while it's being read.
- The commenter session is a separate cookie on the public origin, and it carries no power beyond commenting.

## Pinned: git in the terminal

isomorphic-git is a JavaScript implementation of git, MIT-licensed, that runs in the browser against any filesystem that provides its small file API. It could give the terminal real `git init`, `add`, `commit`, `log`, `diff`, `branch`, `clone` and `push`.

- **Where the repositories would live.** A repository in `~` would live in the browser. One under the `/wwwroot` mount would live on the server, through the mount's API.
- **Talking to servers.** Cloning from or pushing to a server needs that server to allow cross-origin requests. GitHub doesn't, so it needs a small proxy, which isomorphic-git's project provides. The Gitea already running on the Docker host can be configured to allow them.

This is for soon after the mount ships, because the mount is what makes it worth having. SSH (A16) may make it unnecessary, since `git` would run on whatever machine the terminal reaches.


## Order of work

1. Upgrade the engine to .NET 10. Done 2026-09-30: the SDK and runtime images are 10.0, the framework-bound packages are on 10.0, `Program.cs` uses the generic host in place of the obsolete `WebHost`, and every browser suite passes.
2. Bind the site's and SQL Server's ports to `127.0.0.1`, which was done 2026-09-30 (the site answers through the tunnel and refuses a direct connection). Add the edit hostname to the tunnel's ingress and put Access in front of it, which is Paul's to do.
3. Remove the first attempt, and add Identity with passkeys, recovery codes, email links through Resend, and the Admin role granted from the server. Done 2026-09-30.
4. Add the edit origin's host routing, session cookie, CSP and antiforgery, and the sign-in pages and elevated state, read-only at first. Done 2026-09-30, without Access verification, which is deferred (A6). A browser suite drives every sign-in path through virtual passkey authenticators against a test copy with its own database. It covers enrollment, passkey sign-in, adding and removing passkeys, the confirmation rule, recovery codes, emailed links, antiforgery and revocation, 30 checks in all.
5. Build the mount, in these steps:
   1. Make the content volume writable, and mount `home` and `history` beside it.
   2. Add the filesystem API for `/wwwroot` and `/home`, with its path checks, history, audit log, asset-stamp clearing and the sliding scale.
   3. Make the asynchronous operations in `js/sitefs.js` work across the local and server trees.
   4. Put the admin workspace on the edit origin, with the account page, Files, Terminal and Editor.
   5. Add the Editor's Edit the source and View on the site.
   6. Add the Edit links on public pages.
   7. Add the preview (A11).

   Done 2026-09-30, all seven. Some choices were settled in the build:
   - The workspace is four tabs on the edit origin: Account, Files, Terminal and Editor. Each applet page names the mount in a meta tag, and `js/sitefs.js` loads `/wwwroot` and `/home` only there.
   - The terminal's prompt there is `<name>@edit.parkscomputing:<dir>#`.
   - Pages, and applets other than the three, open on the public site in a new tab.
   - Files uploads any file into a server directory, pictures included, and downloads server files byte for byte. `cp` copies server files byte for byte as well. A file that isn't text opens as the public site serves it instead of in the Editor.
   - A public page's Edit link goes to `/admin/source?slug=`, which opens the page's source in the Editor, after signing in if need be.
   - The file API has its own rate limit, 1,200 calls a minute per admin, because a `grep -r` over `/wwwroot` is many reads. Signed-in admins are exempt from the site-wide limit.
   - File changes are recorded in the audit log, not emailed; sign-ins are still emailed. An email for every delete or script edit would bury the notices that matter, so this narrows A9.
   - A browser suite drives the mount end to end on a test copy with its own web root, homes, history and database. It covers the terminal, Files, the Editor, preview and publish, the history, the audit log, the passkey tap before a fallback session deletes, a picture uploaded byte for byte, a stylesheet change reaching readers without a restart, and the Edit link.
6. The admin desktop (A12), with the snap proposal (A13) sent to PUDL alongside. The desktop was done 2026-09-30. A browser suite on a test copy covers the tree, Start and numbered terminals, a file opening in the Editor, a terminal surviving a switch to another window, the entry menu, the window-wide actions, a reload restoring the windows, the account page and signing out, and the phone layout.
7. SSH from the web terminal (A16), built 2026-10-01. Then git in the terminal, if SSH hasn't made it unnecessary.
8. Comments.

## What's needed from Paul

- A Resend API key, with the account kept active, and a sending domain verified on it.
- In the Cloudflare dashboard: the `edit.parkscomputing.com` route on the tunnel, an Access application for it with a policy admitting his identity, and that application's audience tag.
- Approval to change the compose file's port bindings.
