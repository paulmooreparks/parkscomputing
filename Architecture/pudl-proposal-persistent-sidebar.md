# Proposal to PUDL: a persistent sidebar handle in responsive workspaces

Parks Computing submits this proposal on 3 October 2026, based on its deployed sidebar implementation with PUDL 0.42.0. This document describes the current behavior and proposes a boundary between reusable PUDL behavior and application policy. It does not record an upstream decision.

The canonical [Architectural Principles](<C:/Users/paul/OneDrive/Documents/Architectural Principles.md>) apply. This proposal extends the earlier [sidebar resize proposal](pudl-proposal-sidebar-resize.md), whose mobile behavior assumed that the divider disappeared. PUDL's [responsive workspace guide](https://github.com/paulmooreparks/pudl/blob/v0.41.0/docs/RESPONSIVE-WORKSPACES.md) provides the current component contracts.

## Why retain the handle?

When hiding the sidebar also removes its divider, the interface loses the visible connection between the list and the workspace. A reader must discover a separate command to bring the list back. Parks Computing now keeps the gripped divider visible when the sidebar is collapsed, including on a phone. The reader can drag that divider to recover the list.

The sidebar content does still become hidden. On wide layouts its width becomes zero and its visibility is hidden; on narrow layouts PUDL's existing single-pane CSS removes it from layout with `display: none`. In both cases the content stays mounted, becomes inert, and leaves the divider behind. The claim that the sidebar does not disappear refers to this persistent affordance, not to a strip of readable content remaining visible.

## What the application does today

### The divider occupies real space

The divider is an 18 CSS pixel band between the sidebar and detail area. It has a centered grip, a surface background, borders, and an accent treatment on hover, keyboard focus, and drag. Its width is part of the layout, so it does not cover adjacent content. The band remains 18 pixels wide when collapsed and at phone widths.

The taskbar spans the entire workspace below both panes and the divider. Its sidebar glyph button remains available independently of which pane is shown. The View menu exposes the same command. A separate Articles back link is no longer needed.

### Wide layouts resize continuously

Above 640 CSS pixels of layout width, the sidebar and windows can appear together. The default sidebar width is 300 pixels. Dragging changes that width continuously and clamps it to half the layout width. A requested width below 40 pixels collapses the sidebar; the divider remains visible at the edge. Dragging outward from that edge reopens the sidebar.

The site permits widths between the 40-pixel collapse threshold and the half-width maximum. It does not enforce PUDL's usual 180-pixel minimum while dragging. The 180-pixel value is used when reopening with an arrow key. These are current site choices, not proposed universal defaults.

The last expanded width and the collapsed preference are stored in browser-local preferences. The toggle restores the expanded width. A collapse drag preserves the width from before that drag, and a canceled drag restores the starting presentation without saving a new preference. Double-clicking the divider restores the 300-pixel default.

### Mobile layouts switch panes

At 640 CSS pixels or less, measured on the layout rather than the browser viewport, the sidebar and detail area appear one at a time. The visible pane fills the available body width beside the 18-pixel divider. The saved desktop sidebar width does not constrain the mobile list.

With the windows visible, the retained divider sits at the list's collapsed edge. Dragging it toward the workspace by at least 24 pixels reveals the list when the pointer is released. With the list visible, dragging its divider back toward the collapsed edge by at least 24 pixels returns to the windows. Directions reverse in right-to-left layouts. A smaller movement or pointer cancellation leaves the pane unchanged.

This gesture switches between two presentations. The mobile list does not follow the pointer as a partially open drawer, and the gesture does not save a new sidebar width. Returning to a wide layout uses the desktop width and collapse preference again.

### The application connects pane visibility to windows

To show the mobile list, the site records the currently visible window keys and the front window, then minimizes the windows through PUDL. To return, it raises the surviving windows from that recorded set, with the previous front window last. Windows that were already minimized remain minimized. If there is no saved set, the site can raise the current or most recently opened window. Readers and applets remain mounted.

The button and menu command follow the resulting presentation, including changes caused by opening, minimizing, restoring, or closing windows. Their labels are Show sidebar, Show article windows, or Hide sidebar as appropriate. The glyph indicates whether the sidebar is expanded. When the mobile list is visible and no windows are open, the command to return to windows is disabled.

This window policy is application behavior. A generic sidebar may accompany a document, a form, or another pane with no window manager at all.

### The divider supports keyboard operation

The divider is a focusable vertical separator with an accessible name, `aria-controls`, and current, minimum, and maximum values. Collapsed state reports zero and the value text Sidebar collapsed. The taskbar button exposes its expansion state and current action through its accessible label and tooltip.

