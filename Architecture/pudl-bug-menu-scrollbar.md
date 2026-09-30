# PUDL bug: menus show a scrollbar they don't need

From parkscomputing.com, 2026-09-30, found by Paul on the site menu, the Categories and Tags filters, and a window's tag menu.

**What happens.** Every menu panel opened by `pudl-menu.js` shows a vertical scrollbar, even when all its rows fit, and can be scrolled by 2px.

**Why.** `place()` measures `panel.scrollHeight` as the panel's natural height and sets `panel.style.maxHeight` to it (or to the space available, if less). `.menu-panel` is `box-sizing: border-box` with a 1px border, and `scrollHeight` excludes the border, so the panel's inner height comes out 2px shorter than its content. Measured on the site menu: `scrollHeight` 344, `max-height` 344px, `clientHeight` 342.

**The fix in PUDL.** Add the panel's borders to the natural height before capping it:

```js
var natural = panel.scrollHeight + (panel.offsetHeight - panel.clientHeight);
```

(`offsetHeight - clientHeight` is the two borders, plus a horizontal scrollbar if there ever is one.)

**What the site does meanwhile.** Both of its stylesheets draw the panel's line as an outline instead of a border (`.menu-panel { border-width: 0; outline: 1px solid var(--border); }`), which looks the same and takes no room. The site removes the rule when PUDL ships the fix.
