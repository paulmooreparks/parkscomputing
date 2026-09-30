/* The taskbar (Pages/Shared/_Taskbar.cshtml,
   Architecture/admin-and-identity-design.md, A12), and close-all for any
   page of PUDL windows. PUDL draws the dock and keeps the minimize and
   restore links; this adds what PUDL has no attribute for:

   - [data-close-all] closes every top-level window in place. It stays a
     real link to the windowless state for a click that isn't plain.
   - [data-taskbar-request="verb"] makes a PUDL applet request, so "New
     terminal" opens a new instance where a window link would raise the
     one already open.

   PUDL's menu script closes the Start menu when an entry is chosen. It knows nothing about the page it is on. Load with defer, after
   pudl-windows.js and pudl-applets.js. */
(function () {
    'use strict';

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

        var req = e.target.closest('[data-taskbar-request]');
        if (req && plainClick(e) && window.pudlApplets && window.pudlApplets.request) {
            if (window.pudlApplets.request(req.getAttribute('data-taskbar-request'), {}, req)) { e.preventDefault(); }
        }
    });

    document.addEventListener('pudl:windows-change', syncCloseAll);
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', syncCloseAll); }
    else { syncCloseAll(); }
})();