| Input | Wide layout | Narrow layout |
| --- | --- | --- |
| Arrow toward expansion | Increase by 16 pixels; reopen to at least 180 pixels | Show the list |
| Arrow toward collapse | Decrease by 16 pixels | Show the windows |
| Shift with an arrow | Use a 64-pixel step | Keep the pane-switch behavior |
| Home | Collapse | Show the windows |
| End | Expand to half the layout width | Show the list |
| Enter | Toggle | Toggle |
| Double-click | Restore the 300-pixel default | Toggle |

The current separator tooltip describes dragging. PUDL should decide how its accessible instructions distinguish mobile switching from desktop resizing. An 18-pixel band also warrants touch-target review; the independent taskbar button provides an alternative, but that does not settle the appropriate default target size.

## Proposed division of responsibility

PUDL could offer an opt-in collapsible master-detail divider. Existing layouts would retain their current behavior unless they opt in. The useful shared contract is that collapse removes the sidebar content from interaction while retaining an operable handle, and expansion restores the remembered presentation without remounting either pane.

| Candidate for PUDL | Reason |
| --- | --- |
| Persistent divider markup and styling | Every host otherwise recreates the grip, focus treatment, and collapsed-edge layout |
| Independent target and visible-rule sizing | The same distinction already exists for PUDL splitters |
| Desktop resize, collapse, reopen, and cancellation | These gestures depend on component geometry rather than application data |
| Configurable default width, limits, and collapse threshold | Applications need different usable sidebar widths |
| Narrow-layout reveal and dismiss intent | A retained handle should work without knowing how the application presents its detail pane |
| Keyboard semantics, accessible values, and RTL handling | These should be consistent across hosts |
| Change notifications with documented timing | Hosts need to synchronize controls and save committed preferences |

| Responsibility retained by the application | Parks Computing's current choice |
| --- | --- |
| Meaning of switching panes | Show the article list or the window workspace |
| Window lifecycle policy | Minimize visible windows and selectively restore them |
| Persistence and addressability | Keep desktop width and collapse preference in local storage; let window actions use PUDL's window state |
| Command placement and language | Provide a taskbar button and a View menu command with context-dependent labels |
| Taskbar content | Show article and applet buttons with application-selected icons |

The narrow gesture should request a presentation change from the host through a documented contract. PUDL should not make minimizing all windows the general meaning of revealing a sidebar. The host must be able to decline a request, for example when there is no detail content to return to, without leaving the divider or its accessible state out of sync.

The contract should distinguish the last expanded desktop width, whether the desktop sidebar is collapsed, and which pane is presented in a narrow layout. Keeping those values separate prevents a phone transition from overwriting a useful desktop width. PUDL can expose state and notifications while leaving storage keys and URL policy to the host.

## Questions for upstream review

- Should the persistent handle extend `pudl-md.js`, or should it become a reusable collapsible-pane capability shared with splitters?
- Should narrow layouts support only a reveal or dismiss request, or also offer an optional continuously dragged drawer? The deployed site needs only the request.
- Which sizing and gesture thresholds should have component defaults, and which should require host configuration?
- Should PUDL supply a standard sidebar toggle glyph and state synchronization helper while leaving button placement and labels to the host?
- What focus-transfer contract should apply before hiding a pane that contains keyboard focus, and when a focused divider changes position after switching panes?

Parks Computing recommends adopting the persistent handle, sizing mechanics, and accessible interactions first. The mobile window restoration policy should remain in the application. The exact attributes, token names, event payloads, and event timing need an upstream design decision before the site depends on them.

## Evidence and adoption checks

The implementation is in [window-bar.js](../Application/parkscomputing-engine/wwwroot/js/window-bar.js), [pudl-site.css](../Application/parkscomputing-engine/wwwroot/css/pudl-site.css), and [Desktop.cshtml](../Application/parkscomputing-engine/Pages/Desktop.cshtml). The [desktop browser checks](../Tools/test-desktop-cleanup.js) exercise the retained 18-pixel divider, drag reopening and collapse, keyboard operation, mobile restoration, and automatic toggle state. They passed against localhost and the public site during the PUDL 0.42.0 upgrade.

An upstream implementation should additionally verify cancellation, RTL gestures, breakpoint changes during a gesture, focus leaving a hidden pane, and disabled host requests. Those cases belong in component acceptance checks; the current application test suite does not establish all of them.

If PUDL adopts this behavior, the site can replace `.pc-sidebar-resize` and its local gesture and keyboard handlers with the supported component. It would retain its window restoration adapter, persistence, and command placement. This proposal does not request changes to PUDL's runtime until that boundary is agreed.
