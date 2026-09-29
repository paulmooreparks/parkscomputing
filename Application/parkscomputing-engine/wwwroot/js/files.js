/* Files: a graphical view of the same sandbox the terminal sees
   (Architecture/files-editor-design.md). The folders are a tree on the
   left and the current folder's contents a list on the right, and the
   reader's own home directory, ~, can be changed here the way the terminal
   changes it. Everything goes through js/sitefs.js; nothing reaches the
   server's disk. */
(function () {
    'use strict';

    var SELF_SRC = document.currentScript && document.currentScript.src;
    function beside(file) { return SELF_SRC ? SELF_SRC.replace(/files\.js/, file) : '/js/' + file; }
    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('could not load ' + src)); };
            document.head.appendChild(s);
        });
    }
    var siteFsReady = null;
    function loadSiteFs() {
        if (window.pcSiteFs) { return Promise.resolve(window.pcSiteFs); }
        if (!siteFsReady) {
            siteFsReady = loadScript(window.pcSiteFsSrc || beside('sitefs.js'))
                .then(function () { return window.pcSiteFs; })
                .catch(function (err) { siteFsReady = null; throw err; });
        }
        return siteFsReady;
    }

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function fmtDate(d) { return d && !isNaN(d) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
    function fmtSize(n) { return n == null ? '' : n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB'; }

    /* A glyph for each kind of entry. The kind is also named in words in
       its own column, so colour is never the only signal. */
    var GLYPHS = {
        dir: '<path d="M1.5 4.5a1 1 0 0 1 1-1h3.6l1.4 1.5h5.9a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-10.9a1 1 0 0 1-1-1z"/>',
        page: '<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3"/><line x1="5.5" y1="8" x2="10.5" y2="8"/><line x1="5.5" y1="10.5" x2="10.5" y2="10.5"/>',
        app: '<rect x="1.5" y="1.5" width="5" height="5" rx="1"/><rect x="9.5" y="1.5" width="5" height="5" rx="1"/><rect x="1.5" y="9.5" width="5" height="5" rx="1"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/>',
        script: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M4.5 6.5l2 1.75-2 1.75"/><line x1="8" y1="11" x2="11.5" y2="11"/>',
        link: '<path d="M9 2.5h4.5V7"/><line x1="13.5" y1="2.5" x2="7.5" y2="8.5"/><path d="M12 9.5v3.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5"/>',
        file: '<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3"/>',
        home: '<path d="M2 7.5L8 2.5l6 5"/><path d="M3.5 6.5v7h9v-7"/><rect x="6.75" y="9.5" width="2.5" height="4"/>'
    };
    var KIND_NAMES = { dir: 'Folder', page: 'Page', app: 'Applet', script: 'Script', link: 'Link', file: 'File' };
    function glyph(kind, cls) {
        return '<svg class="fm-glyph fm-k-' + kind + (cls ? ' ' + cls : '') + '" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">' + (GLYPHS[kind] || GLYPHS.file) + '</svg>';
    }

    var uid = 0;

    function init(root, opts) {
        opts = opts || {};
        var n = ++uid;
        root.classList.add('pc-files');
        if (opts.fit === 'fill') { root.classList.add('pc-files-fill'); }
        root.innerHTML =
            '<div class="fm-toolbar">' +
              '<button type="button" class="icon-btn" data-action="up" aria-label="Up one folder" title="Up one folder"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3.5"/><path d="M4 7.5l4-4 4 4"/></svg></button>' +
              '<button type="button" class="icon-btn" data-action="home" aria-label="Your home directory" title="Your home directory">' + glyph('home') + '</button>' +
              '<nav class="fm-crumbs" data-role="crumbs" aria-label="Path"></nav>' +
              '<span class="fm-spacer"></span>' +
              '<span class="fm-home-tools" data-role="home-tools">' +
                '<button type="button" class="btn btn-sm" data-action="new-file">New file</button>' +
                '<button type="button" class="btn btn-sm" data-action="new-folder">New folder</button>' +
                '<button type="button" class="btn btn-sm" data-action="upload">Upload&#8230;</button>' +
              '</span>' +
              '<div class="menu">' +
                '<button type="button" class="btn btn-sm menu-btn" popovertarget="fm-menu-' + n + '" data-role="menu-btn">Actions</button>' +
                '<nav class="menu-panel" id="fm-menu-' + n + '" popover aria-label="Actions" data-role="menu"></nav>' +
              '</div>' +
            '</div>' +
            '<div class="fm-body">' +
              '<div class="fm-tree" data-role="tree" role="tree" aria-label="Folders"></div>' +
              '<div class="fm-main" data-role="drop">' +
                '<table class="data-table fm-list" data-role="list" role="grid" aria-label="Contents">' +
                  '<thead><tr><th scope="col" class="fm-c-name">Name</th><th scope="col" class="fm-c-kind">Kind</th><th scope="col" class="fm-c-date">Date</th><th scope="col" class="fm-c-size">Size</th></tr></thead>' +
                  '<tbody data-role="rows"></tbody>' +
                '</table>' +
                '<p class="fm-empty" data-role="empty" hidden></p>' +
                '<p class="fm-drop-hint" data-role="drop-hint">Drop text files here to upload them.</p>' +
              '</div>' +
            '</div>' +
            '<div class="fm-detail" data-role="detail" aria-live="polite"></div>' +
            '<p class="fm-status" data-role="status" role="status" aria-live="polite"></p>' +
            '<dialog class="dialog fm-dialog" data-role="dialog" aria-labelledby="fm-dlg-title-' + n + '">' +
              '<form method="dialog" data-role="dialog-form">' +
                '<h3 class="dialog-title" id="fm-dlg-title-' + n + '" data-role="dialog-title"></h3>' +
                '<div class="dialog-body">' +
                  '<p data-role="dialog-text"></p>' +
                  '<input class="form-input" data-role="dialog-input" autocomplete="off" spellcheck="false" />' +
                  '<p class="form-error" data-role="dialog-error" hidden></p>' +
                '</div>' +
                '<div class="dialog-actions">' +
                  '<button type="button" class="btn" data-role="dialog-cancel">Cancel</button>' +
                  '<button type="submit" class="btn btn-primary" data-role="dialog-ok">OK</button>' +
                '</div>' +
              '</form>' +
            '</dialog>' +
            '<input type="file" multiple hidden data-role="file-input" accept=".txt,.md,.json,.cells,.sudoku,.csv,.xfer,.sh,text/*" />';

        var q = function (sel) { return root.querySelector(sel); };
        var el = {
            crumbs: q('[data-role="crumbs"]'), tree: q('[data-role="tree"]'), rows: q('[data-role="rows"]'),
            list: q('[data-role="list"]'), empty: q('[data-role="empty"]'), detail: q('[data-role="detail"]'),
            status: q('[data-role="status"]'), homeTools: q('[data-role="home-tools"]'), menu: q('[data-role="menu"]'),
            menuBtn: q('[data-role="menu-btn"]'), drop: q('[data-role="drop"]'), fileInput: q('[data-role="file-input"]'),
            dialog: q('[data-role="dialog"]'), dlgForm: q('[data-role="dialog-form"]'), dlgTitle: q('[data-role="dialog-title"]'),
            dlgText: q('[data-role="dialog-text"]'), dlgInput: q('[data-role="dialog-input"]'), dlgError: q('[data-role="dialog-error"]'),
            dlgOk: q('[data-role="dialog-ok"]')
        };

        var F = null, cwd = null, selected = null, expanded = {}, destroyed = false, unsubscribe = null;
        var startPath = pathFrom(opts.state) || (opts.ownsUrl ? pathFrom(location.search) : null) || '/';

        function pathFrom(s) {
            if (!s) { return null; }
            var v = new URLSearchParams(String(s).replace(/^\?/, '')).get('path');
            return v && (v[0] === '/' || v[0] === '~') ? v : null;
        }

        /* === State ====================================================== */

        function stateString() { return 'path=' + encodeURIComponent(cwd ? F.pathOf(cwd) : '/').replace(/%2F/g, '/'); }
        function announce() {
            if (opts.ownsUrl) {
                var qs = new URLSearchParams(location.search);
                qs.set('path', cwd ? F.pathOf(cwd) : '/');
                history.replaceState(history.state, '', location.pathname + '?' + qs.toString().replace(/%2F/g, '/') + location.hash);
            }
            if (opts.changed) { opts.changed(stateString()); }
        }

        function say(msg, isError) {
            el.status.textContent = msg || '';
            el.status.classList.toggle('fm-status-error', !!isError);
        }

        /* === Moving about ================================================ */

        function go(node, keepStatus) {
            if (!node || !node.children) { return; }
            cwd = node;
            selected = null;
            for (var x = node; x; x = x.parent) { expanded[F.pathOf(x)] = true; }
            if (!keepStatus) { say(''); }
            render();
            announce();
        }

        function goPath(path) {
            var node = F.resolve(null, path);
            if (node && node.children) { go(node); } else { say(path + ': no such folder', true); }
        }

        /* After a change, the current folder and the selection are found
           again by path, since a reload replaces the nodes under ~. */
        function refresh() {
            if (!F || !cwd) { return; }
            var path = F.pathOf(cwd), sel = selected ? selected.name : null;
            var node = F.resolve(null, path);
            while (!node && path !== '/') { path = path.slice(0, path.lastIndexOf('/')) || '/'; node = F.resolve(null, path); }
            cwd = node || F.root();
            selected = sel ? F.childNamed(cwd, sel) : null;
            render();
        }

        function inHome(node) { var r = F.realOf(node); return !!r.home; }

        /* === Drawing ===================================================== */

        function render() {
            renderCrumbs();
            renderTree();
            renderList();
            renderDetail();
            renderMenu();
            var home = inHome(cwd);
            el.homeTools.hidden = !home;
            el.drop.classList.toggle('fm-can-drop', home);
            q('[data-action="up"]').disabled = !cwd.parent;
        }

        function renderCrumbs() {
            var chain = [];
            for (var x = cwd; x; x = x.parent) { chain.unshift(x); }
            var homeDir = F.home(), html = '', start = 0;
            var h = chain.indexOf(homeDir);
            if (h >= 0) { start = h; }
            for (var i = start; i < chain.length; i++) {
                var c = chain[i], label = i === start && h >= 0 ? '~' : (c.parent ? c.name : 'site');
                var last = i === chain.length - 1;
                html += (i > start ? '<span class="fm-crumb-sep" aria-hidden="true">/</span>' : '') +
                    (last ? '<span class="fm-crumb" aria-current="page">' + esc(label) + '</span>'
                        : '<a class="fm-crumb" href="' + esc(linkFor(c)) + '" data-path="' + esc(F.pathOf(c)) + '">' + esc(label) + '</a>');
            }
            el.crumbs.innerHTML = html;
        }

        function linkFor(node) { return (opts.pageUrl || '/page/files') + '?path=' + encodeURIComponent(F.pathOf(node)).replace(/%2F/g, '/'); }

        function renderTree() {
            var focusPath = document.activeElement && root.contains(document.activeElement) ? document.activeElement.getAttribute('data-path') : null;
            var html = '', seen = {};
            function item(node, depth) {
                var path = F.pathOf(node);
                var dirs = (node.children || []).filter(function (c) { return c.children; });
                var open = !!expanded[path];
                /* ~ shows twice, as its own root and under the site; only
                   its first appearance takes the keyboard. */
                var current = node === cwd && !seen[path];
                seen[path] = true;
                var label = !node.parent ? 'Site' : node === F.home() ? 'Home (~)' : node.name;
                html += '<div class="fm-ti' + (current ? ' fm-ti-current' : '') + '" role="treeitem" data-path="' + esc(path) + '"' +
                    ' aria-level="' + (depth + 1) + '" aria-selected="' + current + '"' + (dirs.length ? ' aria-expanded="' + open + '"' : '') +
                    ' tabindex="' + (current ? '0' : '-1') + '" style="--depth:' + depth + '"' + (inHome(node) ? ' data-home' : '') + '>' +
                    '<span class="fm-twisty" data-toggle aria-hidden="true">' + (dirs.length ? (open ? '&#9662;' : '&#9656;') : '') + '</span>' +
                    glyph(node === F.home() ? 'home' : 'dir', node === F.home() ? 'fm-k-dir' : '') + '<span class="fm-ti-label">' + esc(label) + '</span></div>';
                if (open) { dirs.forEach(function (d) { item(d, depth + 1); }); }
            }
            /* Your home directory is a root of its own, first, since it is
               where the changes happen; the site follows. */
            item(F.home(), 0);
            item(F.root(), 0);
            el.tree.innerHTML = html;
            if (focusPath) { var f = el.tree.querySelector('[data-path="' + CSS.escape(focusPath) + '"]'); if (f) { f.focus(); } }
        }

        function entries() {
            var kids = (cwd.children || []).slice();
            /* Folders first; within each, the order the site gives, which
               for articles is newest first. */
            return kids.filter(function (c) { return c.children; }).concat(kids.filter(function (c) { return !c.children; }));
        }

        function renderList() {
            var list = entries(), html = '';
            list.forEach(function (c) {
                var r = F.realOf(c), kind = F.kindOf(c);
                var date = r.home ? r.mtime : r.date;
                var sel = selected === c;
                html += '<tr class="fm-row' + (sel ? ' fm-selected' : '') + '" data-name="' + esc(c.name) + '" aria-selected="' + sel + '" tabindex="' + (sel || (!selected && c === list[0]) ? '0' : '-1') + '"' +
                    (inHome(c) && !r.special ? ' draggable="true"' : '') + '>' +
                    '<td class="fm-c-name"><span class="fm-cell">' + glyph(kind) + '<span class="fm-name">' + esc(c.name) + (kind === 'dir' ? '/' : '') + '</span>' +
                    (r.title && r.title !== c.name && !r.home ? '<span class="fm-title">' + esc(r.title) + '</span>' : '') + '</span></td>' +
                    '<td class="fm-c-kind">' + KIND_NAMES[kind] + '</td>' +
                    '<td class="fm-c-date">' + esc(fmtDate(date)) + '</td>' +
                    '<td class="fm-c-size">' + esc(fmtSize(F.size(c))) + '</td></tr>';
            });
            el.rows.innerHTML = html;
            el.empty.hidden = list.length > 0;
            el.empty.textContent = inHome(cwd) ? 'This folder is empty. Make a file or a folder, or drop files here.' : 'This folder is empty.';
        }

        function renderDetail() {
            var c = selected;
            if (!c) {
                var count = (cwd.children || []).length;
                el.detail.innerHTML = '<span class="fm-d-title">' + esc(F.displayPath(cwd)) + '</span><span class="fm-d-meta">' + count + (count === 1 ? ' item' : ' items') +
                    (inHome(cwd) ? ' · your own files, kept in this browser' : ' · read-only') + '</span>';
                return;
            }
            var r = F.realOf(c), kind = F.kindOf(c), bits = [];
            var date = r.home ? r.mtime : r.date;
            if (date) { bits.push(fmtDate(date)); }
            if (F.size(c) != null) { bits.push(fmtSize(F.size(c))); }
            if (kind === 'dir') { bits.push((r.children || []).length + ' items'); }
            var desc = kind === 'script' ? F.scriptSummary(c.name, F.scriptSource(c)) : r.description;
            if (r.special === 'layouts') { desc = 'The barcode tool\'s layouts; edit it to change them.'; }
            if (kind === 'link') { desc = (desc ? desc + ' · ' : '') + r.url; }
            el.detail.innerHTML =
                '<span class="fm-d-title">' + glyph(kind) + esc(r.title && !r.home ? r.title : c.name) + '</span>' +
                '<span class="fm-d-meta">' + esc(KIND_NAMES[kind]) + (bits.length ? ' · ' + esc(bits.join(' · ')) : '') + ' · <code>' + esc(F.displayPath(c)) + '</code></span>' +
                (desc ? '<span class="fm-d-desc">' + esc(desc) + '</span>' : '') +
                (r.tags && r.tags.length ? '<span class="fm-d-tags">' + r.tags.map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join(' ') + '</span>' : '');
        }

        /* The actions menu offers only what applies: changing ~ is not on
           offer outside it. */
        function renderMenu() {
            var items = [], c = selected, home = inHome(cwd), shell = canOpen('shell');
            if (c) {
                var kind = F.kindOf(c), r = F.realOf(c), editable = canOpen('open', kind);
                items.push(['open', kind === 'dir' ? 'Open folder' : kind === 'app' ? 'Launch' : kind === 'link' ? 'Open link in a new tab' : (kind === 'file' || kind === 'script') && editable ? 'Open in the editor' : 'Open']);
                if (kind !== 'dir' && kind !== 'link' && kind !== 'app' && editable) { items.push(['edit', r.home ? 'Edit' : 'View in the editor']); }
                if ((kind === 'script' || kind === 'app') && shell) { items.push(['run', 'Run in the terminal']); }
                if (kind !== 'dir') { items.push(['download', 'Download']); }
                if (r.home && !r.special) {
                    items.push(['sep']);
                    items.push(['rename', 'Rename…']);
                    items.push(['move', 'Move to…']);
                    items.push(['delete', 'Delete…']);
                }
                if (!r.home && kind === 'page') { items.push(['copy', 'Copy to ~']); }
            }
            if (home) {
                items.push(['sep']);
                items.push(['new-file', 'New file…']);
                items.push(['new-folder', 'New folder…']);
                items.push(['upload', 'Upload…']);
            }
            if (shell) {
                items.push(['sep']);
                items.push(['terminal', 'Open a terminal here']);
            }
            var html = '';
            items.forEach(function (it, i) {
                if (it[0] === 'sep') { if (html && i < items.length - 1 && items[i + 1][0] !== 'sep') { html += '<div class="menu-sep" role="separator"></div>'; } return; }
                html += '<button type="button" class="menu-action" data-action="' + it[0] + '">' + esc(it[1]) + '</button>';
            });
            el.menu.innerHTML = html;
        }

        /* === Opening things ============================================== */

        var inWindows = function () { return opts.host === 'window' && window.pudlWindows; };

        /* Files and shells are asked for through the site's handlers
           (js/handlers.js): whichever applet serves the request answers,
           and an action with nothing to serve it is not offered. */
        function canOpen(verb, kind) { return !!window.pcOpen && window.pcOpen.can(verb, kind); }
        function request(verb, req) { return !!window.pcOpen && window.pcOpen.request(verb, req, root); }

        function openInEditor(node) {
            if (!request('open', { path: F.displayPath(F.realOf(node)), kind: F.kindOf(node) })) { say('Nothing on this site opens ' + node.name + '.', true); }
        }

        function openEntry(c) {
            var r = F.realOf(c), kind = F.kindOf(c);
            if (kind === 'dir') { go(c); focusList(); return; }
            if (kind === 'link') { window.open(r.url, '_blank', 'noopener'); return; }
            if (kind === 'file' || kind === 'script') { openInEditor(c); return; }
            if (inWindows()) { window.pudlWindows.open(r.name); return; }
            location.assign('/page/' + encodeURIComponent(r.name));
        }

        function openTerminal(run) {
            if (!request('shell', { path: F.pathOf(cwd), run: run })) { say('Nothing on this site opens a terminal.', true); }
        }

        /* A folder asked of this Files through the site's handlers. */
        function onRequest(e) {
            var p = pathFrom(e.detail && e.detail.state);
            if (F && p) { goPath(p); focusList(); }
        }
        root.addEventListener('pc:applet-request', onRequest);

        /* === Dialogs ====================================================== */

        /* A small prompt: resolves to the text entered, or null. validate
           returns an error message to keep the dialog open. */
        function prompt(title, text, value, okLabel, validate, withInput) {
            return new Promise(function (done) {
                el.dlgTitle.textContent = title;
                el.dlgText.textContent = text || '';
                el.dlgText.hidden = !text;
                el.dlgInput.hidden = withInput === false;
                el.dlgInput.value = value || '';
                el.dlgError.hidden = true;
                el.dlgOk.textContent = okLabel || 'OK';
                el.dlgOk.classList.toggle('btn-danger', okLabel === 'Delete');
                el.dlgOk.classList.toggle('btn-primary', okLabel !== 'Delete');
                var finished = false;
                function finish(v) { if (finished) { return; } finished = true; cleanup(); if (el.dialog.open) { el.dialog.close(); } done(v); }
                function onSubmit(e) {
                    e.preventDefault();
                    var v = withInput === false ? true : el.dlgInput.value.trim();
                    var err = validate ? validate(v) : null;
                    if (err) { el.dlgError.textContent = err; el.dlgError.hidden = false; el.dlgInput.focus(); return; }
                    finish(v);
                }
                function onCancel() { finish(null); }
                function onClose() { finish(null); }
                function cleanup() {
                    el.dlgForm.removeEventListener('submit', onSubmit);
                    q('[data-role="dialog-cancel"]').removeEventListener('click', onCancel);
                    el.dialog.removeEventListener('close', onClose);
                }
                el.dlgForm.addEventListener('submit', onSubmit);
                q('[data-role="dialog-cancel"]').addEventListener('click', onCancel);
                el.dialog.addEventListener('close', onClose);
                el.dialog.showModal();
                if (withInput === false) { el.dlgOk.focus(); } else { el.dlgInput.focus(); el.dlgInput.select(); }
            });
        }

        function nameCheck(v) {
            if (!v) { return 'Give it a name.'; }
            if (!F.validName(v)) { return 'A name can\'t contain / or be . or ..'; }
            if (F.childNamed(cwd, v)) { return 'Something called ' + v + ' is already here.'; }
            return null;
        }

        /* === Actions ====================================================== */

        async function act(action) {
            var c = selected;
            switch (action) {
                case 'up': if (cwd.parent) { var from = cwd; go(cwd.parent); select(from.name); } return;
                case 'home': go(F.home()); return;
                case 'open': if (c) { openEntry(c); } return;
                case 'edit': if (c) { openInEditor(c); } return;
                case 'run': if (c) { openTerminal(c.name); } return;
                case 'terminal': openTerminal(null); return;
                case 'download': if (c) { download(c); } return;
                case 'copy': if (c) { await copyHome(c); } return;
                case 'new-file': {
                    var name = await prompt('New file', 'In ' + F.displayPath(cwd), '', 'Create', nameCheck);
                    if (name == null) { return; }
                    var res = await F.write(cwd, name, '', false);
                    if (res.error) { say(res.error, true); return; }
                    refresh(); select(name); say('Made ' + name + '.');
                    return;
                }
                case 'new-folder': {
                    var dname = await prompt('New folder', 'In ' + F.displayPath(cwd), '', 'Create', nameCheck);
                    if (dname == null) { return; }
                    var e1 = F.mkdir(cwd, dname, false);
                    if (e1) { say(e1, true); return; }
                    refresh(); select(dname); say('Made ' + dname + '/.');
                    return;
                }
                case 'upload': el.fileInput.value = ''; el.fileInput.click(); return;
                case 'rename': {
                    if (!c) { return; }
                    var nn = await prompt('Rename', 'Rename ' + c.name + ' to:', c.name, 'Rename', function (v) { return v === c.name ? null : nameCheck(v); });
                    if (nn == null || nn === c.name) { return; }
                    var e2 = F.move(cwd, c, nn);
                    if (e2) { say(e2, true); return; }
                    refresh(); select(nn); say('Renamed to ' + nn + '.');
                    return;
                }
                case 'move': {
                    if (!c) { return; }
                    var dest = await prompt('Move', 'Move ' + c.name + ' to which folder in ~? For example ~/notes', F.displayPath(cwd), 'Move', function (v) {
                        var d = F.resolve(cwd, v);
                        if (!d || !d.children) { return 'There\'s no folder at ' + v + '.'; }
                        if (!d.home) { return 'Only folders in your home directory (~) can take it.'; }
                        return null;
                    });
                    if (dest == null) { return; }
                    var e3 = F.move(cwd, c, dest);
                    if (e3) { say(e3, true); return; }
                    refresh(); say('Moved ' + c.name + ' to ' + dest + '.');
                    return;
                }
                case 'delete': {
                    if (!c) { return; }
                    var many = c.children ? ' and everything in it (' + c.children.length + (c.children.length === 1 ? ' item' : ' items') + ')' : '';
                    var ok = await prompt('Delete ' + c.name + '?', 'This deletes ' + F.displayPath(c) + many + ' from this browser. It can\'t be undone.', '', 'Delete', null, false);
                    if (!ok) { return; }
                    var e4 = F.remove(c, true);
                    if (e4) { say(e4, true); return; }
                    selected = null; refresh(); say('Deleted ' + c.name + '.');
                    return;
                }
            }
        }

        async function download(c) {
            var r = F.realOf(c), text;
            try { text = await F.read(r); } catch (err) { say(err.message, true); return; }
            var name = r.home ? r.name : r.name + '.txt';
            var url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
            var a = document.createElement('a');
            a.href = url; a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
            say('Downloaded ' + name + '.');
        }

        async function copyHome(c) {
            var r = F.realOf(c), text;
            try { text = await F.read(r); } catch (err) { say(err.message, true); return; }
            var res = await F.write(F.home(), '~/' + r.name, text, false);
            if (res.error) { say(res.error, true); return; }
            say('Copied to ~/' + r.name + '.');
        }

        async function uploadFiles(files) {
            if (!inHome(cwd)) { say('Files can only go into your home directory (~).', true); return; }
            var done = 0, errors = [];
            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                if (f.size > F.limits.file) { errors.push(f.name + ' is larger than 256 KB'); continue; }
                var text = await f.text();
                if (text.indexOf('\0') >= 0) { errors.push(f.name + ' is not a text file'); continue; }
                var res = await F.write(cwd, f.name, text, false);
                if (res.error) { errors.push(res.error); } else { done++; }
            }
            refresh();
            say((done ? 'Uploaded ' + done + (done === 1 ? ' file.' : ' files.') : '') + (errors.length ? ' ' + errors.join('; ') : ''), errors.length > 0);
        }

        /* === Selection and keys =========================================== */

        function rowFor(name) { return el.rows.querySelector('tr[data-name="' + CSS.escape(name) + '"]'); }
        function select(name, focus) {
            selected = name ? F.childNamed(cwd, name) : null;
            el.rows.querySelectorAll('tr').forEach(function (tr) {
                var on = tr.getAttribute('data-name') === name;
                tr.classList.toggle('fm-selected', on);
                tr.setAttribute('aria-selected', String(on));
                tr.tabIndex = on ? 0 : -1;
            });
            renderDetail();
            renderMenu();
            if (focus !== false && name) { var r = rowFor(name); if (r) { r.focus(); } }
        }
        function focusList() {
            var r = el.rows.querySelector('tr[tabindex="0"]') || el.rows.querySelector('tr');
            if (r) { r.focus(); }
        }

        root.addEventListener('click', function (e) {
            var a = e.target.closest('[data-action]');
            if (a && root.contains(a)) {
                if (el.menu.contains(a) && el.menu.matches(':popover-open')) { el.menu.hidePopover(); }
                act(a.getAttribute('data-action'));
                return;
            }
            var crumb = e.target.closest('a.fm-crumb');
            if (crumb && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) { e.preventDefault(); goPath(crumb.getAttribute('data-path')); return; }
            var ti = e.target.closest('.fm-ti');
            if (ti) {
                var node = F.resolve(null, ti.getAttribute('data-path'));
                if (e.target.closest('[data-toggle]') && node && node.children.some(function (x) { return x.children; })) {
                    var p = ti.getAttribute('data-path'); expanded[p] = !expanded[p]; renderTree();
                    return;
                }
                go(node);
                return;
            }
            var tr = e.target.closest('tr.fm-row');
            if (tr) { select(tr.getAttribute('data-name')); }
        });
        root.addEventListener('dblclick', function (e) {
            var tr = e.target.closest('tr.fm-row');
            if (tr) { select(tr.getAttribute('data-name'), false); if (selected) { openEntry(selected); } }
        });

        /* The row with the focus is the selected one, however it got the
           focus. */
        el.rows.addEventListener('focusin', function (e) {
            var tr = e.target.closest('tr.fm-row');
            if (tr && (!selected || selected.name !== tr.getAttribute('data-name'))) { select(tr.getAttribute('data-name'), false); }
        });

        el.rows.addEventListener('keydown', function (e) {
            var rows = Array.prototype.slice.call(el.rows.querySelectorAll('tr'));
            var i = rows.indexOf(document.activeElement);
            var name = function (k) { return rows[k] ? rows[k].getAttribute('data-name') : null; };
            switch (e.key) {
                case 'ArrowDown': if (i < rows.length - 1) { select(name(i + 1)); } e.preventDefault(); break;
                case 'ArrowUp': if (i > 0) { select(name(i - 1)); } e.preventDefault(); break;
                case 'Home': select(name(0)); e.preventDefault(); break;
                case 'End': select(name(rows.length - 1)); e.preventDefault(); break;
                case 'Enter': if (i >= 0) { select(name(i), false); openEntry(selected); } e.preventDefault(); break;
                case 'Backspace': act('up'); e.preventDefault(); break;
                case 'Delete': if (selected && inHome(selected) && !F.realOf(selected).special) { act('delete'); } e.preventDefault(); break;
                case 'F2': if (selected && inHome(selected) && !F.realOf(selected).special) { act('rename'); } e.preventDefault(); break;
                case ' ': if (i >= 0) { select(name(i)); } e.preventDefault(); break;
            }
        });

        /* The tree follows the ARIA tree pattern: the arrow keys move and
           open, Enter goes to the folder. */
        el.tree.addEventListener('keydown', function (e) {
            var items = Array.prototype.slice.call(el.tree.querySelectorAll('.fm-ti'));
            var i = items.indexOf(document.activeElement);
            if (i < 0) { return; }
            var it = items[i], path = it.getAttribute('data-path'), exp = it.getAttribute('aria-expanded');
            function focusAt(k) { if (items[k]) { items.forEach(function (x) { x.tabIndex = -1; }); items[k].tabIndex = 0; items[k].focus(); } }
            switch (e.key) {
                case 'ArrowDown': focusAt(i + 1); break;
                case 'ArrowUp': focusAt(i - 1); break;
                case 'ArrowRight':
                    if (exp === 'false') { expanded[path] = true; renderTree(); el.tree.querySelector('[data-path="' + CSS.escape(path) + '"]').focus(); }
                    else if (exp === 'true') { focusAt(i + 1); }
                    break;
                case 'ArrowLeft':
                    if (exp === 'true') { expanded[path] = false; renderTree(); el.tree.querySelector('[data-path="' + CSS.escape(path) + '"]').focus(); }
                    else { var parent = path.slice(0, path.lastIndexOf('/')) || '/'; var pe = el.tree.querySelector('[data-path="' + CSS.escape(parent) + '"]'); if (pe && pe !== it) { focusAt(items.indexOf(pe)); } }
                    break;
                case 'Home': focusAt(0); break;
                case 'End': focusAt(items.length - 1); break;
                case 'Enter': case ' ': go(F.resolve(null, path)); focusList(); break;
                default: return;
            }
            e.preventDefault();
        });

        el.fileInput.addEventListener('change', function () { if (el.fileInput.files && el.fileInput.files.length) { uploadFiles(Array.prototype.slice.call(el.fileInput.files)); } });

        /* === Dragging ===================================================== */

        var dragName = null;
        el.rows.addEventListener('dragstart', function (e) {
            var tr = e.target.closest('tr.fm-row');
            if (!tr) { return; }
            dragName = tr.getAttribute('data-name');
            e.dataTransfer.setData('application/x-pc-files', F.pathOf(F.childNamed(cwd, dragName)));
            e.dataTransfer.effectAllowed = 'move';
        });
        el.rows.addEventListener('dragend', function () { dragName = null; clearDropMarks(); });
        function clearDropMarks() { root.querySelectorAll('.fm-drop-target').forEach(function (x) { x.classList.remove('fm-drop-target'); }); el.drop.classList.remove('fm-dragging'); }

        /* A folder in ~ (a row or a tree item) takes a dragged entry; the
           list itself, in ~, takes files dropped from the computer. */
        function folderTarget(e) {
            var t = e.target.closest('tr.fm-row, .fm-ti');
            if (!t) { return null; }
            var node = t.classList.contains('fm-ti') ? F.resolve(null, t.getAttribute('data-path')) : F.childNamed(cwd, t.getAttribute('data-name'));
            return node && node.children && inHome(node) ? { el: t, node: node } : null;
        }
        function isFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
        root.addEventListener('dragover', function (e) {
            if (dragName) {
                var t = folderTarget(e);
                clearDropMarks();
                if (t && F.pathOf(t.node) !== F.pathOf(F.childNamed(cwd, dragName) || cwd)) { t.el.classList.add('fm-drop-target'); e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
                return;
            }
            if (isFiles(e) && inHome(cwd) && el.drop.contains(e.target)) { el.drop.classList.add('fm-dragging'); e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
        });
        root.addEventListener('dragleave', function (e) { if (!root.contains(e.relatedTarget)) { clearDropMarks(); } });
        root.addEventListener('drop', function (e) {
            if (dragName) {
                var t = folderTarget(e), moving = F.childNamed(cwd, dragName);
                clearDropMarks();
                if (!t || !moving) { return; }
                e.preventDefault();
                var err = F.move(cwd, moving, F.displayPath(t.node));
                dragName = null;
                if (err) { say(err, true); } else { refresh(); say('Moved ' + moving.name + ' to ' + F.displayPath(t.node) + '.'); }
                return;
            }
            if (isFiles(e) && inHome(cwd)) {
                e.preventDefault();
                clearDropMarks();
                uploadFiles(Array.prototype.slice.call(e.dataTransfer.files || []));
            }
        });

        /* === Start ======================================================== */

        var boot = loadSiteFs().then(function (api) { F = api; return F.load(); }).then(function () {
            if (destroyed) { return; }
            var start = F.resolve(null, startPath);
            cwd = start && start.children ? start : F.root();
            for (var x = cwd; x; x = x.parent) { expanded[F.pathOf(x)] = true; }
            expanded[F.pathOf(F.home())] = true;
            render();
            announce();
            unsubscribe = F.onChange(function () { refresh(); });
            if (opts.ownsUrl || root.closest('.win.active')) { focusList(); }
        }).catch(function (err) {
            if (destroyed) { return; }
            root.innerHTML = '<p class="fm-failed">Files could not start: ' + esc(err.message) + '.</p>';
        });

        return {
            state: function () { return cwd && F ? stateString() : null; },
            setState: function (s) { var p = pathFrom(s); if (F && p) { goPath(p); } },
            destroy: function () {
                destroyed = true;
                root.removeEventListener('pc:applet-request', onRequest);
                if (unsubscribe) { unsubscribe(); }
                if (el.dialog.open) { el.dialog.close(); }
            },
            ready: boot
        };
    }

    window.pudlApplets.register('files', { init: init });
})();
