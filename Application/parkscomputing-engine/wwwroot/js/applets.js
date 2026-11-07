
/* Applet actions are PUDL's (pudl-actions.js, 0.68.0): an applet's define()
   names its manifest with actions: '/js/actions/x.json', and PUDL's broker
   reads it from pudlApplets.definitions(), stamped with the applet's ver,
   so a manifest or its module changing bumps the applet's ver, like its
   script. The site's capabilities and the page's own actions are in
   js/site-actions.js. */

/* The applets' action manifests, read once for whoever lists them (the
   chat's @ menu): each as { id, title, description, manifest, actions },
   with the manifest's address, which the chat gives the model. */
var appletManifests = (function () {
    var loaded = null;
    return function () {
        if (loaded) { return loaded; }
        var defs = pudlApplets.definitions ? pudlApplets.definitions() : {};
        loaded = Promise.all(Object.keys(defs).filter(function (n) { return defs[n].actions; }).map(function (n) {
            var d = defs[n], url = d.actions + (d.ver ? (d.actions.indexOf('?') < 0 ? '?' : '&') + 'v=' + encodeURIComponent(d.ver) : '');
            return fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (m) {
                if (!m || !m.actions) { return null; }
                return { id: m.id || n, title: m.title || n, description: m.description || '', manifest: url,
                    actions: (m.actions || []).map(function (a) { return { ref: a.ref, title: a.title || a.ref, description: a.description || '' }; }) };
            }, function () { return null; });
        })).then(function (list) { return list.filter(Boolean).sort(function (a, b) { return a.title.localeCompare(b.title); }); });
        return loaded;
    };
})();

/* Identity actions use PUDL's documented capability snapshots. */
pudlApplets.define('account', { src: '/js/account.js', css: '/css/account.css', page: '/account', ver: '21' });
/* An article's discussion, under the article in both views and at
   /comments/{slug}, and the moderators' queue (Architecture/unified-identity-design.md, step 2). */
pudlApplets.define('comments', { src: '/js/comments.js', css: '/css/comments.css', ver: '5' });
pudlApplets.define('moderation', { src: '/js/moderation.js', css: '/css/comments.css', page: '/moderation', ver: '4' });
/* The super-user's Server log (Identity/RecentLogs.cs). */
pudlApplets.define('logs', { src: '/js/logs.js', css: '/css/logs.css', page: '/logs', ver: '1' });
/* Visits, the automated readers the site counts, for its staff
   (Identity/VisitReport.cs). Its panel brings its own rules, so it has no
   stylesheet. */
pudlApplets.define('visits', { src: '/js/visits.js', page: '/visits', ver: '1' });
window.pcAppletIdentity = function (root, entries) {
    var result = (entries || []).slice(), win = root.closest('[data-win]');
    if (win && window.pudlWindows) {
        var commands = window.pudlWindows.menuCommands(win.getAttribute('data-win'));
        ['page', 'copy-link', 'close'].forEach(function (id) {
            var command = commands.find(function (c) { return c.id === id; });
            if (!command) { return; }
            if (result.length && (id === 'page' || id === 'close')) { result.push('-'); }
            /* Close window is not marked as a danger here, as it is not in
               PUDL's own identity menu for an article: closing a window loses
               nothing, and the window menu's Close keeps PUDL's own mark. */
            result.push(Object.assign({}, command, {
                label: id === 'page' ? 'Open as a page' : id === 'copy-link' ? 'Copy link to this applet' : 'Close window'
            }, id === 'close' ? { danger: false } : {}));
        });
    } else if (navigator.clipboard) {
        if (result.length) { result.push('-'); }
        result.push({ label: 'Copy link to this applet', run: function () {
            return navigator.clipboard.writeText(location.href).catch(function () {
                window.alert('The link could not be copied. Copy the address from your browser.');
            });
        } });
    }
    return result;
};

/* Surface controls and menus share the same availability and action. */
window.pcAppletAction = function (root, selector, label) {
    var button = root.querySelector(selector);
    return { label: label, disabled: !button || button.disabled, run: function () {
        if (root.isConnected && button && !button.disabled) { button.click(); }
    } };
};
/* The site's applet registry (PUDL 0.20.0): each applet's files are named
   once here, and a mount anywhere on the site needs only
   data-applet="name". Bump ver on EVERY change to an applet's script or
   stylesheet, in the same commit, or readers keep the cached copy; the
   runtime appends it to both as ?v=. Loaded with defer after
   pudl-applets.js. */
