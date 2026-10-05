/* The moderation queue's background applet (Architecture/status-area-design.md):
   its item in the status area shows what is waiting, comments and edits to
   review and open reports (Identity/ModerationNotices.cs). It asks the server
   every two minutes, when the tab comes back into view, and at once when the
   queue (js/moderation.js) announces a change with pc:moderation-changed. */
pcStatus.register('moderation', {
    start: function (item) {
        'use strict';
        function show(total) {
            item.count(total);
            item.label(total > 0 ? 'Moderation: ' + total + ' waiting' : 'Moderation: nothing waiting');
        }
        /* now asks even in a hidden tab, for a change the reader just made. */
        function ask(now) {
            if (document.hidden && now !== true) { return; }
            fetch('/api/moderation/count', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (v) { if (v && typeof v.total === 'number') { show(v.total); } })
                .catch(function () { /* The next ask will do. */ });
        }
        function onVisible() { if (!document.hidden) { ask(); } }
        function onChanged() { ask(true); }
        var timer = setInterval(ask, 2 * 60 * 1000);
        document.addEventListener('visibilitychange', onVisible);
        document.addEventListener('pc:moderation-changed', onChanged);
        return {
            stop: function () {
                clearInterval(timer);
                document.removeEventListener('visibilitychange', onVisible);
                document.removeEventListener('pc:moderation-changed', onChanged);
            }
        };
    }
});
