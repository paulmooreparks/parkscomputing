# Bug report to PUDL: raising a window by its title bar leaves focus in the window behind

**Fixed in PUDL 0.37.1** (`pudl-adoption.md`, D51). What follows is the text as it was sent.

From parkscomputing.com, 2026-10-01, observed by Paul on the admin desktop with PUDL 0.37.0 pinned.

## What happens

Paul has two windows open, an editor and a terminal, and is typing in the editor. He clicks the terminal's title bar. The terminal comes to the front, but what he types next still goes into the editor, which is now behind it. He has to click inside the terminal before his keys reach it.

## The cause

`onPointerDown` in `pudl-windows.js` raises the window at once, which is right. For a press on the title bar it then calls `e.preventDefault()`, so that a drag does not select text. Cancelling `pointerdown` also suppresses the compatibility `mousedown`, and moving focus is `mousedown`'s default action, so the browser never moves focus to the title bar. Nothing else moves it either: the press path never calls `focusWindow()`, and `onFocusIn` raises a window when focus enters it but does not run in the other direction. Focus therefore stays on the editor's textarea in the window behind.

A press inside a window's body does not have this problem, because that path is not cancelled and the browser focuses what was pressed.

## What it should do

The window the reader raises should have the keyboard. Win32 is the model again here. When a window is activated it gets focus back on the control that had it when the window was last active, and the first control if nothing has had it yet. A reader who was typing in the terminal, clicked away to the editor and then clicked the terminal's title bar expects to carry on typing in the terminal.

The proposed fix:

- Each window remembers the element inside it that last had focus, from the `focusin` the layer already listens for.
- When a press raises a window and focus is not already inside it, focus moves to that remembered element if it is still in the window and can take focus. Otherwise it moves to the window's title bar, as `focusWindow()` does today, so the window's keyboard handling for move and resize is reached and the old window no longer has the keyboard. The focus should use `preventScroll`.
- This happens on any raise the reader asks for, by title bar, dock tab, list row or the window menu, and not only on a press. A raise that script makes without the reader asking, such as a window arriving from a fetch, keeps the existing `focusUnmoved()` guard.

An applet whose content should take focus the first time its window is activated, such as a terminal, could name that element (`data-win-focus`, or an `autofocus` inside the window). Without that the title bar is the fallback. That part is optional; the remembered element alone fixes Paul's case, because he had typed in the terminal before.

## Reproducing

On any PUDL desktop, open two windows that each hold a text field. Type in the first, press the second's title bar without moving the pointer, and type. The characters arrive in the first window's field, and `document.activeElement` is still that field.
