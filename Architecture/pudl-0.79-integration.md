# Integrating PUDL 0.79.0

Status: design, 2026-10-23, from the PUDL agent's brief (`C:\Users\paul\OneDrive\Documents\pudl-briefs\parkscomputing.md`) and the 0.79.0 release notes. Nothing here is built yet. The decisions it needs from Paul are listed at the end; each step that is done goes into `pudl-adoption.md` as a decision in the usual way.

The site is on 0.77.0 and skips 0.78.0. The release is tagged, so the brief's caution about waiting for the tag no longer applies. The work is in five steps, each shipped through beta and then production before the next starts, so a problem is found in the step that caused it.

## 1. The release itself

`dist/` from the `v0.79.0` tag replaces `wwwroot/pudl/` and the content volume's `pudl/` in whole, as every upgrade has. Copying it whole also removes the comments in the 0.77.0 copy that mention other projects.

These change on every page with windows, with nothing for the site to do:

- **Window buttons** become square glyph buttons, and the window menu button shows the `window` glyph and a caret. The site sets neither `--win-button-size` nor `--win-glyph-size` and does not replace the menu button's glyph, so nothing of the site's fights them. A window's head grows a little.
- **A maximised window** gets a docked window's 30px title bar, so a maximised Editor or Files gains height.
- **A taskbar button** opens its window's menu on a right-click, with the rows the site already adds through `pudl:window-menu` (Reload, Pin or Unpin, Open in a new window).
- **Every menu group** shows the menu glyph, and the Pins title takes the pin glyph.
- **The site's title folds to its picture** (the favicon) before the pins give way, which `MenuBuilder`'s title with its `<img>` gets without change.
- **Folding toolbars** stop at a group's own menu button rather than folding it into More. The Editor's, Files' and the packages' toolbars take this as they are.
- **The admin desktop's context menu** keeps working; the event is now cancelable and its detail gains `count()` and `anchor()`, which nothing of the site needs yet.

What to check on beta: each converted applet's toolbar folds sensibly; a maximised window's head; the right-click on a taskbar button and its accent ring on the site's tabs, which `window-bar.js` restyles (step 2 changes that); the Pins title and the logo folding on a narrow window.

## 2. The window bar becomes PUDL's taskbar (preview)

PUDL's taskbar was modelled on the site's window bar, so moving over is mostly deleting. It is a preview whose markup may still change, but the markup it asks for is the markup the site already writes, so the risk is small and the code removed is real.

- **`_WindowBar.cshtml`** keeps its `div.win-bar`, the sidebar toggle, the dock and the three links. The dock drops `win-bar-dock`. Close all becomes `data-win-close-all` in place of `data-close-all`, without the `is-disabled` class and the server's `tabindex="-1"`, since PUDL keeps its `href` and `aria-disabled` current and closes each window as its own Close would.
- **The three icons** become PUDL's `minimize-all`, `restore-all` and `close-all` glyphs: the inline SVGs go, and the links are left with no picture of their own, so PUDL draws its glyphs. The sidebar toggle keeps its SVG, which is the site's own control.
- **`window-bar.js`** loses its close-all code (`syncCloseAll` and its click handler). It keeps the sidebar toggle, the pane requests and `[data-win-request]`, which are the site's.
- **`window-bar.css`** loses the bar's layout, the dock's scrolling, the icon sizes, the disabled look, the minimise-all and restore-all swap and the narrow-screen rules for the bar. `.topbar-rule`, which is the admin layout's, stays.
- **Taskbar icons.** PUDL's tabs now have `.win-item-glyph` and `.win-item-title`, and a window with `data-win-glyph` shows its glyph with no script. A window whose icon is a glyph (an applet with no icon of its own, which today gets `glyph-app` from `syncTaskIcons`) gets `data-win-glyph="app"` from `_Window.cshtml`. The icons that are pictures, which are most of them (`data-window-icon`, from `NavNode.IconOf`), still need a script, so `syncTaskIcons` stays for those and is rewritten to put the picture in PUDL's `.win-item-glyph` place instead of building its own `.task-icon` and `.task-title`; its CSS for those goes.
- **The bar's own menu.** A right-click on the bar away from a tab opens Minimize all, Restore all and Close all windows. The sidebar toggle could add Hide or Show sidebar there through `pudl:contextmenu`; that is a small extra, done if it reads well.

What to check: the bar looks as it does now; Close all closes everything a reader may close and leaves a window that refuses; a press at the screen's edge reaches the nearest control; the narrow layout; the existing window-bar and desktop tests.

## 3. The pins become a command bar at the topbar's right (preview)

Today the pins are a hidden `ul[data-menubar-pins]` that the menu bar draws between the site's menus and the front applet's, where they move as the applet's menus come and go. The brief's shape puts them in a fixed place: a folding toolbar at the topbar's right, with a resident applet for the Pins menu.

