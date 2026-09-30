/* Site-wide enhancements. PUDL's theme loader sets data-theme on <html>
   before first paint. Highlighted code needs nothing here: pudl-hljs.css
   colours it from the theme's own tokens. */
(function () {
    'use strict';

    function syncFrameTheme() {
        var theme = document.documentElement.getAttribute('data-theme');
        if (theme !== 'light' && theme !== 'dark') {
            theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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

    syncFrameTheme();
    new MutationObserver(syncFrameTheme)
        .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncFrameTheme);

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
                ['pc-maximize-new', 'pc-resume-windows', 'pc-windows', 'pc-sidebar-w', 'pc-sudoku', 'pc-barcodes', 'pc-barcode-layouts', 'pc-terminal', 'pc-terminal-history', 'pc-terminal-home'].forEach(function (key) {
                    try { localStorage.removeItem(key); } catch (err) { }
                });
                /* The continuity of numbered instances, such as
                   pc-terminal:terminal-2. */
                try {
                    var prefixes = (window.pcContinuity ? window.pcContinuity.keys() : []).map(function (k) { return k + ':'; });
                    Object.keys(localStorage).forEach(function (key) {
                        if (prefixes.some(function (p) { return key.indexOf(p) === 0; })) { localStorage.removeItem(key); }
                    });
                } catch (err) { }
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

    /* Applet continuity lives in js/continuity.js, which the admin desktop
       shares; the layout loads it beside this file. */

    /* Every code block offers Copy and Download, from PUDL's pudl-code.js
       (0.29.0). The articles' Markdown and HTML write a bare pre, so the
       site hands each block over itself, with PUDL's pre.code look, from
       the places code appears: the page, each window as it opens, a
       listing filled from its file, and code htmx brings in later. */
    /* The site's languages PUDL's maps don't know. */
    function addLanguages() {
        var names = window.pudlCode.names, ext = window.pudlCode.extensions;
        if (!names.brainfuck) { names.brainfuck = 'Brainf**k'; ext.brainfuck = 'b'; }
        if (!names.xfer) { names.xfer = 'XferLang'; ext.xfer = 'xfer'; }
        if (!names.txt) { names.txt = 'Text'; ext.txt = 'txt'; }
    }
    function enhanceCode(scope) {
        function run() {
            if (!window.pudlCode) { return; }
            addLanguages();
            (scope || document).querySelectorAll('pre > code:not(.language-mermaid)').forEach(function (code) {
                var pre = code.parentElement;
                pre.classList.add('code');
                window.pudlCode.enhance(pre);
            });
        }
        if (window.pudlCode) { run(); } else { document.addEventListener('DOMContentLoaded', run, { once: true }); }
    }
    window.pcEnhanceCode = enhanceCode;
    enhanceCode(document);
    document.addEventListener('htmx:afterSwap', function (e) { enhanceCode(e.target); });

    /* A code listing that names its source (code[data-code-src]) is
       filled from that file and highlighted; windows hydrate through
       desktop.js's enhancement pass. */
    function hydrateSource(scope) {
        (scope || document).querySelectorAll('code[data-code-src]:not([data-code-loaded])').forEach(function (block) {
            block.setAttribute('data-code-loaded', '');
            /* Its download keeps the source's own name. */
            var pre = block.closest('pre'), src = block.getAttribute('data-code-src');
            if (pre && !pre.hasAttribute('data-code-filename')) {
                pre.setAttribute('data-code-filename', src.split('?')[0].split('/').pop());
            }
            fetch(src)
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
