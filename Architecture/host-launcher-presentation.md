# Content launcher presentation

Paul selected PUDL's [Content host study](https://paulmooreparks.github.io/pudl/samples/host-launcher-content.html) as the direction for parkscomputing.com on 2026-11-06. The reference for this decision is the study shipped with PUDL 0.99.0, commit `68fcc2b6031539cc27f0c33d0e7a336e1c8d621c`. The library upgrade precedes the site presentation migration.

The window view will provide a content catalog that can open from the site identity in the menu bar or stay pinned beside the reading workspace. The earlier brief introduction remains on the desktop behind the windows, without grouped starting links or a Home button. The taskbar will span the viewport below the catalog/workspace split, including when no windows are open.

PUDL's documented `pudlStart` and `pudlLauncher` controls will own catalog interaction and launcher presentation. The site will render destinations from its navigation and content model and retain responsibility for routing, filter URLs and stored preferences. Existing article and applet destinations must remain addressable, and classic pages must retain usable links without JavaScript. The canonical Architectural Principles at `C:\Users\paul\OneDrive\Documents\Architectural Principles.md` apply.

Paul authorized implementation on beta on 2026-11-06. The launcher replaces the sidebar's browsing surface. Pins remain in the top bar, following Paul's review, pending the upcoming PUDL release. Its categories replace the old category checklist, following Paul's clarification in the same session. Text search and multi-select tags remain, with removable tag chips and a Clear action. Tags retain their existing union semantics; the category and search further narrow those matches. Search follows PUDL's global-search behavior: typing returns to All, and selecting a category then narrows the search.

Catalog state uses the existing `q`, `cat` and repeated `tag` URL parameters. Filter changes operate on the mounted catalog, preserving article and applet instances. Category and tag changes create history entries; typing replaces the current entry. Back and Forward restore the catalog from its address. Old multi-category links resolve to their first category in the enhanced launcher, and the address is normalized to that selection.

The identity title and hamburger open the launcher. The menu bar remains available for site and active-application commands. Pins remain in the top bar. The launcher header offers Settings and Sign in, or Your account for a signed-in reader. About Parks Computing is in Help. The launcher presentation uses the `launcher` URL parameter and a browser preference. Pinned width, category-divider width and popup dimensions are browser preferences. A first visit starts open and pinned on both desktop and phone; returning visits retain their saved presentation unless the URL specifies one. On a phone, selecting a destination from a pinned launcher collapses it so the window can be read. A pin keeps the catalog beside the workspace on wide screens.

The implementation uses `Pages/Desktop.cshtml`, `js/launcher.js` and the documented PUDL launcher APIs. The shared layout opts into the launcher only for this desktop view; classic and admin pages retain their existing navigation. Deployment is limited to beta until Paul approves production.

The Go and Applets host menus are consolidated into the catalog. Applet entries continue to use the menu builder's audience rules, including staff tools absent from the public navigation tree. The shared View, Window and Help menus and contextual applet menus remain. The old article-list toggle and side preference are absent from this desktop.

The desktop introduction comes from `content/desktop-welcome.md`, restored in its earlier card layout with references updated for the launcher and the taskbar below. Beta overlays this one content file through a read-only bind mount; the production content tree is unchanged.

## Beta verification

The .NET suite passed 137 tests, with six existing skips. `Tools/test-launcher.js` passed against beta in Chromium, checking filter addresses, tag chips and Back, preservation of the mounted About window, splitter persistence, immediate pin/unpin, activation dismissal, keyboard result navigation, the full-width taskbar, phone popup and pinned navigation, classic pages and a JavaScript-disabled catalog. Light and dark screenshots were inspected. The small-package browser suite passed, and a signed-in regular account retained its account links while staff-only items remained absent. Staff role selection continues through the existing menu builder, whose audience tests pass; an elevated account was not exercised in this browser run.

The earlier region-navigation module is not loaded on the launcher desktop. A debugger breakpoint established that its Back handler found zero regions and requested a full navigation, replacing the open window. The launcher now restores catalog state on Back itself, while the window manager restores windows. Classic and admin region behavior is unchanged.

