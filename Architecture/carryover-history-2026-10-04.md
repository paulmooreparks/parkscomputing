# Historical carryover entries

These entries preserve earlier session notes. They contain superseded deployment paths and status. Use the repository CARRYOVER.md for the current handoff.

# Beta super-user, editing and PUDL account surfaces, 2026-10-04

Paul requested super-user testing and selected `paul@parkscomputing.com`. The host-only `account-bootstrap paul@parkscomputing.com "Paul Parks"` command has authorized that beta account for seven days. It currently has unverified email, no passkeys and no privileges. Paul should use `https://beta.parkscomputing.com/account/signin`, confirm the emailed link, add two passkeys in Your account, then activate at `/account/superuser`. The command did not send email. Never use `paul@smartsam.com` for this setup.

Paul explicitly required account management to be a PUDL applet in Windowed and Classic modes, and sign-up/sign-in to be modal dialogs in both modes. These are implemented. The Account applet is registered in `wwwroot/js/applets.js`; `account.js` uses the documented init/destroy lifecycle and loads server-rendered account fragments for empty mounts. The beta layout hosts the same body as a PUDL window or Classic page. Native PUDL dialogs retain direct URLs, trap focus, close on Escape and restore the opener when enhanced links open them. Cancel appears before the committing action. The existing `pc-view` cookie preserves mode. The design captures this explicit modal requirement as an override of the general architectural preference.

`Accounts:StaffEnabled=true` enables the revision-backed beta workspace at `/admin/articles`, with `/admin` directing there. Super-user activation requires verified email, two passkeys and a new assertion by the same account. One serializable transaction records activation, grants Member/Admin/SuperAdmin and invalidates previous sessions and links; the controller issues a new passkey session. Staff credential removal retains at least two keys. No browser bootstrap or first-registrant grant exists.

The workspace supports article creation, immutable draft saving, sanitized saved-revision preview, explicit publish/unpublish and a restricted public reader at `/articles/{id}`. Staff operations require live roles and fresh passkey confirmation; forms enforce antiforgery. Version checks reject stale changes, while receipts permit retrying the same operation. Legacy raw files, filesystem tools, terminal and old administrative endpoints remain disabled. Staff administration, recovery/suspension operations, moderation, richer editor integration and full production content migration remain work.

The expanded SQL/HTTP test passed host authorization, verification/two-key activation requirements, session invalidation, member rejection, missing-antiforgery rejection, draft creation, stale edits, publish/unpublish and unpublished-reader 404. The 76 ordinary tests passed; one import test lacked its explicit fixture and was skipped. Build/publish succeeded with the existing advisory/nullable warnings. Browser tests exercised both applet hosts, two virtual authenticators, activation, save/preview/publish/unpublish, sanitized anonymous reading, modal form ownership, focus restoration and phone overflow. Final window maximize/close/reopen worked. PUDL glyph masks require `img-src data:`, which is now included in the strict beta CSP. Cloudflare-injected telemetry/challenge scripts are blocked by that CSP; application scripts remain local.

The synthetic browser account is now suspended and locked, its roles and passkeys are removed, and its sessions/links are invalidated. Its unpublished Browser verification article and immutable audit records are retained in the isolated beta database. Private fixture tokens/cookies and temporary SQL files were removed. No real email was sent by automation.

The persistent test container now uses `/work/publish-staff-beta-final`, and `ASPNETCORE_WEBROOT` points to its matching `wwwroot`. Ignored `.local/unified-identity/test-instance.json` records this path and private connection details. Always stage a new publish directory and update both working directory and web root before replacing the test container. Production application, database and accounts were not changed. The earlier account-only entries below are historical and are superseded by this update.

# Beta login is ready for testing, 2026-10-04

Paul routed `beta.parkscomputing.com` to port 8100 and authorized completing the login trial. Start at `https://beta.parkscomputing.com/account/register` to create a beta account, or `/account/signin` to sign in. The beta uses a separate database, so the existing production account and edit-origin passkeys are not copied. Email is enabled with the existing sender configuration. Provider delivery to a real inbox has not been exercised by automation; Paul can test that through registration.

