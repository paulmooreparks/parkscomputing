---
title: Terminal Guide
description: Everything the site's terminal can do, from ls and cd to the editor, your home directory and scripts
date: 2026-09-29T00:00:00
lastModified: 2026-09-29T00:00:00
commentsAllowed: false
commentsEnabled: false
lang: en-us
---

# Terminal Guide

The [terminal](/page/terminal) is another way to read this site. Instead of clicking through pages, you move around them with commands like `ls` and `cd`, read them with `cat` and `less`, and launch the applets by name. It also gives you a small home directory of your own, with an editor, where you can keep notes, Conway patterns, Sudoku puzzles and scripts.

If you've used a Unix shell, most of it will feel familiar. If you haven't, start with the next section and try each command as you go. You can't break anything: the site itself is read-only, and your own files live only in your browser.

Inside the terminal, type `guide` to read this page a screen at a time, or `guide -w` to open it here.

## Getting started

Open the terminal from **Applets**. In the window view it opens as a window you can move, resize and keep beside other windows. In the classic view it's a page of its own at `/page/terminal`.

You'll see a greeting and a prompt:

```text
guest@parkscomputing:/$
```

The part after the colon is where you are, here `/`, the top of the site. Type a command after the `$` and press Enter. A few to try first:

```text
ls
cd articles
ls -l
cat coincidences
cd
help
```

- `ls` lists what's in the current directory.
- `cd articles` moves into the articles, and `ls -l` lists them with their dates and titles.
- `cat coincidences` prints an article.
- `cd` on its own takes you to your home directory.
- `help` lists every command, and `man` followed by a command's name explains that command in detail, for example `man grep`.

## Typing at the prompt

The prompt keeps the keys you'd expect from a shell.

| Keys | What they do |
| --- | --- |
| Enter | Run the command. |
| Left, Right | Move along the line. |
| Home or Ctrl+A, End or Ctrl+E | Jump to the start or the end of the line. |
| Backspace, Delete | Delete the character before or under the cursor. |
| Ctrl+U | Delete everything before the cursor. |
| Ctrl+K | Delete everything from the cursor to the end. |
| Up, Down | Step back and forth through the commands you've typed before. |
| Tab | Complete a command or a path (see below). |
| Ctrl+L | Clear the screen. |
| Ctrl+C | Abandon the line you're typing, or stop a command that's running. |

**Tab completion.** Press Tab partway through a word and the terminal finishes it: command names at the start of a line, and paths after commands that take them. If several things match, it fills in as much as they share, and pressing Tab twice quickly lists them all. Some commands complete their own words too: `conway` completes its pattern names and `barcodes` its symbologies.

**History.** Your commands are remembered in this browser, even after you close the terminal. `history` lists them, and `history -c` clears the list.

**Typing ahead.** While a slow command is running, such as a search of every article, you can keep typing. What you type waits, and runs when the command finishes. Ctrl+C stops the command and throws away anything you typed ahead.

**Pasting.** Paste works as usual. If the text you paste contains a line break, the first line runs as a command and the rest is dropped, so a pasted script can't run all at once by accident.

## How the site is laid out

The terminal shows the site as a tree of directories and files, built from the site's own navigation. Nothing in it is a file on the server; it's the site's structure, and nothing more.

```text
/
├── articles/        every article, newest first
├── applications/    the downloadable applications
├── applets/         the web applets, and this guide
├── projects/        my projects
├── links/           links to other sites
├── tags/            one directory per tag, holding the articles under it
├── bin/             the site's scripts
├── home/guest/      your own home directory, also called ~
├── about
└── ...
```

A file's name is the last part of its address on the site, so `/articles/coincidences` is the page at `/page/coincidences`.

`ls` marks what each entry is:

| Mark | Meaning |
| --- | --- |
| `name/` | A directory. `cd` into it, or `ls` it. |
| `name*` | Something you can run: an applet, or a script. Type its name to run it. |
| `name@` | A link to another site. `cat` prints its address, and `open` opens it in a new tab. |
| `name` | A page, or one of your own files. |

