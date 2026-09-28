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

Still open as of 2026-09-28: the regions form serializer emitting an empty `q=` in swapped URLs (the seg-with-links candidate closed with 0.16.0), and the applet-hosts round (`pudl-proposal-applet-hosts.md`): the applet registry with central versioning, the embedded-in-article host, the fill-versus-flow sizing contract with its three hard-won lessons, and the applet state handshake (the applet exposes `state()`/`setState()`, the host decides where the string lives), which folds in the long-deferred applet-state-in-URL question now that Conway makes a second applet. The sidebar resize proposal (`Architecture/pudl-proposal-sidebar-resize.md`) shipped as 0.14.0 the same day: `pudl-md.js` drives the `.md-resize` divider by pointer and keyboard, sets `--md-sidebar-w` on the layout, and fires `pudl:md-resize` while keeping no state. The site renders the divider, keeps the width in `pc-sidebar-w` (wiped by Forget like the rest), applies it from an inline script first thing inside `.md-layout` so the default width never flashes, and moved its 300px default from a `width` on the sidebar to `--md-sidebar-w` on the layout so a dragged width can override it.

### D16. One job per control: the bar splits, the launcher goes, windows own their state

After using the site, Paul found the tabs, the launcher and the sidebar overlapping (2026-09-27), and each control got one job. The launcher came out of the desktop: for this site it duplicated the tab strip and sidebar (D15 records its adoption; PUDL keeps the control for sites that need it). The tab strip now has two areas with distinct jobs: category tabs on the left, and bare sitenav links (frequent, high-profile destinations such as the resume) on the right, behind a partial-height separator. And the open windows are the client area's state, not the tab's: the server renders tab, chip and filter-form URLs with the window parameters as of page load, so desktop.js refreshes them from the live URL on every windows change; without that, switching category resurrected page-load windows and dropped newer ones. The view pill also renamed from "Desktop view" to "Window view", since "desktop" read as the opposite of mobile.

### D18. Linked windows inherit their opener's state; category switches are soft

Two refinements from use (Paul, 2026-09-27). First, a window opened by a link inside another window opens in the same state as its opener: floating begets floating, cascaded a small offset so the opener stays visible, and maximized begets maximized. desktop.js records the opener on the click and supplies the placement through `pudl:window-place`; replacement links are exempt because a replacement keeps the old window's placement by PUDL's own rule, and windows opened from the sidebar or tabs keep the maximized default. Second, switching category or removing a filter chip no longer repaints the windows: those clicks fetch the target URL and swap only the tab strip, chips row and sidebar, pushing the URL, so scroll positions hold and running applets keep running. Back and Forward update the list chrome the same way while pudl-windows brings the windows in line. The URL and history are byte-for-byte what a full navigation would have produced, so nothing is lost without script. Candidate for upstreaming: opener-state inheritance is arguably PUDL-worthy default behavior.

### D19. Links open windows; floating by default; the desktop remembers

Three additions (Paul, 2026-09-27). First, links open windows. An internal content link that resolves to a known article becomes a window opener in window rendering (href untouched for classic and no-script); inside a framed page (an own-document article like Conway or the cache series), site.js hands internal article links up to the parent's `pudlWindows.open`, so following one opens a window beside the current one instead of turning the frame into a site-within-a-window. External destinations open as framed windows only when their sitenav node says `frame ~true`, because most large sites refuse framing and a refused frame is not reliably detectable from script; only the author can assert frameability (verify with a headers check first: yavchn sends X-Frame-Options DENY and stays a plain link, andoneer.com is clean and is flagged). An ext window's key is `ext-{slug}`, its ↗ opens the destination in a new tab, and unflagged externals keep opening browser tabs.

