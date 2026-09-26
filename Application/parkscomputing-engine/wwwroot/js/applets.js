/* The applet runtime. An applet is content that runs in a PUDL window or
   in a full browser page, unchanged (the site's applet rule, Paul,
   2026-09-26). An article declares one with a mount element:

     <div class="pc-app pc-sudoku" data-app="sudoku"
          data-app-src="/js/sudoku.js" data-app-css="/css/sudoku.css"
          data-app-page="/page/sudoku"></div>

   The applet script registers window.pcApps[name] = { init(root, opts) },
   where init scopes every lookup and listener to root and returns an
   instance with destroy(). opts.ownUrl says whether the applet owns the
   page URL (stand-alone) or must leave it alone (inside a window, where
   the desktop owns it); opts.pageUrl is the applet's own page for share
   links either way.

   This runtime loads each applet's stylesheet and script once, boots
   mounts on page load, and offers boot(scope) and reap() for hosts that
   add and remove mounts, as the desktop does with windows. */
(function () {
    'use strict';

    window.pcApps = window.pcApps || {};

    var instances = [];
    var scripts = {};

    function ensureCss(href) {
        if (!href) { return; }
        if (document.querySelector('link[rel="stylesheet"][href="' + href + '"]')) { return; }
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
    }

    function ensureScript(src) {
        if (!src) { return Promise.reject(new Error('applet mount has no data-app-src')); }
        if (!scripts[src]) {
            scripts[src] = new Promise(function (resolve, reject) {
                var el = document.createElement('script');
                el.src = src;
                el.onload = resolve;
                el.onerror = function () { reject(new Error('failed to load ' + src)); };
                document.head.appendChild(el);
            });
        }
        return scripts[src];
    }

    function boot(scope) {
        (scope || document).querySelectorAll('[data-app]:not([data-app-ready])').forEach(function (root) {
            root.setAttribute('data-app-ready', 'loading');
            ensureCss(root.getAttribute('data-app-css'));
            ensureScript(root.getAttribute('data-app-src')).then(function () {
                var app = window.pcApps[root.getAttribute('data-app')];
                if (!app || !app.init) {
                    root.setAttribute('data-app-ready', 'error');
                    return;
                }
                var instance = app.init(root, {
                    ownUrl: !root.closest('.win'),
                    pageUrl: root.getAttribute('data-app-page') || location.pathname
                });
                instances.push({ root: root, instance: instance });
                root.setAttribute('data-app-ready', 'ready');
            }, function (err) {
                root.setAttribute('data-app-ready', 'error');
                if (window.console) { console.warn('applets:', err.message); }
            });
        });
    }

    /* Destroys instances whose mount has left the document, for hosts that
       remove content, as the desktop does when a window closes. */
    function reap() {
        instances = instances.filter(function (entry) {
            if (entry.root.isConnected) { return true; }
            try { entry.instance && entry.instance.destroy && entry.instance.destroy(); }
            catch (err) { if (window.console) { console.warn('applets:', err); } }
            return false;
        });
    }

    window.pcApplets = { boot: boot, reap: reap };

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', function () { boot(document); }); }
    else { boot(document); }
})();
