# Proposal to PUDL: the menu bar looks up command ids

Status: proposed 2026-10-20. The site carries a workaround, `window.pcCommandRows` in `wwwroot/js/applets.js`, marked `PUDL WORKAROUND`, and deletes it on the upgrade that does this. Recorded as D72 in `pudl-adoption.md`.

From parkscomputing.com, 2026-10-20, after moving the Editor and Files to PUDL 0.68.0's command table and folding toolbars.

## The problem

PUDL's own proposal for the command table (`docs/proposals/toolbar-commands.md`, "The command table") says that a row in `menus()` or `commands()` may be the id of a command in the applet's table instead of an object, so that a menu is written as `['undo', 'redo', '-', 'find']`. The toolbar does this in 0.68.0. The menu bar does not. `pudl-menubar.js` takes each row as an object, and `commandsOf` in `pudl-applets.js` drops any row that is not an object with a string `label` and a `run` function, so a string id in either list vanishes without a warning.

An applet that moves to the command table therefore still has to write its menu rows out as objects, copying each command's label, shortcut, disabled state and tick from the table by hand. That is the duplication the table was meant to end, and it drifts: a label changed in the table changes the toolbar and an agent's view of the command, while the menu keeps the old words.

## What the site does meanwhile

`pcCommandRows(table, ids)` turns a list of ids and `'-'` into the rows `menus()` returns. For each id it reads the command's label, disabled, danger, shortcut and checked at the moment the menu asks, turns a command with a `choice` into a radio row, leaves out a command that is `hidden`, and removes a separator that would come first, last or twice in a row once hidden commands are gone. The Editor's File, Edit and View menus and Files' Folder menu are built this way. Each `run` calls the command's own `run` with its `value` and does nothing while the command is disabled.

## The proposal

The menu bar resolves a string row through `pudlCommands`, in the scope of the applet whose menus it is drawing, exactly as a toolbar control with `data-command` does:

- A string other than `'-'` is a command id. The row takes the command's label, glyph, shortcut, `checked`, `choice` and `value`, `danger`, `disabled` and `reason`, all read when the menu opens, and running the row is `pudlCommands.run(id, value, scope)`.
- A command that is `hidden` leaves no row, and a separator left at an end or doubled by that is dropped, so an applet can write its full menu once and let the commands' own state decide what shows.
- A command with `items` becomes a submenu of its items, which may themselves be ids.
- An id the table does not have is reported once with `console.warn` and left out, so a typo is visible during development.

`commandsOf` in `pudl-applets.js` should accept the same strings for `commands()`, which feeds the window menu.

Nothing changes for an applet that writes object rows today; objects and ids can be mixed in one list.

## Why PUDL

The behaviour is already in PUDL's proposal and specification text, and the toolbar half shipped. Every applet that adopts the table needs the menu half, and each would otherwise write its own version of `pcCommandRows`, as GK Companion's Editor will when it moves.
