# Proposal to PUDL: controls from the file manager and the editor

From parkscomputing.com, 2026-09-29, against PUDL 0.24.0. Building Files (a file manager) and Editor (a CodeMirror 6 editor) as applets meant drawing several controls PUDL doesn't have. Each is described below with the markup a project would write, a sample implementation in PUDL's style, and the site code it would replace. The samples are working starting points taken from the site, not finished PUDL code: names, tokens and edge cases are PUDL's call.

The proposals are ordered by how general they are. The first four would help any application; the last three matter mostly to editor-like applications.

## 1. A tree view

**Why.** Folder hierarchies, nested categories and outlines all need a tree. Files draws its own (`.fm-tree` in `css/files.css`, keyboard handling in `js/files.js`). Without a PUDL tree, every project reinvents the ARIA tree pattern, and most get the keyboard wrong.

**Markup.** Nested lists of links, so a tree works without script as an indented list of places, and every node is an address:

```html
<ul class="tree" role="tree" aria-label="Folders">
  <li role="treeitem" aria-expanded="true" aria-current="page">
    <a href="?path=/">Site</a>
    <ul role="group">
      <li role="treeitem" aria-expanded="false"><a href="?path=/articles">articles</a>
        <ul role="group">…</ul>
      </li>
      <li role="treeitem"><a href="?path=/about">about</a></li>
    </ul>
  </li>
</ul>
```

A node with children carries `aria-expanded`; a leaf carries none. The current node carries `aria-current`.

**Sample CSS.** It uses PUDL's categories: a tree is flat, for reading and choosing, and the current node is marked the way `.md-row` marks the active row.

```css
.tree, .tree [role="group"] { list-style: none; margin: 0; padding: 0; }
.tree [role="group"] { padding-inline-start: 14px; }
.tree [role="treeitem"] > a {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 8px; border-inline-start: 3px solid transparent;
  color: var(--text); text-decoration: none; white-space: nowrap;
}
.tree [role="treeitem"] > a:hover { background: var(--surface-alt); }
.tree [role="treeitem"][aria-current] > a {
  background: var(--surface-alt); border-inline-start-color: var(--accent); font-weight: 700;
}
.tree [role="treeitem"][aria-expanded] > a::before {
  content: ""; width: 10px; height: 10px; flex: none;
  background: currentColor; -webkit-mask: var(--glyph-caret) center / contain no-repeat; mask: var(--glyph-caret) center / contain no-repeat;
  transform: rotate(-90deg); transition: transform .12s;
}
.tree [role="treeitem"][aria-expanded="true"] > a::before { transform: none; }
.tree [role="treeitem"][aria-expanded="false"] > [role="group"] { display: none; }
.tree a:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--focus-ring); }
```

**Sample script (`pudl-tree.js`).** It follows the ARIA tree pattern. The tree is one stop in the Tab order. Up and Down move between visible nodes, Right opens a node or moves into it, Left closes it or moves to its parent, Home and End go to the ends, and Enter follows the link. `pudl:tree-toggle` fires on open and close, so a host can remember which nodes are open.

```js
(function () {
  'use strict';
  function visible(tree) {
    return Array.prototype.filter.call(tree.querySelectorAll('[role="treeitem"]'), function (li) {
      for (var p = li.parentElement.closest('[role="treeitem"]'); p; p = p.parentElement.closest('[role="treeitem"]')) {
        if (p.getAttribute('aria-expanded') === 'false') return false;
      }
      return true;
    });
  }
  function link(li) { return li.querySelector(':scope > a'); }
  function focus(tree, li) {
    tree.querySelectorAll('[role="treeitem"] > a').forEach(function (a) { a.tabIndex = -1; });
    link(li).tabIndex = 0; link(li).focus();
  }
  function toggle(li, open) {
    if (!li.hasAttribute('aria-expanded')) return;
    li.setAttribute('aria-expanded', String(open));
    li.dispatchEvent(new CustomEvent('pudl:tree-toggle', { bubbles: true, detail: { open: open } }));
  }
  function enhance(tree) {
    var start = tree.querySelector('[aria-current] > a') || tree.querySelector('[role="treeitem"] > a');
    tree.querySelectorAll('[role="treeitem"] > a').forEach(function (a) { a.tabIndex = a === start ? 0 : -1; });
    tree.addEventListener('click', function (e) {
      var li = e.target.closest('[role="treeitem"]');
      if (li && e.offsetX < 18 && li.hasAttribute('aria-expanded')) {   /* the disclosure glyph */
        e.preventDefault(); toggle(li, li.getAttribute('aria-expanded') !== 'true');
      }
    });
    tree.addEventListener('keydown', function (e) {
      var li = e.target.closest('[role="treeitem"]'); if (!li) return;
      var items = visible(tree), i = items.indexOf(li), open = li.getAttribute('aria-expanded');
      switch (e.key) {
        case 'ArrowDown': if (items[i + 1]) focus(tree, items[i + 1]); break;
        case 'ArrowUp': if (items[i - 1]) focus(tree, items[i - 1]); break;
        case 'ArrowRight': if (open === 'false') toggle(li, true); else if (open === 'true') focus(tree, items[i + 1]); break;
        case 'ArrowLeft':
          if (open === 'true') toggle(li, false);
          else { var p = li.parentElement.closest('[role="treeitem"]'); if (p) focus(tree, p); }
          break;
        case 'Home': focus(tree, items[0]); break;
        case 'End': focus(tree, items[items.length - 1]); break;
        default: return;
      }
      e.preventDefault();
    });
  }
  function init() { document.querySelectorAll('.tree[role="tree"]').forEach(enhance); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.pudlTree = { enhance: enhance };
})();
```

