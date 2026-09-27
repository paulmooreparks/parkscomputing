# Proposal to PUDL: the master-detail sidebar resize script

From parkscomputing.com, 2026-09-28. This one is already on PUDL's own list: the Status section has said since 0.6.0 that "PUDL ships no script yet for resizing the master-detail sidebar," and the stylesheet already carries the whole visual half, the `.md-resize` divider with its col-resize cursor and accent hover, and the `--md-sidebar-w` custom property the sidebar reads. Only the behavior is missing.

## Behavior

A pointer drag on `.md-resize` sets `--md-sidebar-w` on the layout, live, clamped to a sensible range (say 180px to half the layout's width). The divider is a `role="separator"` with `aria-orientation="vertical"`, which the reference markup already gives it, so with it focused the Left and Right arrow keys nudge the width and Home/End jump to the clamps; a double-click returns the default width. On a narrow layout, where master-detail shows one pane at a time, the divider is already hidden and the script does nothing.

Following the windows' pattern, PUDL keeps no state: `pudl:md-resize` fires on the layout after each change with the width in `detail`, and a project that wants the width remembered stores it and reapplies it, the same division of labor as `pudl:windows-change` and window placements. Width is a per-reader convenience, not addressable state, so it belongs in the reader's browser rather than the URL; parkscomputing.com will store it beside its other preferences and reapply it on load.

Whether the script rides in an existing file or its own `pudl-md.js` is a packaging call this proposal leaves open; the reference page's master-detail demo and the article reader sample both have layouts to demonstrate it on.

## What the site does when it ships

Render the `.md-resize` divider between its sidebar and detail pane (the desktop currently omits it, there being nothing to drag), listen for `pudl:md-resize` to store the width with its other reader preferences, and set `--md-sidebar-w` from storage at load. Nothing else changes: the fixed default width remains the no-script and first-visit experience.
