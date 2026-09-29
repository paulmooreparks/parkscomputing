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

### A3. One identity system, with roles

ASP.NET Core Identity holds every account, in the SQL Server database the site already uses for auth. Accounts carry roles. **Admin** can never be granted by any path a browser can reach. It is assigned from the server side only, by a command run in the container or a seed read from its environment at startup. **Commenter**, in the comments phase, is what signing up gives.

### A4. Sign-in: passkeys, recovery codes and email

These are the ways an account can sign in, strongest first:

1. Passkeys. The admin account registers at least two, such as a phone and a hardware key.
2. Printed recovery codes, each usable once.
3. A sign-in link sent by email through Resend, valid for fifteen minutes and usable once.

SMS is not offered, because a SIM swap can hijack it. A session that began with a recovery code or an email link is a **fallback session**. For its first 24 hours it can do everything except change sign-in methods, and every fallback sign-in is emailed to the account's address.

### A5. Admin work happens on its own origin

Admin work happens at `edit.parkscomputing.com`, a second hostname routed by the same cloudflared tunnel to the same container. The server tells the two origins apart by host.

- The admin session cookie is `__Host-`, HttpOnly, Secure and SameSite=Strict, and belongs to the edit origin alone. Script on a public page, whether an article's own, a comment's if one ever slipped through, or anything injected, never has the cookie sent with its requests.
- Every admin endpoint, script and page answers only on the edit origin. On the public origin those routes do not exist.
- The edit origin sends a strict Content-Security-Policy, with no inline script and scripts from its own origin only.

### A6. Cloudflare Access in front of the edit origin, verified by the app

A Cloudflare Access policy on `edit.parkscomputing.com` admits only Paul's identity, so nobody else reaches the app's sign-in page at all. The app does not rely on that. It verifies the `Cf-Access-Jwt-Assertion` header on every edit-origin request, against the team's published signing keys and the application's audience tag, as Cloudflare documents. It still requires its own passkey session on top.

The container's published port is bound to `127.0.0.1`, so the only way in from outside the host is the tunnel. Today it is published on every interface (`0.0.0.0:80`). Anything that could reach that port could send `Host: edit.parkscomputing.com` and skip Access entirely, which is why the app checks the header and doesn't trust where a request came from. The local SQL Server container is published the same way (`0.0.0.0:1433`) and is bound to `127.0.0.1` in the same change.

### A7. The `/wwwroot` mount

Once signed in as admin on the edit origin, the terminal and Files show `/wwwroot`: the site's web root, the content volume, writable in full. Everything under it is fair game, scripts and stylesheets included.

- **Without admin, there is no mount at all.** It isn't hidden or refused; it doesn't exist. The public origin has no mount endpoints. The edit origin serves the mount's script only to an admin session and answers 404, never 403, to anyone else. The terminal's `mount` command and Files' mounted root come from that script, so a non-admin has nothing to type and nothing to press.
- **The filesystem API** lists, reads, writes, moves and deletes. Every path is canonicalised and must stay inside the web root, the same check `/src` gained on 2026-09-29. Files may be text or binary, up to 10 MB each. The Editor edits text, and Files uploads and downloads anything. Nothing outside the web root can be read, which keeps configuration, secrets and customer data out of reach.
- **A safety net.** Before a file is overwritten or deleted, the server keeps its previous version in a history folder outside the web root for 30 days. Files and the terminal can restore from it. OneDrive's own version history remains a second net.
- **Fresh assets.** A write through the mount clears the server's cached asset-version stamps, so a changed script or stylesheet reaches readers without a container restart.
- **An audit log** records every write, move and delete, with the account, the path, the time and the file's new hash.

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
3. Remove the first attempt, and add Identity with passkeys, recovery codes, email links through Resend, and the Admin role seeded from the server.
4. Add the edit origin's host routing, session cookie, Access verification, CSP and antiforgery, and the sign-in pages and elevated state, all read-only at first.
5. Build the mount: the filesystem API, history, audit log, asset-stamp clearing and the sliding scale, then the terminal's and Files' mounted root.
6. Git in the terminal.
7. Comments.

## What's needed from Paul

- A Resend API key, with the account kept active, and a sending domain verified on it.
- In the Cloudflare dashboard: the `edit.parkscomputing.com` route on the tunnel, an Access application for it with a policy admitting his identity, and that application's audience tag.
- Approval to change the compose file's port bindings.
