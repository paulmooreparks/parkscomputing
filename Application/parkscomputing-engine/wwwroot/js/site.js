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

        // Pointer events do not cross an iframe's document boundary.
        document.addEventListener('pointerdown', function (e) {
            if (e.button !== 0) { return; }
            var frame = window.frameElement;
            var win = frame && frame.closest('.win[data-win]');
            if (win && host.state().top !== win.dataset.win) { host.raise(win.dataset.win); }
        }, true);


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

    /* Settings is an applet (js/settings.js), which holds what the settings
       dialog here used to: the theme, the default view, the window view's
       choices and forgetting this browser's data. */

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
