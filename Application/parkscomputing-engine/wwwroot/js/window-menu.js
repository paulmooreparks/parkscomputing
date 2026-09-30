/* The window menu, its stand-in on an applet's own page, and the window
   bar's commands. A window's title bar starts with a menu button (Pages/Shared/_Window.cshtml) whose
   menu holds the window's commands, which PUDL carries out through their
   data-win-action, and below a separator the commands of the applet in
   the window. The site proposes it to PUDL in
   Architecture/pudl-proposal-window-menu.md.

   An applet offers commands by answering pc:window-menu on its mount:

     root.addEventListener('pc:window-menu', function (e) {
       e.detail.add('Settings…', openSettings);
       e.detail.add('Wrap lines', toggleWrap, { checked: wrapping });
     });

   The event fires each time the menu opens, so the labels can say what is
   true at that moment. On an applet's own page, where there is no title
   bar, an applet that has commands says so by firing pc:applet-commands on
   its mount once it starts, and this puts a small menu button in the
   mount's top corner holding the same commands. Load with defer. */
(function () {
    'use strict';
    if (window.pcWindowMenu) { return; }

    var count = 0;

    /* Asks the applets in an element for their commands. */
    function gather(scope) {
        var items = [];
        var detail = {
            add: function (label, run, opts) { items.push({ label: label, run: run, checked: opts && typeof opts.checked === 'boolean' ? opts.checked : null, disabled: !!(opts && opts.disabled) }); }
        };
        var mounts = scope.matches && scope.matches('[data-applet]') ? [scope] : Array.prototype.slice.call(scope.querySelectorAll('[data-applet]'));
        mounts.forEach(function (m) { m.dispatchEvent(new CustomEvent('pc:window-menu', { detail: detail })); });
        return items;
    }

    function render(box, items) {
        box.innerHTML = '';
        items.forEach(function (it, i) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'menu-action';
            b.setAttribute('data-app-cmd', String(i));
            if (it.checked !== null) { b.setAttribute('role', 'menuitemcheckbox'); b.setAttribute('aria-checked', String(it.checked)); }
            if (it.disabled) { b.disabled = true; }
            b.textContent = it.label;
            box.appendChild(b);
        });
        box._items = items;
    }

    function run(e) {
        var b = e.target.closest('[data-app-cmd]');
        if (!b) { return; }
        var box = b.parentElement, it = box && box._items && box._items[+b.getAttribute('data-app-cmd')];
        if (it && typeof it.run === 'function') { it.run(); }
    }

    /* === In a window ======================================================= */

    document.addEventListener('beforetoggle', function (e) {
        var panel = e.target;
        if (e.newState !== 'open' || !panel.classList) { return; }
        if (panel.classList.contains('win-menu')) {
            var win = panel.closest('.win');
            if (!win) { return; }
            var max = panel.querySelector('[data-win-menu="maximize"]');
            if (max) { max.textContent = win.getAttribute('data-win-mode') === 'floating' ? 'Maximize' : 'Restore'; }
            var items = gather(win.querySelector('.win-body') || win);
            render(panel.querySelector('[data-win-menu-app]'), items);
            var sep = panel.querySelector('[data-win-menu-sep]');
            if (sep) { sep.hidden = !items.length; }
        } else if (panel.classList.contains('applet-menu')) {
            render(panel, gather(panel.closest('[data-applet]') || panel.parentElement));
        }
    }, true);

    document.addEventListener('click', run);

    /* A numbered window (terminal-2) is PUDL's copy of another's markup, so
       its menu takes an id of its own. */
    document.addEventListener('pudl:window-open', function (e) {
        var win = e.target, key = win && win.getAttribute && win.getAttribute('data-win');
        var panel = key && win.querySelector('.win-menu'), btn = key && win.querySelector('.win-menu-btn');
        if (!panel || !btn || panel.id === 'win-menu-' + key) { return; }
        panel.id = 'win-menu-' + key;
        btn.setAttribute('popovertarget', panel.id);
    });

    /* === On an applet's own page ========================================= */

    document.addEventListener('pc:applet-commands', function (e) {
        var mount = e.target;
        if (!mount || !mount.closest || mount.closest('.win') || mount.querySelector('.applet-menu-btn')) { return; }
        /* An applet with a toolbar of its own marks a place in it with
           data-applet-menu-slot; one without gets the button in its top
           corner. */
        var slot = mount.querySelector('[data-applet-menu-slot]');
        var id = 'applet-menu-' + (++count);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'icon-btn applet-menu-btn';
        btn.setAttribute('popovertarget', id);
        btn.setAttribute('aria-label', 'Menu');
        btn.title = 'Menu';
        var panel = document.createElement('nav');
        panel.className = 'menu-panel applet-menu';
        panel.id = id;
        panel.setAttribute('popover', '');
        panel.setAttribute('aria-label', 'Menu');
        if (slot) {
            btn.classList.add('applet-menu-btn-slotted');
            slot.appendChild(btn);
            slot.appendChild(panel);
        } else {
            mount.appendChild(btn);
            mount.appendChild(panel);
            mount.classList.add('has-applet-menu');
        }
    });

    /* === The window bar ==================================================
       The top bar's window-wide commands (Pages/Shared/_WindowBar.cshtml)
       that PUDL has no attribute for:

       - [data-close-all] closes every top-level window in place, and stays
         a real link to the windowless state for a click that isn't plain;
       - [data-win-request="verb"], as in a menu's "New terminal", makes a
         PUDL applet request, which opens a new instance where a window link
         would raise the one already open. */

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

    window.pcWindowMenu = { gather: gather };
})();
