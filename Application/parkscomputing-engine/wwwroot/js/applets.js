
/* Identity actions use PUDL's documented capability snapshots. */
pudlApplets.define('account', { src: '/js/account.js', css: '/css/account.css', page: '/account', ver: '15' });
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
    ver: '19'
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
    ver: '31'
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
   (files of commands) need no listing: they live in content/bin. */
window.pcTerminalCommands = ['/js/terminal-text.js'];
/* On the edit origin the page names ssh and ssh-key as well, which the
   server sends to a signed-in admin only (A16); elsewhere they don't exist. */
(function () {
    var ssh = document.querySelector('meta[name="pc-ssh-commands"]');
    if (ssh && ssh.content) { window.pcTerminalCommands.push(ssh.content); }
})();

/* The site filesystem the terminal, the file manager and the editor share
   (js/sitefs.js). Every applet loads it from this one address, so a page
   holds one copy; raise its v on every change to the file. */
window.pcSiteFsSrc = '/js/sitefs.js?v=7';

/* The file browser Files, the editor and the barcode tool share (js/filebrowser.js), with its
   stylesheet; like the site filesystem, one copy a page, and a raised v on
   every change to either. */
window.pcFileBrowserSrc = '/js/filebrowser.js?v=8';
window.pcFileBrowserCss = '/css/filebrowser.css?v=7';

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
    ver: '37',
    handles: { shell: { param: 'cwd', extra: ['run'], reuse: false } },
    instances: 4
});

/* Files and the editor use the same site filesystem as the terminal. */
pudlApplets.define('files', {
    src: '/js/files.js',
    css: '/css/files.css',
    page: pcWorkspacePages + 'files',
    ver: '23',
    handles: { browse: { param: 'path' } }
});

/* The editor loads CodeMirror 6 from js/vendor beside itself. */
pudlApplets.define('editor', {
    src: '/js/editor.js',
    css: '/css/editor.css',
    page: pcWorkspacePages + 'editor',
    ver: '23',
    handles: { open: { param: 'file', kinds: ['file', 'script', 'page'] } }
});

/* The admin desktop's Settings (Architecture/admin-and-identity-design.md,
   A12 and A14): new windows, the theme, the background, the file tree and
   the sign-in timeouts. Each tool keeps its own settings; these are the
   desktop's. */
pudlApplets.define('settings', {
    src: '/js/settings.js',
    css: '/css/settings.css',
    page: pcWorkspacePages + 'settings',
    ver: '15'
});

/* The scanner shares the engine and layout library with the Barcode Tool. */
pudlApplets.define('barcode-scanner', {
    src: '/js/barcode-scanner.js',
    css: '/css/barcode-scanner.css',
    page: '/page/barcode-scanner',
    ver: '15'
});

pudlApplets.define('dice', {
   src: '/js/dice.js',
   css: '/css/dice.css',
   page: '/page/dice',
   ver: '3'
});

/* Sight Reader loads OpenSheetMusicDisplay from js/vendor when it opens
   (Architecture/sight-reader-design.md). */
pudlApplets.define('sight-reader', {
   src: '/js/sight-reader.js',
   css: '/css/sight-reader.css',
   page: '/page/sight-reader',
   ver: '15'
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
