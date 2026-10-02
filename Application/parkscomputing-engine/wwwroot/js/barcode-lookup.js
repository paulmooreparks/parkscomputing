/* Versioned lookup definitions and execution, independent of scanner rendering. */
(function (global) {
    'use strict';
    var formats = { EAN13: 'ean13', EAN8: 'ean8', UPCA: 'upca', UPCE: 'upce', QRCode: 'qr', QRCodeModel2: 'qr' };
    var defaults = [{
        id: 'builtin:open-food-facts', revision: 1, name: 'Open Food Facts',
        description: 'Food products. Coverage varies; a missing record does not mean the barcode is invalid.',
        execution: 'request', accepts: [{ kind: 'gtin', symbologies: ['ean13', 'ean8', 'upca', 'upce'] }],
        request: { transport: 'connector', connector: 'open-food-facts' },
        response: { adapter: 'json-fields-v1', found: { pointer: '/found', equals: true }, notFound: { pointer: '/found', equals: false }, title: '/product/product_name', fields: [
            { label: 'Brand', pointer: '/product/brands' }, { label: 'Quantity', pointer: '/product/quantity' }, { label: 'Ingredients', pointer: '/product/ingredients_text' }
        ] },
        attribution: { name: 'Open Food Facts', url: 'https://world.openfoodfacts.org', text: 'Open Food Facts contributors. Database: ODbL; individual contents: DbCL.' }
    }, {
        id: 'builtin:open-url', revision: 1, name: 'Open URL', description: 'Preview the full address before opening it. No preview request is sent.',
        execution: 'local', handler: 'http-url-v1', accepts: [{ kind: 'uri' }]
    }];
    function fail(s) { throw new Error(s); }
    function object(v) { return v && typeof v === 'object' && !Array.isArray(v); }
    function keys(v, allowed) { if (!object(v) || Object.keys(v).some(function (k) { return allowed.indexOf(k) < 0; })) { fail('Unknown or invalid source fields.'); } }
    function str(v, label, max) { if (typeof v !== 'string' || !v.trim() || v.length > (max || 200)) { fail('Invalid ' + label + '.'); } }
    function safeUrl(s, https) {
        if (typeof s !== 'string' || /[\x00-\x20\x7f]/.test(s)) { fail('The URL contains whitespace or control characters.'); }
        var u = new URL(s);
        if (!(https ? u.protocol === 'https:' : /^(https?:)$/.test(u.protocol)) || u.username || u.password) { fail('Use an HTTP(S) URL without credentials.'); }
        return u.href;
    }
    function pointer(p) { if (typeof p !== 'string' || p.length > 300 || (p !== '' && p[0] !== '/') || /~(?![01])/.test(p)) { fail('Invalid JSON Pointer.'); } }
    function read(data, p) { pointer(p); return p === '' ? data : p.slice(1).split('/').reduce(function (v, key) { key = key.replace(/~1/g, '/').replace(/~0/g, '~'); return v != null && Object.prototype.hasOwnProperty.call(v, key) ? v[key] : undefined; }, data); }
    function validate(s, user) {
        keys(s, ['id', 'revision', 'name', 'description', 'execution', 'handler', 'accepts', 'symbologyMap', 'request', 'response', 'attribution', 'copiedFrom']);
        str(s.id, 'source ID'); if (!/^(builtin|user):[a-z0-9-]+$/.test(s.id) || (user && !s.id.startsWith('user:'))) { fail('User source IDs must start with user: and use lowercase letters, digits and hyphens.'); }
        str(s.name, 'name'); str(s.description, 'description', 1000);
        if (s.revision !== undefined && (!Number.isInteger(s.revision) || s.revision < 1)) { fail('Invalid revision.'); }
        if (s.copiedFrom !== undefined) { keys(s.copiedFrom, ['id', 'revision']); str(s.copiedFrom.id, 'original ID'); if (!Number.isInteger(s.copiedFrom.revision)) { fail('Invalid original revision.'); } }
        if (!Array.isArray(s.accepts) || !s.accepts.length || s.accepts.length > 20) { fail('Specify accepted identifiers.'); }
        s.accepts.forEach(function (r) { keys(r, ['kind', 'symbologies']); if (!['gtin', 'uri'].includes(r.kind)) { fail('This version supports gtin and uri identifiers.'); } if (r.symbologies && (!Array.isArray(r.symbologies) || !r.symbologies.length || r.symbologies.some(function (v) { return !['ean13','ean8','upca','upce','qr','code128','code39','codabar','itf','itf14','gs1-128'].includes(v); }))) { fail('Invalid symbology restriction.'); } });
        if (s.symbologyMap !== undefined) { if (!object(s.symbologyMap)) { fail('Invalid symbology map.'); } Object.keys(s.symbologyMap).forEach(function (k) { str(s.symbologyMap[k], 'endpoint symbology'); }); }
        if (s.execution === 'local') { if (s.handler !== 'http-url-v1' || s.request || s.response || s.symbologyMap || s.accepts.some(function (r) { return r.kind !== 'uri'; })) { fail('The local handler supports only HTTP(S) URLs.'); } }
        else if (s.execution === 'request') {
            if (s.handler || s.accepts.some(function (r) { return r.kind !== 'gtin'; })) { fail('Request sources currently accept GTINs only.'); }
            var r = s.request;
            if (r && r.transport === 'connector') { keys(r, ['transport','connector']); if (r.connector !== 'open-food-facts') { fail('Unknown connector.'); } }
            else {
                keys(r, ['transport','origin','path','query']); if (r.transport !== 'json-get') { fail('Use json-get or the Open Food Facts connector.'); }
                var u = new URL(safeUrl(r.origin, true)); if (u.origin !== r.origin) { fail('Origin must contain only HTTPS scheme and host.'); }
                str(r.path, 'path', 1000); if (!r.path.startsWith('/') || r.path.startsWith('//') || /[?#\\]/.test(r.path) || /\{(?!identifier.value\})/.test(r.path)) { fail('Invalid path template. Only {identifier.value} is supported.'); }
                if (r.query) { if (!object(r.query) || Object.keys(r.query).length > 30) { fail('Invalid query bindings.'); } Object.keys(r.query).forEach(function (k) { var v = r.query[k]; if (!['identifier.value','identifier.kind','symbology.endpoint'].includes(v)) { keys(v, ['literal']); str(v.literal, 'literal query value', 1000); } }); }
            }
            var a = s.response; keys(a, ['adapter','found','notFound','title','fields']); if (a.adapter !== 'json-fields-v1') { fail('Unknown response adapter.'); }
            [a.found,a.notFound].forEach(function (p) { keys(p, ['pointer','equals']); pointer(p.pointer); if (!['string','boolean','number'].includes(typeof p.equals)) { fail('Predicates require a scalar equals value.'); } });
            pointer(a.title); if (!Array.isArray(a.fields) || a.fields.length > 30) { fail('Invalid response fields.'); } a.fields.forEach(function (f) { keys(f, ['label','pointer']); str(f.label, 'field label'); pointer(f.pointer); });
            keys(s.attribution, ['name','url','text']); str(s.attribution.name, 'attribution'); safeUrl(s.attribution.url, true); str(s.attribution.text, 'attribution text', 2000);
        } else { fail('Unknown execution kind.'); }
        return s;
    }
    function file(data) {
        keys(data, ['format','version','sources']); if (data.format !== 'pc-barcode-lookup-sources' || data.version !== 1 || !Array.isArray(data.sources) || data.sources.length > 50) { fail('Expected a version 1 lookup-source file with at most 50 sources.'); }
        var ids = new Set(); data.sources.forEach(function (s) { validate(s, true); if (ids.has(s.id)) { fail('Duplicate source ID.'); } ids.add(s.id); }); return data.sources;
    }
    function identify(c, B) {
        if (!c) { return { reason: 'Scan or enter a barcode first.' }; }
        if (c.isValid === false) { return { reason: 'The decoder reported an invalid barcode.' }; }
        var sym = formats[c.format] || c.format || '', raw = c.text, value = raw;
        if (/^https?:\/\//i.test(raw)) { try { return { kind: 'uri', value: safeUrl(raw), symbology: sym, note: 'Opening this link sends a request to its destination.' }; } catch (e) { return { reason: e.message }; } }
        if (!sym) { return { reason: 'Select an EAN or UPC input format in Type or paste before product lookup.' }; }
        var length = { ean13: 13, ean8: 8, upca: 12, upce: 8 }[sym];
        if (!length) { return { reason: 'Lookup currently supports EAN/UPC products and HTTP(S) URLs.' }; }
        if (!new RegExp('^[0-9]{' + length + '}$').test(raw)) { return { reason: 'A complete barcode including its check digit is required.' }; }
        var encoded = B.encode(sym, raw); if (!encoded.ok) { return { reason: encoded.error }; }
        if (sym === 'upce') { value = encoded.expanded; }
        var ean = value.length === 12 ? '0' + value : value;
        // GS1 General Specifications: RCN prefixes 02, 04, 20-29; EAN-8 RCN prefix 0 or 2.
        if ((ean.length === 13 && /^(02|04|2)/.test(ean)) || (ean.length === 8 && /^[02]/.test(ean))) { return { reason: 'This is a restricted-circulation code. Use Decode with the retailer layout.' }; }
        return { kind: 'gtin', value: value, symbology: sym, note: sym === 'upce' ? 'UPC-E expanded to UPC-A for lookup. The original capture is unchanged.' : '' };
    }
    function eligible(s, id) { if (s.request && s.request.connector === 'open-food-facts' && /^(978|979|977|98|99)/.test(id.value || '')) { return false; } return !!id.kind && s.accepts.some(function (r) { return r.kind === id.kind && (!r.symbologies || r.symbologies.includes(id.symbology)); }); }
    function request(s, id) {
        validate(s); if (!eligible(s, id) || s.execution !== 'request') { fail('The source does not accept this identifier.'); }
        var r = s.request;
        if (r.transport === 'connector') { return '/api/barcode-products/open-food-facts/' + encodeURIComponent(id.value); }
        var u = new URL(r.path.replaceAll('{identifier.value}', encodeURIComponent(id.value)), r.origin);
        if (u.origin !== r.origin) { fail('Request origin changed.'); }
        Object.keys(r.query || {}).forEach(function (k) { var v = r.query[k], resolved = object(v) ? v.literal : v === 'identifier.value' ? id.value : v === 'identifier.kind' ? id.kind : (s.symbologyMap || {})[id.symbology]; if (resolved === undefined) { fail('This source needs an endpoint mapping for ' + id.symbology + '.'); } u.searchParams.set(k, resolved); }); return u.href;
    }
    function interpret(s, data) {
        var a = s.response, found = read(data,a.found.pointer) === a.found.equals, missing = read(data,a.notFound.pointer) === a.notFound.equals;
        if (found === missing) { fail('The response does not match the source definition.'); } if (missing) { return { found: false }; }
        var title = read(data,a.title); if (typeof title !== 'string' || !title.trim()) { fail('The response has no product name.'); }
        return { found: true, title: title, fields: a.fields.map(function (f) { var v = read(data,f.pointer); if (v == null || v === '') { return null; } if (!['string','number','boolean'].includes(typeof v)) { fail('A response field is not a scalar value.'); } return { label:f.label,value:String(v) }; }).filter(Boolean) };
    }
    async function execute(s, id, signal) {
        var response = await fetch(request(s,id), { signal:signal, credentials:'omit', redirect:'error', referrerPolicy:'no-referrer', cache:'no-store', headers:{ Accept:'application/json' } });
        if (response.status === 429) { var retry = response.headers.get('Retry-After'), seconds = /^\d+$/.test(retry || '') ? Number(retry) : Math.ceil((Date.parse(retry) - Date.now()) / 1000); var e = new Error('The source is rate limited. Try again later.'); e.retrySeconds = Number.isFinite(seconds) ? Math.max(1,seconds) : 60; throw e; }
        if (!response.ok) { fail('Lookup unavailable (HTTP ' + response.status + ').'); }
        if (!/\bjson\b/i.test(response.headers.get('Content-Type') || '')) { fail('The source did not return JSON.'); }
        var reader = response.body.getReader(), chunks = [], size = 0;
        try { while (true) { var part = await reader.read(); if (part.done) { break; } size += part.value.length; if (size > 2 * 1024 * 1024) { fail('The response exceeds 2 MiB.'); } chunks.push(part.value); } } catch (e) { await reader.cancel(); throw e; } finally { reader.releaseLock(); }
        var bytes = new Uint8Array(size), pos = 0; chunks.forEach(function (chunk) { bytes.set(chunk,pos); pos += chunk.length; });
        return interpret(s, JSON.parse(new TextDecoder().decode(bytes)));
    }
    defaults.forEach(function (s) { validate(s); });
    global.pcBarcodeLookup = { defaults:defaults, validate:validate, file:file, identify:identify, eligible:eligible, request:request, interpret:interpret, execute:execute, safeUrl:safeUrl };
})(typeof window === 'undefined' ? globalThis : window);
