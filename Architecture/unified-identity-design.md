# One site with accounts and administration

This design brings accounts, comments and administration into the parkscomputing.com workspace. On 2026-10-03 Paul expanded the first release to include public sign-up, a super-admin account, defined administrative rights, editing within the site and comments on articles that enable them. This supersedes the earlier invitation-only scope. The publishing and durable identity foundations are implemented locally. The combined release still requires account workflows, editor integration, comments, credential migration and verification.

The existing [admin design](admin-and-identity-design.md) remains the historical design record. This proposal supersedes its separate-origin, separate-account and later-comments workflow when implemented. Cross-project guidance remains in `C:\Users\paul\OneDrive\Documents\Architectural Principles.md`.

## Accepted workflow decisions, 2026-10-03

Paul approved the following defaults before implementation:

- Every comment requires moderation before publication, including comments submitted by staff.
- Editing uses separate Save draft, Preview and Publish actions. OneDrive and host-file changes require explicit import before publication, preserving revision history and content checks.
- Members sign in through email links, with optional passkeys. Staff privileges require passkey confirmation.
- Personal server storage is deferred beyond the initial release. Public Files continues to use browser-local storage.
- The new comments system starts with an empty history. Paul confirmed on 2026-10-03 that historical comments from the retired service do not need preservation or migration. This decision does not authorize deleting old data.

The numeric operating limits and retention periods below remain proposed defaults. The approval does not constitute deployment authorization or evidence that the release gates have passed.

The [migration inventory](unified-identity-inventory.md) records the live account/content baseline, verified access inconsistencies and initial implementation work. The combined account, publishing and comments release remains incomplete.

## Durable session and link implementation, 2026-10-03

Session lifetime and elevation now use SQL records rather than cookie timestamps or process-local activity. Each record binds a random session ID to an account and its current Identity security stamp, with start, activity, passkey-confirmation and revocation times. Every authenticated request checks the record and the current account's verification and lockout status. A conditional activity update cannot revive a revoked or expired session; concurrent activity updates preserve the newest timestamp. SSH checks the same record without extending activity and terminates when validation fails. Explicit sign-out revokes the record before clearing the cookie. Session records missing at cutover fail closed, so existing sessions must sign in again.

Account links now retain only SHA-256 hashes of 256-bit random secrets, together with account, purpose, intended mailbox, security stamp, issuance, expiry, consumption and supersession times. Issuance supersedes outstanding links of the same purpose within a serializable SQL transaction. Retaining each hash also identifies a retry after a lost commit acknowledgment, preventing that retry from reviving a consumed link. Redemption uses a conditional update and succeeds for one caller. Account-changing workflows can perform redemption within their own transaction. Confirmation-page checks do not consume links. Delivery failure cancels only the undelivered token, leaving a newer issuance intact.

The existing edit-origin email sign-in uses this store locally. Legacy host-issued passkey enrollment still uses the old protected-token mechanism and must be replaced during credential migration. Public registration and member routes have not been activated. The main-origin relying party and cookies remain unchanged until the combined release gates pass.