Second, new windows open floating by default, and a "Maximize new windows" checkbox on the right of the toolbar flips that for windows without an opener; opener-state inheritance (D18) still wins for linked windows. Third, the desktop remembers: the window parameters are saved to browser storage on every change and written back into the URL when the reader arrives at a bare desktop, before pudl-windows reads it, so the URL stays the authority. Both persistences are functional, user-requested browser storage of the same class as PUDL's remembered theme, so no consent banner is required. The second setting arrived the same day, so the deferred settings dialog came with it: a PUDL server-rendered dialog opened from a topbar gear that replaces the bare theme toggle. It holds a Light/Dark/System theme segment (System is a site extension over PUDL's `pudl-theme` key, applied pre-paint; a candidate for pudl-theme itself), the maximize-new-windows checkbox (moved out of the toolbar, which keeps the dock as its only elastic element so nothing wraps awkwardly), a reopen-last-session toggle governing the window restore, and a "Forget this browser's data" action that wipes every stored key, which is the user-controlled erasure GDPR likes to see. A Razor note for the record: bool and data-* attribute values render literally, so `hidden` and optional data attributes need explicit conditional emission (a stray `hidden="False"` shipped briefly).

### D20. Two more preferences; PUDL 0.11.0/0.12.0 absorbed the second proposal round

