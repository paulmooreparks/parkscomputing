# PUDL bug: a segmented control of links on the topbar takes the topbar's link colour

**Fixed in PUDL 0.34.1** (`pudl-adoption.md`, D47). What follows is the text as it was sent.

From parkscomputing.com, 2026-10-01, found adopting PUDL 0.34.0.

**What happens.** The site's Window/Classic switcher is a `.seg` of links on the topbar, as PUDL allows for views that are addresses (aria-current marks the one shown). Since 0.34.0 the segment not chosen is a raised button, drawn light in the light theme, but its words come out in the topbar's pale `--tb-chrome-fg`, so "Classic" is close to invisible. The dark theme hides the problem because the pale words happen to suit a dark button.

**Why.** `.topbar a:not([class])` gives a plain link on the topbar the topbar's colours. The seg's links carry no class, so the rule reaches them, and at a specificity of (0,2,1) it outranks `.seg a` (0,1,1), which sets `color: var(--text)`. Before 0.34.0 the unchosen segment was flat on the bar, where the bar's colour was right by accident.

**The fix in PUDL.** Keep the topbar's link rule off links that belong to a control, for example:

```css
.topbar a:not([class]):not(.seg a) { color: var(--tb-chrome-fg); }
.brand:hover, .topbar a:not([class]):not(.seg a):hover { color: var(--tb-link-hover); }
```

or lower the rule's weight with `:where(.topbar) a:not([class])`, so any component's own colour wins. A test that renders a link `.seg` on the topbar in both themes and checks the unchosen segment's contrast would catch it.

**The site's workaround,** marked in `wwwroot/css/pudl-site.css`, is `.topbar .view-seg a { color: var(--text); }`, which comes out when PUDL ships the fix.
