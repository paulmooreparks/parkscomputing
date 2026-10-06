# Snapshots: coming back to exactly where you were after a reload

Status: built and tested on parkscomputing.com, 2026-10-07, as a trial of a contract meant for PUDL. This document records what the trial does, what it found, and what it can't do, so that the PUDL proposal can be written from it.

## What a reload kept before this, and what it lost

The address already keeps a lot. It says which windows are open, where they sit, their sizes, which is in front and which are minimised, and PUDL's applet state string (`state()` and `setState()`) keeps whatever an applet wants to be linkable, such as the Editor's front file. Three applets also keep their state string in local storage through `js/continuity.js`, so their window comes back to it.

A reload lost everything else. Every window went back to the top of its content. The Editor lost its cursor, selection, scroll, undo history and search, along with its tabs and unsaved text until the work of 2026-10-06 kept those. Files lost its folder, its selection, the folders open in its tree and its scroll. The terminal lost its screen, its scrollback and the command being typed. The keyboard focus went to whatever PUDL focuses first.

## The trial contract

`js/snapshot.js` is the host. An applet takes part by calling it from `init()`:

```js
var snap = window.pcSnapshot.join(root, take);
// take()          returns plain JSON for what the applet would need to carry on, or null
// snap.kept       what take() returned before the reload, or null
// snap.focused    whether the keyboard was in this applet when the page went
// snap.changed()  says something changed, so it is kept within half a second
// snap.leave()    called from destroy()
```

A snapshot and a state string answer different questions. The state string says what a link to the applet should open, so it belongs in the address, it is small, and anyone can share it. A snapshot says where this reader was in this browser tab a moment ago. It can be large, it holds unsaved work, and it should never leave the browser.

In PUDL the same contract would read naturally as an optional `snapshot()` method beside `state()`, with the kept value arriving as `opts.snapshot` and `opts.focused` at `init()`, and `pudl:applet-snapshot` events for a host that keeps them somewhere else, as `pudl:applet-state` does today. The window layer would own the scroll positions and focus described below, since it owns the windows. The applet reload proposal (`pudl-proposal-applet-reload.md`) would use the same method: an instance restarted with new code could be handed its snapshot as well as its state, which would make reloading an applet lose nothing at all.

## How the host behaves

**Snapshots are kept in session storage.** Session storage belongs to one browser tab, survives a reload, and comes back when the browser reopens a closed tab or restores a session. Two browser tabs therefore keep apart, and nothing a snapshot holds goes to the server. A new browser tab starts fresh, which matches what a person expects of a new tab.

**They are taken often enough that a crash loses little.** An applet's `changed()` schedules a save half a second later. Every snapshot is also taken when the page is hidden or unloaded (`visibilitychange` and `pagehide`), which covers a reload, closing the tab and switching away.

**A window's snapshot goes when the window is closed.** Closing a window on purpose means starting afresh next time. Only a window the page has seen open and then closed counts, because until the window layer has read the address, every window looks closed.

**Each is keyed by where the applet runs.** A window's applet is keyed by the window's key and the applet's name, so `terminal` and `terminal-2` keep apart. An applet on a page of its own is keyed by the page's path and the applet's name.

**Switching between the window view and the classic view takes the work along.** An applet's first instance takes the newest snapshot of that applet from either view, by the time each was taken, and the others are deleted so an older one can't come back later. A second or third instance has no page of its own, so it keeps to its own key.

**The host keeps every window's scroll, and which window had the keyboard.** It records each window body's scroll, the scroll of a framed page of the site's own, and the article list's scroll. Each place is put back once the window has arrived and has enough content to scroll to, which for a fetched window is a moment after the page loads. A minimised window has no layout, so it reads as unscrolled; its place is kept as it was and put back when the reader shows the window. If the reader scrolls an element before its place is put back, the reader wins.

## What each applet keeps

**The Editor** keeps every tab with its unsaved text, its cursor and selection, the line at the top of its view and how far into that line, its undo history, and its search query with whether the search panel was open. It also keeps which tab was in front, whether the preview was showing, and the state of its file pane. The cursor, selection and history are CodeMirror's own serialisation (`EditorState.toJSON` with `historyField`), and are applied only to the text they were taken from. For a tab with changes that is the draft. For a tab without changes it is the file as it was then, which the snapshot recognises by its length and a hash. A file changed somewhere else since opens as it is now, with its cursor on the same line number and its old history let go.

**Files**, and the Editor's file pane, keep the folder, the selection, the folders open in the tree, and the scroll of the tree and the list. The folder matters because a Files window's address does not keep it.

**The terminal** keeps its screen and scrollback, written out by xterm's serialize add-on with colours, and the command line being typed. The screen is drawn again and the line put back, so the reader can carry on typing. The folder is the state string's.

## Edge cases found, and what happens

- **The Editor's scroll came back a few pixels off.** CodeMirror's scroll-into-view adds its own margin, so the place is now put back by bringing the line into view and then setting the offset into it in the same terms it was read in. The test checks it to the pixel.
- **Opening the search panel during a restore cancelled the scroll.** The pending scroll checked whether the editor's state had changed, which the panel opening does. It now checks whether another tab came to the front instead.
- **Tabs reopened during a restore recorded each other's place as the top.** A place asked for and not yet reached now still counts as the tab's place.
- **A file changed somewhere else while open threw the cursor to the top**, and undo then took the outside change back. This was there before snapshots. The Editor now replaces only the part between what the two versions share at their start and at their end, and marks it as not for undo (`Transaction.addToHistory`), so the cursor stays on its line and undo touches only the reader's own edits.
- **A Files window came back to `/site` after a reload.** Its address never kept its folder. The snapshot now does.
- **A program running in the terminal at the reload**, such as `less`, `edit` or an ssh session, has ended with the page. The screen as it was before the program is drawn again, a line says the program ended, and a fresh prompt follows. A full-screen program's own screen is not kept.
- **Closing a window opened from the address didn't forget its snapshot**, because the host had not seen it open. The host now records the windows open at load.
- **Switching views could pick up an older snapshot** left by an earlier visit to the other view in the same tab. Snapshots now carry the time they were taken, and the newest wins.
- **A snapshot too large for the browser** loses the Editor's undo history first, from 1.5 MB, and the terminal's scrollback falls back to its last 300 lines from 600 KB. A snapshot still refused is reported in the console, and the one before it stays.
- **Session storage that can't be used**, as in some private modes, leaves every applet starting as it did before snapshots.

## What it can't do

- A live connection, such as an ssh session, can't survive the page. Keeping one would need the server to hold sessions open between page loads, which is a much larger piece of work.
- A framed window showing another site's page can't be read, so its scroll is not kept.
- A window whose key changes (`pudl:window-rekey`) loses its snapshot, since snapshots are keyed by window. PUDL owning snapshots would fix this.
- The terminal's line is put back with the same redraw the terminal uses for editing, which clears only the last row, so a command line long enough to wrap is drawn twice.
- Applets other than the Editor, Files and the terminal don't take part yet. The Sudoku board, the barcode tool and the terminal's folder already come back through `js/continuity.js`. Conway, Settings, Theme Studio, the diff viewer and the rest would each need a `take()` of their own, and are worth it only where they hold work a person would miss.

## Tests

`Tools/test-snapshots-editor.js`, `Tools/test-snapshots-terminal-files.js` and `Tools/test-snapshots-edges.js` drive a real browser through reloads, 34 checks in all, against a local site signed out so that `~` is the browser's. They passed in full on 2026-10-07.
