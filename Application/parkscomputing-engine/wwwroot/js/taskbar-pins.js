/* Beta taskbar adapter. Content resolves by category; storage remains host-owned. */
(function () {
    'use strict';
    var layer = document.querySelector('[data-win-layer]');
    if (!layer || !window.pudlWindows || !pudlWindows.refreshTaskbarDestinations) { return; }
    var preferences = { version: 2, pins: [], order: [], references: [] }, scope = 'guest';
    var storage = 'pc-taskbar-v1-guest', channel = null, writing = Promise.resolve(), initialized = false;
    var definitions = new Map();
    var terminalCount = -1;
    function notify(message) { if (window.pudlToast) { pudlToast(message); } }
    function windowFor(key) { return layer.querySelector('[data-win="' + CSS.escape(key) + '"]'); }
    function clean(value) {
        var key = /^[A-Za-z0-9_-]{1,100}$/;
        var destination = /^(?:[A-Za-z0-9_-]{1,100}|pudl-menu-(?:[a-f0-9]{4})+)$/;
        return value && [1, 2].indexOf(value.version) >= 0 && Array.isArray(value.pins) && Array.isArray(value.order)
            && JSON.stringify(value).length <= 32768
            && value.pins.length <= 50 && value.order.length <= 200
            && value.pins.every(function (id) { return typeof id === 'string' && destination.test(id); })
            && value.order.every(function (id) { return typeof id === 'string' && destination.test(id.replace(/^pin:/, '')); })
            && (value.version === 1 || (Array.isArray(value.references) && value.references.length <= 50
                && value.references.every(function (r) { return r && destination.test(r.id) && key.test(r.provider) && value.pins.indexOf(r.id) >= 0; })));
    }
    function upgrade(value) {
        var known = ['app-terminal', 'app-files', 'app-editor', 'settings', 'account', 'article-coincidences'];
        return Object.assign({}, value, { version: 2, pins: value.pins.slice(), order: value.order.slice(), references: value.version === 2
            ? value.references.slice() : value.pins.filter(function (id) { return known.indexOf(id) >= 0; })
                .map(function (id) { return { id: id, provider: 'content' }; }) });
    }
    async function lookup(id, signal, expectedScope) {
        var response = await fetch('/api/taskbar/destinations/' + encodeURIComponent(id), { credentials: 'same-origin', cache: 'no-store', signal: signal,
            headers: { Accept: 'application/json', 'X-Taskbar-Scope': expectedScope } });
        if (response.status === 403) { return { status: 'forbidden' }; }
        if (response.status === 404) { return { status: 'unavailable' }; }
        if (!response.ok) {
            var failure = new Error('Destination lookup failed. Reload or retry.');
            failure.scopeChanged = response.status === 409;
            throw failure;
        }
        var destination = await response.json();
        if (scope !== expectedScope) { throw new Error('The account changed during destination lookup.'); }
        if (destination.newWindow) {
            terminalCount = pudlWindows.state().open.filter(function (key) {
                var win = windowFor(key); return win && win.getAttribute('data-win-destination') === id;
            }).length;
            destination.newWindowDisabled = terminalCount >= 4;
        }
        definitions.set(id, destination);
        return { status: 'available', destination: destination };
    }
    var providers = [{ id: 'content', resolve: function (request) { return lookup(request.id, request.signal, request.scope); } }];
    function configure() {
        pudlWindows.configureTaskbar(Object.assign({}, preferences, { providers: providers, destinations: [], scope: scope }));
    }
    function mergeProjection() {
        var state = pudlWindows.taskbarState();
        var known = state.pins;
        var hidden = preferences.pins.filter(function (id) { return known.indexOf(id) < 0 && !definitions.has(id)
            && !preferences.references.some(function (r) { return r.id === id; }); });
        preferences = Object.assign({}, state, { version: 2, pins: hidden.concat(state.pins),
            order: preferences.order.filter(function (id) { return id.indexOf('pin:') === 0 && hidden.indexOf(id.slice(4)) >= 0; }).concat(state.order),
            references: state.references || [] });
    }
    function persist() {
        var snapshot = JSON.parse(JSON.stringify(preferences));
        if (scope === 'guest') {
            try { localStorage.setItem(storage, JSON.stringify(snapshot)); } catch (err) { notify('Taskbar changes could not be saved in this browser.'); }
        } else {
            var requestedScope = scope;
            writing = writing.catch(function () {}).then(async function () {
                if (scope !== requestedScope) { throw new Error('The account changed before taskbar preferences were saved.'); }
                var token = document.querySelector('meta[name="request-verification-token"]');
                var response = await fetch('/api/account/taskbar', { method: 'PUT', credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json', RequestVerificationToken: token ? token.content : '' },
                    body: JSON.stringify({ scope: requestedScope, preferences: snapshot }) });
                if (!response.ok) { throw new Error('Taskbar changes were not saved. Reload before retrying.'); }
            }).catch(function (error) { notify(error.message); });
        }
        if (channel) { channel.postMessage(snapshot); }
    }
    function initializeWindow(win) {
        return new Promise(function (resolve, reject) {
            var timer = setTimeout(function () { finish(new Error('Application initialization timed out. You can try again.')); }, 30000);
            function finish(error) { clearTimeout(timer); error ? reject(error) : resolve(); }
            try {
                if (!win || !win.isConnected) { finish(new Error('The window was closed before initialization.')); return; }
                var ready = window.pudlApplets ? pudlApplets.start(win.getAttribute('data-win')) : Promise.resolve();
                ready.then(function () {
                    if (!win.isConnected) { finish(new Error('The window was closed before it was ready.')); }
                    else if (win.querySelector('[data-applet-state="error"]')) { finish(new Error('The application could not start. You can try again.')); }
                    else { finish(); }
                }, finish);
            } catch (error) { finish(error); }
        });
    }
    layer.addEventListener('pudl:taskbar-activate', function (event) {
        var requested = event.detail, destination = definitions.get(requested.id);
        var priorTop = pudlWindows.state().top, priorFocus = document.activeElement, acceptedScope = scope;
        if (destination && destination.href && requested.action === 'open') {
            event.preventDefault();
            var launcher = document.getElementById('site-launcher');
            var launcherState = launcher && window.pudlLauncher && pudlLauncher.state(launcher);
            if (launcherState && launcherState.compact) { pudlLauncher.activated(launcher, requested.opener); }
            pudlWindows.open(destination.key, requested.opener); return;
        }
        event.preventDefault();
        requested.waitUntil((async function () {
            var resolution = await lookup(requested.id, undefined, acceptedScope);
            if (resolution.status !== 'available') { throw new Error('This destination is no longer available.'); }
            destination = resolution.destination;
            if (priorTop !== pudlWindows.state().top || (document.activeElement !== priorFocus && document.activeElement !== document.body)) {
                throw new Error('Opening was canceled because the selection changed. Try again when ready.');
            }
            var key = destination.key;
            if (requested.action === 'new') {
                if (!destination.newWindow) { throw new Error('This destination does not support another window.'); }
                var open = pudlWindows.state().open;
                key = [destination.key, destination.key + '-2', destination.key + '-3', destination.key + '-4']
                    .find(function (candidate) { return open.indexOf(candidate) < 0; });
                if (!key) { throw new Error('The Terminal already has four windows open.'); }
            }
            var result = await pudlWindows.open(key, requested.opener);
            if (result.status === 'failed' || result.status === 'blocked') { throw result.error || new Error('Window opening was refused.'); }
            try {
                await initializeWindow(result.window);
                var current = await lookup(requested.id, undefined, acceptedScope);
                if (current.status !== 'available') {
                    var denied = new Error('Access changed while the application opened.');
                    denied.scopeChanged = true;
                    throw denied;
                }
            } catch (error) {
                if (error.scopeChanged && result.status === 'opened') { pudlWindows.close(key); }
                throw error;
            }
        })());
    });
    layer.addEventListener('pudl:taskbar-activation-end', function (event) {
        if (event.detail.status === 'failed') { notify(event.detail.error.message || 'The destination could not open. Try again.'); }
    });
    layer.addEventListener('pudl:taskbar-change', function () { if (initialized) { mergeProjection(); persist(); } });
    layer.addEventListener('pudl:windows-change', function () {
        if (!initialized || !definitions.has('app-terminal')) { return; }
        var count = pudlWindows.state().open.filter(function (key) {
            var win = windowFor(key); return win && win.getAttribute('data-win-destination') === 'app-terminal';
        }).length;
        if (count !== terminalCount) {
            terminalCount = count;
            pudlWindows.refreshTaskbarDestinations({ ids: ['app-terminal'] });
        }
    });
    var checkingScope = false;
    async function checkScope() {
        if (!initialized || checkingScope) { return; }
        checkingScope = true;
        try {
            var response = await fetch('/api/account/taskbar', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
            var current = response.status === 401 ? 'guest' : response.ok ? (await response.json()).scope : scope;
            if (current !== scope) {
                initialized = false;
                scope = current;
                definitions.clear();
                if (channel) { channel.close(); }
                pudlWindows.configureTaskbar({ providers: [], destinations: [], scope: scope, pins: [], order: [], references: [] });
                location.reload();
            }
        } catch (error) { /* An unavailable server does not change the account or its preferences. */ }
        finally { checkingScope = false; }
    }
    window.addEventListener('focus', checkScope);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { checkScope(); } });
    document.addEventListener('pc:signed-in', function () { checkScope(); pudlWindows.refreshTaskbarDestinations(); });
    window.addEventListener('storage', function (event) {
        if (scope !== 'guest' || event.key !== storage) { return; }
        try { var value = JSON.parse(event.newValue); if (clean(value)) { preferences = upgrade(value); configure(); } } catch (err) { }
    });
    (async function () {
        var response = await fetch('/api/account/taskbar', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
        if (response.ok) {
            var account = await response.json(); scope = account.scope;
            if (clean(account.preferences)) { preferences = upgrade(account.preferences); }
        } else if (response.status === 401) {
            try { var saved = JSON.parse(localStorage.getItem(storage)); if (clean(saved)) { preferences = upgrade(saved); } } catch (err) { }
        } else { throw new Error('Taskbar preferences could not load. Reload to try again.'); }
        if (window.BroadcastChannel) {
            channel = new BroadcastChannel('pc-taskbar-v1-' + scope);
            channel.onmessage = function (event) { if (clean(event.data)) { preferences = upgrade(event.data); configure(); } };
        }
        initialized = true; configure();
        window.pcTaskbarPins = { ready: true, scope: scope, candidate: 'e329c43c51c4a19df35181f5a9421219fd48c864' };
    })().catch(function (error) { notify(error.message); });
})();
