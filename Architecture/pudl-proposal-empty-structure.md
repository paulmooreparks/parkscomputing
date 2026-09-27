# Proposal to PUDL: empty components are still structure, and a theme that follows the system

From parkscomputing.com, 2026-09-28, following the window-workspace round that 0.11.0 and 0.12.0 absorbed. These are smaller. The first is the substantive one; the site works around both halves of it today in `wwwroot/css/pudl-site.css`, with comments marking each override for removal.

## 1. An empty component collapses visually, but keeps its place in the layout

**Problem, in two sightings.** PUDL removes empty components with `display: none` (`.win-dock:empty`, `.md-chips:empty`). Twice in one day that removal broke a layout that was using the component as structure:

- The desktop's toolbar makes the dock its only elastic element (`flex: 1`), so the filter group holds the left edge and the close-all control the right, however many tabs the dock wraps. Close the last window and the empty dock vanishes, the toolbar loses its elastic middle, and the right-pinned controls slide left.
- The chips row must render even when empty, because a region swap needs a counterpart of every region name (the regions README implies this; see 3). PUDL's `:empty` was meant to hide the empty row, but a server-rendered row contains the template's whitespace, which `:empty` counts as content, so the page showed a thin dead bar.

**Behavior.** An empty dock or chips row shows nothing and takes no height, but keeps its flex participation, so a layout leaning on it does not reflow when it empties. Concretely: prefer `visibility`-style emptiness over `display: none` where the component is plausibly load-bearing (the dock inside a toolbar), and select emptiness in a whitespace-proof way, `.md-chips:not(:has(.filter-chip))` rather than `.md-chips:empty`, since `:has` is already in PUDL's baseline. The dock case may be as simple as scoping the hide to docks outside a toolbar, or dropping it entirely, since an empty dock renders nothing anyway.

**Why PUDL.** Both rules are PUDL's own, and both failures need a project to override the language rather than theme it. Any server-rendered project hits the whitespace form of `:empty` eventually, because template engines pretty-print.

## 2. pudl-theme: a remembered "follow the system"

**Problem.** `pudl-theme.js` stores `light` or `dark` and starts dark when nothing is saved. There is no way for a reader to say "follow my operating system," which is what a third of readers expect a theme control to offer, and what the settings dialog on parkscomputing.com now presents as Light / Dark / System.

**Behavior.** The site stores `system` under PUDL's own `pudl-theme` key and applies it pre-paint with a three-line script placed right after `pudl-theme.js`, resolving it against `prefers-color-scheme`; a `change` listener keeps it live. Native support would be: `pudl-theme.js` treats a saved `system` (or, if you prefer, the absence of a saved value) as follow-the-OS, pre-paint, and `pudlToggleTheme` stays as it is. The default for an unsaved reader, dark today, is a separate decision this proposal does not touch.

**Why PUDL.** The storage key and the pre-paint moment belong to pudl-theme; a site extending them is reaching into PUDL's mechanism, politely but still.

## 3. A regions note for the README

Not a behavior change. The regions contract says a swap happens when the answering page "has a region of every name the current page has." The consequence for authors deserves a sentence in the README: a region that is sometimes empty, such as a chips row with no active filters, must render its (empty) element anyway, or navigations from the filtered state fall back to full page loads. The site learned this by doing it wrong first.

## Order

Proposal 1 is two small stylesheet changes and removes two site overrides. Proposal 2 is a few lines in pudl-theme.js and removes a site head script. Proposal 3 is documentation.
