/* The Account applet (Architecture/unified-identity-design.md): the
   reader's profile, passkeys and sessions, in a window or on the classic
   /account page. Its body is server-rendered (Pages/Shared/_AccountContent);
   a mount that arrives empty, as a window does, loads it. Whatever the
   reader changes here, the applet reloads its body afterwards rather than
   leaving the page, so a window stays where it is. Signing out leaves the
   page, because the whole page changes with it. Passkey ceremonies are
   js/accounts.js's (window.pcAccounts). */
(function () {
    'use strict';

    function load(root) {
        return fetch('/account?handler=Applet', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'text/html' } })
            .then(function (r) { if (!r.ok) { throw new Error(r.status); } return r.text(); })
            .then(function (html) { if (root.isConnected) { root.innerHTML = html; syncPill(root); } })
            .catch(function () { if (root.isConnected) { root.textContent = 'Your account could not be loaded. Reload the page to try again.'; } });
    }

    /* The top bar's account button shows the same picture as the applet,
       so a new or removed picture shows there at once. */
    function syncPill(root) {
        var section = root.querySelector('[data-account-avatar-url]'), pill = document.querySelector('.account-pill');
        var mine = section && section.querySelector('.account-avatar');
        if (!pill || !mine || pill.classList.contains('account-signin')) { return; }
        var copy = mine.cloneNode(true);
        copy.classList.remove('account-avatar-large');
        pill.replaceChildren(copy);
    }

    /* A chosen picture, cropped to its centre square and drawn at 256
       pixels, as WebP where the browser can write it and PNG otherwise.
       Drawing it again leaves its metadata, such as where a photo was
       taken, behind. */
    async function square(file) {
        var bitmap = await createImageBitmap(file);
        var side = Math.min(bitmap.width, bitmap.height), size = Math.min(256, side);
        var canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
        bitmap.close();
        return new Promise(function (resolve, reject) {
            canvas.toBlob(function (blob) { if (blob) { resolve(blob); } else { reject(new Error('could not draw the picture')); } }, 'image/webp', 0.88);
        });
    }

    pudlApplets.register('account', {
        init: function (root) {
            if (!root.querySelector('[data-account-panel]')) { load(root); }

            async function onClick(e) {
                var button = e.target.closest('[data-passkey], [data-remove-key]');
                if (!button || !root.contains(button) || !window.pcAccounts) { return; }
                if (await window.pcAccounts.press(button, root)) { load(root); }
            }

            async function onSubmit(e) {
                var form = e.target;
                if (/\/account\/signout$/.test(new URL(form.action, location.href).pathname)) { return; }
                e.preventDefault();
                var body = new FormData(form);
                if (form.hasAttribute('data-account-avatar-form')) {
                    var file = form.querySelector('input[type="file"]').files[0];
                    if (file) {
                        try { body.set('Picture', await square(file), 'picture.webp'); }
                        catch (err) { /* A picture the browser can't read goes as it is, for the server to judge. */ }
                    }
                }
                fetch(form.action, { method: 'POST', body: body, credentials: 'same-origin', headers: { Accept: 'text/html' } })
                    .then(function (r) {
                        // A refused form comes back as the page, with what went wrong.
                        if (r.redirected) { return load(root); }
                        return r.text().then(function (html) {
                            var panel = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-account-panel]');
                            if (panel && root.isConnected) { root.replaceChildren(document.importNode(panel, true)); } else { load(root); }
                        });
                    })
                    .catch(function () { form.submit(); });
            }

            root.addEventListener('click', onClick);
            root.addEventListener('submit', onSubmit);
            return {
                /* The applet's identity menu, as every applet has. Its work
                   is in its own forms; signing out is the site's, in the logo
                   menu, so it is not repeated here. */
                menus: function () {
                    return { titles: [{ label: 'Your account', items: window.pcAppletIdentity ? window.pcAppletIdentity(root) : [] }] };
                },
                destroy: function () { root.removeEventListener('click', onClick); root.removeEventListener('submit', onSubmit); }
            };
        }
    });
})();
