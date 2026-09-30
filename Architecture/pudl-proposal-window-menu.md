# Proposal to PUDL: the window menu

From parkscomputing.com, 2026-09-30. An applet in a PUDL window has had nowhere to put commands of its own, so the site's terminal grew a settings gear inside its screen, which Paul found out of place. His answer, after Andoneer's cards, is a menu on each window: the window's own commands first, and below a separator the commands of what the window holds. It runs on the site today, in `wwwroot/js/window-menu.js` and `wwwroot/css/window-menu.css`, with its markup in the site's window partial.

## Behavior

**A menu button at the left of the title bar** (Paul, 2026-09-30), one of the window's round raised buttons, drawn with the caret glyph. It opens a PUDL menu panel.

**The window's commands come first:** open as a page, minimize, maximize or restore (its label following the window's mode), and close, each carried out through the same `data-win-action` PUDL already handles, so the menu adds no new behavior of its own. Close stands last, after a separator, as it does in most desktop menus. The commands PUDL does not yet have as actions would join them when it does: snapping to the halves and the zones of the snap-zone proposal, and resetting a window's size and position.

**The content's commands come below a separator.** Each time the menu opens, `pc:window-menu` fires on each applet mount in the window, with `detail.add(label, run, { checked, disabled })`. An applet adds what applies at that moment: the terminal adds Settings…, Clear the screen and New terminal here; the Editor adds New, Open…, Save as…, and Show the files and Wrap lines, which carry a check while they are on. Asking at each opening keeps the labels true without the applet having to announce changes.

**On an applet's own page**, where there is no title bar, an applet with commands fires `pc:applet-commands` on its mount when it starts, and a small menu button appears in the mount's top corner holding the same commands, gathered the same way. So one set of commands serves both hosts.

**A host may override the window's commands.** The existing cancelable `pudl:window-closing` already lets content refuse a close; the same pattern would let it take over another command.

## Why PUDL

The window's commands are PUDL's already, and the menu is a second way to reach them, beside the title bar's buttons. The applet half belongs with `pudl-applets.js`, whose handshake already carries state between an applet and its host; commands are the same kind of contract. As a PUDL feature, the event would likely be `pudl:window-menu` on the mount, and the page stand-in part of the applet runtime. If PUDL adopts it, the site deletes its script and styles and renames the event.

## A small related request

PUDL has no gear glyph. The site drew one for a Settings entry in the same style as PUDL's while it had a Start menu, and would use PUDL's for such entries if it had one.
