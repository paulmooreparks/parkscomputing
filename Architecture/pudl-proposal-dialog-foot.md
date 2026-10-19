# Proposal to PUDL: a dialog's actions stay in view

Status: closed the same day by PUDL 0.65.0, which does this for every dialog from GK Companion's proposals (`pudl-dialog-pinned-actions.md`), with the line shown only while content is hidden beneath a band. The site took it as D69 in `pudl-adoption.md`.

From parkscomputing.com, 2026-10-19. Paul asked for this to be proposed as PUDL's standard for dialogs, after using the Chat applet's settings window, whose Cancel and Save sit in a band of their own at the foot and never scroll away.

## The problem

A PUDL dialog is one scrolling panel: `.dialog-title`, `.dialog-body`, then `.dialog-actions`, all inside the `<dialog>`, which gets `overflow: auto` once it reaches the height of the viewport. In a short dialog that is fine. In a tall one (a settings form, a long confirmation, anything with a list), the buttons that finish the dialog scroll out of sight with the content, and the reader has to scroll to the bottom to find out how to leave. The title scrolls away too, so halfway down a long form nothing says which dialog it is.

The Chat applet's settings had the problem and solved it locally: the tab strip is fixed at the top, the body scrolls on its own between them, and Cancel and Save sit in a footer band with a hairline above it. Paul liked the result enough to want it everywhere. The site's other tall dialogs would get it for free if PUDL had it.

## The proposal

A dialog has three regions, and only the middle one scrolls:

- **Head:** `.dialog-title`, and anything that belongs with it, such as a tab strip. It never scrolls.
- **Body:** `.dialog-body`. It takes the remaining height and scrolls when its content is taller.
- **Foot:** `.dialog-actions`. It never scrolls, and it is set apart from the body by a hairline (`border-top: 1px solid var(--border)`) and the dialog's own background, so content scrolling under it is clearly underneath.

In CSS terms, `dialog.dialog` becomes a flex column with `overflow: hidden`, `.dialog-body` gets `flex: 1 1 auto; min-height: 0; overflow-y: auto`, and the head and foot are `flex: none`. The dialog's padding moves onto the three regions, so the foot's band and hairline run from edge to edge, as they do in the chat's settings.

A short dialog looks almost the same as today: the body does not scroll and the hairline is the only visible change. To keep a small confirmation exactly as it is, the hairline could appear only when the body overflows, but that needs a script or a scroll-driven animation. I would rather keep the hairline always. It also helps the reader see what is content and what is the dialog's frame.

## Why PUDL

PUDL already says where the dialog's actions go (`.dialog-actions`, right-aligned, primary last), so where they stay is the same decision carried one step further. Every project with a tall dialog otherwise re-solves it with its own markup, as the Chat applet did. The markup does not change, only the stylesheet, so existing dialogs adopt it on upgrade.

GTK's dialogs keep their response buttons in an action area of their own at the bottom, outside the content area, which is the part that scrolls when it is put in a scrolled window. The proposal follows the desktop convention PUDL models itself on.

## Open question

Should a resizable dialog (`resize: both`, as the chat's settings dialog is when there are no windows) be part of the standard too? It needs the three-region layout to work at all, since resizing a single scrolling panel just moves where the buttons fall. I would leave it to the project for now, and note in the README that the three regions are what make it possible.
