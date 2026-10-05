/* The status area's background applets (Architecture/status-area-design.md).

   The server draws the status area at the far right of the top bar, an
   item for each background applet with something to show this reader
   (Pages/Shared/_StatusArea.cshtml). This file names each background
   applet's script, as js/applets.js names applets, loads it only on a page
   whose status area holds its item, and starts it with that item.

   A background applet's script registers it:

     pcStatus.register('name', { start: function (item) { ...; return { stop: fn }; } });

   item.el is the item's link; item.count(n) sets its badge, hidden at 0;
   item.label(text) sets its accessible name and tooltip. Pressing an item
   follows its link, a window in the window view, unless the applet's own
   click listener on item.el prevents it. */
(function () {
    'use strict';
    if (window.pcStatus) { return; }

    /* Each background applet's script, with a version raised on every change. */
    var defined = {
        account: { src: '/js/status/account.js', ver: '2' },
        moderation: { src: '/js/status/moderation.js', ver: '1' }
    };
    var registered = {};

    function itemOf(el) {
        return {
            el: el,
            count: function (n) {
                var badge = el.querySelector('[data-status-count]');
                if (!badge) { return; }
                badge.textContent = String(n);
                badge.hidden = !n;
            },
            label: function (text) { el.setAttribute('aria-label', text); el.setAttribute('title', text); }
        };
    }

    function start(name) {
        var el = document.querySelector('[data-status-area] [data-status="' + name + '"]');
        if (!el || el.__pcStatus) { return; }
        el.__pcStatus = registered[name].start(itemOf(el)) || {};
    }

    window.pcStatus = {
        register: function (name, applet) { registered[name] = applet; start(name); }
    };

    function boot() {
        document.querySelectorAll('[data-status-area] [data-status]').forEach(function (el) {
            var name = el.getAttribute('data-status'), def = defined[name];
            if (!def || registered[name]) { return; }
            var s = document.createElement('script');
            s.src = def.src + '?v=' + def.ver;
            s.defer = true;
            document.head.appendChild(s);
        });
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', boot); } else { boot(); }
})();