The trial implements email verification, email-link sign-in, optional passkey enrollment/sign-in/removal, display-name editing, session listing/revocation and POST sign-out. Registration grants no role until mailbox verification atomically grants Member and starts a durable session. Links expire after 15 minutes and redeem once. Duplicate registration preserves the existing profile. Persistent email budgets and a unique normalized-email constraint are installed in the preview database.

Account pages follow the PUDL reference that Paul supplied. They use its fields, required markers, section tabs, buttons, notices and validation glyphs. Browser testing on the served beta passed email-link confirmation, virtual-authenticator passkey enrollment/sign-in/removal, sign-out and desktop/mobile overflow checks. A browser defect revealed that passkey requests needed an explicit JSON Accept header because the application also returns Xfer. That is fixed, and throttled requests now have readable errors. The synthetic browser account and its credentials/session/link records were removed after testing.

All 80 C# tests passed during implementation. The member HTTP integration test passed again against the final compiled Razor changes. Build/publish succeeded; existing NuGet low-severity and nullable warnings remain. Browser fixtures bypass email delivery and do not send mail to synthetic addresses.

The dedicated app container `parkscomputing-identity-test` binds `127.0.0.1:8100` and now runs `/work/publish-login-beta-final`, with its web root set to the matching published `wwwroot`. Its SQL container has no host port and retains the separate `parkscomputing_identity_preview` database. State and SQL data remain in their dedicated volumes. Ignored `.local/unified-identity/test-instance.json` contains private connection details and the current publish path. Never print or serve it. Stage a new publish directory before replacing the preview container, and update both its working directory and `ASPNETCORE_WEBROOT` together.

Only account pages, their passkey API and required assets are exposed on beta; other routes return 404. The main production application and database were not migrated or restarted. The broader unified-site work still requires revision-backed readers, the editor, comments, staff bootstrap/administration and content trust review. Do not treat this account trial as authorization for production cutover. The design records the scope and remaining release gates. Earlier entries below are historical and are superseded by this update where they describe the preview.

# Session carryover, 2026-10-03

Paul originally requested this carryover because new prompts in the previous session appeared queued after the agent had finished. That UI problem has not been diagnosed. A fresh session resumed the work and recorded the following update.

## Local test instance, 2026-10-03

Paul requested a localhost test instance and instructed checking the cloudflared config at `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml`. Port 8100 was neither listening nor referenced by that config. A test app now binds only `127.0.0.1:8100`; no tunnel config was modified. Public preview is `http://127.0.0.1:8100/`, and the current separate-origin admin sign-in is `http://localhost:8100/admin/signin`. Both returned HTTP 200. Admin responses have no-store and no-referrer headers.

Containers `parkscomputing-identity-test` and `parkscomputing-identity-test-sql` share a dedicated `parkscomputing-identity-test` Docker network. SQL has no host port. It uses its own `parkscomputing_identity_preview` database and named data volume; the app uses its own state volume and the compiled `/work/publish-profiles` output mounted read-only from the build volume. Neither container uses live-site credentials, live data mounts or email configuration. Private connection details are in the ignored `.local/unified-identity/test-instance.json`. Do not print or serve that file.

The test instance has no staff account yet, and public account workflows are not implemented. Its local-only HTTP origins are temporary fixture configuration. It is a running preview of completed local work, not a release or a deployment to the public site. Keep it available for Paul's review. Avoid overwriting its mounted publish directory while it is running; stage future published builds separately and replace/restart only this test container.

## Account profile progress, 2026-10-03

Profile storage and suspension checks are now implemented locally in `Identity/AccountProfiles.cs` and its migration. Profiles retain the existing Identity account ID, a public display name, a concurrency version, creation time and private suspension state. Existing accounts without profiles keep their existing verification/lockout/role eligibility; no public display name is generated from their email, and no role is granted by migration.

