/* Settings, as an applet, so it opens as a window beside the tools rather
   than over them, and so it is an ordinary entry in the Applets menu. Each
   tool keeps its own settings behind its own controls; these are the
   site's:

   - the theme, the default view and how windows open, kept in this
     browser (initPublic, below);
   - for someone with a home directory on the server (the page carries
     pc-fs-mount), the desktop's background, a colour or a picture, kept in
     ~/.config/desktop.json (js/config.js) so it follows them, and drawn by
     js/desktop-background.js;
   - for them too, the sign-in timeouts, which the server keeps and bounds,
     through /api/admin/settings/timeouts
     (Architecture/admin-and-identity-design.md, A12 and A14). */
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

    /* What desktop.json holds about the background when it says nothing. */
    var DEFAULTS = { bgKind: 'none', bgColor: '#20303f', bgImage: '', bgFit: 'fill' };
    var SWATCHES = ['#20303f', '#1f3a2e', '#3b2745', '#40302a', '#2c2c2c', '#dfe6ee', '#e9e2d4', '#d9e4d6'];
    var FITS = [['fill', 'Fill'], ['fit', 'Fit'], ['center', 'Centre'], ['tile', 'Tile']];
    var IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];
    var count = 0;

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function meta(name) { var m = document.querySelector('meta[name="' + name + '"]'); return m ? m.getAttribute('content') || '' : ''; }

    /* === The public site's settings ======================================
       Everything here lives in this browser: the theme is PUDL's own key,
       the default view a cookie the server reads, and the window view's two
       choices keys js/desktop.js reads. They were the Settings dialog's
       before Settings became an applet in the Applets menu. */

    var FORGET_KEYS = ['pc-maximize-new', 'pc-resume-windows', 'pc-windows', 'pc-sidebar-w', 'pc-sudoku', 'pc-barcodes',
        'pc-barcode-layouts', 'pc-barcode-layouts-moved', 'pc-editor-session', 'pc-terminal', 'pc-terminal-history', 'pc-terminal-home'];

    function viewChoice() {
        var m = document.cookie.match(/(?:^|;\s*)pc-view=([^;]*)/);
        return m && m[1] === 'classic' ? 'classic' : 'window';
    }
    function setView(mode) {
        document.cookie = mode === 'classic'
            ? 'pc-view=classic; path=/; max-age=31536000; SameSite=Lax'
            : 'pc-view=; path=/; max-age=0; SameSite=Lax';
    }
    function pref(name, fallback) {
        try { var v = localStorage.getItem('pc-' + name); return v == null ? fallback : v === '1'; } catch (err) { return fallback; }
    }

    /* Which side the window view's article list is on. The View menu's
       command, sidebar-side in js/commands.js, keeps and applies it; this
       card offers the same choice through it. */
    function sideChoice() {
        try { return localStorage.getItem('pc-sidebar-side') === 'end' ? 'end' : 'start'; } catch (err) { return 'start'; }
    }
    function setSide(side) {
        if (window.pcCommands) { window.pcCommands.run('sidebar-side', { value: side }); }
    }

    function settingsMenus(root) {
        return { titles: [{ label: 'Settings', items: window.pcAppletIdentity(root, []) }] };
    }

    /* more.middle goes after the Windows card and more.end after the
       last, for the cards init adds. */
    function initPublic(root, opts, n, more) {
        more = more || {};
        root.classList.add('pc-settings');
        if (opts.fit === 'fill') { root.classList.add('pc-settings-fill'); }
        root.innerHTML =
            '<section class="card pc-set-card">' +
              '<h2 class="card-title">Theme</h2>' +
              '<div class="seg" role="group" aria-label="Theme">' +
                '<button type="button" data-theme-choice="light">Light</button>' +
                '<button type="button" data-theme-choice="dark">Dark</button>' +
                '<button type="button" data-theme-choice="system">Follow the system</button>' +
              '</div>' +
            '</section>' +
            '<section class="card pc-set-card">' +
              '<h2 class="card-title">View</h2>' +
              '<p class="card-desc">Which view the site opens in when you arrive at its front page.</p>' +
              '<div class="seg" role="group" aria-label="Default view">' +
                '<button type="button" data-view-choice="window">Windowed</button>' +
                '<button type="button" data-view-choice="classic">Classic</button>' +
              '</div>' +
            '</section>' +
            '<section class="card pc-set-card">' +
              '<h2 class="card-title">Windows</h2>' +
              '<label class="check"><input type="checkbox" data-pref="maximize-new" /> Maximize new windows</label>' +
              '<label class="check"><input type="checkbox" data-pref="resume-windows" data-pref-default="1" /> Reopen last session\'s windows</label>' +
              '<p class="form-label pc-set-side-label" id="pc-set-side-' + n + '">Article list</p>' +
              '<div class="seg" role="group" aria-labelledby="pc-set-side-' + n + '">' +
                '<button type="button" data-side-choice="start">On the left</button>' +
                '<button type="button" data-side-choice="end">On the right</button>' +
              '</div>' +
            '</section>' +
            (more.middle || '') +
            '<section class="card pc-set-card">' +
              '<h2 class="card-title">This browser</h2>' +
              '<p class="card-desc">These choices, the window arrangement, the applets\' saves and your home directory in the terminal are kept only in this browser. Forgetting erases them all.</p>' +
              '<button type="button" class="btn btn-danger" data-forget>Forget this browser\'s data</button>' +
              '<p class="pc-set-status" data-role="forget-status" role="status" aria-live="polite"></p>' +
            '</section>' +
            (more.end || '');

        function mark() {
            var theme = window.pudlThemePreference ? window.pudlThemePreference() : 'system';
            root.querySelectorAll('[data-theme-choice]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-theme-choice') === theme)); });
            root.querySelectorAll('[data-view-choice]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-view-choice') === viewChoice())); });
            root.querySelectorAll('[data-pref]').forEach(function (box) { box.checked = pref(box.getAttribute('data-pref'), box.getAttribute('data-pref-default') === '1'); });
            root.querySelectorAll('[data-side-choice]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-side-choice') === sideChoice())); });
        }

        function forget() {
            FORGET_KEYS.forEach(function (key) { try { localStorage.removeItem(key); } catch (err) { } });
            /* The continuity of numbered instances, such as pc-terminal:terminal-2. */
            try {
                var prefixes = (window.pcContinuity ? window.pcContinuity.keys() : []).map(function (k) { return k + ':'; });
                Object.keys(localStorage).forEach(function (key) {
                    if (prefixes.some(function (p) { return key.indexOf(p) === 0; })) { localStorage.removeItem(key); }
                });
            } catch (err) { }
            /* The barcode tool's link to a layouts file on disk; the file
               itself is the reader's and is left alone. */
            try { if (window.indexedDB) { indexedDB.deleteDatabase('pc-barcodes'); } } catch (err) { }
            document.cookie = 'pc-list=; path=/; max-age=0; SameSite=Lax';
            setView('window');
            setSide('start');
            /* Forgetting lands the theme on System: the device decides. */
            if (window.pudlSetTheme) { window.pudlSetTheme('system'); }
            mark();
            root.querySelector('[data-role="forget-status"]').textContent = 'This browser\'s data for this site is erased.';
        }

        function onClick(e) {
            var t = e.target.closest('button');
            if (!t || !root.contains(t)) { return; }
            if (t.hasAttribute('data-theme-choice') && window.pudlSetTheme) { window.pudlSetTheme(t.getAttribute('data-theme-choice')); }
            else if (t.hasAttribute('data-view-choice')) { setView(t.getAttribute('data-view-choice')); }
            else if (t.hasAttribute('data-side-choice')) { setSide(t.getAttribute('data-side-choice')); }
            else if (t.hasAttribute('data-forget')) { forget(); }
            mark();
        }
        function onChange(e) {
            var box = e.target.closest('[data-pref]');
            if (!box) { return; }
            try { localStorage.setItem('pc-' + box.getAttribute('data-pref'), box.checked ? '1' : '0'); } catch (err) { }
        }
        root.addEventListener('click', onClick);
        root.addEventListener('change', onChange);
        document.addEventListener('pudl:theme-change', mark);
        document.addEventListener('pc:sidebar-side', mark);
        mark();
        return {
            menus: function () { return settingsMenus(root); },
            destroy: function () {
                root.removeEventListener('click', onClick);
                root.removeEventListener('change', onChange);
                document.removeEventListener('pudl:theme-change', mark);
                document.removeEventListener('pc:sidebar-side', mark);
            }
        };
    }

    function init(root, opts) {
        opts = opts || {};
        /* Without a home directory on the server, the settings are all in
           this browser. */
        if (!meta('pc-fs-mount')) { return initPublic(root, opts, ++count); }
        var n = ++count, destroyed = false, F = null, FB = null, C = null, s = Object.assign({}, DEFAULTS), unConfig = null;

        function radio(name, value, label, checked) {
            return '<label class="check"><input type="radio" name="' + name + '-' + n + '" value="' + value + '"' + (checked ? ' checked' : '') + ' /> ' + esc(label) + '</label>';
        }

        function backgroundCard() {
            return '<section class="card pc-set-card" data-role="background">' +
                  '<h2 class="card-title">Background</h2>' +
                  '<p class="card-desc">The desktop behind the windows. It is kept in your home directory on the server, so it follows you to any browser where you sign in.</p>' +
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
                        /* Size and its select wrap together, never apart. */
                        '<span class="pc-set-fit">' +
                          '<label class="form-label pc-set-fit-label" for="pc-set-fit-' + n + '">Size</label>' +
                          '<span class="form-select-wrap"><select class="form-select" id="pc-set-fit-' + n + '" data-role="fit">' +
                            FITS.map(function (f) { return '<option value="' + f[0] + '">' + f[1] + '</option>'; }).join('') +
                          '</select></span>' +
                        '</span>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                  '<p class="pc-set-status" data-role="status" role="status" aria-live="polite"></p>' +
                '</section>';
        }

        function timeoutsCard() {
            return '<section class="card pc-set-card" data-role="timeouts">' +
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
                '</section>';
        }

        function field(key, label, unit) {
            var id = 'pc-set-' + key + '-' + n;
            return '<div class="form-group pc-set-field"><label class="form-label" for="' + id + '">' + esc(label) + '</label>' +
                '<span class="pc-set-num"><input class="form-input" type="number" inputmode="numeric" step="1" id="' + id + '" data-timeout="' + key + '" /> ' + unit +
                ' <span class="pc-set-limits" data-limits="' + key + '"></span></span></div>';
        }

        /* The browser's own cards, with Background after Windows and the
           timeouts last. Background waits, disabled, until desktop.json is
           read. */
        var pub = initPublic(root, opts, n, { middle: backgroundCard(), end: timeoutsCard() });
        var q = function (sel) { return root.querySelector(sel); };
        var bgCard = q('[data-role="background"]');
        bgCard.querySelectorAll('input, select, button').forEach(function (c) { c.disabled = true; });

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
            root.querySelectorAll('input[name="bgKind-' + n + '"]').forEach(function (r) { r.checked = r.value === s.bgKind; });
            q('[data-role="swatches"]').hidden = s.bgKind !== 'color';
            q('[data-role="image-row"]').hidden = s.bgKind !== 'image';
            root.querySelectorAll('.pc-set-swatch').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-color') === s.bgColor)); });
            q('[data-role="color"]').value = /^#[0-9a-f]{6}$/i.test(s.bgColor) ? s.bgColor : DEFAULTS.bgColor;
            q('[data-role="image-name"]').textContent = s.bgImage || 'None chosen';
            q('[data-role="fit"]').value = s.bgFit;
            preview();
        }

        /* The preview is drawn as the desktop is (js/desktop-background.js). */
        var previewUrl = null;
        async function preview() {
            previewUrl = await window.pcDesktopBackground(q('[data-role="preview"]'), s, previewUrl);
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
                try { await window.pcAdmin.confirm(); } catch (err) { tsay('Not saved: ' + err.message + '.', true); return; }
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
            if (t.hasAttribute('data-color')) {
                s.bgColor = t.getAttribute('data-color'); show(); save({ bgColor: s.bgColor });
            } else if (t.getAttribute('data-role') === 'choose') {
                choosePicture();
            } else if (t.getAttribute('data-role') === 'timeouts-defaults' && timeouts) {
                saveTimeouts(timeouts.defaults);
            }
        }
        function onChange(e) {
            var t = e.target;
            if (t.name === 'bgKind-' + n) { s.bgKind = t.value; show(); save({ bgKind: t.value }); if (t.value === 'image' && !s.bgImage) { choosePicture(); } }
            else if (t.getAttribute('data-role') === 'color') { s.bgColor = t.value; show(); save({ bgColor: t.value }); }
            else if (t.getAttribute('data-role') === 'fit') { s.bgFit = t.value; show(); save({ bgFit: t.value }); }
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
            need('pcConfig', window.pcConfigSrc || beside('config.js')),
            need('pcDesktopBackground', window.pcDesktopBackgroundSrc || beside('desktop-background.js'))
        ]).then(function () {
            F = window.pcSiteFs; FB = window.pcFileBrowser; C = window.pcConfig;
            loadTimeouts();
            return F.load();
        }).then(function () {
            return C.load('desktop', DEFAULTS);
        }).then(function (got) {
            if (destroyed) { return; }
            s = got;
            bgCard.querySelectorAll('input, select, button').forEach(function (c) { c.disabled = false; });
            show();
            unConfig = C.onChange('desktop', function (next) { s = next; show(); });
        }).catch(function (err) {
            if (!destroyed) { say('Your background could not be read: ' + err.message + '.', true); }
        });

        return {
            menus: pub.menus,
            destroy: function () {
                destroyed = true;
                pub.destroy();
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
