# PUDL bugs: two in menu panels, focus under reduced motion and hover in the dark theme

From parkscomputing.com, 2026-10-01, found while building the site's menu bar (`pudl-proposal-menu-bar.md`) with PUDL 0.37.0.

**The first is fixed in PUDL 0.37.2** (`pudl-adoption.md`, D51); the site had the same rule in its own `accessibility.css`, which kept the bug alive until it went too. **The second is fixed in PUDL 0.37.3** (D52), with a `--menu-row-hover` token. What follows is the text as it was sent.

## 1. A menu opened from the keyboard keeps focus on its button when the reader asks for less motion

**What happens.** With the system set to reduce motion, pressing Down on a menu button opens its panel but leaves focus on the button, so the arrow keys never reach the rows. The site's logo menu shows it today. Without the setting it works.

**Why.** `pudl-menu.js` hides a panel while it places it, with `.menu-panel.placing { visibility: hidden }`, then removes the class and focuses the first row. PUDL's reduced-motion rule gives every element a transition:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: 0.01ms !important; transition-delay: 0s !important; ... }
}
```

No rule sets `transition-property`, so it stays at its initial value, `all`, and visibility is transitioned too. For the length of that transition the panel is still `visibility: hidden`, and an element with hidden visibility cannot take focus, so the focus call fails. The site measured the panel's computed visibility as `hidden` both in the `toggle` event and on the next animation frame, after `.placing` had gone.

**The fix in PUDL.** Give menu panels `transition-property: none`, since they animate nothing, or have the reduced-motion rule leave `visibility` out. A test that turns on reduced motion, opens a menu with Down and checks `document.activeElement` would catch it.

**The site's workaround.** None for PUDL's own menus. The lab sets `transition-property: none` on its panels, which is how it found the cause.

## 2. A hovered row does not show in the dark theme

**What happens.** In the dark theme, pointing at a command in a menu panel gives no highlight.

**Why.** A panel's background is `var(--dialog-bg, var(--surface))`, and the dark palette sets `--dialog-bg: var(--surface-alt)`. A hovered `.menu-action`, and a focused row's background, are also `var(--surface-alt)`, so the highlight is the panel's own colour.

**The fix in PUDL.** Tint the row from the text colour, which shows on either palette, for example `color-mix(in srgb, var(--text) 10%, transparent)`, or give the dark palette a hover token that differs from `--dialog-bg`.

**The site's workaround.** The menu bar's rows use that tint (`css/menubar.css`). PUDL's own menus on the site still show no hover in the dark theme.