**Paths.** A path starting with `/` begins at the top of the site. Any other path starts from where you are. `..` means the directory above, `.` means the current one, and `~` means your home directory. So from `/articles`, `cat ../about` reads the About page, and `ls ~` lists your own files.

**Tags.** Every tag used on the site is a directory under `/tags`, named in lower case with hyphens, so the articles tagged "web apps" are in `/tags/web-apps`. The `tags` command lists them all with how many articles each has.

## Commands

`help` lists every command and `man <command>` gives the details, but here they all are in one place.

### Moving around

| Command | What it does |
| --- | --- |
| `ls [-l] [path...]` | List a directory, or the current one. With `-l`, one entry a line with its date, its kind and its title (or, for your own files, its size). When `ls` feeds a pipe it prints one name a line. |
| `cd [path]` | Move to a directory. With no path, or `~`, it goes to your home directory; `cd /` goes to the top of the site. |
| `pwd` | Print the full path of where you are. |
| `tree [path]` | Draw a directory and everything under it. |
| `find [path] [-name pattern]` | List every path under a directory, or only those whose names match a pattern such as `"*barcode*"`. `*` matches anything and `?` any one character, ignoring case. |

### Reading

| Command | What it does |
| --- | --- |
| `cat <file...>` | Print a file. A page prints as plain text, with each link's address after it in angle brackets and each image as `[image: its description]`. A link to another site prints its address. With nothing but a pipe feeding it, `cat` passes the text straight through. |
| `less <file>` | Show a file a screen at a time (keys below). It can also page through whatever is piped into it, such as the long listing of every article. |
| `open <path>` | Open a page, an applet or a link the way the site normally does: as a window in the window view, or by going to the page in the classic view. A link to another site opens in a new tab, and one of your own files opens in the graphical Editor. |
| `grep [-i] [-l] [-r] pattern [path...]` | Print the lines that match a pattern, with the matches highlighted. The pattern is a regular expression, so `grep "^## "` finds the section headings in a page. `-i` ignores case, `-l` prints only the names of the files that match, and `-r` searches every file under a directory (the current one if you name none). Without a path, it searches what's piped into it. |
| `tags` | List every tag and how many articles carry it. |

**Keys in `less`:** Space, `f` or Page Down moves forward a screen; `b` or Page Up moves back; the arrow keys, `j`, `k` and Enter move a line; `g` or Home jumps to the top and `G` or End to the bottom; `q`, Esc or Ctrl+C quits.

### Working with text

These work on files you name, or on whatever is piped into them.

| Command | What it does |
| --- | --- |
| `head [-n count] [file...]` | The first lines, ten unless you say otherwise. `-5` works as well as `-n 5`. |
| `tail [-n count] [file...]` | The last lines. |
| `wc [-l] [-w] [-c] [file...]` | Count lines, words and characters, or only the ones you ask for. |
| `sort [-r] [-n] [-u] [file...]` | Sort lines. `-r` reverses, `-n` sorts by a number at the start of each line, and `-u` keeps one of each line. |
| `uniq [-c] [file...]` | Drop a line that repeats the one before it. `-c` counts how many times each came. Sort first to drop every repeat. |
| `echo [text...]` | Print its words, mostly as the start of a pipe or to write a file. |

### The applets

Each applet runs by its name, as it appears in `/applets`. Some also take arguments.

| Command | What it does |
| --- | --- |
| `sudoku [file]` | Open the Sudoku game, with your own puzzle if you name a file (the format is below). |
| `conway [pattern or file]` | Open Conway's Game of Life. The patterns from the article are `glider`, `gun` (a Gosper glider gun), `face` and `long`; a file of your own is a pattern in the `.cells` format described below. `life` is another name for it. |
| `barcodes [symbology] [data]` | Open the barcode tool, set to a symbology and data if you give them: `barcodes ean13 480036140036`. The symbologies are `ean13`, `ean8`, `upca`, `upce`, `gs1-128`, `itf14`, `itf`, `code128`, `code39`, `codabar` and `qr`. `barcode` is another name for it. |
| `flashcards` | Open the barcode flash cards. |
| `terminal [dir]` | Open another terminal, in this directory or the one you name. |
| `files [dir]` | Show this directory, or the one you name, in Files. |

