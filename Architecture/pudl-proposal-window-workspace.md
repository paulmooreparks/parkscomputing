# Proposal to PUDL: the windows are a workspace, and navigation must respect it

From parkscomputing.com, 2026-09-27, following the seven adopted in 0.9.0 and 0.10.0. Paul ratified all three behaviors on the site; they run there today in `wwwroot/js/desktop.js`, and each is written so a PUDL-native form can replace it. The theme is one observation: once windows hold scroll positions and running applets, anything that repaints them without cause breaks the promise the windows made.

## 1. A linked window opens in the state of the window it was linked from

**Problem.** Every window the site serves opens maximized by markup default. That is right for a first open from a list, and wrong for a link followed from inside a window: a reader who restored an article to a floating window, then followed a link in it, got a maximized window slammed over their arrangement. The generalization Paul named: a new linked window opens in the same state as the window it was linked from.

**Behavior.** When a `data-win-open` link inside a window opens a new top-level window with no placement in the URL, the new window takes its opener's mode. A floating opener's geometry carries over cascaded a small step (the site uses +0.03 on x and y), so the opener stays visible behind the new window. Maximized begets maximized, and a snapped half begets the same half. Exempt: `data-win-replace` links, which already keep the old window's placement; opens from outside any window (a sidebar, a tab, a dock), which keep the markup default; and a `pudl:window-place` listener, which still wins.

**Why PUDL.** `pudl-windows.js` already holds everything needed: `open(key, opener)` receives the opening element, `opener.closest('.win')` names the host window, and the state has its placement. The site instead tracks the last opener click and answers `pudl:window-place`, which works but re-derives what the module already knows. As a default in the module, every project gets the behavior and the site deletes its tracking.

## 2. A navigation that changes only the list must not disturb the windows

**Problem.** Switching category tab, removing a filter chip, and submitting the filter are navigations, so the server re-renders and the page reloads. But those actions change only the list chrome. The reload re-fetches every open window: scroll positions vanish, and a running applet restarts mid-game. Separately, the server renders those links with the window parameters as of page load while the script keeps the live state in the URL, so a stale tab link also resurrects closed windows.

**Behavior.** The site intercepts same-path navigations from the section bar, the chips row, and the filter form; fetches the target URL; swaps only the section bar, the chips row, and the sidebar; pushes the URL; and leaves the window layer alone. It also refreshes those links' window parameters from the live URL on every `pudl:windows-change`. Back and Forward swap the list chrome the same way while `pudl-windows` reconciles the windows. The URL and history are byte-for-byte what the full navigation would have produced, so a browser without script loses nothing, and a bookmark of the fetched URL renders identically.

**Why PUDL.** Any project with a list beside a window layer hits this the day it adds a filter or a tab. PUDL already owns both halves of the contract: the master-detail regions are its vocabulary (`.md-sidebar`, `.app-section-bar`, `.md-chips`, `.md-filter`), and the invariant "the server renders what the URL names" is what makes the swap safe. A shape that stays small: the layer (or the layout) opts in, say `data-soft-nav` on `.md-layout`, and same-origin, same-path link and filter-form navigations inside the marked regions become fetch-and-swap of those regions, with the live-window-parameter refresh included. The site's `softNavigate`, `swapListChrome` and `syncNavState` are the working reference.

## 3. The filter gets an accept affordance

**Problem.** PUDL's `.md-filter` is a bare input. On the site it narrows the list live, but its Enter behavior (a real navigation that makes the filtered state a history entry) has no visible control, which breaks the language's own rule that what can be pressed looks pressable.

**Behavior.** An apply button sits at the input's right: an `.icon-btn` carrying a magnifying-glass glyph, `type="submit"` in the filter's form. With script it is the same soft navigation as proposal 2; without script it is the form's plain GET.

**Why PUDL.** It is one documented pattern, not new machinery: the README's toolbar examples would show the input and button as a pair (a `.md-filter-group`, or just documented markup), and the reference page's master-detail demo would carry it. The glyph belongs in the stylesheet like the window buttons' glyphs, so projects do not each invent one.

## Order

Proposal 1 is small and self-contained. Proposal 3 is markup and documentation. Proposal 2 is the substantial one and subsumes the site's remaining navigation script; if it lands, parkscomputing.com deletes `softNavigate`, `swapListChrome`, `syncNavState` and the opener tracking, leaving desktop.js with content enhancement only, which is the right end state: the site should hold what is site-specific and nothing else.
