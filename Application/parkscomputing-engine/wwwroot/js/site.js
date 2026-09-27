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
