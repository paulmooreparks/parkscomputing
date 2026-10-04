# Parks Computing carryover, 2026-10-04

## Start here

Beta at [beta.parkscomputing.com](https://beta.parkscomputing.com) is now the whole site with accounts added (2026-10-04, after Paul rejected the account-only beta). Anyone browses it as on the public host; Sign in… and Create account… sit in the logo menu and open as modal dialogs; a signed-in reader gets their account, super-user setup, Administration and Sign out there. The design is the "Beta site with accounts" section of [the unified design](Architecture/unified-identity-design.md). On 2026-10-04 Paul had commit 8ac7557 promoted to production with accounts still switched off: parkscomputing.com runs the same code and PUDL 0.44.1, with no Edit links and the menu fixes, and its database has every new migration (the last is AccountAvatars). Before the restart the production database was backed up to `/var/opt/mssql/backup/ParksComputingAuth-20261004-233919.bak` in the `sqlserver-local` volume, and the previous image is tagged `parkscomputing-local:prev-20261004-233919` for rollback. edit.parkscomputing.com keeps working; its admin sessions sign in again once, because sessions are durable records now. A full cutover (accounts on parkscomputing.com) still needs www and edit redirects, production email settings, super-user setup in production's database and passkeys for parkscomputing.com. The combined accounts, publishing and comments release is still incomplete; comments are next.

Paul's beta super-user account is `paul@parkscomputing.com`. Its state was rechecked while writing this handoff: email is unverified, it has zero passkeys and zero roles, and its seven-day host authorization is pending. Recheck that state before acting in a later session because Paul may complete setup independently. Do not use `paul@smartsam.com` for this account.

Paul completes setup from the logo menu: Sign in… with `paul@parkscomputing.com`, press Sign in on the emailed link's page, then Finish super-user setup, which lists the steps (two passkeys on two different devices, then Activate). The authorization expires 2026-10-10 18:28 UTC; rerun `account-bootstrap` inside the beta container if it lapses. Email is configured, but automation has not tested delivery to a real inbox.

The 2026-10-04 rework was verified by a browser run against beta as an anonymous reader (17 checks: both views, the menu, both dialogs and their own addresses, a refused and an accepted request, phone width) and by a full signed-in run on a throwaway instance with its own database (17 checks: link confirmation, menu, two passkeys with the same-device refusal, display name, setup checklist, activation, Administration, the Account window, sign-out back to the page, passkey sign-in from the dialog). The throwaway instance and its database were removed. All 79 C# tests pass, the SQL account workflow included; the import test was not run.

The checkout is on `master`. The implementation and design changes remain modified or untracked; no commit or push was requested. Preserve the working tree. Read [the unified design](Architecture/unified-identity-design.md) and [migration inventory](Architecture/unified-identity-inventory.md) before extending the release.

## Accepted decisions

Paul requires account management to be a PUDL applet in both Windowed and Classic modes. Sign-up and sign-in must be modal dialogs in both modes. This explicit requirement overrides the general preference against modal pages. Direct URLs render the same native dialog, while enhanced links open it over the current view and restore focus on cancellation. Consult the [PUDL reference](https://paulmooreparks.github.io/pudl/reference.html).

The first release includes public registration, super-user access, in-site editing and article comments. Every comment requires moderation, including staff submissions. Members use verified email links with optional passkeys; privileged operations require passkey confirmation. Save draft, Preview and Publish remain separate actions. OneDrive imports are explicit. Historical comments need not be imported, and personal server storage is deferred. Preserve existing browser-local Files data. Do not repeat these policy questions.

The canonical architectural principles remain at `C:\Users\paul\OneDrive\Documents\Architectural Principles.md`. Capture new decisions in the design document immediately. New prose, code and comments must not contain em dashes.

## Deployed beta

| Setting | Current value |
|---|---|
| Origin | `https://beta.parkscomputing.com` |
| App container | `parkscomputing-identity-test`, from image `parkscomputing-local:beta` |
| Host binding | `127.0.0.1:8100` to container port `8080` |
| SQL container | `parkscomputing-identity-test-sql`, with no host port |
| Database | `parkscomputing_identity_preview` |
| Docker network | `parkscomputing-identity-test` |
| Web root | `.local/beta/wwwroot` (staged), with OneDrive `content`, `images` and `audio` mounted read-only over it |
| Server tools | `/app/site` is the live OneDrive `wwwroot`, writable (`Admin__SiteRoot`); `/app/home`, `/app/etc`, `/app/history` are production's folders; `/app/config` read-only |
| Settings | ignored `.local/beta/beta.env`; never print it |
| Feature flags | `Accounts:Enabled=true`, `Accounts:StaffEnabled=true` |

Redeploy with `sh Tools/beta-run.sh`: it builds the image from the checkout, restages the web root (`Tools/beta-webroot.sh`) and replaces the container. Run `sh Tools/beta-webroot.sh` alone to refresh sitenav.xfer and the other copied files. The previous volume-based container is kept stopped as `parkscomputing-identity-test-old` for rollback; remove it once Paul is happy with the new beta. The SQL data uses its own volume. The beta uses selected existing email-sender configuration, but its database and application state are separate from production. Production accounts and edit-origin passkeys were not copied.

On 4 October 2026 Paul licensed his terminal code under Apache-2.0, to match PUDL Desktop, which builds its terminal from it. `js/terminal.js`, `js/sitefs.js`, `js/terminal-text.js` and `css/terminal.css` now begin with an Apache-2.0 header; the change is only those comment lines. `Tools/beta-webroot.sh` now overlays `js/terminal-text.js` and `css/terminal.css` as well, so beta serves the headed copies, and the next static deploy to the live tree takes all four to production. These edits are uncommitted, with the rest of the working tree.

Paul configured cloudflared to route beta to port 8100. Its configuration is `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml`. Keep the loopback binding and do not change other tunnel routes or containers.

The Windows SDK is .NET 8, so tests use the .NET 10 Docker SDK image with the checkout mounted. SQL tests run against the beta SQL server's `parkscomputing_publishing_tests*` databases on the beta network; drop those fixture databases before and after, since a run leaves rows behind.

## Implemented behavior and code

Registration creates an unverified account and profile without roles. Verification consumes a single-use, 15-minute link, confirms the mailbox, grants Member and creates a durable session in one transaction. Duplicate registration preserves the profile. Normalized email is unique in SQL. Request budgets persist across restarts. Sessions enforce security stamps, current eligibility, expiry, suspension and revocation. Cookies and passkeys are bound to the exact beta host/origin.

The host-only `account-bootstrap <email> <display-name>` command authorizes setup for seven days without granting roles or sending email. `Identity/StaffBootstrap.cs` stores authorization against the account security stamp. Activation requires verified email, two passkeys and a new assertion, then atomically grants Member/Admin/SuperAdmin and invalidates older sessions and links. The controller issues a fresh passkey session. Staff credential removal must retain two keys. There is no public bootstrap route or first-registrant grant.

Account pages use the site's own layout. `Identity/AccountMenu.cs` puts the account commands in the logo menu. `wwwroot/js/accounts.js`, loaded on every page of a site with accounts, opens the sign-in and sign-up dialogs over the current page, posts their forms in place, and runs passkey ceremonies (`window.pcAccounts`). The Account applet (`wwwroot/js/account.js`, registered in `js/applets.js`) renders `_AccountContent` on `/account` and in the window view's Account window, served by `ArticleContentService.AccountKey`. Passkey fetches explicitly accept JSON because this application also supports Xfer responses.

`Pages/Admin/Articles` provides article creation, immutable draft save, restricted saved-revision preview, explicit publish and unpublish. `Publishing/ArticleStore.cs` enforces live roles, version preconditions, immutable history and operation receipts. Browser handlers add antiforgery and fresh passkey checks. `/articles/{id}` serves only a selected restricted publication; an unpublished article returns 404. The beta UI does not expose trusted executable publishing.

The whole public site is served. The super-user (SuperAdmin role only) gets the edit origin's server tools in Terminal, Files and the Editor: `/wwwroot` is the live tree, so saves change production, and SSH reaches the same destinations. Paul chose passkey taps as the only boundary, keeping third-party scripts on the pages. The old workspace's own pages, sign-in and settings endpoints still answer 404. Account and workspace pages carry `no-store` and a CSP that admits the site's own scripts plus the Google fonts and Plausible the layout loads; pages drawn for a signed-in reader are `no-store`. Raw content is served as on production, so the draft exposure noted below applies to beta too.

## Verification and retained fixtures

The latest SQL/HTTP workflow test passed registration, verification, duplicate/replayed links, delivery failure, budgets, profile concurrency, revocation, host authorization, two-key activation, privilege/session checks, CSRF rejection, article creation, stale edits, publish/unpublish and unpublished-reader 404. The final compiled Razor changes passed this test again. The 76 ordinary tests passed, with one SQL import test skipped because its explicit fixture was absent. Earlier full verification passed 80 cases; do not present that earlier count as a complete rerun of the final build. Existing NuGet low-severity advisories and nullable warnings remain.

Browser verification exercised account management in both hosts, window maximize/close/reopen, modal focus and cancellation, mobile overflow, two virtual authenticators, super-user activation, draft editing/preview/publication and sanitized anonymous reading. Two enrollment credentials require separate virtual authenticators because WebAuthn excludes credentials already present on the authenticator. A navigation-sensitive harness wait failed after unpublishing; an independent database check and anonymous reader check confirmed that the publication was removed and returned 404. Final dialog form ownership and both mobile modes passed.

The synthetic `browser-staff@example.invalid` account is suspended and locked. Its roles/passkeys were removed and its sessions/links invalidated. Its unpublished Browser verification article and immutable audit records remain in the isolated beta database. Fixture tokens, cookies and temporary SQL files were deleted. Screenshots and browser scripts remain under ignored `.local/unified-identity`. No real email was sent by automation.

SQL tests require `PARKSCOMPUTING_PUBLISHING_TEST_SQL` with the exact base database name `parkscomputing_publishing_tests`; fixtures use guarded suffixes. Full-tree import also needs `PARKSCOMPUTING_IMPORT_FIXTURE_ROOT`. Never point these tests at the preview database or production. Test commands can filter `FullyQualifiedName~MemberAccountTests` for the expanded workflow or `TestCategory!=SQLServer` for the ordinary suite; the import test has category SQLImport and still requires its fixture.

## Next work and release boundaries

First support Paul's beta setup and act on his test feedback. Revalidate the deployed paths, account state and served output before claiming a fix. Continue applying the PUDL applet/dialog requirement to account features.

The broader release still needs audited staff administration, suspension/recovery operations, moderation and comments, richer editing integration, revision-backed main-site readers, explicit content migration and trust review, and production-origin credential enrollment with rollback. The beta bootstrap does not provide a complete staff recovery or role-management interface.

The earlier live inventory found raw/source/rendered draft exposure in production, which the new protected publishing store has not yet closed there. It also found 159 content files, 25 executable-review candidates, five draft paths and an About extension collision. A disposable import produced 158 article identities without publishing them. Import the live tree explicitly; the repository copy is incomplete and must not overwrite deployed content. Preserve Paul's production account ID and existing credentials during migration.

Production cutover, migrations, trust approval and replacement of the live content tree have not been authorized by these beta requests. Keep numeric quotas/retention settings distinguishable from accepted workflow policy. Use documented external contracts and avoid temporary application logging when investigating runtime failures.

Earlier session notes are preserved in [the historical carryover](Architecture/carryover-history-2026-10-04.md). They contain superseded status and deployment paths; this document is the current handoff.
