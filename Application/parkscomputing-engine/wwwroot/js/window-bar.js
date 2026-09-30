/* The window bar's commands (Pages/Shared/_WindowBar.cshtml), on both
   sites' top bars, that PUDL has no attribute for. The window menu that
   began here is PUDL's own since 0.32.0.

   - [data-close-all] closes every top-level window in place, and stays a
     real link to the windowless state for a click that isn't plain;
   - [data-win-request="verb"], as in a menu's "New terminal", makes a
     PUDL applet request, which opens a new instance where a window link
     would raise the one already open. */
(function () {
    'use strict';
    if (window.pcWindowBar) { return; }
    window.pcWindowBar = true;

    function plainClick(e) { return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey; }

    function syncCloseAll() {
        var none = !window.pudlWindows || window.pudlWindows.state().open.length === 0;
        document.querySelectorAll('[data-close-all]').forEach(function (a) {
            a.classList.toggle('is-disabled', none);
            if (none) { a.setAttribute('aria-disabled', 'true'); a.tabIndex = -1; }
            else { a.removeAttribute('aria-disabled'); a.tabIndex = 0; }
        });
    }

    document.addEventListener('click', function (e) {
        var closeAll = e.target.closest('[data-close-all]');
        if (closeAll && plainClick(e)) {
            e.preventDefault();
            if (!window.pudlWindows) { return; }
            var layer = document.querySelector('[data-win-layer]');
            window.pudlWindows.state().open.forEach(function (key) {
                var el = layer && layer.querySelector('.win[data-win="' + key + '"]');
                if (el && !el.hasAttribute('data-win-parent')) { window.pudlWindows.close(key); }
            });
            return;
        }
        var req = e.target.closest('[data-win-request]');
        if (req && plainClick(e) && window.pudlWindows && window.pudlApplets && window.pudlApplets.request) {
            if (window.pudlApplets.request(req.getAttribute('data-win-request'), {}, req)) { e.preventDefault(); }
        }
    });

    document.addEventListener('pudl:windows-change', syncCloseAll);
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', syncCloseAll); }
    else { syncCloseAll(); }
})();
