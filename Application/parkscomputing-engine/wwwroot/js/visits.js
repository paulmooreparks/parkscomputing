/* Visits (Identity/VisitReport.cs, Pages/Visits.cshtml): the automated
   readers the site counts, AI services and search engines, for its staff,
   in a window or on the classic /visits page. The server draws the panel
   (Pages/Shared/_VisitsContent.cshtml); this loads it into a mount that
   arrives empty, shows it again when the period changes, and refreshes it
   every minute while it can be seen, since the counts reach the database a
   minute at a time. */
(function () {
    'use strict';

    function panelOf(html) {
        // The panel and the rules drawn with it.
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var panel = doc.querySelector('[data-visits-panel]');
        if (!panel) { return null; }
        var frag = document.createDocumentFragment();
        doc.querySelectorAll('style').forEach(function (s) { frag.appendChild(document.importNode(s, true)); });
        frag.appendChild(document.importNode(panel, true));
        return frag;
    }

    pudlApplets.register('visits', {
        init: function (root) {
            /* The period the panel was last drawn for, as a query. */
            var query = location.pathname === '/visits' ? location.search.replace(/^\?/, '') : '';

            function load() {
                return fetch('/visits?handler=Applet' + (query ? '&' + query : ''), { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'text/html' } })
                    .then(function (r) {
                        if (r.status === 404) { return '<div data-visits-panel><p>Only the site\'s staff can see its visits.</p></div>'; }
                        if (!r.ok) { throw new Error(r.status); }
                        return r.text();
                    })
                    .then(function (html) {
                        var f = panelOf(html);
                        if (f && root.isConnected) { root.replaceChildren(f); }
                    })
                    .catch(function () { /* The next refresh will try again. */ });
            }

            /* A new period shows the panel again; on the classic page the
               address follows, so the view can be bookmarked. */
            function onSubmit(e) {
                var form = e.target.closest && e.target.closest('[data-visits-filters]');
                if (!form || !root.contains(form)) { return; }
                e.preventDefault();
                query = new URLSearchParams(new FormData(form)).toString();
                if (location.pathname === '/visits') { history.replaceState(history.state, '', '/visits?' + query); }
                load();
            }
            function onChange(e) {
                if (e.target.closest && e.target.closest('[data-visits-filters]') && root.contains(e.target)) {
                    e.target.form.requestSubmit();
                }
            }

            /* Only while it can be seen: not in a hidden tab, a minimized
               window or a closed one. */
            var timer = setInterval(function () {
                if (document.hidden || !root.isConnected || !root.offsetParent) { return; }
                if (root.querySelector('[data-visits-filters]')) { load(); }
            }, 60000);

            if (!root.querySelector('[data-visits-panel]')) { load(); }
            root.addEventListener('submit', onSubmit);
            root.addEventListener('change', onChange);
            return {
                menus: function () {
                    return { titles: [{ label: 'Visits', items: [{ label: 'Refresh', run: load }, '-'].concat(window.pcAppletIdentity ? window.pcAppletIdentity(root) : []) }] };
                },
                destroy: function () {
                    clearInterval(timer);
                    root.removeEventListener('submit', onSubmit);
                    root.removeEventListener('change', onChange);
                }
            };
        }
    });
})();
