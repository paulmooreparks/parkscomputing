# PUDL bug: the window menu's "Open as a page" ignores the link's target

From parkscomputing.com, 2026-09-30, found reading `pudl-windows.js` 0.33.0 while adopting the window menu.

**What happens.** A window whose title bar carries `<a data-win-action="page" href="…" target="_blank" rel="noopener">` opens its page in a new tab from the title bar's button, as the author asked. The same command in the window menu navigates the current tab instead, and the desktop the reader was on is gone.

**Why.** `runCommand(key, 'page')` finds the title bar's link and calls `location.assign(a.href)`, so it never sees the link's `target` or `rel`.

**Where the site needs it.** parkscomputing.com frames an outside site in a window when its sitenav entry says `frame ~true`, and that window's page button opens the outside site in a new tab so the desktop stays. No such window is listed today, so nothing is broken on the site yet.

**The fix in PUDL.** Let the link carry out the command, so its target, its rel and the browser's own handling of modifier keys all apply:

```js
if (cmd === 'page') {
  var a = wins[key].querySelector('.win-head a[data-win-action="page"]');
  if (a) a.click();
}
```

If a click on that link is handled elsewhere in `pudl-windows.js` in a way that would loop back here, the alternative is `window.open(a.href, a.target || '_self', a.rel ? a.rel.split(/\s+/).join(',') : '')` when `a.target` is set, and `location.assign` otherwise.
