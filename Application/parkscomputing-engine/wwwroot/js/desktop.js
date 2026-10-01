/* Desktop-mode wiring on top of pudl-windows.js, pudl-applets.js and
   pudl-regions.js (PUDL 0.12.0). Navigation, opener-state inheritance and
   live window parameters in links are PUDL's own work now; what remains
   here is site-specific:

   - Content enhancement (highlight.js, Mermaid) per arriving window.
   - The filter narrowing the list live as the reader types.
   - The reader's preferences: maximize-new for opens from outside any
     window, and remembering the window arrangement and list state (the
     list state rides a cookie the server redirects on). */
(function () {
    'use strict';

    /* The window parameters, which the remembered arrangement keeps: c.{key}
       is a book window's chapter (js/books.js). */
    function isWinParam(key) {
        return key === 'open' || key === 'top' || key === 'min' || key.indexOf('p.') === 0 || key.indexOf('c.') === 0;
    }

    /* The go palette's form carries the desktop's state to /go, so the new
       window joins what is open. The server rendered the fields as of page
       load; this freshens them from the live URL at the moment of submit. */
    (function () {
        var form = document.querySelector('.go-palette form');
        if (!form) { return; }
        form.addEventListener('submit', function () {
            form.querySelectorAll('input[data-go-state]').forEach(function (field) { field.remove(); });
            new URLSearchParams(location.search).forEach(function (value, key) {
                if (key === 'slug' || key === 'nav' || key === 'view') { return; }
                var field = document.createElement('input');
                field.type = 'hidden';
                field.name = key;
                field.value = value;
                field.setAttribute('data-go-state', '');
                form.appendChild(field);
            });
        });
    })();

    function enhance(win) {
        if (window.hljs) {
            win.querySelectorAll('pre code:not(.language-mermaid):not([data-highlighted])').forEach(function (block) {
                window.hljs.highlightElement(block);
            });
        }
        if (window.pcEnhanceCode) { window.pcEnhanceCode(win); }
        win.querySelectorAll('pre > code[class*="language-mermaid"]').forEach(function (code) {
            var node = document.createElement('div');
            node.className = 'mermaid';
            node.textContent = code.textContent || '';
            code.parentElement.replaceWith(node);
        });
        if (window.mermaid && win.querySelector('.mermaid')) {
            window.mermaid.initialize({ startOnLoad: false });
            window.mermaid.run({ nodes: win.querySelectorAll('.mermaid') });
        }
        if (window.pcHydrateSource) { window.pcHydrateSource(win); }
    }
    /* For content that arrives in a window after it opened, such as a
       book's next chapter (js/books.js). */
    window.pcEnhanceWindow = enhance;

    /* Fetches a window's content afresh from /window/{key}, the address the
       layer opens it from, and puts it in place of what the window shows,
       leaving the window where it is. Applets in the old content are
       destroyed and those in the new are started, through pudl-applets.js's
       boot and destroy, which are there for content a project swaps by
       other means. A book's chapter rides along as ?c=. keepScroll holds
       the reader's place, as a browser's reload does. The browser's cache
       is bypassed, so an edit made a moment ago shows. */
    function loadWindow(win, chapter, keepScroll) {
        var key = win.getAttribute('data-win');
        var url = '/window/' + encodeURIComponent(key) + (chapter ? '?c=' + encodeURIComponent(chapter).replace(/%2F/g, '/') : '');
        return fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'text/html' } })
            .then(function (r) { if (!r.ok) { throw new Error(url + ' returned ' + r.status); } return r.text(); })
            .then(function (html) {
                var doc = new DOMParser().parseFromString(html, 'text/html');
                var fresh = doc.querySelector('.win .win-body'), body = win.querySelector('.win-body');
                if (!fresh || !body) { throw new Error(url + ' holds no window body'); }
                var top = body.scrollTop;
                if (window.pudlApplets) { window.pudlApplets.destroy(body); }
                body.innerHTML = fresh.innerHTML;
                body.scrollTop = keepScroll ? top : 0;
                var page = doc.querySelector('.win .win-head [data-win-action="page"]'), mine = win.querySelector('.win-head [data-win-action="page"]');
                if (page && mine) { mine.setAttribute('href', page.getAttribute('href')); }
                var title = doc.querySelector('.win .win-title'), shown = win.querySelector('.win-title');
                if (title && shown && title.textContent !== shown.textContent && window.pudlWindows) { window.pudlWindows.retitle(key, title.textContent); }
                /* pudl-tree.js enhances trees as a window opens; these
                   arrived later. */
                if (window.pudlTree && window.pudlTree.enhance) { body.querySelectorAll('ul.tree').forEach(window.pudlTree.enhance); }
                enhance(win);
                if (window.pudlApplets) { window.pudlApplets.boot(body); }
            });
    }
    window.pcLoadWindow = loadWindow;

    /* The window menu's Reload, for every window, which picks up a change
       to its article or its applet's markup without reloading the page.
       An applet's script and stylesheet are loaded once per page by
       pudl-applets.js, so a change to those still needs the page reloaded. */
    document.addEventListener('pudl:window-menu', function (e) {
        var win = e.target;
        if (!win || !win.matches || !win.matches('.win[data-win]') || !win.closest('[data-win-layer][data-win-src="/window/{key}"]')) { return; }
        e.detail.add('Reload', function () {
            var book = win.querySelector('.book');
            loadWindow(win, book ? book.getAttribute('data-book-current') || '' : '', true)
                .catch(function (err) { if (window.console) { console.warn('reload:', err); } });
        });
    });

    /* === The filter, narrowing live ========================================
       The server renders the ?q= filtered list and applying the filter is
       the form's own navigation (a region swap); this only refines the
       visible rows between keystrokes. Delegated, because region swaps
       replace the input and the sidebar. */
    document.addEventListener('input', function (e) {
        if (!e.target.matches || !e.target.matches('.md-filter-group .md-filter')) { return; }
        var sidebar = document.querySelector('.md-sidebar');
        if (!sidebar) { return; }
        var q = e.target.value.trim().toLowerCase();
        var label = null, labelHasRow = false;

        Array.prototype.forEach.call(sidebar.children, function (el) {
            if (el.classList.contains('md-section-label')) {
                if (label) { label.hidden = !labelHasRow; }
                label = el;
                labelHasRow = false;
            } else if (el.classList.contains('md-row')) {
                if (el.classList.contains('md-row-child')) {
                    el.hidden = !!(el.previousElementSibling && el.previousElementSibling.hidden);
                } else {
                    var text = ((el.textContent || '') + ' ' + (el.getAttribute('data-tags') || '')).toLowerCase();
                    el.hidden = q !== '' && text.indexOf(q) < 0;
                }
                if (!el.hidden) { labelHasRow = true; }
            }
        });
        if (label) { label.hidden = !labelHasRow; }
    });

    /* === Preferences and continuity ======================================== */
    function pref(name, fallback) {
        try {
            var v = localStorage.getItem('pc-' + name);
            return v === null ? fallback : v === '1';
        } catch (err) { return fallback; }
    }

    /* The Settings applet (js/settings.js) sets these; this reads them. */
    function initPrefs(layer) {

        /* Opens from outside any window follow the maximize preference;
           a link inside a window inherits that window's state, PUDL's own
           behavior, which this leaves alone. */
        layer.addEventListener('pudl:window-place', function (e) {
            if (e.detail.placement || !pref('maximize-new', false)) { return; }
            if (e.detail.opener && e.detail.opener.closest && e.detail.opener.closest('.win')) { return; }
            e.detail.placement = { mode: 'maximized', x: 0.06, y: 0.05, w: 0.55, h: 0.75 };
        });

        /* The window arrangement, remembered for the next bare visit. */
        function saveWindows() {
            var parts = [];
            new URLSearchParams(location.search).forEach(function (value, key) {
                if (isWinParam(key)) { parts.push(key + '=' + encodeURIComponent(value)); }
            });
            try {
                if (parts.length) { localStorage.setItem('pc-windows', parts.join('&')); }
                else { localStorage.removeItem('pc-windows'); }
            } catch (err) { }
        }
        document.addEventListener('pudl:windows-change', saveWindows);
        /* A book window turning a page changes only its chapter. */
        document.addEventListener('pc:book-turn', saveWindows);

        /* The list state (category and filter), remembered in a cookie the
           server redirects on for the next bare visit. */
        function saveListState() {
            var q = new URLSearchParams(location.search);
            var list = new URLSearchParams();
            q.getAll('cat').forEach(function (v) { list.append('cat', v); });
            q.getAll('tag').forEach(function (v) { list.append('tag', v); });
            if (q.get('q')) { list.set('q', q.get('q')); }
            document.cookie = list.toString()
                ? 'pc-list=' + encodeURIComponent(list.toString()) + '; path=/; max-age=31536000; SameSite=Lax'
                : 'pc-list=; path=/; max-age=0; SameSite=Lax';
        }
        document.addEventListener('pudl:regions-swap', saveListState);
        saveListState();

        /* The category and tag menus: a checkbox change rewrites the filter
           form's matching hidden inputs and submits it, which pudl-regions
           turns into a region swap; the boxes re-sync from the URL after
           every swap, Back and Forward included, so the panel can stay
           open across any number of checks. */
        function syncFilterMenus() {
            var q = new URLSearchParams(location.search);
            document.querySelectorAll('[data-filter-menu]').forEach(function (panel) {
                var name = panel.getAttribute('data-filter-menu');
                var chosen = q.getAll(name).map(function (v) { return v.toLowerCase(); });
                panel.querySelectorAll('input[type="checkbox"]').forEach(function (box) {
                    box.checked = chosen.indexOf(box.value.toLowerCase()) >= 0;
                });
            });
        }

        document.addEventListener('change', function (e) {
            var panel = e.target.closest && e.target.closest('[data-filter-menu]');
            if (!panel) { return; }
            var form = document.querySelector('.md-filter-group');
            if (!form) { return; }
            var name = panel.getAttribute('data-filter-menu');
            form.querySelectorAll('input[type="hidden"][name="' + name + '"]').forEach(function (i) { i.remove(); });
            panel.querySelectorAll('input[type="checkbox"]:checked').forEach(function (box) {
                var input = document.createElement('input');
                input.type = 'hidden';
                input.name = name;
                input.value = box.value;
                form.appendChild(input);
            });
            form.requestSubmit();
        });

        document.addEventListener('pudl:regions-swap', syncFilterMenus);
        window.addEventListener('popstate', syncFilterMenus);
        syncFilterMenus();
    }

    /* Runs before pudl-windows initializes (this script is not deferred),
       so a bare desktop URL picks up the saved arrangement in time. */
    function restoreWindows() {
        if (!document.querySelector('[data-win-layer]')) { return; }
        if (!pref('resume-windows', true)) { return; }
        var q = new URLSearchParams(location.search);
        var hasWinParams = false;
        q.forEach(function (v, k) { if (isWinParam(k)) { hasWinParams = true; } });
        if (hasWinParams) { return; }
        var saved;
        try { saved = localStorage.getItem('pc-windows'); } catch (err) { return; }
        if (!saved) { return; }
        var sep = location.search ? '&' : '?';
        history.replaceState(history.state, '', location.pathname + location.search + sep + saved);
    }

    function init() {
        var layer = document.querySelector('[data-win-layer]');
        if (!layer) { return; }

        layer.addEventListener('pudl:window-open', function (e) {
            enhance(e.target);
        });
        /* Windows the server rendered with the page arrive without
           pudl:window-open, so they are enhanced here. */
        layer.querySelectorAll(':scope > .win[data-win]').forEach(enhance);

        initPrefs(layer);

        /* Close-all is js/window-bar.js's, shared with the admin desktop. */
    }

    restoreWindows();
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
    else { init(); }
})();
