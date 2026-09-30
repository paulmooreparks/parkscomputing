# How to add to the terminal

There are two ways to add a command to the terminal. A **script** is a text file of terminal commands. You write it in the content folder and it's live within a minute, with no deploy. A **JavaScript command** is code, for anything the existing commands can't do between them. It lives in the repo and is deployed like the site's other scripts. Try a script first. `Architecture/terminal-design.md` explains why the terminal works the way it does; this page only says how.

## A script

**Where:** a file in `C:\Users\paul\OneDrive\Documents\parkscomputing.com\wwwroot\content\bin\`. The file name is the command name: lower-case letters, digits, `-` and `_`, starting with a letter or digit, 40 characters at most. A `.sh` or `.txt` extension is dropped, so `tagged.txt` runs as `tagged`. A file over 16 KB is ignored.

**Template:**

```
# name: one line saying what it does
#
# Usage: name <argument> [optional]
#
# Anything else a reader should know. man shows this whole
# block, and help shows the first line without "name:".
ls -l /site/tags/$1
```

**What a line can use:**

| You write | It becomes |
| --- | --- |
| `$1` to `$9` | the arguments |
| `${1:-5}` | the first argument, or 5 if there isn't one |
| `"$@"` | all the arguments as one string; unquoted, they stay separate words |
| `$#` | how many arguments were given |
| `$0` | the script's own name |

- A line can use any command the terminal has, including other scripts, pipes (`|`), `>` and `>>`.
- Blank lines and lines starting with `#` are skipped.
- The script stops at the first line that fails, and a `grep` that finds nothing counts as failing.
- Anything piped into the script goes to its first line.
- There are no `if`s or loops.

**To go live:** save the file. The terminal's list of files is cached for up to 60 seconds, and after that `help`, `man name` and `cat /site/bin/name` show it.

**To keep it in the repo:** copy it to `Application/parkscomputing-engine/wwwroot/content/bin/` and add it with `git add -f`. The `-f` is needed because `.gitignore` skips every `bin` folder.

**Scripts for a single reader:** anyone can put scripts in their own `~/bin` in the terminal, where they work the same way. Those live only in that reader's browser.

## A JavaScript command

**Where:** a `.js` file in the repo at `Application/parkscomputing-engine/wwwroot/js/`. It can hold one command or several; `terminal-text.js` holds five and is a good model.

**Template** (`wwwroot/js/terminal-example.js`):

```js
(function () {
    'use strict';
    var T = window.pcTerminal;
    if (!T) { return; }

    T.register({
        name: 'shout',                       // lower case, unique; it replaces any command with this name
        summary: 'print text in capitals',   // help shows this line
        help: 'shout [text...]\n\nPrints its arguments, or what is piped into it, in capitals.\n\nExample: echo hi | shout',
        complete: 'file',                    // Tab completion (see below); leave it out for none
        run: async function (args, io) {
            var text = args.length ? args.join(' ') + '\n' : io.stdin;
            if (text == null) { io.err('shout: nothing to shout'); return 1; }
            io.out(T.paint('bold', text.toUpperCase()));
            // return nothing (or 0) for success, a number for failure
        }
    });
})();
```

**What `run` gets:** `args` is the list of words after the command name, already split and with quotes removed. `io` is everything the command can reach:

| `io.` | What it is |
| --- | --- |
| `out(text)`, `err(text)` | Write output, or an error in red. Output going into a pipe loses its colours automatically. |
| `stdin` | The text piped in, or `null`. |
| `interactive` | `false` when the output goes into a pipe or a file. |
| `cols`, `rows` | The terminal's size. |
| `interrupted()` | `true` once the reader presses Ctrl+C; check it in a long loop and stop. |
| `read(path)` | A promise of any file's text: a page, a script, or a reader's file. It rejects with a readable message. |
| `fs.resolve(path)` | The node for a path, or `null`. A node has `name` and `kind` (`page`, `app`, `link`, `script` or `file`), and `children` if it's a directory. |
| `fs.cwd()`, `fs.chdir(node)` | The current directory. |
| `fs.write(path, text, append)` | A promise of `{ error }` or `{ node }`. It only writes inside `~`. |
| `fs.mkdir(path, parents)`, `fs.remove(node, recursive, label)`, `fs.move(node, dest, label)` | Change `~`. Each returns an error message, or `null` on success. |
| `open(entry, state, pageQuery)` | Open a page or applet the way the current view does, for example `io.open({ name: 'conway', kind: 'app' }, 'boardSize=20&init=...')`. |
| `pager(text, label)` | Show text a screen at a time, like `less`. |
| `edit(path)`, `download(name, text)`, `upload()` | What `edit`, `download` and `upload` use. |

**Tab completion (`complete`):** `'file'`, `'dir'` or `'path'` completes paths; `'command'` completes command names; a function `(words) => [...]` returns the words to offer.

**Helpers on `window.pcTerminal`:**
- `paint(color, text)`, with `bold`, `dim`, `inverse`, `red`, `green`, `yellow`, `blue` or `cyan`.
- `strip(text)`, which removes colour.
- `wrap(text, width)`.
- `columns(names, width)`, which lays names out the way `ls` does.

**To go live:**

1. Save the file in `wwwroot/js/`.
2. In `wwwroot/js/applets.js`, add it to the list: `window.pcTerminalCommands = ['/js/terminal-text.js', '/js/terminal-example.js'];`
3. In the same file, raise the terminal's `ver` by one. That version is what makes browsers fetch the new command file instead of a cached one.
4. Copy the command file and `applets.js` to `C:\Users\paul\OneDrive\Documents\parkscomputing.com\wwwroot\js\`.
5. Run `docker restart parkscomputing-dev`. Changing `applets.js` needs a restart, because the server works out its cache version once and doesn't notice the change.
6. Commit the two files.

Every later change to the command file needs steps 3 to 6 again.

## Which to choose

Use a script when the job can be done by stringing existing commands together; it's quicker to write and needs no deploy. Use JavaScript when it needs something no command does yet, such as counting, reformatting or calculating. A new JavaScript command also makes new scripts possible, so it's often worth writing a small, general one and doing the rest in a script.
