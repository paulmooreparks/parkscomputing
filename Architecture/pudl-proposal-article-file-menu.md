# Proposal to PUDL: no File menu for an article

From parkscomputing.com, 2026-10-05, on PUDL 0.48.0.

When an article is in front, the menu bar gives it two titles of PUDL's own before any the host adds: the article's own menu, named for the article, holding Open as a page, Copy link to this content and Close window; and a File menu holding one command, Print (`frontMenu` in `pudl-menubar.js`, since 0.38.0). Paul finds the File menu close to useless: a whole title for a single command, and a command whose result is poor, since printing the window view prints the desktop rather than the article. He asked for it to be filled with substantially more or to go. Nothing else belongs in it for an article. Opening the article as a page and copying its link are already in the article's own menu, editing is the host's, and offering a download of an article's source is a staff concern, not a reader's. So this asks for it to go.

## Behavior

**An article has no File menu by default.** The menu bar gives an article its own menu, and then whatever titles the host's page menu adds, as now.

**Print, where a host offers it, is in the article's own menu,** after Copy link to this content and before the separator and Close window, since printing is something done to this article, as copying its link is. A host offers it by marking the page menu, for example `nav[data-page-menu][data-page-print]`, when its print output is worth having, which for an article in a window means printing the article and not the desktop around it. Without the mark there is no Print command, rather than one that prints the desktop.

**A host that wants a File menu for an article adds one,** as a title in its page menu list, which the menu bar already reads and appends.

## Why not keep Print where it is

A command PUDL offers should do what it says. In the window view, `window.print()` prints the whole desktop, with the sidebar, the other windows and the chrome, so a reader who presses Print gets something they did not ask for. Until a host has made its print output right, offering the command misleads; once it has, the article's own menu is where a reader looks for it.

## What the site does when PUDL ships it

The site adopts the release and its articles lose the File menu. Printing an article well, the front window's article alone, with the window chrome and the desktop left out, is separate work for the site, after which it marks its page menus to offer Print.