Suspension overrides every role in session creation/validation/elevation, link issuance/validation/redemption, legacy admin sign-in eligibility and article source/write access. Tests include a suspended SuperAdmin. There is no public profile edit or suspension endpoint yet. Audited suspension operations must atomically revoke sessions and links before exposing those controls, so unsuspension cannot revive old access.

All 76 ordinary C# cases and three SQL cases passed, totaling 79. The staged publish at `/work/publish-profiles` succeeded. The localhost test container was refreshed to this build, its own database has the profile table, and public root/admin sign-in each returned HTTP 200. The persistent preview SQL and app containers remain available for Paul. Only test-instance migrations and restarts occurred; live application/database containers were unchanged. Registration and verification workflows remain the next implementation work.

## Latest identity progress, 2026-10-03

Durable sessions and single-use account links are now implemented locally. Read `Identity/DurableSessions.cs`, `Identity/AccountLinks.cs` and their migrations, alongside the new identity section of the unified design. Sessions persist their start/activity/elevation/revocation times and the account security stamp. Current verification, lockout and stamp are checked on every authenticated request. Missing old session records fail closed, so cutover requires another sign-in. Conditional activity updates preserve the newest timestamp and cannot revive expired or revoked records. Passkey confirmation reads the durable timestamp. Sign-out revokes the record before clearing the cookie. SSH validates the same records without extending idle activity and stops when validation fails, including database errors.

Email links retain hashes of 256-bit secrets and bind purpose, account, mailbox and security stamp. Issuance supersedes earlier links of that purpose within a serializable transaction. Each issued hash is retained so a retry after a lost commit acknowledgment cannot revive a consumed or superseded token. Redemption succeeds for one caller through a conditional update. The existing edit-origin email sign-in now uses these links, and delivery failure cancels only its own token. GET checks never consume links. Host-issued passkey enrollment still uses the old provider and must be replaced during credential migration.

The mailer no longer logs message bodies, provider response bodies or exception messages. Program filters hosting request and model-binding diagnostics to Warning. Reverse-proxy logging, analytics and any future diagnostic tracing still require credential-redaction verification before release. No external logging guarantee has been claimed.

All 74 ordinary C# cases and three isolated SQL cases passed, totaling 77. The SQL cases verify migrations and rollback/reapplication, concurrent issuance/redemption, durable activity/revocation, lockout, full live-tree import/replay and actual Razor HTTP sign-in/sign-out with antiforgery. The HTTP test also rejects replay of a revoked cookie and verifies failed mail delivery leaves no usable link. Build/publish succeeded. Existing NuGet and nullable warnings remain. No live migration, deployment, restart, role change, account enrollment or email sending occurred.

The disposable SQL fixture needed an 8 GB container limit, 4 GB MSSQL memory limit and two CPUs after startup failed at the smaller limit. This is test-environment history, not an application contract. Its container and anonymous volumes were removed, and `.local/unified-identity/session-sql-fixture.json` was deleted. The build and NuGet cache volumes remain. Source is mirrored in `/work` on `parkscomputing-identity-build`, with current published output in `/work/publish`.

Next implement generalized account profiles and suspension, public registration and verification, member sign-in/settings/session management, and staff capabilities/bootstrap. Public routes must stay disabled until revision-backed readers remove raw-file draft/source bypasses and the combined editor/comments/credential release passes its gates. The main-site relying party and cookies have not changed. Do not repeat approved workflow questions or deploy without authorization.

## Latest progress, 2026-10-03

The publishing foundation is now implemented locally. Its records, store, renderer and host import command live in `Application/parkscomputing-engine/Publishing`. The `ArticleRevisions` migration adds stable article IDs, immutable source revisions, publication selections, aliases, import records, audit events and retry receipts to the existing Identity database. Source payloads are stored in SQL Server so publication and its audit record commit in the same transaction. This choice is captured in the unified design.

The implementation supports draft save, publish, restore-and-publish, unpublish, rename, explicit trust changes and atomic batch import. An explicit version claim precedes revision insertion. Ordinary Admin can edit restricted source; SuperAdmin is required for trusted source or trust changes. SQL triggers and context checks protect immutable history. Restricted publication uses HtmlSanitizer 9.2.1039 with a narrow allowlist. The store is internal and its initial caller is the host import command; browser session elevation and CSRF enforcement remain work for the account/editor integration.

