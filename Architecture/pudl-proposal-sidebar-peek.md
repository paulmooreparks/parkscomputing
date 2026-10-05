# Proposal to PUDL: peeking at a collapsed sidebar

Parks Computing submits this proposal on 5 October 2026, for itself and for YAVCHN, which both use PUDL's master-detail layout (`.md-layout`) with a persistent sidebar handle (PUDL 0.51.0). It describes a behaviour Paul wants on both sites. It does not record an upstream decision.

## What the reader wants

Paul keeps the article sidebar collapsed so that the windows have the whole width. Getting to the list then takes a deliberate expand, and a second action to collapse it again afterwards. He would rather rest the pointer on the collapsed sidebar's edge, have the list slide out over the windows so he can scroll it and click an article, and have it go away again when the pointer leaves. When he expands the sidebar in the usual way, it should stay expanded, as it does now.

PUDL already has two states for a persistent sidebar, expanded and collapsed (`data-md-collapsed`). This proposal adds a third one, a temporary peek at a collapsed sidebar, which never changes the other two.

## Behaviour

**A site turns peeking on** with an attribute on the layout, such as `data-md-peek`. A layout without it behaves as it does today.

**Resting the pointer on the collapsed sidebar's handle opens a peek** after a short delay, around 200ms. A pointer that only crosses the handle on its way somewhere else, such as to the browser's own controls, doesn't open it.

**The peeked sidebar is drawn over the detail area,** at the sidebar's remembered width, raised above the windows with a shadow, from the edge the sidebar collapses to. The detail area doesn't reflow, so nothing behind the peek moves or resizes, and the windows are where they were when it closes.

**Moving the pointer off the peeked sidebar closes it** after a grace period of around 300ms, so a small overshoot while scrolling doesn't snap it shut. It stays open while one of its own menus or filter panels is open, or while the reader is dragging inside it.

**Choosing a row in the peeked sidebar closes the peek,** because the row opens what the reader came for, and the peek would otherwise lie over the window it just opened.

**The keyboard gets the same peek.** Moving focus into the collapsed sidebar opens it, and moving focus out of it, or pressing Escape, closes it and returns focus to the handle.

**Expanding is unchanged.** Clicking the handle, pressing Enter on it, dragging it open, or using the View menu's command expands the sidebar for good, as now, and expanding from a peek turns the peek into the expanded state without a jump. A peek never writes the collapsed state or the width that PUDL reports in `pudl:md-resize`, so the reader's saved choice survives it.

**Touch screens and narrow layouts keep their current behaviour.** A touch screen has no hover to peek with, and a narrow layout already switches between the list and the detail pane. A peek applies only to a wide layout with a pointer that can hover, which the site can tell from the `(hover: hover)` media feature.

**There is no pin button in the peek.** The handle already expands the sidebar, and a second control for the same act would add clutter.

## Events

PUDL would raise `pudl:md-peek` on the layout when a peek opens and when it closes, with `detail.open` true or false, so a site can, for example, pause something behind the peek. Neither site needs this today, so it is a suggestion rather than a requirement.

## Related

The companion proposal, [choosing which side the sidebar is on](pudl-proposal-sidebar-side.md), puts the sidebar at either edge. A peek opens from whichever edge the sidebar is on.