In the window view each applet opens as a window beside the terminal. In the classic view the browser goes to the applet's page, and Back brings you back to the terminal.

You can have up to four terminals open in the window view, titled Terminal, Terminal 2 and so on. Each keeps its own directory and scrollback, and all of them share one command history, so the Up arrow in any of them finds what you typed in the others. With four open, `terminal` moves the newest one to the directory instead of opening a fifth. On the terminal's own page, in the classic view, `terminal` opens the new one in a browser tab.

### Your files

| Command | What it does |
| --- | --- |
| `edit [-g] <file>` | Open a file in the terminal's editor, creating it if it doesn't exist. `nano` is another name for it. With `-g` the file opens in the graphical [Editor](/page/editor) instead. |
| `touch <file...>` | Create an empty file, or update the time on one that exists. |
| `mkdir [-p] <directory...>` | Make a directory. `-p` makes any missing directories along the way and doesn't complain if it exists. |
| `rm [-r] <path...>` | Remove files. `-r` removes a directory and everything in it. |
| `rmdir <directory...>` | Remove an empty directory. |
| `cp <file> <destination>` | Copy a file into your home directory. The file can be one of yours or any page of the site, which is copied as text: `cp /articles/coincidences ~/`. The destination can be a directory or a new name. |
| `mv <path> <destination>` | Move or rename a file or directory within your home directory. |
| `download <file>` | Save a file to your computer through the browser's usual download. A page downloads as a `.txt` file. |
| `upload [directory]` | Choose text files on your computer and copy them into your home directory. A file with the same name is replaced. |

All of these change only your home directory. Anything that would change the site, like `rm /articles/coincidences` or `edit /about`, is refused with a message saying so.

### Everything else

| Command | What it does |
| --- | --- |
| `help` | List every command, then the site's scripts and your own. |
| `man <command>` | Explain a command, or show the comments at the top of a script. |
| `history [-c]` | List, or clear, the commands you've typed. |
| `clear` | Clear the screen. |
| `guide [-w]` | Read this guide in the terminal, or open it with `-w`. |

## Pipes and saving output

A `|` sends one command's output into the next command, so small commands combine into bigger ones:

```text
ls /articles | wc -l                     how many articles are there?
ls -l /articles | head -n 5              the five newest
ls -l /articles | less                   every article, a screen at a time
grep -ril qantas /articles | wc -l       how many mention Qantas?
cat ~/notes | sort | uniq -c             count the repeated lines in a file
```

A `>` at the end of a line saves the output to a file in your home directory, replacing the file if it exists, and `>>` adds to the end instead:

```text
ls /articles > ~/articles.txt
echo "Read the barbecue one again" >> ~/notes
```

Output saved to a file or sent through a pipe loses its colours, so it's plain text.

## Your home directory

Your home directory is `/home/guest`, which you can always call `~`. It's the only place you can create or change files, and it belongs to you alone.

- **Where it lives.** Your files are stored in this browser, on this device, and nowhere else. They aren't sent to the site, and a different browser or computer has its own separate home directory. To keep a copy or move a file between devices, use `download` and `upload`.
- **How much it holds.** Each file can be up to 256 KB, and the whole directory up to 2 MB, which is a lot of text. If a save would go over, you're told, and nothing is lost.
- **Several tabs.** If you have the terminal open in two tabs, a change in one shows up in the other at its next command.
- **Erasing it.** "Forget this browser's data" in the site's settings (the gear at the top right) erases your home directory along with the terminal's history and every other preference the site keeps. So does clearing the site's data in your browser.

The first time you open the terminal, your home directory gets a few files to play with:

