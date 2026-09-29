# Terminal design

The terminal is an applet that shows the public site in terminal mode. A reader moves through the site's structure with shell commands, reads articles as text, and launches the other applets. It follows the PUDL theme, and it is sandboxed: nothing in it reaches the server's file system.

## The filesystem

The terminal's filesystem is built from sitenav.xfer and nothing else. The server publishes it as data, and no path in it corresponds to a file on disk.

```
/
  articles/        every post, newest first
  applications/    one directory per sitenav section that has children
  applets/
  projects/
  links/
  tags/<tag>/      virtual: the articles carrying each tag
  about            top-level leaf entries sit at the root
  resume-of-paul-m-parks
  ...
```

Each entry's name is its slug. An entry is one of three kinds:

- **page**: an internal article or page. `cat` prints its text and `open` opens it.
- **app**: a page whose slug is a registered applet. `open` launches it, like a page.
- **link**: an external destination. `cat` prints its URL and description, and `open` opens it in a new tab.

## Server endpoints

`TerminalController` serves two read-only GET endpoints under `/api/site`.

- `/api/site/tree` returns the tree above as JSON: for each entry, its name, kind, title, description, tags, date and, for a link, its URL. The tags directory is derived on the client from the entries' tags.
- `/api/site/text/{slug}` returns an article as plain text, and only for a slug that appears in the tree as a page or app. A Markdown article is rendered to HTML with the site's own pipeline, because articles carry raw HTML that reads badly as source, and then every article is converted to text on the server the same way: headings, paragraphs, list items and preformatted blocks keep their shape, links keep their target, and scripts, styles and applet placeholders are dropped (an applet placeholder becomes a one-line note). Any other slug is a 404.

- `/api/site/texts?slugs=a,b,c` returns several pages' text as an object of slug to text, leaving out any slug the tree does not list. A recursive `grep` uses it, so it costs one request instead of one per page; the API allows 60 requests a minute per client, and one request per page would exhaust that in two searches of the whole site.

A slug is served only if it appears in the tree as a page, and the tree's slugs must match `^[a-z0-9-]+$`, so a request can never name a path. The tree marks a page as an app when its HTML carries `<meta name="applet-page">`.

## The applet

`js/terminal.js` registers the `terminal` applet. It hosts xterm.js 6.0.0 and its fit addon (MIT), vendored unmodified at `js/vendor/xterm-6.0.0/`. The terminal's colors come from the PUDL tokens on the page and update when the theme changes.

Commands are JavaScript objects registered with the terminal: a name, a one-line summary, a help text, optional completion, and an async `run(args, io)`. The `io` object is the only way a command reaches anything:

- `io.out(text)` and `io.err(text)` write output;
- `io.fs` resolves paths and lists directories in the site tree;
- `io.text(slug)` fetches an article's text;
- `io.open(entry)` opens a page, an applet or a link the way the current view opens things;
- `io.stdin` is the previous command's output when the command sits after a pipe.

Simple pipes (`ls | grep sudoku`) are supported. Output that is piped carries no color codes.

The first commands are `ls`, `cd`, `pwd`, `tree`, `cat`, `less`, `open`, `tags`, `grep`, `find`, `help`, `man`, `clear` and `history`, and one command per applet, named as the applet is in `/applets`: `sudoku`, `conway` (alias `life`), `barcodes` (alias `barcode`), `flashcards` and `terminal`. A word that names no command but names an applet (in the current directory, in `/applets`, which serves as the PATH, or by its path) runs it, so everything `ls` marks with `*` is runnable. Tab completes commands and paths, and the arrow keys walk the history.

`open` and the applet commands open things the way the reader's view does: a window in the window view, and a page in the classic view.

## State

The working directory, which may be in the home directory, is in the URL as `cwd` (through the applet state handshake, so it rides in the address on the terminal's own page and in the window URL on the desktop). `?run=` pre-fills the prompt with a command but never runs it, so a shared link cannot act for the reader. The command history is kept in `localStorage` under `pc-terminal-history`, and Forget clears it.

## The home directory

Each reader has a home directory at `/home/guest`, shown as `~` in paths and the prompt. It is the only writable place; the site tree stays read-only, and every command that changes a file refuses anything outside `~` with a message saying so. `cd` with no argument goes home, as in a shell, while the terminal still starts at `/`, because browsing the site is its main job.

The files live in `localStorage` under `pc-terminal-home` as `{ seeded, files: { "/path": { t, c, m } } }`, where `t` is `f` or `d`, `c` a file's text and `m` its time. A file may be up to 256 KB and the whole directory 2 MB. A save that fails (the limit, or the browser refusing) reloads the stored copy, so the terminal never shows files the browser did not keep. Before each command the terminal compares the stored copy with the one it loaded, so a change made in another tab shows up. Forget clears it with the rest of the terminal's keys.

The first visit seeds three files, and never again, so deleting them sticks: a `README`, `glider.cells` and `puzzle.sudoku`.

`~/barcode-layouts.json` is not stored with the rest. It is the barcode tool's layout library (`pc-barcode-layouts`), shown pretty-printed and written back compact. Saving it runs the barcode engine's `validateFile`, loading the engine if need be, and a file that fails is not saved; the error appears in the editor. It cannot be removed or moved. The tool reads its library when it opens, so a change shows after reopening it. If the reader has linked the tool to a layouts file on disk, the tool's copy of that file wins when it next opens.

Files the applets understand:

- A Conway pattern is plain-text `.cells`: `O` (or `*`, `X`) is a live cell, anything else dead, and lines beginning `!` are notes. `conway <file>` centres it on a board with a margin and opens it.
- A Sudoku puzzle is 81 cells read left to right, top to bottom: a digit is a clue and `.`, `0` or `_` an empty cell. Lines beginning `#` are notes, and other characters (spaces, bars) are ignored. `sudoku <file>` opens it.

The file commands are `edit` (alias `nano`), `touch`, `mkdir [-p]`, `rm [-r]`, `rmdir`, `cp` (from anywhere, including a site page as text, into `~`), `mv` (within `~`), `download` (through the browser's download) and `upload` (a file picker, text files only). A command's output can be saved with `> file` or appended with `>> file` at the end of the line.

## The editor

`edit` opens a nano-style editor on the alternate screen: a title bar with the path and whether it is modified, the text, a message line, and a line of keys. Ctrl+S (or Ctrl+O) saves, Ctrl+X exits and asks about unsaved changes, Ctrl+K cuts the current line (consecutive cuts collect), Ctrl+U pastes them above the cursor, Ctrl+G shows the keys and Ctrl+C the cursor position. Like nano, the buffer always ends in an empty line, so there is somewhere to move to and paste after the last line of text. Long lines scroll sideways rather than wrap, and tabs become spaces. The editor avoids Ctrl+W, Ctrl+T and Ctrl+N, which browsers keep for themselves.