`article-import --plan <content-root>` is read-only and works without installing the new schema. `article-import --apply <plan.json> --actor <email>` verifies the source hashes, requires an existing eligible staff account and imports private restricted drafts without changing publication. The command never runs migrations. A changed import into trusted source requires an explicit change to Restricted first.

The live tree has been planned and imported only into a disposable SQL database. It yielded 158 article identities, one alternate source, five draft paths and three Open comment settings. The test left every article unpublished, preserved the alternate About source and replayed without duplicate revisions or audit records. The private live plan is `.local/unified-identity/article-import-plan-20261003.json`; it includes source text and must not be committed or served.

All 60 regular C# tests and two SQL integration tests passed. The latter verify a forced concurrent-editor race, SQL-level immutability, migration rollback/reapplication preserving the existing Identity fixture and full-tree import/replay through the host command. Build/publish also succeeded. No live migration, import, account-role change, deployment or restart occurred. Public/source/window readers still use legacy files, so the verified public draft exposure has not yet been closed on the live site.

The next implementation work is generalized accounts and durable sessions, followed by the main-site editor and revision-backed readers with removal of raw-file bypasses, then comments and credential migration. Do not repeat policy approval questions. The earlier inventory-only status below records previous progress and is superseded by this publishing update.

Paul answered Yes to the proposed defaults. Mandatory moderation for all comments, explicit Save draft/Preview/Publish with OneDrive import, member email-link sign-in, staff passkey confirmation and deferred personal server storage are now accepted. These decisions are recorded at the beginning of `Architecture/unified-identity-design.md`. Do not ask for this approval again.

The initial inventory and cache correction are implemented locally. Read `Architecture/unified-identity-inventory.md` for findings and scope. The full account, publishing and comments implementation is not complete, and nothing was deployed.

- A host-only `identity-inventory` command reads the configured database without migrating it or starting the web host. It was executed in an isolated container with the live configuration and read-only mounts. The database has Paul's one verified Admin account and two existing passkeys, with no local comment-named tables. The existing account ID must be preserved.
- `Tools/inventory-site-content.py` inventories file hashes, source-format comment metadata and candidates for executable-content review. Every trust classification remains Unreviewed. Its live-tree scan found 159 content files, 25 review candidates, five draft-path files and an `about.md`/`about.html` collision. The repository is missing 97 files from the live tree and differs at 18 shared paths.
- A live HEAD probe confirmed an existing draft is accessible through raw, source-view and rendered-page URLs. The content API returns 404 for the same draft. Protected revision storage must remove those bypasses before public-account cutover.
- Cache headers now use OnStarting, run before cookie/session/auth/rate-limit middleware and deny shared caching for account/admin resources and personalized content API responses. This correction is local only.
- All 33 C# tests passed with the .NET 10 Docker SDK, including 14 new cache tests. All six Python inventory tests passed. Existing NuGet low-severity advisories for NuGet.Packaging and NuGet.Protocol 6.12.1 and existing nullable warnings remain.

Full reports are in the ignored `.local/unified-identity` directory. The account report contains private account identifiers and must not be committed or published. Docker volumes `parkscomputing-identity-build` and `parkscomputing-identity-nuget` hold the isolated build and package cache. The installed local SDK is still .NET 8.

Paul answered No when asked whether historical comments from the retired external service must be preserved. The new comments system starts with an empty history. Historical comment inventory, import and author mapping are outside the release scope. This decision is recorded in the design and inventory; it does not authorize deleting old data. Do not ask this question again.

Stable article identities, revision storage and explicit import are now implemented locally as described above. No live schema, account role, passkey enrollment or public route has been activated. The rest of this carryover describes the earlier design context; the accepted defaults above supersede its former pending-policy language.

## Workspace and current task

The workspace is `C:\Users\paul\source\repos\paulmooreparks\parkscomputing`. Work is on Parks Computing. Earlier conversation messages switched between YAVCHN and Parks Computing; the current scope is Parks Computing only.

