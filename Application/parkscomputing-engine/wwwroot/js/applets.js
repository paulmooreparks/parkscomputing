
/* PUDL WORKAROUND (Architecture/pudl-proposal-applet-actions.md): an
   applet's define() may point to a manifest of the actions it publishes,
   actions: '/js/actions/x.json', which the action broker
   (js/applet-actions.js, Architecture/applet-platform-design.md, P2) reads.
   PUDL keeps its definitions to itself, so this notes each applet's
   manifest, stamped with its ver, and its handles and page for the broker,
   before PUDL's own define() sees it. Delete it when PUDL keeps actions
   and gives the broker a way to read them. A manifest or its module
   changing bumps the applet's ver, like its script. */
window.pcAppletActions = [];
(function () {
    var define = pudlApplets.define;
    pudlApplets.define = function (name, cfg) {
        if (cfg && cfg.actions) {
            window.pcAppletActions.push({ applet: name, manifest: cfg.actions + (cfg.ver ? '?v=' + encodeURIComponent(cfg.ver) : ''), handles: cfg.handles || null, page: cfg.page || null });
        }
        return define.apply(this, arguments);
    };
})();
/* The broker loads when something asks for it: the Terminal's applets
   command, a script, and later the desktop's MCP queue. Raise its v on every
   change. The page's own actions, a notice and a question for the person at
   it, belong to no applet. */
window.pcActionsSrc = '/js/applet-actions.js?v=3';
window.pcAppletActions.push({ applet: null, manifest: '/js/actions/page.json?v=1', handles: null, page: null });

/* Identity actions use PUDL's documented capability snapshots. */
pudlApplets.define('account', { src: '/js/account.js', css: '/css/account.css', page: '/account', ver: '20' });
/* The Pin manager, reached from the Pins menu's Manage pins (js/pins.js). */
pudlApplets.define('pins', { src: '/js/pins-manager.js', css: '/css/pins-manager.css', page: '/pins', ver: '2' });
/* An article's discussion, under the article in both views and at
   /comments/{slug}, and the moderators' queue (Architecture/unified-identity-design.md, step 2). */
pudlApplets.define('comments', { src: '/js/comments.js', css: '/css/comments.css', ver: '4' });
pudlApplets.define('moderation', { src: '/js/moderation.js', css: '/css/comments.css', page: '/moderation', ver: '3' });
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
pudlApplets.define('sudoku', {
    src: '/js/sudoku.js',
    css: '/css/sudoku.css',
    page: '/page/sudoku',
    ver: '19',
    actions: '/js/actions/sudoku.json'
});

/* Conway's page is its article, so the links shared since 2015 keep
   working and the applet may keep its state in that address; the game
   alone lives at /page/conway. */
pudlApplets.define('conway', {
    src: '/js/conway.js',
    css: '/css/conway.css',
    page: '/page/conways-game-of-life',
    ver: '7'
});

/* The barcode tool and the flash cards each load barcode-engine.js beside
   themselves, with their own version, so a change to the engine bumps
   both of them. */
pudlApplets.define('barcodes', {
    src: '/js/barcode-tool.js',
    css: '/css/barcode-tool.css',
    page: '/page/barcodes',
    ver: '31',
    actions: '/js/actions/barcode.json'
});

pudlApplets.define('flashcards', {
    src: '/js/flashcards.js',
    css: '/css/flashcards.css',
    page: '/page/flashcards',
    ver: '8'
});

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
window.pcSiteFsSrc = '/js/sitefs.js?v=8';

/* The file browser Files, the editor and the barcode tool share (js/filebrowser.js), with its
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
    ver: '40',
    handles: { shell: { param: 'cwd', extra: ['run'], reuse: false } },
    actions: '/js/actions/terminal.json',
    instances: 4
});

/* Files and the editor use the same site filesystem as the terminal. */
pudlApplets.define('files', {
    src: '/js/files.js',
    css: '/css/files.css',
    page: pcWorkspacePages + 'files',
    ver: '24',
    handles: { browse: { param: 'path' } },
    actions: '/js/actions/files.json'
});

/* The editor loads CodeMirror 6 from js/vendor beside itself. */
pudlApplets.define('editor', {
    src: '/js/editor.js',
    css: '/css/editor.css',
    page: pcWorkspacePages + 'editor',
    ver: '30',
    handles: { open: { param: 'file', kinds: ['file', 'script', 'page'] } },
    actions: '/js/actions/editor.json'
});

/* The admin desktop's Settings (Architecture/admin-and-identity-design.md,
   A12 and A14): new windows, the theme, the background, the file tree and
   the sign-in timeouts. Each tool keeps its own settings; these are the
   desktop's. */
pudlApplets.define('settings', {
    src: '/js/settings.js',
    css: '/css/settings.css',
    page: pcWorkspacePages + 'settings',
    ver: '19'
});

/* The scanner shares the engine and layout library with the Barcode Tool. */
pudlApplets.define('barcode-scanner', {
    src: '/js/barcode-scanner.js',
    css: '/css/barcode-scanner.css',
    page: '/page/barcode-scanner',
    ver: '19'
});

pudlApplets.define('dice', {
   src: '/js/dice.js',
   css: '/css/dice.css',
   page: '/page/dice',
   ver: '3',
   actions: '/js/actions/dice.json'
});

/* Sight Reader loads OpenSheetMusicDisplay from js/vendor when it opens
   (Architecture/sight-reader-design.md). It opens the kind "score", a
   sample score's path under content/scores, which nothing else opens, so
   a request to open a file still goes to the editor. */
pudlApplets.define('sight-reader', {
   src: '/js/sight-reader.js',
   css: '/css/sight-reader.css',
   page: '/page/sight-reader',
   ver: '32',
   handles: { open: { param: 'score', kinds: ['score'] } },
   actions: '/js/actions/sight-reader.json'
});

pudlApplets.define('theme-studio', {
   src: '/js/theme-studio.js',
   css: '/css/theme-studio.css',
   page: '/page/theme-studio',
   ver: '8'
});

pudlApplets.define('diff', {
   src: '/js/diff.js',
   css: '/css/diff.css',
   page: '/page/diff',
   ver: '5'
});

/* What an installed applet package gets from this site
   (Architecture/applet-packages-design.md): the kit's menu helpers
   (js/pudl-host-kit.js, loaded before this file), where applet pages are,
   the snapshot service, and the site filesystem and settings files as
   paths and text, each loading when first asked. The packages' define()
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
    function fs() { return siteFs().then(function (f) { return f.load().then(function () { return f; }); }); }
    window.pudlHost = kit.host({
        pages: pcWorkspacePages,
        snapshot: window.pcSnapshot || null,
        fs: {
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
