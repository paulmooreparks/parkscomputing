# PUDL bug: menus show a scrollbar they don't need

From parkscomputing.com, 2026-09-30, found by Paul on the site menu, the Categories and Tags filters, and a window's tag menu.

**What happens.** Every menu panel opened by `pudl-menu.js` shows a vertical scrollbar, even when all its rows fit, and can be scrolled by 2px.

**Why.** `place()` measures `panel.scrollHeight` as the panel's natural height and sets `panel.style.maxHeight` to it (or to the space available, if less). `.menu-panel` is `box-sizing: border-box` with a 1px border, and `scrollHeight` excludes the border, so the panel's inner height comes out 2px shorter than its content. Measured on the site menu: `scrollHeight` 344, `max-height` 344px, `clientHeight` 342.

**A second cause: rounding.** `scrollHeight` is a whole number, rounded down, while the content's real height can be fractional, as a menu's often is from its section labels' line heights. After the site worked around the border (below), Paul rearranged the site menu and the scrollbar came back: the content measured 405.19px, `scrollHeight` said 405, `max-height` became 405px, and the fifth of a pixel left over was enough for Edge on a 192% display to draw a scrollbar. It happens at every display scale; whether a scrollbar shows for it depends on the browser.

**The fix in PUDL.** Measure the panel's natural height with its borders and its fractions, and round up:

```js
panel.style.maxHeight = '';
var natural = Math.ceil(panel.getBoundingClientRect().height);
```

With `max-height` cleared, the panel's rectangle is its whole natural height, borders included, unrounded; rounding it up leaves nothing to scroll. (Adding `offsetHeight - clientHeight` to `scrollHeight` fixes only the border, not the rounding.)

**What the site does meanwhile.** Both of its stylesheets draw the panel's line as an outline instead of a border (`.menu-panel { border-width: 0; outline: 1px solid var(--border); }`), which looks the same and takes no room. That covers the border but not the rounding, which the site leaves to PUDL's fix. The site removes the rule when PUDL ships it.
