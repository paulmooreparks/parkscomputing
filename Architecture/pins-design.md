# Pins

Paul wants a place for the applets and articles he uses often, in the top bar, in both views (2026-10-05). He sketched it as an extension of PUDL's menu bar, and if it works the way he expects, it goes back to PUDL as a proposal.

## The Pins bar

Since PUDL 0.45.0 the Pins bar is PUDL's pins group, between the site group and the applet group, as Paul wanted it. The layout renders the hidden list the menu bar reads (`ul[data-menubar-pins]`), and `js/pins.js` keeps the pins in it, names the Pins menu's command as the menu opens (`pudl:pins-menu`), and opens a pin's window when the bar presses its link. PUDL draws the group, collapses the pins to Items and, on a phone, folds the group into the bar's own menu. The site built the first version itself, after both groups, and proposed the group to PUDL (`pudl-proposal-pins-bar.md`); what follows describes the behaviour, which did not change.

The Pins bar is a third group in the top bar, among the menu bar's site and applet groups. Like those groups it is one raised surface holding flat controls. Its first control is a menu titled Pins, with a pin glyph, which plays the part a group's identity menu plays. After it come buttons rather than menus, one for each pinned item, each showing the same icon and title that item's window shows in the taskbar. Pressing one opens the item: in the window view its window opens, or comes to the front when it is already open; in the classic view the browser goes to its page. Each button is a link to that page, so a middle click or Ctrl+click opens it in a new tab as any link does.

When the buttons are too wide for the room the bar has, they all give way to one more menu, Items, which lists them. They collapse together, never one at a time, so the bar never shows a misleading partial set. On a phone the bar follows the menu bar's own narrow behaviour: only the pin glyph remains, and the Pins menu lists the pinned items as well.

The Pins menu holds one command for whatever is in front: Pin "title" when it is not pinned and Unpin "title" when it is. In the window view that is the front window; in the classic view it is the page. The command is there but disabled when nothing pinnable is in front, as PUDL asks of a supported command that is momentarily unavailable. Each window's own menu offers Pin or Unpin as well, next to Reload, which is the quickest way to pin something already open.

## The Pin manager

The Pins menu ends, after a separator, with Manage pins, which opens the Pin manager: a window in the window view and the page `/pins` in the classic view, served by the site itself as the Account applet is (`ArticleContentService.PinsKey`). It is not called Pins, because PUDL leaves out an applet's menu whose title repeats one of the bar's own. It lists the reader's pins in order, each with Move up, Move down and Remove, and focus stays with a moved pin's button, so a pin can be walked along with the keyboard. Below them, Add a pin lists every page and applet of the site by section, from the same tree the terminal's `/site` is built from (`/api/site/tree`, which now carries each page's own icon), narrowed by a filter, each with Pin, or Pinned once it is. The manager changes the pins through `window.pcPins` in `js/pins.js`, so the menu bar's group, every window menu and other tabs follow at once, and a change made anywhere else shows in the manager at once too.

## What can be pinned

An article, an applet, a book (at the chapter it shows), and the Account window can be pinned. A pin records the item's window key, a book's chapter, the title and the icon its window shows. The title and icon are refreshed whenever the item's window opens, so a renamed article's pin follows it. A numbered copy of a window, such as a second Terminal or a second window of a book, pins the item itself. Tag lists and framed external sites are not pinnable: they are views of something else, not items.

A pin's page is `/page/{key}`, a chapter's `/page/{book}/{chapter}`, and the Account applet's `/account`, so the server never stores an address of its own choosing.

## Where pins are kept

A signed-in reader's pins belong to their account, in the accounts database (`SiteAccountPins`), so they follow the reader between devices. The page carries them as data, so the bar is built without a request, and a change is saved with `PUT /api/account/pins`, which checks every field: at most 50 pins, a key in the shape of a page's slug, a chapter in the shape of a content path, a title of at most 200 characters, and an icon that is a path on this site or nothing. A reader who is not signed in keeps pins in the browser, in `pc-pins`. The first time a browser with pins of its own signs in, those pins join the account's after its own, and the browser's copy is cleared. Other tabs follow a change at once.

## Why this shape

Applets and articles are destinations, and PUDL's Applets menu and Go menu are lists to read through, where pins are the few things a reader goes to without reading. A row of buttons is one press away, where a menu is two. Keeping the row in the top bar rather than the taskbar means it works in the classic view too, which has no taskbar. Making it a group of its own, rather than entries in the site's identity menu, keeps the menu bar's groups as PUDL defines them.
