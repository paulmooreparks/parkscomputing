# PUDL bug: the window layer can be scrolled, and carries every window off the screen

From parkscomputing.com, 2026-10-01, found by Paul in the site's theme studio with PUDL 0.38.0.

**What happens.** In a window that runs past the bottom of the window area, following a link to a fragment inside the window's content moves every window up, so the front window's title bar can end up off the screen. Nothing the reader can do brings it back short of reloading the page. Paul met it by pressing a tab in the theme studio's preview, a page in a frame whose links point at `#preview`. The same happens for anything that asks the browser to bring an element into view, such as `scrollIntoView()` or focusing a field that is out of sight, wherever the window extends past the layer.

**Why.** `pudl-windows.css` gives the layer `overflow: hidden`:

```css
.win-layer {
  position: absolute; inset: 0; z-index: 50;
  overflow: hidden;
  pointer-events: none;
}
```

A box with `overflow: hidden` is still a scroll container. CSS Overflow Module Level 3 says it can be scrolled programmatically, though not by the reader, and bringing an element into view scrolls every scroll container above it, frames included. When the target lies past the layer's edge, the layer scrolls and every window moves with it. The reader has no scroll bar or gesture to undo that, and PUDL never resets the layer's scroll position. The site measured `scrollTop` on the layer after the click: it had moved, and nothing above or below it had.

**The fix in PUDL.** Make the layer `overflow: clip`. The same specification defines `clip` as clipping in the same way while forbidding all scrolling, programmatic included, so the layer can no longer be moved. Nothing in PUDL relies on the layer scrolling. A test that places a window past the layer's bottom edge, calls `scrollIntoView()` on an element at its foot, and checks that the layer's `scrollTop` is still 0 would catch it.

**The site's workaround,** marked in `wwwroot/css/window-bar.css`, is `.win-layer { overflow: clip; }` on both sites. It comes out when PUDL ships the fix. The theme studio also stops its sample's links from navigating, since they are there to be seen.
