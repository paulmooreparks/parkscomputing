# Proposal to PUDL: docking at any edge from the window menu

**Shipped in PUDL 0.48.0** (`pudl-adoption.md`, D62): the window menu lists Dock at Top, Bottom, Left and Right, and Undock. PUDL left content-sized windows undockable, as its specification says. What follows is the text as it was sent.

From parkscomputing.com, 2026-10-05. Paul wants to dock the moderation queue's window at the top, the bottom or a side of the desktop. PUDL 0.47.0 already docks a window at any of the four edges: the modes `dock-top`, `dock-bottom`, `dock-left` and `dock-right` exist, `pudlWindows.dock(key, edge)` takes all four, and `docs/proposals/docked-windows.md` sets out how each behaves. But a reader can reach only one of them. The window menu offers Dock at the bottom, and dragging a window to the desktop's foot docks it there; nothing offers the top or the sides. This proposal asks for the other three in the window menu.

## Behavior

**The window menu's Dock at the bottom becomes a Dock submenu,** in the place it has now, after Snap to a zone, built the way Snap to a zone is: a title with its own list.

**The submenu lists the four edges,** Top, Bottom, Left and Right, in that order, each a checkbox item checked when the window is docked there, as Snap to a zone checks the zone the window fills. Choosing an edge docks the window there, taking that strip from every other window, exactly as `pudlWindows.dock(key, edge)` does.

**A docked window's menu also offers Undock** at the end of the submenu, after a separator, returning the window to where it floated before, as Undock does now.

**On a narrow screen,** where a side dock already shows at the bottom (rule 8 of `docked-windows.md`), the submenu still lists all four, since the window keeps its mode and docks at its side again on a wider screen.

**Dragging stays as it is:** dragging a window to the desktop's foot docks it at the bottom, and dragging a docked window away undocks it. Dragging to the other edges is not asked for here; the menu is enough, and dragging to the top edge would compete with maximizing.

## A question about windows sized to their content

The window menu withholds Maximize, Snap to a zone and docking from a window sized to its content (`data-win-size="content"`), which keeps its size. Parks Computing met this when Paul tried to dock its moderation queue, which it had sized to its content. The site has made the queue an ordinary window, since the queue grows and shrinks, so this proposal does not depend on the answer. But it may be worth deciding whether docking should be offered to a content-sized window too, taking its natural height (for a top or bottom dock) or width (for a side) as the strip's starting size, since a palette or a small tool is exactly the kind of window a reader wants to keep at an edge.
