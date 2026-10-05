/* The Server log applet (Identity/RecentLogs.cs, Pages/Logs.cshtml): the
   server's recent log entries for the super-user, in a window or on the
   classic /logs page. The server draws the panel; this loads it into a
   mount that arrives empty, shows it again when the filters change,
   refreshes it every fifteen seconds while it can be seen, and asks for
   the passkey tap reading the log needs. */
(function () {
    'use strict';

    function panelOf(html) {
        return new DOMParser().parseFromString(html, 'text/html').querySelector('[data-logs-panel]');
    }

    pudlApplets.register('logs', {
        init: function (root) {
            /* The filters the panel was last drawn with, as a query. */
            var query = location.pathname === '/logs' ? location.search.replace(/^\?/, '') : '';

            function load() {
                return fetch('/logs?handler=Applet' + (query ? '&' + query : ''), { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'text/html' } })
                    .then(function (r) {
                        if (r.status === 404) { return '<div data-logs-panel><p>Only the site\'s super-user can read the server log.</p></div>'; }
                        if (!r.ok) { throw new Error(r.status); }
                        return r.text();
                    })
                    .then(function (html) {
                        var p = panelOf(html);
                        if (p && root.isConnected) { root.replaceChildren(document.importNode(p, true)); }
                    })
                    .catch(function () { /* The next refresh will try again. */ });
            }

            /* A change of filter shows the log again; on the classic page the
               address follows, so the view can be bookmarked. */
            function onSubmit(e) {
                var form = e.target.closest && e.target.closest('[data-logs-filters]');
                if (!form || !root.contains(form)) { return; }
                e.preventDefault();
                query = new URLSearchParams(new FormData(form)).toString();
                if (location.pathname === '/logs') { history.replaceState(history.state, '', '/logs?' + query); }
                load();
            }
            function onChange(e) {
                if (e.target.closest && e.target.closest('[data-logs-filters]') && root.contains(e.target)) {
                    e.target.form.requestSubmit();
                }
            }

            async function onClick(e) {
                var button = e.target.closest('[data-passkey]');
                if (!button || !root.contains(button) || !window.pcAccounts) { return; }
                e.stopPropagation();
                if (await window.pcAccounts.press(button, root)) { load(); }
            }

            /* Only while it can be seen: not in a hidden tab, a minimized
               window or a closed one. */
            var timer = setInterval(function () {
                if (document.hidden || !root.isConnected || !root.offsetParent) { return; }
                if (root.querySelector('[data-logs-filters]')) { load(); }
            }, 15000);

            if (!root.querySelector('[data-logs-panel]')) { load(); }
            root.addEventListener('submit', onSubmit);
            root.addEventListener('change', onChange);
            root.addEventListener('click', onClick, true);
            return {
                menus: function () {
                    return { titles: [{ label: 'Server log', items: [{ label: 'Refresh', run: load }, '-'].concat(window.pcAppletIdentity ? window.pcAppletIdentity(root) : []) }] };
                },
                destroy: function () {
                    clearInterval(timer);
                    root.removeEventListener('submit', onSubmit);
                    root.removeEventListener('change', onChange);
                    root.removeEventListener('click', onClick, true);
                }
            };
        }
    });
})();
