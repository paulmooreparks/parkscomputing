/* ssh and ssh-key for the web terminal, on the edit origin only
   (Architecture/admin-and-identity-design.md, A16). The server sends this
   file, the SSH client (ssh.wasm, Go's golang.org/x/crypto/ssh) and Go's
   loader for it to a signed-in admin, from outside the web root, and
   js/applets.js names it only on the edit origin.

   The key is this browser's own: an Ed25519 key WebCrypto makes as
   non-extractable, kept in IndexedDB, so its private half can be used here
   but never read, copied or sent. ssh-key shows the public half, the line
   to add to ~/.ssh/authorized_keys at the far end.

   ssh asks the server for a ticket, which needs a passkey tap within the
   confirmation window, opens the relay's WebSocket with it, and runs the
   SSH client over it. The destination's host key must be one the server's
   configuration pins, or the client stops before sending anything. */
(function () {
    'use strict';
    var T = window.pcTerminal;
    if (!T) { return; }
    var paint = T.paint;
    var BASE = '/admin/ssh/';

    /* === The browser's key ============================================ */

    var DB = 'pc-ssh', STORE = 'keys', ID = 'default';

    function db() {
        return new Promise(function (resolve, reject) {
            var r = indexedDB.open(DB, 1);
            r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
            r.onsuccess = function () { resolve(r.result); };
            r.onerror = function () { reject(r.error); };
        });
    }
    async function stored(mode, fn) {
        var d = await db();
        try {
            return await new Promise(function (resolve, reject) {
                var tx = d.transaction(STORE, mode), s = tx.objectStore(STORE), req = fn(s);
                tx.oncomplete = function () { resolve(req && req.result); };
                tx.onerror = function () { reject(tx.error); };
            });
        } finally { d.close(); }
    }
    function loadKey() { return stored('readonly', function (s) { return s.get(ID); }); }
    function saveKey(k) { return stored('readwrite', function (s) { return s.put(k, ID); }); }
    function forgetKey() { return stored('readwrite', function (s) { return s.delete(ID); }); }

    async function makeKey() {
        /* extractable false: the private key can sign and nothing else. A
           public key is always exportable, which is all that is read. */
        var pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
        var pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
        var k = { privateKey: pair.privateKey, publicRaw: pub, created: new Date().toISOString() };
        await saveKey(k);
        return k;
    }

    function sshString(bytes) {
        var out = new Uint8Array(4 + bytes.length);
        new DataView(out.buffer).setUint32(0, bytes.length);
        out.set(bytes, 4);
        return out;
    }
    function authorizedLine(k) {
        var name = new TextEncoder().encode('ssh-ed25519');
        var a = sshString(name), b = sshString(k.publicRaw);
        var blob = new Uint8Array(a.length + b.length);
        blob.set(a); blob.set(b, a.length);
        var bin = '';
        blob.forEach(function (x) { bin += String.fromCharCode(x); });
        var who = (document.querySelector('meta[name="pc-admin-name"]') || {}).content || 'admin';
        return 'ssh-ed25519 ' + btoa(bin) + ' ' + who + '@edit.parkscomputing (browser, ' + k.created.slice(0, 10) + ')';
    }

    /* === The server ==================================================== */

    var TOKEN = (document.querySelector('meta[name="request-verification-token"]') || {}).content || '';

    function api(path, init) {
        init = init || {};
        init.credentials = 'same-origin';
        init.headers = Object.assign({ Accept: 'application/json', RequestVerificationToken: TOKEN }, init.headers || {});
        return fetch(path, init);
    }
    async function targets() {
        var r = await api('/api/admin/ssh/targets');
        if (!r.ok) { throw new Error('the server has no destinations for you (' + r.status + ')'); }
        return (await r.json()).targets || [];
    }
    /* A ticket needs a fresh passkey tap, which is asked for and the
       request made again, as the mount does. */
    async function ticket(name) {
        function ask() {
            return api('/api/admin/ssh/ticket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: name }) });
        }
        var r = await ask();
        if (r.status === 403 && window.pcAdmin && window.pcAdmin.confirm) {
            var b = await r.clone().json().catch(function () { return {}; });
            if (b.confirm) {
                try { await window.pcAdmin.confirm(); } catch (err) { throw new Error('a passkey tap is needed to connect, and it failed: ' + err.message); }
                r = await ask();
            }
        }
        var body = await r.json().catch(function () { return {}; });
        if (!r.ok || !body.ticket) { throw new Error(body.error || 'the server refused (' + r.status + ')'); }
        return body;
    }

    /* === The client ==================================================== */

    var clientReady = null;
    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('could not load ' + src)); };
            document.head.appendChild(s);
        });
    }
    function client() {
        if (!clientReady) {
            clientReady = (async function () {
                if (!window.Go) { await loadScript(BASE + 'wasm_exec.js'); }
                var go = new window.Go();
                var got = await WebAssembly.instantiateStreaming(fetch(BASE + 'ssh.wasm', { credentials: 'same-origin' }), go.importObject);
                go.run(got.instance);
                for (var i = 0; i < 100 && !window.pcSsh; i++) { await new Promise(function (r) { setTimeout(r, 20); }); }
                if (!window.pcSsh) { throw new Error('the SSH client did not start'); }
                return window.pcSsh;
            })();
            clientReady.catch(function () { clientReady = null; });
        }
        return clientReady;
    }

    /* === The commands ================================================== */

    function list(io, ts) {
        if (!ts.length) { io.out('No destinations are configured on the server.\n'); return; }
        var w = Math.max.apply(null, ts.map(function (t) { return t.name.length; }));
        ts.forEach(function (t) {
            io.out('  ' + paint('green', t.name.padEnd(w)) + '  ' + (t.user ? t.user + '@' : '') + t.addr + (t.description ? '  ' + paint('dim', t.description) : '') + '\n');
            if (t.command) { io.out('  ' + ' '.repeat(w) + '  ' + paint('dim', 'runs: ' + t.command) + '\n'); }
        });
    }

    T.register({
        name: 'ssh',
        summary: 'connect to a server over SSH, from this browser',
        help: 'ssh                 list the destinations the server allows\n' +
              'ssh NAME            connect to one, as its usual login\n' +
              'ssh USER@NAME       connect as USER\n' +
              'ssh NAME --shell    a plain shell, skipping the destination\'s start-up command\n\n' +
              'The SSH client runs in this browser, with a key that never leaves it\n' +
              '(see ssh-key). The site relays the encrypted connection and nothing\n' +
              'else. Connecting asks for a passkey tap. A destination may run a\n' +
              'command on arrival, such as rejoining a tmux session; ssh lists it.\n' +
              'Type exit, or close the window, to end the session.',
        complete: function (words) {
            return words.length === 2 && cachedNames ? cachedNames : [];
        },
        run: async function (args, io) {
            var ts;
            try { ts = await targets(); } catch (err) { io.err('ssh: ' + err.message); return 1; }
            cachedNames = ts.map(function (t) { return t.name; });
            var plain = args.indexOf('--shell') >= 0;
            args = args.filter(function (a) { return a !== '--shell'; });
            if (!args.length) { list(io, ts); return 0; }
            if (args.length > 1 || !io.takeOver) { io.err('ssh: give one destination, at the prompt (see help ssh)'); return 1; }
            var m = /^(?:([a-z_][a-z0-9_.-]{0,31})@)?([a-z0-9][a-z0-9._-]{0,39})$/i.exec(args[0]);
            var t = m && ts.find(function (x) { return x.name.toLowerCase() === m[2].toLowerCase(); });
            if (!t) { io.err('ssh: no destination called ' + args[0] + '. These are allowed:'); list(io, ts); return 1; }
            var user = m[1] || t.user;
            if (!user) { io.err('ssh: say who to log in as: ssh USER@' + t.name); return 1; }

            var key = await loadKey().catch(function () { return null; });
            if (!key) {
                key = await makeKey();
                io.out('This browser had no SSH key, so it has made one. Add this line to\n' +
                       '~/.ssh/authorized_keys for ' + user + ' on ' + t.name + ', then run ssh again:\n\n' +
                       authorizedLine(key) + '\n\n');
                return 0;
            }

            io.out(paint('dim', 'Connecting to ' + user + '@' + t.name + ' (' + t.addr + ')…') + '\n');
            var pc, tk;
            try { pc = await client(); tk = await ticket(t.name); }
            catch (err) { io.err('ssh: ' + err.message); return 1; }
            if (io.interrupted()) { return 130; }

            return new Promise(function (done) {
                var session = null, early = [];
                var hold = io.takeOver({
                    data: function (d) { if (session) { session.write(d); } else { early.push(d); } },
                    resize: function (cols, rows) { if (session) { session.resize(cols, rows); } },
                    close: function () { if (session) { session.close(); } }
                });
                function finish(msg) {
                    hold.release();
                    /* The relay closing under a session, when the admin
                       signs out or the session times out, reads as this. */
                    if (msg && /without exit status/.test(msg)) { msg = 'the site ended the connection (signing out, or the admin session ending, does)'; }
                    if (msg) { io.err('\nssh: ' + msg); } else { io.out('\n' + paint('dim', 'Connection to ' + t.name + ' closed.') + '\n'); }
                    done(msg ? 1 : 0);
                }
                var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + tk.relay;
                pc.connect({
                    url: url, addr: t.addr, user: user, term: 'xterm-256color',
                    publicKey: key.publicRaw,
                    sign: function (data) {
                        return crypto.subtle.sign({ name: 'Ed25519' }, key.privateKey, data).then(function (s) { return new Uint8Array(s); });
                    },
                    hostKeys: t.hostKeys,
                    command: plain ? '' : (t.command || ''),
                    cols: hold.cols, rows: hold.rows,
                    onData: function (bytes) { hold.write(bytes); },
                    onClose: function (msg) { finish(msg); }
                }).then(function (s) {
                    session = s;
                    early.forEach(function (d) { s.write(d); });
                    early = [];
                }, function (err) {
                    var msg = err && err.message ? err.message : String(err);
                    if (/unable to authenticate|no supported methods/i.test(msg)) {
                        msg = t.name + ' did not accept this browser\'s key. Is its line (ssh-key) in ~/.ssh/authorized_keys for ' + user + '?';
                    }
                    finish(msg);
                });
            });
        }
    });
    var cachedNames = null;

    T.register({
        name: 'ssh-key',
        summary: 'show this browser\'s SSH public key, making one if needed',
        help: 'ssh-key             show the public key, the line for authorized_keys\n' +
              'ssh-key --new       replace this browser\'s key with a new one\n' +
              'ssh-key --forget    remove this browser\'s key\n\n' +
              'The private key is made by the browser and can never be read out of\n' +
              'it, only used to sign, here, in this browser profile.',
        run: async function (args, io) {
            var a = args[0];
            if (a === '--forget') { await forgetKey(); io.out('This browser\'s SSH key is gone. Remove its line from any authorized_keys too.\n'); return 0; }
            if (a && a !== '--new') { io.err('ssh-key: unknown option ' + a + ' (see help ssh-key)'); return 1; }
            var key = a === '--new' ? null : await loadKey().catch(function () { return null; });
            var made = !key;
            if (!key) { key = await makeKey(); }
            io.out((made ? 'A new key for this browser. ' : '') + 'Add this line to ~/.ssh/authorized_keys at the far end:\n\n' + authorizedLine(key) + '\n');
            return 0;
        }
    });
})();
