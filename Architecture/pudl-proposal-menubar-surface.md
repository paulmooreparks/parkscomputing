# Proposal to PUDL: a menu bar group with the surface of a neutral button

From parkscomputing.com, 2026-10-17, on PUDL 0.62.0.

Each group in the menu bar is drawn on `var(--menubar-group-bg, var(--tb-chip))`, with a border and shadow from the matching `--menubar-group-border` and `--menubar-group-shadow` hooks. In light mode the topbar rule sets `--tb-chip` to `var(--raise-grad)`, so the group has the same surface as a neutral, enabled `.btn`. In dark mode that rule does not apply, `--tb-chip` keeps the topbar's own chip color, and the group is drawn in a different color from a button. Paul asked that the menu bar surface, without its hover and open states, be the same color as a neutral button in both modes, as though the bar were a button with a menu glyph on its left.

## Behavior

**A menu bar group at rest uses the raised-control surface in every theme:** the background `var(--raise-grad)`, the border `var(--raise-border)` and the shadow `var(--raise-shadow)`, which are the values `.btn` uses. The hover and open states of its titles stay as they are.

**The three `--menubar-group-*` hooks keep working.** A host that sets them gets its own look, as it does now. Only their default changes, from the topbar's chip color to the raised-control tokens.

## Why

A menu bar group is a control a reader presses, and PUDL's raised surface is the look of a pressable thing. Two controls side by side that look unlike each other in one theme and alike in the other make the dark theme look unfinished.

## What the site does until PUDL ships it

The site sets the three hooks on `.menubar-menu` in `pudl-site.css` to `var(--raise-grad)`, `var(--raise-border)` and `var(--raise-shadow)`. The site deletes that rule when PUDL ships the change.
