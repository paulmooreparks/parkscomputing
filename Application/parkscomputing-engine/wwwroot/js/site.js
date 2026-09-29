/* Site-wide enhancements. PUDL's theme loader sets data-theme on <html>
   before first paint; the highlight.js stylesheets are chosen per theme
   here, because their media="(prefers-color-scheme: …)" attributes follow
   the OS and not the toggle. */
(function () {
    'use strict';

    function syncHighlightTheme() {
        var theme = document.documentElement.getAttribute('data-theme');
        if (theme !== 'light' && theme !== 'dark') {
            theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }

        var light = document.getElementById('hljs-light');
        var dark = document.getElementById('hljs-dark');
        if (light && dark) {
            light.media = theme === 'dark' ? 'not all' : 'all';
            dark.media = theme === 'dark' ? 'all' : 'not all';
        }

        /* A framed page (a window hosting an app page) read its theme when
           it loaded; a toggle after that reaches it here. Same origin, so
           the frame's document is ours to set. */
        document.querySelectorAll('iframe.win-app-frame').forEach(function (frame) {
            try {
                var doc = frame.contentDocument;
                if (doc && doc.documentElement) { doc.documentElement.setAttribute('data-theme', theme); }
            } catch (err) { /* a foreign frame is none of our business */ }
        });
    }

    syncHighlightTheme();
    new MutationObserver(syncHighlightTheme)
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncHighlightTheme);

    /* A page framed inside a desktop window (the ?frame rendering) hands
       its internal article links up to the desktop, so following one opens
       a window beside the current one instead of navigating the frame into
       a site-within-a-window. Same origin, so the parent is reachable; a
       foreign or scriptless parent leaves links alone. */
    (function () {
        if (window.self === window.top) { return; }
        var host;
        try { host = window.top.pudlWindows; } catch (err) { return; }
        if (!host) { return; }

        function articleSlugOf(a) {
            var segments = a.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
            if (segments.length === 0) { return null; }
            var candidate = segments[segments.length - 1];
            return /^[A-Za-z0-9_-]+$/.test(candidate) ? candidate : null;
        }

        document.addEventListener('click', function (e) {
            if (e.button !== 0 || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { return; }
            var a = e.target.closest && e.target.closest('a[href]');
            if (!a || a.target) { return; }
            if (a.origin !== location.origin) { return; }

            /* A link back into this same document belongs to the app (a
               preset, a shared state, a fragment). It keeps the bare frame
               rendering, which a plain navigation would lose. */
            if (a.pathname === location.pathname) {
                if (!a.search) { return; }             // a fragment is the app's own
                var u = new URL(a.href);
                if (!u.searchParams.has('frame')) {
                    e.preventDefault();
                    u.searchParams.set('frame', '');
                    location.href = u.pathname + '?' + u.searchParams.toString() + u.hash;
                }
                return;
            }

            var slug = articleSlugOf(a);
            if (!slug) { return; }
            e.preventDefault();
            host.open(slug, a);
        });
    })();

    /* === The settings dialog ==============================================
       A native <dialog> per PUDL 0.16.0, opened and closed by the gear's
       and Close button's command attributes (pudl-dialog.js covers browsers
       without them), which also gives Escape, focus containment and the
       backdrop for free. The theme segment writes PUDL's own storage key;
       the other settings bind themselves elsewhere by their data-pref
       attributes. State on the segments is marked with aria-pressed. */
    (function () {
        var dialog = document.getElementById('settings-dialog');
        var opener = document.querySelector('[data-settings-open]');
        if (!dialog) { return; }

        /* The theme is pudl-theme's own since 0.13.0: pudlSetTheme writes
           the choice, and pudl:theme-change keeps this dialog's marking in
           step, other tabs included. */
        function markTheme() {
            var mode = window.pudlThemePreference ? window.pudlThemePreference() : 'dark';
            dialog.querySelectorAll('[data-theme-choice]').forEach(function (b) {
                b.setAttribute('aria-pressed', String(b.getAttribute('data-theme-choice') === mode));
            });
        }

        document.addEventListener('pudl:theme-change', markTheme);

        /* The default view lives in a cookie because the server acts on it:
           a bare / redirects to the classic home when it says classic. It
           is a functional preference like the rest. */
        function viewChoice() {
            var m = document.cookie.match(/(?:^|;\s*)pc-view=([^;]*)/);
            return m && m[1] === 'classic' ? 'classic' : 'window';
        }

        function markView() {
            dialog.querySelectorAll('[data-view-choice]').forEach(function (b) {
                b.setAttribute('aria-pressed', String(b.getAttribute('data-view-choice') === viewChoice()));
            });
        }

        function setView(mode) {
            document.cookie = mode === 'classic'
                ? 'pc-view=classic; path=/; max-age=31536000; SameSite=Lax'
                : 'pc-view=; path=/; max-age=0; SameSite=Lax';
            markView();
        }

        /* The command button opens the dialog; this only freshens the
           marking on the way in. */
        if (opener) { opener.addEventListener('click', function () { markTheme(); markView(); }); }

        dialog.addEventListener('click', function (e) {
            /* A click on the backdrop reaches the dialog element itself. */
            if (e.target === dialog) { dialog.close(); }
            var choice = e.target.closest('[data-theme-choice]');
            if (choice && window.pudlSetTheme) { window.pudlSetTheme(choice.getAttribute('data-theme-choice')); }
            var view = e.target.closest('[data-view-choice]');
            if (view) { setView(view.getAttribute('data-view-choice')); }
            if (e.target.closest('[data-settings-close]')) { dialog.close(); }
            if (e.target.closest('[data-settings-forget]')) {
                ['pc-maximize-new', 'pc-resume-windows', 'pc-windows', 'pc-sidebar-w', 'pc-sudoku', 'pc-barcodes', 'pc-barcode-layouts', 'pc-terminal', 'pc-terminal-history'].forEach(function (key) {
                    try { localStorage.removeItem(key); } catch (err) { }
                });
                /* The barcode tool's link to a layouts file on disk; the
                   file itself is the reader's and is left alone. */
                try { if (window.indexedDB) { indexedDB.deleteDatabase('pc-barcodes'); } } catch (err) { }
                document.cookie = 'pc-list=; path=/; max-age=0; SameSite=Lax';
                setView('window');
                /* Forgetting lands the theme on System: the device decides. */
                if (window.pudlSetTheme) { window.pudlSetTheme('system'); }
                dialog.querySelectorAll('[data-pref]').forEach(function (box) {
                    box.checked = box.getAttribute('data-pref-default') === '1';
                });
                markTheme();
            }
        });

        markTheme();
        markView();
    })();

    /* The go palette is PUDL's since 0.17.0: a menu panel with
       data-menu-key="/" in the layout, its filter in a GET form that /go
       answers. The site keeps no palette script. */

    /* Preset links (data-applet-preset) are PUDL's own since 0.21.0: the
       runtime hands the link's state to the right running instance and
       falls back to navigation. The site keeps no glue for them. */

    /* === Applet continuity (PUDL 0.21.0) ==================================
       The site hosts each applet's continuity everywhere the applet has
       none of its own: pudl:applet-state hands a starting instance the
       state kept for it, and pudl:applet-change keeps it again. On the
       applet's own page a board named in the URL still wins (the applet
       prefers its address at boot), so a shared link opens its own board,
       and the installed web app, whose launch URL names nothing, resumes
       the last game. A mount keeping its state in the page's query
       (data-applet-param) is the URL's business, not this. The keys are
       per-applet, functional storage wiped by the settings dialog's
       Forget. */
    var CONTINUITY = { sudoku: 'pc-sudoku', barcodes: 'pc-barcodes', terminal: 'pc-terminal' };

    document.addEventListener('pudl:applet-state', function (e) {
        /* A one-shot hand-off: an applet opening another instance of
           itself elsewhere (Conway's "Open this board") leaves the state
           here for the new instance, which takes it once. */
        var handoff = window.pcAppletHandoff;
        if (handoff && e.detail && Object.prototype.hasOwnProperty.call(handoff, e.detail.name)) {
            e.detail.state = handoff[e.detail.name];
            delete handoff[e.detail.name];
            return;
        }
        var key = CONTINUITY[e.detail && e.detail.name];
        if (!key || (e.detail && e.detail.param)) { return; }
        try {
            var kept = localStorage.getItem(key);
            if (kept) { e.detail.state = kept; }
        } catch (err) { }
    });

    document.addEventListener('pudl:applet-change', function (e) {
        var mount = e.target;
        if (!mount.getAttribute) { return; }
        var key = CONTINUITY[mount.getAttribute('data-applet')];
        if (!key || mount.hasAttribute('data-applet-param')) { return; }
        try {
            if (e.detail && e.detail.state != null) { localStorage.setItem(key, e.detail.state); }
            else { localStorage.removeItem(key); }
        } catch (err) { }
    });

    /* A code listing that names its source (code[data-code-src]) is
       filled from that file and highlighted; windows hydrate through
       desktop.js's enhancement pass. */
    function hydrateSource(scope) {
        (scope || document).querySelectorAll('code[data-code-src]:not([data-code-loaded])').forEach(function (block) {
            block.setAttribute('data-code-loaded', '');
            fetch(block.getAttribute('data-code-src'))
                .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error(r.status)); })
                .then(function (text) {
                    block.textContent = text;
                    (function apply() {
                        if (!window.hljs) { return setTimeout(apply, 50); }
                        try { window.hljs.highlightElement(block); } catch (err) { }
                    })();
                })
                .catch(function () { });
        });
    }
    window.pcHydrateSource = hydrateSource;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { hydrateSource(document); });
    } else {
        hydrateSource(document);
    }

})();
