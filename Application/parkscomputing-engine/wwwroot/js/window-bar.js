/* What the window bar (Pages/Shared/_WindowBar.cshtml, PUDL's taskbar
   since 0.79.0) needs of the site that PUDL has no attribute for. The
   window menu that began here is PUDL's own since 0.32.0, and Close all is
   PUDL's since 0.79.0 (data-win-close-all).

   - the sidebar toggle, which shows and hides the article list;
   - a taskbar button's picture, for a window whose icon is a picture
     (data-window-icon) or an article's, the site's own;
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

    /* A taskbar button shows its window's picture: the icon the window
       says (data-window-icon), or the site's own for an article. PUDL draws
       a glyph where a window says data-win-glyph, so an applet without a
       picture is given the app glyph and PUDL draws it; a picture goes
       before PUDL's title, with PUDL's glyph left hidden. */
    function syncTaskIcons() {
        document.querySelectorAll('[data-win-tab]').forEach(function (tab) {
            var key = tab.getAttribute('data-win-tab');
            var win = document.querySelector('[data-win="' + CSS.escape(key) + '"]');
            var title = tab.querySelector('.win-item-title');
            if (!win || !title) { return; }
            var iconUrl = win.getAttribute('data-window-icon');
            // An applet's window, not an article with comments under it,
            // whose comments applet belongs to the article (js/pins.js does the same).
            var applet = Array.prototype.some.call(win.querySelectorAll('[data-applet]'), function (el) { return !el.closest('.discussion-mount'); });
            var src = iconUrl || (applet ? null : '/favicon-16x16.png');
            var pic = tab.querySelector('.win-item-picture');
            if (!src) {
                if (pic) { pic.remove(); }
                if (win.getAttribute('data-win-glyph') !== 'app') { win.setAttribute('data-win-glyph', 'app'); }
                return;
            }
            if (!pic) {
                pic = document.createElement('img');
                pic.className = 'win-item-picture';
                pic.alt = '';
                pic.setAttribute('aria-hidden', 'true');
                tab.insertBefore(pic, title);
            }
            if (pic.getAttribute('src') !== src) { pic.src = src; }
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
    document.addEventListener('pudl:windows-change', syncTaskIcons);
    document.addEventListener('pudl:windows-policy', syncTaskIcons);
    syncSidebar();
})();
