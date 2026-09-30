# Proposal to PUDL: windows sized by their content

From parkscomputing.com, 2026-10-01. A PUDL window's size is a fraction of the layer, and nothing else. That suits a window whose content fills whatever it is given, such as a terminal or an editor. It does not suit an applet laid out at its own size, like a form or a tool with a fixed layout. On Paul's 4K monitor the site's Barcode Tool opens at 58% by 99% of the layer, which is several times the 560 pixels its content uses, and most of the window is empty. A smaller fraction would crop it on a laptop. The tool's height also changes with its settings (a layout with more fields, the guides turned on), so any fixed size has to allow for the largest case, and is too big the rest of the time.

Paul's answer comes from Win32 (2026-10-01). There, a window either has a sizing border and the user sizes it, or it is a dialog that sizes itself to its template and resizes itself when its content changes, as a "Details >>" button does. The content decides which kind of window it wants.

## Behavior

**A window is sized either by the user or by its content.** A user-sized window is what every PUDL window is today. A content-sized window has no resize edges; its width and height are its content's, and they follow the content as it changes, both larger and smaller. Nothing asks the reader to accept the change, because it follows something the reader did, as a dialog's does.

**A content-sized window keeps its top-left corner where it is** when its size changes, so a control above the part that changed stays under the pointer. If the window would run past the right or bottom of the layer, it is capped there and its body scrolls, as a dialog too tall for the screen does.

**Its title bar keeps what still means something.** Minimize, close, open as a page, dock, and moving the window by its title bar all stay. Maximize goes from the title bar and the window menu, because the window has nothing to fill. Snap zones go from the menu and from the hover picker, because a zone is a size. Dragging a content-sized window to an edge of the layer moves it there and does not snap it. Reset size and position becomes Reset position.

**The address records where the window is, and not its size.** A content-sized window's placement is written as today's floating placement, whose width and height fractions a content-sized window ignores, so an address stays valid if the window later becomes user-sized. A new mode is not needed.

**A user-sized window may carry limits**, a smallest and largest size in pixels, which dragging and the keyboard respect, as `WM_GETMINMAXINFO` does in Win32. A terminal can then keep a usable grid, however small the window is dragged.

**On a narrow layer nothing changes.** Where PUDL shows windows one at a time, full size, a content-sized window is shown the same way, and its content scrolls.

## Declaring it

The window carries its mode, `data-win-size="content"` or `data-win-size="user"`, with `user` the default so every existing window is unchanged, and optionally `data-win-min="w,h"` and `data-win-max="w,h"` in pixels.

An applet declares the mode it wants in its definition, `pudlApplets.define('barcodes', { …, window: 'content' })`, and a host that makes windows for applets, such as a numbered copy from `data-win-src`, sets the attribute from it. The applet's definition is the right place, because the applet knows whether it lays itself out at its own size. Only the applet's author can say whether its content has a size of its own.

**A content-sized window's applet flows.** An applet is told `fit: "fill"` in a window today, because a window gives it a definite box. A content-sized window gives it no box, so the applet is told `fit: "flow"`, and its mount's `data-applet-fit` says so.

**What sets the content's width is the content.** The applet's stylesheet gives its root a width, or a maximum width, as a dialog's template does. The window takes the content's own width through CSS intrinsic sizing (`width: fit-content`), and its height the same way, so the browser does the following-the-content without a script watching sizes. The window's left and top still come from the placement, and its width and height are left to the content, capped by the layer.

## Why PUDL

The window manager is PUDL's, and so are the modes a window can be in, the title bar's buttons, the window menu and the snap picker, all of which this changes. The applet contract is PUDL's too, so declaring the mode in `define()` belongs with it. Every PUDL site that puts a tool with a fixed layout in a window, a form, a settings page, a small game, meets the same problem, and a fraction of the layer is the wrong answer on every screen at once.

## What the site would do

- Declare the Barcode Tool, Settings, Sudoku and the Barcode Flash Cards content-sized, and give each one's root the width its layout wants. The Terminal, Files and the Editor stay user-sized, and the terminal gains a smallest size.
- Check that each content-sized applet measures cleanly. Nothing in it may stretch to the height it is given, or its height would have nothing to come from.
- Drop the `win "w,h"` shapes from those applets' entries in `sitenav.xfer`, which a content-sized window would ignore.
