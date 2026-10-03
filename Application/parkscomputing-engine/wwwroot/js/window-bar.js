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
            document.querySelectorAll('[data-command="sidebar"]').forEach(function (command) {
                command.textContent = label;
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

    function syncTaskIcons() {
        document.querySelectorAll('[data-win-tab]').forEach(function (tab) {
            var key = tab.getAttribute('data-win-tab');
            var win = document.querySelector('[data-win="' + CSS.escape(key) + '"]');
            if (!win) { return; }
            var old = tab.querySelector('.task-icon');
            if (old) { old.remove(); }
            var title = tab.querySelector('.task-title');
            if (!title) {
                title = document.createElement('span');
                title.className = 'task-title';
                title.textContent = tab.textContent;
                tab.textContent = '';
                tab.appendChild(title);
            }
            var iconUrl = win.getAttribute('data-window-icon');
            var applet = win.querySelector('[data-applet]');
            var icon = document.createElement(iconUrl || !applet ? 'img' : 'span');
            icon.className = 'task-icon';
            if (icon.tagName === 'IMG') {
                icon.src = iconUrl || '/favicon-16x16.png';
                icon.alt = '';
            } else {
                icon.classList.add('glyph');
                icon.style.setProperty('--glyph', 'var(--glyph-app)');
            }
            icon.setAttribute('aria-hidden', 'true');
            tab.insertBefore(icon, title);
        });
    }

    function syncCloseAll() {
        var none = !window.pudlWindows || window.pudlWindows.state().open.length === 0;
        document.querySelectorAll('[data-close-all]').forEach(function (a) {
            a.classList.toggle('is-disabled', none);
            if (none) { a.setAttribute('aria-disabled', 'true'); a.tabIndex = -1; }
            else { a.removeAttribute('aria-disabled'); a.tabIndex = 0; }
        });
    }

    document.addEventListener('click', function (e) {
        if (e.target.closest('[data-sidebar-toggle]')) { toggleSidebar(); return; }
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
    document.addEventListener('pudl:windows-change', syncSidebar);
    document.addEventListener('pudl:windows-change', syncTaskIcons);
    document.addEventListener('pudl:windows-policy', syncTaskIcons);
    syncSidebar();
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', syncCloseAll); }
    else { syncCloseAll(); }
})();