Screenshots and test output are under `.local/beta/uitest/launcher-*`. Production was checked after beta deployment and still renders the previous sidebar layout. No production promotion or commit is part of this change.


## Header and footer review

Paul's beta review on 2026-11-06 keeps Pins in the top bar and removes the Classic link from the launcher. The existing top-bar view selector still offers Classic. Size always occupies a reserved column at the bottom-right of the footer, including while disabled in a pinned launcher. It is the only footer control.

The visible site name is removed from the launcher header. Settings and Sign in occupy that space, with Pin and Close at the right; Home was removed in the later introduction review. A signed-in reader sees Your account instead of Sign in. Settings uses gear, and Sign in uses account; the top-bar Sign in also carries the account glyph. Create account is offered inside the Sign in dialog. About Parks Computing moves into Help. The launcher retains an accessible name without repeating the visible site title.

The revised beta passed the launcher browser check, including visible Sign in glyphs, the existing Create an account entry in its dialog, Home minimizing without closing windows, About in Help, Pins remaining in the top bar, and Size's reserved bottom-right geometry on desktop and phone in popup and pinned presentations. A regular account completed the sign-in confirmation and showed Your account in the header. The .NET suite again passed 137 tests with six skips. Updated light, dark and phone screenshots were reviewed.

Paul's next review adds vertical inset above the items heading and a static 180 ms accent highlight before plain window-destination and header-action activation. Modified and native new-tab links keep their browser behavior. The launcher browser check verifies that selection is highlighted before the launcher collapses. The sign-in form now places the passkey alternative above the final Cancel and Email me a link actions, with spacing and divider rules between sections; its passkey button remains a non-submit control in the same form. The browser and 137 unit tests pass. [The PUDL findings](pudl-proposal-launcher-feedback.md) separate the shared-control requests from the site's sign-in layout.


## Introduction and keyboard hint review

Paul removed Home and the grouped desktop content in the next beta review. The original introduction card is restored, and a first-time visitor sees the launcher open and pinned, including on a phone. Saved launcher presentation continues to govern returning visits. The header retains Settings and the account action.

The footer's left side now gives the muted hint "↑↓ Browse · Enter Open · Esc Close". It hides when the launcher's own width is 420px or less, leaving Size's reserved right column intact. Escape collapses a focused pinned launcher as well as dismissing a popup; nested popovers keep their own Escape behavior.

The revised beta passed `Tools/test-launcher.js`, including first-time pinned presentation and saved-state restoration in independent desktop and phone contexts, hint hiding after narrowing the popup, Size geometry and removal of the grouped content and Home button. The Tags popover is checked before collapsing a pinned launcher on Escape, including when focus remains on its opener. The 137 unit tests pass with six existing skips. The restored introduction, narrow first-visit launcher and light/dark footer screenshots were reviewed; production's welcome content remains unchanged.


## PUDL 0.100.0 integration

The launcher now uses the published heading inset and activation feedback from PUDL 0.100.0. Destination operations execute in the original click. PUDL highlights the accepted item and delays popup dismissal by 180 ms; a pinned desktop launcher stays open. The phone host changes its pinned layout after the same interval, with cancellation when filters, presentation or the viewport change. Local click replay and heading styling are removed. Header destinations use the documented `data-launcher-activate` attribute.

The background introduction explains category browsing, search and Tags, and tells readers to unpin the launcher for more window space and reopen it from Parks Computing in the top bar.


## Folded menu discoverability

The folded menu currently repeats Parks Computing as both the group heading and the launcher action. Paul reported that this hides the route back to the launcher. The proposed folded action is Launcher with a recognizable glyph, while the expanded identity button retains the site name. PUDL 0.100.0 builds this action from the identity title and provides no documented separate label. This needs an upstream presentation contract; the host should not rewrite PUDL-generated menu nodes. An Open launcher action already exists under View as an additional route.