The settings dialog gained a Default view segment (Window or Classic; a functional cookie the server redirects on at a bare `/`, with `?view=window` as the classic pages' escape hatch) and the list state (category and filter) now persists the same way: saved to a cookie as it changes and restored by redirect on a bare arrival, so the URL always names what shows. Both redirects act only on top-level navigations, guarded by the Fetch Metadata `Sec-Fetch-Mode` header, so a region fetch always receives exactly what its address names; without that, clearing a filter would fight the redirect. The Forget action clears the cookies too.

PUDL 0.11.0 and 0.12.0 shipped all four window-workspace proposals, and the site upgraded the same day, deleting its stand-ins: opener tracking and its place listener (PUDL inherits opener state natively; the site keeps only the maximize-new preference for opens from outside any window, via `detail.opener`), the whole soft-navigation layer (`softNavigate`, `swapListChrome`, `syncNavState`) in favor of `data-region` marks on the section bar, chips row, sidebar and filter form with `pudl-regions.js` loaded, the `--tb-link-hover` override, and the site-drawn filter button in favor of PUDL's `.md-filter-group`. The chips row now always renders (empty rows hide) so region swaps always find their counterpart. Two site bugs fixed in the same pass: a single-image window's arrow keys fell through to window movement, and links inside a framed app page back to that same page (Conway's presets) are now left to the app with the `frame` parameter preserved, instead of being swallowed as openers of the already-open article.

### D21. PUDL 0.13.0 absorbed the empty-structure round

All three proposals from `pudl-proposal-empty-structure.md` shipped as 0.13.0 and the site upgraded the same day: the head's pre-paint System snippet is gone (the settings dialog calls `pudlSetTheme()` and follows `pudl:theme-change`, which also syncs the dialog across tabs), and the dock and chips overrides in pudl-site.css are deleted, since an empty dock now keeps its layout place and an empty chips row hides by having no chips rather than by `:empty`. The Forget action now lands the theme on System, the device deciding. Paul ratified the follow-up decision (2026-09-28): PUDL's unsaved-reader default becomes System rather than dark; the proposal file records it for the PUDL agent, and this site picks it up with the next pinned copy.

### D27. PUDL 0.19.0: the focus miss was a window race, and PUDL has a contract

0.19.0 fixed Paul's palette focus miss, with a sharper diagnosis than the site's bug report guessed: pudl-windows took focus when a window's content arrived from its fetch, so a `/` pressed before a restoring window finished loading had the window steal focus back from the palette filter, which is why it depended on session state and never reproduced in tests that waited for network idle. A window now takes focus only if focus has not moved since it was asked for. The site verified the exact race (window fetches slowed to 1.2s, palette summoned mid-flight, focus checked before and after arrival) and the pin was a three-file sync with no site-side change. Also in 0.19.0: `docs/CONTRACT.md` (what a project may rely on, frozen at 1.0), the test suites in the PUDL repo running three engines in CI, and a menu filter that clears on every open. The 0.14.0 lesson stands confirmed twice now: what looked like a browser-timing mystery was an interaction between two of our own moving parts, and the report that pinned it came from `document.activeElement`, one console line from the person who could reproduce it.

### D30. PUDL 0.21.0 absorbed the applet follow-ups; the deviation closes

Both follow-up proposals shipped as 0.21.0 and the site's remaining applet glue is deleted (2026-09-28). Preset links are the runtime's own now: the site's delegated listener and its `pc:applet-preset` event are gone from site.js and conway.js, and the behaviour improved in the move, since a preset on the applet's own page pushes the link's address as a history entry, so Back undoes it. The `pudl:applet-state` ask closes the window-continuity gap recorded in D28: desktop.js is now the host of every windowed applet's continuity (a per-applet key table, `pc-sudoku` today, answered on the ask and kept on `pudl:applet-change`), and sudoku's own storage knowledge is deleted, completing the applet-hosts commitment that the applet never knows its shelf. Sudoku's contract state became the full continuity JSON, undo history included, so a reopened window still steps back, and `setState()` accepts every form the game travels in: that JSON, the `difficulty|board` pair, or a preset link's query.

### D29. Conway converted: the second applet, and the first embedded one

Conway's Game of Life became an applet the day after the contract shipped (2026-09-28). The 2015 engine is unchanged in approach; the chrome became PUDL components, the board's colours are tokens repainted live on theme change, and three implicit-global leaks the old page-scoped code got away with are closed. The split Paul asked for is in force: the article at `/page/conways-game-of-life` keeps all its prose and embeds the running game (its mount pinned to flow with `data-applet-fit`, so the article scrolls even in a window), while `/page/conway` is the game alone, which is what a window opens and what the Web Apps tab now lists; the article stays under Articles. The article is also the applet's declared page, so `ownsUrl` gives it the historic URL and history behaviour and every link shared since 2015 boots its board; save-history is disabled anywhere else.

Two site-side glue pieces came out of it, both written up for PUDL in `pudl-proposal-applet-followups.md`: preset links (`data-applet-preset` anchors whose href is the no-script path, handed to a running instance as `pc:applet-preset` by a delegated listener in site.js, window-scoped) and the fill pattern for intrinsically sized content (the canvas scales into its box and clicks map back through `canvas.width / clientWidth`). A third piece is engine-side: `<meta name="applet-page">` now marks a page that IS its applet, replacing mount-presence as the trigger for dropping article chrome, so an embedding article keeps its tags and dates. One incidental site feature: `code[data-code-src]` hydrates a listing from a file and highlights it (site.js, plus the desktop's window-enhancement pass), replacing the article's inline scripts, which had been what forced it into an iframe.

### D28. PUDL 0.20.0 absorbed the applet-hosts round

All four proposals from `pudl-proposal-applet-hosts.md` shipped as 0.20.0 and the site adopted them the same day (2026-09-28). The registry lives in `js/applets.js` (`pudlApplets.define('sudoku', ...)` with the version in one place), loaded everywhere after pudl-applets, and the sudoku mount is down to `data-applet="sudoku"` with its noscript fallback; the manual `?v=` bumps in content are gone. Sudoku takes its habitat from `opts.fit` (fill in a window, flow elsewhere, with the site's bare-`?frame` app form remaining its own refinement of flow), implements the state handshake (`state()`/`setState()` over the compact `difficulty|board` string, `opts.changed` announced on every change, `opts.state` honoured at init when the address names no board), and keeps the URL behaviour on its own page under 0.20.0's tightened `ownsUrl`, which now rightly refuses an embedded applet the host page's address. The regions fix (applets destroyed and booted on swap) came free.

One deviation, noted for the next PUDL round: sudoku still reads and writes its `pc-sudoku` window continuity itself, because the runtime gives a window host no hand to give kept state back at boot; `opts.state` is only populated from the `data-applet-param` path, instances are not reachable from outside, and there is no applet-started event. Until the contract closes that loop (a state provider the host registers, or instance access on the mount), the applet keeping its own window shelf beats losing continuity.

### D26. PUDL 0.18.0 pinned; nothing adopted yet

0.18.0 (form states, in-page tabs with `pudl-tabs.js`, empty and loading states, tooltips with `pudl-tooltip.js`, pagination, the expenses sample) is pinned as of 2026-09-28 with no site-side change: only pudl.css moved, and the new scripts ride unused. Candidates when wanted: `pudl-tooltip.js` would name the site's glyph-only controls (gear, close-all, clear-filters, window buttons, the sudoku pad) from their aria-labels, but adopting it properly means removing the `title` attributes those controls carry today, or they tooltip twice. The palette focus miss Paul reports is not addressed by this release (pudl-menu.js is byte-identical to 0.17.0) and remains unreproduced in any automated habitat; open question for the PUDL agent once a reproduction exists.

### D25. PUDL 0.17.0 absorbed the go palette

The palette proposal (`pudl-proposal-go-palette.md`) shipped as 0.17.0's key-summoned menus, and the site's own palette is deleted the same day: the goto bar's markup, its site.js module and its styles are gone. In their place the layout carries a buttonless `.menu-panel` with `data-menu-key="/"`, which pudl-menu opens top-centre with focus in its filter. The panel is a launcher's body, one section per sitenav category plus the article list newest first, so typing now completes against everything the site offers; rows open windows on the desktop (`data-win-open`) and navigate to pages in the classic view. The filter sits in a GET form pointing at `/go` (with `nav=1` on classic pages), so Enter with no completion left still reaches an unlisted slug, and the whole thing works without script. pudl-menu.js now loads on every page, not only the desktop. Two behaviour notes: a `type="search"` filter's first Escape clears the text and the second closes the panel, and the Ctrl+Enter navigate-instead escape hatch from D22 did not survive the upstreaming (a window's ↗ covers the need). 0.17.0's data tables, notices and toasts (`pudl-toast.js`) ride in the pinned dist unused for now.

Two fixes from first use (Paul, 2026-09-28). The unlisted-slug path replaced the whole desktop, because the form sent only the slug and /go's redirect named one window; the form now carries the desktop's current state as hidden fields (server-rendered at page load, refreshed by desktop.js at the moment of submit), and /go merges the new slug into `open` and passes everything else through, so the new window joins what is open, filters included. And every `/pudl/` asset is version-stamped with `asp-append-version` now; a pinned-dist upgrade must reach every browser at once, and unstamped assets were the best explanation for a reported focus miss on summoning that no habitat reproduced. A third fix fell out of the test: the sudoku applet grabbed focus on mount, which raised its window over whatever the reader had on top; an applet takes focus only stand-alone or when its window is already the active one.

### D24. Sudoku rewritten against 0.16.0

The game's presentation layer was rebuilt (2026-09-28); the solver, generator and share-URL format are untouched, so old links keep working. One `render()` draws everything (cells, number pad, toolbar) from the game state, which cured the class of bugs where the pad's highlight lost its anchor to the board. Empty cells are empty now: pencil marks show only where entered, instead of nine ghost digits in every cell. The applet's own h1 is gone (its host names it), the mode is a Play|Edit seg per one-job-per-control, the emoji controls became inline SVG strokes per 0.16.0's glyph rule, help is a native `<dialog>`, and the board is a real ARIA grid with labelled, selection-marked cells.

It runs in four habitats, decided at init: a PUDL window and the bare `?frame` page fill their box (`pc-sudoku-fit`/`-app`), the classic article flows (`-flow`), and the bare page doubles as the web-app form, chrome hidden and nothing scrolling. Sizing is a measuring wrapper (`.board-box`), a size container taking the layout's leftover space, with the board at `min(100cqi, 100cqb)`; two lessons are recorded in the stylesheet: an aspect-ratio with a definite width will not transfer a max-height back to the width (the squashed-board bug), and a size container whose box depends on its own content collapses to zero, so the wrapper's size must come from flex stretch, never from the board. The keypad is 3x3 beside the board (numpad order, 7-8-9 on top) when the container is 640px or wider, and a single row beneath it otherwise.

Three follow-ups the same day. First, continuity in a window: a windowed game has no URL to live in, so it saves its board string to `pc-sudoku` browser storage on every change and resumes from it when a window opens; the share link stays the canonical form, the stand-alone page stays URL-only (so a page load never clobbers a windowed game), and Forget wipes the key. Second, an applet's page and window are the app itself, so the tag row and dates are suppressed for content whose loader flagged an applet mount (`IsApplet` on the content record; the desktop's own render chain and the /window endpoint both honour it, and page.cshtml checks the content). Third, the game is installable: `sudoku.webmanifest` (start_url the bare `?frame` form, display standalone) is linked from the article head, and content-head links render before the site manifest so the page-specific one wins. A cache note for the record: pudl-applets loads asset URLs literally, so the mount now carries `?v=` to bust stale copies; a reported loss of the invalid-red marking could not be reproduced in any habitat and was most plausibly a stale cached script.

### D23. PUDL 0.15.0/0.16.0: accessibility and the consistency pass

Two releases picked up together (2026-09-28). 0.15.0 (high contrast, reduced motion, right-to-left, print, localizable script strings) needed nothing site-side beyond the new dist. 0.16.0's consistency pass did: section tabs are now a notebook (raised tabs, flat current tab opening into the content), so the classic nav joined PUDL's `.app-section-bar` band outright, deleting the site's own strip styles, and sets `--section-current-bg: var(--bg)` because classic content sits on the page background; the right-side bare links strip the new raised tab chrome to stay underlined accent links per D16. State marking moved from `.active` to `aria-current` on section tabs and view links and to `aria-pressed` on the settings segments. The view switcher's anchor-mirroring styles are deleted, since `.seg a` with `aria-current` is native now (that upstream candidate is closed; the site keeps only the centering). `.fc-kind` renamed to `.filter-chip-kind` and sudoku.css's `--pr` to `--positive`. The settings dialog became a native `<dialog class="dialog">` opened by the gear's `command="show-modal"` button with `pudl-dialog.js` loaded for browsers without command support, which hands Escape, focus containment, focus return and the backdrop to the browser; site.js keeps only the marking, the choices, backdrop-click close and Forget. The dist now ships Inter in `pudl/fonts/`, which rides along.

### D22. The go-to-page palette

Some pages exist only to be handed out as links and are listed nowhere, and Paul wanted a way to reach one by typing its slug (2026-09-28). Pressing `/` anywhere outside an editable field shows a small raised bar, bottom-centered above the footer, holding one sunken input. What is typed reduces to a slug: a bare slug passes through, and a site-relative path, `/page/...` form or pasted URL of this site is trimmed down to one; anything else is refused by doing nothing. Enter opens the page as a window on the desktop and navigates to `/page/{slug}` in the classic view; Ctrl+Enter (or Shift+Enter) always navigates, for a page that reads badly framed. Escape or a click outside dismisses it. The bar is a server-rendered GET form, and `/go` answers it without script by redirecting to the same two URLs (`nav=1`, set by the classic pages' hidden field, picks navigation), so the feature never leaves URL-is-king: every result of the palette is an address that could have been typed. The window loader reads content files directly, so an unlisted slug needs no sitenav entry. The feature is deliberately undiscoverable; there is nothing to protect, since it reaches only what a URL already reaches. If it ever grows a second verb it becomes a command palette, which is on the PUDL-upstream watch list.

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
