# Proposal to PUDL: snap zones

**Shipped in PUDL 0.33.0**, and the site has adopted it (`pudl-adoption.md`, D45). What follows is the proposal as it was sent.

From parkscomputing.com, 2026-09-30. The site's admin desktop runs terminals, an editor and a file browser side by side, and the public site's Window view is used the same way on a wide screen. PUDL windows today can float, fill the layer, or take the left or right half. Paul wants more snap targets on both sites, and he has ruled out tiling for now, so this proposal adds snap targets and nothing that arranges windows on its own.

## The problem

Two halves are too few once there are more than two things to watch. Three terminals and an editor, or an editor with a terminal under a narrow file listing, all end in floating windows placed by hand. Floating windows placed by hand overlap by a pixel here and leave a gap there, and they have to be placed again whenever one of them changes.

## Behavior

**A snapped window is a zone.** A zone is a rectangle of the layer on a grid of halves and thirds, and it follows the layer when the layer is resized, as the halves do now. The placement grammar already carries a rectangle in fractions, so a zone needs one new mode and no new syntax:

```
p.term=zone:0,0,0.5,0.5        the top-left quarter
p.editor=zone:0.333,0,0.667,1  the right two-thirds
```

`left` and `right` stay valid and mean `zone:0,0,0.5,1` and `zone:0.5,0,0.5,1`, so existing addresses keep working. A zone's edges are rounded to the nearest sixth when the address is read, which keeps a zone on the grid however the fractions were written. A zone window is drawn flush, as a half is now, without the floating window's shadow.

**Reaching a zone.** PUDL offers four ways, from the quickest to the most complete.

1. A drag that ends at an edge snaps to the half there, as now. Ending it at a corner snaps to that quarter. The top edge still maximizes.
2. The maximize button gets a small layout picker, opened by hovering over the button for a moment, by a right-click, or from the keyboard (below). The picker shows thumbnails of the halves, the quarters, the thirds, and the two-thirds with one-third, and a click on a thumbnail's region snaps the window there. The picker is a PUDL menu, so it is reachable and readable as any menu is.
3. With the title bar focused, Shift+Left and Shift+Right snap to the left or right half. Pressed again from a half, Shift+Up and Shift+Down take the quarter above or below. Shift+Up on a floating window maximizes it and Shift+Down restores it. A key that opens the layout picker is left to PUDL's keyboard conventions.
4. `pudlWindows.snap(key, zone)` does the same from a script, with `zone` as a rectangle or one of the names `left`, `right`, `top`, `bottom`, `top-left`, `top-right`, `bottom-left` and `bottom-right`.

**Restoring.** Dragging a zone window lifts it back to its last floating size, as dragging a half does now. The maximize button's restore state treats a zone as snapped, not floating.

**Opening from a snapped window.** The rule from the window-workspace proposal, that a window linked from another opens in its opener's mode, carries over. A window opened from a zone window opens in the same zone.

## Why PUDL

The mode list, the snapping during a drag, the placement grammar and the flush drawing are all inside `pudl-windows.js` and `pudl-windows.css`. The zone is a small generalization of the halves they already have, and a project can't add it from outside without re-implementing the drag. Every project with windows gets it, and on parkscomputing.com both the public Window view and the admin desktop take it without site code.

## Zones and docked windows

This proposal was written against 0.29 and predates 0.30.0's docked windows. The two fit together without new rules: a zone is a fraction of the inner area the docks leave, as 0.30 already makes every floating and maximised window's fractions, so a zone never covers a docked window and a dock taking or giving back an edge moves the zones with it. Dragging to the foot of the workspace docks a window there, as 0.30 has it, so the bottom corners snap to their quarters only when the drag ends at the corner itself, not along the bottom edge.

## Left out

Tiling, where windows divide the space among themselves and never overlap, is a larger change with its own questions about what happens when a window opens or closes. Nothing here rules it out later, and a zone is the unit a tiling layout would place windows in.
