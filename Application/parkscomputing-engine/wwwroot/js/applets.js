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
    ver: '13'
});

/* Conway's page is its article, so the links shared since 2015 keep
   working and the applet may keep its state in that address; the game
   alone lives at /page/conway. */
pudlApplets.define('conway', {
    src: '/js/conway.js',
    css: '/css/conway.css',
    page: '/page/conways-game-of-life',
    ver: '3'
});

pudlApplets.define('flashcards', {
    src: '/js/flashcards.js',
    css: '/css/flashcards.css',
    page: '/page/flashcards',
    ver: '2'
});
