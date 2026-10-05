# Proposal to PUDL: a pins group in the menu bar

From parkscomputing.com, 2026-10-05. Paul wants a place for the applets and articles he uses often, one press away in both the window and classic views. He sketched it as an extension of the menu bar: a group of its own with a Pins menu first, whose glyph marks the group as the site identity's glyph marks the site's, followed by buttons rather than menus, one for each pinned item. The site has built it outside the menu bar (`Architecture/pins-design.md`, `js/pins.js`), and it works, but it cannot stand where Paul wants it, between the site group and the applet group, because the menu bar holds those two groups and builds and rebuilds the row itself. This proposal asks PUDL to make a pins group part of the menu bar.

## Behavior

**A menu bar may have a pins group, between the site group and the applet group.** It is a third raised group of the same kind as the other two. The site's group stays first and the applet group, which changes with what is in front, moves to the right of the pins group, so the pins stay put as the front applet changes, as the site's commands do.

**The group's first control is the Pins menu.** Its title shows a pin glyph and the word Pins, the way an identity title shows a logo and a name. The menu holds the host's commands for pinning, which for Parks Computing are Pin "title" and Unpin "title" for whatever is in front, present but disabled when nothing pinnable is, as PUDL asks of a supported command that is momentarily unavailable.

**After it come buttons, not menus.** Each is one pinned item, with the icon and title its window shows in the dock, and pressing it goes to the item. A pin is a link to the item's page, so a modified click opens a new tab as any link does, and the host may handle a plain press itself, as the Parks Computing window view does by opening or raising the item's window.

**When the buttons do not fit, they all give way to one menu, Items, which lists them.** They collapse together rather than one at a time, so the row never shows an arbitrary subset. Below that, the group follows the menu bar's own narrow behaviour: on a phone only the pin glyph remains, and the Pins menu lists the items after its own commands.

**An empty group is still there.** With nothing pinned the Pins menu stands alone, so the reader can see where pins go and pin the first item.

## Declaring it

The host renders the group as it renders the site menu, as a hidden list the menu bar reads, so the group works with the same no-script fallback rules:

```html
<nav class="menubar" data-menubar>
  <ul data-menubar-source hidden> … the site's titles … </ul>
  <ul data-menubar-pins hidden>
    <li data-pins-commands>
      <button type="button" data-pin-command>Pin “About”</button>
    </li>
    <li><a href="/page/about" data-pin-icon="/favicon-16x16.png">About</a></li>
    <li><a href="/page/terminal" data-pin-glyph="app">Terminal</a></li>
  </ul>
</nav>
```

The pins list is the host's, and changes as the reader pins and unpins, so the menu bar needs a call to redraw the group, such as `pudlMenubar.refreshPins()`, and an event when the Pins menu opens, so the host can name what is in front at that moment, as the window menu's `pudl:window-menu` does. Storing pins, and deciding what can be pinned, stay the host's.

## Why PUDL

The menu bar owns the row, its groups' order and their collapse, and only it can place a group between two of its own and collapse all three together correctly. A pin's button is also a new control in the menu bar, beside its menus, and its look, focus order and keyboard behaviour belong with the menu bar's other controls. Any PUDL site with a few things its readers use every day meets the same need, and a site-built bar outside the menu bar can only sit after both groups, where the front applet's changing titles push it about.

## What the site would do

- Render its pins as the list above and drop its own group, `js/pins.js` keeping only storage, the pin commands and the window menu's Pin and Unpin.
- Keep pins per account in the database and per browser for guests, as it does now.
