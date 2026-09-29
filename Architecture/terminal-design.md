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
- `/api/site/text/{slug}` returns an article as plain text, and only for a slug that appears in the tree as a page or app. A Markdown article returns its source without the front matter. An HTML article is converted to text on the server: headings, paragraphs, list items and preformatted blocks keep their shape, links keep their target, and scripts, styles and applet placeholders are dropped (an applet placeholder becomes a one-line note). Any other slug is a 404.

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

The first commands are `ls`, `cd`, `pwd`, `tree`, `cat`, `less`, `open`, `tags`, `grep`, `find`, `help`, `man`, `clear` and `history`, and one command per applet: `sudoku`, `life`, `barcode` and `flashcards`. Tab completes commands and paths, and the arrow keys walk the history.

`open` and the applet commands open things the way the reader's view does: a window in the window view, and a page in the classic view.

## State

The working directory is in the URL as `cwd` (through the applet state handshake, so it rides in the address on the terminal's own page and in the window URL on the desktop). `?run=` pre-fills the prompt with a command but never runs it, so a shared link cannot act for the reader. The command history is kept in `localStorage` under `pc-terminal-history`, and Forget clears it.

## Later

A home directory (`~`) in browser storage, holding the reader's own files, and a small nano-style editor for them. Useful files are Conway patterns in the plain-text `.cells` format, Sudoku puzzles, and the barcode tool's layout library. The site tree stays read-only.
