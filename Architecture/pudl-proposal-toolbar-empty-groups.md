# Proposal to PUDL: a toolbar group with nothing to show leaves the row

Status: closed the same day by PUDL 0.68.1, which the site took as D73 in `pudl-adoption.md`, deleting its workaround.

From parkscomputing.com, 2026-10-20, after moving the Editor and Files to PUDL 0.68.0's folding toolbars.

## The problem

PUDL's proposal for the command table (`docs/proposals/toolbar-commands.md`) says that "a group whose commands are all hidden leaves the toolbar, so the folding measures only what is shown". In 0.68.0 it does not. Each control whose command is hidden gets the `hidden` attribute, but the group around it stays, and its name, which `setupFold` inserts as a `.toolbar-label`, stays visible with nothing after it.

The site hit this twice on the first day. Files' New group (New File, New Folder, Upload) applies only inside the reader's home folder, so everywhere else the row showed "Go ↑ ⌂ │ New │ Selected ↗ ...", with "New" standing alone. The Editor's Format group applies only to a Markdown file, so a plain text file showed a bare "Format". The empty group also keeps its place in the folding order, takes room on the row, and at stage 3 becomes a menu button whose menu is empty.

## What the site does meanwhile

The site listens for `pudl:commands-change`, which `pudl-commands.js` fires after each drawing of the commands. For every `.toolbar-group` inside a `[data-toolbar-slot]` it checks whether any `[data-command]` control in the group is still shown, ignoring the controls PUDL makes for the group's own fold menu and the buttons of a choice whose container is hidden. A group with none is given `hidden`, and a group that has one again loses it. PUDL's folding already skips groups with `hidden` (`!g.hidden` in its fold order), and its `MutationObserver` on the `hidden` attribute makes it measure again, so the row refolds as soon as a group comes or goes.

## The proposal

When `pudl-commands.js` draws the controls in a folding toolbar, it sets `hidden` on any `.toolbar-group` none of whose controls is shown, and clears it when one is. A control counts as shown when it is not `hidden` itself. For a `data-command-choice`, the choice counts as shown when at least one of its commands is. For a command with `items`, its own `hidden` decides, as it does today.

A group in hand-written markup with no `data-command` controls is left alone, since PUDL cannot know what it holds.

## Why PUDL

The rule is already in PUDL's proposal, and the toolbar is the only thing that knows which of its groups it drew from a command table. Doing it in PUDL also lets the folding count the group out before it measures, rather than measuring, being told of the change by an observer, and measuring again.