/* Sudoku is an installed applet package (wwwroot/applets/sudoku, from the
   pudl-sudoku repo), which /applets/registry.js defines; its page is still
   content/sudoku.html, for the web-app manifest it links. Conway (pudl-
   conway), Dice (pudl-dice), the Theme Studio and the Diff Viewer
   (pudl-tools) are packages too. Conway's article keeps the address its
   links have used since 2015 by naming itself as the mount's page
   (data-applet-page); the game alone lives at /page/conway. */

/* The Barcode Tool, the Barcode Scanner and the flash cards are installed
   applet packages (wwwroot/applets, from the pudl-barcodes repo), which
   /applets/registry.js defines; their pages are still in content/. */

/* The terminal loads xterm.js from js/vendor beside itself, and the files
   of extra JavaScript commands listed here, each with the terminal's own
   version, so a change to one of them bumps the terminal's ver. Scripts
   need no listing: they live in content/bin. terminal-lua.js and
   terminal-sh.js are the script languages beside the terminal's own, Lua
   5.4 and a POSIX shell (Architecture/applet-platform-design.md, P1); their
   workers and WebAssembly load only when a script in that language runs. */
window.pcTerminalCommands = ['/js/terminal-text.js', '/js/terminal-lua.js', '/js/terminal-sh.js'];
/* On the edit origin the page names ssh and ssh-key as well, which the
   server sends to a signed-in admin only (A16); elsewhere they don't exist. */
(function () {
    var ssh = document.querySelector('meta[name="pc-ssh-commands"]');
    if (ssh && ssh.content) { window.pcTerminalCommands.push(ssh.content); }
})();

/* The site filesystem the terminal, the file manager and the editor share
   (js/sitefs.js). Every applet loads it from this one address, so a page
   holds one copy; raise its v on every change to the file. */
window.pcSiteFsSrc = '/js/sitefs.js?v=9';

/* The file browser Files, the editor and installed packages share (js/filebrowser.js), with its
   stylesheet; like the site filesystem, one copy a page, and a raised v on
   every change to either. */
window.pcFileBrowserSrc = '/js/filebrowser.js?v=9';
window.pcFileBrowserCss = '/css/filebrowser.css?v=8';

/* The settings files in ~/.config (js/config.js), which each applet with
   settings of its own reads and writes; one copy a page, like the above. */
window.pcConfigSrc = '/js/config.js?v=2';

/* The desktop's background (js/desktop-background.js), which the window
   view and Settings draw; one copy a page, like the above. */
window.pcDesktopBackgroundSrc = '/js/desktop-background.js?v=1';

/* Where the terminal, Files and the editor have their pages: /page/ on the
   public site, and on the edit origin the admin workspace's, which its
   layout names in <meta name="pc-applet-pages">. */
var pcWorkspacePages = (document.querySelector('meta[name="pc-applet-pages"]') || {}).content || '/page/';

/* The terminal, Files and the editor ask each other for things through
   PUDL's requests (0.27.0), never by name: open a file, browse a folder,
   or give a shell in one. param is the state parameter the path travels
   in, kinds limits a request to those kinds of entry, extra names further
   parameters it may carry, and reuse: false gives each request a new
   instance, up to instances of them. A request reaches a running applet
   through its setState(). */
pudlApplets.define('terminal', {
    src: '/js/terminal.js',
    css: '/css/terminal.css',
    page: pcWorkspacePages + 'terminal',
    ver: '43',
    handles: { shell: { param: 'cwd', extra: ['run'], reuse: false } },
    actions: '/js/actions/terminal.json',
    instances: 4,
    /* A restored terminal window behind others starts once the windows in
       view are ready (PUDL 0.66.0), since xterm and a session are heavy. */
    start: 'idle'
});

/* Files and the editor use the same site filesystem as the terminal. */
pudlApplets.define('files', {
    src: '/js/files.js',
    css: '/css/files.css',
    page: pcWorkspacePages + 'files',
    ver: '31',
    handles: { browse: { param: 'path' } },
    actions: '/js/actions/files.json'
});

/* The editor loads CodeMirror 6 from js/vendor beside itself. */
pudlApplets.define('editor', {
    src: '/js/editor.js',
    css: '/css/editor.css',
    page: pcWorkspacePages + 'editor',
    ver: '42',
    handles: { open: { param: 'file', kinds: ['file', 'script', 'page'] } },
    actions: '/js/actions/editor.json',
    /* CodeMirror and the documents load once the windows in view are ready. */
    start: 'idle'
});

