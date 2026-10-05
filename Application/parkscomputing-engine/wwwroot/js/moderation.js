/* The moderation applet (Architecture/unified-identity-design.md, step 2):
   the queue of comments waiting for review and of open reports, in a
   window or on the classic /moderation page. The server draws the panel
   (Pages/Shared/_ModerationContent.cshtml); this loads it into a mount that
   arrives empty, posts its decisions in place, and asks for the passkey
   tap moderating needs before the queue shows. */
(function () {
    'use strict';

    function panelOf(html) {
        return new DOMParser().parseFromString(html, 'text/html').querySelector('[data-moderation-panel]');
    }

    function load(root) {
        return fetch('/moderation?handler=Applet', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'text/html' } })
            .then(function (r) {
                if (r.status === 404) { return '<div data-moderation-panel><p>Only moderators have a queue.</p></div>'; }
                if (!r.ok) { throw new Error(r.status); }
                return r.text();
            })
            .then(function (html) { var p = panelOf(html); if (p && root.isConnected) { root.replaceChildren(document.importNode(p, true)); } })
            .catch(function () { if (root.isConnected) { root.textContent = 'The queue could not be loaded. Reload the page to try again.'; } });
    }

    pudlApplets.register('moderation', {
        init: function (root) {
            if (!root.querySelector('[data-moderation-panel]')) { load(root); }

            async function onClick(e) {
                var button = e.target.closest('[data-passkey]');
                if (!button || !root.contains(button) || !window.pcAccounts) { return; }
                e.stopPropagation();
                if (await window.pcAccounts.press(button, root)) { load(root); }
            }

            async function send(form, retried) {
                var r = await fetch(form.action, { method: 'POST', body: new FormData(form), credentials: 'same-origin', headers: { Accept: 'text/html' } });
                if ((r.status === 401 || r.status === 400) && !retried && window.pcAccounts) {
                    var now = await window.pcAccounts.freshToken();
                    if (!now.signedIn) { await window.pcAccounts.signIn(); now = await window.pcAccounts.freshToken(); }
                    var field = form.querySelector('input[name="__RequestVerificationToken"]');
                    if (field && now.token) { field.value = now.token; }
                    return send(form, true);
                }
                var panel = panelOf(await r.text());
                if (!panel) { throw new Error('no panel'); }
                if (!root.isConnected) { return; }
                root.replaceChildren(document.importNode(panel, true));
                var said = root.querySelector('.notice');
                if (said) { said.focus(); }
            }

            async function onSubmit(e) {
                var form = e.target;
                if (!root.contains(form)) { return; }
                e.preventDefault();
                // The button pressed says which decision this is.
                var pressed = e.submitter;
                if (pressed && pressed.name) {
                    var kind = form.querySelector('input[type="hidden"][name="' + pressed.name + '"]');
                    if (!kind) { kind = document.createElement('input'); kind.type = 'hidden'; kind.name = pressed.name; form.appendChild(kind); }
                    kind.value = pressed.value;
                }
                form.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
                try { await send(form, false); }
                catch (err) { form.querySelectorAll('button').forEach(function (b) { b.disabled = false; }); }
            }

            root.addEventListener('click', onClick, true);
            root.addEventListener('submit', onSubmit);
            return {
                menus: function () {
                    return { titles: [{ label: 'Moderation', items: [{ label: 'Reload the queue', run: function () { load(root); } }, '-'].concat(window.pcAppletIdentity ? window.pcAppletIdentity(root) : []) }] };
                },
                destroy: function () { root.removeEventListener('click', onClick, true); root.removeEventListener('submit', onSubmit); }
            };
        }
    });
})();
