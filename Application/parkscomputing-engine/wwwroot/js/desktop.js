/* Desktop-mode wiring on top of pudl-windows.js and pudl-applets.js.

   Site responsibilities only:
   - Content enhancement (highlight.js, Mermaid) per arriving window.
   - The toolbar filter, live and written back to the URL.
   - Keeping tab, chip and form URLs carrying the live window state.
   - Soft category navigation: switching tab or removing a chip swaps the
     list chrome without touching the window layer.
   - A linked window opens in the same state as the window it was linked
     from (Paul's rule, 2026-09-27). */
(function () {
    'use strict';

    var WIN_PARAM = /^(open|top|min|p\.)/;

    function isWinParam(key) {
        return key === 'open' || key === 'top' || key === 'min' || key.indexOf('p.') === 0;
    }

    function enhance(win) {
        if (window.hljs) {
            win.querySelectorAll('pre code:not(.language-mermaid)').forEach(function (block) {
                window.hljs.highlightElement(block);
            });
        }
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
    }

    /* === The toolbar filter ================================================
       The server renders the ?q= filtered list; this refines it live and
       writes the value back into the URL once typing goes quiet. The
       sidebar is looked up per keystroke because soft navigation replaces
       the element. */
    function applyFilter(value) {
        var sidebar = document.querySelector('.md-sidebar');
        if (!sidebar) { return; }
        var q = value.trim().toLowerCase();
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
                    var text = (el.textContent || '').toLowerCase();
                    el.hidden = q !== '' && text.indexOf(q) < 0;
                }
                if (!el.hidden) { labelHasRow = true; }
            }
        });
        if (label) { label.hidden = !labelHasRow; }
    }

    function initFilter() {
        var input = document.querySelector('.md-filter');
        if (!input) { return; }
        var timer = 0;
        input.addEventListener('input', function () {
            applyFilter(input.value);
            clearTimeout(timer);
            timer = setTimeout(function () {
                var url = new URL(location.href);
                if (input.value.trim()) { url.searchParams.set('q', input.value.trim()); }
                else { url.searchParams.delete('q'); }
                history.replaceState(history.state, '', url);
            }, 400);
        });
    }

    /* === Live window state in the navigation URLs ==========================
       The open windows are the client area's state, not the tab's. The
       server rendered the tab, chip and form hrefs with the window
       parameters as of page load, but the script keeps the live state in
       the URL, so those links are refreshed from it on every change. */
    function syncNavState() {
        var current = [];
        new URLSearchParams(location.search).forEach(function (value, key) {
            if (isWinParam(key)) { current.push([key, value]); }
        });

        document.querySelectorAll('.app-section-bar a[href], .md-chips a[href]').forEach(function (a) {
            if (a.hasAttribute('data-win-open')) { return; }   // openers act on live state already
            var url = new URL(a.getAttribute('href'), location.href);
            if (url.origin !== location.origin || url.pathname !== location.pathname) { return; }
            Array.from(url.searchParams.keys()).forEach(function (k) {
                if (isWinParam(k)) { url.searchParams.delete(k); }
            });
            current.forEach(function (kv) { url.searchParams.append(kv[0], kv[1]); });
            a.setAttribute('href', url.pathname + url.search);
        });

        var form = document.querySelector('.desktop-filter-form');
        if (form) {
            form.querySelectorAll('input[type="hidden"]').forEach(function (input) {
                if (isWinParam(input.name)) { input.remove(); }
            });
            current.forEach(function (kv) {
                var input = document.createElement('input');
                input.type = 'hidden';
                input.name = kv[0];
                input.value = kv[1];
                form.appendChild(input);
            });
        }
    }

    /* === Soft category navigation ==========================================
       A tab or chip click is a navigation, but only the list chrome
       changes, so the new page is fetched and the tab strip, chips row and
       sidebar are swapped in place. The window layer is never touched:
       scroll positions hold and running applets keep running. The URL and
       history stay exactly what a full navigation would have produced. */
    function swapListChrome(doc) {
        ['.app-section-bar', '.md-sidebar'].forEach(function (sel) {
            var have = document.querySelector(sel);
            var next = doc.querySelector(sel);
            if (have && next) { have.replaceWith(next); }
        });

        var haveChips = document.querySelector('.md-chips');
        var nextChips = doc.querySelector('.md-chips');
        if (haveChips && nextChips) { haveChips.replaceWith(nextChips); }
        else if (haveChips) { haveChips.remove(); }
        else if (nextChips) {
            var toolbar = document.querySelector('.md-toolbar');
            if (toolbar) { toolbar.after(nextChips); }
        }

        var input = document.querySelector('.md-filter');
        var nextInput = doc.querySelector('.md-filter');
        if (input && nextInput) { input.value = nextInput.value; }
    }

    function softNavigate(url, push) {
        return fetch(url, { headers: { Accept: 'text/html' } })
            .then(function (r) {
                if (!r.ok) { throw new Error(url + ' returned ' + r.status); }
                return r.text();
            })
            .then(function (html) {
                var doc = new DOMParser().parseFromString(html, 'text/html');
                swapListChrome(doc);
                if (push) { history.pushState(history.state, '', url); }
                syncNavState();
            });
    }

    function plainClick(e) {
        return e.button === 0 && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
    }

    function onNavClick(e) {
        if (!plainClick(e)) { return; }
        var a = e.target.closest('.app-section-bar a[href], .md-chips a[href]');
        if (!a || a.hasAttribute('data-win-open') || a.target) { return; }
        var url = new URL(a.getAttribute('href'), location.href);
        if (url.origin !== location.origin || url.pathname !== location.pathname) { return; }
        e.preventDefault();
        softNavigate(url.pathname + url.search, true).catch(function () {
            location.href = url.href;
        });
    }

    /* === A linked window opens in the same state as its opener ============= */
    function initOpenerInheritance(layer) {
        var openerKey = null;
        var openerAt = 0;

        layer.addEventListener('click', function (e) {
            var a = e.target.closest('a[data-win-open]');
            if (!a || a.hasAttribute('data-win-replace')) { return; }  // a replacement keeps the old placement already
            var win = a.closest('.win');
            openerKey = win ? win.getAttribute('data-win') : null;
            openerAt = Date.now();
        });

        layer.addEventListener('pudl:window-place', function (e) {
            if (e.detail.placement) { return; }
            if (!openerKey || Date.now() - openerAt > 2000) { return; }
            var place = window.pudlWindows && window.pudlWindows.state().place[openerKey];
            openerKey = null;
            if (!place) { return; }
            /* Same mode as the opener; the floating geometry cascades a
               step so the opener stays visible behind a floating window. */
            e.detail.placement = {
                mode: place.mode,
                x: Math.min(0.96, place.x + 0.03),
                y: Math.min(0.96, place.y + 0.03),
                w: place.w,
                h: place.h
            };
        });
    }

    function init() {
        initFilter();

        var layer = document.querySelector('[data-win-layer]');
        if (!layer) { return; }

        layer.addEventListener('pudl:window-open', function (e) {
            enhance(e.target);
        });

        initOpenerInheritance(layer);

        /* In an image window the plain arrow keys step between images, as
           they do in the classic lightbox. Captured before pudl-windows'
           own keyboard handling, which keeps Shift+arrows for resizing;
           windows without image nav keep arrow-key movement. */
        layer.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') { return; }
            if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) { return; }
            if (e.target.closest && e.target.closest('input, textarea, select')) { return; }
            var win = e.target.closest && e.target.closest('.win');
            if (!win) { return; }
            var nav = win.querySelector('.win-img-nav');
            if (!nav) { return; }
            e.preventDefault();
            e.stopPropagation();
            var link = nav.querySelector('[data-img-nav="' + (e.key === 'ArrowLeft' ? 'prev' : 'next') + '"]');
            if (link) { link.click(); }
        }, true);

        document.addEventListener('click', onNavClick);

        /* Accepting the filter (Enter, or its button) is the same soft
           navigation as a tab click; the form still works without script. */
        document.addEventListener('submit', function (e) {
            var form = e.target.closest && e.target.closest('.desktop-filter-form');
            if (!form) { return; }
            e.preventDefault();
            var url = new URL(form.getAttribute('action') || '/', location.href);
            new FormData(form).forEach(function (value, key) {
                if (key === 'q' && !String(value).trim()) { return; }
                url.searchParams.append(key, value);
            });
            softNavigate(url.pathname + url.search, true).catch(function () {
                location.href = url.href;
            });
        });
        layer.addEventListener('pudl:windows-change', syncNavState);
        window.addEventListener('popstate', function () {
            /* pudl-windows brings the windows in line; the list chrome
               follows the URL the same way. */
            softNavigate(location.pathname + location.search, false).catch(function () { });
        });
        syncNavState();
    }

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
    else { init(); }
})();