/* The admin desktop's Settings (Architecture/admin-and-identity-design.md,
   A12 and A14): new windows, the theme, the background, the file tree and
   the sign-in timeouts. Each tool keeps its own settings; these are the
   desktop's. */
pudlApplets.define('settings', {
    src: '/js/settings.js',
    css: '/css/settings.css',
    page: pcWorkspacePages + 'settings',
    ver: '22'
});

/* Sight Reader is an installed applet package too (pudl-sight-reader). It
   opens the kind "score", a sample score's path, which nothing else opens,
   so a request to open a file still goes to the editor; the site's own
   scores in content/scores reach it as the service score-library below. */


/* What an installed applet package gets from this site
   (Architecture/applet-packages-design.md): the kit's menu helpers
   (js/pudl-host-kit.js, loaded before this file), where applet pages are,
   the snapshot service, the site filesystem and settings files as paths
   and text with the site's Open and Save as dialogs, each loading when
   first asked, and the product lookup's proxy as a named service. The
   packages' define()
   calls follow in /applets/registry.js. */
(function () {
    var kit = window.pudlHostKit;
    if (!kit) { return; }
    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error(src + ' did not load')); };
            document.head.appendChild(s);
        });
    }
    /* A shared script's global, loading the script the first time. */
    function shared(src, name) {
        var loading = null;
        return function () {
            if (!loading) { loading = (window[name] ? Promise.resolve() : loadScript(src)).then(function () { return window[name]; }); }
            return loading;
        };
    }
    var siteFs = shared(window.pcSiteFsSrc, 'pcSiteFs'), config = shared(window.pcConfigSrc, 'pcConfig');
    var fileBrowser = shared(window.pcFileBrowserSrc, 'pcFileBrowser');
    function fs() { return siteFs().then(function (f) { return f.load().then(function () { return f; }); }); }
    function withDialog() { return Promise.all([fs(), fileBrowser()]); }
    function isText(blob) { return /^text\/|json|xml|javascript/.test(blob.type || 'text/plain'); }
    window.pudlHost = kit.host({
        pages: pcWorkspacePages,
        snapshot: window.pcSnapshot || null,
        /* The product lookup's proxy (Controllers/BarcodeProductsController.cs). */
        services: { 'barcode-products': '/api/barcode-products/', 'score-library': '/api/score-library/', 'chat': '/api/admin/chat/', 'poker': '/api/admin/poker/' },
        /* PUDL's action broker, which runs an applet's action here,
           opening its window where it needs one. The chat acts for the
           person at the page, whose server already asks them before a
           tool that writes, so it holds every capability. */
        actions: {
            run: function (ref, input) {
                if (!pudlApplets.run) { return Promise.reject(new Error('the page has no action broker')); }
                return pudlApplets.run(ref, input, { owner: { kind: 'chat' }, grant: 'all' });
            }
        },
        /* A request from the site's pages carries the token the server
           checks against forgery on anything but a read. */
        fetch: function (url, init) {
            init = Object.assign({ credentials: 'same-origin' }, init || {});
            var method = (init.method || 'GET').toUpperCase();
            if (method !== 'GET' && method !== 'HEAD') {
                var token = (document.querySelector('meta[name="request-verification-token"]') || {}).content || '';
                init.headers = Object.assign({}, init.headers || {}, { RequestVerificationToken: token });
            }
            return window.fetch(url, init);
        },
        fs: {
            /* The site's own Open and Save as (js/filebrowser.js). A
               reader's ~ in this browser keeps text only, so there a
               picture is offered as a download. */
            open: function (o) {
                o = o || {};
                return withDialog().then(function (x) {
                    var F = x[0], FB = x[1];
                    return FB.pick(F, {
                        mode: 'open', title: o.title, host: o.host, start: o.start || '~', accept: o.accept || [], computer: true,
                        check: function (node) {
                            if (!F.isText(node)) { return node.name + ' isn\'t a text file.'; }
                            return o.check ? o.check(F.displayPath(node)) : null;
                        }
                    }).then(function (res) {
                        if (!res) { return null; }
                        if (res.file) { return res.file.text().then(function (text) { return { name: res.file.name, text: text }; }); }
                        return F.read(res.node).then(function (text) { return { path: res.path, name: res.node.name, text: text }; });
                    });
                });
            },
            save: function (o) {
                o = o || {};
                var blob = o.blob, text = isText(blob);
                return withDialog().then(function (x) {
                    var F = x[0], FB = x[1];
                    return FB.pick(F, {
                        mode: 'save', title: o.title, name: o.name, host: o.host, start: o.start || '~', computer: true,
                        canSaveIn: text ? null : function (dir) { return dir.server ? null : 'Pictures can\'t be kept in ~ in this browser, which holds only text. Download it instead.'; }
                    }).then(function (res) {
                        if (!res) { return null; }
                        if (res.download) { return { download: res.download }; }
                        var refused = o.check && o.check(res.path);
                        if (refused) { throw new Error(refused); }
                        var written = text ? blob.text().then(function (t) { return F.write(null, res.path, t, false); })
                            : F.upload(res.dir, new File([blob], res.name, { type: blob.type }));
                        return written.then(function (out) {
                            if (out && out.error) { throw new Error(out.error); }
                            return { path: res.path };
                        });
                    });
                });
            },
            onChange: function (fn) {
                var off = null, gone = false;
                siteFs().then(function (f) { if (!gone) { off = f.onChange(function () { fn(); }); } });
                return function () { gone = true; if (off) { off(); } };
            },
            /* The applets with published actions, the files and the pages
               whose names hold the words; the applets first, then the
               reader's own files. An applet comes with its manifest's
               address, so a chat can give the model the actions it offers. */
            find: function (query, limit) {
                var words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean), max = limit || 40;
                return Promise.all([fs(), appletManifests()]).then(function (got) {
                    var F = got[0], out = [];
                    got[1].forEach(function (m) {
                        var text = (m.title + ' ' + m.id + ' ' + (m.description || '') + ' ' + m.actions.map(function (a) { return a.title + ' ' + a.ref; }).join(' ')).toLowerCase();
                        if (words.every(function (w) { return text.indexOf(w) >= 0; })) {
                            out.push({ path: m.id, name: m.title, kind: 'applet', description: m.description || m.actions.map(function (a) { return a.title; }).join(' · '), manifest: m.manifest });
                        }
                    });
                    var applets = out; out = [];
                    (function walk(n, depth) {
                        if (out.length >= max || depth > 12) { return; }
                        (n.children || []).forEach(function (c) {
                            var r = F.realOf(c), kind = F.kindOf(c), name = c.name || '';
                            if (name.charAt(0) === '.' && name !== '.config') { return; }
                            var text = (name + ' ' + (c.title || '')).toLowerCase();
                            if ((kind === 'file' || kind === 'page' || kind === 'script') && words.every(function (w) { return text.indexOf(w) >= 0; })) {
                                out.push({ path: F.displayPath(c), name: c.title || name, kind: kind === 'page' ? 'page' : 'file' });
                            }
                            if (r.children && out.length < max) { walk(r, depth + 1); }
                        });
                    })(F.root(), 0);
                    out.sort(function (a, b) { return (a.path.indexOf('~/') === 0 ? 0 : 1) - (b.path.indexOf('~/') === 0 ? 0 : 1) || a.path.localeCompare(b.path); });
                    return applets.concat(out).slice(0, max);
                });
            },
            readText: function (path) {
                return fs().then(function (f) { var n = f.resolve(null, path); return n && !n.children ? f.read(n) : null; });
            },
            writeText: function (path, text) {
                return fs().then(function (f) {
                    var sp = f.splitPath(path);
                    var made = sp.dir && !f.resolve(null, sp.dir) ? f.mkdir(null, sp.dir, true) : Promise.resolve(null);
                    return made.then(function (err) { return err ? err : f.write(null, path, text, false).then(function (r) { return r.error || null; }); });
                });
            },
            mkdir: function (path) { return fs().then(function (f) { return f.mkdir(null, path, true); }); }
        },
        config: {
            load: function (name, defaults) { return config().then(function (c) { return c.load(name, defaults); }); },
            get: function (name) { return window.pcConfig ? window.pcConfig.get(name) : null; },
            set: function (name, changes) { return config().then(function (c) { return c.set(name, changes); }); },
            onChange: function (name, fn) {
                var off = null, gone = false;
                config().then(function (c) { if (!gone) { off = c.onChange(name, fn); } });
                return function () { gone = true; if (off) { off(); } };
            }
        }
    });
})();