The mailer never logs message text, provider response bodies or exception messages. ASP.NET hosting request diagnostics and model-binding diagnostics are filtered to Warning to suppress URL and bound-value logs that might contain link credentials. Reverse-proxy logging and any future analytics or diagnostic tracing require their own credential-redaction verification before release. These application filters do not establish that external systems redact tokens. [Microsoft documents logging categories and filters](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/logging/?view=aspnetcore-10.0). Conditional writes use [EF Core's documented affected-row contract](https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete).

## Account profile foundation, 2026-10-03

A separate account profile stores the public display name, a concurrency version and private suspension state. Its foreign key preserves the existing Identity account ID. Existing accounts without profiles remain eligible under their existing verification, lockout and role checks; migration does not derive a public name from an email address or assign new privileges. Registration will create profiles explicitly.

Suspension is checked independently of roles when starting or validating a session, issuing or consuming an email link, and reading private article source or writing articles. It also overrides SuperAdmin access. The profile schema and these checks are implemented locally. Member profile editing is exposed in the beta login trial; audited suspension/unsuspension operations are not yet exposed. Those operations must revoke existing sessions and links atomically, so lifting suspension cannot revive old access. Registration, verification and member settings are implemented in the isolated beta trial described below.

## Beta login trial, 2026-10-04

Paul has routed `beta.parkscomputing.com` to loopback port 8100 and authorized completing the login implementation for testing. `Accounts:Enabled` activates an account-only trial on the exact configured `Accounts:Origin`; it remains false on the public production site. In this mode the root directs to `/account`, and only account pages, their passkey API and the required PUDL assets are served. Legacy article, source, editor, filesystem and administrative routes answer 404. This lets account testing proceed without exposing authenticated users to unreviewed executable content. The combined site release still requires its publishing and trust gates.

The trial provides registration, mailbox verification, email-link sign-in, optional passkeys, display-name settings, session listing/revocation and POST sign-out. Identity assigns an opaque username and retains stable account IDs. Normalized email now has a database uniqueness constraint; migration refuses conflicting existing data rather than merging accounts. Registration creates an unverified account and profile without any role. Verification consumes its purpose-bound link, confirms the email, grants Member and creates its durable session within one SQL transaction. Duplicate registration preserves the original profile and cannot choose roles. Link replay cannot create another session.

Cookies are host-only and Secure on the beta HTTPS origin. The application cookie uses SameSite=Lax so an email link can arrive with the existing principal needed for antiforgery binding; mutations retain POST and antiforgery checks, and the antiforgery cookie remains Strict. Passkey registration/assertion uses the exact beta origin and RP host with required user verification and resident keys. Existing edit-origin credentials are not copied. Ordinary members may add passkeys after verified email sign-in. Staff credential changes require an existing passkey confirmation. Staff tools remain inaccessible in this login trial.

Email request budgets persist in SQL and currently allow five requests per address per UTC hour, thirty per client IP per UTC hour and five hundred site-wide per UTC day. Requests for unknown addresses also consume budgets and receive the same response. Delivery failure cancels the token. These beta limits are operating defaults, and the later full release still needs abuse challenges, expired-registration cleanup, email-change verification and audit-backed staff account administration.

Account controls follow the [PUDL reference](https://paulmooreparks.github.io/pudl/reference.html). Raised buttons, sunken inputs, section tabs, masked status glyphs and notices come from the vendored PUDL stylesheet; account CSS only arranges the page. The browser passkey flow follows [Microsoft's documented Identity ceremonies](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/passkeys/?view=aspnetcore-10.0).

## Beta super-user and account surfaces, 2026-10-04

Paul authorized super-user and article-editing tests on beta and selected `paul@parkscomputing.com`. He also required account management to be a PUDL applet that works in Windowed and Classic modes, with sign-up and sign-in presented as modal dialogs in either mode. This explicit account-dialog requirement takes precedence over the general architectural preference against modal pages. Direct sign-in/sign-up URLs render the same native PUDL dialog; enhanced links open it over the current view, preserve its URL and return focus on cancellation. Account settings use one server-rendered applet body in either host. Its registry entry lives in `js/applets.js`; applet initialization and teardown use PUDL's documented lifecycle. The existing `pc-view` preference determines the default host.

`Accounts:StaffEnabled` enables the beta revision workspace in addition to the account trial. `/admin` directs to `/admin/articles`; all legacy administrative filesystem, terminal and raw-content routes remain disabled. A staff reader can create an article, save immutable drafts, preview a saved revision, publish it or unpublish it. Forms enforce antiforgery checks, live roles and fresh passkey confirmation. Version preconditions reject stale writes, while operation receipts permit retries of the same write. Public `/articles/{id}` reads only the selected restricted publication. Draft previews also use restricted rendering, and trusted executable publication is not exposed by this beta interface.

The host-only `account-bootstrap <email> <display-name>` command authorizes the selected account for seven days, creating an unverified account/profile if needed and preserving an existing profile. It does not grant privileges or send email. Ordinary sign-in requests initiate mailbox verification. A pending authorization binds the account security stamp. Activation requires verified email, two passkeys and a new assertion by that account; one transaction grants Member, Admin and SuperAdmin, records activation and invalidates previous sessions and links. A new passkey-authenticated session carries the activated roles. Staff accounts must retain two passkeys when removing credentials. This command has no public equivalent, and there is no first-registrant bootstrap.

This beta provides account settings and revision editing. Staff role administration, audited suspension/recovery, moderation, richer editor integration and production content migration remain release work. The browser verification account is disabled after tests; its unpublished sample article and immutable audit records are retained in the isolated beta database.

## Beta site with accounts, 2026-10-04

Paul rejected the account-only beta, whose root went straight to a bare sign-in screen that followed neither PUDL nor the site. He wants to browse the site first, without signing in, then create the super-user, then have ordinary member sign-in working so comments can follow. This section supersedes the account-only gating described in the two sections above.

Beta is now the whole site with accounts added. Anyone can read it exactly as on the public host, in both views. The only private resources are the account pages under `/account` and the revision workspace under `/admin/articles`, which carry `no-store`, `no-referrer`, `nosniff` and a CSP that admits only the site's own scripts and the fonts and analytics the layout already loads. The old edit-origin workspace (files, terminal, editor, SSH) does not exist on this origin; its paths answer 404, as on the public host. Any page drawn for a signed-in reader is `no-store`, because it carries their name and commands. `Identity/EditOriginGate.cs` holds the rules.

Account commands live in the logo menu, after a separator, because PUDL's menu bar guidance (`docs/MENU-BARS.md`) puts account and sign-in commands in the site's identity menu, kept apart from navigation, and leaves out what the reader cannot do. A reader who is not signed in sees Sign in… and Create account…. A signed-in reader sees a heading with their display name, then Your account, Finish super-user setup while one is pending, Administration when their roles allow it, and Sign out, which submits a hidden POST form and returns them to the page they were on. `Identity/AccountMenu.cs` builds the entries for both the menu bar and the logo menu that shows without script.

Sign in and Create account stay modal dialogs in both views, as Paul required. From the menu, or any link marked `data-account-dialog`, the dialog opens over the page the reader is on and its form posts in place, so the address never changes. The dialogs' own addresses, `/account/signin` and `/account/register`, render the same dialog over the site's chrome, and Cancel or Escape goes back to the page named by `returnUrl`, which must be local and cannot be a sign-in page. The dialog follows PUDL: safe action first, committing action last, and a refused form comes back with a danger notice and the wrong field marked.

Your account is the Account applet in both views. The classic page `/account` renders it server-side; the window view's Account window is a site-served applet window (`ArticleContentService.AccountKey`), an empty mount that loads the reader's own fragment, so the window markup is the same for everyone. The fragment answers a reader who is not signed in with Sign in… and Create account… rather than a redirect. Changes made in the applet reload its body in place.

Super-user setup (`/account/superuser`) is a numbered checklist: confirm the email address, add two passkeys on two different devices, then Activate. Each step shows its state by glyph and word, the page explains which device pairs work and why a device that already holds a passkey refuses another, and it gives the authorization's expiry.

The super-user has the edit origin's server tools in the site itself, in both views. Paul asked for them on 2026-10-04 after finding the beta article workspace too thin, and made two decisions. First, `/wwwroot` on beta is the live tree, writable, so a save there changes parkscomputing.com exactly as the edit origin's does, with production's own `~`, `/etc`, file history and SSH destinations beside it. The root is a server setting, `Admin:SiteRoot`, which defaults to the web root the server serves; beta sets it because it serves a staged copy. Second, the boundary is passkey taps alone: the pages keep their third-party scripts (Plausible, Mermaid from its CDN, articles' inline scripts), while a change to the site's code or a destructive change needs a recent passkey confirmation and every SSH connection needs a tap, as on the edit origin. Any script on a page can act within a confirmation's window; Paul accepted that over an editing mode with a strict content policy. Only the SuperAdmin role gets these tools on the site with accounts (`AdminSessions.ServerRole`), where Admin alone edits articles. A super-user's pages carry the edit origin's mount and SSH settings, `js/accounts.js` supplies the `pcAdmin.confirm` hook the tools call, and `EditOriginGate` opens the file API, SSH and the editor's preview while the rest of the old workspace stays 404.

A page stays open longer than its session. When the session ends under it, the server tools' API answers a request without a valid session with 401 and `signin: true` (`Identity/ServerToolSignIn.cs`) rather than the 404 it gives anyone it won't serve, because a 404 read as "no such file" and closed the Editor's file pane. The tools' scripts (`js/sitefs.js`, the SSH client, the Editor's preview) answer it by calling `window.pcAdmin.signIn`, which `js/accounts.js` supplies. It shows one modal dialog however many requests found out, which signs in again with a passkey on the spot or picks up an email-link sign-in made in another tab when the reader presses Continue. The request then goes again, and nothing open on the page is lost. Cancelling leaves the request failed with "you're signed out". Antiforgery tokens belong to who the reader is, so the scripts read the token afresh for each request and `/api/account/token` hands out a new one around the sign-in. Paul asked for this on 2026-10-04 after the Editor's file pane snapped shut and a listed file reported "no such file" once his session had lapsed.

An article's Edit link shows only to a reader who may edit the site's files, the super-user here, and to nobody on a site without accounts, so production stops showing it to everyone (`Pages/Shared/_EditLink.cshtml`). Paul asked for this on 2026-10-04, calling the link shown to every reader a bug light for attackers. A reader who may not edit gets no link at all, not one that invites them to sign in. The link no longer leads to the edit origin's source view: it opens the article's source file in the Editor (a book chapter's own file included), beside whatever the Editor has open in the window view, and otherwise goes to the Editor's page with that file.

The account also has a place of its own at the far right of the top bar, after the view switcher, because Paul found the logo menu alone left him unable to tell whether he was signed in. It is a raised pill: Sign in, which opens the sign-in dialog, or the reader's profile picture, which opens Your account (the Account window in the window view, the page in the classic one). An account without a picture shows a generic head-and-shoulders placeholder, drawn inline in the text colour.

### Profile pictures

Each account may have one profile picture, which the Account applet sets and removes. It is public, since it will stand beside its owner's comments, and lives in the accounts database (`SiteAccountAvatars`), not in the web root, deleted with its account. The browser crops a chosen picture to its centre square and redraws it at 256 pixels as WebP, which drops its metadata, such as where a photo was taken. The server takes only a PNG, JPEG or WebP recognised by its own leading bytes, never by a name or claimed type, no larger than 200 KB, and caps the whole request just above that. It never decodes the image. `/avatars/{account id}?v={version}` serves it with the recognised type, `nosniff` and a `sandbox` policy, so a file that is not really a picture can do nothing as a page, and the versioned address is cached for good. `Identity/AccountAvatars.cs` and `Identity/AvatarController.cs` hold the rules, following [OWASP's file-upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

### Accounts on parkscomputing.com, step 1

Paul chose on 2026-10-05 to turn accounts on for production in two steps. The first, done that day, makes parkscomputing.com the one origin with public sign-up closed; the second opens sign-up together with comments, the privacy and community pages and abuse protection. With `Accounts:Registration` off, Create account appears nowhere and `/account/register` answers 404, while a request that would make an account is answered as for any unknown address, with nothing sent. www.parkscomputing.com redirects to the same path on parkscomputing.com (`Accounts:RedirectHosts`); the retired edit.parkscomputing.com redirects to the home page and drops its path and query, because old enrollment and sign-in links carry credentials (`Accounts:RetiredHosts`).

Paul's production account was the edit origin's Admin, with two passkeys made for edit.parkscomputing.com, which a browser will not use on parkscomputing.com, and a staff account may add a passkey only after a tap of one it already has. The operator's `account-bootstrap` command breaks that knot without a public route: `--replace-passkeys` removes the account's old passkeys and ends its sessions, the command gives an account from before profiles its display name, and while the setup it authorized is pending the account may add passkeys without that tap. The rehearsal on a throwaway instance set up as production would be passed every step, from the emailed link through two new passkeys to activation.

### Accounts on parkscomputing.com, step 2: comments and public sign-up

Paul started step 2 on 2026-10-05, keeping sign-up tied to comments, and asked that the privacy notice and terms of use fit Singapore, where he is based, as well as the GDPR. The work comes in this order, each part on beta before production: comments, then the gaps in sign-up itself, then the policy pages, then opening registration with comments on production.

Production still serves every article from its file in the live tree, and the article store's tables are empty there, so a comment cannot hang on a published article's ID yet. Each article with comments therefore gets a discussion, a row of its own (`SiteDiscussions`) with a stable ID and the article's slug, made when its first comment is submitted. Comments belong to the discussion, so when the article store becomes the source of articles the discussion gains the article's ID and nothing about a comment changes. A renamed article's discussion moves with an operator command until then.

The article's own metadata stays the one place its comment state is kept, since that is where Paul edits it: `commentsEnabled` and `commentsAllowed` in a Markdown article's front matter, and the `comments-enabled` and `comments-allowed` meta tags in an HTML one, mapped to Disabled, Closed or Open as the import already maps them. A book chapter, an applet page and anything without that metadata is Disabled. The server reads the state again when it accepts a submission, so an article closed after its composer opened refuses the comment.

The article's HTML stays the same for every reader. Under the article sits a mount for the `comments` applet and a plain link to the discussion's own page, `/comments/{slug}`, which the server renders in full, approved comments and, for a signed-in member, a form that posts without script. The discussion is not under `/page/{slug}/`, because that path belongs to the article route, which takes every path below it for a book's chapters, and a chapter called `comments` would collide. The applet, in both views, reads the discussion and the reader's own state from `/api/discussions/{slug}`: approved comments, the reader's pending and rejected ones, and the actions this reader may take on each. Each comment has its own address, `/comments/{slug}#c-{id}`, on the discussion's page. Moderators get a `moderation` applet, reached from the account's menu, holding the queue of pending revisions and of reports. A member's own comments, with their status, are in the Account applet.

Comments are Markdown with raw HTML off, rendered by Markdig and then cleaned by HtmlSanitizer to paragraphs, line breaks, emphasis, code, quotations, lists and links, which open without the opener and carry `rel="ugc nofollow"`. Images are text. The rendered HTML is never stored: the source is, with the sanitizer policy it was rendered under, so a change of policy re-renders every comment.

### Gaps closed before sign-up opens

- **Policy pages and consent.** `/privacy` and `/terms` are content files Paul edits, each with a `policy-version` in its front matter. Creating an account requires agreeing to the terms and acknowledging the privacy notice, and the account records which versions and when. A member whose accepted terms are older than the current ones is asked to accept them again before their next comment.
- **Deleting and exporting an account.** The Account applet downloads everything the site holds about the member as JSON, and deletes the account after an emailed confirmation link. Deletion removes the email address, passkeys, sessions, pins and picture, and withdraws the member's comments, leaving a placeholder where a reply depends on one. A staff account is deleted from the host, so the last super-admin cannot be removed from a browser.
- **Unverified sign-ups expire.** An account that never verified its email is removed seven days after it was made.
- **A challenge on sign-up.** Creating an account, and asking for a sign-in link, pass Cloudflare Turnstile, whose site key and secret come from configuration; without them the challenge is off, as on a developer's machine. The server checks each token with Cloudflare's documented `siteverify` call.

### Running beta

Beta's web root is staged by `Tools/beta-webroot.sh` from the live OneDrive tree, with the account assets and the pinned PUDL release from the checkout laid over it; content, images and audio are mounted read-only from OneDrive so articles stay current. `Tools/beta-run.sh` builds the image and replaces the container, reading its settings from the ignored `.local/beta/beta.env`. The live tree is never written.

## What exists already

The public and edit hosts use the same ASP.NET Core application and Identity database. `EditOriginGate` separates their routes, headers and assets. `Startup.Identity` already configures passkeys, protected cookies, antiforgery and persistent data-protection keys. `AdminSessions.MaySignInAsync` currently requires the Admin role, so ordinary members cannot yet sign in through that flow. Existing comment components and metadata remain, but their service calls the old comments API and the source includes compatibility stubs. They are migration inputs, not evidence of a working comments system.

The separation protects against a real problem. Articles can contain executable HTML, and `ArticleContentService` renders some of them in their own documents. Static files are served before authentication. Moving the existing admin cookie onto the public host without changing content handling would let article JavaScript make privileged requests through the reader's session. HttpOnly prevents JavaScript from reading a cookie; it does not prevent that script from making authenticated requests. [OWASP documents this distinction](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

The legacy session idle tracking lived in process memory and lost its last-activity record after a restart. The local durable-session implementation replaces it. The API caching middleware assumes content responses are public and varies on Authorization, which does not represent the proposed cookie-based personalization. Both need attention during this work.

## The user experience

Visitors read the site normally. Sign in and Create account appear in the existing Parks Computing menu and open URL-addressable account pages within the same site. Account settings and sign-out become available after authentication. The same account can read articles, comment and perform administration when it has permission. An article's comment composer offers sign-in or registration and returns the reader to that article afterward.

An administrator chooses Enable editing and confirms with a passkey. The existing workspace then offers Edit on the current article, server Files and the permitted administrative applets. Turning editing off removes those capabilities without signing the reader out. The UI clearly indicates when editing is enabled. Signing in preserves the current article and window layout through a validated local return URL; it must not discard unsaved edits.

Moderators enable staff access through the same elevation mechanism to use their queue. The interface names the active capability appropriately, while the server uses one elevation policy for staff operations. File mounts appear only when separately authorized; Admin article-editing permission does not imply unrestricted filesystem access.

Account pages and administrative resources have ordinary routes under `/account` and `/admin`. Their server representations advertise only permitted actions. Every endpoint independently checks authorization. Neither a hidden menu nor the `/admin` path is a security boundary.

## Public registration and recovery

The first release supports public registration with a verified email address and a public display name. An unverified registration has no commenting, upload or privileged access. Email addresses stay private; display names are escaped text, need not be unique, and cannot supply a staff badge. Stable account IDs determine ownership. Email verification proves mailbox control, not that the person is trustworthy. Follow the [OWASP email verification guidance](https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html).

Start with email-link sign-in for members and offer passkey enrollment after verification. This avoids making a device credential a prerequisite for posting a comment. Require an existing passkey for elevated staff actions and credential changes on privileged accounts. A member who has lost every passkey may recover through verified email; an account holding any staff role requires host-assisted credential reset when all passkeys are lost. Email recovery never grants staff elevation. Staff promotion requires two enrolled passkeys and a fresh passkey confirmation by the granting super-admin.

Verification and sign-in links expire after 15 minutes, are random and single-use, and are stored as hashes with their purpose and intended account. A GET displays a confirmation page; only a POST redeems the token atomically, so mail scanners cannot spend it. Keep tokens out of analytics, logs and referrers. Reissuing a link invalidates prior outstanding links for that purpose. Duplicate registration must neither overwrite an existing account nor disclose its existence in the response.

Apply per-address, per-account and per-IP limits plus a site-wide email budget. Verify the proxy trust configuration before relying on client IPs. Add an accessible challenge when abuse thresholds are crossed. Expire unverified registrations after seven days. Verify a changed email before switching it, notify the old address and revoke other sessions after sensitive account changes. Ordinary members can list and revoke their sessions. Recovery and credential endpoints use the same antiforgery and enumeration protections as sign-in.

## Roles, capabilities and super-admin bootstrap

Roles are bundles of explicit server capabilities. Membership is additive, but suspension overrides every role. Resource ownership and session elevation remain separate checks. Public registration can grant only Member, and request bodies can never select permissions.

| Capability | Member | Moderator | Admin | Super-admin |
|---|---|---|---|---|
| Manage own profile and credentials | Yes | Yes | Yes | Yes |
| Submit comments and manage own submissions | Yes | Yes | Yes | Yes |
| Moderate comments and reports | No | Yes | Yes | Yes |
| Create, edit and publish ordinary articles | No | No | Yes | Yes |
| Open, close or disable article comments | No | No | Yes | Yes |
| Suspend ordinary members | No | No | Yes | Yes |
| Grant or revoke Moderator and Admin | No | No | No | Yes |
| Manage staff accounts and site security settings | No | No | No | Yes |
| Publish trusted executable content or change applet code | No | No | No | Yes |
| Use authorized server configuration and SSH resources | No | No | No | Yes |
| Grant or revoke Super-admin | No | No | No | Host CLI only |

Moderator is a useful independent role for comment administration without article-editing power. Admin can suspend only accounts without staff roles. Super-admin cannot demote, disable or delete the last active super-admin through the browser. The CLI must also reject removal of the last active super-admin except through an explicit documented recovery procedure. Serialize role changes so concurrent requests cannot bypass that invariant. No role provides an ordinary UI for browsing another member's private files.

Create the first super-admin through a new host-only bootstrap command based on the existing enrollment mechanism. There is no default password, public setup route or first-registrant-wins behavior. The command binds enrollment to an operator-selected account and emits a single-use short-lived link to the main site. Complete enrollment and register two passkeys before activating privileged operations. Keep role activation and enrollment completion transactional. Host access remains the recovery authority.

Existing Admin accounts must be inventoried and explicitly mapped by the operator. Do not automatically convert every old Admin to Super-admin. Assign Paul's existing account explicitly, preserving its immutable ID and audit history. Ordinary Admin and Moderator grants can subsequently happen within the site after super-admin passkey confirmation; all changes are audited and invalidate affected elevated sessions.

## Trusted code and contributed content

The application shell, reviewed first-party applets and explicitly approved executable articles can run as trusted code on the main origin. Publishing or changing them requires the super-admin capability for trusted code. The consequence is explicit: such code can act through a signed-in browser session, and a vulnerable dependency can compromise that trust. This follows the CMS distinction between restricted content and privileged executable publishing described by [WordPress](https://make.wordpress.org/core/handbook/contribute/design-decisions/) and [Drupal](https://www.drupal.org/docs/user_guide/en/structure-text-formats.html).

Ordinary Admin publishing uses a sanitized Markdown or HTML format. Comments always use restricted Markdown with raw HTML disabled. Apply a maintained allowlist sanitizer after rendering, covering URLs, event handlers, SVG and styles as well as script tags. Use the same policy for full pages, fragments, previews and moderation views. Review existing executable articles before explicitly classifying them as trusted; a file extension or an author name is insufficient. Only Super-admin can change a content item's trust classification or edit a trusted executable item, including its referenced code assets. Imported material defaults to restricted content even when imported by a super-admin.

Untrusted executable previews and any future uploaded HTML previews must be isolated. Where scripts are required, use an HTTP CSP sandbox without `allow-same-origin`, with narrowly permitted resources and networking. Apply policy to direct document responses as well as frames. The [CSP sandbox documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox) defines that boundary. Do not weaken it to repair compatibility; a separate cookieless content origin is an alternative requiring review.

Only isolated frames need a message bridge in place of same-origin parent access. Limit it to window activation and validated article navigation, bind it to the mounted frame and validate message schemas. Expose no account, filesystem or publishing operations. Never accept the opaque `null` origin as an authentication credential or globally allowed CORS origin. Trusted applets can retain their existing integration.

Private files and unpublished content must live outside the public static-file tree and be returned only through authorized handlers. Remove raw serving paths that bypass content policy. Microsoft documents that [static files served before authorization are public](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/static-files?view=aspnetcore-10.0). Moving the rendered article alone would leave a bypass through its underlying file.

Deploy trusted shell assets separately from writable content. Review third-party scripts, inline initialization and applet loading before applying a restrictive shell CSP. A compromised dependency in the shell has the shell's authority. Full `/wwwroot` editing must not remain an ordinary article-publishing capability; any retained mechanism to deploy shell code requires explicit high-risk authorization and auditing.

## Sessions and request protection

Use one host-only `__Host-` Secure, HttpOnly session cookie, with Path `/` and no Domain attribute. Use SameSite=Lax for normal navigation from external links, together with antiforgery validation on every cookie-authenticated mutation. Do not put authentication tokens in localStorage. Pin the canonical HTTPS origin and passkey relying-party ID in configuration, and accept forwarded headers only from the configured proxy path.

Maintain durable server-side session records containing the account, session identifier, issue time, absolute expiry, activity time and revocation state. Bind admin elevation to that session and expire it separately. Proposed initial admin limits are 15 minutes of privileged inactivity and one hour absolute, with a fresh passkey confirmation within five minutes for credential changes, destructive operations and code deployment. Ordinary browsing and background polling must not keep elevation alive.

Rotate session identifiers on sign-in and privilege elevation. Check live session and role state on privileged requests, and fail closed if that check is unavailable. Sign-out, role revocation and account disablement revoke elevation and terminate affected SSH relays. Revalidate long-lived connections periodically with a documented maximum revocation delay. Keep the existing single-use SSH ticket and destination restrictions.

Use named authorization policies and resource ownership checks across HTML, JSON and filesystem endpoints. Validate antiforgery tokens for JSON as well as forms, reject untrusted request origins where appropriate, and retain canonical path and symlink checks. SameSite is an additional defense, as described by [OWASP's CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

Private pages, capability responses, account details and administrative fragments require `Cache-Control: no-store` before response headers are sent. Audit CDN rules and service workers as well as server middleware. Public content can stay cacheable only when its representation is identical for every reader. Supply personalized chrome separately or bypass shared caching for personalized responses; varying on Authorization alone is insufficient for cookies.

Record registration, authentication, recovery, elevation, permission changes, moderation and privileged writes with account and session identifiers. Exclude credentials, verification tokens and private document bodies. Retain the existing version history and verify restoration from backups of content, the Identity database and data-protection keys before cutover.

## Editing within the site

An authorized reader sees Edit on the article already open. The editor opens in the same PUDL workspace with a stable edit URL, loads the current source and identifies whether it is restricted content or trusted code. Staff sign-in and elevation return to that context. Draft source and preview routes require permission regardless of whether a caller uses the normal UI, a fragment endpoint or a raw URL.

Separate Save draft, Preview and Publish. Saving creates a revision without changing the published page. Publishing requires the current revision token, validates metadata and content policy, and atomically selects the published revision. A concurrent edit returns a conflict with both revisions available; it must not silently overwrite another author's work. Rollback publishes a previous revision as a new auditable change. Unpublishing hides the article and its comment resources from public readers while preserving records for staff.

Drafts and history live outside the public static tree. SQL Server holds stable article IDs, immutable revision source, comment policy, trust classification and publishing metadata. The 2026-10-03 implementation stores source in the database so revisions, the published selection, audit events and retry receipts commit in one transaction. This removes the need to coordinate a filesystem write with a database commit. Source size is initially bounded at 2 MB per revision. Moving payloads to another store later would require preserving the atomic publication contract.

The current direct-write filesystem publishing path must be routed through this service so it cannot bypass authorization, revisions or sanitization. Restrict host/OneDrive edits to an explicit import workflow once revision publishing is authoritative. Imports create restricted drafts and preserve the current publication. An import into an existing trusted executable article requires explicitly changing its classification to Restricted first. A changed alternate source creates a revision that preserves newer manual edits to the active draft, and alternate source text is retained in immutable revision history.

Display comment policy in article settings. Store its canonical value against the stable article ID and use it in every representation. Slug changes preserve that ID and redirect old article and comment URLs. Copies receive a new ID and no inherited discussion. Never allow ordinary publishing to change an item's trusted-code classification through front matter or an uploaded manifest.

## Article comments

Comments are part of the initial public-account release. They use the same Identity users and application database; the retired external comment service and compatibility stubs are replaced. The new system starts with an empty discussion history, as Paul confirmed on 2026-10-03. Historical comment import and author mapping are outside this release's scope. Do not revive the previous authentication or bearer-token endpoints.

### Article policy and presentation

Each article has one of three comment states:

| State | Public behavior |
|---|---|
| Disabled | No comment list or composer is shown; records remain available to authorized staff. |
| Open | Approved comments are visible and verified, unsuspended members can submit. |
| Closed | Approved comments remain visible, with a message that new submissions are closed. |

Import the existing metadata deterministically: `comments-enabled=false` means Disabled; enabled with `comments-allowed=false` means Closed; both true means Open. Missing metadata defaults to Disabled. Do not enable comments globally as a side effect of migration. Enforce the article's current policy and published state again when accepting a submission, including when it changed after the composer opened.

Show the same discussion in Windowed and Classic modes, with stable comment permalinks under the article URL. Start with a paginated chronological list and one level of replies. Replies reference a visible parent on the same article; enforce that constraint on the server. A removed parent becomes a tombstone so existing approved replies retain their context. Account display names are escaped, emails are never exposed, and a staff badge comes from server data rather than a user-editable name.

### Moderation and author actions

Keep the earlier design's default that every submission requires approval, including submissions by staff. Proposed initial limits are 10,000 characters per comment, five submissions per ten minutes per account and twenty pending submissions per account. Apply aggregate IP and site limits as well, accounting for shared networks. These are configurable operating defaults, not evidence that abuse prevention is complete. Comments support basic Markdown links and code, with no raw HTML, attachments, remote images or link-preview fetching. Mark contributed links `ugc nofollow` and prevent opener access when opening new tabs.

| Action | Result |
|---|---|
| Submit | A pending revision is visible to its author and moderators only. |
| Approve | A moderator publishes that exact reviewed revision using a concurrency token. |
| Edit pending submission | The author replaces the pending revision; any stale approval attempt fails. |
| Edit approved comment | A new pending revision is created while the approved revision remains public. |
| Reject or mark spam | The candidate revision is withheld; an existing approved revision is unchanged unless explicitly removed. |
| Withdraw own comment | Public text disappears immediately, pending revisions are canceled and replies retain a tombstone. |
| Remove published comment | A moderator hides the public revision and records a reason. |

Moderators can approve, reject, mark spam or remove text, but cannot silently rewrite another person's words. Show authors their own pending and rejected status in an authenticated view without leaking those records through public lists, counts, search, feeds or caches. Closed articles reject new replies and edits that need approval, while authors can still withdraw existing comments. Disabled articles expose author management through account history rather than the public article.

Verified members can report an approved comment. Deduplicate reports by account and comment, rate-limit them, and show the queue to moderators. Reports do not automatically remove content. An Admin can suspend an ordinary account, stopping new submissions and revoking sessions; existing approved comments require a separate moderation decision. This keeps an account action from silently rewriting discussions.

### Storage and consistency

Store comments with stable ID, article ID, author ID, optional parent ID, creation time, published revision ID and lifecycle state. Store immutable revisions with source Markdown, sanitizer version and timestamps. Moderation actions refer to an exact revision and record actor, decision, reason and time. Use row versions or equivalent optimistic concurrency for edits and decisions, plus foreign keys and checks for ownership and parent/article consistency.

Creation accepts an account-bound idempotency key so retrying a successful POST cannot duplicate a comment. Return a stable resource URL and the caller's permitted next actions. Public reads include approved revisions only; private status and moderation queues are separate authorized representations. Invalidate affected public discussion caches after approval, removal, article-policy changes or unpublishing. Sanitize stored source on rendering or rebuild sanitized projections when sanitizer policy changes; never trust old cached HTML indefinitely.

The first release sends verification and security emails but no automatic comment-subscription emails. Subscription notifications require explicit opt-in and unsubscribe handling and can follow later. Pending counts and moderation queues are available in the main site's navigation.

## Account lifecycle and optional private storage

Provide account deletion and export of the member's profile and authored comments. Proposed deletion behavior removes credentials, sessions and private files, withdraws comment text and replaces attribution with a tombstone while preserving other authors' replies. Warn about that effect before confirmation. Retain minimized security and moderation records for a documented period, proposed at 90 days; retained records must not become a hidden indefinite copy of deleted comment text. Backups expire on a documented schedule, proposed at 30 days, and restoration must reapply deletion records before reopening service. Host-assisted intervention remains available for a compromised account.

Publish privacy and community-policy pages before opening registration. Explain public comment attribution, moderation, deletion, email use and any enabled private storage, and record the policy version accepted at sign-up. Operational access to server files must be disclosed even though other members and ordinary administrators cannot browse them through the application. These product defaults still require review against the site's actual operating obligations before launch.

## Files and browser state

Keep anonymous Files storage local to the browser. A signed-in account may receive a server home only when that feature is explicitly enabled, and its paths must resolve from the authenticated account rather than a caller-supplied user ID. Admin mounts are separately authorized resources advertised by the server.

Reserve a separate `UsePrivateStorage` capability and per-account quota now. Public sign-up alone does not allocate disk space. If enabled, start with a proposed 10 MB account quota, 1 MB file limit and 100-file limit, enforced atomically across concurrent uploads. Store blobs under generated IDs outside the webroot; user filenames are metadata. Limit request sizes, disallow execution and archive extraction, and require owner authorization on every list, read, write and delete. Serve downloads as attachments with safe content types and `nosniff`; previews must use restricted renderers or isolation. There is no public sharing or comment attachment feature in this release. These controls follow the [OWASP file-upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

Do not silently upload existing browser-local files after sign-in. Offer an explicit import if server homes are introduced, and update the privacy help at the same time. Separate cached state by account; signing out closes private handles, clears private response caches and removes privileged UI. Preserve unrelated guest files. Test signing into a second account in the same browser.

## Move existing credentials safely

Current passkeys are scoped to `edit.parkscomputing.com`. Changing configuration cannot turn those credentials into credentials for the parent site. Microsoft's [passkey documentation](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/passkeys/?view=aspnetcore-10.0) describes relying-party scope and explicit origin validation.

Keep the existing account IDs and database. Extend the host-issued enrollment mechanism to issue a short-lived, single-use bootstrap for an existing account at `parkscomputing.com`. Store credential RP provenance during the transition and keep old and new ceremonies explicitly separated. Require the exact public origin and reject cross-origin passkey ceremonies. Do not broaden validation to every subdomain or share domain cookies.

Verify new sign-in, two registered keys and recovery before disabling the old admin interface. Preserve the old credential records for a bounded rollback period. Retire the old host's privileged routes after acceptance; redirect safe navigation to the new routes without forwarding enrollment credentials. Keep a tested host-level recovery path throughout.

## Resource and data contract

Keep one application and Identity database. Add durable sessions and elevation, registration-token records, stable article identities and revisions, comment revisions and moderation records, reports and audit events. Optional storage adds owner-scoped file metadata and quota reservations. Schema changes need reversible deployment steps and backups; rolling back code must not discard newly registered accounts or comments.

Account routes live under `/account`; article editing lives alongside the article's resource routes; moderation and user administration have navigable routes under `/admin`. Article comments are a collection beneath a stable article resource. Provide HTML pages and appropriate JSON representations using the same authorization service. Creation returns a resource location; concurrent edits use revision preconditions. Unsafe operations use POST, PATCH or DELETE with antiforgery validation, never GET. Unauthorized access to private records must not disclose their existence. Links and forms advertise only actions available to that caller and resource state.

## Implementation order and release gates

1. Inventory accounts, executable content, article metadata and raw file routes. Establish stable article IDs, trust classification, protected draft storage and the permission matrix. Historical comment migration is excluded by the accepted empty-history decision.
2. Implement super-admin bootstrap, public verification and sign-in, durable sessions and role management. Keep public registration disabled operationally until the combined release passes its gates.
3. Integrate revision-based editing, publishing, article comment policy and capability-driven applets in the main workspace.
4. Implement comment submission, author history, moderation, reporting and abuse controls against the same identity and article resources.
5. Enroll public-origin staff passkeys, test backup restoration and rollback, retire the separate admin workspace and enable public registration with comments. Private server storage can ship separately against the capability and ownership contract above.

Release tests must cover anonymous, unverified, verified member, moderator, admin, super-admin, expired, revoked and suspended sessions across every endpoint. Include last-super-admin races, forged role fields, staff recovery, duplicate verification redemption and replayed comment submissions. Browser tests must exercise hostile comment Markdown in the public view and moderation queue, trusted interactive articles, isolated previews, raw-document access, forged frame messages and CSRF attempts.

Test comment approval/edit races, cross-article replies, every article comment state, slug changes, unpublishing, tombstones and pending-text leakage through counts or caches. Test session expiry across restarts, cross-account browser caches, service workers, role revocation during SSH, path traversal, quota races if storage ships and draft access through static URLs. Verify mobile and desktop editing and comments against the same resource URLs. Exercise registration abuse limits and email failure without losing submissions or granting unverified access.

Public sign-up, super-admin bootstrap, administrative rights, in-site editing and article comments are required scope. Full moderation before publication, member email-link sign-in, explicit revision publishing and deferred personal storage were accepted on 2026-10-03. The proposed numeric limits and retention periods remain defaults for review. No invitation-only restriction remains in this design.

This proposal has been checked against the current source and the linked platform documentation. No authentication behavior has been changed or deployed, and these release gates have not yet been executed.

## Platform recommendation

Keep ASP.NET Core and .NET 10 for this work. The application already has Identity, passkeys, antiforgery, data protection, SQL migrations and server-rendered pages. Reusing those integrations leaves the implementation focused on content isolation, authorization and the user experience.

Go would align with other projects and could simplify the application's runtime packaging. It would also require replacing or integrating the current account lifecycle, credential storage, session protection, recovery and rendering behavior. The browser-origin problem remains regardless of the server language. There is no measured performance or operating-cost finding in this investigation that justifies that migration.

Reconsider Go after the unified account and publishing contract is stable, if a concrete maintenance or deployment objective warrants the cost. Compare that objective against a small representative implementation and the same security tests before choosing a rewrite. Keep authentication consolidation and a platform migration in separate releases.