| File | What it's for |
| --- | --- |
| `README` | A short welcome, with things to try. |
| `glider.cells` | A glider, for `conway glider.cells`. |
| `puzzle.sudoku` | A Sudoku puzzle, for `sudoku puzzle.sudoku`. |
| `bin/hello` | A sample script: try `hello`, or `hello` followed by your name. |
| `barcode-layouts.json` | The barcode tool's layouts (see below). |

These arrive once. If you delete one, it stays deleted.

## The editor

`edit <file>` opens a full-screen editor in the terminal, in the style of nano. The top line shows the file's name, and says "modified" once you've changed it. The text fills the middle. Below it is a line for messages, and the bottom line lists the main keys.

| Keys | What they do |
| --- | --- |
| Ctrl+S (or Ctrl+O) | Save. |
| Ctrl+X | Leave the editor. If there are unsaved changes, it asks: `y` saves and leaves, `n` leaves without saving, and Esc goes back to editing. |
| Ctrl+K | Cut the current line. Several cuts in a row collect together. |
| Ctrl+U | Paste the lines you cut, above the cursor. To move lines, cut them, move the cursor and paste. |
| Ctrl+G | Show the keys. |
| Ctrl+C | Show which line and column the cursor is on. |
| Arrow keys, Home, End, Page Up, Page Down | Move around. |
| Enter, Backspace, Delete, Tab | As you'd expect. Tab inserts spaces. |

A few details:

- There is always an empty line at the very end, so there's somewhere to move to below your last line, and to paste after it.
- Long lines don't wrap; the view scrolls sideways to follow the cursor.
- Tabs are turned into spaces, and every saved file ends with a line break.
- If you edit a file that doesn't exist yet, it's created the first time you save, as long as it's in your home directory.
- Browsers keep a few keys for themselves, such as Ctrl+W and Ctrl+T, so the editor doesn't use them.

## Files and the Editor

The terminal has two graphical companions under **Applets**, and all three see the same files. A file you save in one appears in the others straight away, even in another tab.

- **[Files](/page/files)** shows the site and your home directory as folders, with your home directory at the top. Double-click a folder to open it, a page to read it, an applet to launch it, or one of your files to edit it. Inside `~`, and only there, you can make files and folders, rename, move (drag an entry onto a folder), delete, download, and upload, including by dropping files from your computer onto the list. The Actions menu has "Open a terminal here", which opens another terminal in the folder you're looking at, and "Run in the terminal", which types a script's name at the prompt for you.
- **[Editor](/page/editor)** is a full graphical editor, with tabs for several files, syntax colouring for Markdown, JSON and scripts, search and replace, and undo. Ctrl+S saves. A page of the site opens read-only, with "Save a copy to ~" to keep a copy you can change. `~/barcode-layouts.json` is checked as you type, and won't save while it has a mistake.

From the terminal, `edit -g <file>` and `open <file>` send one of your files to the Editor.

## Files the applets understand

**Conway patterns** use the plain-text `.cells` format that's common among Life enthusiasts. Each line is a row of cells: `O` is a live cell and `.` a dead one. Lines starting with `!` are comments.

```text
!Name: Glider
.O.
..O
OOO
```

`conway myfile.cells` centres the pattern on a board with room to grow and opens it. Many published patterns come in this format, so you can paste one into the editor and run it.

**Sudoku puzzles** are 81 cells, read left to right and top to bottom. A digit is a clue, and a `.`, `0` or `_` is an empty cell. Spaces, line breaks and other characters are ignored, so you can lay the grid out however you like, and lines starting with `#` are comments. `sudoku myfile` opens it in the game.

```text
# A puzzle
53..7....
6..195...
.98....6.
8...6...3
4..8.3..1
7...2...6
.6....28.
...419..5
....8..79
```

**Barcode layouts.** `~/barcode-layouts.json` is the barcode tool's library of your own layouts, the same one the tool's Layout menu manages. You can edit it here as JSON. When you save, the file is checked the same way the tool checks an import, and if anything is wrong it isn't saved, and the editor tells you why. An open barcode tool picks up your changes as soon as you save, and a change made in the tool shows up in an open editor the same way. The tool's layout dialog also has a link that opens this file in the Editor. The [barcode tool guide](/page/barcode-tool-guide) describes the layout format in full. You can't delete or rename this file, because it belongs to the tool.

