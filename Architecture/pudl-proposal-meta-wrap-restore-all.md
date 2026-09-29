# Proposal to PUDL: wrapping list metadata, and restoring all windows

From parkscomputing.com, 2026-09-29, against PUDL 0.23.1. Two gaps the site found this week. Both have a site-side workaround in place, and the site deletes each workaround when a release carries the fix.

## 1. `.md-meta` should wrap

`.md-item` sets `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` so that a row's title stays on one line. `.md-meta` is a block inside the item, so it inherits `nowrap`, and a description longer than the sidebar is cut off at the edge. The ellipsis applies only to the title's line, so the cut isn't even marked. Once a reader narrows the sidebar with the resize divider, most descriptions lose their ends.

The site now shows two metadata lines on some rows (a date, then a description), each a `.md-meta`, and both need to wrap.

**Proposed:** keep the title's one-line ellipsis, and let `.md-meta` wrap:

```css
.md-item .md-meta { white-space: normal; overflow-wrap: anywhere; }
```

If PUDL would rather keep compact rows as the default, an opt-in class such as `.md-meta.wrap` would do. I'd argue for wrapping by default, though, since metadata cut off with no ellipsis is a defect either way. Several `.md-meta` lines in one item should be part of the documented markup.

**The site's workaround:** `body.desktop .md-item .md-meta { white-space: normal; overflow-wrap: anywhere; }` in `pudl-site.css`.

## 2. A restore-all for windows

`a[data-win-back]` minimizes every top-level window in one commit (`allMinimized`), and `syncPane` keeps its `href` current, so it also works without script. Nothing does the reverse. The site wanted a minimize-all/restore-all toggle beside its close-all button. The minimize half is `data-win-back`, but the restore half had to be built on the public API:

- It calls `pudlWindows.raise(key)` once per minimized window, which applies the state and rewrites the address once per window instead of once for the whole action.
- `allMinimized` sets `top` to null, so the site has to remember the previous top window in its own script, and raise it last, to bring it back on top. After a reload that memory is gone.

**Proposed:**

- A `data-win-restore` link (the name is PUDL's call) that restores every minimized top-level window in one commit, the counterpart to `data-win-back`, with `syncPane` keeping its `href` current in the same way.
- `pudlWindows.minimizeAll()` and `pudlWindows.restoreAll()` in the script interface, for hosts that drive it from their own controls.
- Restore puts the window that was on top before minimize-all back on top. Remembering it in memory is enough for the site. If PUDL prefers the answer to survive a reload, one option is to keep `top=` in the address while everything is minimized and treat a minimized top as inactive. That changes the URL grammar, so it's PUDL's decision.
- Optionally, `syncPane` could mark either link `aria-disabled="true"` when it would do nothing: nothing open, nothing showing for minimize, or nothing minimized for restore. The site currently computes that itself.

**The site's workaround:**
- `desktop.js` has the `data-min-all` block: the `lastTop` tracking, the `raise` loop, and the code that builds the restore address.
- `Desktop.cshtml.cs` renders `RestoreAllUrl` for the first page load.

When the release ships, the site's toggle becomes a switch between `data-win-back` and the new restore link, and all of that script goes. The server-rendered first `href`s stay, for browsers without script.
