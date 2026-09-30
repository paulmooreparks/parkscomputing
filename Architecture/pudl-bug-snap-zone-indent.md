# PUDL bug: the snap picker's zones overlap in a window menu with ticked commands

From parkscomputing.com, 2026-10-01, found by Paul on the site's Editor window with PUDL 0.34.0.

**What happens.** In the window menu of a window whose content offers a command that switches on and off (the Editor's "Show the files" and "Wrap lines"), the layout picker's zones spill past their thumbnails and overlap each other, so the picker can't be read. A window whose menu has no such command, such as the site's Terminal, draws the picker correctly.

**Why.** `pudl.css` indents every command without a tick when any command in the panel has one, so the words line up:

```css
.menu-panel:has(.menu-action[aria-pressed]) .menu-action:not([aria-pressed]) {
  padding-inline-start: calc(14px + 12px + var(--space-2));
}
```

The picker's zones are `.menu-action` buttons, so the rule reaches them too. At a specificity of (0,4,0) it outranks `.win-snap .win-snap-zone { padding: 0 }` (0,2,0) in `pudl-windows.css`. A zone is absolutely placed with `box-sizing: border-box`, and 34px of padding in a box 22px wide makes it 36px, wider than its place.

**The fix in PUDL.** Keep the indent to commands with words, for example `.menu-action:not([aria-pressed]):not(.win-snap-zone)` in the rule above, or give the zone rule the weight to win. A test that opens the window menu of a window with a ticked command and checks that no two zones overlap would catch it.

**The site's workaround,** marked in `wwwroot/css/window-bar.css`, is `.win-snap .win-snap-zone { padding-inline-start: 0; }`, which comes out when PUDL ships the fix.
