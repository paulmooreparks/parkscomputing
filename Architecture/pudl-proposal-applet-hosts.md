# Proposal to PUDL: applets and their hosts

From parkscomputing.com, 2026-09-28. The applet contract (PUDL 0.10.0, from this site's D14) has now carried one applet, Sudoku, through four habitats: a PUDL window, a classic article page, a bare page, and an installable web app. A second applet, Conway's Game of Life, is queued for conversion, and the site wants a fifth habitat: an applet embedded in the middle of an article, prose above and below, in HTML or Markdown content. Getting there exposed four gaps in the contract. Each proposal below stands alone, but they are offered together because they share one principle: an applet knows itself and never knows its landlord. Nothing here ties an applet to PUDL windowing; the aim is the opposite, that an applet runs identically with `pudl-applets.js` alone, and a window is merely one more host.

## 1. The registry: a mount is a name

Today every mount repeats the applet's asset URLs (`data-applet-src`, `data-applet-css`, `data-applet-page`), and once an applet appears in more than one place, an article, its own page, a window, those URLs and their cache-busting versions must be edited in step across content files. The site has already shipped a stale-script bug from exactly this.

Proposed: `pudlApplets.define(name, { src, css, page, ver })`, called once from a small script the site loads everywhere, and a mount that carries only the name:

```html
<div data-applet="sudoku">
  <noscript><p>This game needs JavaScript to run.</p></noscript>
</div>
```

The runtime resolves the name against the registry; a mount that still carries its own `data-applet-src` keeps working and wins over the registry, so nothing existing breaks. The `ver` string is appended to the asset URLs as a query parameter, which fixes cache busting in one place: `pudl-applets` today fetches the mount's literal URLs and leaves staleness to the page, and a pinned-dist site has no good place to put the version except in every mount.

A nicer authoring element, such as `<pudl-applet name="conway">`, is left to PUDL's judgement, with one argument for keeping the attribute form canonical: a plain element carries its no-script fallback content naturally, needs no custom-element registration before first paint, and passes through Markdown renderers as raw HTML today.

## 2. The embedded host

An applet in an article flows with the article: it takes the content column's width, caps itself against the viewport rather than filling it, and scrolls with the page. The site's Sudoku already implements this as one of its habitat modes, and the pattern is generic; the contract should name it. Concretely, `opts` (or a class the runtime sets on the mount) should tell the applet which of the sizing situations it is in:

- **Fills a box** (a PUDL window, a bare page): the host gives a definite box; the applet fills it and never scrolls.
- **Flows** (embedded in an article, or an article page of its own): the column gives the width; the applet caps its height against the viewport (`svh`, not `dvh`; see section 3) and the page scrolls.

The runtime can decide which applies without being told: a mount inside a `.win` fills, and anything else flows unless the page says otherwise. What matters is that the contract states it, so the next applet is not rediscovering the split.

## 3. The sizing patterns, for the contract's documentation

Building the fill-a-box habitat taught three lessons the applet documentation should record, because every applet that fills a window without scrollbars will hit them:

- An element with `aspect-ratio` and a definite width will not transfer a `max-height` back to that width; the board squashes. The working shape is a measuring wrapper, a size container that takes the layout's leftover space through flex, with the content sized `min(100cqi, 100cqb)` inside it.
- A size container whose box depends on its own content collapses to zero; the wrapper's dimensions must come from flex stretch, never from what it contains.
- Viewport units on a phone must be `svh`, the smallest viewport, which is always fully on screen. Which browser chrome counts toward `dvh` is the browser's own business, and Edge for Android answers differently from Chrome; the site lost its number pad under Edge's bottom bar to exactly this.

## 4. Applet state: the applet exposes it, the host places it

This is the deferred applet-state-in-URL question, and there are now three habitats of evidence for one rule. Sudoku serializes its whole game to a compact string; on its own page that string lives in the URL (Back and Forward are undo and redo), in a window it lives in browser storage (the window has no URL of its own), and embedded in an article it could live in the article's URL query without disturbing the article. The applet's serialization never changed; only the shelf did.

Proposed contract: an instance may implement `state()` returning a string and `setState(s)` accepting one, and may announce a change however the runtime prefers (a callback in `opts`, or an event on the mount). The host then decides placement:

- An applet that owns its URL (`opts.ownsUrl` today) writes state to its own query parameters, as Sudoku does.
- An embedded applet's host may write the string to the hosting page's query, under parameters the applet names, so a mid-article game is shareable by the page's own address.
- A windowed applet's host may persist the string wherever it keeps reader continuity, or nowhere.

PUDL keeps no state, matching the windows and the sidebar divider: the contract defines the handshake, and the project decides the shelf. The one shape to avoid is the applet reaching for `localStorage` or `history` itself in any habitat but its own page, which is how the site's first implementation worked and what this section replaces.

## What the site does when it ships

Define its applets once in a registry file and strip the asset URLs and `?v=` versions from every mount; convert Conway to an applet whose article embeds the running game amid its existing prose, with the preset links becoming state-parameter links on the article's own URL; give Sudoku a similar article; and move Sudoku's storage continuity behind the `state()`/`setState()` handshake, deleting the applet's own knowledge of where its state is kept. The frame mode (D13) then remains only for external destinations.