## Scripts

A script is a file of terminal commands that runs by name, like a command of its own. Anything that `ls` marks with `*` in `/bin` or in your `~/bin` is a script.

**The site's scripts** live in `/bin`, and `help` lists them under "Site scripts". A few to try:

```text
search qantas        find the articles that mention a word or phrase
latest 3             the three newest articles
tagged travel        the articles under a tag
```

`cat /bin/latest` shows how a script is written, and `man latest` shows the notes at its top.

**Your own scripts** go in `~/bin`. Any file there runs by its name, and `help` lists it under "Your scripts". The quickest way to start is to copy the sample:

```text
cp ~/bin/hello ~/bin/mine
edit ~/bin/mine
mine
```

**Writing one.** Each line is a command, exactly as you'd type it at the prompt, pipes and `>` included. Blank lines and lines starting with `#` are skipped. By convention, the first comment says what the script does, and `help` shows it:

```text
# travel: list the travel articles, newest first
#
# Usage: travel [count]
ls -l /tags/travel | head -n ${1:-10}
```

Inside a script, these are replaced before each line runs:

| You write | You get |
| --- | --- |
| `$1` to `$9` | The words given after the script's name. |
| `${1:-10}` | The first word, or `10` if there isn't one. Any default works, and any of `1` to `9`. |
| `"$@"` | All the words, as one piece in quotes: `grep -ril "$@" /articles` searches for a whole phrase. Without the quotes they stay separate words. |
| `$#` | How many words were given. |
| `$0` | The script's own name. |

A few rules to know:

- A script stops at the first line that fails, so later lines don't run on a mistake. A `grep` that finds nothing counts as failing.
- A script can run other scripts, up to eight deep, which stops a script that runs itself forever.
- A script can sit in a pipe: its output goes wherever the script's output would, and anything piped into the script goes to its first line. So `search qantas | wc -l` counts the results.
- There are no `if`s or loops. A script is a list of commands to run in order.
- A script can do only what you could do by typing at the prompt, so it can't reach anything the terminal can't.

## Links that open the terminal

The terminal remembers where you are. On its own page the directory is in the address, as `cwd`, so a link such as `/page/terminal?cwd=/tags/travel` opens it there. In a window, the terminal goes back to where you left it.

A link can also suggest a command with `run`: `/page/terminal?run=latest%205` opens the terminal with `latest 5` already typed at the prompt. It never runs by itself; you press Enter if you want it to. That's deliberate, so a link someone sends you can't do anything without your say-so.

## Privacy and safety

- The terminal reads only what the site already shows everyone: the navigation, and the text of public pages.
- Your home directory, your history and your scripts stay in your browser. The site never receives them.
- Commands, scripts included, can change only your home directory. The site is read-only from here.
- The terminal can't reach your computer's files. `upload` and `download` go through your browser's own file dialogs, and only when you use them.

## When something goes wrong

| You see | It means |
| --- | --- |
| `command not found` | There's no command or runnable file by that name. Check the spelling, or look at `help`. To read a page, use `cat` or `open` rather than its name. |
| `no such file or directory` | The path doesn't lead anywhere. `ls` the directory to see what's there; Tab completion helps avoid typos. |
| `is part of the site, which is read-only` | You tried to change the site. Copy the page into `~` first if you want your own version. |
| `files can only be created in your home directory (~)` | A save, `>`, upload or copy pointed outside `~`. |
| `Not saved: ...` in the editor | The file wasn't saved, for the reason shown, such as a mistake in the barcode layouts or the home directory being full. Your text is still in the editor. |
| `HTTP 429` | You've asked the site for a great many pages in a short time, usually with repeated searches of every article. Wait a minute and try again. |
| A script stops partway | One of its lines failed; the message above says which. Remember that a `grep` with no matches counts as failing. |
