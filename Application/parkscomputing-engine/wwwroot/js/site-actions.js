/* What the site adds to PUDL's applet actions (pudl-actions.js, PUDL
   0.68.0; Architecture/applet-platform-design.md, P2): its own two
   capabilities, files.read and files.write, with the file service an
   action that declares one is handed, and the page's own actions
   (js/actions/page.json), which belong to no applet. Load with defer,
   after pudl-actions.js and js/applets.js.

   A handler given files gets, on the site's file system (js/sitefs.js,
   the reader's ~ and the server's mounts as the reader may see them):

     files.stat(path)    an entry, or null    { name, path, kind, size?, modified? }
     files.list(path)    a directory's entries
     files.read(path)    a file's text
   and with files.write as well:
     files.write(path, text, append)  the written file's entry
     files.mkdir(path, parents)       true

   Callers: the Terminal and the chat act for the person at the page, so
   they pass grant: "all"; any other caller holds only artifact.create. */
(function () {
    'use strict';
    var A = window.pudlApplets;
    if (!A || !A.capability) { return; }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error('could not load ' + src)); };
            document.head.appendChild(s);
        });
    }

    /* The site files the services use, one copy a page. */
    var fsReady = null;
    function siteFs() {
        if (!fsReady) {
            fsReady = (window.pcSiteFs ? Promise.resolve() : loadScript(window.pcSiteFsSrc || '/js/sitefs.js'))
                .then(function () { return window.pcSiteFs.load(); })
                .then(function () { return window.pcSiteFs; }, function (err) { fsReady = null; throw err; });
        }
        return fsReady;
    }

    function filesService(writable) {
        function node(F, path) {
            var n = F.resolve(F.home(), String(path));
            if (!n) { throw new Error(path + ': no such file or directory'); }
            return n;
        }
        function entry(F, n) {
            var r = F.realOf(n), e = { name: n.name, path: F.displayPath(r), kind: F.kindOf(n) };
            var size = F.size(n);
            if (size != null) { e.size = size; }
            if (r.mtime) { e.modified = new Date(+r.mtime).toISOString(); }
            return e;
        }
        var s = {
            stat: function (path) { return siteFs().then(function (F) { var n = F.resolve(F.home(), String(path)); return n ? entry(F, n) : null; }); },
            list: function (path) {
                return siteFs().then(function (F) {
                    var n = F.realOf(node(F, path));
                    if (!n.children) { throw new Error(path + ': not a directory'); }
                    return n.children.map(function (c) { return entry(F, c); });
                });
            },
            read: function (path) {
                return siteFs().then(function (F) {
                    var n = node(F, path);
                    if (F.realOf(n).children) { throw new Error(path + ': is a directory'); }
                    return F.read(n);
                });
            }
        };
        if (writable) {
            s.write = function (path, text, append) {
                return siteFs().then(function (F) { return F.write(F.home(), String(path), String(text), !!append); }).then(function (res) {
                    if (res.error) { throw new Error(res.error); }
                    return entry(window.pcSiteFs, res.node);
                });
            };
            s.mkdir = function (path, parents) {
                return siteFs().then(function (F) { return F.mkdir(F.home(), String(path), !!parents); }).then(function (err) {
                    if (err) { throw new Error(err); }
                    return true;
                });
            };
        }
        return Object.freeze(s);
    }

    /* PUDL hands each service once, the first capability to give it
       winning, so an action that writes declares files.write alone: its
       service reads as well. */
    A.capability('files.read', function () { return { files: filesService(false) }; });
    A.capability('files.write', function () { return { files: filesService(true) }; });

    /* The page's notice and question for the person at it. Raise its v when
       page.json or page.js changes. */
    A.publish('/js/actions/page.json?v=2');
})();
