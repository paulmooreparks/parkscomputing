/* The server's host for applet actions (Mcp/AppletRunner.cs), run in Jint
   before the shared rules (wwwroot/js/applet-actions-core.js), the schema
   library (@cfworker/json-schema) and an action's own module. It gives
   them the little of a browser they use, and nothing else: there is no
   document, fetch, network or file system, and the engine has no access
   to .NET beyond the functions Mcp/AppletRunner.cs sets:

     __urlResolve(input, base)   an absolute URL, by .NET's System.Uri
     __random(width)             a random unsigned integer of 1, 2 or 4 bytes
     __describeText(text)        { size, sha256 } of text as UTF-8, as JSON
     __source(moduleRel, src)    the text of a script beside the module, by
                                 its path under wwwroot/js

   URL is the part of the web's URL class that @cfworker/json-schema 4.1.1
   uses: the constructor with a base, href, and hash read and set. The
   manifests' schemas may only refer within themselves (the shared rules
   refuse anything else), so it only ever resolves "#…" against an
   absolute base. A use of anything more fails loudly, since the class has
   nothing more. */
(function (global) {
    'use strict';

    function URL(input, base) {
        if (!(this instanceof URL)) { throw new TypeError('URL is a constructor'); }
        var abs = __urlResolve(String(input), base === undefined ? null : String(base));
        var at = abs.indexOf('#');
        this._base = at < 0 ? abs : abs.slice(0, at);
        this._hash = at < 0 || at === abs.length - 1 ? '' : abs.slice(at);
    }
    Object.defineProperty(URL.prototype, 'href', { get: function () { return this._base + this._hash; } });
    Object.defineProperty(URL.prototype, 'hash', {
        get: function () { return this._hash; },
        set: function (v) { v = String(v); this._hash = v === '' || v === '#' ? '' : (v.charAt(0) === '#' ? v : '#' + v); }
    });
    URL.prototype.toString = function () { return this.href; };
    global.URL = URL;

    global.window = global;
    global.self = global;
    global.document = { currentScript: null };

    /* Random numbers for an action, such as Dice's, from .NET's
       cryptographic generator. */
    global.crypto = {
        getRandomValues: function (a) {
            var width = a.BYTES_PER_ELEMENT;
            if (width !== 1 && width !== 2 && width !== 4) { throw new TypeError('getRandomValues takes an array of 8, 16 or 32-bit integers'); }
            for (var i = 0; i < a.length; i++) { a[i] = __random(width); }
            return a;
        }
    };

    var provided = {};
    global.pcActions = { provide: function (id, handlers) { provided[id] = handlers; } };

    /* A script beside the module runs as a page's script would, in the
       global scope. */
    function loadBeside(moduleRel, src) {
        (0, eval)(__source(moduleRel, String(src)));
    }

    /* Runs one action and gives its output and artifacts as JSON, or
       throws why not. The caller has already checked that the action is
       pure and needs nothing but artifact.create. */
    global.__runAction = async function (manifestJson, ref, inputJson, invocationId) {
        var C = global.pcActionsCore, lib = global.__schemaLib;
        var m = JSON.parse(manifestJson);
        var entries = C.checkManifest(lib, m, {}, function () { return true; });
        var e = entries.filter(function (x) { return x.action.ref === ref; })[0];
        if (!e) { throw new Error('there is no action ' + ref); }
        var input = C.asJSON(JSON.parse(inputJson), 'the input');
        C.check(e.input, input, 'input to ' + ref);
        var moduleRel = 'actions/' + m.module;
        loadBeside(moduleRel, '');
        var handler = provided[m.id] && provided[m.id][e.local];
        if (typeof handler !== 'function') { throw new Error(m.id + '\'s module gives no handler for ' + e.local); }
        var ctx = Object.freeze({
            invocation: invocationId, owner: { kind: 'mcp' }, signal: null,
            beside: function (rel) { return rel; },
            load: function (src) { loadBeside(moduleRel, src); return Promise.resolve(); }
        });
        var result = await handler(input, ctx);
        if (result && result.request) { throw new Error(ref + ' asks a person a question, which needs the desktop'); }
        var rec = { id: invocationId, artifacts: [] };
        var output = await C.accept(rec, e, result, function (data) {
            if (typeof data !== 'string') { throw new Error('the server keeps only text artifacts so far'); }
            var d = JSON.parse(__describeText(data));
            return { size: d.size, sha256: d.sha256, keep: data };
        });
        C.check(e.output, output, 'output from ' + ref);
        return JSON.stringify({ output: output, artifacts: rec.artifacts.map(function (a) { return { descriptor: a.descriptor, text: a.data }; }) });
    };
})(globalThis);
