/* Settings: the admin desktop's own settings (Architecture/
   admin-and-identity-design.md, A12 and A14), as an applet, so it opens as
   a window beside the tools rather than over them. Each tool keeps its own
   settings behind its own gear; these are the desktop's:

   - how new windows open, floating or maximized;
   - the theme;
   - the background, a colour or a picture;
   - the file tree at the side;
   - the sign-in timeouts, which the server keeps and bounds.

   All but the timeouts live in ~/.config/desktop.json (js/config.js), so
   they follow the admin; js/admin-desktop.js applies them. The timeouts
   go through /api/admin/settings/timeouts. */
(function () {
    'use strict';

    var SELF_SRC = document.currentScript && document.currentScript.src;
    function beside(file) { return SELF_SRC ? SELF_SRC.replace(/settings\.js/, file) : '/js/' + file; }
    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('could not load ' + src)); };
            document.head.appendChild(s);
        });
    }
    function need(global, src) { return window[global] ? Promise.resolve() : loadScript(src); }

    /* What desktop.json holds when it says nothing. */
    var DEFAULTS = { newWindows: 'floating', theme: '', bgKind: 'none', bgColor: '#20303f', bgImage: '', bgFit: 'fill', treeWwwroot: false, treeHidden: false };
    var SWATCHES = ['#20303f', '#1f3a2e', '#3b2745', '#40302a', '#2c2c2c', '#dfe6ee', '#e9e2d4', '#d9e4d6'];
    var FITS = [['fill', 'Fill'], ['fit', 'Fit'], ['center', 'Centre'], ['tile', 'Tile']];
    var IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];
    var count = 0;

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function meta(name) { var m = document.querySelector('meta[name="' + name + '"]'); return m ? m.getAttribute('content') || '' : ''; }

    function init(root, opts) {
        opts = opts || {};
        var n = ++count, destroyed = false, F = null, FB = null, C = null, s = Object.assign({}, DEFAULTS), unConfig = null;
        root.classList.add('pc-settings');
        if (opts.fit === 'fill') { root.classList.add('pc-settings-fill'); }
        root.innerHTML = '<p class="pc-settings-loading">Loading your settings…</p>';

        function radio(name, value, label, checked) {
            return '<label class="check"><input type="radio" name="' + name + '-' + n + '" value="' + value + '"' + (checked ? ' checked' : '') + ' /> ' + esc(label) + '</label>';
        }

        function build(mounted) {
            root.innerHTML =
                '<section class="card pc-set-card">' +
                  '<h2 class="card-title">Windows</h2>' +
                  '<fieldset class="pc-set-group"><legend class="form-label">New windows open</legend>' +
                    radio('newWindows', 'floating', 'Floating, beside the others', true) +
                    radio('newWindows', 'maximized', 'Maximized, filling the desktop', false) +
                  '</fieldset>' +
                '</section>' +
                '<section class="card pc-set-card">' +
                  '<h2 class="card-title">Theme</h2>' +
                  '<div class="seg" role="group" aria-label="Theme" data-role="theme">' +
                    '<button type="button" data-theme-choice="light">Light</button>' +
                    '<button type="button" data-theme-choice="dark">Dark</button>' +
                    '<button type="button" data-theme-choice="system">Follow the system</button>' +
                  '</div>' +
                '</section>' +
                '<section class="card pc-set-card">' +
                  '<h2 class="card-title">Background</h2>' +
                  '<div class="pc-set-bg">' +
                    '<div class="pc-set-preview" data-role="preview" aria-hidden="true"></div>' +
                    '<div class="pc-set-bg-controls">' +
                      '<fieldset class="pc-set-group"><legend class="visually-hidden">Background</legend>' +
                        radio('bgKind', 'none', 'The theme\'s own', true) +
                        radio('bgKind', 'color', 'A colour', false) +
                        radio('bgKind', 'image', 'A picture', false) +
                      '</fieldset>' +
                      '<div class="pc-set-swatches" data-role="swatches">' +
                        SWATCHES.map(function (c) { return '<button type="button" class="pc-set-swatch" data-color="' + c + '" style="background:' + c + '" aria-label="Colour ' + c + '" title="' + c + '"></button>'; }).join('') +
                        '<label class="pc-set-custom">Other <input type="color" data-role="color" aria-label="Choose any colour" /></label>' +
                      '</div>' +
                      '<div class="pc-set-image" data-role="image-row">' +
                        '<button type="button" class="btn" data-role="choose">Choose a picture…</button>' +
                        '<span class="pc-set-image-name mono" data-role="image-name"></span>' +
                        '<label class="form-label pc-set-fit-label" for="pc-set-fit-' + n + '">Size</label>' +
                        '<select class="form-select" id="pc-set-fit-' + n + '" data-role="fit">' +
                          FITS.map(function (f) { return '<option value="' + f[0] + '">' + f[1] + '</option>'; }).join('') +
                        '</select>' +
                      '</div>' +
                      (mounted ? '' : '<p class="form-help">A picture needs a home directory on the server, so it is offered only when you are signed in to edit.</p>') +
                    '</div>' +
                  '</div>' +
                '</section>' +
                '<section class="card pc-set-card">' +
                  '<h2 class="card-title">File tree</h2>' +
                  '<label class="check"><input type="checkbox" data-role="treeWwwroot" /> Open /wwwroot in the tree when the desktop starts</label>' +
                  '<label class="check"><input type="checkbox" data-role="treeHidden" /> Show hidden files, whose names start with a dot</label>' +
                '</section>' +
                (mounted ?
                '<section class="card pc-set-card" data-role="timeouts">' +
                  '<h2 class="card-title">Sign-in and timeouts</h2>' +
                  '<p class="card-desc">You can shorten any of these at any time. Lengthening one needs a session you began with a passkey, and a passkey tap. Each change is recorded and emailed to you. The server sets the limits.</p>' +
                  '<form class="pc-set-timeouts" data-role="timeouts-form">' +
                    field('idleMinutes', 'Sign out after this long without activity', 'minutes') +
                    field('absoluteHours', 'Sign out this long after signing in, whatever happens', 'hours') +
                    field('confirmMinutes', 'Ask for a passkey tap again before changing how you sign in, after', 'minutes') +
                    field('destructiveConfirmMinutes', 'Ask for a passkey tap again before deleting, or changing js, css or pudl, after', 'minutes') +
                    '<div class="pc-set-actions"><button type="submit" class="btn btn-primary">Save timeouts</button> <button type="button" class="btn" data-role="timeouts-defaults">Use the defaults</button></div>' +
                    '<p class="pc-set-status" data-role="timeouts-status" role="status"></p>' +
                  '</form>' +
                '</section>' : '') +
                '<p class="pc-set-status" data-role="status" role="status" aria-live="polite"></p>';
        }

        function field(key, label, unit) {
            var id = 'pc-set-' + key + '-' + n;
            return '<div class="form-group pc-set-field"><label class="form-label" for="' + id + '">' + esc(label) + '</label>' +
                '<span class="pc-set-num"><input class="form-input" type="number" inputmode="numeric" step="1" id="' + id + '" data-timeout="' + key + '" /> ' + unit +
                ' <span class="pc-set-limits" data-limits="' + key + '"></span></span></div>';
        }

        var q = function (sel) { return root.querySelector(sel); };

        function say(msg, isError) {
            var el = q('[data-role="status"]');
            if (!el) { return; }
            el.textContent = msg || '';
            el.classList.toggle('form-error', !!isError);
        }

        function save(changes) {
            return C.set('desktop', changes).then(function (err) { say(err ? 'Not saved: ' + err + '.' : '', !!err); });
        }

        /* === Showing the settings ======================================== */

        function show() {
            root.querySelectorAll('input[name="newWindows-' + n + '"]').forEach(function (r) { r.checked = r.value === s.newWindows; });
            var theme = s.theme || (window.pudlThemePreference ? window.pudlThemePreference() : 'system');
            root.querySelectorAll('[data-theme-choice]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-theme-choice') === theme)); });
            root.querySelectorAll('input[name="bgKind-' + n + '"]').forEach(function (r) { r.checked = r.value === s.bgKind; });
            q('[data-role="swatches"]').hidden = s.bgKind !== 'color';
            q('[data-role="image-row"]').hidden = s.bgKind !== 'image';
            root.querySelectorAll('.pc-set-swatch').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-color') === s.bgColor)); });
            q('[data-role="color"]').value = /^#[0-9a-f]{6}$/i.test(s.bgColor) ? s.bgColor : DEFAULTS.bgColor;
            q('[data-role="image-name"]').textContent = s.bgImage || 'None chosen';
            q('[data-role="fit"]').value = s.bgFit;
            q('[data-role="treeWwwroot"]').checked = !!s.treeWwwroot;
            q('[data-role="treeHidden"]').checked = !!s.treeHidden;
            preview();
        }

        /* The preview is drawn the way the desktop draws the background,
           by the same function in js/admin-desktop.js when it is there. */
        var previewUrl = null;
        async function preview() {
            var box = q('[data-role="preview"]');
            if (window.pcDesktopBackground) { previewUrl = await window.pcDesktopBackground(box, s, previewUrl); }
            else { box.style.background = s.bgKind === 'color' ? s.bgColor : ''; }
        }

        /* === Timeouts ===================================================== */

        var token = meta('request-verification-token');
        function api(method, body) {
            return fetch('/api/admin/settings/timeouts', {
                method: method, credentials: 'same-origin',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json', RequestVerificationToken: token },
                body: body ? JSON.stringify(body) : undefined
            });
        }
        var timeouts = null;
        function tsay(msg, isError) { var el = q('[data-role="timeouts-status"]'); el.textContent = msg || ''; el.classList.toggle('form-error', !!isError); }
        function showTimeouts(data) {
            timeouts = data;
            Object.keys(data.limits).forEach(function (k) {
                var input = q('[data-timeout="' + k + '"]');
                if (!input) { return; }
                input.min = data.limits[k][0]; input.max = data.limits[k][1];
                input.value = data.timeouts[k];
                q('[data-limits="' + k + '"]').textContent = '(' + data.limits[k][0] + ' to ' + data.limits[k][1] + ', normally ' + data.defaults[k] + ')';
            });
        }
        async function loadTimeouts() {
            var r = await api('GET');
            if (!r.ok) { tsay('The timeouts could not be read (' + r.status + ').', true); return; }
            showTimeouts(await r.json());
        }
        async function saveTimeouts(values) {
            tsay('Saving…');
            var r = await api('PUT', values);
            var body = await r.clone().json().catch(function () { return {}; });
            /* A lengthening asks for a passkey tap, then goes again. */
            if (r.status === 403 && body.confirm && window.pcAdmin && window.pcAdmin.confirm) {
                try { await window.pcAdmin.confirm(); } catch (err) { tsay('Not saved: the passkey tap didn\'t happen.', true); return; }
                r = await api('PUT', values);
                body = await r.json().catch(function () { return {}; });
            }
            if (!r.ok) { tsay('Not saved: ' + (body.error || 'the server refused (' + r.status + ')') + '', true); return; }
            showTimeouts(body);
            tsay('Saved. They apply from your next request.');
        }
        function timeoutValues() {
            var v = {};
            root.querySelectorAll('[data-timeout]').forEach(function (i) { v[i.getAttribute('data-timeout')] = Math.round(+i.value); });
            return v;
        }

        /* === Wiring ======================================================= */

        function onClick(e) {
            var t = e.target.closest('button');
            if (!t || !root.contains(t)) { return; }
            if (t.hasAttribute('data-theme-choice')) {
                var theme = t.getAttribute('data-theme-choice');
                if (window.pudlSetTheme) { window.pudlSetTheme(theme); }
                s.theme = theme; show(); save({ theme: theme });
            } else if (t.hasAttribute('data-color')) {
                s.bgColor = t.getAttribute('data-color'); show(); save({ bgColor: s.bgColor });
            } else if (t.getAttribute('data-role') === 'choose') {
                choosePicture();
            } else if (t.getAttribute('data-role') === 'timeouts-defaults' && timeouts) {
                saveTimeouts(timeouts.defaults);
            }
        }
        function onChange(e) {
            var t = e.target;
            if (t.name === 'newWindows-' + n) { s.newWindows = t.value; save({ newWindows: t.value }); }
            else if (t.name === 'bgKind-' + n) { s.bgKind = t.value; show(); save({ bgKind: t.value }); if (t.value === 'image' && !s.bgImage) { choosePicture(); } }
            else if (t.getAttribute('data-role') === 'color') { s.bgColor = t.value; show(); save({ bgColor: t.value }); }
            else if (t.getAttribute('data-role') === 'fit') { s.bgFit = t.value; show(); save({ bgFit: t.value }); }
            else if (t.getAttribute('data-role') === 'treeWwwroot') { s.treeWwwroot = t.checked; save({ treeWwwroot: t.checked }); }
            else if (t.getAttribute('data-role') === 'treeHidden') { s.treeHidden = t.checked; save({ treeHidden: t.checked }); }
        }
        function onSubmit(e) {
            if (e.target.getAttribute('data-role') !== 'timeouts-form') { return; }
            e.preventDefault();
            if (!e.target.reportValidity()) { return; }
            saveTimeouts(timeoutValues());
        }

        /* A picture in ~ is used where it is; one from the computer is
           copied into ~/.config first, so it follows the admin too. */
        async function choosePicture() {
            if (!F.mounted) { say('A picture needs a home directory on the server.', true); return; }
            var res = await FB.pick(F, { mode: 'open', title: 'Choose a picture', host: root, computer: true, accept: IMAGE_EXT, start: '~',
                check: function () { return null; } });
            if (!res) { return; }
            var path = res.path;
            if (res.file) {
                if (!F.resolve(F.home(), '~/.config')) { var made = await F.mkdir(F.home(), '~/.config', true); if (made) { say('Not saved: ' + made + '.', true); return; } }
                var name = 'wallpaper-' + res.file.name.replace(/[^A-Za-z0-9._-]+/g, '-');
                var up = await F.upload(F.resolve(F.home(), '~/.config'), new File([res.file], name, { type: res.file.type }));
                if (up.error) { say('Not saved: ' + up.error + '.', true); return; }
                path = '~/.config/' + name;
            }
            s.bgKind = 'image'; s.bgImage = path; show();
            save({ bgKind: 'image', bgImage: path });
        }

        root.addEventListener('click', onClick);
        root.addEventListener('change', onChange);
        root.addEventListener('submit', onSubmit);

        var boot = Promise.all([
            need('pcSiteFs', window.pcSiteFsSrc || beside('sitefs.js')),
            need('pcFileBrowser', window.pcFileBrowserSrc || beside('filebrowser.js')),
            need('pcConfig', window.pcConfigSrc || beside('config.js'))
        ]).then(function () {
            F = window.pcSiteFs; FB = window.pcFileBrowser; C = window.pcConfig;
            return F.load();
        }).then(function () {
            return C.load('desktop', DEFAULTS);
        }).then(function (got) {
            if (destroyed) { return; }
            s = got;
            build(F.mounted);
            show();
            unConfig = C.onChange('desktop', function (next) { s = next; show(); });
            if (F.mounted) { loadTimeouts(); }
        }).catch(function (err) {
            if (!destroyed) { root.innerHTML = '<p class="pc-settings-failed">Settings could not start: ' + esc(err.message) + '.</p>'; }
        });

        return {
            destroy: function () {
                destroyed = true;
                if (unConfig) { unConfig(); }
                if (previewUrl) { URL.revokeObjectURL(previewUrl); }
                root.removeEventListener('click', onClick);
                root.removeEventListener('change', onChange);
                root.removeEventListener('submit', onSubmit);
            },
            ready: boot
        };
    }

    window.pudlApplets.register('settings', { init: init });
})();