The current task is to design accounts, administration and comments together in the main site. Paul finds the separate `edit.parkscomputing.com` workspace unworkable. He initially selected invitation-only accounts, then explicitly replaced that decision with public sign-up in the first release because article comments are needed immediately.

Paul's required scope is:

- Creation of a super-admin user
- Public registration for comments and other member features
- Defined administrative rights
- Administrative content editing within the site
- Comments on articles that enable them

Personal server storage was suggested as a possible member feature. It is designed as optional and is not an agreed first-release deliverable. This session produced a design, not an implementation. No authentication or comments changes were deployed.

## Read these documents first

The current proposal is [Architecture/unified-identity-design.md](Architecture/unified-identity-design.md). It contains the combined design, permission matrix, registration and recovery flows, content trust boundaries, article revision workflow, comment lifecycle, optional storage, migration and release gates.

[Architecture/admin-and-identity-design.md](Architecture/admin-and-identity-design.md) records the previous design. Its new opening paragraph points to the unified proposal. Its separate-origin, separate-user and later-comments assumptions are historical and must not override the latest request.

Cross-project architecture guidance remains in `C:\Users\paul\OneDrive\Documents\Architectural Principles.md`. Paul prohibits em dashes in new output, code, comments and committed prose. Keep replies direct, distinguish proposals from accepted decisions and capture architectural changes in the design document.

## Proposed design and decisions still under review

The proposal retains ASP.NET Core on .NET 10 and the existing Identity database. A Go rewrite was considered and deferred because it would replace working identity integrations without solving the browser-origin security issue. Paul has not requested a rewrite.

The proposed role bundles are Member, Moderator, Admin and Super-admin. Members manage their accounts and submit comments. Moderators handle comments and reports. Admins also edit and publish ordinary articles and suspend ordinary members. Super-admins manage staff permissions, security settings and trusted executable publishing. The host CLI alone grants or revokes Super-admin. Ordinary Admin and Moderator grants can be made by a passkey-confirmed super-admin within the site. The last active super-admin is protected against concurrent removal.

The proposed member flow uses verified email and email-link sign-in, with optional passkeys. Staff operations require passkey-confirmed elevation. The bootstrap extends the existing host-issued enrollment mechanism, preserves Paul's account ID, and requires two passkeys before privileged operation. Existing Admin accounts must be explicitly mapped rather than all becoming super-admins automatically.

The initial recommendation required sandboxing all executable articles. After Paul asked how WordPress handles this, the agent corrected that overstatement. The current proposal permits reviewed applets and explicitly trusted executable articles on the main origin, restricted to super-admin publishing. Ordinary articles are sanitized; comments use restricted Markdown; untrusted executable previews are isolated. Same-origin trusted code can act through a signed-in session, and that is an explicit trust decision. Do not revive the universal-sandbox prerequisite.

The proposed article workflow separates Save draft, Preview and Publish, with stable article IDs, immutable revisions, concurrency checks, private draft storage and an atomic published-revision pointer. Direct file writes must not bypass publishing policy. The proposal would change the current OneDrive/direct-file workflow to an explicit import workflow; this is a material recommendation for Paul to review before implementation.

Comments have Disabled, Open and Closed article states. Every submission waits for moderation under the proposed initial policy, including staff submissions. Authors can edit pending text, submit revisions to approved comments, withdraw comments and report abuse. An approved revision remains public while its replacement awaits approval. Moderation targets an exact revision and cannot silently rewrite another author's words. The design includes one reply level, stable permalinks, pending-text privacy, idempotent creation and cache invalidation.

Approval of every comment, member email-link sign-in and deferral of personal server storage are now accepted. Rate and quota limits and retention periods remain proposed defaults. Public registration, super-admin support, defined rights, in-site editing and article comments are explicitly requested scope.

## Verified implementation findings

