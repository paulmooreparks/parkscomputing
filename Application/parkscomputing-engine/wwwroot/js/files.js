/* Files: a graphical view of the same sandbox the terminal sees
   (Architecture/files-editor-design.md). The browsing itself, the folder
   tree, the path bar and the list, is js/filebrowser.js, which the Editor
   shares; Files adds the toolbar, the Actions menu, the detail line, its
   dialogs and uploads, and decides what opening an entry means. The
   reader's own home directory, ~, and on the edit origin /wwwroot, can be
   changed here the way the terminal changes them. Everything goes through
   js/sitefs.js. */
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
    /* Files' one setting, whether names starting with a dot show, lives in
       ~/.config/files.json (js/config.js) and is toggled from its menu. */
    var configReady = null;
    function loadConfig() {
        if (window.pcConfig) { return Promise.resolve(window.pcConfig); }
        if (!configReady) {
            configReady = loadScript(window.pcConfigSrc || beside('config.js'))
                .then(function () { return window.pcConfig; })
                .catch(function (err) { configReady = null; throw err; });
        }
        return configReady;
    }

    var browserReady = null;
    function loadBrowser() {
        if (window.pcFileBrowser) { return Promise.resolve(window.pcFileBrowser); }
        if (!browserReady) {
            browserReady = loadScript(window.pcFileBrowserSrc || beside('filebrowser.js'))
                .then(function () { return window.pcFileBrowser; })
                .catch(function (err) { browserReady = null; throw err; });
        }
        return browserReady;
    }

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function homeGlyph() { return '<span class="glyph" style="--glyph: var(--glyph-home)" aria-hidden="true"></span>'; }

    var uid = 0;

    function init(root, opts) {
        opts = opts || {};
        var n = ++uid;
        /* On the edit origin, with the admin mount, uploads take any file. */
        var mounted = !!document.querySelector('meta[name="pc-fs-mount"]');
        root.classList.add('pc-files');
        if (opts.fit === 'fill') { root.classList.add('pc-files-fill'); }
        root.innerHTML = '<p class="fm-loading">Loading…</p>';

        var F = null, FB = null, b = null, el = null, destroyed = false;
        var startPath = pathFrom(opts.state) || (opts.ownsUrl ? pathFrom(location.search) : null) || '/site';

        function pathFrom(s) {
            if (!s) { return null; }
            var v = new URLSearchParams(String(s).replace(/^\?/, '')).get('path');
            return v && (v[0] === '/' || v[0] === '~') ? v : null;
        }

        function build() {
            root.innerHTML =
                '<div class="fm-toolbar">' +
                  '<button type="button" class="icon-btn" data-action="up" aria-label="Up one folder" title="Up one folder"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3.5"/><path d="M4 7.5l4-4 4 4"/></svg></button>' +
                  '<button type="button" class="icon-btn" data-action="home" aria-label="Your home directory" title="Your home directory">' + homeGlyph() + '</button>' +
                  FB.markup.pathBar() +
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
                FB.markup.body({ drop: true, hint: mounted ? 'Drop files here to upload them' : 'Drop text files here to upload them' }) +
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
                '<dialog class="dialog" data-role="help-dialog" aria-labelledby="fm-help-title-' + n + '">' +
                  '<h3 class="dialog-title" id="fm-help-title-' + n + '">Files quick help</h3>' +
                  '<div class="dialog-body">' +
                    '<p>Browse the site in <code>/site</code>, or choose the home button to manage your own files in <code>~</code>. Select an entry to see its details; double-click or press Enter to open it.</p>' +
                    '<p>The Files menu and the Actions button offer commands for the current selection and folder. In your home directory you can create files and folders, upload text files, rename, move, and delete. Download saves a copy to your computer.</p>' +
                    '<p>Use View &gt; Files &gt; Show hidden files to reveal names starting with a dot. With the list focused, Backspace goes up a folder, F2 renames a selected personal file, and Delete asks before deleting it.</p>' +
                    '<p>On the public parkscomputing.com site, your personal file contents are never sent to the parkscomputing.com servers. Files keeps your data in this browser&apos;s local storage. Upload imports a text file into that local storage. Other browsers and devices do not share it; clearing site data removes it. Download important files for safekeeping.</p>' +
                    (mounted ? '<p>You are using the admin site. Its mounted home and server folders are server-backed; changes there are sent to the server.</p>' : '') +
                    '<p><a href="/page/files-guide" data-action="help-guide">Read the complete Files guide</a> for commands, storage limits, and troubleshooting.</p>' +
                  '</div>' +
                  '<div class="dialog-actions"><button type="button" class="btn btn-primary" data-action="help-close">Close</button></div>' +
                '</dialog>' +
                '<input type="file" multiple hidden data-role="file-input"' + (mounted ? '' : ' accept=".txt,.md,.json,.cells,.sudoku,.csv,.xfer,.sh,text/*"') + ' />';
            var q = function (sel) { return root.querySelector(sel); };
            el = {
                helpDialog: q('[data-role="help-dialog"]'), detail: q('[data-role="detail"]'), status: q('[data-role="status"]'), homeTools: q('[data-role="home-tools"]'),
                menu: q('[data-role="menu"]'), fileInput: q('[data-role="file-input"]'), main: q('[data-fb="main"]'),
                dialog: q('[data-role="dialog"]'), dlgForm: q('[data-role="dialog-form"]'), dlgTitle: q('[data-role="dialog-title"]'),
                dlgText: q('[data-role="dialog-text"]'), dlgInput: q('[data-role="dialog-input"]'), dlgError: q('[data-role="dialog-error"]'),
                dlgOk: q('[data-role="dialog-ok"]'), dlgCancel: q('[data-role="dialog-cancel"]'), up: q('[data-action="up"]')
            };
        }

        /* === State ====================================================== */

        function cwd() { return b.cwd(); }
        function stateString() { return 'path=' + encodeURIComponent(F.pathOf(cwd())).replace(/%2F/g, '/'); }
        function announce() {
            if (opts.ownsUrl) {
                var qs = new URLSearchParams(location.search);
                qs.set('path', F.pathOf(cwd()));
                history.replaceState(history.state, '', location.pathname + '?' + qs.toString().replace(/%2F/g, '/') + location.hash);
            }
            if (opts.changed) { opts.changed(stateString()); }
        }

        function say(msg, isError) {
            if (!el) { return; }
            el.status.textContent = msg || '';
            el.status.classList.toggle('fm-status-error', !!isError);
        }

        function inHome(node) { var r = F.realOf(node); return !!r.home; }
        function linkFor(node) { return (opts.pageUrl || '/page/files') + '?path=' + encodeURIComponent(F.pathOf(node)).replace(/%2F/g, '/'); }

        /* The address an entry has of its own, which its row's link names:
           a page or an applet on its page, a link where it points. A file
           has none, so its row opens through the browser's onOpen. */
        function addressOf(c) {
            var r = F.realOf(c), kind = F.kindOf(c);
            if (kind === 'page' || kind === 'app') { return F.mounted ? F.publicUrl(r) : '/page/' + encodeURIComponent(r.name); }
            if (kind === 'link') { return r.url; }
            return null;
        }

        /* === Around the browser ========================================= */

        /* The browser's first drawing comes before create() returns; the
           call after it covers that one. */
        function afterRender() {
            if (!b) { return; }
            var home = inHome(cwd());
            el.homeTools.hidden = !home;
            el.main.classList.toggle('fm-can-drop', home);
            el.up.disabled = !cwd().parent;
            renderDetail();
            renderMenu();
        }

        function renderDetail() {
            var c = b.selected(), dir = cwd();
            if (!c) {
                var count = (dir.children || []).length;
                el.detail.innerHTML = '<span class="fm-d-title">' + esc(F.displayPath(dir)) + '</span><span class="fm-d-meta">' + count + (count === 1 ? ' item' : ' items') +
                    (inHome(dir) ? (F.realOf(dir).server ? ' · on the server' : ' · your own files, kept in this browser') : ' · read-only') + '</span>';
                return;
            }
            var r = F.realOf(c), kind = F.kindOf(c), bits = [];
            var date = r.home ? r.mtime : r.date;
            if (date) { bits.push(FB.fmtDate(date)); }
            if (F.size(c) != null) { bits.push(FB.fmtSize(F.size(c))); }
            if (kind === 'dir') { bits.push((r.children || []).length + ' items'); }
            var desc = kind === 'script' ? F.scriptSummary(c.name, F.scriptSource(c)) : r.description;
            if (r.special === 'layouts') { desc = 'The barcode tool\'s layouts; edit it to change them.'; }
            if (kind === 'link') { desc = (desc ? desc + ' · ' : '') + r.url; }
            el.detail.innerHTML =
                '<span class="fm-d-title">' + FB.glyph(kind) + esc(r.title && !r.home ? r.title : c.name) + '</span>' +
                '<span class="fm-d-meta">' + esc(FB.kindName(kind)) + (bits.length ? ' · ' + esc(bits.join(' · ')) : '') + ' · <code>' + esc(F.displayPath(c)) + '</code></span>' +
                (desc ? '<span class="fm-d-desc">' + esc(desc) + '</span>' : '') +
                (r.tags && r.tags.length ? '<span class="fm-d-tags">' + r.tags.map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join(' ') + '</span>' : '');
        }

        /* The actions menu offers only what applies: changing ~ is not on
           offer outside it. */
        function actionItems() {
            if (!b || !F) { return []; }
            var items = [], c = b.selected(), home = inHome(cwd()), shell = canOpen('shell');
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
            items.push(['sep']);
            items.push(['hidden', showHidden ? 'Hide hidden files' : 'Show hidden files']);
            return items;
        }

        function renderMenu() {
            var items = actionItems(), html = '';
            items.forEach(function (it, i) {
                if (it[0] === 'sep') { if (html && i < items.length - 1 && items[i + 1][0] !== 'sep') { html += '<div class="menu-sep" role="separator"></div>'; } return; }
                html += '<button type="button" class="menu-action" data-action="' + it[0] + '">' + esc(it[1]) + '</button>';
            });
            el.menu.innerHTML = html;
            if (window.pudlMenubar) { window.pudlMenubar.refresh(); }
        }

        /* === Opening things ============================================== */

        var inWindows = function () { return opts.host === 'window' && window.pudlWindows; };

        /* Files and shells are asked for through PUDL's requests
           (pudlApplets.request): whichever applet serves the request
           answers, and an action with nothing to serve it is not offered. */
        function canOpen(verb, kind) { return window.pudlApplets.can(verb, kind); }
        function request(verb, req) { return window.pudlApplets.request(verb, req, root); }

        function openInEditor(node) {
            if (!request('open', { path: F.displayPath(F.realOf(node)), kind: F.kindOf(node) })) { say('Nothing on this site opens ' + node.name + '.', true); }
        }

        function openEntry(c) {
            var r = F.realOf(c), kind = F.kindOf(c);
            if (kind === 'dir') { b.go(c); b.focusList(); return; }
            if (kind === 'link') { window.open(r.url, '_blank', 'noopener'); return; }
            /* A built-in command, from /bin, is explained in a terminal. */
            if (kind === 'command') { openTerminal('man ' + r.name); return; }
            /* A picture or any other file an editor can't show: under
               /wwwroot it opens as the public site serves it; elsewhere it
               downloads. */
            if ((kind === 'file' || kind === 'script') && !F.isText(r)) {
                var seen = F.publicUrl(r);
                if (seen) { window.open(seen, '_blank', 'noopener'); } else { download(c); }
                return;
            }
            if (kind === 'file' || kind === 'script') { openInEditor(c); return; }
            if (F.mounted) { var url = F.publicUrl(r); if (url) { window.open(url, '_blank', 'noopener'); } return; }
            if (inWindows()) { window.pudlWindows.open(r.name); return; }
            location.assign('/page/' + encodeURIComponent(r.name));
        }

        function openTerminal(run) {
            if (!request('shell', { path: F.pathOf(cwd()), run: run })) { say('Nothing on this site opens a terminal.', true); }
        }

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
                    el.dlgCancel.removeEventListener('click', onCancel);
                    el.dialog.removeEventListener('close', onClose);
                }
                el.dlgForm.addEventListener('submit', onSubmit);
                el.dlgCancel.addEventListener('click', onCancel);
                el.dialog.addEventListener('close', onClose);
                el.dialog.showModal();
                if (withInput === false) { el.dlgOk.focus(); } else { el.dlgInput.focus(); el.dlgInput.select(); }
            });
        }

        function nameCheck(v) {
            if (!v) { return 'Give it a name.'; }
            if (!F.validName(v)) { return 'A name can\'t contain / or be . or ..'; }
            if (F.childNamed(cwd(), v)) { return 'Something called ' + v + ' is already here.'; }
            return null;
        }

        /* === Actions ====================================================== */

        async function act(action) {
            if (action === 'help') { el.helpDialog.showModal(); return; }
            if (action === 'help-close') { el.helpDialog.close(); return; }
            var c = b.selected(), dir = cwd();
            switch (action) {
                case 'up': b.up(); return;
                case 'home': b.go(F.home()); return;
                case 'open': if (c) { openEntry(c); } return;
                case 'edit': if (c) { openInEditor(c); } return;
                case 'run': if (c) { openTerminal(c.name); } return;
                case 'terminal': openTerminal(null); return;
                case 'hidden':
                    setHidden(!showHidden);
                    loadConfig().then(function (cfg) { return cfg.set('files', { hidden: showHidden }); }).catch(function () { });
                    return;
                case 'download': if (c) { download(c); } return;
                case 'copy': if (c) { await copyHome(c); } return;
                case 'new-file': {
                    var name = await prompt('New file', 'In ' + F.displayPath(dir), '', 'Create', nameCheck);
                    if (name == null) { return; }
                    var res = await F.write(dir, name, '', false);
                    if (res.error) { say(res.error, true); return; }
                    b.refresh(); b.select(name); say('Made ' + name + '.');
                    return;
                }
                case 'new-folder': {
                    var dname = await prompt('New folder', 'In ' + F.displayPath(dir), '', 'Create', nameCheck);
                    if (dname == null) { return; }
                    var e1 = await F.mkdir(dir, dname, false);
                    if (e1) { say(e1, true); return; }
                    b.refresh(); b.select(dname); say('Made ' + dname + '/.');
                    return;
                }
                case 'upload': el.fileInput.value = ''; el.fileInput.click(); return;
                case 'rename': {
                    if (!c) { return; }
                    var nn = await prompt('Rename', 'Rename ' + c.name + ' to:', c.name, 'Rename', function (v) { return v === c.name ? null : nameCheck(v); });
                    if (nn == null || nn === c.name) { return; }
                    var e2 = await F.move(dir, c, nn);
                    if (e2) { say(e2, true); return; }
                    b.refresh(); b.select(nn); say('Renamed to ' + nn + '.');
                    return;
                }
                case 'move': {
                    if (!c) { return; }
                    var dest = await prompt('Move', 'Move ' + c.name + ' to which folder? For example ~/notes', F.displayPath(dir), 'Move', function (v) {
                        var d = F.resolve(dir, v);
                        if (!d || !d.children) { return 'There\'s no folder at ' + v + '.'; }
                        if (!d.home) { return 'Only folders in your home directory (~)' + (F.mounted ? ' or under /wwwroot' : '') + ' can take it.'; }
                        return null;
                    });
                    if (dest == null) { return; }
                    var e3 = await F.move(dir, c, dest);
                    if (e3) { say(e3, true); return; }
                    b.refresh(); say('Moved ' + c.name + ' to ' + dest + '.');
                    return;
                }
                case 'delete': {
                    if (!c) { return; }
                    var many = c.children ? ' and everything in it (' + c.children.length + (c.children.length === 1 ? ' item' : ' items') + ')' : '';
                    var where = F.realOf(c).server ? '. A copy is kept in the history for 30 days.' : ' from this browser. It can\'t be undone.';
                    var ok = await prompt('Delete ' + c.name + '?', 'This deletes ' + F.displayPath(c) + many + where, '', 'Delete', null, false);
                    if (!ok) { return; }
                    var e4 = await F.remove(c, true);
                    if (e4) { say(e4, true); return; }
                    b.select(null, false); b.refresh(); say('Deleted ' + c.name + '.');
                    return;
                }
            }
        }

        async function download(c) {
            var r = F.realOf(c), blob;
            /* A server file downloads byte for byte; anything else as its text. */
            try {
                blob = r.server ? new Blob([await F.readBytes(r)], { type: 'application/octet-stream' })
                    : new Blob([await F.read(r)], { type: 'text/plain;charset=utf-8' });
            } catch (err) { say(err.message, true); return; }
            var name = r.home ? r.name : r.name + '.txt';
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
            say('Downloaded ' + name + '.');
        }

        async function copyHome(c) {
            var res = await F.copy(F.home(), c, '~/');
            if (res.error) { say(res.error, true); return; }
            say('Copied to ~/' + F.realOf(c).name + '.');
        }

        async function uploadFiles(files) {
            var dir = cwd();
            if (!inHome(dir)) { say('Files can only go into your home directory (~)' + (F.mounted ? ' or under /wwwroot.' : '.'), true); return; }
            var done = 0, errors = [];
            for (var i = 0; i < files.length; i++) {
                var res = await F.upload(dir, files[i]);
                if (res.error) { errors.push(res.error); } else { done++; }
            }
            b.refresh();
            say((done ? 'Uploaded ' + done + (done === 1 ? ' file.' : ' files.') : '') + (errors.length ? ' ' + errors.join('; ') : ''), errors.length > 0);
        }

        /* === Wiring ====================================================== */

        function onClick(e) {
            var a = e.target.closest('[data-action]');
            if (!a || !root.contains(a)) { return; }
            if (a.getAttribute('data-action') === 'help-guide') {
                el.helpDialog.close();
                if (inWindows()) { e.preventDefault(); window.pudlWindows.open('files-guide'); }
                return;
            }
            if (el.menu.contains(a) && el.menu.matches(':popover-open')) { el.menu.hidePopover(); }
            act(a.getAttribute('data-action'));
        }

        /* The file manager's own keys, beside the browser's. */
        function onKey(e, c) {
            if (!c || !inHome(c) || F.realOf(c).special) { return false; }
            if (e.key === 'Delete') { act('delete'); return true; }
            if (e.key === 'F2') { act('rename'); return true; }
            return false;
        }

        /* === Start ======================================================== */

        var showHidden = false, unConfig = null;

        /* Files' commands, for PUDL's window menu (0.32.0). On its own page
           its Actions menu already holds them, so it offers them only in a
           window, and PUDL adds no Commands button above it there. */
        function commands() {
            var list = [{ label: 'Show hidden files', run: function () { act('hidden'); }, checked: showHidden }];
            if (canOpen('shell')) { list.push({ label: 'Open a terminal here', run: function () { act('terminal'); } }); }
            return list;
        }
        /* Both menu surfaces use the same availability rules and actions. */
        function menuCommand(action, label) {
            return { label: label, run: function () { if (b) { return act(action); } } };
        }

        function menus() {
            var files = [menuCommand('up', 'Up one folder'), menuCommand('home', 'Your home directory')];
            files[0].disabled = !b || !cwd().parent;
            files[1].disabled = !b;
            var file = [], view = [];
            actionItems().forEach(function (it) {
                if (it[0] === 'terminal') {
                    file.push('-', menuCommand(it[0], it[1]));
                } else if (it[0] === 'hidden') {
                    var hidden = menuCommand('hidden', 'Show hidden files');
                    hidden.checked = showHidden;
                    view.push(hidden);
                } else if (it[0] === 'sep') {
                    if (file.length && file[file.length - 1] !== '-') { file.push('-'); }
                } else {
                    file.push(menuCommand(it[0], it[1]));
                }
            });
            if (file[file.length - 1] === '-') { file.pop(); }
            return { titles: [{ label: 'Files', items: window.pcAppletIdentity(root) },
                { id: 'file', label: 'File', items: file }], into: { go: files, view: view, help: [
                { label: 'Files quick help', disabled: !b, run: function () { if (el) { el.helpDialog.showModal(); } } },
                { label: 'Files guide', run: function () { if (inWindows()) { window.pudlWindows.open('files-guide'); } else { location.assign('/page/files-guide'); } } }
            ] } };
        }

        function setHidden(on) { showHidden = !!on; if (b) { b.showHidden(showHidden); renderMenu(); } }

        var boot = Promise.all([loadSiteFs().then(function (api) { F = api; return F.load(); }), loadBrowser()]).then(async function (got) {
            if (destroyed) { return; }
            FB = got[1];
            var cfg = await loadConfig().catch(function () { return null; }), treeWidth = null;
            if (cfg) {
                var fset = await cfg.load('files', { hidden: false, treeWidth: null }).catch(function () { return {}; });
                showHidden = !!fset.hidden;
                treeWidth = typeof fset.treeWidth === 'number' ? fset.treeWidth : null;
                unConfig = cfg.onChange('files', function (s) {
                    if (!!s.hidden !== showHidden) { setHidden(s.hidden); }
                    if (b) { b.treeWidth(typeof s.treeWidth === 'number' ? s.treeWidth : null); }
                });
            }
            if (destroyed) { return; }
            build();
            root.addEventListener('click', onClick);
            el.fileInput.addEventListener('change', function () { if (el.fileInput.files && el.fileInput.files.length) { uploadFiles(Array.prototype.slice.call(el.fileInput.files)); } });
            b = FB.create(root, F, {
                start: F.upgradePath(startPath),
                linkFor: linkFor,
                addressOf: addressOf,
                draggable: true,
                onUpload: uploadFiles,
                onOpen: openEntry,
                onSelect: function () { renderDetail(); renderMenu(); },
                onNavigate: announce,
                onRender: afterRender,
                onKey: onKey,
                say: say,
                showHidden: showHidden,
                treeWidth: treeWidth,
                onResize: function (w) { if (cfg) { cfg.set('files', { treeWidth: w }); } },
                emptyText: function (dir) { return inHome(dir) ? 'This folder is empty. Make a file or a folder, or drop files here.' : 'This folder is empty.'; }
            });
            afterRender();
            announce();
            if (opts.ownsUrl || root.closest('.win.active')) { b.focusList(); }
        }).catch(function (err) {
            if (destroyed) { return; }
            root.innerHTML = '<p class="fm-failed">Files could not start: ' + esc(err.message) + '.</p>';
        });

        return {
            state: function () { return b && F ? stateString() : null; },
            /* A folder handed over, by a browse request or a preset. */
            setState: function (s) { var p = pathFrom(s); if (b && p) { if (b.goPath(F.upgradePath(p))) { b.focusList(); } } },
            commands: root.closest('.win') ? commands : undefined,
            menus: menus,
            destroy: function () {
                destroyed = true;
                if (unConfig) { unConfig(); }
                if (b) { b.destroy(); }
                root.removeEventListener('click', onClick);
                if (el && el.helpDialog.open) { el.helpDialog.close(); }
                if (el && el.dialog.open) { el.dialog.close(); }
            },
            ready: boot
        };
    }

    window.pudlApplets.register('files', { init: init });
})();
