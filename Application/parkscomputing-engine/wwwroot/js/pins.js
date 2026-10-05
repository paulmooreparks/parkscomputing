/* The Pins bar (Architecture/pins-design.md): a group in the top bar after
   the menu bar's own. Its first control is the Pins menu, with Pin or Unpin
   for whatever is in front; after it, a button for each pinned item, with
   the icon and title its window shows in the taskbar. When the buttons
   don't fit they all give way to an Items menu, and on a phone the pin
   glyph alone remains, its menu listing the pins. Each window's own menu
   offers Pin or Unpin too.

   A signed-in reader's pins are their account's: the page carries them
   (#pc-pins-data) and a change is saved with PUT /api/account/pins. A
   reader who is not signed in keeps them in this browser (pc-pins). Other
   tabs follow a change. */
(function () {
    'use strict';

    var bar = document.querySelector('[data-pinbar]');
    var dataEl = document.getElementById('pc-pins-data');
    if (!bar || !dataEl) { return; }
    var data = {};
    try { data = JSON.parse(dataEl.textContent) || {}; } catch (err) { data = {}; }

    var LOCAL = 'pc-pins';
    var store = data.store === 'account' ? 'account' : 'local';
    var channel = window.BroadcastChannel ? new BroadcastChannel('pc-pins') : null;
    var pins = [];

    function readLocal() {
        try { var v = JSON.parse(localStorage.getItem(LOCAL) || '[]'); return Array.isArray(v) ? v : []; } catch (err) { return []; }
    }
    function writeLocal(list) {
        try { if (list) { localStorage.setItem(LOCAL, JSON.stringify(list)); } else { localStorage.removeItem(LOCAL); } } catch (err) { /* storage blocked */ }
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
    function narrow() { return window.matchMedia && window.matchMedia('(max-width: 640px)').matches; }

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

    /* === Drawing the bar =============================================== */

    function iconOf(p, cls) {
        var el;
        if (p.icon || !p.applet) {
            el = document.createElement('img');
            el.src = p.icon || '/favicon-16x16.png';
            el.alt = '';
        } else {
            el = document.createElement('span');
            el.className = 'glyph';
            el.style.setProperty('--glyph', 'var(--glyph-app)');
        }
        el.classList.add(cls);
        el.setAttribute('aria-hidden', 'true');
        return el;
    }

    function link(p, cls) {
        var a = document.createElement('a');
        a.className = cls;
        a.href = hrefOf(p);
        a.title = p.title;
        a.appendChild(iconOf(p, cls === 'menu-action' ? 'pinbar-row-icon' : 'pinbar-icon'));
        var t = document.createElement('span');
        t.className = cls === 'menu-action' ? 'menubar-label' : 'pinbar-pin-title';
        t.textContent = p.title;
        a.appendChild(t);
        if (cls === 'menu-action') { a.setAttribute('role', 'menuitem'); }
        a.addEventListener('click', function (e) {
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) { return; }
            var panel = a.closest('[popover]');
            if (open(p)) { e.preventDefault(); }
            if (panel && panel.hidePopover) { try { panel.hidePopover(); } catch (err) { } }
        });
        return a;
    }

    function menuButton(id, label, glyph) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'pinbar-title';
        b.setAttribute('popovertarget', id);
        b.setAttribute('aria-haspopup', 'menu');
        b.setAttribute('aria-expanded', 'false');
        if (glyph) {
            b.setAttribute('aria-label', label);
            var g = document.createElement('span');
            g.className = 'pinbar-glyph';
            g.setAttribute('aria-hidden', 'true');
            b.appendChild(g);
        }
        var l = document.createElement('span');
        l.className = 'pinbar-label';
        l.textContent = label;
        b.appendChild(l);
        var panel = document.createElement('div');
        panel.className = 'menu-panel pinbar-panel';
        panel.id = id;
        panel.setAttribute('popover', '');
        panel.setAttribute('role', 'menu');
        panel.setAttribute('aria-label', label);
        panel.addEventListener('toggle', function (e) { b.setAttribute('aria-expanded', e.newState === 'open' ? 'true' : 'false'); });
        return { button: b, panel: panel };
    }

    var group = document.createElement('div');
    group.className = 'pinbar-group';
    var pinsMenu = menuButton('pc-pins-menu', 'Pins', true);
    var items = document.createElement('div');
    items.className = 'pinbar-items';
    var more = document.createElement('div');
    more.className = 'pinbar-more';
    var itemsMenu = menuButton('pc-pins-items', 'Items', false);
    more.appendChild(itemsMenu.button);
    group.appendChild(pinsMenu.button);
    group.appendChild(items);
    group.appendChild(more);
    bar.appendChild(group);
    bar.appendChild(pinsMenu.panel);
    bar.appendChild(itemsMenu.panel);

    /* The Pins menu, built as it opens, so its command names what is in
       front now: Pin "title" or Unpin "title", there but unavailable when
       nothing pinnable is. On a phone it lists the pins as well. */
    pinsMenu.panel.addEventListener('beforetoggle', function (e) {
        if (e.newState !== 'open') { return; }
        var panel = pinsMenu.panel, cur = current();
        panel.textContent = '';
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'menu-action';
        b.setAttribute('role', 'menuitem');
        var label = document.createElement('span');
        label.className = 'menubar-label';
        label.textContent = !cur ? 'Pin' : (indexOf(cur) >= 0 ? 'Unpin “' : 'Pin “') + cur.title + '”';
        b.appendChild(label);
        if (!cur) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
        b.addEventListener('click', function () { if (cur) { toggle(cur); } try { panel.hidePopover(); } catch (err) { } });
        panel.appendChild(b);
        if (narrow() && pins.length) {
            var sep = document.createElement('div');
            sep.className = 'menu-sep';
            sep.setAttribute('role', 'separator');
            panel.appendChild(sep);
            pins.forEach(function (p) { panel.appendChild(link(p, 'menu-action')); });
        }
    });

    itemsMenu.panel.addEventListener('beforetoggle', function (e) {
        if (e.newState !== 'open') { return; }
        itemsMenu.panel.textContent = '';
        pins.forEach(function (p) { itemsMenu.panel.appendChild(link(p, 'menu-action')); });
    });

    /* The buttons give way to Items, all together, when they don't fit. */
    function fit() {
        bar.classList.remove('pinbar-collapsed');
        if (!pins.length || narrow()) { return; }
        if (items.scrollWidth > items.clientWidth + 1) { bar.classList.add('pinbar-collapsed'); }
    }

    function render() {
        items.textContent = '';
        pins.forEach(function (p) { items.appendChild(link(p, 'pinbar-pin')); });
        more.hidden = !pins.length;
        bar.hidden = false;
        fit();
    }

    if (window.ResizeObserver) { new ResizeObserver(fit).observe(bar); } else { window.addEventListener('resize', fit); }

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
