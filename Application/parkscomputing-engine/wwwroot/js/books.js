/* Books in the window view (Architecture/books-design.md). A book is one
   window that turns its pages: a click on a chapter, in its contents or on
   its Previous and Next links, fetches that chapter into the same window,
   and the address records it as c.{key}, so Back returns to the chapter
   before and a bookmark or a reload brings the window back where it was.

   Shift+click opens the chapter in another window of the same book
   (maize-2, maize-3 …), as Shift+click opens a new browser window, and the
   window menu offers the same. Ctrl+click, a middle click or any link
   without script go to the chapter's own page, which is a page like any
   other.

   On a classic page the contents start folded on a phone. */
(function () {
    'use strict';

    function plainClick(e) { return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.altKey; }
    function query() { return new URLSearchParams(location.search); }
    function chapterIn(win) { var b = win.querySelector('.book'); return b ? b.getAttribute('data-book-current') || '' : null; }
    function bookOf(win) { var b = win.querySelector('.book'); return b ? b.getAttribute('data-book') : null; }

    /* The address with one window's chapter set, or removed for the book's
       main page; everything else in it is kept as it is. */
    function addressWith(key, chapter) {
        var q = query();
        if (chapter) { q.set('c.' + key, chapter); } else { q.delete('c.' + key); }
        var s = q.toString().replace(/%2F/g, '/').replace(/%2C/g, ',');
        return location.pathname + (s ? '?' + s : '') + location.hash;
    }

    /* Fetches a chapter into a window, in place. */
    function turn(win, key, chapter, how) {
        return fetch('/window/' + encodeURIComponent(key) + (chapter ? '?c=' + encodeURIComponent(chapter).replace(/%2F/g, '/') : ''), { credentials: 'same-origin' })
            .then(function (r) { if (!r.ok) { throw new Error(r.status); } return r.text(); })
            .then(function (html) {
                var doc = new DOMParser().parseFromString(html, 'text/html');
                var fresh = doc.querySelector('.win .win-body'), page = doc.querySelector('.win .win-head [data-win-action="page"]');
                var body = win.querySelector('.win-body');
                if (!fresh || !body) { return; }
                body.innerHTML = fresh.innerHTML;
                body.scrollTop = 0;
                var mine = win.querySelector('.win-head [data-win-action="page"]');
                if (mine && page) { mine.setAttribute('href', page.getAttribute('href')); }
                if (how === 'push') { history.pushState(history.state, '', addressWith(key, chapter)); }
                else if (how === 'replace') { history.replaceState(history.state, '', addressWith(key, chapter)); }
                enhance(win);
                /* The window view keeps the arrangement, chapters and all. */
                document.dispatchEvent(new CustomEvent('pc:book-turn'));
            });
    }

    function enhance(win) {
        var tree = win.querySelector('.book-tree');
        if (tree && window.pudlTree && window.pudlTree.enhance) { window.pudlTree.enhance(tree); }
        if (window.pcEnhanceWindow) { window.pcEnhanceWindow(win); }
    }

    /* Another window of the same book, the first number not in use. */
    function openCopy(book, chapter) {
        if (!window.pudlWindows) { return false; }
        var open = window.pudlWindows.state().open, key = null;
        for (var n = 2; n <= 9 && !key; n++) { if (open.indexOf(book + '-' + n) < 0) { key = book + '-' + n; } }
        if (!key) { return false; }
        history.replaceState(history.state, '', addressWith(key, chapter));
        window.pudlWindows.open(key);
        return true;
    }

    /* A link to a chapter: in its own book's window it turns that window;
       anywhere else in the window view it turns a window of that book that
       is open, or opens one at that chapter. */
    document.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('a[data-book-chapter]');
        if (!a || !plainClick(e) || !window.pudlWindows || !document.querySelector('[data-win-layer]')) { return; }
        var book = a.getAttribute('data-book-of'), chapter = a.getAttribute('data-book-chapter');
        var here = a.closest('.win[data-win]');
        if (e.shiftKey) {
            if (openCopy(book, chapter)) { e.preventDefault(); }
            return;
        }
        var win = here && bookOf(here) === book ? here : windowOf(book);
        e.preventDefault();
        if (!win) {
            history.replaceState(history.state, '', addressWith(book, chapter));
            window.pudlWindows.open(book);
            return;
        }
        if (win !== here) { window.pudlWindows.raise(win.getAttribute('data-win')); }
        if (chapter === chapterIn(win)) { return; }
        turn(win, win.getAttribute('data-win'), chapter, 'push').catch(function () { location.href = a.href; });
    });

    /* The open window of a book, the first of its copies if several are. */
    function windowOf(book) {
        var open = window.pudlWindows.state().open;
        for (var i = 0; i < open.length; i++) {
            var w = document.querySelector('.win[data-win="' + open[i] + '"]');
            if (w && bookOf(w) === book) { return w; }
        }
        return null;
    }

    /* A window that opens or comes back with a chapter in the address
       shows that chapter; one whose chapter the address changed (Back,
       Forward) turns to it. */
    function sync() {
        if (!window.pudlWindows) { return; }
        var q = query();
        document.querySelectorAll('.win[data-win]').forEach(function (win) {
            var current = chapterIn(win);
            if (current === null) { return; }
            var key = win.getAttribute('data-win'), wanted = q.get('c.' + key) || '';
            if (wanted !== current) { turn(win, key, wanted, null).catch(function () { }); }
        });
    }
    document.addEventListener('pudl:window-open', function (e) {
        var win = e.target;
        if (win && win.querySelector && win.querySelector('.book')) {
            var key = win.getAttribute('data-win'), wanted = query().get('c.' + key) || '';
            if (wanted !== chapterIn(win)) { turn(win, key, wanted, null).catch(function () { }); }
        }
    });
    window.addEventListener('popstate', function () { setTimeout(sync, 0); });

    /* A closed window's chapter leaves the address with it. */
    document.addEventListener('pudl:windows-change', function () {
        if (!window.pudlWindows) { return; }
        var open = window.pudlWindows.state().open, q = query(), stale = [];
        q.forEach(function (v, k) { if (k.indexOf('c.') === 0 && open.indexOf(k.slice(2)) < 0) { stale.push(k); } });
        if (!stale.length) { return; }
        stale.forEach(function (k) { q.delete(k); });
        var s = q.toString().replace(/%2F/g, '/').replace(/%2C/g, ',');
        history.replaceState(history.state, '', location.pathname + (s ? '?' + s : '') + location.hash);
    });

    /* The window menu's own command for it. */
    document.addEventListener('pudl:window-menu', function (e) {
        var win = e.target, book = win && win.querySelector && bookOf(win);
        if (!book) { return; }
        e.detail.add('Open in a new window', function () { openCopy(book, chapterIn(win)); });
    });

    /* On a phone the contents of a classic page start folded. */
    function foldOnPhone() {
        if (!window.matchMedia || !window.matchMedia('(max-width: 640px)').matches) { return; }
        document.querySelectorAll('.book-contents[open]').forEach(function (d) { if (!d.closest('.win')) { d.open = false; } });
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', foldOnPhone); } else { foldOnPhone(); }
})();
