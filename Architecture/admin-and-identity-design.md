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

**What the edit origin's filesystem shows.** It shows the same tree as the public sandbox, with `/articles`, `/applets`, `/tags` and `/bin` read-only as the navigation describes them. Beside them are the two server directories, `/wwwroot` and `/home`, and `~` is the admin's own directory under `/home`. Opening a read-only site page in the Editor offers **Edit the source**, which opens its file under `/wwwroot/content`. Applets other than the terminal, Files and the Editor open on the public site, in a new tab.

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
- Every admin sign-in, fallback sign-in and tier-3 action is emailed to Paul through Resend.
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

This is for soon after the mount ships, because the mount is what makes it worth having.

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
6. Git in the terminal.
7. Comments.

## What's needed from Paul

- A Resend API key, with the account kept active, and a sending domain verified on it.
- In the Cloudflare dashboard: the `edit.parkscomputing.com` route on the tunnel, an Access application for it with a policy admitting his identity, and that application's audience tag.
- Approval to change the compose file's port bindings.
