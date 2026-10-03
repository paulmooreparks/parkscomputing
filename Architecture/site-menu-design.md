# The site menu in sitenav.xfer

The current menu placement and PUDL 0.40.0 integration are recorded in [the adoption record](menu-bar-adoption-0.40.md). That record supersedes conflicting placement decisions below; the earlier design discussion is retained as history.

Paul asked on 2026-10-01 for the whole logo menu of the site's menu bar to be configured in `sitenav.xfer`, with entries that carry out commands, with parameters, as well as entries that are links. Until then only the logo's own title came from the file, and View, Window, Go and Help were written into `Pages/Shared/_MenuBar.cshtml`. PUDL's menu bar itself is set out in `menu-bar-design.md`; this document is about where its host menu comes from.

## The menu array

The root's `menu` is a list of titles, the first the logo's own, whose `icon` PUDL shows as the brand. A title's `nav` holds its entries:

| Entry | Meaning |
|---|---|
| `{ slug "about" }` or `{ title "…" url "…" }` | A link. A slug borrows the title, description, icon, address and window shape of the nav entry of that slug, as menu entries always have, and a page of the site opens as a window in the window view. |
| `{ title "…" command "name" args { … } }` | A command, with its parameters by name. |
| `{ title "…" nav [ … ] }` | A submenu. |
| `{ heading "…" nav [ … ] }` | A heading over the entries of its nav. |
| `{ separator ~true }` | A separator. |
| `{ from "applets" }`, `{ from "sections" }` | Entries of the nav, kept in step with it: a section's entries by its slug, or a link to the list of each section. |

Any entry, a title included, may carry `when "window"` or `when "classic"` to show in that view only. The arguments are an XferLang object, which the server reads into a `Dictionary<string, string>` (XferLang 0.15.25 deserializes an object into one). Paul suggested a list of name and value pairs; the object is the same pairs, unique by name, at a third of the text, and named arguments need no order.

`NavService` watches `sitenav.xfer`, so a change to the menu shows on the next page without a build or a restart.

## Commands

Each command decides how it stands in the page (`Pages/Services/SiteCommands.cs`), on both sites. Where what it does has an address it is a link, which works without script and which PUDL's menu bar follows as a click would. Where it has none it is a button. Both carry `data-command` and `data-args`, and `js/commands.js` carries the command out, or for a link declines and lets the address be followed.

| Command | Arguments | In the page | What it does |
|---|---|---|---|
| `view` | `value`: `window` or `classic` | link, `/?view=window` or `/home`, ticked for the view in use | Switches the view. |
| `theme` | `value`: `light`, `dark` or `system` | button, ticked for the reader's preference | Sets PUDL's theme. |
| `find` | | button | Puts focus in the window view's list filter. |
| `windows.minimize-all`, `windows.restore-all`, `windows.close-all` | | the window bar's links, whose addresses PUDL keeps current | Minimizes, restores or closes every window. |
| `open` | `applet`, and optionally `state` | link to the applet's page with the state in its query | In the window view, opens the applet's window and hands it the state through the site's applet hand-off (`js/continuity.js`), closing a window already open so that it starts again in that state. |
| `run` | `script`, and optionally `cwd` | link to the terminal's page with the script in its query | In the window view, makes the `shell` request the terminal answers, so a terminal opens and runs the script. |

A command the server does not know is a button with its name and arguments, so a script of the site's can define it with `pcCommands.define(name, { run(args, el, event), checked(args) })`. `js/commands.js` warns in the console of a command it cannot carry out. `pcCommands.run(name, args)` carries one out from a script.

Applets could publish named commands of their own the same way, such as a Barcode Tool command to start a new layout, but such a command works only while its applet is running, and there is no use for one yet.

## The menu as Paul set it

Paul asked on 2026-10-01 for the applets to be under Go rather than in the logo menu, and asked what belongs in the logo menu. It holds the site itself, as a Mac's application menu holds the application: Home, About Parks Computing (moved there from Help), Settings, and the Quick Links. View holds the views and the theme; Window, in the window view, the three window commands; Go holds Home, Find in the list in the window view, the sections in the classic view, and the applets as a submenu in both; Help holds the terminal guide.

The applets' submenu is called "Open an applet" because in the classic view Go also links to the Applets section, and PUDL refuses two commands with the same words in one panel.

The logo button that shows before PUDL's script has built the bar, and without script, holds the logo title's links and headings; its commands need script, so it leaves them out.

## The admin site

Paul asked the same day for the admin menu to work the same way, and it does. `/etc/admin-menu.xfer`, or an admin's own `~/.config/admin-menu.xfer`, is the whole logo menu of the admin desktop in the titled shape above: the logo's title with the admin's tools, then View with Theme, and Window on the desktop. Its links name the admin site's own slugs (terminal, editor, files, settings, account, site, signout), which `Identity/AdminMenu.cs` turns into the right element: a tool opens as a window on the desktop and as its page elsewhere, the terminal makes a new one each time, and signing out is a button naming the form the layout holds, since it changes state. The commands are the public site's, apart from `view` and `find`, which have nothing to act on there. Off the desktop the logo's title starts with a way back to it. The file is read on every page, so a change shows at once, and a file that doesn't parse falls back to the shared one and then to the default, so a mistake can't lock an admin out.

A file in the older shape, the logo's entries alone with a labelled group for each heading, still reads: its entries become the logo's title, a group becoming a heading, and the default's View and Window follow. `/etc/admin-menu.xfer` was rewritten in the titled shape on 2026-10-01; it was the old default, unedited.

Both sites share the resolving and the writing (`Pages/Services/MenuModel.cs`): each reads its own file and says what its links lead to, and `MenuBuilder` keeps the entries for the view in use, writes each command through `SiteCommands`, and writes the hidden list PUDL reads. `SiteMenu.cs` is the public site's side and `AdminMenu.cs` the admin site's.
