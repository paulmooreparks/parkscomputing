# Proposal to PUDL: a splitter

**Shipped in PUDL 0.31.0**, and the site has adopted it (`pudl-adoption.md`, D45). What follows is the proposal as it was sent.

From parkscomputing.com, 2026-09-30. PUDL's master-detail layout has a divider that resizes its sidebar (`pudl-md.js`), but nothing for two panes inside a component: a folder tree beside a file list, or an editor's file pane beside its text. The site's Files and Editor applets both needed one, and Paul asked for them to be resizable, so the site built one in the shape it expects PUDL would want. It runs today as `window.pcSplit` in `wwwroot/js/filebrowser.js`.

## Behavior

A splitter is an element between two panes. Dragging it with the pointer sets the first pane's width as a custom property on an element the markup names; the stylesheet reads the property, so the layout stays the stylesheet's. The splitter is a focusable `role="separator"` with `aria-orientation="vertical"` and `aria-valuenow`. Left and Right move it by a step, a larger step with Shift, Home and End go to the limits, and Enter or a double-click returns the stylesheet's own width. Its limits are a minimum in pixels and a maximum that may depend on the container, so a narrowing container still holds.

As with the sidebar's divider and window placements, PUDL keeps no state. The splitter fires an event with the width after each change, null on a reset, and a project that wants the width remembered stores it and gives it back. On parkscomputing.com, Files keeps its tree's width and the Editor its file pane's width in each tool's settings file.

A shape that fits PUDL's markup-first approach:

```html
<div class="split" style="--split-a: 240px">
  <div class="split-pane">…</div>
  <div class="split-handle" role="separator" aria-label="Resize the folders"
       data-split-prop="--split-a" data-split-min="140" data-split-max="60%"></div>
  <div class="split-pane">…</div>
</div>
```

with `pudl:split` fired on the handle. The drawing (a thin rule that takes the accent while hovered, dragged or focused) would match the sidebar's divider, which the stylesheet already has.

## Why PUDL

The sidebar divider shows PUDL already owns this interaction and its look; a splitter is the same thing freed from the master-detail layout. Without it, every project with a two-pane component writes its own pointer capture, key handling and ARIA, and draws its own rule. If PUDL adopts it, the site deletes `pcSplit` and its styles.