The public and edit hosts already share the same ASP.NET Core backend and Identity database. `Identity/EditOriginGate.cs` enforces the host split. `Startup.Identity.cs` configures passkeys, cookies, antiforgery and data-protection persistence. `Identity/AdminSessions.cs` currently requires the Admin role even for sign-in, so ordinary public members need a generalized flow.

Passkeys currently use the relying-party ID `edit.parkscomputing.com`. They cannot simply be relabeled for `parkscomputing.com`. The proposal includes main-origin enrollment, explicit origin validation, credential provenance during migration and bounded rollback. Do not share domain cookies or permit arbitrary subdomain origins to sidestep migration.

`Identity/SessionPolicy.cs` tracks idle activity in memory, which loses its record on restart. The proposal replaces this with durable session and elevation records. Privileged role changes and revocation must affect long-lived SSH connections as well as HTTP requests.

`Startup.cs` serves static files before authentication. Protecting an editor route does not protect its underlying raw files. Drafts and private storage need authorized serving outside the public static tree. `Api/CachingMiddleware.cs` assumes content responses are public and varies on Authorization, which is insufficient for cookie-personalized content.

`Pages/Services/ArticleContentService.cs` places executable HTML articles in their own documents. Existing trusted-frame integration calls the parent window. Only isolated untrusted frames need a restricted message bridge.

`Pages/page.cshtml.cs` parses `comments-enabled` and `comments-allowed` metadata. The design maps disabled to Disabled, enabled but disallowed to Closed, and both true to Open. Missing metadata stays Disabled. `Pages/Services/CommentService.cs` calls the retired external comments API, and `CommentStubs.cs` contains compatibility classes. These are not a functioning comment backend and must not be used as evidence that comments already work. Historical comment migration is excluded by Paul's empty-history decision.

Public Files uses browser localStorage. Authenticated administrative mounts are separate. Do not silently upload browser files when accounts or private storage are introduced. Update privacy help with any new server-storage behavior and separate state between accounts.

## Working tree and prior completed work

At original carryover creation, the working tree contained these design changes and this carryover. The latest progress section lists the additional implementation changes now present:

- Modified `Architecture/admin-and-identity-design.md`
- Untracked `Architecture/unified-identity-design.md`
- New `CARRYOVER.md`

The design documents are not committed. Formatting checks passed, including `git diff --check` and an explicit check for trailing whitespace and em dashes in the new proposal. No runtime tests were run for this design-only change.

The preceding cleanup task committed the accumulated implementation work locally:

- `aaded8e` Upgrade PUDL to 0.43.0 for standard menus and persistent sidebars
- `7025dcb` Adopt standard applet menus and track the live tool catalog
- `df47028` Integrate persistent sidebars and fix applet window behavior
- `848f3a7` Record the GitHub filesystem proposal and remove a broken documentation link

Those commits were not pushed in that task. Their work included a parser correction in `Identity/AdminMenu.cs` for nonempty menu slots and updated tests. All 19 C# tests passed using a .NET 10 Docker build. The installed local SDK was .NET 8 at that time; verify before using it. The parser correction was committed but was not newly deployed during that task.

Source assets and live assets are separate. The live content tree is `C:\Users\paul\OneDrive\Documents\parkscomputing.com\wwwroot`. The application runs in `parkscomputing-dev`. Do not claim a repository change is deployed without inspecting the actual served target. Do not deploy the account design merely because earlier UI tasks authorized deployment.

## Next steps

Continue the accepted implementation using the documented sequence: finish inventory and trust classification, establish protected revision storage, bootstrap and generalized accounts, unified revision-based editing, comments and moderation, then credential migration and combined release verification. Public registration should remain operationally disabled until that combined release passes its gates. Personal server storage is deferred.

The material policy defaults have been reviewed and accepted. Avoid repeating questions already answered about one workspace, public registration, comments in the initial release, moderation or explicit publishing. Do not treat the current design as deployed or independently security-tested.

The proposal links the primary documentation consulted, including Microsoft passkey and static-file guidance, WordPress and Drupal content trust models, and OWASP authentication, CSRF and file-upload guidance. Follow those documented contracts rather than relying on observed but undocumented behavior.

