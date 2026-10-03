---
title: Files Guide
description: Browse the site, manage personal files, and understand browser storage and privacy
date: 2026-10-02T00:00:00
lastModified: 2026-10-02T00:00:00
commentsAllowed: false
commentsEnabled: false
lang: en-us
---

# Files Guide

[Files](/page/files) lets you browse Parks Computing as folders and keep personal text files in your browser. It shares those personal files with the site's Editor and Terminal. In window view, you can keep these applets open beside one another; in classic view, Files has its own page.

## Your data and privacy

On the public parkscomputing.com site, your personal file contents are never sent to the parkscomputing.com servers. Files keeps your personal files, folders, and its saved settings in your browser's local storage. The Upload command reads a file you choose from your computer into that local storage; it does not upload its contents to the website's servers.

The site still retrieves public page listings and page text from the server when you browse them. The local-storage statement concerns the personal data you manage with Files; it does not mean the website makes no network requests.

Your files belong to this browser profile and website origin. Another browser, profile, or device will not see them. Local storage normally survives closing the page or restarting the browser, but it is not a backup. Clearing the site's browser data, using the site's option to forget browser data, or losing the browser profile can remove your files. Private browsing may discard them when the private session ends. Download files you want to keep outside the browser.

This guide describes the public site. The authenticated admin site has a separate server-backed filesystem. Its mounted home directory and server folders send reads and changes to the server; the public site's local-only guarantee does not apply to those folders.

## Get started

1. Open [Files](/page/files). It starts in `/site`, which contains the site's published pages and applets.
2. Choose a folder in the tree on the left. Its contents appear in the list on the right, with their kinds and dates.
3. Select an entry to see its description and other details below the list. Double-click it or press Enter to open it.
4. Choose the home button, or **Files > Your home directory**, to go to `~`, your personal storage.
5. Choose **New file** or **New folder** to create something there. Select the new file and open it in the Editor to enter and save its contents.

## Find your way around

The path bar above the list shows the current folder. Choose a part of the path to return to it. The up button and **Files > Up one folder** move to the parent folder. The home button always returns to your personal directory. You can resize the divider between the tree and list.

| Location | Contents |
| --- | --- |
| `/site` | Published pages, applets, links, and the site's other sections. These are read-only. |
| `/site/tags` | Published entries grouped by their tags. |
| `~` or `/home/guest` | Your personal files and folders in this browser. |
| `/bin` | Terminal commands. This folder is populated when the Terminal starts; opening a command displays its help in a terminal. |

The current folder is represented in the page address or window state. You can bookmark a browsing location, but a link to your personal folder does not transfer its contents to another person or device.

## Menus and opening entries

The **Files** menu and the surface **Actions** button offer operations that apply to the current selection and folder. Select an entry before looking for its commands. Commands that change personal files are absent for read-only site entries. The Files menu also contains folder navigation.

| Command | Behavior |
| --- | --- |
| Open folder | Enters the selected folder. |
| Open | Opens a published page, in a window when using window view. |
| Launch | Starts the selected applet. |
| Open link in a new tab | Opens the entry's external link. |
| Open in the editor or Edit | Opens a personal text file or script in the Editor. |
| View in the editor | Shows a published page's source text in the Editor without changing the published page. |
| Run in the terminal | Opens a terminal with the selected script or applet command at its prompt. Review it and press Enter to run it. |
| Download | Saves a copy of the selected entry's content to your computer through the browser's download mechanism. It does not download an entire folder. |
| Copy to ~ | Copies a published page's text into your personal home directory. |
| Open a terminal here | Opens a terminal at the folder currently shown in Files. |

**View > Files > Show hidden files** toggles names that begin with a dot, including `.config`. Files remembers this setting. The Files label is a section heading inside View.

**Help > Files** contains **Files quick help** and **Files guide**. Quick help opens a dialog with a link to this guide. Close the dialog with its Close button or Escape.

## Create, import, and organize personal files

Open your home directory or a folder inside it to use these operations.

| Command | Behavior |
| --- | --- |
| New file | Asks for a name, creates an empty text file, and selects it in the list. |
| New folder | Asks for a name and creates a folder in the current directory. |
| Upload | Lets you choose text files from your computer and imports them into the current browser folder. You can also drop files onto the list. |
| Rename | Changes the selected entry's name after you confirm the new name. |
| Move to | Asks for a destination path for the selected entry. You can also drag a personal entry onto a writable folder. |
| Delete | Asks for confirmation before deleting the selected entry. Deleting a folder also deletes its contents. Public-site deletion cannot be undone. |

Names cannot contain `/` or be `.` or `..`. A new file or folder cannot use a name already present in the destination. Read any error shown below the list before trying again. Some special files have fewer operations because another applet manages them.

Public storage accepts text files, such as notes, Markdown, JSON, CSV, and scripts. It is not a general binary-file store for photographs or archives. The per-file limit is 256 KB, and the serialized home directory has a total limit of 2 MB, including storage overhead. Uploads or saves that exceed these limits report an error.

The Editor saves into the same personal filesystem that Files and Terminal use. Changes appear across open applets and other tabs on the same origin. Download makes an independent copy on your computer; editing that downloaded copy does not automatically change the browser copy.

## Keyboard access

Use Tab to reach the toolbar, tree, list, and menu bar. Arrow keys move through the tree or list. With an entry selected in the list, Enter opens it. With focus on a list row, Backspace goes up a folder, F2 renames an eligible personal entry, and Delete asks before deleting an eligible personal entry. These file commands do not apply while you are typing in a dialog field.

The menu bar supports arrow-key navigation between titles and commands. Escape closes an open menu or dismisses a dialog.

## Troubleshooting and keeping copies

If a command is missing, select the entry it should act on and check whether you are in a writable folder. New file, New folder, and Upload are available in your personal home directory, not in `/site`.

If a file seems missing, check the folder path, enable Show hidden files if its name starts with a dot, and confirm that you are using the same browser profile and website address where you saved it. Personal files do not synchronize across devices.

If a save fails, check the per-file and total storage limits. The browser can also refuse local storage. Download important files before deleting anything to make space. Files provides downloads of individual entries rather than a whole-home backup command.

If browser data has already been cleared, the website has no server copy of public-site personal files to restore. Import a copy you previously downloaded using Upload.

For command-line access to the same folders, see the [Terminal Guide](/page/terminal-guide).
