# Bug report to PUDL: the summoned panel's filter is not always focused

From parkscomputing.com, 2026-09-28, observed by Paul on the live site with PUDL 0.18.0 pinned and 0.17.0's pudl-menu.js (byte-identical in 0.18.0).

## What happens

Pressing `/` opens the go palette, but nothing has focus afterwards: `document.activeElement` in the console is `<body>`, with the panel open and placed. Clicking the filter input focuses it normally, so the input is focusable; the summon's own `focus()` call either no-ops or is undone within the same instant. Typing after the summon therefore goes nowhere until the reader clicks.

## What it is not

Cache is excluded: every PUDL asset is served with a content-hash version stamp, the page's script tags carried the current hashes at the time of the report, and Cloudflare was in development mode. A focus thief on the page is excluded as far as testing can reach: automated runs against the same deployment, including through Cloudflare, focus the filter correctly on a fresh desktop, with a window's title bar focused, after clicking into window prose, and on the classic pages, and nothing in the site's own scripts touches focus on that path (the one applet that did grab focus on mount was fixed separately and predates nothing here; the symptom persists after it).

## The likely mechanism

`summon()` focuses the filter once, synchronously, in the same task as `showPopover()`:

```js
function summon(panel) {
    if (!isOpen(panel)) panel.showPopover();
    place(panel);
    panel.classList.remove('placing');
    var target = panel.querySelector('.md-filter') || items(panel)[0];
    if (target) target.focus();
}
```

A `focus()` on an element that is not focusable at that instant fails silently, and focus stays where it was, which here is the body. Whether an element inside a just-shown top-layer popover is focusable within the same task has differed across Chromium versions; the reporter's browser (a current stable Chromium derivative) drops it, while the newer Chromium build the site's automated tests run on takes it. The same one-shot pattern is in the ArrowDown-on-button path, which would share the failure.

## The fix that does not depend on the answer

Rather than branching on which engines settle the top layer synchronously, make the focus self-verifying: after calling `target.focus()`, if `document.activeElement` is not inside the panel, retry on `requestAnimationFrame`, and give up after the second frame so a reader who has already clicked elsewhere is not fought. That costs nothing where the synchronous focus works today, repairs the versions where it does not, and turns an undocumented timing question into one the code never has to ask. Applying it in one small helper covers both `summon()` and the ArrowDown path.

## Reproducing

If a reproduction is wanted before the fix, the discriminating variable appears to be the browser build rather than page state: the report came from stable-channel Chromium on Windows against https://parkscomputing.com/ with windows open and the sidebar resized, but the same state under Playwright's newer Chromium focuses correctly, so an older stable binary is the place to look.
