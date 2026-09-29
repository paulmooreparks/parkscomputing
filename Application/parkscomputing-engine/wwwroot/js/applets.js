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
    ver: '15'
});

/* Conway's page is its article, so the links shared since 2015 keep
   working and the applet may keep its state in that address; the game
   alone lives at /page/conway. */
pudlApplets.define('conway', {
    src: '/js/conway.js',
    css: '/css/conway.css',
    page: '/page/conways-game-of-life',
    ver: '6'
});

/* The barcode tool and the flash cards each load barcode-engine.js beside
   themselves, with their own version, so a change to the engine bumps
   both of them. */
pudlApplets.define('barcodes', {
    src: '/js/barcode-tool.js',
    css: '/css/barcode-tool.css',
    page: '/page/barcodes',
    ver: '13'
});

pudlApplets.define('flashcards', {
    src: '/js/flashcards.js',
    css: '/css/flashcards.css',
    page: '/page/flashcards',
    ver: '6'
});

/* The terminal loads xterm.js from js/vendor beside itself, and the files
   of extra JavaScript commands listed here, each with the terminal's own
   version, so a change to one of them bumps the terminal's ver. Scripts
   (files of commands) need no listing: they live in content/bin. */
window.pcTerminalCommands = ['/js/terminal-text.js'];

/* The site filesystem the terminal, the file manager and the editor share
   (js/sitefs.js). Every applet loads it from this one address, so a page
   holds one copy; raise its v on every change to the file. */
window.pcSiteFsSrc = '/js/sitefs.js?v=1';

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
    page: '/page/terminal',
    ver: '19',
    handles: { shell: { param: 'cwd', extra: ['run'], reuse: false } },
    instances: 4
});

/* Files and the editor use the same site filesystem as the terminal. */
pudlApplets.define('files', {
    src: '/js/files.js',
    css: '/css/files.css',
    page: '/page/files',
    ver: '7',
    handles: { browse: { param: 'path' } }
});

/* The editor loads CodeMirror 6 from js/vendor beside itself. */
pudlApplets.define('editor', {
    src: '/js/editor.js',
    css: '/css/editor.css',
    page: '/page/editor',
    ver: '4',
    handles: { open: { param: 'file', kinds: ['file', 'script', 'page'] } }
});
