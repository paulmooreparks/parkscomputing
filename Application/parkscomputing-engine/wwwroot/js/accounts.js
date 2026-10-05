/* Accounts on every page of a site that has them (Architecture/unified-identity-design.md).

   Sign in and Create account are modal dialogs in both views. A link
   marked data-account-dialog (the logo menu's Sign in… and Create
   account…, and links inside the dialogs) opens its page's panel in a
   PUDL dialog over the page the reader is on, and a form in the dialog
   posts in place, so the reader never leaves what they were reading. The
   address of each dialog is a page of its own, which shows the same
   dialog over the site, and which a ctrl-click or a reader without script
   reaches.

   Passkeys work from anywhere through window.pcAccounts, which the
   Account applet (js/account.js) uses too. The browser's WebAuthn calls
   are the documented ceremony: options from the server, the
   authenticator's answer back to it. */
(function () {
    'use strict';
    if (window.pcAccounts) { return; }

    function token() {
        var meta = document.querySelector('meta[name="request-verification-token"]');
        return meta ? meta.content : '';
    }

    /* === Passkeys ====================================================== */

    async function post(action, body) {
        var r = await fetch('/api/account/passkey/' + action, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'RequestVerificationToken': token() },
            body: JSON.stringify(body || {})
        });
        if (r.status === 429) { throw new Error('Too many tries. Wait a minute, then try again.'); }
        if (!(r.headers.get('Content-Type') || '').includes('application/json')) { throw new Error('That did not work. Reload the page and try again.'); }
        var value = await r.json();
        if (!r.ok) {
            // A staff account confirms with an existing passkey first.
            if (value.confirm) { await ceremony('confirm'); return post(action, body); }
            throw new Error(value.error || 'That did not work. Try again.');
        }
        return value;
    }

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

    /* One ceremony: 'register' adds a passkey; 'signin', 'confirm' and
       'activate-superuser' ask for one. name is a new passkey's name. */
    async function ceremony(action, name) {
        if (!window.PublicKeyCredential || !navigator.credentials) { throw new Error('This browser does not support passkeys. Use an email link instead.'); }
        var adding = action === 'register';
        var options = await post(adding ? 'creation-options' : 'request-options');
        var credential = adding ? await navigator.credentials.create({ publicKey: creationOptions(options) })
            : await navigator.credentials.get({ publicKey: requestOptions(options) });
        return post(action, { credential: credentialJson(credential), name: name || '' });
    }

    /* Carries out a passkey button (data-passkey="action", or
       data-remove-key="id") inside scope, saying in scope's status line
       why it failed; resolves with the server's answer, or null. */
    async function press(button, scope) {
        var status = scope.querySelector('[data-passkey-status]');
        button.disabled = true;
        if (status) { status.textContent = ''; status.hidden = true; }
        try {
            if (button.dataset.removeKey) { return await post('remove', { id: button.dataset.removeKey }); }
            var name = scope.querySelector('#key-name');
            return await ceremony(button.dataset.passkey, name ? name.value : '');
        } catch (error) {
            if (status) {
                status.hidden = false;
                status.textContent = error && (error.name === 'NotAllowedError' || error.name === 'AbortError')
                    ? 'The passkey request was cancelled or timed out. You can try again.'
                    : (error && error.name === 'InvalidStateError'
                        ? 'This device already holds a passkey for your account. Use a different device or app for the next one.'
                        : (error && error.message) || 'That did not work. Try again.');
            }
            return null;
        } finally { button.disabled = false; }
    }

    /* signIn and freshToken are for any script whose request finds the
       session gone, such as saving pins (js/pins.js): freshToken says
       whether the reader is still signed in and replaces the page's token,
       and signIn asks them to sign in again and resolves when they have. */
    window.pcAccounts = { press: press, ceremony: ceremony, signIn: signInAgain, freshToken: freshToken };

    /* The super-user's server tools (js/sitefs.js, the terminal's ssh, the
       settings that write /etc) ask for a fresh passkey tap through
       window.pcAdmin.confirm, which js/admin.js supplies on the edit origin.
       Here the account's own confirmation does it, with the same contract:
       it resolves once the server has taken the tap, and otherwise throws
       an Error that says why. */
    /* A token for whoever the reader is now, put where every script reads
       it; and whether they are signed in. */
    async function freshToken() {
        var r = await fetch('/api/account/token', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
        var v = await r.json();
        var meta = document.querySelector('meta[name="request-verification-token"]');
        if (meta && v.token) { meta.content = v.token; }
        return v;
    }

    /* The session ended while the page was open (Identity/ServerToolSignIn.cs).
       One dialog asks the reader to sign in again, however many requests
       found out at once; it resolves when they have, so each request can go
       again, and rejects if they cancel. A passkey signs in here; an email
       link signs in from another tab, after which Continue picks it up. */
    var signingIn = null;
    function signInAgain() {
        if (signingIn) { return signingIn; }
        signingIn = new Promise(function (resolve, reject) {
            var dialog = document.createElement('dialog');
            dialog.className = 'dialog account-dialog';
            dialog.setAttribute('aria-labelledby', 'pc-reauth-title');
            dialog.innerHTML =
                '<section class="account-panel">' +
                '<h2 class="dialog-title" id="pc-reauth-title">You’ve been signed out</h2>' +
                '<p>Your session ended while this page was open. Sign in again to carry on; everything you have open stays as it is.</p>' +
                '<p class="form-error" data-reauth-status role="alert" hidden></p>' +
                '<p class="form-help">No passkey on this device? <a href="/account/signin" target="_blank" rel="noopener">Sign in with an email link</a> in a new tab, then come back and press Continue.</p>' +
                '<div class="dialog-actions">' +
                '<button class="btn" type="button" data-reauth="cancel">Cancel</button>' +
                '<button class="btn" type="button" data-reauth="continue">Continue</button>' +
                '<button class="btn btn-primary" type="button" data-reauth="passkey" autofocus>Sign in with a passkey</button>' +
                '</div></section>';
            var status = dialog.querySelector('[data-reauth-status]'), done = false;
            function say(text) { status.textContent = text; status.hidden = !text; }
            function finish(ok) { done = true; dialog.close(); dialog.remove(); if (ok) { resolve(); } else { reject(new Error('you cancelled signing in')); } }
            dialog.addEventListener('close', function () { if (!done) { done = true; dialog.remove(); reject(new Error('you cancelled signing in')); } });
            dialog.addEventListener('click', async function (e) {
                var b = e.target.closest('[data-reauth]');
                if (!b) { return; }
                if (b.dataset.reauth === 'cancel') { finish(false); return; }
                b.disabled = true; say('');
                try {
                    if (b.dataset.reauth === 'passkey') {
                        await freshToken();
                        await ceremony('signin');
                    }
                    var now = await freshToken();
                    if (now.signedIn) { finish(true); } else { say('You’re still signed out. Sign in, then press Continue.'); }
                } catch (err) {
                    say(err && (err.name === 'NotAllowedError' || err.name === 'AbortError')
                        ? 'The passkey request was cancelled or timed out. You can try again.'
                        : (err && err.message) || 'That did not work. Try again.');
                } finally { b.disabled = false; }
            });
            document.body.appendChild(dialog);
            dialog.showModal();
        });
        signingIn.then(function () { signingIn = null; }, function () { signingIn = null; });
        return signingIn;
    }

    if (!window.pcAdmin && document.querySelector('meta[name="pc-fs-mount"]')) {
        window.pcAdmin = {
            signIn: signInAgain,
            confirm: async function () {
                try {
                    // A lapsed session signs in again first, with a token for it.
                    if (!(await freshToken()).signedIn) { await signInAgain(); }
                    await ceremony('confirm');
                }
                catch (err) {
                    if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) { throw new Error('the passkey request was cancelled, or timed out'); }
                    if (err instanceof TypeError) { throw new Error('the site could not be reached; it may have been restarting'); }
                    throw new Error(err && err.message ? err.message : 'the passkey request failed');
                }
            }
        };
    }

    /* A passkey button outside the Account applet, which handles its own:
       signing in reloads the page the reader is on, or on a dialog's own
       page goes back where it leads; anything else follows the server. */
    document.addEventListener('click', async function (e) {
        var button = e.target.closest && e.target.closest('[data-passkey], [data-remove-key]');
        if (!button || button.closest('[data-applet="account"]')) { return; }
        var scope = button.closest('dialog, .account-page, [data-account-panel]') || document;
        var result = await press(button, scope);
        if (!result) { return; }
        // A confirmation opens what the page was waiting on.
        if (button.dataset.passkey === 'confirm') { location.reload(); return; }
        if (button.dataset.passkey === 'signin') {
            var pageDialog = button.closest('[data-account-page-dialog]');
            var back = pageDialog && pageDialog.querySelector('[data-account-cancel]');
            if (back) { location.assign(back.getAttribute('href')); } else { location.reload(); }
            return;
        }
        // A button that knows where the reader came from goes back there.
        if (result.redirect) { location.assign(button.dataset.return || result.redirect); }
    });

    /* A link to an account page that is a page of its own, such as super-user
       setup, takes the reader's place along (returnUrl), so finishing there
       brings them back: to their window view with its windows, say. */
    document.addEventListener('click', function (e) {
        var link = e.target.closest && e.target.closest('a[data-return-here]');
        if (!link || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) { return; }
        e.preventDefault();
        var url = new URL(link.getAttribute('href'), location.href);
        url.searchParams.set('returnUrl', location.pathname + location.search);
        location.assign(url.pathname + url.search);
    });

    /* === The Comments link ============================================= */

    /* The Comments link in an article's tag row (Pages/Shared/_TagRow.cshtml)
       scrolls to the discussion under the article, in the same window or on
       the same page, and inside a framed article's own page, which is this
       site's and so reachable. Without the discussion in reach it follows
       its link, the discussion's own page. A modified press opens that page
       as any link does. */
    document.addEventListener('click', function (e) {
        var link = e.target.closest && e.target.closest('a[data-comments-link]');
        if (!link || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) { return; }
        var scope = link.closest('.win') || document;
        var target = scope.querySelector('.discussion-mount');
        if (!target) {
            var frame = scope.querySelector('iframe.win-app-frame');
            try { target = frame && frame.contentDocument && frame.contentDocument.querySelector('.discussion-mount'); } catch (err) { target = null; }
        }
        if (!target) { return; }
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    /* === The challenge ================================================= */

    /* Cloudflare Turnstile on Create account and on asking for a sign-in
       link (Identity/Turnstile.cs). Its script is loaded from Cloudflare
       the first time a form needs it, and draws each widget explicitly,
       since a dialog's markup arrives by fetch and its scripts never run.
       The widget puts its token in the form, as cf-turnstile-response. */
    var turnstileLoad = null;
    function loadTurnstile() {
        if (window.turnstile) { return Promise.resolve(window.turnstile); }
        if (!turnstileLoad) {
            turnstileLoad = new Promise(function (resolve, reject) {
                var s = document.createElement('script');
                s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
                s.async = true;
                s.onload = function () { resolve(window.turnstile); };
                s.onerror = function () { turnstileLoad = null; reject(new Error('the check could not be loaded')); };
                document.head.appendChild(s);
            });
        }
        return turnstileLoad;
    }
    function challenge(scope) {
        var spots = Array.prototype.slice.call(scope.querySelectorAll('[data-turnstile-sitekey]:not([data-turnstile-drawn])'));
        if (!spots.length) { return; }
        loadTurnstile().then(function (ts) {
            spots.forEach(function (spot) {
                if (!spot.isConnected) { return; }
                spot.setAttribute('data-turnstile-drawn', '');
                // In the site's theme rather than the browser's, which may differ.
                var theme = document.documentElement.getAttribute('data-theme');
                ts.render(spot, {
                    sitekey: spot.getAttribute('data-turnstile-sitekey'),
                    action: spot.getAttribute('data-turnstile-action') || undefined,
                    theme: theme === 'dark' || theme === 'light' ? theme : 'auto'
                });
            });
        }).catch(function () {
            spots.forEach(function (spot) {
                spot.textContent = 'The check that you’re a person could not be loaded. Reload the page to try again.';
                spot.className = 'form-error';
            });
        });
    }

    /* === Dialogs ======================================================= */

    var opener = null;

    function panelOf(html) {
        return new DOMParser().parseFromString(html, 'text/html').querySelector('[data-account-panel]');
    }

    function show(panel) {
        var dialog = document.querySelector('dialog[data-account-live]');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.className = 'dialog account-dialog';
            dialog.setAttribute('data-account-live', '');
            dialog.addEventListener('close', function () {
                dialog.remove();
                if (opener && opener.isConnected) { opener.focus(); }
                opener = null;
            });
            document.body.appendChild(dialog);
        }
        dialog.replaceChildren(document.importNode(panel, true));
        challenge(dialog);
        var title = dialog.querySelector('.dialog-title');
        if (title && title.id) { dialog.setAttribute('aria-labelledby', title.id); }
        if (!dialog.open) { dialog.showModal(); }
        var first = dialog.querySelector('[data-account-errors], [autofocus]');
        if (first) { first.focus(); }
    }

    async function open(url) {
        var r = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
        var panel = r.ok && !r.redirected ? panelOf(await r.text()) : null;
        if (!panel) { throw new Error('no panel'); }
        show(panel);
    }

    function plain(e) { return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey; }

    document.addEventListener('click', function (e) {
        var cancel = e.target.closest && e.target.closest('[data-account-cancel]');
        var live = cancel && cancel.closest('dialog[data-account-live]');
        if (live) { e.preventDefault(); live.close(); return; }

        var link = e.target.closest && e.target.closest('a[data-account-dialog]');
        if (!link || !plain(e)) { return; }
        e.preventDefault();
        var url = new URL(link.getAttribute('href'), location.href);
        url.searchParams.set('returnUrl', location.pathname + location.search);
        /* Focus goes back where it was when the dialog closes; the menu
           bar has already put it back where it was before the menu. */
        if (!link.closest('dialog')) { opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null; }
        open(url).catch(function () { location.assign(url); });
    });

    /* A form in a dialog posts in place, and the answer's panel takes the
       dialog: the notice to check email, or the form again with what went
       wrong. */
    document.addEventListener('submit', function (e) {
        var form = e.target;
        if (!form.closest || !form.closest('dialog[data-account-live]')) { return; }
        e.preventDefault();
        var button = form.querySelector('[type="submit"]');
        if (button) { button.disabled = true; }
        fetch(form.action, { method: 'POST', body: new FormData(form), credentials: 'same-origin', headers: { Accept: 'text/html' } })
            .then(function (r) { return r.text(); })
            .then(function (html) { var panel = panelOf(html); if (panel) { show(panel); } else { form.submit(); } })
            .catch(function () { form.submit(); });
    });

    /* A dialog's own page: the server rendered the dialog open; shown
       modally it keeps focus in itself, and Escape goes back as Cancel
       does. */
    function upgrade() {
        var dialog = document.querySelector('dialog[data-account-page-dialog][open]');
        if (!dialog) { return; }
        challenge(dialog);
        dialog.close();
        dialog.showModal();
        dialog.addEventListener('cancel', function (e) {
            var back = dialog.querySelector('[data-account-cancel]');
            if (back) { e.preventDefault(); location.assign(back.getAttribute('href')); }
        });
        var first = dialog.querySelector('[data-account-errors], [autofocus]');
        if (first) { first.focus(); }
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', upgrade); } else { upgrade(); }
})();