**The site deletes:** `.fm-tree` and `.fm-ti` in `files.css`, and the tree's rendering and keyboard handling in `files.js`, which would render `.tree` markup and call `pudlTree.enhance`.

## 2. A breadcrumb

**Why.** Any hierarchy needs a "where am I" trail. Files draws one (`.fm-crumbs`), and the site's classic pages could use one too.

**Markup.**

```html
<nav class="crumbs" aria-label="Path">
  <a href="?path=/">Site</a>
  <a href="?path=/articles">articles</a>
  <span aria-current="page">coincidences</span>
</nav>
```

**Sample CSS.** The separators are drawn, not typed, so a screen reader reads the path without them.

```css
.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; font-size: var(--text-sm); min-width: 0; }
.crumbs > * { padding: 2px 4px; border-radius: var(--radius-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crumbs > * + *::before { content: "/"; margin-inline-end: 6px; color: var(--text-muted); }
.crumbs [aria-current] { font-weight: 700; color: var(--text); }
.crumbs.mono { font-family: var(--mono); }
```

**The site deletes:** `.fm-crumbs`, `.fm-crumb` and `.fm-crumb-sep`.

## 3. Selectable rows in a data table

**Why.** `.data-table` is for reading. A file list, an inbox or a picker needs rows that can be selected and moved through with the keyboard, and opened with Enter. Files adds this itself (`.fm-row`, `.fm-selected`, and about 40 lines of script).

**Markup.** A table marked `selectable`, whose rows are the choices:

```html
<table class="data-table selectable" aria-label="Contents">
  <thead>…</thead>
  <tbody>
    <tr aria-selected="true" tabindex="0" data-href="?open=coincidences">…</tr>
    <tr aria-selected="false" tabindex="-1">…</tr>
  </tbody>
</table>
```

**Sample CSS.**

```css
.data-table.selectable tbody tr { cursor: pointer; }
.data-table.selectable tbody tr:hover td { background: var(--surface-alt); }
.data-table.selectable tbody tr[aria-selected="true"] td { background: color-mix(in srgb, var(--accent) 14%, transparent); }
.data-table.selectable tbody tr:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--focus-ring); }
```

**Sample script (part of a `pudl-table.js`).** Selection follows focus, the arrow keys, Home and End move it, and Enter or a double-click opens the row. A row with `data-href` is followed; otherwise `pudl:row-open` fires for the host. `pudl:row-select` fires on every change of selection.

```js
function enhanceSelectable(table) {
  var body = table.tBodies[0];
  function rows() { return Array.prototype.slice.call(body.rows); }
  function select(tr, focus) {
    rows().forEach(function (r) { var on = r === tr; r.setAttribute('aria-selected', String(on)); r.tabIndex = on ? 0 : -1; });
    if (focus) tr.focus();
    table.dispatchEvent(new CustomEvent('pudl:row-select', { bubbles: true, detail: { row: tr } }));
  }
  function open(tr) {
    if (tr.dataset.href) { location.assign(tr.dataset.href); return; }
    table.dispatchEvent(new CustomEvent('pudl:row-open', { bubbles: true, detail: { row: tr } }));
  }
  body.addEventListener('click', function (e) { var tr = e.target.closest('tr'); if (tr) select(tr, true); });
  body.addEventListener('dblclick', function (e) { var tr = e.target.closest('tr'); if (tr) open(tr); });
  body.addEventListener('focusin', function (e) { var tr = e.target.closest('tr'); if (tr && tr.getAttribute('aria-selected') !== 'true') select(tr, false); });
  body.addEventListener('keydown', function (e) {
    var all = rows(), i = all.indexOf(document.activeElement);
    if (i < 0) return;
    var next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[e.key];
    if (next != null) { if (all[next]) select(all[next], true); e.preventDefault(); }
    else if (e.key === 'Enter') { open(all[i]); e.preventDefault(); }
  });
}
```

