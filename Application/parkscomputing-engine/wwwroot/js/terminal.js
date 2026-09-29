/* The terminal applet: the public site in terminal mode
   (Architecture/terminal-design.md). Its filesystem is the site's
   structure as sitenav describes it, served read-only by /api/site/tree;
   nothing here can reach a file on the server. Commands are plain objects
   with an async run(args, io), and io is the only thing a command can
   touch. xterm.js 6.0.0 (MIT) draws the screen, loaded beside this script
   from js/vendor. */
(function () {
    'use strict';

    var SELF_SRC = document.currentScript && document.currentScript.src;
    function beside(file) { return SELF_SRC ? SELF_SRC.replace(/terminal\.js/, file) : '/js/' + file; }
    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('could not load ' + src)); };
            document.head.appendChild(s);
        });
    }
    var xtermReady = null;
    function loadXterm() {
        if (window.Terminal && window.FitAddon) { return Promise.resolve(); }
        if (!xtermReady) {
            if (!document.querySelector('link[data-xterm-css]')) {
                var css = document.createElement('link');
                css.rel = 'stylesheet';
                css.href = beside('vendor/xterm-6.0.0/xterm.css');
                css.setAttribute('data-xterm-css', '');
                document.head.appendChild(css);
            }
            xtermReady = loadScript(beside('vendor/xterm-6.0.0/xterm.js'))
                .then(function () { return loadScript(beside('vendor/xterm-6.0.0/addon-fit.js')); })
                .catch(function (err) { xtermReady = null; throw err; });
        }
        return xtermReady;
    }

    var HISTORY_KEY = 'pc-terminal-history';
    var HISTORY_MAX = 200;

    /* ANSI styling. Output that goes into a pipe is stripped of it. */
    var C = {
        reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
        red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m'
    };
    function strip(s) { return String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''); }
    function paint(color, s) { return C[color] + s + C.reset; }

    /* Conway boards named by the article's own pattern links. */
    var LIFE_PRESETS = {
        glider: 'boardSize=10&cellSize=20&speed=16.666666666666668&init=3,1;1,2;3,2;2,3;3,3;8,6;6,7;8,7;7,8;8,8;',
        gun: 'boardSize=200&cellSize=5&wrap=false&init=1,5;2,5;2,6;1,6;11,5;11,6;11,7;12,8;13,9;14,9;12,4;13,3;14,3;16,4;17,5;17,6;17,7;16,8;15,6;18,6;21,5;22,5;22,4;21,4;21,3;22,3;23,2;23,6;25,2;25,1;25,6;25,7;35,3;35,4;36,4;36,3',
        face: 'boardSize=49&cellSize=5&speed=16.666666666666668&init=28,20;28,12;28,13;29,13;28,14;24,16;25,16;26,16;30,16;31,16;32,16;28,18;28,19;',
        long: 'boardSize=176&cellSize=4&init=45,51;47,51;47,50;49,49;49,48;49,47;51,48;51,47;51,46;52,47;'
    };
    var BARCODE_SYMS = ['ean13', 'ean8', 'upca', 'upce', 'gs1-128', 'itf14', 'itf', 'code128', 'code39', 'codabar', 'qr'];

    /* === The site tree =================================================== */

    var treeReady = null;
    function loadTree() {
        if (!treeReady) {
            treeReady = fetch('/api/site/tree', { headers: { Accept: 'application/json' } })
                .then(function (r) { if (!r.ok) { throw new Error('HTTP ' + r.status); } return r.json(); })
                .then(buildFs)
                .catch(function (err) { treeReady = null; throw err; });
        }
        return treeReady;
    }

    function tagSlug(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

    /* Wraps the server's tree in nodes that know their parent and path, and
       adds the virtual tags directory. */
    function buildFs(data) {
        function wrap(e, parent) {
            var n = {
                name: e.name, kind: e.kind, title: e.title || e.name, description: e.description || '',
                tags: e.tags || [], date: e.date ? new Date(e.date) : null, url: e.url || null, parent: parent
            };
            if (e.children) {
                n.children = [];
                e.children.forEach(function (c) { n.children.push(wrap(c, n)); });
            }
            return n;
        }
        var root = wrap(data, null);
        var byTag = {};
        (function walk(n) {
            (n.children || []).forEach(function (c) {
                if (c.children) { walk(c); return; }
                c.tags.forEach(function (t) {
                    var k = tagSlug(t);
                    (byTag[k] = byTag[k] || { tag: t, items: {} }).items[c.name] = c;
                });
            });
        })(root);
        var tags = { name: 'tags', kind: 'dir', title: 'Tags', description: 'Articles by tag', parent: root, children: [], virtual: true };
        Object.keys(byTag).sort().forEach(function (k) {
            var d = { name: k, kind: 'dir', title: byTag[k].tag, description: 'Tagged ' + byTag[k].tag, parent: tags, children: [], virtual: true };
            Object.keys(byTag[k].items).forEach(function (name) {
                var target = byTag[k].items[name];
                d.children.push(Object.assign({}, target, { parent: d, target: target }));
            });
            d.children.sort(function (a, b) { return (b.date || 0) - (a.date || 0); });
            tags.children.push(d);
        });
        root.children.push(tags);
        return root;
    }

    function pathOf(n) {
        var parts = [];
        for (var x = n; x && x.parent; x = x.parent) { parts.unshift(x.name); }
        return '/' + parts.join('/');
    }

    /* Resolves a path against a directory; null when it names nothing. */
    function resolve(root, cwd, path) {
        path = path == null ? '' : String(path);
        var node = path[0] === '/' || path === '~' || path.indexOf('~/') === 0 ? root : cwd;
        var parts = path.replace(/^~/, '').split('/').filter(Boolean);
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i];
            if (p === '.') { continue; }
            if (p === '..') { node = node.parent || node; continue; }
            if (!node.children) { return null; }
            var next = null;
            for (var j = 0; j < node.children.length; j++) { if (node.children[j].name === p) { next = node.children[j]; break; } }
            if (!next) { return null; }
            node = next;
        }
        return node;
    }

    function realOf(n) { return n.target || n; }

    /* === Article text ===================================================== */

    var textCache = {};
    /* Fetches many pages' text in one request and fills the cache. */
    function prefetchTexts(slugs) {
        var want = slugs.filter(function (s) { return !textCache[s]; });
        if (!want.length) { return Promise.resolve(); }
        return fetch('/api/site/texts?slugs=' + want.map(encodeURIComponent).join(','), { headers: { Accept: 'application/json' } })
            .then(function (r) { if (!r.ok) { throw new Error('HTTP ' + r.status); } return r.json(); })
            .then(function (map) { Object.keys(map).forEach(function (k) { textCache[k] = Promise.resolve(map[k]); }); });
    }
    function fetchText(slug) {
        if (!textCache[slug]) {
            textCache[slug] = fetch('/api/site/text/' + encodeURIComponent(slug))
                .then(function (r) { if (!r.ok) { throw new Error(r.status === 404 ? 'no text for ' + slug : 'HTTP ' + r.status); } return r.text(); })
                .catch(function (err) { delete textCache[slug]; throw err; });
        }
        return textCache[slug];
    }

    /* === Words ============================================================ */

    /* Splits a line into pipeline stages of words, honouring single and
       double quotes and backslash escapes. */
    function parse(line) {
        var stages = [[]], word = '', inWord = false, quote = null;
        for (var i = 0; i < line.length; i++) {
            var ch = line[i];
            if (quote) {
                if (ch === quote) { quote = null; } else if (ch === '\\' && quote === '"' && i + 1 < line.length) { word += line[++i]; } else { word += ch; }
                continue;
            }
            if (ch === '"' || ch === "'") { quote = ch; inWord = true; continue; }
            if (ch === '\\' && i + 1 < line.length) { word += line[++i]; inWord = true; continue; }
            if (ch === '|') {
                if (inWord) { stages[stages.length - 1].push(word); word = ''; inWord = false; }
                stages.push([]);
                continue;
            }
            if (/\s/.test(ch)) {
                if (inWord) { stages[stages.length - 1].push(word); word = ''; inWord = false; }
                continue;
            }
            word += ch; inWord = true;
        }
        if (quote) { return { error: 'unterminated quote' }; }
        if (inWord) { stages[stages.length - 1].push(word); }
        return { stages: stages };
    }

    function globToRegex(glob) {
        return new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    }

    /* Wraps prose at word boundaries to a width, keeping indented lines
       (tables and examples) as they are. */
    function wrap(text, width) {
        return String(text).split('\n').map(function (line) {
            if (/^\s/.test(line) || strip(line).length <= width) { return line; }
            var out = [], cur = '';
            line.split(' ').forEach(function (w) {
                if (cur && strip(cur + ' ' + w).length > width) { out.push(cur); cur = w; }
                else { cur = cur ? cur + ' ' + w : w; }
            });
            if (cur) { out.push(cur); }
            return out.join('\n');
        }).join('\n');
    }

    function fmtDate(d) {
        if (!d || isNaN(d)) { return '          '; }
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function styledName(n) {
        var k = realOf(n).kind;
        if (n.children) { return paint('blue', C.bold + n.name) + '/'; }
        if (k === 'app') { return paint('green', n.name) + '*'; }
        if (k === 'link') { return paint('cyan', n.name) + '@'; }
        return n.name;
    }

    function columns(names, width) {
        var plain = names.map(strip);
        var w = plain.reduce(function (m, s) { return Math.max(m, s.length); }, 0) + 2;
        var per = Math.max(1, Math.floor(width / w));
        var rows = Math.ceil(names.length / per), out = [];
        for (var r = 0; r < rows; r++) {
            var line = '';
            for (var c = 0; c < per; c++) {
                var i = c * rows + r;
                if (i >= names.length) { continue; }
                line += names[i] + ' '.repeat(Math.max(0, w - plain[i].length));
            }
            out.push(line.replace(/\s+$/, ''));
        }
        return out.join('\n');
    }

    /* === Commands ========================================================= */

    var COMMANDS = {};
    function command(name, def) { def.name = name; COMMANDS[name] = def; }

    function needNode(io, path, what) {
        var n = io.fs.resolve(path);
        if (!n) { io.err((what || path) + ': no such file or directory'); }
        return n;
    }

    command('help', {
        summary: 'list the commands',
        help: 'help\n\nLists every command with a one-line summary. "man <command>" says more about one.',
        run: function (args, io) {
            io.out(paint('bold', 'This is parkscomputing.com in terminal mode.') + ' The files are the site\'s pages.\n');
            Object.keys(COMMANDS).sort().forEach(function (k) {
                io.out('  ' + paint('green', k.padEnd(11)) + COMMANDS[k].summary + '\n');
            });
            io.out('\n' + wrap('Anything ls marks with * is an applet and runs by its name, or by its path. Tab completes, the arrow keys recall earlier commands, and "|" pipes one command into another.', io.cols - 1) + '\n');
        }
    });

    command('man', {
        summary: 'explain a command',
        help: 'man <command>\n\nShows the help for a command.',
        complete: 'command',
        run: function (args, io) {
            if (!args.length) { io.err('man: which command? Try "help".'); return 1; }
            var c = COMMANDS[args[0]];
            if (!c) { io.err('man: no entry for ' + args[0]); return 1; }
            io.out(paint('bold', c.name) + ' - ' + c.summary + '\n\n' + wrap(c.help, io.cols - 1) + '\n');
        }
    });

    command('ls', {
        summary: 'list a directory',
        help: 'ls [-l] [path...]\n\nLists a directory, or the current one. Directories end in /, applets in *, and links to other sites in @.\n\n  -l   one entry per line, with its date, kind and title',
        complete: 'path',
        run: function (args, io) {
            var long = false, paths = [];
            args.forEach(function (a) { if (/^-[a-z]+$/.test(a)) { if (a.indexOf('l') >= 0) { long = true; } } else { paths.push(a); } });
            if (!paths.length) { paths.push('.'); }
            var status = 0;
            paths.forEach(function (p, idx) {
                var n = needNode(io, p, 'ls: ' + p);
                if (!n) { status = 1; return; }
                var list = n.children || [n];
                if (paths.length > 1) { io.out((idx ? '\n' : '') + p + ':\n'); }
                if (long) {
                    list.forEach(function (c) {
                        var r = realOf(c);
                        var kind = c.children ? 'dir ' : r.kind === 'app' ? 'app ' : r.kind === 'link' ? 'link' : 'page';
                        io.out(paint('dim', fmtDate(r.date)) + '  ' + kind + '  ' + styledName(c) + (r.title && r.title !== c.name ? '  ' + paint('dim', r.title) : '') + '\n');
                    });
                } else if (list.length) {
                    io.out(columns(list.map(styledName), io.cols) + '\n');
                }
            });
            return status;
        }
    });

    command('cd', {
        summary: 'change directory',
        help: 'cd [path]\n\nMoves into a directory. With no path, or ~, it goes to the top of the site.',
        complete: 'dir',
        run: function (args, io) {
            var n = io.fs.resolve(args[0] || '/');
            if (!n) { io.err('cd: ' + args[0] + ': no such directory'); return 1; }
            if (!n.children) { io.err('cd: ' + args[0] + ': not a directory'); return 1; }
            io.fs.chdir(n);
        }
    });

    command('pwd', {
        summary: 'show the current directory',
        help: 'pwd\n\nPrints the path of the current directory.',
        run: function (args, io) { io.out(pathOf(io.fs.cwd()) + '\n'); }
    });

    command('tree', {
        summary: 'show a directory and everything under it',
        help: 'tree [path]\n\nDraws the directory and its contents as a tree.',
        complete: 'dir',
        run: function (args, io) {
            var n = needNode(io, args[0] || '.', 'tree: ' + (args[0] || '.'));
            if (!n) { return 1; }
            io.out(paint('blue', C.bold + (args[0] || '.')) + '\n');
            var counts = { d: 0, f: 0 };
            (function walk(node, prefix) {
                var kids = node.children || [];
                kids.forEach(function (c, i) {
                    var last = i === kids.length - 1;
                    io.out(prefix + (last ? '└── ' : '├── ') + styledName(c) + '\n');
                    if (c.children) { counts.d++; walk(c, prefix + (last ? '    ' : '│   ')); } else { counts.f++; }
                });
            })(n, '');
            io.out('\n' + counts.d + ' directories, ' + counts.f + ' files\n');
        }
    });

    function readable(io, path, cmd) {
        var n = needNode(io, path, cmd + ': ' + path);
        if (!n) { return null; }
        if (n.children) { io.err(cmd + ': ' + path + ': is a directory'); return null; }
        return realOf(n);
    }

    function textOf(io, r) {
        if (r.kind === 'link') {
            return Promise.resolve(r.title + '\n' + r.url + '\n' + (r.description ? '\n' + r.description + '\n' : ''));
        }
        return io.text(r.name);
    }

    command('cat', {
        summary: 'print a page',
        help: 'cat <file...>\n\nPrints a page as text, with each link\'s address after it in angle brackets. A link to another site prints its address.',
        complete: 'file',
        run: async function (args, io) {
            if (!args.length) { if (io.stdin != null) { io.out(io.stdin); return; } io.err('cat: which file?'); return 1; }
            var status = 0;
            for (var i = 0; i < args.length && !io.interrupted(); i++) {
                var r = readable(io, args[i], 'cat');
                if (!r) { status = 1; continue; }
                try { io.out(await textOf(io, r)); } catch (err) { io.err('cat: ' + args[i] + ': ' + err.message); status = 1; }
            }
            return status;
        }
    });

    command('less', {
        summary: 'read a page one screen at a time',
        help: 'less <file>\n\nShows a page a screen at a time. Space or Page Down moves forward, b or Page Up back, the arrow keys a line, g and G to the top and bottom, and q quits.',
        complete: 'file',
        run: async function (args, io) {
            var text;
            if (args.length) {
                var r = readable(io, args[0], 'less');
                if (!r) { return 1; }
                try { text = await textOf(io, r); } catch (err) { io.err('less: ' + err.message); return 1; }
            } else if (io.stdin != null) {
                text = io.stdin;
            } else { io.err('less: which file?'); return 1; }
            if (!io.interactive) { io.out(text); return; }
            return io.pager(text, args[0] || '(stdin)');
        }
    });

    command('open', {
        summary: 'open a page, an applet or a link',
        help: 'open <path>\n\nOpens a page the way this view opens things: as a window in the window view, or as a page in the classic view. A link to another site opens in a new tab.',
        complete: 'file',
        run: function (args, io) {
            if (!args.length) { io.err('open: which page?'); return 1; }
            var n = needNode(io, args[0], 'open: ' + args[0]);
            if (!n) { return 1; }
            if (n.children) { io.err('open: ' + args[0] + ': is a directory (try "cd")'); return 1; }
            io.open(realOf(n));
        }
    });

    command('tags', {
        summary: 'list the tags and how many articles carry each',
        help: 'tags\n\nLists every tag. Each is a directory under /tags, so "ls /tags/travel" lists the travel articles.',
        run: function (args, io) {
            var t = io.fs.resolve('/tags');
            (t ? t.children : []).forEach(function (d) {
                io.out(String(d.children.length).padStart(3) + '  ' + paint('blue', d.name) + (d.title !== d.name ? paint('dim', '  (' + d.title + ')') : '') + '\n');
            });
        }
    });

    command('grep', {
        summary: 'search text for a pattern',
        help: 'grep [-i] [-l] [-r] <pattern> [path...]\n\nPrints the lines matching a pattern (a regular expression). With no path it searches what is piped into it. With -r it searches every page under a directory, or under the current one.\n\n  -i   ignore case\n  -l   print only the names of pages that match\n  -r   search directories',
        complete: 'path',
        run: async function (args, io) {
            var flags = '', rest = [];
            args.forEach(function (a) { if (/^-[ilr]+$/.test(a) && !rest.length) { flags += a.slice(1); } else { rest.push(a); } });
            if (!rest.length) { io.err('grep: which pattern?'); return 1; }
            var re;
            try { re = new RegExp(rest[0], flags.indexOf('i') >= 0 ? 'i' : ''); } catch (err) { io.err('grep: bad pattern: ' + err.message); return 2; }
            var paths = rest.slice(1), found = false;
            function scan(text, label) {
                var hits = 0;
                text.split('\n').forEach(function (line) {
                    if (!re.test(line)) { return; }
                    hits++; found = true;
                    if (flags.indexOf('l') < 0) {
                        var shown = line.replace(new RegExp(re.source, re.flags + 'g'), function (m) { return paint('red', C.bold + m); });
                        io.out((label ? paint('cyan', label) + ':' : '') + shown + '\n');
                    }
                });
                if (hits && flags.indexOf('l') >= 0 && label) { io.out(label + '\n'); }
            }
            if (!paths.length && io.stdin != null) { scan(io.stdin, ''); return found ? 0 : 1; }
            if (!paths.length) {
                if (flags.indexOf('r') < 0) { io.err('grep: which file? (or -r to search this directory)'); return 2; }
                paths = ['.'];
            }
            var files = [];
            paths.forEach(function (p) {
                var n = needNode(io, p, 'grep: ' + p);
                if (!n) { return; }
                if (n.children) {
                    if (flags.indexOf('r') < 0) { io.err('grep: ' + p + ': is a directory'); return; }
                    (function walk(d) { d.children.forEach(function (c) { if (c.children) { if (!c.virtual) { walk(c); } } else { files.push(c); } }); })(n);
                } else { files.push(n); }
            });
            var seen = {};
            if (files.length > 1) {
                try { await io.prefetch(files.map(function (f) { return realOf(f); }).filter(function (r) { return r.kind !== 'link'; }).map(function (r) { return r.name; })); }
                catch (err) { io.err('grep: ' + err.message); return 2; }
            }
            for (var i = 0; i < files.length && !io.interrupted(); i++) {
                var r = realOf(files[i]);
                if (seen[r.name]) { continue; }
                seen[r.name] = true;
                try { scan(await textOf(io, r), files.length > 1 || flags.indexOf('r') >= 0 ? pathOf(r) : ''); } catch (err) { }
            }
            return found ? 0 : 1;
        }
    });

    command('find', {
        summary: 'find pages by name',
        help: 'find [path] [-name <pattern>]\n\nLists every path under a directory, or only those whose name matches a pattern such as "*barcode*".',
        complete: 'path',
        run: function (args, io) {
            var start = '.', pattern = null;
            for (var i = 0; i < args.length; i++) {
                if (args[i] === '-name' || args[i] === '-iname') { pattern = args[++i]; } else { start = args[i]; }
            }
            var n = needNode(io, start, 'find: ' + start);
            if (!n) { return 1; }
            var re = pattern ? globToRegex(pattern) : null;
            (function walk(node) {
                if (!re || re.test(node.name)) { io.out(pathOf(node) + (node.children && node.parent ? '/' : '') + '\n'); }
                (node.children || []).forEach(function (c) { if (!(c.virtual && node !== n && !node.virtual)) { walk(c); } });
            })(n);
        }
    });

    command('echo', {
        summary: 'print its arguments',
        help: 'echo [text...]\n\nPrints its arguments, which is mostly useful in front of a pipe.',
        run: function (args, io) { io.out(args.join(' ') + '\n'); }
    });

    command('clear', {
        summary: 'clear the screen',
        help: 'clear\n\nClears the screen. Ctrl+L does the same.',
        run: function (args, io) { io.clear(); }
    });

    command('history', {
        summary: 'list earlier commands',
        help: 'history [-c]\n\nLists the commands typed in this browser. -c clears the list.',
        run: function (args, io) {
            if (args[0] === '-c') { io.history.clear(); return; }
            io.history.list().forEach(function (h, i) { io.out(String(i + 1).padStart(4) + '  ' + h + '\n'); });
        }
    });

    /* Each applet runs by the name it has in /applets, where ls marks it
       with *. A few also take arguments or have a shorter alias. */
    function appletCommand(slug, summary, help) {
        command(slug, {
            summary: summary, help: help,
            run: function (args, io) {
                var n = io.fs.resolve('/applets/' + slug) || { name: slug, kind: 'app', title: slug };
                io.open(realOf(n));
            }
        });
    }
    function alias(name, target) {
        var t = COMMANDS[target];
        command(name, {
            summary: 'the same as ' + target, help: name + ' is another name for ' + target + '.\n\n' + t.help,
            complete: t.complete, run: t.run
        });
    }
    appletCommand('sudoku', 'play Sudoku', 'sudoku\n\nOpens the Sudoku game.');
    appletCommand('flashcards', 'drill barcode symbologies', 'flashcards\n\nOpens the barcode flash cards.');

    command('conway', {
        summary: 'run Conway\'s Game of Life',
        help: 'conway [pattern]\n\nOpens Conway\'s Game of Life, with one of the article\'s patterns if you name it:\n\n  glider   a pair of gliders that follow each other\n  gun      a Gosper glider gun\n  face     cells that settle into a funny face\n  long     a large board with a long-running pattern',
        complete: function () { return Object.keys(LIFE_PRESETS); },
        run: function (args, io) {
            if (args[0] && !LIFE_PRESETS[args[0]]) { io.err('conway: no pattern called ' + args[0] + '. Try: ' + Object.keys(LIFE_PRESETS).join(', ')); return 1; }
            io.open({ name: 'conway', kind: 'app', title: 'Conway\'s Game of Life' }, args[0] ? LIFE_PRESETS[args[0]] : null);
        }
    });
    alias('life', 'conway');

    command('barcodes', {
        summary: 'make a barcode in the barcode tool',
        help: 'barcodes [symbology] [data]\n\nOpens the barcode tool, set to a symbology and data if you give them.\n\nSymbologies: ' + BARCODE_SYMS.join(', ') + '\n\nExample: barcodes ean13 480036140036',
        complete: function (words) { return words.length <= 2 ? BARCODE_SYMS : []; },
        run: function (args, io) {
            var state = null;
            if (args.length) {
                var sym = args[0].toLowerCase();
                if (BARCODE_SYMS.indexOf(sym) < 0) { io.err('barcodes: unknown symbology ' + args[0] + '. Try: ' + BARCODE_SYMS.join(', ')); return 1; }
                var q = new URLSearchParams();
                q.set('s', sym);
                if (args.length > 1) { q.set('d', args.slice(1).join(' ')); }
                state = q.toString();
            }
            io.open({ name: 'barcodes', kind: 'app', title: 'Barcode Tool' }, state);
        }
    });
    alias('barcode', 'barcodes');

    command('terminal', {
        summary: 'this terminal',
        help: 'terminal\n\nThe terminal you are using. Running it again leaves you where you are.',
        run: function (args, io) { io.out('You\'re already in the terminal.\n'); }
    });

    /* A word that names no command may name an applet: a path to one, one
       in the current directory, or one in /applets, which is the terminal's
       PATH. It opens, like any page. */
    function programAt(fs, cwd, word) {
        var n = word.indexOf('/') >= 0 ? resolve(fs, cwd, word)
            : ((cwd.children || []).filter(function (c) { return c.name === word; })[0] || resolve(fs, fs, '/applets/' + word));
        if (!n || n.children || realOf(n).kind !== 'app') { return null; }
        var r = realOf(n);
        return COMMANDS[r.name] || { name: word, run: function (args, io) { io.open(r); } };
    }

    /* === The applet ======================================================= */

    function themeColors(host) {
        var probe = document.createElement('span');
        probe.style.display = 'none';
        host.appendChild(probe);
        function tok(name, fallback) {
            probe.style.color = '';
            probe.style.color = 'var(' + name + ', ' + fallback + ')';
            return getComputedStyle(probe).color || fallback;
        }
        function alpha(rgb, a) {
            var m = /rgba?\(([^)]+)\)/.exec(rgb);
            if (!m) { return rgb; }
            var p = m[1].split(',').map(function (s) { return s.trim(); });
            return 'rgba(' + p[0] + ', ' + p[1] + ', ' + p[2] + ', ' + a + ')';
        }
        var t = {
            background: tok('--input-bg', '#ffffff'),
            foreground: tok('--text', '#111111'),
            cursor: tok('--accent', '#2f6fb3'),
            cursorAccent: tok('--input-bg', '#ffffff'),
            black: tok('--text', '#111111'),
            red: tok('--danger', '#b91c1c'),
            green: tok('--positive', '#1f7a3a'),
            yellow: tok('--warn', '#a16207'),
            blue: tok('--accent', '#2f6fb3'),
            magenta: '#8b5cf6',
            cyan: '#0e7490',
            white: tok('--text-muted', '#6b7280'),
            brightBlack: tok('--text-muted', '#6b7280')
        };
        t.selectionBackground = alpha(t.cursor, 0.3);
        if (document.documentElement.getAttribute('data-theme') === 'dark') { t.cyan = '#22d3ee'; t.magenta = '#c4b5fd'; }
        probe.remove();
        return t;
    }

    function init(root, opts) {
        opts = opts || {};
        root.classList.add('pc-terminal');
        if (opts.fit === 'fill') { root.classList.add('pc-terminal-fill'); }
        root.innerHTML = '<div class="pc-terminal-screen" data-role="screen"></div>';
        var screen = root.querySelector('[data-role="screen"]');

        var destroyed = false;
        var term = null, fit = null, fs = null, cwd = null, ro = null;
        var initialCwd = cwdFrom(opts.state) || (opts.ownsUrl ? cwdFrom(location.search) : null) || '/';
        var prefill = opts.ownsUrl ? (new URLSearchParams(location.search).get('run') || '') : '';

        function cwdFrom(s) {
            if (!s) { return null; }
            var v = new URLSearchParams(String(s).replace(/^\?/, '')).get('cwd');
            return v && v[0] === '/' ? v : null;
        }
        function stateString() { return 'cwd=' + encodeURIComponent(cwd ? pathOf(cwd) : '/').replace(/%2F/g, '/'); }
        function announce() {
            var s = stateString();
            if (opts.ownsUrl) {
                var q = new URLSearchParams(location.search);
                q.set('cwd', cwd ? pathOf(cwd) : '/');
                q.delete('run');
                history.replaceState(history.state, '', location.pathname + '?' + q.toString().replace(/%2F/g, '/') + location.hash);
            }
            if (opts.changed) { opts.changed(s); }
        }

        /* History, kept per browser. */
        var hist = [];
        try { hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); if (!Array.isArray(hist)) { hist = []; } } catch (err) { hist = []; }
        function saveHistory() { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(-HISTORY_MAX))); } catch (err) { } }

        /* === Line editing ============================================= */

        var line = '', cursor = 0, histPos = -1, draft = '', busy = false, keyWaiter = null, lastTab = 0;

        function write(s) { if (term) { term.write(String(s).replace(/\r?\n/g, '\r\n')); } }
        function prompt() {
            return paint('green', 'guest@parkscomputing') + ':' + paint('blue', C.bold + pathOf(cwd)) + '$ ';
        }
        function redraw() {
            term.write('\r\x1b[K' + prompt() + line);
            var back = line.length - cursor;
            if (back > 0) { term.write('\x1b[' + back + 'D'); }
        }
        function newPrompt() { line = ''; cursor = 0; histPos = -1; term.write(prompt()); }

        function completions(words, partial) {
            var first = words.length === 0;
            if (first) {
                return Object.keys(COMMANDS).filter(function (k) { return k.indexOf(partial) === 0; }).map(function (k) { return { word: k, done: true }; });
            }
            var c = COMMANDS[words[0]];
            var mode = c && c.complete;
            if (typeof mode === 'function') {
                return mode(words.concat([partial])).filter(function (k) { return k.indexOf(partial) === 0; }).map(function (k) { return { word: k, done: true }; });
            }
            if (mode === 'command') {
                return Object.keys(COMMANDS).filter(function (k) { return k.indexOf(partial) === 0; }).map(function (k) { return { word: k, done: true }; });
            }
            if (!mode) { return []; }
            var slash = partial.lastIndexOf('/');
            var dirPart = slash >= 0 ? partial.slice(0, slash + 1) : '';
            var base = slash >= 0 ? partial.slice(slash + 1) : partial;
            var dir = resolve(fs, cwd, dirPart || '.');
            if (!dir || !dir.children) { return []; }
            return dir.children
                .filter(function (n) { return n.name.indexOf(base) === 0 && (mode !== 'dir' || n.children); })
                .map(function (n) { return { word: dirPart + n.name + (n.children ? '/' : ''), done: !n.children }; });
        }

        function complete() {
            var before = line.slice(0, cursor);
            var m = /(\S*)$/.exec(before);
            var partial = m[1];
            var head = before.slice(0, before.length - partial.length);
            var parsed = parse(head);
            var words = parsed.stages ? parsed.stages[parsed.stages.length - 1] : [];
            var list = completions(words, partial);
            if (!list.length) { return; }
            if (list.length === 1) {
                var w = list[0].word + (list[0].done ? ' ' : '');
                line = head + w + line.slice(cursor);
                cursor = head.length + w.length;
                redraw();
                return;
            }
            var common = list.reduce(function (acc, x) {
                var i = 0; while (i < acc.length && i < x.word.length && acc[i] === x.word[i]) { i++; }
                return acc.slice(0, i);
            }, list[0].word);
            if (common.length > partial.length) {
                line = head + common + line.slice(cursor);
                cursor = head.length + common.length;
                redraw();
                return;
            }
            var now = Date.now();
            if (now - lastTab < 800) {
                write('\n' + columns(list.map(function (x) { return x.word.replace(/.*\/(?=.)/, ''); }), term.cols) + '\n');
                redraw();
            }
            lastTab = now;
        }

        /* While a command runs, Ctrl+C interrupts it and anything else is
           typed ahead, to be replayed at the next prompt. */
        var typeahead = [], interrupted = false;
        function onData(data) {
            if (keyWaiter) { var k = keyWaiter; keyWaiter = null; k(data); return; }
            if (busy) {
                if (data === '\x03') { interrupted = true; typeahead = []; write('^C'); }
                else { typeahead.push(data); }
                return;
            }
            /* Pasted text arrives in one piece; only its first line runs. */
            if (data.length > 1 && data[0] !== '\x1b') {
                var text = data.replace(/\r\n?/g, '\n');
                var nl = text.indexOf('\n');
                insert(nl >= 0 ? text.slice(0, nl) : text);
                if (nl >= 0) { submit(); }
                return;
            }
            switch (data) {
                case '\r': submit(); return;
                case '\x7f': case '\b':
                    if (cursor > 0) { line = line.slice(0, cursor - 1) + line.slice(cursor); cursor--; redraw(); }
                    return;
                case '\x1b[3~':
                    if (cursor < line.length) { line = line.slice(0, cursor) + line.slice(cursor + 1); redraw(); }
                    return;
                case '\x1b[D': if (cursor > 0) { cursor--; term.write(data); } return;
                case '\x1b[C': if (cursor < line.length) { cursor++; term.write(data); } return;
                case '\x1b[H': case '\x01': case '\x1bOH': cursor = 0; redraw(); return;
                case '\x1b[F': case '\x05': case '\x1bOF': cursor = line.length; redraw(); return;
                case '\x1b[A': historyStep(-1); return;
                case '\x1b[B': historyStep(1); return;
                case '\t': complete(); return;
                case '\x03': write('^C\n'); newPrompt(); return;
                case '\x0c': term.clear(); redraw(); return;
                case '\x15': line = line.slice(cursor); cursor = 0; redraw(); return;
                case '\x0b': line = line.slice(0, cursor); redraw(); return;
            }
            if (data >= ' ' && data.indexOf('\x1b') < 0) { insert(data); }
        }
        function insert(s) {
            s = s.replace(/[\x00-\x1f]/g, '');
            line = line.slice(0, cursor) + s + line.slice(cursor);
            cursor += s.length;
            redraw();
        }
        function historyStep(d) {
            if (!hist.length) { return; }
            if (histPos === -1) { if (d > 0) { return; } draft = line; histPos = hist.length; }
            histPos += d;
            if (histPos < 0) { histPos = 0; }
            if (histPos >= hist.length) { histPos = -1; line = draft; } else { line = hist[histPos]; }
            cursor = line.length;
            redraw();
        }

        async function submit() {
            var text = line.trim();
            write('\n');
            if (text) {
                if (hist[hist.length - 1] !== text) { hist.push(text); saveHistory(); }
                busy = true;
                interrupted = false;
                try { await execute(text); } catch (err) { if (!interrupted) { write(paint('red', 'error: ' + err.message) + '\n'); } }
                busy = false;
                if (destroyed) { return; }
                if (interrupted) { write('\n'); }
            }
            newPrompt();
            var pending = typeahead;
            typeahead = [];
            pending.forEach(onData);
        }

        /* === Running a line ============================================ */

        function makeIo(stdin, sink) {
            var interactive = !sink;
            return {
                cols: term.cols, rows: term.rows, interactive: interactive,
                stdin: stdin,
                /* A long command checks this between steps and stops. */
                interrupted: function () { return interrupted; },
                out: function (s) { if (interrupted) { return; } if (sink) { sink.push(strip(s)); } else { write(s); } },
                err: function (s) { write(paint('red', String(s).replace(/\n$/, '')) + '\n'); },
                fs: {
                    resolve: function (p) { return resolve(fs, cwd, p); },
                    cwd: function () { return cwd; },
                    chdir: function (n) { cwd = n; announce(); }
                },
                text: fetchText,
                prefetch: prefetchTexts,
                open: openEntry,
                clear: function () { term.clear(); },
                history: {
                    list: function () { return hist.slice(); },
                    clear: function () { hist = []; saveHistory(); }
                },
                pager: pager
            };
        }

        async function execute(text) {
            var parsed = parse(text);
            if (parsed.error) { write(paint('red', parsed.error) + '\n'); return; }
            var stages = parsed.stages.filter(function (s) { return s.length; });
            if (!stages.length) { return; }
            var stdin = null;
            for (var i = 0; i < stages.length && !interrupted; i++) {
                var words = stages[i], c = COMMANDS[words[0]] || programAt(fs, cwd, words[0]);
                if (!c) { write(paint('red', words[0] + ': command not found. Type "help" for the list.') + '\n'); return; }
                var last = i === stages.length - 1;
                var sink = last ? null : [];
                await c.run(words.slice(1), makeIo(stdin, sink));
                if (sink) { stdin = sink.join(''); }
            }
        }

        /* Opens a page, an applet or a link the way the current view opens
           things. An applet may be handed a starting state. */
        function openEntry(n, state) {
            if (n.kind === 'link') { window.open(n.url, '_blank', 'noopener'); return; }
            var inWindows = opts.host === 'window' && window.pudlWindows;
            if (inWindows) {
                if (state != null) {
                    window.pcAppletHandoff = window.pcAppletHandoff || {};
                    window.pcAppletHandoff[n.name] = state;
                    if ((window.pudlWindows.state().open || []).indexOf(n.name) >= 0) { window.pudlWindows.close(n.name); }
                }
                window.pudlWindows.open(n.name);
                return;
            }
            location.assign('/page/' + encodeURIComponent(n.name) + (state ? '?' + state : ''));
        }

        /* A full-screen pager on the alternate screen. */
        function pager(text, label) {
            return new Promise(function (resolveDone) {
                var lines = [];
                String(text).replace(/\n$/, '').split('\n').forEach(function (l) {
                    var plain = strip(l);
                    if (plain.length <= term.cols) { lines.push(l); return; }
                    for (var i = 0; i < plain.length; i += term.cols) { lines.push(plain.slice(i, i + term.cols)); }
                });
                var top = 0;
                function page() { return Math.max(1, term.rows - 1); }
                function draw() {
                    var out = '\x1b[H\x1b[2J';
                    for (var i = 0; i < page(); i++) { out += (lines[top + i] != null ? lines[top + i] : paint('dim', '~')) + '\r\n'; }
                    var end = Math.min(lines.length, top + page());
                    out += '\x1b[7m ' + label + '  ' + (lines.length ? Math.round(end * 100 / lines.length) : 100) + '%  (space: next, b: back, q: quit) \x1b[0m';
                    term.write(out);
                }
                function key(k) {
                    var max = Math.max(0, lines.length - page());
                    if (k === 'q' || k === 'Q' || k === '\x1b' || k === '\x03') { term.write('\x1b[?1049l'); resolveDone(0); return; }
                    if (k === ' ' || k === 'f' || k === '\x1b[6~') { top = Math.min(max, top + page()); }
                    else if (k === 'b' || k === '\x1b[5~') { top = Math.max(0, top - page()); }
                    else if (k === '\x1b[B' || k === 'j' || k === '\r') { top = Math.min(max, top + 1); }
                    else if (k === '\x1b[A' || k === 'k') { top = Math.max(0, top - 1); }
                    else if (k === 'g' || k === '\x1b[H') { top = 0; }
                    else if (k === 'G' || k === '\x1b[F') { top = max; }
                    draw();
                    keyWaiter = key;
                }
                term.write('\x1b[?1049h');
                draw();
                keyWaiter = key;
            });
        }

        /* === Start ===================================================== */

        function applyTheme() { if (term) { term.options.theme = themeColors(root); } }
        document.addEventListener('pudl:theme-change', applyTheme);

        var boot = Promise.all([loadXterm(), loadTree()]).then(function (results) {
            if (destroyed) { return; }
            fs = results[1];
            cwd = resolve(fs, fs, initialCwd);
            if (!cwd || !cwd.children) { cwd = fs; }
            term = new window.Terminal({
                cursorBlink: true,
                fontFamily: getComputedStyle(root).getPropertyValue('--mono').trim() || 'ui-monospace, "Cascadia Mono", Consolas, monospace',
                fontSize: 14,
                scrollback: 2000,
                theme: themeColors(root),
                allowProposedApi: false
            });
            fit = new window.FitAddon.FitAddon();
            term.loadAddon(fit);
            term.open(screen);
            try { fit.fit(); } catch (err) { }
            term.onData(onData);
            if (window.ResizeObserver) {
                ro = new ResizeObserver(function () { try { fit.fit(); } catch (err) { } });
                ro.observe(screen);
            }
            write(paint('bold', 'parkscomputing.com') + ' in terminal mode. Type ' + paint('green', 'help') + ' for the commands.\n\n');
            term.write(prompt());
            if (prefill) { insert(prefill); }
            announce();
            if (opts.ownsUrl || root.closest('.win.active')) { term.focus(); }
        }).catch(function (err) {
            if (destroyed) { return; }
            screen.textContent = 'The terminal could not start: ' + err.message + '.';
            screen.classList.add('pc-terminal-failed');
        });

        return {
            state: stateString,
            setState: function (s) {
                var p = cwdFrom(s);
                if (!fs || !p) { return; }
                var n = resolve(fs, fs, p);
                if (n && n.children) { cwd = n; if (!busy && term) { redraw(); } }
            },
            destroy: function () {
                destroyed = true;
                document.removeEventListener('pudl:theme-change', applyTheme);
                if (ro) { ro.disconnect(); }
                if (term) { term.dispose(); }
            },
            ready: boot
        };
    }

    window.pudlApplets.register('terminal', { init: init });
})();