- **The toolbar.** A `div.toolbar[data-toolbar-fold][data-toolbar-captions="none"]` with one group, Pinned, with the pin glyph, sits after the menu bar and before the view switch and the status area, with `margin-inline-start: auto`. Each pin is an `a.btn.btn-sm` holding its picture (an `img`, or a `span.glyph` for an applet without a picture) and its `span.toolbar-words`. When room runs out the pins drop their words, then fold into one Pinned menu button, before the menu bar folds (fold order 200 against the bar's 300).
- **Rendered on the server where it can be.** A signed-in reader's pins come with the page (`#pc-pins-data`), so the layout writes them into the toolbar and they work before any script runs. A reader who is not signed in keeps pins in this browser only, which the server cannot see, so for them the toolbar starts empty and `pins.js` fills it. The brief assumes every pin can be rendered on the server; only an account's can.
- **The Pins menu** becomes a resident applet, `pin-bar` (the pins manager already has the name `pins`), whose `menus()` gives one title, `{ label: 'Pins', glyph: 'pin', items: [Pin or Unpin the front window, Manage pins] }`. This replaces the `pudl:pins-menu` handler and the `data-pin-command` button. Its Pin or Unpin row says what is in front as the menu opens, as the handler does now.
- **`pins.js`** keeps its store, its saving, the window menu's Pin and Unpin, and `window.pcPins` for the manager. `render()` writes one `a.btn.btn-sm` a pin into the toolbar's group instead of `li` items, and calls `pudlMenubar.refresh()` so the Pin or Unpin row is current. A plain press on a pin still opens its window in the window view.
- **`ul[data-menubar-pins]`** goes from `_Layout.cshtml` once the toolbar works.

What to check: pins open their windows; adding and removing a pin from the menu, the window menu and the manager; another tab following a change; a guest's pins; the folding order on a narrow window; the classic view, where pins lead to pages.

## 4. Glyphs on the menu titles (preview)

`data-menu-glyph` on a title's `<li>` puts a glyph before its words, and such titles fold to their glyphs before the bar collapses, so the bar narrows in steps. The site's titles come from `sitenav.xfer`'s `menu`, which has no way to say a glyph, so `NavNode` gains a `glyph` property (`glyph "home"` in the file) and `MenuModel` writes it as `data-menu-glyph`. The brief suggests `home` for Go, `app` for Applets, `eye` for View, `window` for Window and `info` for Help; the logo's title keeps its picture. The applets' own titles can take `glyph` in their `menus()` the same way, starting with the Editor's (step 5).

## 5. The menu bar as a ribbon, for the Editor (preview)

`data-menubar-ribbon` on the site's menu bar adds Show as ribbon at the topbar's end. Turned on, every title but Pins becomes a tab, and the chosen tab's commands are a row of tools under the topbar, built from the menu rows the site and the applets already give: headings and separators start groups, switches are toggles, radio rows are a segmented control, submenus are menu buttons, and a command marked `glyphOnly` shows its glyph alone. This covers what the site's proposal asked for (`pudl-proposal-applet-ribbon.md`) from the menus rather than from `toolbars()`, so that proposal closes as overtaken.

For the Editor this means:

- **Every command in a menu.** The ribbon is built from the menus, so a command only in the toolbar (Show files, Wrap) is in no tab. The Editor's menus become File, Edit, Insert, Format and View, in GK Companion's split: Insert takes Link, the shortcodes and the timestamp and date rows from Edit; View's part takes Show files, Wrap, the three views and Preview. Every command stays in exactly one menu.
- **`glyphOnly`** on Bold, Italic, Strikethrough, Code, the two lists, Undo and Redo, in the command table, which the ribbon reads.
- **Title glyphs** for the Editor's titles, as step 4.

Files can take the same treatment after the Editor, if the Editor's reads well.

The question this step raises is the in-window toolbar. Unfolded, the ribbon row shows the front applet's commands, and PUDL leaves the applet's own toolbar in its window, so the Editor would show its commands twice. See the decisions below.

## Decisions for Paul

1. **Previews.** Steps 2 to 5 are previews whose markup may change. My recommendation is to take the taskbar (step 2) and the pins command bar (step 3) now, since the first is mostly deleting code and the second fixes the pins moving about, and the ribbon (step 5) after them.
2. **The in-window toolbar under the ribbon.** While the ribbon is shown, should an applet's own toolbar hide? My recommendation is yes: the site hides `.applet-toolbars` while the bar is unfolded, so each command shows once, and the toolbar comes back when the ribbon is turned off. The alternative is to keep both, or to ask PUDL to hide a front applet's described toolbar itself while the ribbon shows, which would serve every site.
3. **Server-rendered pins** for signed-in readers only, with a guest's pins drawn by script, as step 3 says.
