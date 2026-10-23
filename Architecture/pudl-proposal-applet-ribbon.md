# Proposal to PUDL: ribbons, glyph-only commands and captions in an applet's toolbars

Status: closed as overtaken, 2026-10-23. PUDL 0.79.0 builds a ribbon from the menu bar's menus instead (`data-menubar-ribbon`, with `glyphOnly` on commands), and the site uses that (`pudl-adoption.md`, D84). The proposal was written from parkscomputing.com on 2026-10-22, for the Editor's ribbon.

## The problem

PUDL 0.78.0 brings the single-line ribbon, glyph-only commands and a choice of group captions, and all three are written in markup: a `.ribbon` holding a `.tablist` and the folding toolbars its tabs control, `data-toolbar-glyph-only` on a control, and `data-toolbar-captions="none"` on a toolbar.

An applet does not write its toolbars in markup. It returns a description of them from `toolbars()`, and `pudl-applets.js` builds the folding toolbar from that description, beside the commands the applet's `commandTable()` registers. The description today is

```js
[{ label, groups: [{ label, glyph, priority, end, items: ['bold', { choice: 'view' }, …] }] }]
```

and it has no way to say any of the three. An applet that wants a ribbon must therefore stop describing its toolbar and build the markup itself into its `[data-toolbar-slot]`, keeping in step by hand what `pudl-applets.js` already keeps in step for a described toolbar: the buttons' `data-command`, the choices, redrawing when `commandsChanged` says the commands have changed, and the toolbar's scope. That is the work PUDL took on when it gave applets `toolbars()`, and every application with a ribbon would carry its own copy.

parkscomputing.com's Editor is the first case. Every one of its commands is to be reachable from a ribbon of the same names as its menus (File, Edit, Insert, Format, View), with the well-known formatting glyphs shown alone. GK Companion's Editor is weighing the same move.

## The proposal

### 1. A toolbar with tabs is a ribbon

A toolbar description may give `tabs` in place of `groups`. Each tab is a label and the groups of its row, in the form groups already have:

```js
function toolbars() {
    return [{ label: 'Editor', captions: 'none', tabs: [
        { label: 'File', groups: [
            { label: 'File', items: ['toggle-files', 'new', 'open', 'save', 'save-as', 'close-document'] }
        ] },
        { label: 'Format', groups: [
            { label: 'Paragraph', items: ['style'] },
            { label: 'Text', items: ['bold', 'italic', 'strike', 'code'] },
            { label: 'Lists', items: ['bullets', 'numbers'] }
        ] },
        { label: 'View', groups: [
            { label: 'View', items: [{ choice: 'ed-view' }, 'preview', 'toggle-wrap'] }
        ] }
    ] }];
}
```

`pudl-applets.js` builds from it the markup the ribbon already takes: a `.ribbon` with the toolbar's label as its accessible name, a `.tablist` of one tab for each, and one folding toolbar for each tab, its groups built as a described toolbar's groups are now. The first tab is chosen unless a tab says `selected: true`.

**The ribbon's id is the applet's and the toolbar's,** such as `pudl-ribbon-editor-editor` from the applet's name and the toolbar's label, never an instance's. Show as ribbon keeps the reader's choice in `localStorage` under that id, and the choice belongs to the application, as the ribbon's own design says, so two Editor windows, or the Editor on its page and in a window, share it.

**A tab whose groups are all empty is hidden with them.** Empty groups already hide (0.68.1) when their commands are hidden or absent, which is how an applet offers commands only where they apply; the Editor offers Format and Insert only for Markdown and HTML. A tab left with nothing would stand over an empty row, so it hides too, and if it was the chosen tab, the first tab still showing is chosen. It comes back when its commands do. The ribbon folded into a menu bar drops that menu in the same way.

### 2. A command may show its glyph alone

A command in `commandTable()` may say `glyphOnly: true`. Every toolbar that shows the command, described or a ribbon's row, marks its control `data-toolbar-glyph-only`, so the command's words become its accessible name and its tooltip. The mark belongs on the command because whether a glyph is known is a fact about the command, true in every toolbar it appears in, and the 0.78.0 guidance (bold, italic, underline, the lists, copy, the arrows, refresh) is a list of commands. A menu, which has room for the words, shows them as before.

An item may also be written `{ id: 'bold', glyphOnly: true }`, or `glyphOnly: false` to show the words in one toolbar where the command is otherwise glyph-only, for the rare toolbar that needs to differ.

### 3. A toolbar says whether its groups have captions

A toolbar description may say `captions: 'none'` or `captions: 'start'`, which `pudl-applets.js` writes as the toolbar's `data-toolbar-captions`. A ribbon's description says it once and every row takes it. Left out, the toolbar keeps today's default.

## What does not change

A description with `groups` builds the folding toolbar it builds now. `commandTable()`, `commandsChanged`, choices and the toolbar's scope work as they do, and the menus, which list the same command ids, are untouched: every command in the ribbon stays in whichever menu its author put it in.

## What the site does meanwhile

Nothing. The Editor keeps its one folding toolbar until this ships, rather than writing a ribbon in markup that would be thrown away.
