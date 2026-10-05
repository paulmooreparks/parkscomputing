# Proposal to PUDL: choosing which side the sidebar is on

Parks Computing submits this proposal on 5 October 2026, for itself and for YAVCHN, which both use PUDL's master-detail layout (`.md-layout`) with a persistent sidebar handle (PUDL 0.51.0). It does not record an upstream decision.

## What the reader wants

Paul wants to choose whether the article sidebar sits at the left or the right of the screen. PUDL puts the sidebar at the start edge of the writing direction, which is the left in a left-to-right page, and the only way to move it today is to change the page's direction, which would also reverse its text and controls.

PUDL already handles a sidebar at the right, because it supports right-to-left pages. `pudl-md.js` reverses the drag and arrow-key directions when the body's direction is `rtl`, and the stylesheet uses logical properties for the sidebar's border and the handle. The work is mostly to let the sidebar's side be chosen apart from the page's direction.

## Behaviour

**An attribute on the layout says which side the sidebar is on,** such as `data-md-side="start"` (the default, as now) or `data-md-side="end"`. Logical values keep the attribute correct in either writing direction: `end` is the right in a left-to-right page and the left in a right-to-left one.

**At the end side, everything about the sidebar is mirrored.** The sidebar, its handle and its border move to the other edge. Dragging the handle toward the middle widens the sidebar and dragging it toward the edge narrows or collapses it, and the arrow keys on the handle follow the same mirroring that a right-to-left page already gets. The collapsed handle sits at the end edge.

**The narrow layout is unaffected,** since it shows the list or the detail pane, never both side by side.

**Changing the attribute at run time moves the sidebar at once,** without a reload, as PUDL already reacts to changes in `dir` and `data-md-collapsed`. The sidebar keeps its width and its collapsed state when it moves.

## The reader's choice is the site's

PUDL provides the attribute, and the site decides how a reader chooses and where the choice is kept. Parks Computing would offer it in its Settings applet's Windows card and keep it in the browser, as it keeps the other window preferences, and set the attribute before the first paint so the sidebar doesn't jump. If PUDL would rather offer the choice itself, a View menu command such as "Sidebar on the right" that toggles the attribute and raises an event the site can save from would suit both sites equally well.

## Related

The companion proposal, [peeking at a collapsed sidebar](pudl-proposal-sidebar-peek.md), opens a peek from whichever edge the sidebar is on.
