# The file manager and the editor

Two applets join the terminal on the same sandbox: **Files**, a graphical view of the site tree and the reader's home directory, and **Editor**, a graphical text editor for the reader's files. All three share one filesystem module, so a file saved in one appears in the others at once. The terminal's design is in `terminal-design.md`; this document covers what the three share and the two new applets.

## The shared filesystem: `js/sitefs.js`

The filesystem that began inside the terminal is its own module, `window.pcSiteFs`. It holds:

- the root and its siblings, described below;
- the site tree from `/api/site/tree`, under `/site`, with the virtual `tags` directory;
- the home directory in `localStorage` (`pc-terminal-home`), with its versioned seed files and its limits (256 KB a file, 2 MB in all);
- `~/barcode-layouts.json`, the barcode tool's layout library, checked by the barcode engine before it is saved;
- page text from `/api/site/text` and `/api/site/texts`, cached;
- the operations: `resolve`, `read`, `write`, `mkdir`, `remove`, `move`, and the script helpers the terminal's PATH and the file manager both need.

A page holds one copy. `js/applets.js` names its address, with its version, in `window.pcSiteFsSrc`, and every applet loads it from there, so the version is raised once there on every change to the file. The module guards against a second load.

Every change to `~` fires `pc:fs-change` on the document: saves made in this page, and changes made in another tab, which reach this one through the `storage` event. A reload from storage replaces the nodes under `~`, so an applet holds paths, not nodes, across a change, and re-resolves them when the event fires.

The module has no user interface and makes no decisions about views; opening a page, an applet or a file is each applet's own business.

### Settings files and hidden names

Each applet owns its settings and keeps them in `~/.config/<name>.json` (Paul, 2026-09-30), read and written through `js/config.js` (`window.pcConfig`), which fills in defaults and tells every open window when a file changes, whether here, in another tab, or by hand in the Editor. The applet draws its own controls; there is no central list of every tool's settings. On the edit origin `~` is on the server, so the settings follow the admin; on the public site they are in the browser, like the rest of `~`.

- The terminal has a gear in its corner, opening a small dialog with its text size (`terminal.json`).
- The Editor's own Wrap lines and Explorer controls remember themselves (`editor.json`); they needed no second place to set them.
- Files' menu shows or hides hidden files (`files.json`).
- The admin desktop's Settings keeps `desktop.json` (`admin-and-identity-design.md`, A14).

Names starting with a dot, such as `~/.config` and `~/.history`, are hidden as a shell hides them: `ls` shows them with `-a`, Files and the desktop's tree with their "show hidden files" setting, and the shared browser with its `showHidden` option. A dotfile with no other extension counts as text.

### The root

The root holds siblings, each with one meaning and one store (Paul, 2026-09-30). Before this the site's pages sat at the root itself, with `/home` and, on the edit origin, `/wwwroot` grafted onto them.

```
/
├── bin/       the terminal's built-in commands, read-only
├── home/      the home directories: /home/guest in this browser, or /home/<name> on the server
├── site/      the site as sitenav lists it, read-only (articles, applets, tags, bin, ...)
└── wwwroot/   the web root on the server, on the edit origin only
```

