# Unified identity migration inventory

This inventory was taken on 2026-10-03 against the running `parkscomputing-dev` container, its configured Identity database and its mounted content tree. It supports the [unified identity design](unified-identity-design.md). It does not approve executable content or authorize cutover.

## Beta login trial, 2026-10-04

An isolated account trial is now served at `https://beta.parkscomputing.com`, backed by its own preview database. Registration, email verification/sign-in, optional passkeys and account settings are implemented. The subsequent beta update adds host-authorized super-user setup for `paul@parkscomputing.com`, revision editing and PUDL account applets/dialogs in both view modes. The beta has no copied production account or credentials. Its account pages use PUDL controls, and browser verification passed with a virtual authenticator and desktop/mobile layouts. Production inventory and credentials described below remain unchanged. The [design](unified-identity-design.md#beta-login-trial-2026-10-04) and repository carryover record the trial's scope and remaining release work.

## Accepted policy

Paul approved mandatory moderation for all comments, separate Save draft, Preview and Publish actions, explicit import of OneDrive changes, email-link sign-in for members, passkey confirmation for staff and deferral of personal server storage. These decisions are recorded in the design. Numeric quotas and retention periods still need operational review.

## Account migration

The database contains one verified, unlocked account in the existing Admin role, with two passkeys. The account is Paul's existing site account. Its immutable ID is present in the private inventory and must be preserved. No role was changed and no enrollment link was issued.

The configured passkey origin is `https://edit.parkscomputing.com`. Credential-specific origin provenance is not stored in the existing schema. The two existing credentials must not be counted toward the requirement for two credentials enrolled for the public origin. Migration must retain the existing credentials during the rollback interval and use explicit main-origin enrollment.

The configured Identity database has no base tables whose names contain `Comment`. This does not establish that historical comments never existed. The retired external service and other databases have not been inventoried. On 2026-10-03 Paul confirmed that historical comments need not be preserved. The new system will start with an empty history, so external comment inventory and import are outside the release scope. No old data has been deleted, and this decision does not authorize deletion.

## Content source and review

Docker mounts `C:\Users\paul\OneDrive\Documents\parkscomputing.com\wwwroot` at `/app/wwwroot`. The scan of its `content` directory found the following files and review candidates.

| Observation | Count |
|---|---:|
| Markdown, HTML and HTM files | 159 |
| Files with code, style or embedding review signals | 25 |
| Files under the drafts directory | 5 |
| Candidate Open comment policies | 3 |
| Candidate Disabled comment policies | 156 |
| Colliding extensionless paths | 1 |
| Unreadable or undecodable files | 0 |
| Skipped build or tool directories | 3 |

These are file counts, not a final article count. The tree contains fragments, book chapters and supporting documents. The scan deliberately leaves every trust classification as Unreviewed. Code examples can produce false positives; a lack of detected signals does not prove safety. Script imports, referenced assets and shell code require their own review.

The repository content directory contains 65 files of these types. Relative to that copy, the live tree has 97 additional files, the repository has three additional files and 18 shared paths have different bytes. Migration must inventory and import the live tree. A repository copy must not overwrite it.

Both `about.md` and `about.html` exist. The existing page loader prefers Markdown. The importer must preserve that active representation, retain the alternate source in the import record and produce one article identity for the current URL. It must not publish both files as separate articles with the same slug.

Markdown currently spells the comment fields `commentsEnabled` and `commentsAllowed`; HTML uses `comments-enabled` and `comments-allowed`. The importer must recognize the source format and preserve the existing setting. Missing fields remain Disabled. The scanner records both forms when they occur together so disagreements can be reviewed.

The file under `drafts` with an Open comment setting must remain unpublished on import. Comment policy does not establish publication state.

## Existing read and write paths

| Surface | Current behavior | Required migration work |
|---|---|---|
| Static `/content/...` requests | Static files run before authentication. | Move unpublished payloads outside the public tree and remove policy bypasses. |
| `/src/content/...` | The source viewer reads files beneath the web root. | Resolve article access through publication policy. |
| `/page/...` and window content | Render source files and book chapters directly. | Resolve stable article identities and published revisions through one service. |
| `/api/content` | Exposes published file resources; draft paths are filtered. | Use the same published-revision service as HTML. |
| Administrative filesystem writes and restores | Change files beneath the public root. | Route content mutations through import and publication; restrict trusted asset changes separately. |
| `/preview/{token}` | Uses temporary in-memory source and a bearer URL on the public origin. | Require authorized private revisions and isolate untrusted execution. |
| OneDrive and host edits | Change the live files directly. | Treat incoming files as imports once revision publishing becomes authoritative. |

Read-only HEAD requests through the local listener with the public Host header confirmed that an existing draft returns 200 through static, source-view and rendered-page routes. The corresponding content API resource returns 404. This is a verified current access inconsistency. No files were moved, and the running application was not changed during inventory.

## Initial code changes

The host command `identity-inventory` now reports account IDs, email verification, lockout state, role names, passkey counts, configured origins and local comment-table names. It does not run database migrations, start the web host, send email or select credential material. Its JSON contains account identifiers and email addresses and belongs in private operator storage.

`Tools/inventory-site-content.py` reads the content tree and emits paths, SHA-256 hashes, comment-policy candidates, code/style review signals, declared dependencies and path collisions. It does not assign stable article IDs or grant content trust. It reports invalid text and skips linked paths and build directories.

The cache middleware now registers headers before response output using the documented [OnStarting callback](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.http.httpresponse.onstarting?view=aspnetcore-10.0). Account and administrative routes receive no-store even if an endpoint sets a public policy. Content API requests carrying cookies or authorization, authenticated requests and responses setting cookies also receive no-store. Anonymous content retains public caching, with existing Vary dimensions preserved. The middleware is registered before authentication and rate limiting so their early responses receive this policy too.

The inventory command was built with .NET 10 and executed in a disposable container using the running site's configuration, network and read-only mounts. The web application process was not restarted or replaced. Full reports are kept under the ignored `.local/unified-identity` directory, not in published content.

All 33 C# tests passed, including 14 cache-policy tests with an in-process HTTP server. The tests cover response-header timing, account/admin paths, cookie and authorization requests, late cookie creation, session middleware, authenticated responses, 304 responses and Vary preservation. All six Python inventory tests passed. The build still reports existing nullable warnings and low-severity dependency advisories for NuGet.Packaging and NuGet.Protocol 6.12.1.

## Remaining implementation

The publishing foundation described below is implemented locally. Durable sessions and stored single-use links are now implemented locally as described below. Generalized accounts, main-origin staff enrollment, the browser editor, public revision-backed rendering and comments remain unimplemented. Public registration remains unavailable. The historical-comment question is resolved; no legacy comment import is required.

Release acceptance still requires browser tests, hostile-content tests, concurrency checks, database migration and rollback rehearsal, backup restoration and credential migration. The current inventory and middleware tests do not establish those release properties.

## Publishing foundation, 2026-10-03

The new internal article store assigns stable article IDs, appends immutable source revisions and separates the current draft from the published revision. Its source payloads live in SQL Server. Draft saves, publication selection, rollback, URL aliases, trust changes, audit events and retry receipts are transactional. Renaming retains the previous path as an alias; unpublishing removes public access through every alias. Rollback creates and publishes a new revision rather than modifying history.

Existing article versions are claimed with an explicit conditional update before new revisions are inserted. A competing edit receives the current version and cannot replace the winner's source. The implementation uses the documented [EF execution strategy for transactional retries](https://learn.microsoft.com/en-us/ef/core/miscellaneous/connection-resiliency). Each retry uses a fresh context and checks a persisted operation receipt. Reusing an operation ID with different input or another actor is rejected.

Live account verification, lockout and roles are checked on writes and private source reads. Ordinary Admin can edit restricted content. SuperAdmin is required to change trust or access and modify trusted executable source. The host importer is the initial caller. Browser controllers must enforce durable session elevation and antiforgery before this store is exposed through HTTP; these browser protections are still part of the next implementation stage.

Restricted publication renders Markdown or HTML through an explicit HtmlSanitizer 9.2.1039 allowlist. The policy removes scripts, event attributes, SVG, forms, frames, styles, shell IDs and shell behavior attributes. Allowed URI attributes are checked against the allowed schemes. The [maintainer documentation](https://github.com/mganss/HtmlSanitizer) defines those configuration contracts. Published rows retain the rendered result and policy version. An explicit super-admin trust change re-renders any existing publication under its new classification.

The `ArticleRevisions` migration adds seven publishing tables without changing Identity records. Composite foreign keys prevent publication or import records from selecting another article's revision. SQL triggers and the context's save checks prohibit changes or deletion of revision history, audit events and retry receipts. The migration has been applied, rolled back to the existing Identity migration and reapplied on an isolated SQL Server instance, preserving the test Identity account through rollback. A production rollback must preserve new publishing data through backup or forward repair; the schema downgrade tested here is destructive to publishing data.

The host command supports the following operations:

```text
article-import --plan <content-root>
article-import --apply <plan.json> --actor <existing-account-email>
```

Planning is read-only and works before the publishing schema is installed. The plan contains private source text, source hashes, expected article versions and an operation ID, so it must be stored outside published content. Apply verifies active and alternate file contents against that plan and imports the batch atomically. The command does not run migrations or publish imported source. The existing operator must hold the appropriate live role.

Markdown remains the active source when Markdown and HTML share a path. Alternate source text is retained in immutable revision history. An unchanged active source does not overwrite a newer manual draft. When only an alternate source changes, the added archival revision preserves the current manual text. Import cannot inherit executable trust from an existing trusted article; its classification must be explicitly changed to Restricted before importing changed source.

The live tree produced a read-only plan with 158 article identities, one alternate source, five draft paths and three Open comment settings. No entry was published. The plan is stored privately at `.local/unified-identity/article-import-plan-20261003.json`. Applying and replaying the full mounted tree against a separate disposable SQL database produced exactly 158 draft revisions and no publications or duplicate history. This test did not apply the plan to the live database.

All 60 regular C# tests and both SQL Server integration tests passed. The SQL tests include a forced concurrent-editor race, direct SQL attempts to rewrite history, migration rollback/reapplication and full-tree command import/replay. These tests verify the persistence foundation. The existing public/static/source readers still use legacy files, so their draft-access inconsistency remains until cutover is implemented and deployed.

## Durable identity foundation, 2026-10-03

The local implementation adds `SiteSessions` and `SiteAccountLinks` through separate migrations. No existing Identity account or credential table changes. Session checks read current account verification, lockout and security stamp on every request; confirmation checks read the durable passkey time. Sign-out persists revocation. The SSH watcher uses the same validation and cancels its relay if validation fails, including database errors.

Email links are purpose- and account-bound, expire after fifteen minutes and are atomically consumed. Reissue supersedes earlier links, while retry detection retains each issued hash. The edit-origin email sign-in page now uses this store and cancels failed deliveries. The host enrollment CLI and passkey enrollment endpoint still use the legacy token provider; replacing that path remains part of credential migration. Main-origin public account routes are still absent, and no registration has been enabled.

The mailer no longer logs message bodies in Development, remote response bodies or exception messages. Hosting request and MVC model-binding diagnostics are filtered to Warning. External proxy and analytics logging still require verification before cutover. Application-only filtering is not evidence of external token redaction.

All 74 regular C# cases and three isolated SQL cases passed after these changes. The SQL cases cover publishing and identity migrations with rollback/reapplication, forced concurrent link redemption, concurrent issuance, durable activity/revocation, lockout, full-tree article import and the actual Razor sign-in/sign-out flow. The HTTP case verifies that GET preserves a link, missing antiforgery rejects POST, successful POST consumes it, old-cookie replay fails after sign-out and failed email delivery leaves no usable link. Three mailer cases verify that missing configuration, a provider echo and an exception cannot disclose message secrets in logs. Build/publish succeeded. The disposable SQL container and its volumes were removed afterward. No live migration, deployment, role change or enrollment occurred.

## Account profile storage and localhost preview, 2026-10-03

`AccountProfiles.cs` and its migration add display-name storage, a concurrency version and private suspension state without modifying existing account IDs or roles. Suspension is checked in the durable session, link, legacy admin eligibility and publishing paths. New tests verify that suspension rejects session activity, confirmation, link issuance/redemption, new sessions and SuperAdmin source access/writes. Profile and suspension administration are not exposed yet. Audited state-changing operations and permanent revocation on suspension remain required before those controls are added.

All 76 regular cases and three SQL cases passed, totaling 79. A staged publish succeeded, and the local preview was refreshed from `/work/publish-profiles`. Its separate database contains the new profile table. Both the public root and admin sign-in returned HTTP 200 after refresh. No public-site deployment or live migration occurred.

Paul requested a localhost test instance and required checking the cloudflared config before selecting a port. Port 8100 is not in that config and was free. The preview binds only `127.0.0.1:8100`, has a separate SQL container with no host port, and uses private test state. Public preview is `http://127.0.0.1:8100/`; current admin sign-in is `http://localhost:8100/admin/signin`. The tunnel configuration is unchanged. Email is disabled, and no staff test account has been created. Private fixture credentials remain in the ignored `.local/unified-identity/test-instance.json`.
