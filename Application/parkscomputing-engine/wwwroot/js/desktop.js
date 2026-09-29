/* Desktop-mode wiring on top of pudl-windows.js, pudl-applets.js and
   pudl-regions.js (PUDL 0.12.0). Navigation, opener-state inheritance and
   live window parameters in links are PUDL's own work now; what remains
   here is site-specific:

   - Content enhancement (highlight.js, Mermaid) per arriving window.
   - The filter narrowing the list live as the reader types.
   - The reader's preferences: maximize-new for opens from outside any
     window, and remembering the window arrangement and list state (the
     list state rides a cookie the server redirects on). */
(function () {
    'use strict';

    function isWinParam(key) {
        return key === 'open' || key === 'top' || key === 'min' || key.indexOf('p.') === 0;
    }

    /* The go palette's form carries the desktop's state to /go, so the new
       window joins what is open. The server rendered the fields as of page
       load; this freshens them from the live URL at the moment of submit. */
    (function () {
        var form = document.querySelector('.go-palette form');
        if (!form) { return; }
        form.addEventListener('submit', function () {
            form.querySelectorAll('input[data-go-state]').forEach(function (field) { field.remove(); });
            new URLSearchParams(location.search).forEach(function (value, key) {
                if (key === 'slug' || key === 'nav' || key === 'view') { return; }
                var field = document.createElement('input');
                field.type = 'hidden';
                field.name = key;
                field.value = value;
                field.setAttribute('data-go-state', '');
                form.appendChild(field);
            });
        });
    })();

    function enhance(win) {
        if (window.hljs) {
            win.querySelectorAll('pre code:not(.language-mermaid):not([data-highlighted])').forEach(function (block) {
                window.hljs.highlightElement(block);
            });
        }
        if (window.pcEnhanceCode) { window.pcEnhanceCode(win); }
        win.querySelectorAll('pre > code[class*="language-mermaid"]').forEach(function (code) {
            var node = document.createElement('div');
            node.className = 'mermaid';
            node.textContent = code.textContent || '';
            code.parentElement.replaceWith(node);
        });
        if (window.mermaid && win.querySelector('.mermaid')) {
            window.mermaid.initialize({ startOnLoad: false });
            window.mermaid.run({ nodes: win.querySelectorAll('.mermaid') });
        }
        if (window.pcHydrateSource) { window.pcHydrateSource(win); }
    }

    /* === The filter, narrowing live ========================================
       The server renders the ?q= filtered list and applying the filter is
       the form's own navigation (a region swap); this only refines the
       visible rows between keystrokes. Delegated, because region swaps
       replace the input and the sidebar. */
    document.addEventListener('input', function (e) {
        if (!e.target.matches || !e.target.matches('.md-filter-group .md-filter')) { return; }
        var sidebar = document.querySelector('.md-sidebar');
        if (!sidebar) { return; }
        var q = e.target.value.trim().toLowerCase();
        var label = null, labelHasRow = false;

        Array.prototype.forEach.call(sidebar.children, function (el) {
            if (el.classList.contains('md-section-label')) {
                if (label) { label.hidden = !labelHasRow; }
                label = el;
                labelHasRow = false;
            } else if (el.classList.contains('md-row')) {
                if (el.classList.contains('md-row-child')) {
                    el.hidden = !!(el.previousElementSibling && el.previousElementSibling.hidden);
                } else {
                    var text = ((el.textContent || '') + ' ' + (el.getAttribute('data-tags') || '')).toLowerCase();
                    el.hidden = q !== '' && text.indexOf(q) < 0;
                }
                if (!el.hidden) { labelHasRow = true; }
            }
        });
        if (label) { label.hidden = !labelHasRow; }
    });

    /* === Preferences and continuity ======================================== */
    function pref(name, fallback) {
        try {
            var v = localStorage.getItem('pc-' + name);
            return v === null ? fallback : v === '1';
        } catch (err) { return fallback; }
    }

    function initPrefs(layer) {
        document.querySelectorAll('input[data-pref]').forEach(function (box) {
            var name = box.getAttribute('data-pref');
            box.checked = pref(name, box.getAttribute('data-pref-default') === '1');
            box.addEventListener('change', function () {
                try { localStorage.setItem('pc-' + name, box.checked ? '1' : '0'); } catch (err) { }
            });
        });

        /* Opens from outside any window follow the maximize preference;
           a link inside a window inherits that window's state, PUDL's own
           behavior, which this leaves alone. */
        layer.addEventListener('pudl:window-place', function (e) {
            if (e.detail.placement || !pref('maximize-new', false)) { return; }
            if (e.detail.opener && e.detail.opener.closest && e.detail.opener.closest('.win')) { return; }
            e.detail.placement = { mode: 'maximized', x: 0.06, y: 0.05, w: 0.55, h: 0.75 };
        });

        /* The window arrangement, remembered for the next bare visit. */
        document.addEventListener('pudl:windows-change', function () {
            var parts = [];
            new URLSearchParams(location.search).forEach(function (value, key) {
                if (isWinParam(key)) { parts.push(key + '=' + encodeURIComponent(value)); }
            });
            try {
                if (parts.length) { localStorage.setItem('pc-windows', parts.join('&')); }
                else { localStorage.removeItem('pc-windows'); }
            } catch (err) { }
        });

        /* The list state (category and filter), remembered in a cookie the
           server redirects on for the next bare visit. */
        function saveListState() {
            var q = new URLSearchParams(location.search);
            var list = new URLSearchParams();
            q.getAll('cat').forEach(function (v) { list.append('cat', v); });
            q.getAll('tag').forEach(function (v) { list.append('tag', v); });
            if (q.get('q')) { list.set('q', q.get('q')); }
            document.cookie = list.toString()
                ? 'pc-list=' + encodeURIComponent(list.toString()) + '; path=/; max-age=31536000; SameSite=Lax'
                : 'pc-list=; path=/; max-age=0; SameSite=Lax';
        }
        document.addEventListener('pudl:regions-swap', saveListState);
        saveListState();

        /* The category and tag menus: a checkbox change rewrites the filter
           form's matching hidden inputs and submits it, which pudl-regions
           turns into a region swap; the boxes re-sync from the URL after
           every swap, Back and Forward included, so the panel can stay
           open across any number of checks. */
        function syncFilterMenus() {
            var q = new URLSearchParams(location.search);
            document.querySelectorAll('[data-filter-menu]').forEach(function (panel) {
                var name = panel.getAttribute('data-filter-menu');
                var chosen = q.getAll(name).map(function (v) { return v.toLowerCase(); });
                panel.querySelectorAll('input[type="checkbox"]').forEach(function (box) {
                    box.checked = chosen.indexOf(box.value.toLowerCase()) >= 0;
                });
            });
        }

        document.addEventListener('change', function (e) {
            var panel = e.target.closest && e.target.closest('[data-filter-menu]');
            if (!panel) { return; }
            var form = document.querySelector('.md-filter-group');
            if (!form) { return; }
            var name = panel.getAttribute('data-filter-menu');
            form.querySelectorAll('input[type="hidden"][name="' + name + '"]').forEach(function (i) { i.remove(); });
            panel.querySelectorAll('input[type="checkbox"]:checked').forEach(function (box) {
                var input = document.createElement('input');
                input.type = 'hidden';
                input.name = name;
                input.value = box.value;
                form.appendChild(input);
            });
            form.requestSubmit();
        });

        document.addEventListener('pudl:regions-swap', syncFilterMenus);
        window.addEventListener('popstate', syncFilterMenus);
        syncFilterMenus();
    }

    /* Runs before pudl-windows initializes (this script is not deferred),
       so a bare desktop URL picks up the saved arrangement in time. */
    function restoreWindows() {
        if (!document.querySelector('[data-win-layer]')) { return; }
        if (!pref('resume-windows', true)) { return; }
        var q = new URLSearchParams(location.search);
        var hasWinParams = false;
        q.forEach(function (v, k) { if (isWinParam(k)) { hasWinParams = true; } });
        if (hasWinParams) { return; }
        var saved;
        try { saved = localStorage.getItem('pc-windows'); } catch (err) { return; }
        if (!saved) { return; }
        var sep = location.search ? '&' : '?';
        history.replaceState(history.state, '', location.pathname + location.search + sep + saved);
    }

    function init() {
        var layer = document.querySelector('[data-win-layer]');
        if (!layer) { return; }

        layer.addEventListener('pudl:window-open', function (e) {
            enhance(e.target);
        });
        /* Windows the server rendered with the page arrive without
           pudl:window-open, so they are enhanced here. */
        layer.querySelectorAll(':scope > .win[data-win]').forEach(enhance);

        initPrefs(layer);

        /* Close-all: with script, each top-level window closes in place
           (children go with their parents); the link's own href is the
           windowless state for a browser without script. */
        var closeAll = document.querySelector('[data-close-all]');
        if (closeAll) {
            closeAll.addEventListener('click', function (e) {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { return; }
                e.preventDefault();
                if (!window.pudlWindows) { return; }
                window.pudlWindows.state().open.forEach(function (key) {
                    var el = layer.querySelector('.win[data-win="' + key + '"]');
                    if (el && !el.hasAttribute('data-win-parent')) { window.pudlWindows.close(key); }
                });
            });
            document.addEventListener('pudl:windows-change', function () {
                var none = !window.pudlWindows || window.pudlWindows.state().open.length === 0;
                closeAll.classList.toggle('is-disabled', none);
                if (none) { closeAll.setAttribute('aria-disabled', 'true'); closeAll.tabIndex = -1; }
                else { closeAll.removeAttribute('aria-disabled'); closeAll.tabIndex = 0; }
            });
        }
    }

    restoreWindows();
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
    else { init(); }
})();
