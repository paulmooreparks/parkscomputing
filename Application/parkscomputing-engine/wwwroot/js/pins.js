/* Pins (Architecture/pins-design.md), in the pins bar at the top bar's
   right (PUDL 0.79.0, Architecture/pudl-0.79-integration.md): a folding
   toolbar whose one group holds a button a pin, its window's picture and
   its title, and a resident applet, pin-bar, whose Pins menu stays in the
   menu bar with Pin this window (or page) and Manage pins. The layout
   draws a signed-in reader's pins; this script draws a guest's, and draws
   every reader's again as they change. A plain press on a pin opens the
   item's window in the window view, and its page elsewhere. Each window's
   own menu offers Pin or Unpin too.

   A signed-in reader's pins are their account's: the page carries them
   (#pc-pins-data) and a change is saved with PUT /api/account/pins. A
   reader who is not signed in keeps them in this browser (pc-pins). Other
   tabs follow a change. */
(function () {
    'use strict';

    var bar = document.querySelector('.pin-bar');
    var group = bar && bar.querySelector('[data-pins-group]');
    var dataEl = document.getElementById('pc-pins-data');
    if (!group || !dataEl) { return; }
    var data = {};
    try { data = JSON.parse(dataEl.textContent) || {}; } catch (err) { data = {}; }

    var LOCAL = 'pc-pins';
    var store = data.store === 'account' ? 'account' : 'local';
    var channel = window.BroadcastChannel ? new BroadcastChannel('pc-pins') : null;
    var pins = [];

    function readLocal() {
        try { var v = JSON.parse(localStorage.getItem(LOCAL) || '[]'); return Array.isArray(v) ? v : []; } catch (err) { return []; }
    }
    function writeLocal(value) {
        try { if (value) { localStorage.setItem(LOCAL, JSON.stringify(value)); } else { localStorage.removeItem(LOCAL); } } catch (err) { /* storage blocked */ }
    }
    function same(a, b) { return a.key === b.key && (a.chapter || '') === (b.chapter || ''); }
    function indexOf(p) { for (var i = 0; i < pins.length; i++) { if (same(pins[i], p)) { return i; } } return -1; }
    function token() { var m = document.querySelector('meta[name="request-verification-token"]'); return m ? m.content : ''; }

    function put() {
        return fetch('/api/account/pins', {
            method: 'PUT', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', RequestVerificationToken: token() },
            body: JSON.stringify({ pins: pins })
        });
    }

    /* Saves the pins where they are kept. An account's save that is
       refused because the session ended while the page was open (the
       server then refuses the page's old token before it says who is
       signed in) asks the reader to sign in again, through the same
       dialog the file tools use, and saves once more, the pins as they are
       by then. Anything else leaves the pins here until the next change. */
    async function save() {
        if (channel) { channel.postMessage(pins); }
        if (store === 'local') { writeLocal(pins); return; }
        var r = await put().catch(function () { return null; });
        if (r && r.ok) { return; }
        var acc = window.pcAccounts;
        if (!r || !acc || !acc.freshToken || !acc.signIn) { return; }
        try {
            var now = await acc.freshToken();
            if (!now.signedIn) { await acc.signIn(); }
            await put();
        } catch (err) { /* they chose not to sign in */ }
    }

    if (store === 'account') {
        pins = (data.pins || []).slice();
        /* A browser's own pins join the account's the first time it signs in. */
        var local = readLocal();
        if (local.length) {
            var added = local.filter(function (l) { return indexOf(l) < 0; });
            writeLocal(null);
            if (added.length) { pins = pins.concat(added); save(); }
        }
    } else {
        pins = readLocal();
    }

    function desktop() { return !!(window.pudlWindows && document.querySelector('[data-win-layer]')); }
    function hrefOf(p) { return p.key === 'account' ? '/account' : '/page/' + p.key + (p.chapter ? '/' + p.chapter : ''); }

    /* === What can be pinned ============================================ */

    /* A window as a pin: the item it shows, so a numbered copy (a second
       terminal, a second window of a book) pins the item itself. Tag lists
       and framed external sites are views of something else. */
    /* Whether a window or page is an applet: whether it holds one, leaving
       out the comments under an article, which belong to the article. */
    function holdsApplet(scope) {
        return Array.prototype.some.call(scope.querySelectorAll('[data-applet]'), function (el) { return !el.closest('.discussion-mount'); });
    }

    function pinOfWindow(win) {
        var key = win.getAttribute('data-win');
        if (!key || /^(tag|ext)-/.test(key)) { return null; }
        var title = ((win.querySelector('.win-title') || {}).textContent || key).trim();
        var applet = holdsApplet(win);
        var book = win.querySelector('.book'), chapter = null;
        if (book) {
            if (book.getAttribute('data-book') && book.getAttribute('data-book') !== key) { key = book.getAttribute('data-book'); title = title.replace(/\s[2-9]$/, ''); }
            chapter = book.getAttribute('data-book-current') || null;
            var here = chapter ? book.querySelector('.book-tree a[aria-current]') : null;
            if (here) { title += ' · ' + here.textContent.trim(); }
            applet = false;
        } else if (applet) {
            var copy = /^(.+)-[2-9]$/.exec(key);
            if (copy) { key = copy[1]; title = title.replace(/\s[2-9]$/, ''); }
        }
        return { key: key, chapter: chapter, title: title, icon: win.getAttribute('data-window-icon') || null, applet: applet };
    }

    /* What is in front: the front window in the window view, the page in
       the classic view; null when nothing pinnable is. */
    function current() {
        if (desktop()) {
            var st = window.pudlWindows.state(), k = st.top;
            if (!k || st.min[k]) { return null; }
            var w = document.querySelector('.win[data-win="' + CSS.escape(k) + '"]');
            return w ? pinOfWindow(w) : null;
        }
        var c = data.current;
        if (!c) { return null; }
        var scopes = document.querySelectorAll('.content-body, .account-page');
        return { key: c.key, chapter: c.chapter || null, title: c.title, icon: c.icon || null, applet: Array.prototype.some.call(scopes, holdsApplet) };
    }

    function toggle(p) {
        var i = indexOf(p);
        if (i >= 0) { pins.splice(i, 1); } else { pins.push(p); }
        save(); render();
    }

    /* Opens a pin: in the window view its window, raised if it is open and
       turned to a book's chapter; elsewhere the link goes to its page. */
    function open(p) {
        if (!desktop()) { return false; }
        var key = p.key, st = window.pudlWindows.state();
        if (p.chapter) {
            var u = new URL(location.href);
            u.searchParams.set('c.' + key, p.chapter);
            history.replaceState(history.state, '', u.pathname + u.search.replace(/%2F/g, '/') + u.hash);
        }
        if (st.open.indexOf(key) >= 0) {
            window.pudlWindows.raise(key);
            var win = document.querySelector('.win[data-win="' + CSS.escape(key) + '"]');
            var book = win && win.querySelector('.book');
            if (book && (book.getAttribute('data-book-current') || '') !== (p.chapter || '') && window.pcLoadWindow) {
                window.pcLoadWindow(win, p.chapter || '', false).catch(function () { });
            }
        } else {
            window.pudlWindows.open(key);
        }
        return true;
    }

    /* === The pins bar ===================================================== */

    /* A pin as the bar shows it, as the layout draws one: a link to its
       page, holding its picture (an image, or the applet glyph, as the
       taskbar shows) and its title as the toolbar's words. */
    function pinButton(p) {
        var a = document.createElement('a');
        a.className = 'btn btn-sm';
        a.href = hrefOf(p);
        a.setAttribute('data-pin-key', p.key);
        if (p.chapter) { a.setAttribute('data-pin-chapter', p.chapter); }
        var icon;
        if (p.icon || !p.applet) {
            icon = document.createElement('img');
            icon.src = p.icon || '/favicon-16x16.png';
            icon.alt = '';
        } else {
            icon = document.createElement('span');
            icon.className = 'glyph';
            icon.style.setProperty('--glyph', 'var(--glyph-app)');
            icon.setAttribute('aria-hidden', 'true');
        }
        var words = document.createElement('span');
        words.className = 'toolbar-words';
        words.textContent = p.title;
        a.append(icon, words);
        return a;
    }

    /* A plain press on a pin opens the item's window in the window view
       rather than leaving the page; any other press follows the link. */
    group.addEventListener('click', function (e) {
        var a = e.target.closest('a[data-pin-key]');
        if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) { return; }
        var p = { key: a.getAttribute('data-pin-key'), chapter: a.getAttribute('data-pin-chapter') || null };
        var i = indexOf(p);
        if (i >= 0 && open(pins[i])) { e.preventDefault(); }
    });

    /* The Pins menu's rows depend on the pins and on what is in front. */
    function refreshMenu() { if (window.pudlMenubar && window.pudlMenubar.refresh) { window.pudlMenubar.refresh(); } }

    /* Writes the pins into the bar, which folds again as they change, and
       tells whoever is listening, such as the Pins applet. */
    var listeners = [];
    function render() {
        group.replaceChildren.apply(group, pins.map(pinButton));
        refreshMenu();
        listeners.slice().forEach(function (fn) { try { fn(pins.slice()); } catch (err) { if (window.console) { console.warn('pins:', err); } } });
    }

    /* For the Pins applet (js/pins-manager.js), which reorders, removes and
       adds pins through the same list, so the bar, the applet, every window
       menu and other tabs agree, and the pins are kept as they always are. */
    window.pcPins = {
        list: function () { return pins.slice(); },
        has: function (p) { return indexOf(p) >= 0; },
        add: function (p) { if (indexOf(p) < 0) { pins.push(p); save(); render(); } },
        remove: function (p) { var i = indexOf(p); if (i >= 0) { pins.splice(i, 1); save(); render(); } },
        move: function (from, to) {
            if (from < 0 || from >= pins.length || to < 0 || to >= pins.length || from === to) { return; }
            pins.splice(to, 0, pins.splice(from, 1)[0]);
            save(); render();
        },
        open: function (p) { return open(p); },
        href: hrefOf,
        onChange: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
    };

    /* The Pins menu, from the resident applet pin-bar, whose root is the
       pins bar (PUDL 0.79.0): Pin this window, ticked while what is in
       front is pinned and unavailable when nothing pinnable is, and Manage
       pins, which opens the pins manager. */
    if (window.pudlApplets && window.pudlApplets.register) {
        window.pudlApplets.register('pin-bar', {
            init: function () {
                return {
                    menus: function () {
                        var front = current();
                        return { titles: [
                            { id: 'pins', label: 'Pins', glyph: 'pin', items: [
                                { label: desktop() ? 'Pin this window' : 'Pin this page', glyph: 'pin', checked: !!(front && indexOf(front) >= 0),
                                  disabled: !front, reason: 'Nothing that can be pinned is in front', run: function () { var f = current(); if (f) { toggle(f); } } },
                                '-',
                                { label: 'Manage pins…', glyph: 'gear', run: function () {
                                    if (desktop()) { window.pudlWindows.open('pins'); } else { location.href = '/pins'; }
                                } }
                            ] }
                        ] };
                    },
                    destroy: function () { }
                };
            }
        });
    }
    /* What is in front changes with the windows, and the menu with it. */
    document.addEventListener('pudl:windows-change', refreshMenu);

    /* === Pinning from a window, and keeping pins current ================= */

    document.addEventListener('pudl:window-menu', function (e) {
        var win = e.target;
        if (!win || !win.matches || !win.matches('.win[data-win]')) { return; }
        var p = pinOfWindow(win);
        if (!p) { return; }
        e.detail.add(indexOf(p) >= 0 ? 'Unpin' : 'Pin', function () { toggle(p); });
    });

    /* A pinned item's window shows its current title and icon, and its pin
       takes them, so a renamed article's pin follows it. */
    document.addEventListener('pudl:window-open', function (e) {
        var p = e.target && e.target.matches && e.target.matches('.win[data-win]') ? pinOfWindow(e.target) : null;
        var i = p ? indexOf(p) : -1;
        if (i < 0 || (pins[i].title === p.title && (pins[i].icon || null) === p.icon && !!pins[i].applet === p.applet)) { return; }
        pins[i] = p;
        save(); render();
    });

    if (channel) { channel.onmessage = function (e) { if (Array.isArray(e.data)) { pins = e.data; render(); } }; }
    window.addEventListener('storage', function (e) { if (store === 'local' && e.key === LOCAL) { pins = readLocal(); render(); } });

    render();
})();
