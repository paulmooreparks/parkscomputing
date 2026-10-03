# The menu bar

The current menu placement and PUDL 0.40.0 integration are recorded in [the adoption record](menu-bar-adoption-0.40.md). That record supersedes conflicting placement decisions below; the earlier design discussion is retained as history.

Paul and I worked this out on 2026-10-01, in a lab on the live site with two small applets, Notes and Dice. The same day it became the site's menu bar on every page (see "On the site" below), and it goes to PUDL as `pudl-proposal-menu-bar.md`.

## Why

Commands in the window menu are hard to find. Paul wants a real application menu bar that works the same in the window view and the classic view.

## Names

The **menu bar** is the whole row in the site's top bar. A **menu** is one raised group in it. A **title** is a word in a menu, such as View or File. A **panel** is what a title opens, the word PUDL already uses for its menu panels. A **command** is a row in a panel; applets already supply commands through `commands()`.

These differ from ARIA's names, and the proposal has to say so. The menu bar is one ARIA `menubar`, each menu is a `group` inside it, each title a `menuitem` with a popup, and each panel a `menu`.

## Decisions

- The menu bar lives in the site's top bar, as a Mac's does. Paul chose this over a bar in each window's title bar or below it.
- There are two menus. The **logo menu** is always there; Paul found it jarring when the site's commands came and went. Its first title is the logo and the site's name, whose panel holds the site's places (the sitenav menu that the logo button holds today). Its other titles are the standard ones: View, Window (in the window view only), Go and Help.
- The **front menu** stands to the right of the logo menu, and exists only when what the reader is in has one: an applet, or an article. Its first title is its own name. Keeping it on the right means the logo menu never moves or changes width as the reader moves between windows.
- Each menu is one raised surface in the top bar's chip colours, with the menu glyph at its left. The glyph is three stacked lines; Paul chose it because it is read as "menu" nearly everywhere. PUDL has no such glyph yet. The glyph is part of the surface, not a button, and a press on it opens the menu's first title.
- Titles are flat words that take their press from the surface around them, as the segments of a segmented control do. A title lights while the pointer is on it, and the open title is pressed into the surface. Paul tried raised buttons, notebook tabs and a ribbon first; plain titles won, and the raised group is what makes them discoverable.
- A front menu may not use a standard title. Instead it adds its own commands to a standard panel, below a separator under a heading with its name, and only while it is in front. It may add commands but never rename, remove or reorder the site's. Within a panel every command's name is unique. PUDL leaves out a clashing title or command and warns in the console, naming the applet.
- The whole bar is one tab stop. Left and Right run across both menus, title to title. The rest of the keyboard follows the WAI-ARIA menu bar pattern.
- When the bar does not fit, each menu shows only its glyph and its first title, whose panel lists the menu's titles. When even that does not fit, everything goes under one glyph beside the logo, with each menu as a labelled section. On a phone, choosing a title replaces the panel's rows with its commands, with a Back row, rather than opening a panel beside it.
- In the window view the dock of open windows stands at the foot of the window area, and in the classic view the section tabs stand on a band of PUDL section tabs below the top bar. Paul made both permanent on 2026-10-01, and they shipped the same day (`pudl-adoption.md`, D50).
- The window menu keeps the window's own commands only: open as a page, minimize, maximize, snap, reload, close (Paul, 2026-10-01). An applet's commands live in its front menu, so each command has one home. The Barcode Tool, the one site applet with commands, now gives the bar a menu of its own (Barcode Tool, File, Layout; File comes straight after the applet's name, as in any desktop application) and offers PUDL's window menu nothing while the bar is there. On a page without the bar, such as the admin desktop, it still offers its commands to the window menu, since they would otherwise have no home.
- A command that opens a page of the site opens it as a window in the window view, as the logo menu's places always have.

## How an applet gives its menu

The site's shape, which the proposal carries. An applet's instance offers `menus()`, asked afresh each time a panel opens, as `commands()` is:

```js
{ titles: [
    { label: 'Notes', items: [ { label: 'About Notes', run } ] },
    { label: 'File', items: [ { label: 'Save', run, shortcut: 'Ctrl+S', disabled }, '-', ... ] } ],
  into: { View: [ { label: 'Wrap lines', run, checked: true } ],
          Help: [ { label: 'Notes keyboard shortcuts', run } ] } }
```

A command with `checked` ticks on and off, one with `radio` is one of a group, `items` makes a submenu, and `{ heading }` labels the rows below it. An applet that offers only `commands()` gets a front menu with one title, its own name, holding those commands, so every existing applet has a place in the bar without changing.

## An article's menu

Paul accepted this on 2026-10-01, and it is on the site. His instinct was front matter, and his difficulty how to write a command there. The answer is that an article's commands are links. Every state on this site has an address, so nearly anything an article wants to offer is one: another page, a heading in itself (`#a380`), a file to download, a window to open (`/?open=barcodes`), an applet in a given state (`/page/barcodes?l=demo-logistics`), or a page elsewhere. No code needs to live in the article, and the server can render the menu as ordinary links.

A Markdown article declares it in its front matter:

```yaml
menu:
  - title: Sections
    items:
      - label: The A380 incident
        href: "#a380"
      - "-"
      - heading: Elsewhere
      - label: Qantas flight history
        href: https://en.wikipedia.org/wiki/Qantas
```

Each entry under `menu` is a title, and each item under it a command (`label` and `href`), a heading, or `"-"` for a separator. The server (`Pages/Services/PageMenu.cs`, with YamlDotNet) reads only the `menu:` block, so the rest of the front matter, which the site reads line by line, need not be valid YAML. It renders the menu as a hidden `<nav data-page-menu>` at the top of the article, on the page and in a window alike. A link that is not relative, `http(s)`, `mailto` or a fragment is left out. The site's line-by-line front-matter readers now skip indented lines, so a `title:` inside the menu can't be mistaken for the article's.

An HTML article has no front matter. It writes the same markup itself:

```html
<nav data-page-menu hidden aria-label="Page menu">
  <ul>
    <li>Sections
      <ul>
        <li><a href="#a380">The A380 incident</a></li>
        <li>-</li>
        <li>Elsewhere</li>
        <li><a href="https://en.wikipedia.org/wiki/Qantas">Qantas flight history</a></li>
      </ul>
    </li>
  </ul>
</nav>
```

The article's front menu has its own name first, as an applet's does, holding what every article offers: open as a page or in the window view, copy the link, print, and in a window close. Its declared titles follow. A command follows its link, so a link to another article opens a window in the window view, and a link to a heading moves to that heading in the article, in its window if it has one, without changing the address. A `run:` naming one of a small fixed set of site actions could come later if links prove not to be enough.

## Keyboard shortcuts

Paul accepted this list on 2026-10-01. A shortcut works only while focus is in its applet, and a shortcut with no Ctrl does nothing while focus is in a field.

| Group | Keys |
|---|---|
| The browser's, which no page receives | Ctrl+N, Ctrl+T, Ctrl+W, Ctrl+Q and Ctrl+Tab, each with or without Shift |
| The site's | `/` opens the go palette; the jump key below |
| Editing, left to the browser in a field | Ctrl+A, Ctrl+C, Ctrl+X, Ctrl+V |
| Standard, with one meaning everywhere | Ctrl+S save, Ctrl+O open, Ctrl+Z undo, Ctrl+Y and Ctrl+Shift+Z redo, Ctrl+F find, Ctrl+P print, F2 rename, Delete |
| An applet's own | Any other Ctrl or Ctrl+Shift letter, and plain letters when no field has focus |

The menu bar enforces the first and third rows: a command that claims one of those keys keeps its place in the menu without the shortcut, and the console names it. On the first row, the source is the Chromium issue tracker, which states that since Chrome 4 certain Ctrl combinations are reserved for the browser and can't be intercepted by a page; no browser publishes a full list. The list rests on nothing undocumented, because all it does is keep applets from claiming those keys, and keeping off a key the browser might have let through costs nothing.

The jump key is HTML's `accesskey`, set to `m` on the menu bar's first title. MDN documents each browser's modifier: Alt+Shift+M in Firefox on Windows, Alt+M in Chrome and Edge on Windows, and Control+Option+M on a Mac. MDN also warns that an access key can clash with a browser or assistive-technology shortcut, so it is an extra. The bar stays reachable as one tab stop whatever happens to the key.

## On the site

The menu bar is PUDL's since 0.38.0 (`pudl-adoption.md`, D53), on both the public site and the admin desktop at edit.parkscomputing.com. The site renders the host menu as markup (`Pages/Shared/_MenuBar.cshtml`, from `sitenav.xfer`'s menu since 2026-10-01 as `site-menu-design.md` sets out, and the admin bar in `_AdminLayout.cshtml`), applets give their menus through `menus()` on their instance, and articles through `nav[data-page-menu]`. Before 0.38.0 the site ran its own prototype of the bar (`js/menubar.js`), which is gone, as are the Notes applet and the lab's other leftovers; Dice stays as an ordinary applet whose menu shows what an applet's own menu can do.

## Found on the way

Two bugs in PUDL's menu panels, both reported in `pudl-bug-menu-focus-reduced-motion.md`. For a reader who had asked for less motion, opening a PUDL menu from the keyboard left focus on its button, because the panel's visibility was still in a 0.01ms transition when PUDL focused its first row; PUDL 0.37.2 fixed it, and the site removed the same rule from its own `accessibility.css` (D51). In the dark theme a hovered row was painted the panel's own colour, so it did not show; PUDL 0.37.3 fixed it with `--menu-row-hover` (D52).

The proposal to PUDL is `pudl-proposal-menu-bar.md`.
