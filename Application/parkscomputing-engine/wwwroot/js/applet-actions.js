/* The applet action broker (Architecture/applet-platform-design.md, P2, and
   Architecture/pudl-proposal-applet-actions.md). Applets publish actions in
   GK Companion's contract, and a script in the Terminal, the page itself or,
   later, an MCP client calls them here, without opening the applet's window
   unless the action is about a window.

   Each applet's actions are a manifest file of their own, which its define()
   points to with actions: '/js/actions/x.json'. A manifest is GK's:

     { "id": "parks.dice", "version": "1.0.0", "apiVersion": 1,
       "title": "Dice", "description": "…",
       "module": "dice.js",             optional, beside the manifest
       "actions": [ { "ref": "parks.dice/roll@1", "title", "description",
                      "inputSchema", "outputSchema",
                      "capabilities": [], "replay": "pure",
                      "handles": "open" } ] }   optional, see below

   The module is a script that hands its handlers over:

     pcActions.provide('parks.dice', {
       'roll@1': function (input, ctx) { return { output: { … } }; }
     });

   A handler resolves to { output, artifacts, request }: output an object;
   artifacts, with artifact.create, a list of { key, name, mime, data }, each
   put into the output under its key as a descriptor; request, with
   attention.request and replay "human", a question for the person, { title,
   body, fields: [{ name, label, type: text|boolean|choice, required,
   choices }] }, whose answer becomes output.response. ctx is the invocation
   (id, owner, signal) and only the services the action declared: files
   (files.read, and write and mkdir with files.write), open(verb, request)
   (window.open) and notify(text, kind) (notification.post), with load(src)
   and beside(rel) for the module's own files.

   An action with handles is one of the applet's handles verbs: the broker
   asks PUDL for the window, as pudlApplets.request does, and needs no
   module. In the classic view, where a request would leave the page, it
   opens the applet's page in a new tab instead, so a script asking for a
   window never navigates away from the Terminal it runs in.

   The capability list is closed: a manifest declaring anything else is
   refused when the catalog loads. A caller is granted a list (the Terminal
   all of it) and may run only actions whose capabilities it holds. */
