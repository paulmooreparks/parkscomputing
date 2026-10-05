# For PUDL: the status area is drawn as a pill, not as a menu bar group

From parkscomputing.com, 2026-10-05, on PUDL 0.48.0.

The proposal for the status area (`pudl-proposal-status-area.md`) asked for it to be "drawn as the menu bar's groups are: one raised surface, with a border and the raised shadow, holding flat controls". PUDL 0.48.0 draws it instead with the topbar pill's tokens, `--tb-chip` for its background and `--tb-chip-shadow` for its shadow. On a topbar that holds a menu bar, the menu bar's groups use the group tokens, `--menubar-group-bg` (the recessed surface), `--menubar-group-border` and `--menubar-group-shadow`. So the status area, sitting in the same row, is lighter and lit differently, and reads as a different kind of control. Paul noticed it at once on beta.

Measured on parkscomputing.com's dark topbar:

| | Background | Border | Shadow |
|---|---|---|---|
| A menu bar group | the recessed surface, flat | 1px, the group border | a faint top highlight and the raised shadow |
| The status area in 0.48.0 | a light gradient (`--tb-chip`) | 1px, darker | a stronger top highlight (`--tb-chip-shadow`) |

**The suggestion** is that `.status-area` take the menu bar group's tokens, with the same fallbacks the menu bar uses:

```css
.status-area {
  border: var(--menubar-group-border-width, 1px) solid var(--menubar-group-border, var(--raise-border));
  background: var(--menubar-group-bg, var(--recess-bg));
  box-shadow: var(--menubar-group-shadow, var(--raise-shadow));
}
```

On a topbar without a menu bar the fallbacks give the ordinary raised group. A test could compare the status area's computed background, border and shadow with a menu bar group's in the same topbar, in both themes.

Parks Computing carries exactly that rule in `css/pudl-site.css`, marked as a workaround, and deletes it when PUDL draws the status area this way.
