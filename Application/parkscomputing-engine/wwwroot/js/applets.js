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
    ver: '11'
});

pudlApplets.define('flashcards', {
    src: '/js/flashcards.js',
    css: '/css/flashcards.css',
    page: '/page/flashcards',
    ver: '5'
});

/* The terminal loads xterm.js from js/vendor beside itself. */
pudlApplets.define('terminal', {
    src: '/js/terminal.js',
    css: '/css/terminal.css',
    page: '/page/terminal',
    ver: '4'
});
