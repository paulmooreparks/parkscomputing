# Proposal to PUDL: a menu bar

From parkscomputing.com, 2026-10-01. PUDL's window menu gave applets a place for their commands (0.32.0), and on an applet's own page a Commands button above it. Paul finds both hard to discover: nothing about a small caret in a title bar says that an applet's File and Edit live behind it. He wants an application menu bar, in the application bar, that works the same in a page of windows and on an ordinary page. The site built one, tried four looks and three places for it in a lab, and now runs it on every page for every reader (`wwwroot/js/menubar.js` and `css/menubar.css`; its Dice applet, at `/page/dice`, shows what an applet's own menu can do, and the Barcode Tool has one too). The design below is what came out of that. The site's record of the decisions is `menu-bar-design.md`.

## Names

The **menu bar** is the whole row in the application bar. A **menu** is one raised group in it. A **title** is a word in a menu, such as File. A **panel** is what a title opens, PUDL's existing menu panel. A **command** is a row in a panel, the word `commands()` already uses.

In ARIA terms the menu bar is one `menubar`, each menu a `group` in it, each title a `menuitem` with `aria-haspopup`, and each panel a `menu`. The names differ on purpose: a reader who says "the Dice menu" means the group, not the panel.

## Behavior

**The menu bar lives in the application bar**, beside the logo, as a Mac's does, so there is one in the page however many windows are open. It shows the menus of what the reader is in.

**There are at most two menus.** The **logo menu** is always there; Paul found it jarring when the site's own commands came and went. Its first title is the logo and the product's name, whose panel holds what PUDL's logo menu holds today. Its other titles are the standard ones, which the host names; the site's are View, Window (in a page of windows only), Go and Help. To its right is the **front menu**, which exists only when what the reader is in has one: the applet in the front window, the applet on the page, or the article being read. Its first title is its own name. Keeping it to the right means the logo menu never moves or changes width as the reader moves between windows.

**A menu is one raised surface with the menu glyph at its left, and its titles are flat words** that take their press from the surface around them, as the segments of a segmented control do. A title lights while the pointer is on it, and the open title is pressed into the surface. The glyph is part of the surface, not a button of its own, and a press on it opens the menu's first title. The site tried a row of raised buttons, notebook tabs standing on the bar's edge, and a ribbon; Paul chose flat titles, and it is the raised group that tells the reader they can be pressed. This keeps the grammar: the pressable thing is raised, and nothing flat is pressable on its own.

**A front menu may not use a standard title.** It adds its own commands to a standard panel instead, below a separator under a heading with its name, and only while it is in front. It can add commands but never rename, remove or reorder the host's. Within a panel every command's label is unique. A title or command that breaks either rule is left out, with a console warning that names the applet, so a clash cannot ship unseen.

**The whole bar is one tab stop.** Left and Right run across both menus from title to title, Down, Enter and Space open a panel, Up and Down move in it, Right opens a submenu or moves to the next title, Left closes a submenu or moves to the previous title, Escape closes, Tab leaves, and a letter moves to the next row that starts with it. This is the WAI-ARIA menu bar pattern with groups inside the bar, which the pattern allows.

**When the bar does not fit**, each menu shows only its glyph and its first title, whose panel lists the menu's titles, each leading to its commands. When even that does not fit, everything goes under one glyph beside the logo, with each menu as a labelled section. On a narrow screen, where PUDL already opens a menu as a sheet, choosing a title replaces the sheet's rows with its commands and a Back row, rather than opening a panel beside it.

**An applet that offers only `commands()` still has a place.** Its front menu has one title, its own name, holding those commands. Every existing applet appears in the bar without changing.

**The window menu keeps the window's own commands only**, and on a page the Commands button above the applet goes, so each command has one home (Paul, 2026-10-01). Where a page has no menu bar, the window menu goes on holding the applet's commands, since they would otherwise have none. The site does this today by having its applet offer `commands()` only while there is no bar; in PUDL it would be the window menu's own rule.

**An article may have a menu too.** Its commands are links, since every state of a PUDL application has an address: a heading in the article, another page, a window to open, an applet in a given state. The host renders the article's menu as a hidden `nav[data-page-menu]` of nested lists, a title with its links under it, and the menu bar reads it into the article's front menu, after a first title of the article's own name holding what every article offers (open as a page, copy the link, print, close). A link to a heading moves to it in the article, in its window if it has one; any other link is followed as the reader's click on it would be, so a link to another article opens a window in a page of windows. The site's Markdown articles declare the menu in their front matter, and its server renders the markup.

**Commands that open a page of the application open it as a window** in a page of windows.

## The contract

An instance may offer `menus()`, asked afresh each time a panel opens, as `commands()` is:

```js
menus() {
  return {
    titles: [
      { label: 'Notes', items: [ { label: 'About Notes', run } ] },
      { label: 'File', items: [
          { label: 'Save', run, shortcut: 'Ctrl+S', disabled: !dirty },
          '-',
          { label: 'Change case', items: [ ... ] },
          { label: 'Clear the note', run, danger: true } ] } ],
    into: {
      View: [ { label: 'Wrap lines', run, checked: wrap } ],
      Help: [ { label: 'Notes keyboard shortcuts', run } ] } };
}
```

A command takes `label` and `run`, and may take `checked` (ticked when on), `radio` (one of a named group), `disabled`, `danger`, `shortcut` (shown at the right, and carried out while focus is in the applet), or `items` (a submenu). `'-'` is a separator, and `{ heading }` labels the rows below it. The host declares its logo menu's titles; the site would give PUDL the same shape for them.

## Asks

1. The menu bar itself, in `pudl-applets.js` or beside it, with the behavior above. The site's script is about 850 lines and is free to take.
2. A menu glyph, three stacked lines, as `--glyph-menu`. Paul chose it because it is read as "menu" nearly everywhere.
3. A published list of the shortcuts an applet may claim, which the menu bar enforces. The site's list, in `menu-bar-design.md`, keeps applets off the keys Chromium reserves for the browser (Ctrl+N, T, W, Q and Tab, with or without Shift) and off the editing keys every field uses (Ctrl+A, C, X, V); a command naming one keeps its place without the shortcut, with a console warning. It names the standard ones with one meaning everywhere (save, open, undo, redo, find, print, rename, delete) and leaves the rest to applets.
4. A key that jumps to the menu bar. F10 and the bare Alt key belong to the browser. The site uses HTML's `accesskey`, `m` on the first title, whose modifier each browser documents (MDN lists them). Since MDN also warns that an access key can clash with a browser or assistive-technology shortcut, the bar's being one tab stop remains the way to it that always works.

Two related bugs in PUDL's menus are reported in `pudl-bug-menu-focus-reduced-motion.md`; PUDL 0.37.2 and 0.37.3 fixed them.
