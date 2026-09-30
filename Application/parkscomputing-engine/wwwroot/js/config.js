/* Settings files: each applet's settings, and the desktop's, kept as JSON
   in ~/.config/<name>.json (Architecture/files-editor-design.md). On the
   edit origin ~ is the admin's directory on the server, so the settings
   follow the admin from device to device; on the public site ~ is in this
   browser, like the rest of it. A settings file is an ordinary file, so it
   can be read and edited in the terminal or the Editor too.

     pcConfig.load(name, defaults)  resolves to the settings, the file's
                                     values over the defaults
     pcConfig.get(name)             the settings as last loaded
     pcConfig.set(name, changes)    merges the changes in and saves; resolves
                                     to an error message or null
     pcConfig.onChange(name, fn)    fn(settings) whenever they change, here,
                                     in another window of this page, or in
                                     another tab; returns an unsubscribe

   An applet owns its settings and draws its own controls for them; this
   only keeps the files. Load with defer, after js/applets.js. */
(function () {
    'use strict';
    if (window.pcConfig) { return; }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('could not load ' + src)); };
            document.head.appendChild(s);
        });
    }

    var fsReady = null;
    function fs() {
        if (!fsReady) {
            fsReady = (window.pcSiteFs ? Promise.resolve() : loadScript(window.pcSiteFsSrc || '/js/sitefs.js'))
                .then(function () { return window.pcSiteFs.load(); })
                .then(function () { watch(); return window.pcSiteFs; })
                .catch(function (err) { fsReady = null; throw err; });
        }
        return fsReady;
    }

    var entries = {};   /* name -> { defaults, values, text, listeners: [] } */

    function pathOf(name) { return '~/.config/' + name + '.json'; }

    function merged(e) { return Object.assign({}, e.defaults, e.values); }

    async function readValues(F, name) {
        var n = F.resolve(F.home(), pathOf(name));
        if (!n || n.children) { return { text: null, values: {} }; }
        var text = await F.read(n);
        var obj = null;
        try { obj = JSON.parse(text); } catch (err) { obj = null; }
        return { text: text, values: obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {} };
    }

    function tell(name) {
        var e = entries[name];
        if (!e) { return; }
        /* Each listener gets its own copy, so one that changes what it was
           given can't change what another holds. */
        e.listeners.slice().forEach(function (fn) { try { fn(merged(e)); } catch (err) { if (window.console) { console.error(err); } } });
    }

    /* A change to ~ may be a settings file changed elsewhere: in another
       tab, or by hand in the Editor. Each loaded file is read again, and
       its listeners told if its text changed. */
    var watching = false;
    function watch() {
        if (watching) { return; }
        watching = true;
        window.pcSiteFs.onChange(function () {
            Object.keys(entries).forEach(async function (name) {
                /* A read begun before a save here, or during one, would
                   bring back the text the save replaced, so it counts only
                   if no save began while it ran. */
                var e0 = entries[name], version = e0 ? e0.version : 0;
                if (e0 && e0.saving) { return; }
                var got = await readValues(window.pcSiteFs, name).catch(function () { return null; });
                var e = entries[name];
                if (!got || !e || !e.loaded || e.saving || e.version !== version || got.text === e.text) { return; }
                e.text = got.text;
                e.values = got.values;
                tell(name);
            });
        });
    }

    async function load(name, defaults) {
        var F = await fs();
        var e = entry(name);
        e.defaults = Object.assign({}, e.defaults, defaults || {});
        if (!e.loaded) {
            var got = await readValues(F, name);
            if (!e.loaded) { e.values = got.values; e.text = got.text; e.loaded = true; }
        }
        return merged(e);
    }

    function entry(name) {
        return entries[name] || (entries[name] = { defaults: {}, values: {}, text: undefined, loaded: false, listeners: [], version: 0, saving: 0 });
    }

    function get(name) { var e = entries[name]; return e ? merged(e) : {}; }

    async function set(name, changes) {
        var F = await fs();
        var e = entry(name);
        if (!e.loaded) { await load(name, {}); }
        e.version++;
        e.saving++;
        try { return await save(F, name, e, changes); }
        finally { e.saving--; }
    }

    async function save(F, name, e, changes) {
        var values = Object.assign({}, e.values, changes);
        var text = JSON.stringify(values, null, 2) + '\n';
        var dir = F.resolve(F.home(), '~/.config');
        if (!dir) {
            var made = await F.mkdir(F.home(), '~/.config', true);
            if (made) { return made; }
        }
        /* The text is known before the write reports, so the change event
           the write raises finds nothing new to tell. */
        var before = e.text;
        e.text = text;
        e.values = values;
        var res = await F.write(F.home(), pathOf(name), text, false);
        if (res.error) {
            e.text = before;
            var got = await readValues(F, name).catch(function () { return null; });
            if (got) { e.values = got.values; e.text = got.text; }
            tell(name);
            return res.error;
        }
        tell(name);
        return null;
    }

    function onChange(name, fn) {
        var e = entry(name);
        if (!e.loaded) { load(name, {}).catch(function () { }); }
        e.listeners.push(fn);
        return function () {
            var l = entries[name] ? entries[name].listeners : [];
            var i = l.indexOf(fn);
            if (i >= 0) { l.splice(i, 1); }
        };
    }

    window.pcConfig = { load: load, get: get, set: set, onChange: onChange };
})();
