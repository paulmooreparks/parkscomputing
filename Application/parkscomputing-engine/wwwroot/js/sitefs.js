/* The site filesystem: the sandbox the terminal, the file manager and the
   editor share (Architecture/files-editor-design.md). It is the site's
   public structure, as /api/site/tree serves it from sitenav, plus the
   reader's own home directory, /home/guest or ~, kept in this browser's
   localStorage. Nothing here can reach a file on the server; the site is
   read-only and only ~ can change.

   Loaded once per page, from the address js/applets.js names in
   window.pcSiteFsSrc, so every applet shares one copy and one version.
   Every change to ~ (or to the barcode tool's layouts, which appear as
   ~/barcode-layouts.json) fires pc:fs-change on the document, whether it
   was made here or in another tab. A reload from storage replaces the
   nodes under ~, so an applet keeps paths, not nodes, across changes. */
(function () {
    'use strict';
    if (window.pcSiteFs) { return; }

    var SELF_SRC = document.currentScript && document.currentScript.src;
    function beside(file) { return SELF_SRC ? SELF_SRC.replace(/sitefs\.js/, file) : '/js/' + file; }
    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('could not load ' + src)); };
            document.head.appendChild(s);
        });
    }
    /* The barcode engine, only to check the layout library before saving. */
    var engineReady = null;
    function loadBarcodeEngine() {
        if (window.pcBarcode) { return Promise.resolve(window.pcBarcode); }
        if (!engineReady) {
            engineReady = loadScript(beside('barcode-engine.js'))
                .then(function () { return window.pcBarcode; })
                .catch(function (err) { engineReady = null; throw err; });
        }
        return engineReady;
    }

    var HOME_KEY = 'pc-terminal-home';
    var LAYOUTS_KEY = 'pc-barcode-layouts';
    var FILE_MAX = 256 * 1024;
    var HOME_MAX = 2 * 1024 * 1024;

    function emit(reason) {
        document.dispatchEvent(new CustomEvent('pc:fs-change', { detail: { reason: reason } }));
    }

    /* === The site tree =================================================== */

    var root = null;
    var treeReady = null;
    function load() {
        if (!treeReady) {
            treeReady = fetch('/api/site/tree', { headers: { Accept: 'application/json' } })
                .then(function (r) { if (!r.ok) { throw new Error('HTTP ' + r.status); } return r.json(); })
                .then(function (data) { root = buildFs(data); return root; })
                .catch(function (err) { treeReady = null; throw err; });
        }
        return treeReady;
    }

    function tagSlug(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

    /* Wraps the server's tree in nodes that know their parent and path, and
       adds the virtual tags directory and the home directory. */
    function buildFs(data) {
        function wrap(e, parent) {
            var n = {
                name: e.name, kind: e.kind, title: e.title || e.name, description: e.description || '',
                tags: e.tags || [], date: e.date ? new Date(e.date) : null, url: e.url || null, parent: parent
            };
            if (e.source != null) { n.source = e.source; }
            if (e.children) {
                n.children = [];
                e.children.forEach(function (c) { n.children.push(wrap(c, n)); });
            }
            return n;
        }
        var top = wrap(data, null);
        var byTag = {};
        (function walk(n) {
            (n.children || []).forEach(function (c) {
                if (c.children) { walk(c); return; }
                c.tags.forEach(function (t) {
                    var k = tagSlug(t);
                    (byTag[k] = byTag[k] || { tag: t, items: {} }).items[c.name] = c;
                });
            });
        })(top);
        var tags = { name: 'tags', kind: 'dir', title: 'Tags', description: 'Articles by tag', parent: top, children: [], virtual: true };
        Object.keys(byTag).sort().forEach(function (k) {
            var d = { name: k, kind: 'dir', title: byTag[k].tag, description: 'Tagged ' + byTag[k].tag, parent: tags, children: [], virtual: true };
            Object.keys(byTag[k].items).forEach(function (name) {
                var target = byTag[k].items[name];
                d.children.push(Object.assign({}, target, { parent: d, target: target }));
            });
            d.children.sort(function (a, b) { return (b.date || 0) - (a.date || 0); });
            tags.children.push(d);
        });
        top.children.push(tags);
        mountHome(top);
        return top;
    }

    function pathOf(n) {
        var parts = [];
        for (var x = n; x && x.parent; x = x.parent) { parts.unshift(x.name); }
        return '/' + parts.join('/');
    }

    /* The path as the reader sees it: the home directory reads as ~. */
    function displayPath(n) {
        var p = pathOf(n);
        if (!home.dir) { return p; }
        var h = pathOf(home.dir);
        return p === h ? '~' : p.indexOf(h + '/') === 0 ? '~' + p.slice(h.length) : p;
    }

    /* Resolves a path against a directory (the top of the site when none is
       given); null when it names nothing. */
    function resolve(base, path) {
        path = path == null ? '' : String(path);
        var node = path[0] === '/' || !base ? root : base;
        if ((path === '~' || path.indexOf('~/') === 0) && home.dir) { node = home.dir; path = path.slice(1); }
        if (!node) { return null; }
        var parts = path.split('/').filter(Boolean);
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i];
            if (p === '.') { continue; }
            if (p === '..') { node = node.parent || node; continue; }
            if (!node.children) { return null; }
            var next = childNamed(node, p);
            if (!next) { return null; }
            node = next;
        }
        return node;
    }

    function childNamed(d, name) {
        var kids = d.children || [];
        for (var j = 0; j < kids.length; j++) { if (kids[j].name === name) { return kids[j]; } }
        return null;
    }

    /* Splits a path into the directory part and the last name. */
    function splitPath(path) {
        var p = String(path).replace(/\/+$/, '');
        var i = p.lastIndexOf('/');
        return i < 0 ? { dir: '.', base: p } : { dir: p.slice(0, i) || '/', base: p.slice(i + 1) };
    }

    function realOf(n) { return n.target || n; }

    /* === The home directory ===============================================
       /home/guest, shown as ~, lives in localStorage under pc-terminal-home
       as { seeded, files: { "/path": { t: "f"|"d", c, m } } }. The first
       visit seeds a few files so there is something to try. The barcode
       tool's layout library appears as ~/barcode-layouts.json, read from
       and written to the tool's own storage. */

    var home = { dir: null, raw: undefined };

    var SEED = {
        '/README': [
            'Welcome to your home directory.',
            '',
            'Everything under ~ is yours. It lives in this',
            'browser\'s storage and nowhere else, and "Forget',
            'this browser\'s data" in the site\'s settings',
            'erases it. The rest of the site is read-only.',
            '',
            'Some things to try:',
            '',
            '  edit glider.cells',
            '  conway glider.cells',
            '  sudoku puzzle.sudoku',
            '  edit barcode-layouts.json',
            '  cp /articles/coincidences ~/',
            '  ls /articles > articles.txt',
            '  download glider.cells',
            '  upload',
            '  hello                  (a script in ~/bin)',
            '',
            '"man edit" lists the editor\'s keys, and "help"',
            'lists every command.',
            ''
        ].join('\n'),
        '/bin/hello': [
            '# hello: greet someone, a first script to copy',
            '#',
            '# Usage: hello [name]',
            '#',
            '# A script is a file of terminal commands, one a line. Scripts in',
            '# ~/bin run by name, like the site\'s own in /bin. $1 is the first',
            '# argument, and ${1:-world} gives it a default. Change this one',
            '# with "edit ~/bin/hello", or copy it to start another:',
            '# cp ~/bin/hello ~/bin/mine',
            'echo Hello, ${1:-world}!',
            'echo Your home directory holds:',
            'ls ~',
            ''
        ].join('\n'),
        '/glider.cells': '!Name: Glider\n!A small pattern that travels across the board. O is a live cell, . is a dead one.\n.O.\n..O\nOOO\n',
        '/puzzle.sudoku': '# A Sudoku puzzle: digits are clues, dots are empty cells.\n53..7....\n6..195...\n.98....6.\n8...6...3\n4..8.3..1\n7...2...6\n.6....28.\n...419..5\n....8..79\n'
    };

    /* The seed version that introduced each file; files not named here
       came with version 1. */
    var SEED_VERSION = 2;
    var SEED_SINCE = { '/bin/hello': 2 };

    function mountHome(top) {
        var homes = { name: 'home', kind: 'dir', title: 'Home directories', description: '', parent: top, children: [] };
        var guest = { name: 'guest', kind: 'dir', title: 'Your home directory', description: 'Your own files, kept in this browser', parent: homes, children: [], home: true, mtime: null };
        homes.children.push(guest);
        top.children.push(homes);
        home.dir = guest;
        homeLoad();
    }

    function sortKids(d) { d.children.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }); }

    function mkDirNode(parent, name, m) {
        var n = { name: name, kind: 'dir', home: true, children: [], mtime: new Date(m || Date.now()), parent: parent };
        parent.children.push(n);
        sortKids(parent);
        return n;
    }

    function homeInsert(p, e) {
        var parts = p.split('/').filter(Boolean), d = home.dir;
        if (!parts.length) { return; }
        for (var i = 0; i < parts.length - 1; i++) { d = childNamed(d, parts[i]) || mkDirNode(d, parts[i], e.m); }
        var name = parts[parts.length - 1];
        if (childNamed(d, name)) { return; }
        if (e.t === 'd') { mkDirNode(d, name, e.m); return; }
        d.children.push({ name: name, kind: 'file', home: true, content: String(e.c || ''), mtime: new Date(e.m || Date.now()), parent: d });
    }

    function homeLoad() {
        var raw = null;
        try { raw = localStorage.getItem(HOME_KEY); } catch (err) { }
        home.raw = raw;
        var data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (err) { data = null; }
        if (!data || !data.files || typeof data.files !== 'object') { data = { files: {} }; }
        /* Seeding is versioned: a home directory gets each seed file once,
           in the version that introduced it, so a reader who deletes one
           keeps it deleted, and a later seed still reaches an older home. */
        var had = data.seeded === true ? 1 : (+data.seeded || 0);
        var seedNow = had < SEED_VERSION;
        if (seedNow) {
            Object.keys(SEED).forEach(function (p) {
                if ((SEED_SINCE[p] || 1) <= had || data.files[p]) { return; }
                var dir = p.slice(0, p.lastIndexOf('/'));
                if (dir && !data.files[dir]) { data.files[dir] = { t: 'd', m: Date.now() }; }
                data.files[p] = { t: 'f', c: SEED[p], m: Date.now() };
            });
        }
        home.dir.children = [];
        Object.keys(data.files).sort().forEach(function (p) { homeInsert(p, data.files[p]); });
        home.dir.children.push({ name: 'barcode-layouts.json', kind: 'file', home: true, special: 'layouts', parent: home.dir, mtime: null });
        sortKids(home.dir);
        home.generation = (home.generation || 0) + 1;
        if (seedNow) { homeSave(); }
    }

    function homeSerialize() {
        var files = {};
        (function walk(d, prefix) {
            d.children.forEach(function (c) {
                if (c.special) { return; }
                var p = prefix + '/' + c.name;
                if (c.children) { files[p] = { t: 'd', m: +c.mtime }; walk(c, p); }
                else { files[p] = { t: 'f', c: c.content, m: +c.mtime }; }
            });
        })(home.dir, '');
        return JSON.stringify({ seeded: SEED_VERSION, files: files });
    }

    /* Saves the home directory; on failure the stored copy is reloaded so
       what every applet shows matches what the browser kept. */
    function homeSave() {
        var s = homeSerialize();
        if (s.length > HOME_MAX) { homeLoad(); emit('home'); return 'your home directory is full (the limit is 2 MB)'; }
        try { localStorage.setItem(HOME_KEY, s); home.raw = s; emit('home'); return null; }
        catch (err) { homeLoad(); emit('home'); return 'this browser would not store it (' + err.name + ')'; }
    }

    /* Another tab may have changed the files since this one last looked. */
    function homeSync() {
        if (!home.dir) { return false; }
        var raw = null;
        try { raw = localStorage.getItem(HOME_KEY); } catch (err) { }
        if (raw === home.raw) { return false; }
        homeLoad();
        emit('home');
        return true;
    }

    /* A change in another tab reaches this one through the storage event. */
    window.addEventListener('storage', function (e) {
        if (e.key === HOME_KEY || e.key === null) { homeSync(); }
        else if (e.key === LAYOUTS_KEY) { emit('layouts'); }
    });

    function attached(n) {
        for (var x = n; x && x.parent; x = x.parent) { if (x.parent.children.indexOf(x) < 0) { return false; } }
        return true;
    }

    function validName(n) { return !!n && n !== '.' && n !== '..' && n !== '~' && n.length <= 100 && !/[\/\x00-\x1f]/.test(n); }

    function layoutsText() {
        var raw = null, obj = null;
        try { raw = localStorage.getItem(LAYOUTS_KEY); } catch (err) { }
        try { obj = raw ? JSON.parse(raw) : null; } catch (err) { obj = null; }
        if (!obj || !Array.isArray(obj.layouts)) { obj = { format: 'pc-barcode-layouts', version: 1, layouts: [] }; }
        return JSON.stringify(obj, null, 2) + '\n';
    }

    /* Checks the layout library as the barcode tool would; null when it is
       fine, otherwise a message naming the first few problems. */
    async function checkLayouts(text) {
        var obj;
        try { obj = JSON.parse(text); } catch (err) { return { error: 'not valid JSON: ' + err.message }; }
        var B;
        try { B = await loadBarcodeEngine(); } catch (err) { return { error: 'the barcode engine could not load to check the file' }; }
        var v = B.layouts.validateFile(obj);
        if (!v.ok) { return { error: v.errors.slice(0, 3).join('; ') + (v.errors.length > 3 ? ' (and ' + (v.errors.length - 3) + ' more)' : ''), errors: v.errors }; }
        return { obj: obj };
    }

    async function writeLayouts(text) {
        var c = await checkLayouts(text);
        if (c.error) { return c.error; }
        try { localStorage.setItem(LAYOUTS_KEY, JSON.stringify({ format: 'pc-barcode-layouts', version: 1, layouts: c.obj.layouts })); }
        catch (err) { return 'this browser would not store the layouts (' + err.name + ')'; }
        emit('layouts');
        return null;
    }

    function readHome(n) { return n.special === 'layouts' ? layoutsText() : n.content; }

    /* Writes a file in the home directory, creating it if need be. Resolves
       to { error } or { node }. */
    async function write(base, path, content, append) {
        var n = resolve(base, path);
        if (n) { n = realOf(n); }
        if (n && n.children) { return { error: path + ': is a directory' }; }
        if (n && !n.home) { return { error: path + ' is part of the site, which is read-only' }; }
        var full = append && n ? readHome(n) + content : content;
        if (full.length > FILE_MAX) { return { error: path + ': too large (the limit is 256 KB)' }; }
        if (n && n.special) { var e = await writeLayouts(full); return e ? { error: path + ': ' + e } : { node: n }; }
        if (n) {
            n.content = full;
            n.mtime = new Date();
        } else {
            var sp = splitPath(path), d = resolve(base, sp.dir);
            if (!d || !d.children) { return { error: sp.dir + ': no such directory' }; }
            if (!d.home) { return { error: 'files can only be created in your home directory (~)' }; }
            if (!validName(sp.base)) { return { error: sp.base + ' is not a valid file name' }; }
            n = { name: sp.base, kind: 'file', home: true, content: full, mtime: new Date(), parent: d };
            d.children.push(n);
            sortKids(d);
        }
        var err = homeSave();
        return err ? { error: err } : { node: n };
    }

    /* Makes a directory in ~; with parents, any missing ones on the way
       too, and no complaint if it exists. Returns an error or null. */
    function mkdir(base, path, parents) {
        var parts = String(path).replace(/\/+$/, '');
        var sp = splitPath(parts), existing = resolve(base, parts);
        if (existing) {
            if (parents && existing.children) { return null; }
            return path + ': already exists';
        }
        var parent = resolve(base, sp.dir);
        if (!parent && parents) { var e = mkdir(base, sp.dir, true); if (e) { return e; } parent = resolve(base, sp.dir); }
        if (!parent || !parent.children) { return sp.dir + ': no such directory'; }
        if (!parent.home) { return 'directories can only be made in your home directory (~)'; }
        if (!validName(sp.base)) { return sp.base + ' is not a valid name'; }
        mkDirNode(parent, sp.base);
        return homeSave();
    }

    /* Removes a file, or with recursive a directory, from ~. */
    function remove(n, recursive, label) {
        n = realOf(n);
        label = label || displayPath(n);
        if (!n.home) { return label + ' is part of the site, which is read-only'; }
        if (n === home.dir) { return 'your home directory can\'t be removed'; }
        if (n.special) { return label + ' belongs to the barcode tool; remove layouts in the file or in the tool instead'; }
        if (n.children && !recursive) { return label + ': is a directory (use rm -r)'; }
        n.parent.children.splice(n.parent.children.indexOf(n), 1);
        return homeSave();
    }

    /* Moves or renames a file or directory within ~. dest may be a
       directory to move into, or a new path. */
    function move(base, n, dest, label) {
        n = realOf(n);
        label = label || displayPath(n);
        if (!n.home) { return label + ' is part of the site, which is read-only'; }
        if (n === home.dir) { return 'your home directory can\'t be moved'; }
        if (n.special) { return label + ' belongs to the barcode tool and can\'t be moved'; }
        var target = resolve(base, dest), parent, name;
        if (target && target.children) { parent = target; name = n.name; }
        else {
            var sp = splitPath(dest);
            parent = resolve(base, sp.dir);
            name = sp.base;
            if (!parent || !parent.children) { return sp.dir + ': no such directory'; }
        }
        if (!parent.home) { return 'files can only be moved within your home directory (~)'; }
        if (!validName(name)) { return name + ' is not a valid name'; }
        for (var x = parent; x; x = x.parent) { if (x === n) { return 'a directory can\'t be moved into itself'; } }
        var clash = childNamed(parent, name);
        if (clash === n) { return null; }
        if (clash) {
            if (clash.children || n.children || clash.special) { return displayPath(parent).replace(/\/$/, '') + '/' + name + ' already exists'; }
            parent.children.splice(parent.children.indexOf(clash), 1);
        }
        n.parent.children.splice(n.parent.children.indexOf(n), 1);
        n.name = name;
        n.parent = parent;
        n.mtime = new Date();
        parent.children.push(n);
        sortKids(parent);
        return homeSave();
    }

    /* === Page text ======================================================== */

    var textCache = {};
    /* Fetches many pages' text in one request and fills the cache. */
    function prefetch(slugs) {
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

    /* The text of any file: a home file, a script, a page, or a link's
       address. */
    function read(n) {
        var r = realOf(n);
        if (r.home) { return Promise.resolve(readHome(r)); }
        if (r.kind === 'script') { return Promise.resolve(r.source || ''); }
        if (r.kind === 'link') {
            return Promise.resolve(r.title + '\n' + r.url + '\n' + (r.description ? '\n' + r.description + '\n' : ''));
        }
        return fetchText(r.name);
    }

    /* === Scripts ===========================================================
       A script is a text file of terminal commands: the site's in /bin, and
       a reader's own in ~/bin. */

    function userBin() { return home.dir ? childNamed(home.dir, 'bin') : null; }

    function isScript(n) {
        var r = realOf(n);
        if (r.children) { return false; }
        if (r.kind === 'script') { return true; }
        var ub = userBin();
        return !!(r.home && ub && r.parent === ub && !r.special);
    }

    /* Something that runs by name: an applet or a script. */
    function isRunnable(n) { return !!n && !n.children && (realOf(n).kind === 'app' || isScript(n)); }

    function scriptSource(n) { var r = realOf(n); return r.home ? readHome(r) : (r.source || ''); }

    /* The summary is the first comment line, less a leading "name:". */
    function scriptSummary(name, src) {
        var lines = String(src).replace(/\r/g, '').split('\n');
        for (var i = 0; i < lines.length; i++) {
            var t = lines[i].trim();
            if (t.indexOf('#!') === 0 || t[0] !== '#') { continue; }
            t = t.replace(/^#+\s*/, '');
            return t.indexOf(name + ':') === 0 ? t.slice(name.length + 1).trim() : t;
        }
        return '';
    }

    /* What a node is, in the words the file manager and the editor use:
       dir, app, script, link, page or file. */
    function kindOf(n) {
        var r = realOf(n);
        if (r.children || n.children) { return 'dir'; }
        if (isScript(r)) { return 'script'; }
        if (r.home) { return 'file'; }
        return r.kind;
    }

    function size(n) { var r = realOf(n); return r.home && !r.children ? readHome(r).length : null; }

    window.pcSiteFs = {
        load: load,
        root: function () { return root; },
        home: function () { return home.dir; },
        resolve: resolve,
        pathOf: pathOf,
        displayPath: displayPath,
        childNamed: childNamed,
        splitPath: splitPath,
        realOf: realOf,
        validName: validName,
        attached: attached,
        kindOf: kindOf,
        size: size,
        read: read,
        readHome: readHome,
        write: write,
        mkdir: mkdir,
        remove: remove,
        move: move,
        save: homeSave,
        sync: homeSync,
        prefetch: prefetch,
        checkLayouts: checkLayouts,
        userBin: userBin,
        isScript: isScript,
        isRunnable: isRunnable,
        scriptSource: scriptSource,
        scriptSummary: scriptSummary,
        limits: { file: FILE_MAX, home: HOME_MAX },
        onChange: function (fn) {
            var h = function (e) { fn(e.detail || {}); };
            document.addEventListener('pc:fs-change', h);
            return function () { document.removeEventListener('pc:fs-change', h); };
        }
    };
})();