**The site deletes:** `.fm-row`, `.fm-selected` and the list's keyboard handling in `files.js`, keeping only its own keys (Backspace for up, Delete, F2).

## 4. Glyphs for files and folders

**Why.** PUDL's rule is glyph and colour together. Its glyph set covers status and window chrome, but not the kinds of thing a file manager, a document list or an attachment list shows. Files carries seven inline SVGs of its own.

**Proposed.** New mask glyphs, in the same form as `--glyph-open`:

| Token | Shape |
| --- | --- |
| `--glyph-folder` | A folder. |
| `--glyph-file` | A sheet with a folded corner. |
| `--glyph-document` | A sheet with lines of text. |
| `--glyph-app` | Four squares. |
| `--glyph-script` | A terminal prompt, `>_`. |
| `--glyph-link` | An arrow leaving a box. |
| `--glyph-home` | A house. |

**Sample.** Each is a 16-unit SVG drawn in strokes, as the site draws them (`GLYPHS` in `js/files.js`). As a PUDL token:

```css
:root {
  --glyph-folder: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4' stroke-linejoin='round'%3E%3Cpath d='M1.5 4.5a1 1 0 0 1 1-1h3.6l1.4 1.5h5.9a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-10.9a1 1 0 0 1-1-1z'/%3E%3C/svg%3E");
  --glyph-script: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='1.5' y='2.5' width='13' height='11' rx='1.5'/%3E%3Cpath d='M4.5 6.5l2 1.75-2 1.75'/%3E%3Cline x1='8' y1='11' x2='11.5' y2='11'/%3E%3C/svg%3E");
  /* …the others from the same paths in files.js */
}
```

A matching pair of classes, such as `.kind-folder` and `.kind-script`, could set the glyph and a colour from the palette together, so projects agree on what a folder looks like.

**The site deletes:** the inline SVGs in `files.js` and the `.fm-k-*` colours, if PUDL takes the kind classes as well.

## 5. A drop target

**Why.** Uploading by dropping files on a list, and moving an entry by dropping it on a folder, both need a visible "this will land here" state. There's no PUDL look for it, so the site made one (`.fm-dragging`, `.fm-drop-target`, `.fm-drop-hint`).

**Proposed.** An attribute a host sets while something is dragged over a valid target, which PUDL styles, and an optional hint inside the target.

```html
<div class="drop-zone" data-drop-over>
  … the list …
  <p class="drop-hint">Drop text files here to upload them.</p>
</div>
```

```css
.drop-zone { position: relative; }
.drop-zone[data-drop-over] { box-shadow: inset 0 0 0 2px var(--accent); }
.drop-zone .drop-hint { display: none; }
.drop-zone[data-drop-over] .drop-hint {
  display: block; position: absolute; inset-inline-start: 50%; bottom: var(--space-3); transform: translateX(-50%);
  margin: 0; padding: 4px 10px; border-radius: var(--radius-pill);
  background: var(--accent); color: var(--on-accent); font-weight: 600;
}
[data-drop-target] { box-shadow: inset 0 0 0 2px var(--accent); }
```

The behaviour stays the host's, because what may be dropped where is the application's rule. PUDL only supplies the look, so every application shows the same one.

**The site deletes:** the drop styles in `files.css`, setting the attributes instead of its own classes.

## 6. Document tabs

**Why.** `.tabs` switches between panels of one page, in the ARIA tab pattern, and the panels are fixed. An editor, a set of open records or a browser-like view needs tabs that come and go. Each has a close button and can show that its document has unsaved changes. Editor draws these itself (`.ed-tabs`, `.ed-tab`, `.ed-tab-close`, `.ed-dot`).

**Markup.**

```html
<div class="doc-tabs" role="tablist" aria-label="Open files">
  <span class="doc-tab">
    <button role="tab" aria-selected="true">today.md<span class="doc-tab-dirty">unsaved</span></button>
    <button class="doc-tab-close" aria-label="Close today.md">×</button>
  </span>
  …
</div>
```