- **`/site`** is the published view, and `/wwwroot` the source it is published from. The site's scripts are therefore `/site/bin`, the published view of `/wwwroot/content/bin`.
- **`/bin`** lists the built-in commands, so `ls /bin` shows them and `/bin/ls` is a path to `ls`. The commands live in `js/terminal.js`, which fills `/bin` through `defineCommands` when a terminal starts, so a page with no terminal shows `/bin` empty. Opening one in Files or the desktop's tree puts `man <name>` at a terminal's prompt.
- **A new terminal and Files start in `/site`**, since exploring the site is what they are for on the public site.
- **Old addresses still work.** `upgradePath` reads a path that names nothing, such as `/articles/coincidences`, as the same path under `/site` when that names something. It applies only where an address or kept state is read in (Files' `path`, the Editor's `file`, the terminal's `cwd`), never to what a reader types. A home directory's `README` and `bin/hello`, still exactly as seeded, take the new paths; a copy the reader changed is left alone.

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

## The shared file browser: `js/filebrowser.js`

Files and the Editor browse with one module, `window.pcFileBrowser`, with its stylesheet `css/filebrowser.css`. It is the same code on the public site and on the edit origin; there it browses `/wwwroot` and the admin's `/home/<name>` because sitefs mounts them, and it needs no knowledge of the mount beyond what sitefs tells it. `js/applets.js` names both addresses with their versions, as it does for sitefs.

The module draws the folder tree, the path bar and the list of a folder's contents from PUDL's tree and grid, follows every change the filesystem reports, and keeps the current folder and the selection by path across a reload. It moves about and shows things; what opening an entry means is left to its host, through callbacks for opening, selecting, navigating, redrawing, keys and messages. A host lays out the parts it wants with the module's markup helpers, so a host can use the tree alone. Dragging entries onto folders and dropping files from the computer are options a host turns on; only Files does.

The module also holds the Open and Save as dialog, `pcFileBrowser.pick`, so every applet that opens or saves a file uses the same one. The dialog only chooses; its host reads or writes. It can limit Open to some extensions, ask the host whether a folder can take the file being saved, and ask before replacing a file by turning its button into Replace. A host can offer the reader's computer beside the dialog's buttons: "From your computer…" when opening, which also takes a file dropped on the dialog, and "Download instead" when saving. That button is always in view rather than tucked into a menu, because files on the reader's own disk are the first thing many readers look for.

It has four hosts:

- **Files** builds its toolbar, action menu, detail line and dialogs around it, and keeps everything that changes `~`.
- **The Editor's Open and Save as** use the shared dialog. Open fills the field with the chosen file's path, and a double-click or Enter opens it; a typed path works as well. Save as starts in the folder of the file in front (or in `~` for a read-only page), fills the field with its name, and saves into the folder shown, refusing folders it cannot write. A text file opened from the computer becomes an unsaved tab that belongs nowhere until it is saved, and Download instead downloads the tab's text. The old text prompt with a list of suggestions is gone.
- **The barcode tool** uses the same dialog for its layouts and its SVG and PNG files (`barcode-tool-design.md`).
- **The Editor's Explorer pane** is the tree alone, with files in it, beside the text. A click on a folder opens or closes it in place, a click on a file opens it in a tab, and a file the Editor cannot show opens on the site in a new tab. The pane marks the file in front and opens its way to it. A toolbar button shows and hides it, the choice is kept per browser, it shows by default on a wide screen, and a narrow screen has no room for it.

## Handlers: how applets ask each other for things

Files used to call the Editor and the terminal by name, the terminal did the same with the Editor, and each carried its own copy of the rules for reaching a running one. Handlers replace that with declarations. An applet says what requests it can serve, and a caller asks for the request without knowing which applet will serve it. The idea is the one the Web App Manifest uses for `file_handlers`, scaled down to one site.

**The requests.** There are three, and each carries a path:

- **open** a file, to read or edit it;
- **browse** a folder;
- **shell**, a command line in a folder, optionally with a command to put at the prompt without running it.

Since PUDL 0.27.0 the mechanism is PUDL's own, from the site's proposal `pudl-proposal-applet-handlers.md`, and the site's first version, `js/handlers.js`, is gone.

**Declarations** are part of each applet's `define` in `js/applets.js`: `handles` names the requests it serves, the state parameter the path travels in, which kinds of entry it accepts, any extra parameters, and `reuse: false` when every request should get a new instance; `instances` caps how many windows of it may be open. The Editor serves open (files, scripts and pages, in the parameter `file`), Files serves browse (`path`), and the terminal serves shell (`cwd`, with `run`), in a new instance each time, up to four.

**Asking.** A caller uses `pudlApplets.request(verb, { path, kind, … }, from)`, which returns false when nothing serves the request, so the caller can fall back or leave the action out; `pudlApplets.can(verb, kind)` answers in advance. On a page with windows the request goes to the newest open instance through its `setState()`, raising its window, or opens a new instance, which starts with the request's state ahead of any continuity the site kept. On a page without windows it goes to the applet's page, in a new tab when that is the page the caller is on. Each applet's `setState` therefore does what a request asks: the Editor opens the file in a tab, Files goes to the folder, and the terminal changes to the folder and types any command at the prompt, waiting for the prompt if a command is running.

**Instances.** A window's key is its applet's page slug, and PUDL numbers further instances `terminal-2`, `terminal-3` and so on. The server answers `/window/{slug}-{n}` for any applet page and n from 2 to 9, with the title "Terminal 2" and the page link pointing at the applet's own page. The server is permissive and the declarations are the policy.

Each instance keeps its own continuity, keyed by `detail.instance` on `pudl:applet-state`. The first uses the applet's storage key, and a numbered one adds its key (`pc-terminal:terminal-2`), which the settings dialog's Forget also clears. The terminal's command history stays shared between instances, as bash's does, and each instance re-reads it before adding a line so no instance overwrites another's.

**The barcode tool** declares no handler. It re-reads its layout library whenever the shared filesystem reports a change, so a save in the Editor, the terminal or another tab reaches it at once, and it writes the change on to a linked layouts file if one is linked. Its layout dialog gains a link that asks for the whole file to be opened, shown only when some applet serves open.

**What stays outside.** Opening a page or launching an applet by name is not a handler request; it stays the plain window or page open it always was. Handlers are for requests where the caller should not care who answers.

## Order of work

1. The shared filesystem, with the terminal moved onto it and its test suites unchanged. Done.
2. Files, browsing and opening. Done.
3. Files, changing `~`. Done.
4. Editor. Done.
5. The links between the three. Done: Files opens files in the Editor (an open editor takes the file as a new tab), "Run in the terminal" hands the terminal a `run` it only pre-fills, and the terminal has `edit -g` and an `open` that sends a reader's file to the Editor.
6. Handlers, replacing the direct calls of step 5; numbered terminal windows; the barcode tool following its layouts file. Done. The terminal also gained `files [dir]`, and on its own page it now prefers the folder in its address over the one it kept, which it had the wrong way round.
7. The shared file browser, taken out of Files and used again for the Editor's Open and Save as dialog and its Explorer pane, on both origins. Done.
8. The Open and Save as dialog moved into the shared module with a way to the reader's computer, and the barcode tool moved onto it. Done.
