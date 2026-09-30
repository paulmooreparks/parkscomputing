/* The edit origin's passkey ceremonies (Architecture/admin-and-identity-design.md,
   A4 and A8), against Identity/AdminAuthController.cs. The server makes the
   WebAuthn options and checks the answers; this file only carries them
   between the server and the browser's navigator.credentials. Every call
   sends the page's antiforgery token. An action that needs a fresh passkey
   tap asks for one, then tries again. Served only on the edit origin, and
   loaded as a file, never inline, so the origin's CSP allows it. */
(function () {
    'use strict';

    var token = (document.querySelector('meta[name="request-verification-token"]') || {}).content || '';
    var status = document.querySelector('[data-admin-status]');

    function say(message) { if (status) { status.textContent = ''; status.textContent = message; } }
    function showError(scope, message) {
        var el = (scope && scope.querySelector('[data-admin-error]')) || document.querySelector('[data-admin-error]');
        if (el) { el.textContent = message; el.hidden = !message; }
        if (message) { say(message); }
    }

    function post(url, body) {
        return fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'RequestVerificationToken': token },
            body: JSON.stringify(body || {})
        });
    }
    async function json(r) { try { return await r.json(); } catch (e) { return {}; } }

    /* === WebAuthn's JSON forms ========================================
       Browsers that have PublicKeyCredential.parse…FromJSON and toJSON
       (WebAuthn Level 3) use them; the rest get the same conversion here. */
    function toBytes(b64url) {
        var s = b64url.replace(/-/g, '+').replace(/_/g, '/');
        while (s.length % 4) { s += '='; }
        var bin = atob(s), out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) { out[i] = bin.charCodeAt(i); }
        return out.buffer;
    }
    function toB64url(buf) {
        var bytes = new Uint8Array(buf), bin = '';
        for (var i = 0; i < bytes.length; i++) { bin += String.fromCharCode(bytes[i]); }
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function unwrap(o) { return o && o.publicKey ? o.publicKey : o; }

    function creationOptions(o) {
        o = unwrap(o);
        if (PublicKeyCredential.parseCreationOptionsFromJSON) { return PublicKeyCredential.parseCreationOptionsFromJSON(o); }
        var c = Object.assign({}, o);
        c.challenge = toBytes(o.challenge);
        c.user = Object.assign({}, o.user, { id: toBytes(o.user.id) });
        c.excludeCredentials = (o.excludeCredentials || []).map(function (x) { return Object.assign({}, x, { id: toBytes(x.id) }); });
        return c;
    }
    function requestOptions(o) {
        o = unwrap(o);
        if (PublicKeyCredential.parseRequestOptionsFromJSON) { return PublicKeyCredential.parseRequestOptionsFromJSON(o); }
        var r = Object.assign({}, o);
        r.challenge = toBytes(o.challenge);
        r.allowCredentials = (o.allowCredentials || []).map(function (x) { return Object.assign({}, x, { id: toBytes(x.id) }); });
        return r;
    }
    function credentialJson(cred) {
        if (typeof cred.toJSON === 'function') { return cred.toJSON(); }
        var r = cred.response, out = {
            id: cred.id, rawId: toB64url(cred.rawId), type: cred.type,
            authenticatorAttachment: cred.authenticatorAttachment || null,
            clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
            response: { clientDataJSON: toB64url(r.clientDataJSON) }
        };
        if (r.attestationObject) {
            out.response.attestationObject = toB64url(r.attestationObject);
            if (r.getTransports) { out.response.transports = r.getTransports(); }
        } else {
            out.response.authenticatorData = toB64url(r.authenticatorData);
            out.response.signature = toB64url(r.signature);
            out.response.userHandle = r.userHandle ? toB64url(r.userHandle) : null;
        }
        return out;
    }

    function cancelled(err) { return err && (err.name === 'NotAllowedError' || err.name === 'AbortError'); }

    /* === Ceremonies ==================================================== */

    async function assert(url, extra) {
        var o = await post('/api/admin/passkey/request-options');
        if (!o.ok) { throw new Error('The server could not start the sign-in.'); }
        var cred = await navigator.credentials.get({ publicKey: requestOptions(await o.json()) });
        return post(url, Object.assign({ credential: credentialJson(cred) }, extra || {}));
    }

    async function create(extra) {
        var o = await post('/api/admin/passkey/creation-options', extra);
        if (!o.ok) { return o; }
        var cred = await navigator.credentials.create({ publicKey: creationOptions(await o.json()) });
        return post('/api/admin/passkey/register', Object.assign({ credential: credentialJson(cred) }, extra));
    }

    /* Runs an action; if it needs a fresh passkey tap, asks for one and runs it again. */
    async function withConfirm(action) {
        var r = await action();
        if (r.status !== 403) { return r; }
        var body = await json(r.clone());
        if (!body.confirm) { return r; }
        say('Confirm it\'s you with a passkey.');
        var c = await assert('/api/admin/passkey/confirm');
        if (!c.ok) { return c; }
        return action();
    }

    /* For the workspace's applets (js/sitefs.js): when the server wants a
       fresh passkey tap for a change, this asks for one. It resolves when
       the tap is accepted and rejects when it is refused or cancelled. */
    window.pcAdmin = {
        confirm: async function () {
            say('Confirm it\'s you with a passkey.');
            /* Each way this can fail says which it was, so a caller can
               show why rather than only that it failed. */
            var r;
            try { r = await assert('/api/admin/passkey/confirm'); }
            catch (err) {
                if (cancelled(err)) { throw new Error('the passkey request was cancelled, or timed out'); }
                if (err instanceof TypeError) { throw new Error('the site could not be reached; it may have been restarting'); }
                throw new Error(err && err.message ? err.message : 'the passkey request failed');
            }
            if (!r.ok) { throw new Error('the server did not accept the passkey (' + r.status + ')'); }
            say('Confirmed.');
        }
    };

    function guard(button, scope, work) {
        button.addEventListener('click', async function () {
            if (!window.PublicKeyCredential) { showError(scope, 'This browser can\'t use passkeys.'); return; }
            button.disabled = true;
            showError(scope, '');
            try { await work(); }
            catch (err) { showError(scope, cancelled(err) ? 'Cancelled. Nothing was changed.' : (err.message || 'Something went wrong.')); }
            finally { button.disabled = false; }
        });
    }

    async function follow(r, scope) {
        var body = await json(r);
        if (r.ok && body.ok !== false) {
            if (body.redirect) { location.assign(body.redirect); } else { location.reload(); }
            return;
        }
        showError(scope, body.error || (r.status === 429 ? 'Too many tries. Wait a minute.' : 'That didn\'t work.'));
    }

    function nameOf(scope) {
        var n = (scope || document).querySelector('[data-passkey-name]');
        return n ? n.value.trim() : '';
    }

    document.querySelectorAll('[data-passkey-signin]').forEach(function (b) {
        var scope = b.closest('section') || document;
        /* Back to the admin page that sent here, such as a public page's Edit link. */
        var back = new URLSearchParams(location.search).get('ReturnUrl') || '';
        guard(b, scope, async function () { await follow(await assert('/api/admin/passkey/signin', { returnUrl: back }), scope); });
    });

    document.querySelectorAll('[data-passkey-enroll]').forEach(function (b) {
        var scope = b.closest('section') || document;
        guard(b, scope, async function () {
            await follow(await create({ uid: b.getAttribute('data-uid'), token: b.getAttribute('data-token'), name: nameOf(scope) }), scope);
        });
    });

    document.querySelectorAll('[data-passkey-add]').forEach(function (b) {
        var scope = b.closest('section') || document;
        guard(b, scope, async function () {
            var name = nameOf(scope);
            await follow(await withConfirm(function () { return create({ name: name }); }), scope);
        });
    });

    document.querySelectorAll('[data-passkey-remove]').forEach(function (b) {
        var scope = b.closest('section') || document;
        guard(b, scope, async function () {
            if (!confirm('Remove the passkey "' + b.getAttribute('data-name') + '"?')) { return; }
            var id = b.getAttribute('data-passkey-remove');
            await follow(await withConfirm(function () { return post('/api/admin/passkey/remove', { id: id }); }), scope);
        });
    });

    document.querySelectorAll('[data-recovery-new]').forEach(function (b) {
        var scope = b.closest('section') || document;
        guard(b, scope, async function () {
            if (!confirm('Make new recovery codes? The old ones will stop working.')) { return; }
            var r = await withConfirm(function () { return post('/api/admin/recovery-codes'); });
            var body = await json(r);
            if (!r.ok || !body.codes) { showError(scope, body.error || 'That didn\'t work.'); return; }
            var list = scope.querySelector('[data-recovery-codes]');
            list.innerHTML = '';
            body.codes.forEach(function (c) { var li = document.createElement('li'); li.textContent = c; list.appendChild(li); });
            list.hidden = false;
            say('Ten new recovery codes are shown. They won\'t be shown again.');
        });
    });

    /* Signing out clears what the edit origin keeps in this browser: the
       terminals' folders and the copy of the theme. Settings and history
       live in ~ on the server, so nothing of the admin's is lost, and a
       borrowed computer keeps nothing behind. */
    document.querySelectorAll('.admin-bar-signout').forEach(function (form) {
        form.addEventListener('submit', function () {
            try { localStorage.clear(); } catch (err) { }
            try { sessionStorage.clear(); } catch (err) { }
        });
    });
})();