(function () {
    'use strict';
    if (window.pcActions) { return; }

    /* The rules every host shares (manifests, schemas, results) are in
       js/applet-actions-core.js, which the server's runner for MCP also
       runs; this file is the page's side: loading, windows, services,
       records and the person's dialog. */
    var PROVIDER_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
    var RECORD_ID = /^[A-Za-z0-9_-]{1,128}$/;
    var KEEP = 200;
    var RUN_MS = 60000, ANSWER_MS = 10 * 60000;

    var here = document.currentScript ? document.currentScript.src : location.href;
    function beside(rel, base) { return new URL(rel, base || here).href; }
    var C = null;   // window.pcActionsCore, once validatorLib() has loaded it

    /* === Loading ======================================================== */

    var scripts = {};
    function loadScript(src) {
        if (!scripts[src]) {
            scripts[src] = new Promise(function (resolve, reject) {
                var s = document.createElement('script');
                s.src = src;
                s.onload = function () { resolve(); };
                s.onerror = function () { delete scripts[src]; reject(new Error('could not load ' + src)); };
                document.head.appendChild(s);
            });
        }
        return scripts[src];
    }

    /* The shared rules, stamped as this file is, then the schema library. */
    var schemaLib = null;
    function validatorLib() {
        if (!schemaLib) {
            schemaLib = (window.pcActionsCore ? Promise.resolve() : loadScript(beside('applet-actions-core.js' + new URL(here).search)))
                .then(function () {
                    C = window.pcActionsCore;
                    return import(beside('vendor/cfworker-json-schema-4.1.1/index.js'));
                })
                .catch(function (err) {
                    schemaLib = null;
                    throw new Error('the schema validator could not be loaded (' + err.message + ')');
                });
        }
        return schemaLib;
    }

    /* The site files the files.* services use (js/sitefs.js), one copy a page. */
    var fsReady = null;
    function siteFs() {
        if (!fsReady) {
            fsReady = (window.pcSiteFs ? Promise.resolve() : loadScript(window.pcSiteFsSrc || beside('sitefs.js')))
                .then(function () { return window.pcSiteFs.load(); })
                .then(function () { return window.pcSiteFs; }, function (err) { fsReady = null; throw err; });
        }
        return fsReady;
    }

    /* The shared rules, by the names this file used before they moved. */
    function check(validator, value, what) { return C.check(validator, value, what); }
    function asJSON(value, what) { return C.asJSON(value, what); }

    /* === The catalog ====================================================
       window.pcAppletActions, which js/applets.js fills from define(), lists
       { applet, manifest, handles, page } for each applet with actions. */

    var catalogReady = null;
    var catalogState = null;   // { manifests, actions: ref -> entry, problems }
    var providers = {};        // provider id -> handlers its module gave
    var providerWaits = {};

    function sources() { return (window.pcAppletActions || []).slice(); }

    function load() {
        if (!catalogReady) {
            var list = sources();
            catalogReady = Promise.all([validatorLib()].concat(list.map(function (s) {
                return fetch(s.manifest, { credentials: 'same-origin' }).then(function (r) {
                    if (!r.ok) { throw new Error(r.status + ' ' + r.statusText); }
                    return r.json();
                }).then(function (m) { return { source: s, manifest: m }; }, function (err) {
                    return { source: s, error: (s.applet || s.manifest) + ': the manifest could not be read (' + err.message + ')' };
                });
            }))).then(function (all) {
                catalogState = build(all[0], all.slice(1));
                return catalogState;
            }, function (err) { catalogReady = null; throw err; });
        }
        return catalogReady;
    }

    function build(lib, loaded) {
        var state = { manifests: [], actions: {}, problems: [] };
        var ids = {};
        loaded.forEach(function (l) {
            if (l.error) { state.problems.push(l.error); return; }
            try {
                var source = l.source;
                var entries = C.checkManifest(lib, l.manifest, ids, function (verb) { return !!(source.handles && source.handles[verb]); });
                ids[l.manifest.id] = true;
                entries.forEach(function (e) { e.source = source; state.actions[e.action.ref] = e; });
                state.manifests.push(C.publicManifest(l.manifest));
            } catch (err) {
                state.problems.push((l.manifest && l.manifest.id || l.source.applet || l.source.manifest) + ': ' + err.message);
            }
        });
        return state;
    }


    function provide(id, handlers) {
        if (!PROVIDER_ID.test(id || '') || !handlers || typeof handlers !== 'object') { throw new Error('pcActions.provide needs a provider id and its handlers'); }
        providers[id] = handlers;
        (providerWaits[id] || []).forEach(function (w) { w(); });
        delete providerWaits[id];
    }

    function moduleUrl(e) {
        var url = new URL(e.provider.module, new URL(e.source.manifest, location.href));
        /* The module is stamped as its manifest is, so a raised ver reaches both. */
        if (!url.search) { url.search = new URL(e.source.manifest, location.href).search; }
        return url.href;
    }

    function handlerFor(e) {
        if (e.action.handles != null) { return Promise.resolve(windowHandler(e)); }
        var id = e.provider.id;
        var got = function () {
            var h = providers[id] && providers[id][e.local];
            if (typeof h !== 'function') { throw new Error(id + '\'s module gives no handler for ' + e.local); }
            return h;
        };
        if (providers[id]) { return Promise.resolve().then(got); }
        return loadScript(moduleUrl(e)).then(function () {
            if (providers[id]) { return got(); }
            return new Promise(function (resolve) { (providerWaits[id] = providerWaits[id] || []).push(resolve); setTimeout(resolve, 3000); }).then(got);
        });
    }

    /* === Windows ========================================================
       The state a verb's request carries, as pudlApplets.request builds it:
       the path in the verb's param, then its extra parameters. */
    function stateOf(h, req) {
        var pairs = [[h.param, req.path]];
        (h.extra || []).forEach(function (k) { pairs.push([k, req[k]]); });
        return pairs.filter(function (p) { return p[0] && p[1] != null && p[1] !== ''; }).map(function (p) {
            return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]).replace(/%2F/g, '/').replace(/%7E/g, '~');
        }).join('&');
    }

    function openWindow(source, verb, req) {
        var h = source.handles && source.handles[verb];
        if (!h) { throw new Error((source.applet || 'this applet') + ' does not handle ' + verb); }
        req = Object.assign({}, req);
        if (!req.kind && h.kinds && h.kinds.length) { req.kind = h.kinds[0]; }
        var windowed = window.pudlWindows && document.querySelector('[data-win-layer]');
        if (windowed) {
            if (!window.pudlApplets.request(verb, req, null)) { throw new Error('nothing on this page opens it'); }
            return { opened: true, view: 'window' };
        }
        if (!source.page) { throw new Error((source.applet || 'this applet') + ' has no page to open'); }
        var state = stateOf(h, req);
        var w = window.open(source.page + (state ? (source.page.indexOf('?') < 0 ? '?' : '&') + state : ''), '_blank');
        if (!w) { throw new Error('the browser did not open the new tab'); }
        w.opener = null;
        return { opened: true, view: 'tab' };
    }

    function windowHandler(e) {
        return function (input) { return { output: openWindow(e.source, e.action.handles, input) }; };
    }

    /* === Services a handler may be given ================================= */

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

    function contextFor(rec, e, signal) {
        var caps = e.action.capabilities, base = e.provider.module ? moduleUrl(e) : here;
        var ctx = {
            invocation: rec.id, owner: rec.owner, signal: signal,
            beside: function (rel) { return beside(rel, base); },
            load: function (src) { return loadScript(beside(src, base)); }
        };
        if (caps.indexOf('files.read') >= 0 || caps.indexOf('files.write') >= 0) { ctx.files = filesService(caps.indexOf('files.write') >= 0); }
        if (caps.indexOf('window.open') >= 0) {
            ctx.open = function (verb, req) {
                var src = sources().filter(function (s) { return s.handles && s.handles[verb]; })[0];
                if (!src) { throw new Error('nothing on this site handles ' + verb); }
                return openWindow(src, verb, req || {});
            };
        }
        if (caps.indexOf('notification.post') >= 0) {
            /* PUDL's toasts, which the site's pages do not load until a
               notice needs them. */
            ctx.notify = function (text, kind) {
                return (window.pudlToast ? Promise.resolve() : loadScript(beside('../pudl/pudl-toast.js'))).then(function () {
                    window.pudlToast(String(text), { kind: kind === 'info' ? undefined : kind, sticky: kind === 'danger' || kind === 'warn' });
                });
            };
        }
        return Object.freeze(ctx);
    }

    /* === Invocations ==================================================== */

    var records = new Map();

    function newId() {
        var b = new Uint8Array(16);
        crypto.getRandomValues(b);
        return Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    }

    function view(rec) {
        return JSON.parse(JSON.stringify({
            id: rec.id, action: rec.action, owner: rec.owner, status: rec.status, version: rec.version,
            input: rec.input, output: rec.output, error: rec.error || undefined, request: rec.request || undefined,
            artifacts: rec.artifacts.map(function (a) { return a.descriptor; }),
            created: rec.created, updated: rec.updated, deadline: rec.deadline || undefined
        }));
    }

    function changed(rec) {
        rec.version++;
        rec.updated = new Date().toISOString();
        document.dispatchEvent(new CustomEvent('pc:applet-invocation', { detail: view(rec) }));
    }

    function finish(rec, status, error) {
        if (rec.status === 'done' || rec.status === 'failed' || rec.status === 'cancelled') { return; }
        rec.status = status;
        if (error) { rec.error = error; }
        if (rec.timer) { clearTimeout(rec.timer); rec.timer = 0; }
        if (rec.dialog) { var d = rec.dialog; rec.dialog = null; if (d.open) { d.close(); } d.remove(); }
        changed(rec);
        rec.settle();
    }

    function keep() {
        if (records.size <= KEEP) { return; }
        for (var it of records) {
            var r = it[1];
            if (r.status !== 'running' && r.status !== 'waiting') { records.delete(it[0]); if (records.size <= KEEP) { return; } }
        }
    }

    async function sha256(bytes) {
        if (!(window.crypto && crypto.subtle)) { return null; }
        var d = await crypto.subtle.digest('SHA-256', bytes);
        return Array.prototype.map.call(new Uint8Array(d), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    }

    /* An artifact's data as the page measures it: text as UTF-8, and a hash
       where the browser offers one. */
    async function describe(data) {
        var bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data instanceof Uint8Array ? data : null;
        if (!bytes) { return null; }
        return { size: bytes.length, sha256: await sha256(bytes), keep: typeof data === 'string' ? data : bytes };
    }

    /* The handler's result as the output its schema sees (the shared rules). */
    function accept(rec, e, result) { return C.accept(rec, e, result, describe); }
    function checkRequest(q) { return C.checkRequest(q); }

    function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    /* A question for the person, as a dialog only they can answer. */
    function ask(rec, q) {
        return new Promise(function (resolve) {
            var dlg = document.createElement('dialog'), id = 'pc-ask-' + rec.id;
            dlg.className = 'dialog pc-ask';
            dlg.setAttribute('aria-labelledby', id + '-title');
            dlg.innerHTML =
                '<form method="dialog">' +
                  '<h3 class="dialog-title" id="' + id + '-title">' + esc(q.title) + '</h3>' +
                  '<div class="dialog-body">' +
                    (q.body ? '<p>' + esc(q.body) + '</p>' : '') +
                    q.fields.map(function (f, i) {
                        var fid = id + '-' + i, label = esc(f.label || f.name);
                        if (f.type === 'boolean') {
                            return '<div class="form-group"><label class="check"><input type="checkbox" name="' + esc(f.name) + '" /> ' + label + '</label></div>';
                        }
                        if (f.type === 'choice') {
                            return '<div class="form-group"><label class="form-label" for="' + fid + '">' + label + '</label>' +
                                '<div class="form-select-wrap"><select class="form-select" id="' + fid + '" name="' + esc(f.name) + '"' + (f.required ? ' required' : '') + '>' +
                                '<option value="">Choose…</option>' + f.choices.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') +
                                '</select></div></div>';
                        }
                        return '<div class="form-group"><label class="form-label" for="' + fid + '">' + label + '</label>' +
                            '<textarea class="form-textarea" rows="2" id="' + fid + '" name="' + esc(f.name) + '"' + (f.required ? ' required' : '') + '></textarea></div>';
                    }).join('') +
                    '<p class="form-help">Asked by ' + esc(rec.action) + (rec.owner && rec.owner.kind ? ' for ' + esc(rec.owner.kind) : '') + '.</p>' +
                  '</div>' +
                  '<div class="dialog-actions">' +
                    '<button type="button" class="btn" data-ask="cancel">Don\'t answer</button>' +
                    '<button type="submit" class="btn btn-primary">Answer</button>' +
                  '</div>' +
                '</form>';
            document.body.appendChild(dlg);
            rec.dialog = dlg;
            var answered = false;
            dlg.querySelector('form').addEventListener('submit', function (ev) {
                ev.preventDefault();
                var form = ev.target, response = {};
                if (!form.reportValidity()) { return; }
                q.fields.forEach(function (f) {
                    var c = form.elements[f.name];
                    response[f.name] = f.type === 'boolean' ? !!c.checked : c.value;
                });
                answered = true;
                resolve(response);
                dlg.close();
            });
            dlg.querySelector('[data-ask="cancel"]').addEventListener('click', function () { dlg.close(); });
            dlg.addEventListener('close', function () { if (!answered) { resolve(null); } });
            dlg.showModal();
        });
    }

    async function execute(rec, e, input) {
        var controller = new AbortController();
        rec.controller = controller;
        rec.timer = setTimeout(function () { finish(rec, 'failed', 'the action did not finish within ' + Math.round(rec.limits.run / 1000) + ' seconds'); controller.abort(); }, rec.limits.run);
        try {
            var handler = await handlerFor(e);
            if (rec.status !== 'running') { return; }
            var stopped = new Promise(function (resolve, reject) {
                controller.signal.addEventListener('abort', function () { reject(new Error('stopped')); });
            });
            var result = await Promise.race([Promise.resolve().then(function () { return handler(input, contextFor(rec, e, controller.signal)); }), stopped]);
            if (rec.status !== 'running') { return; }
            var output = await accept(rec, e, result);
            if (rec.status !== 'running') { return; }
            if (!result.request) {
                check(e.output, output, 'output from ' + e.action.ref);
                rec.output = output;
                finish(rec, 'done');
                return;
            }
            var q = checkRequest(result.request);
            clearTimeout(rec.timer);
            rec.output = output;
            rec.request = q;
            rec.status = 'waiting';
            rec.deadline = new Date(Date.now() + rec.limits.answer).toISOString();
            rec.timer = setTimeout(function () { finish(rec, 'failed', 'nobody answered in time'); }, rec.limits.answer);
            changed(rec);
            rec.waited();
            var response = await ask(rec, q);
            if (rec.status !== 'waiting') { return; }
            if (response == null) { finish(rec, 'cancelled', 'the question was not answered'); return; }
            output = Object.assign({}, output, { response: response });
            check(e.output, output, 'output from ' + e.action.ref);
            rec.output = output;
            finish(rec, 'done');
        } catch (err) {
            /* A record cancelled or timed out is already finished, and keeps
               the reason it was given. */
            finish(rec, 'failed', err && err.message || String(err));
        }
    }

    function sameCall(rec, ref, input) { return rec.action === ref && JSON.stringify(rec.input) === JSON.stringify(input); }

    /* Starts an action and resolves to its record once it has finished,
       failed or started waiting for a person. opts: id, an identity of the
       caller's own, under which a second call returns the first record
       instead of running again; owner { kind, id }; grant, the
       capabilities the caller holds (all of them by default); runMs and
       answerMs, the limits on running and on waiting for an answer. */
    async function invoke(ref, input, opts) {
        opts = opts || {};
        var cat = await load();
        var e = cat.actions[ref];
        if (!e) { throw new Error('there is no action ' + ref + (cat.problems.length ? ' (some applets\' actions could not be loaded; "applets" lists why)' : '')); }
        var grant = opts.grant || C.CAPABILITIES;
        var missing = e.action.capabilities.filter(function (c) { return grant.indexOf(c) < 0; });
        if (missing.length) { throw new Error(ref + ' needs ' + missing.join(', ') + ', which this caller was not granted'); }
        input = asJSON(input == null ? {} : input, 'the input');
        check(e.input, input, 'input to ' + ref);
        if (opts.id != null) {
            if (!RECORD_ID.test(String(opts.id))) { throw new Error('an invocation id is 1 to 128 letters, digits, - and _'); }
            var had = records.get(String(opts.id));
            if (had) {
                if (!sameCall(had, ref, input)) { throw new Error('invocation ' + opts.id + ' was a different call'); }
                await had.started;
                return view(had);
            }
        }
        var now = new Date().toISOString();
        var rec = {
            id: opts.id != null ? String(opts.id) : newId(), action: ref, owner: opts.owner || { kind: 'page' },
            status: 'running', version: 0, input: input, output: null, error: '', request: null, artifacts: [],
            created: now, updated: now, deadline: null,
            limits: { run: opts.runMs || RUN_MS, answer: opts.answerMs || ANSWER_MS }
        };
        rec.done = new Promise(function (resolve) { rec.settle = resolve; });
        rec.started = new Promise(function (resolve) { rec.waited = resolve; });
        rec.done.then(rec.waited);
        records.set(rec.id, rec);
        keep();
        changed(rec);
        execute(rec, e, input);
        await rec.started;
        return view(rec);
    }

    function find(id) {
        var rec = records.get(String(id));
        if (!rec) { throw new Error('there is no invocation ' + id); }
        return rec;
    }

    async function wait(id) {
        var rec = find(id);
        await rec.done;
        return view(rec);
    }

    /* Runs an action to its end, a person's answer included, and gives its
       output; a failed or cancelled action throws. */
    async function run(ref, input, opts) {
        var v = await invoke(ref, input, opts);
        if (v.status === 'waiting' || v.status === 'running') { v = await wait(v.id); }
        if (v.status !== 'done') { throw new Error(ref + ' ' + (v.status === 'cancelled' ? 'was cancelled' : 'failed') + (v.error ? ': ' + v.error : '')); }
        return v.output;
    }

    function cancel(id) {
        var rec = find(id);
        if (rec.status !== 'running' && rec.status !== 'waiting') { return false; }
        /* Settled first, so the handler's own failure on being stopped
           finds the record already finished. */
        finish(rec, 'cancelled', 'cancelled');
        if (rec.controller) { rec.controller.abort(); }
        return true;
    }

    function artifact(id) {
        var dot = String(id).lastIndexOf('.');
        var rec = find(dot > 0 ? String(id).slice(0, dot) : id);
        var a = rec.artifacts.filter(function (x) { return x.descriptor.id === String(id); })[0];
        if (!a) { throw new Error('there is no artifact ' + id); }
        return Object.assign({}, a.descriptor, { data: a.data });
    }

    window.pcActions = Object.freeze({
        apiVersion: 1,
        capabilities: function () { return validatorLib().then(function () { return C.CAPABILITIES.slice(); }); },
        catalog: function () { return load().then(function (s) { return JSON.parse(JSON.stringify(s.manifests)); }); },
        problems: function () { return load().then(function (s) { return s.problems.slice(); }); },
        describe: function (ref) {
            return load().then(function (s) {
                var e = s.actions[ref];
                if (!e) { throw new Error('there is no action ' + ref); }
                return C.publicAction(e.action);
            });
        },
        invoke: invoke,
        run: run,
        wait: wait,
        status: function (id) { return view(find(id)); },
        cancel: cancel,
        artifact: artifact,
        invocations: function () { return Array.from(records.values()).reverse().map(view); },
        provide: provide
    });
})();
