/* Pins (Architecture/pins-design.md), in PUDL's pins group (0.45.0). The
   menu bar draws the group from the hidden list the layout renders
   (ul[data-menubar-pins]): its first item is the Pins menu, whose command
   this script names for whatever is in front as the menu opens
   (pudl:pins-menu), and each later item is a pin, a link with the icon and
   title its window shows in the taskbar, which this script writes. The bar
   redraws when the list changes, collapses the pins to Items when they
   don't fit, and presses a pin's link on a plain press, which opens the
   item's window in the window view. Each window's own menu offers Pin or
   Unpin too.

   A signed-in reader's pins are their account's: the page carries them
   (#pc-pins-data) and a change is saved with PUT /api/account/pins. A
   reader who is not signed in keeps them in this browser (pc-pins). Other
   tabs follow a change. */
(function () {
    'use strict';

    var list = document.querySelector('[data-menubar-pins]');
    var command = list && list.querySelector('[data-pin-command]');
    var dataEl = document.getElementById('pc-pins-data');
    if (!list || !command || !dataEl) { return; }
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
    function pinOfWindow(win) {
        var key = win.getAttribute('data-win');
        if (!key || /^(tag|ext)-/.test(key)) { return null; }
        var title = ((win.querySelector('.win-title') || {}).textContent || key).trim();
        var applet = !!win.querySelector('[data-applet]');
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
        return { key: c.key, chapter: c.chapter || null, title: c.title, icon: c.icon || null, applet: !!document.querySelector('.content-body [data-applet], .account-page [data-applet]') };
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

    /* === The pins list the menu bar draws ============================== */

    /* A pin as the menu bar reads it: a link to its page, holding its icon
       (an image, or the applet glyph, as the taskbar shows) and its title. */
    function pinItem(p) {
        var li = document.createElement('li'), a = document.createElement('a');
        a.href = hrefOf(p);
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
        a.appendChild(icon);
        a.appendChild(document.createTextNode(' ' + p.title));
        /* The bar presses this link on a plain press; the window view opens
           the item's window instead of leaving the page. */
        a.addEventListener('click', function (e) {
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) { return; }
            if (open(p)) { e.preventDefault(); }
        });
        li.appendChild(a);
        return li;
    }

    /* Writes the pins after the Pins menu, which the menu bar redraws from. */
    function render() {
        while (list.children.length > 1) { list.removeChild(list.lastElementChild); }
        pins.forEach(function (p) { list.appendChild(pinItem(p)); });
    }

    /* The Pins menu's command names what is in front as the menu opens:
       Pin "title" or Unpin "title", there but unavailable when nothing
       pinnable is. */
    var front = null;
    list.addEventListener('pudl:pins-menu', function () {
        front = current();
        command.textContent = !front ? 'Pin' : (indexOf(front) >= 0 ? 'Unpin “' : 'Pin “') + front.title + '”';
        command.disabled = !front;
    });
    command.addEventListener('click', function () { if (front) { toggle(front); } });

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
