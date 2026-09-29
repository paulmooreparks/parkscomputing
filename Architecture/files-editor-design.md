# The file manager and the editor

Two applets join the terminal on the same sandbox: **Files**, a graphical view of the site tree and the reader's home directory, and **Editor**, a graphical text editor for the reader's files. All three share one filesystem module, so a file saved in one appears in the others at once. The terminal's design is in `terminal-design.md`; this document covers what the three share and the two new applets.

## The shared filesystem: `js/sitefs.js`

The filesystem that began inside the terminal is its own module, `window.pcSiteFs`. It holds:

- the site tree from `/api/site/tree`, with the virtual `tags` directory and `home/guest`;
- the home directory in `localStorage` (`pc-terminal-home`), with its versioned seed files and its limits (256 KB a file, 2 MB in all);
- `~/barcode-layouts.json`, the barcode tool's layout library, checked by the barcode engine before it is saved;
- page text from `/api/site/text` and `/api/site/texts`, cached;
- the operations: `resolve`, `read`, `write`, `mkdir`, `remove`, `move`, and the script helpers the terminal's PATH and the file manager both need.

A page holds one copy. `js/applets.js` names its address, with its version, in `window.pcSiteFsSrc`, and every applet loads it from there, so the version is raised once there on every change to the file. The module guards against a second load.

Every change to `~` fires `pc:fs-change` on the document: saves made in this page, and changes made in another tab, which reach this one through the `storage` event. A reload from storage replaces the nodes under `~`, so an applet holds paths, not nodes, across a change, and re-resolves them when the event fires.

The module has no user interface and makes no decisions about views; opening a page, an applet or a file is each applet's own business.

## Files

Files is an applet at `/page/files` that shows the same tree the terminal sees.

- **Layout.** It uses a PUDL master-detail layout: the folders on the left as a tree, and the current folder's contents on the right. Each entry carries a glyph and a colour for its kind (folder, page, applet, script, link, the reader's file), so no kind is told by colour alone. A selected page shows its description, date and tags.
- **Addressable.** The current folder is in the URL as `path` on its own page and through the applet state handshake in a window, so any folder can be linked.
- **Opening.** A page opens as a window in the window view, or goes to the page in the classic view. An applet launches, a link opens a new tab, and a reader's own file opens in the Editor.
- **Changing `~`.** Inside the home directory, and only there, the reader can make a new file or folder, rename, delete, move, download, and upload, including by dropping files from the computer onto the list. Outside `~` those actions are absent rather than disabled, because the site is read-only there.
- **Keyboard and accessibility.** Actions come from a PUDL menu button and the keyboard, not only from a right-click menu. Every entry is reachable with the arrow keys, and Enter opens it.

## Editor

Editor is an applet at `/page/editor` that edits the reader's files.

- **The editing surface** is CodeMirror 6 (MIT). CodeMirror is distributed as ES modules, so the parts the site uses are bundled once with esbuild into a single pinned file, `js/vendor/codemirror-<version>/codemirror.js`, recorded with its versions and licence, and vendored unmodified, the way xterm.js and the QR library are. It loads only when the editor opens.
- **What it offers.** It gives syntax colouring for Markdown, JSON and the terminal's scripts, search and replace, undo history, line numbers and bracket matching. Its colours come from the PUDL tokens and follow the theme, and the editing surface sits sunken, as input does in PUDL.
- **Files.** Several files can be open at once, each as a tab. The open file's path is in the URL as `file`. The reader's own files are read and written through `pcSiteFs`. A site page opens read-only, with "Save a copy to ~".
- **Checking.** `~/barcode-layouts.json` is checked as the reader types, with the barcode engine's own checks, and it cannot be saved while it fails them.
- **Integration.** Files opens a reader's file in the Editor. The terminal gains `edit -g <file>` to open the graphical editor instead of nano, and its `open` command opens a reader's file in the Editor where it used to refuse.

## Order of work

1. The shared filesystem, with the terminal moved onto it and its test suites unchanged. Done.
2. Files, browsing and opening.
3. Files, changing `~`.
4. Editor.
5. The links between the three.
