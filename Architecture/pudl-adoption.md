# PUDL adoption and desktop mode

Status: approved direction (Paul, 2026-09-26); demo implemented the same day against PUDL v0.7.0.

## Goal

The site becomes a public showcase for PUDL (https://github.com/paulmooreparks/pudl). That means two things. The whole visual layer moves from Bootstrap 5 to PUDL, and the site gains a desktop mode in which articles are listed in a sidebar, open as maximized PUDL floating windows, and appear as tabs in a taskbar, in the manner of PUDL's reference.html.

## Decisions

### D1. Bootstrap and jQuery are removed entirely

A PUDL showcase cannot mix stylesheets. Bootstrap 5, its bundle script, and jQuery leave the layout. Everything they provided (navbar, dropdowns, collapse accordions, tooltips, the lightbox modal) is replaced by PUDL components, native HTML (`<details>`, `<dialog>`, `title` attributes), or small site-owned CSS in `pudl-site.css`.

### D2. PUDL ships as a copied tagged release

`dist/` from the PUDL v0.7.0 tag is copied into `wwwroot/pudl/` (pudl.css, pudl-theme.js, pudl-windows.css, pudl-windows.js, fonts, LICENSE), per the cross-project rule that production apps copy a pinned release rather than load a CDN. Upgrades happen by copying a newer tag. The demo began on v0.6.0 and moved to v0.7.0 the day it released, for child windows and the list-follows-windows behavior.

### D3. The lightbox is a native `<dialog>`, not a window

Options considered:

1. **Native `<dialog>` overlay, PUDL-styled.** Server-rendered shell in the layout, opened by script, image swapped in by script. Focus trapping, Esc, and backdrop come free from the platform. Works identically in the classic reading view and inside desktop-mode windows.
2. **A PUDL floating window per image.** Attractive in desktop mode, but the windows module is not loaded on classic article pages, a window is heavy chrome for a glance at a figure, and image URLs would pollute the window-state URL grammar.
3. **Inline zoom (expand the figure in place).** Least chrome, but loses the gallery (prev/next across the article's images) and reads poorly for tall images.

Decision: option 1 for now. The dialog shell is rendered by the server in the layout, which honors PUDL's server-rendered-dialog rule; script only fills in the image, caption, and counter. Prev/next are PUDL `.win-btn`-style raised round buttons; arrow keys navigate; the counter is tabular-numeral text.

Option 2 shipped in desktop mode the same day. Paul proposed parented child windows for PUDL (2026-09-26): a child window opens maximized over its parent, closes on Esc or its close control, shows as a tree node under the parent article in the sidebar rather than as its own taskbar tab, and disappears from the tree when closed. PUDL v0.7.0 released exactly that, and the site adopts it: in desktop mode, each eligible article image is wrapped as a `data-win-open` link whose key is `{slug}-img-{n}`, and `/window/{slug}-img-{n}` serves a close-only child window carrying `data-win-parent`. An image already wrapped in a WordPress-style full-size link keeps that link as the opener (and as the no-script fallback). The dialog remains the classic-view lightbox. Source listings as child windows are open for a later pass, since they need content-level links.

### D4. The desktop is the site's home page

Resolved 2026-09-26 after Paul reviewed the demo: the desktop serves at `/`, the classic home page moved to `/home`, and `/desktop` permanently redirects to `/` with its query string kept so shared window URLs survive. The view pills switch between `/` and `/home`, and sitenav's Home entry points at `/home` so the classic view stays self-contained. Narrow screens need no separate mode: the master-detail layout shows the list one pane at a time and a maximized window is effectively a full-screen page, which is the phone behavior D7 planned. Article pages at their own URLs remain canonical for SEO, RSS, and deep links.

### D5. Window keys are content slugs

Site content slugs are flat (letters, digits, hyphens), which is exactly PUDL's window-key alphabet. The window endpoint is `/window/{key}`, a Razor page that runs the same content pipeline as the article page and returns bare `.win` markup. Only internal nav/post entries get `data-win-open`; external links stay plain links.

### D6. Windows open maximized by default

The window markup carries `data-win-mode="maximized"` with no position, which PUDL v0.7.0 honors as the opening mode with a cascade position to restore to. Every PUDL affordance (restore, snap, drag) stays intact. The v0.6.0-era `pudl:window-place` hook was removed when v0.7.0 made it unnecessary.

### D10. The desktop is PUDL's master-detail layout

The desktop page follows PUDL's `samples/article-reader.html`: the article list is the `.md-sidebar`, the windows host sits in `.md-detail`, the dock lives in the `.md-toolbar` as the taskbar, and a `data-win-back` link above the host returns to the list on narrow layouts. The v0.7.0 script marks the active row, renders child rows, and drives `data-md-pane`; the server renders the same rows and pane state from the URL so the page is correct without script.

### D11. accessibility.css no longer boxes anchors

The old rule forcing every `<a>` and button into a 44px centered inline-flex box broke PUDL's list rows and window chrome, and control sizing is PUDL's job. The file now keeps `:focus-visible` (in the theme accent), `.sr-only`, reduced-motion, zoom, and print rules only.

### D12. Desktop categorization: tab strip plus toolbar filter

The classic top-bar menus translate to the desktop as two PUDL-native controls (Paul, 2026-09-26). A notebook tab strip (`.app-section-bar`) between the topbar and the layout carries All plus one tab per category (Articles, then each top-level nav section with children); a category tab is a link setting `?cat=` and the server filters the sidebar. A leaf top-level node (My Résumé) is not a category: its tab opens its window directly, as the classic nav links straight to its page. The tab carries `data-win-open` and its href is the desktop URL with that window open and on top, all other parameters kept, so it works without script. Direct tabs never take the strip's active state, which belongs to the selected category; the sidebar row shows the front window. An external leaf node would render as a plain tab link. The toolbar carries a `.md-filter` search input backed by `?q=`; the server filters, script refines live and writes `q` back to the URL when typing goes quiet, and the input sits in a GET form whose hidden inputs preserve every other parameter so a no-script submit keeps the category and the window arrangement. Active filters render as `.md-chips` with × links. Changing a filter never disturbs open windows, because every filter URL keeps the window parameters.

Follow-ups: tag chips once posts carry `tags` in sitenav.xfer; a taskbar launcher (Start-menu style) is proposed to PUDL as a new control and will be adopted here if it ships.

### D13. App content renders in its window as its own document

An article that brings its own scripts or stylesheets (sudoku, Conway, the barcode generator, the resume's bespoke CSS) cannot render inline in a window: scripts in fetched window markup do not run by PUDL's rule, and head assets never arrive. Such content is detected in ArticleContentService (any script element, or a head stylesheet or style block) and its window hosts the article's page in an iframe at `/page/{slug}?frame`, a bare rendering without site chrome. The iframe was chosen over re-executing scripts in the desktop document (stale DOMContentLoaded handlers, global collisions, style bleed, no teardown) and over Shadow DOM (isolates CSS but not JS, and breaks `document.getElementById` in old app code): it gives each app a full document lifecycle with isolation both ways and free cleanup on close, the web's equivalent of a window hosting its own process. Iframe support is universal and current; it is `<frameset>` that is dead. The choice leaks into no contract, so any app can later be rewritten as a PUDL-native inline fragment. Prose articles keep rendering inline.

### D7. The fallback is the design, not a second implementation

Every sidebar item's `href` is the article's real page. No script means plain navigation. The server renders whatever windows the `open`/`p.*` parameters name, so a bookmarked desktop arrangement reloads without script. Narrow viewports get the classic reading view via the article pages themselves; the desktop page remains usable on a phone because a maximized window is effectively a full-screen page with a close button.

### D8. Highlight.js and Mermaid run per window

Scripts inside fetched window markup do not run (PUDL rule), so `desktop.js` listens for `pudl:window-open` and runs highlight.js and Mermaid over the arriving window's content.

### D9. Comments stay on the full page view

The comment form POSTs and redirects, which would drop window state. A window shows the article body; the ↗ (open as page) button reaches comments. Preserving window state across a form POST is deliberately out of scope.

## Implementation map

| Piece | Location |
|---|---|
| PUDL release copy | `wwwroot/pudl/` |
| Site theme + site CSS (replaces site.css) | `wwwroot/css/pudl-site.css` |
| Lightbox script | `wwwroot/js/lightbox.js` |
| Desktop wiring (maximize default, per-window highlight) | `wwwroot/js/desktop.js` |
| Layout rewrite | `Pages/Shared/_Layout.cshtml` |
| Nav component rewrite (topbar + `<details>` menus) | `Pages/Components/Nav/default.cshtml` |
| Comment form restyle | `Pages/Shared/_CommentFormPartial.cshtml` |
| Audio/video accordions to `<details>` | `Pages/page.cshtml` |
| Desktop shell | `Pages/Desktop.cshtml(.cs)` |
| Window partial endpoint | `Pages/window.cshtml(.cs)` |
| Shared window markup | `Pages/Shared/_Window.cshtml` |

`wwwroot/css/site.css` stays in the tree as reference until the swap is confirmed in production, but nothing loads it. The page-specific stylesheets (sudoku, conway, barcode, resume, acpp) are untouched.

### D14. Applets: interactive content runs in a window or as a page, unchanged

The applet rule (Paul, 2026-09-26): a converted app runs in a PUDL window or in a full browser page, from one implementation. An applet is a mount element (`data-app`, `data-app-src`, `data-app-css`, `data-app-page`) plus a script registering `pcApps[name].init(root, opts)`, which builds the app inside root, scopes every lookup and listener to it, and returns an instance with `destroy()`. `opts.ownUrl` says whether the applet owns the page URL: stand-alone it keeps state in the URL (sudoku's back-and-forward undo survives unchanged); in a window it leaves the URL to the desktop and its share control carries the applet's own page URL. The runtime (`js/applets.js`) loads assets once, boots mounts on page load, and exposes `boot(scope)` and `reap()` which the desktop calls on window open and close. The engine treats a mount as inline-safe, so applet articles bypass the D13 frame. Sudoku is the pilot; conway and barcode stay on the frame until converted.

## Proposed upstream to PUDL

Found while building this site, in PUDL's own territory rather than ours; each is a candidate for the PUDL repo, and the site adopts the released form when a version ships. Status 2026-09-26: the PUDL agent accepted all four, found three more gaps reading this site's code, and wrote all seven up in the PUDL repo (`docs/proposals/from-parkscomputing.md`). Staging: 0.9.0 takes the small contract-free three (the `[hidden]` fix with a hidden-until-found exception, `aria-pressed` for latched buttons, title-bar tokens with the quiet treatment as the dark default); 0.10.0 takes applets (`pudl-applets.js`, registration via `pudlApplets.register()`), a window-close event, a script interface for windows, and replace-in-place navigation, plus an applet sample. Applet-state-in-URL is deferred until a second applet needs it.

### D16. One job per control: the bar splits, the launcher goes, windows own their state

After using the site, Paul found the tabs, the launcher and the sidebar overlapping (2026-09-27), and each control got one job. The launcher came out of the desktop: for this site it duplicated the tab strip and sidebar (D15 records its adoption; PUDL keeps the control for sites that need it). The tab strip now has two areas with distinct jobs: category tabs on the left, and bare sitenav links (frequent, high-profile destinations such as the resume) on the right, behind a partial-height separator. And the open windows are the client area's state, not the tab's: the server renders tab, chip and filter-form URLs with the window parameters as of page load, so desktop.js refreshes them from the live URL on every windows change; without that, switching category resurrected page-load windows and dropped newer ones. The view pill also renamed from "Desktop view" to "Window view", since "desktop" read as the opposite of mobile.

### D18. Linked windows inherit their opener's state; category switches are soft

Two refinements from use (Paul, 2026-09-27). First, a window opened by a link inside another window opens in the same state as its opener: floating begets floating, cascaded a small offset so the opener stays visible, and maximized begets maximized. desktop.js records the opener on the click and supplies the placement through `pudl:window-place`; replacement links are exempt because a replacement keeps the old window's placement by PUDL's own rule, and windows opened from the sidebar or tabs keep the maximized default. Second, switching category or removing a filter chip no longer repaints the windows: those clicks fetch the target URL and swap only the tab strip, chips row and sidebar, pushing the URL, so scroll positions hold and running applets keep running. Back and Forward update the list chrome the same way while pudl-windows brings the windows in line. The URL and history are byte-for-byte what a full navigation would have produced, so nothing is lost without script. Candidate for upstreaming: opener-state inheritance is arguably PUDL-worthy default behavior.

### D19. Links open windows; floating by default; the desktop remembers

Three additions (Paul, 2026-09-27). First, links open windows. An internal content link that resolves to a known article becomes a window opener in window rendering (href untouched for classic and no-script); inside a framed page (an own-document article like Conway or the cache series), site.js hands internal article links up to the parent's `pudlWindows.open`, so following one opens a window beside the current one instead of turning the frame into a site-within-a-window. External destinations open as framed windows only when their sitenav node says `frame ~true`, because most large sites refuse framing and a refused frame is not reliably detectable from script; only the author can assert frameability (verify with a headers check first: yavchn sends X-Frame-Options DENY and stays a plain link, andoneer.com is clean and is flagged). An ext window's key is `ext-{slug}`, its ↗ opens the destination in a new tab, and unflagged externals keep opening browser tabs.

Second, new windows open floating by default, and a "Maximize new windows" checkbox on the right of the toolbar flips that for windows without an opener; opener-state inheritance (D18) still wins for linked windows. Third, the desktop remembers: the window parameters are saved to browser storage on every change and written back into the URL when the reader arrives at a bare desktop, before pudl-windows reads it, so the URL stays the authority. Both persistences are functional, user-requested browser storage of the same class as PUDL's remembered theme, so no consent banner is required. The second setting arrived the same day, so the deferred settings dialog came with it: a PUDL server-rendered dialog opened from a topbar gear that replaces the bare theme toggle. It holds a Light/Dark/System theme segment (System is a site extension over PUDL's `pudl-theme` key, applied pre-paint; a candidate for pudl-theme itself), the maximize-new-windows checkbox (moved out of the toolbar, which keeps the dock as its only elastic element so nothing wraps awkwardly), a reopen-last-session toggle governing the window restore, and a "Forget this browser's data" action that wipes every stored key, which is the user-controlled erasure GDPR likes to see. A Razor note for the record: bool and data-* attribute values render literally, so `hidden` and optional data attributes need explicit conditional emission (a stray `hidden="False"` shipped briefly).

### D17. Tags

Every page carries a tag row at its very top: flat PUDL chips (the chip's defined role, an attribute the thing carries), one per tag. Tag data is the union of sitenav.xfer `tags` and the content file's `keywords` metadata, merged case-insensitively by NavService enrichment. A chip opens a tag window (key `tag-{slug}`, slugified from the tag name), a top-level window listing everything under that tag newest first, each row opening its article; it has no page of its own, so no ↗ button, and its href form (`/?open=tag-x&top=tag-x`) is how classic pages reach it without the windows script. Framed app pages get the row from the classic layout inside the frame. A frame also now follows theme toggles live: site.js propagates `data-theme` into same-origin app frames, and resume.css moved its hardcoded colors to tokens.

### D15. The launcher

PUDL 0.8.0 shipped the launcher Paul proposed (a menu button first in the dock's row, panel with a filter, one section per category, and site-wide actions), and the desktop adopted it: the taskbar is now `.md-toolbar.md-site-tools` with a Browse launcher whose panel lists every article and section as `data-win-open` rows, a Classic view row, and a theme-switch action. On a narrow layout the taskbar stays visible in both panes, so the launcher reaches everything from inside an article on a phone. The classic nav keeps the site's details-based dropdowns for now, because PUDL's menu opener is a raised button and a tab-shaped opener is not yet in the grammar; that question can go back to the PUDL agent.

### The site's upgrade pass when 0.10.0 tags (executed 2026-09-26)

- Replace `wwwroot/pudl/` from the tag (both wwwroot copies: repo and the production content volume).
- 0.9.0 items: delete the dark title-bar override in pudl-site.css and the `[hidden]` guard in sudoku.css; move sudoku's latched `.btn.selected` styling to `aria-pressed="true"` (set the attribute in sudoku.js where it toggles classes today).
- Applets: retire `js/applets.js` for `pudl-applets.js`; sudoku moves from the `pcApps` global to `pudlApplets.register()`, mostly renaming; drop desktop.js's boot/reap wiring if the module self-wires as described.
- Window-close event: desktop.js stops reaping on every `pudl:windows-change`.
- Script interface: the image child-window swap stops simulating clicks (`pendingClose` and the `close.click()` calls go away).
- Replace-in-place: image prev/next becomes a window replacement instead of open-sibling-then-close-current; re-verify Escape, the sidebar child rows, and the URL after each step.
- Re-verify the desktop, classic pages, and sudoku on both surfaces; redeploy.

All of the above landed 2026-09-26, the day the releases pushed, plus the launcher (D15). The released applet contract renamed the mount attributes to `data-applet[-src|-css|-page]`, the registration to `pudlApplets.register()`, and the opts field to `ownsUrl`; the engine's inline-safe detection follows `data-applet`. The site-side stand-ins (dark title-bar override, `[hidden]` guard, `js/applets.js`, desktop.js's reap and click simulation) are gone.

- The applet contract and runtime (D14): what embeddable content promises its host is host-independent, and `applets.js` could ship as `pudl-applets.js` with the contract in the README and a sample-page demo.
- A token for the active window title bar. The bar derives straight from `--accent`, so a theme with a bright dark-mode accent (needed for link contrast) gets a garish filled bar and has no token to tune it. This site overrides the component's rule in `pudl-site.css` for the dark theme (accent-tinted raised gradient, normal text, accent underline), which trespasses on component CSS exactly because no token exists; the override carries a comment and comes out when PUDL provides the knob or adopts the quieter treatment.
- `[hidden]` loses to component display rules: `.btn { display:inline-flex }` overrides the attribute, which every PUDL project will trip over. pudl.css could carry `[hidden] { display: none !important; }`.
- A latched-toggle treatment for buttons (a pressed-in `.btn` state for modes like sudoku's hint entry), which the language currently has only inside `.seg`.

## Known gaps and follow-ups

- Promoting `/desktop` to the home page (D4 follow-up).
- PUDL itself has no master-detail resize script yet; the desktop sidebar is fixed-width until PUDL grows one. Gaps this project finds in PUDL are fixed in the PUDL repo, not patched here.
- The production content volume's static fragments (header/footer sections) may carry Bootstrap classes; dev copies are updated here, and the production volume needs the same edit at deploy time.
- Slug collisions across sections would collide as window keys; acceptable while content is flat.
