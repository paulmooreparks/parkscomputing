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
       Server-rendered per PUDL, shown from the topbar gear. The theme
       segment writes PUDL's own storage key, extended with 'system' (the
       head applies it pre-paint); the other settings bind themselves
       elsewhere by their data-pref attributes. */
    (function () {
        var backdrop = document.getElementById('settings-dialog');
        var opener = document.querySelector('[data-settings-open]');
        if (!backdrop || !opener) { return; }

        /* The theme is pudl-theme's own since 0.13.0: pudlSetTheme writes
           the choice, and pudl:theme-change keeps this dialog's marking in
           step, other tabs included. */
        function markTheme() {
            var mode = window.pudlThemePreference ? window.pudlThemePreference() : 'dark';
            backdrop.querySelectorAll('[data-theme-choice]').forEach(function (b) {
                b.classList.toggle('active', b.getAttribute('data-theme-choice') === mode);
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
            backdrop.querySelectorAll('[data-view-choice]').forEach(function (b) {
                b.classList.toggle('active', b.getAttribute('data-view-choice') === viewChoice());
            });
        }

        function setView(mode) {
            document.cookie = mode === 'classic'
                ? 'pc-view=classic; path=/; max-age=31536000; SameSite=Lax'
                : 'pc-view=; path=/; max-age=0; SameSite=Lax';
            markView();
        }

        function open() {
            markTheme();
            markView();
            backdrop.hidden = false;
            var first = backdrop.querySelector('.active, input, button');
            if (first) { first.focus(); }
        }

        function close() {
            backdrop.hidden = true;
            opener.focus();
        }

        opener.addEventListener('click', open);
        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop) { close(); }
            var choice = e.target.closest('[data-theme-choice]');
            if (choice && window.pudlSetTheme) { window.pudlSetTheme(choice.getAttribute('data-theme-choice')); }
            var view = e.target.closest('[data-view-choice]');
            if (view) { setView(view.getAttribute('data-view-choice')); }
            if (e.target.closest('[data-settings-close]')) { close(); }
            if (e.target.closest('[data-settings-forget]')) {
                ['pc-maximize-new', 'pc-resume-windows', 'pc-windows'].forEach(function (key) {
                    try { localStorage.removeItem(key); } catch (err) { }
                });
                document.cookie = 'pc-list=; path=/; max-age=0; SameSite=Lax';
                setView('window');
                /* Forgetting lands the theme on System: the device decides. */
                if (window.pudlSetTheme) { window.pudlSetTheme('system'); }
                backdrop.querySelectorAll('[data-pref]').forEach(function (box) {
                    box.checked = box.getAttribute('data-pref-default') === '1';
                });
                markTheme();
            }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !backdrop.hidden) { close(); }
        });
    })();

    /* Only one nav dropdown stays open at a time, and a click elsewhere
       closes it. The menus are native <details>, so they work without this. */
    document.addEventListener('click', function (e) {
        document.querySelectorAll('.nav-drop[open]').forEach(function (d) {
            if (!d.contains(e.target)) { d.removeAttribute('open'); }
        });
        var opened = e.target.closest('.nav-drop');
        if (opened) {
            document.querySelectorAll('.nav-drop[open]').forEach(function (d) {
                if (d !== opened) { d.removeAttribute('open'); }
            });
        }
    });
})();
