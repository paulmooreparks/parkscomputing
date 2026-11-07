/* What the window bar (Pages/Shared/_WindowBar.cshtml, PUDL's taskbar
   since 0.79.0) needs of the site that PUDL has no attribute for. The
   window menu that began here is PUDL's own since 0.32.0, and Close all is
   PUDL's since 0.79.0 (data-win-close-all).

   - the sidebar toggle, which shows and hides the article list;
   - [data-win-request="verb"], as in a menu's "New terminal", makes a
     PUDL applet request, which opens a new instance where a window link
     would raise the one already open. */
(function () {
    'use strict';
    if (window.pcWindowBar) { return; }
    window.pcWindowBar = true;

    function plainClick(e) { return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey; }

    var layout = document.querySelector('.md-layout');
    function narrowLayout() { return layout && layout.getBoundingClientRect().width <= 640; }
    function listHidden() {
        return narrowLayout() ? layout.dataset.mdPane === 'detail' : layout.hasAttribute('data-md-collapsed');
    }
    function syncSidebar() {
        if (!layout) { return; }
        var hidden = listHidden();
        document.querySelectorAll('[data-sidebar-toggle]').forEach(function (button) {
            button.hidden = false;
            button.setAttribute('aria-pressed', hidden ? 'true' : 'false');
            button.setAttribute('aria-expanded', hidden ? 'false' : 'true');
            var label = hidden ? 'Show sidebar' : narrowLayout() ? 'Show article windows' : 'Hide sidebar';
            button.setAttribute('aria-label', label);
            button.setAttribute('data-tooltip', label);
            button.title = label;
            button.disabled = !!(narrowLayout() && !hidden && (!window.pudlWindows || !window.pudlWindows.state().open.length));
            /* View's Hide the article list keeps its words and is ticked
               while the list is hidden, as every other on-and-off command in
               the menus is; the button's label says what pressing it will do. */
            document.querySelectorAll('[data-site-command="sidebar"]').forEach(function (command) {
                command.setAttribute('aria-checked', hidden ? 'true' : 'false');
                command.disabled = button.disabled;
            });
        });
    }
    function toggleSidebar() {
        if (layout && window.pudlMd) { window.pudlMd.command(layout, 'toggle'); }
    }
    function requestPane(e) {
        if (!window.pudlWindows || e.target !== layout) { return; }
        var state = window.pudlWindows.state();
        var url = new URL(location.href);
        if (e.detail.pane === 'list') {
            var visible = state.open.filter(function (key) { return !state.min[key]; });
            if (!visible.length) { return; }
            url.searchParams.set('sidebarRestore', visible.join(','));
            url.searchParams.set('sidebarTop', state.top || '');
            history.replaceState(history.state, '', url);
            window.pudlWindows.minimizeAll();
        } else {
            var keys = (url.searchParams.get('sidebarRestore') || '').split(',').filter(function (key) {
                return state.open.indexOf(key) >= 0;
            });
            var top = url.searchParams.get('sidebarTop');
            var key = keys.indexOf(top) >= 0 ? top : state.top || state.open[state.open.length - 1];
            if (!key) { return; }
            url.searchParams.delete('sidebarRestore');
            url.searchParams.delete('sidebarTop');
            history.replaceState(history.state, '', url);
            keys.filter(function (k) { return k !== key; }).forEach(function (k) { window.pudlWindows.raise(k); });
            window.pudlWindows.raise(key);
        }
        // The window manager remains the sole owner of data-md-pane.
        syncSidebar();
    }
    if (layout) {
        new MutationObserver(syncSidebar).observe(layout, { attributes: true,
            attributeFilter: ['data-md-pane', 'data-md-collapsed', 'data-md-narrow'] });
        document.addEventListener('pudl:regions-swap', syncSidebar);
        layout.addEventListener('pudl:md-request', requestPane);
        layout.addEventListener('pudl:md-change', function (e) {
            if (e.target !== layout) { return; }
            var state = e.detail.state;
            if (['width', 'collapse', 'reset'].indexOf(e.detail.kind) >= 0) {
                try {
                    localStorage.setItem('pc-focus', state.collapsed ? '1' : '0');
                    localStorage.setItem('pc-sidebar-w', state.width + 'px');
                } catch (err) { /* storage blocked */ }
            }
            syncSidebar();
        });
    }

    document.addEventListener('click', function (e) {
        if (e.target.closest('[data-sidebar-toggle]')) { toggleSidebar(); return; }
        var req = e.target.closest('[data-win-request]');
        if (req && plainClick(e) && window.pudlWindows && window.pudlApplets && window.pudlApplets.request) {
            if (window.pudlApplets.request(req.getAttribute('data-win-request'), {}, req)) { e.preventDefault(); }
        }
    });

    document.addEventListener('pudl:windows-change', syncSidebar);
    syncSidebar();
})();