**Sample CSS.** The dirty mark is a dot with its words hidden visually, so the state doesn't rest on the dot alone for a screen reader.

```css
.doc-tabs { display: flex; gap: 2px; overflow-x: auto; border-bottom: 1px solid var(--border); }
.doc-tab { display: inline-flex; align-items: center; flex: none; border: 1px solid transparent; border-bottom: 0; border-radius: var(--radius-sm) var(--radius-sm) 0 0; }
.doc-tab:has([aria-selected="true"]) { background: var(--surface); border-color: var(--border); margin-bottom: -1px; }
.doc-tab [role="tab"] { background: none; border: 0; cursor: pointer; padding: 5px 4px 5px 10px; font: 600 var(--text-sm) var(--font); color: var(--text-muted); }
.doc-tab [aria-selected="true"] { color: var(--text); }
.doc-tab-dirty { font-size: 0; }
.doc-tab-dirty::before { content: "●"; font-size: var(--text-sm); color: var(--accent); margin-inline-start: 6px; }
.doc-tab-close { background: none; border: 0; cursor: pointer; color: var(--text-muted); padding: 2px 8px 2px 4px; font-size: 15px; }
.doc-tab-close:hover { color: var(--text); }
```

The keyboard is the same as `pudl-tabs.js`: the arrow keys move along the tabs. Delete, or Ctrl+W where the browser allows it, closes the focused tab by pressing its close button, so the host's confirm-before-closing logic runs.

**The site deletes:** the tab styles in `editor.css` and the tab strip's arrow-key handling in `editor.js`.

## 7. Syntax colours and a code surface

**Why.** An editor's colours and a highlighted code block's colours should come from the theme, and should agree with each other. Editor maps PUDL's tokens onto CodeMirror's highlighting by hand, borrowing `--danger` for keywords and `--positive` for strings. The site's highlight.js code blocks use highlight.js's own theme, which doesn't follow PUDL's. A small set of syntax tokens, defined for both themes, would give every highlighter one source.

**Proposed tokens,** each checked for contrast on `--input-bg` in both themes:

```css
:root {
  --syntax-keyword: …; --syntax-string: …; --syntax-number: …; --syntax-comment: …;
  --syntax-name: …;    --syntax-tag: …;    --syntax-attr: …;   --syntax-heading: …;
  --syntax-link: …;    --syntax-error: var(--danger);
}
.code-surface {
  font-family: var(--mono); background: var(--input-bg); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius-sm); box-shadow: var(--recess-shadow);
}
```

**Sample mappings.** For highlight.js, which the site uses for code blocks:

```css
.hljs-keyword, .hljs-selector-tag { color: var(--syntax-keyword); }
.hljs-string, .hljs-regexp { color: var(--syntax-string); }
.hljs-number, .hljs-literal { color: var(--syntax-number); }
.hljs-comment, .hljs-quote { color: var(--syntax-comment); font-style: italic; }
.hljs-title, .hljs-name { color: var(--syntax-name); }
.hljs-attr, .hljs-attribute { color: var(--syntax-attr); }
```

For CodeMirror 6, through its `HighlightStyle`, the way the site's `js/editor.js` does it:

```js
CM.HighlightStyle.define([
  { tag: CM.tags.keyword, color: 'var(--syntax-keyword)' },
  { tag: CM.tags.string, color: 'var(--syntax-string)' },
  { tag: [CM.tags.number, CM.tags.bool, CM.tags.null], color: 'var(--syntax-number)' },
  { tag: CM.tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: CM.tags.heading, color: 'var(--syntax-heading)', fontWeight: '700' },
  { tag: [CM.tags.link, CM.tags.url], color: 'var(--syntax-link)', textDecoration: 'underline' }
]);
```

PUDL would ship the tokens and the highlight.js sheet. A CodeMirror mapping could be a documented recipe rather than a file, since PUDL doesn't carry CodeMirror.

**The site deletes:** the borrowed colours in `editor.js`'s theme, replaced by the syntax tokens, and it moves its code blocks onto the highlight.js sheet.

## Not proposed

- **A script prompt or confirm helper.** Files and Editor each build a native `<dialog class="dialog">` in script, because an applet's questions aren't known when the server renders the page. PUDL's dialogs are server-rendered, opened with `commandfor`, and that suits pages. A helper for script-built dialogs would be a new kind of API for PUDL, and two applets aren't enough evidence that it needs one.
- **A status bar.** Editor's status line (`.ed-status`) is a row of muted text. It's too thin to be a component, and a documented pattern would do.
