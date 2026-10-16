# Proposal to PUDL: menu bar titles in the same text color as a button

From parkscomputing.com, 2026-10-17, on PUDL 0.62.0.

The titles in the menu bar and the glyph that opens it are drawn in a dimmed text color, and the color gets brighter when the pointer is over a title or its menu is open. A neutral, enabled button next to the menu bar uses the plain text color. In dark mode the difference is easy to see: the menu bar looks grayer than the buttons beside it, and it changes shade as the pointer moves along it. Paul asked for the menu bar and a neutral, enabled button to share one text color, in each of light mode and dark mode, with no change on hover. The two modes keep their own text colors, as they do now.

## What PUDL does now

In `pudl.css`, `.menubar-title` and `.menubar-glyph` set their color to `color-mix(in srgb, var(--text) 80%, var(--surface-alt))`, which is the text color pulled toward the surface. `.menubar-title:hover` and `.menubar-title[aria-expanded="true"]` then set it to `var(--text)`. A `.btn` sets `color: var(--text)` and does not change it on hover. So the dimmed color is the resting state of the menu bar, and the full text color appears only while a title is hovered or open. In dark mode, where the text is light on a dark surface, that reads as the title lighting up.

## Behavior

**A menu bar title and the menu glyph use `var(--text)` at rest,** the same value `.btn` uses, in every theme.

**Hovering or opening a title does not change its text color.** The hover and open states keep their background and shadow, which already say that the title is active, so the color has no work left to do.

**A host that wants the old dimmed look can have it through a token.** The simplest form is a custom property, for example `--menubar-text`, which defaults to `var(--text)` and which a host can set to its own color. The title, glyph, hover and open rules all read it.

## Why

A menu bar and a button are both things a reader presses, and PUDL's own rules say that pressable things look alike. A dimmed resting color suggests a disabled control, which a menu title is not. The dimming also makes the bar fall short of the contrast that the buttons beside it meet, and it does so most in dark mode.

## What the site does until PUDL ships it

The site overrides the two rules in `pudl-site.css`: `.menubar-title, .menubar-glyph { color: var(--text); }`. Each time PUDL is upgraded the override has to be checked against any change to those rules, which is the cost this proposal would remove. When PUDL ships the change, the site deletes the override.
