/* node Tools/test-barcode-scanner.js [wwwroot]
   Browser checks additionally need Playwright. Set PLAYWRIGHT_MODULE to an
   installed module path when it is not in this repository's node_modules.
   BARCODE_BROWSER selects chromium (default), firefox or webkit. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const root = path.resolve(process.argv[2] || 'Application/parkscomputing-engine/wwwroot');
const context = vm.createContext({});
for (const file of ['barcode-engine.js', 'barcode-scanner-core.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context);
}
const B = context.pcBarcode, C = context.pcBarcodeScanner;
assert.equal(B.demos.length, 8);
for (const layout of B.demos) {
    assert.equal(B.layouts.validate(layout).length, 0, layout.id);
    const composed = B.layouts.compose(layout, layout.sample);
    assert(composed.ok, layout.id);
    const symbol = B.encode(layout.symbology, composed.input, layout.options);
    assert(symbol.ok, layout.id);
}
const retail = B.demos[0];
const composed = B.layouts.compose(retail, retail.sample);
const good = composed.input + B.checks['gs1-mod10'].compute(composed.input);
let result = C.inspect({ source: 'text', text: good, format: 'ean13' }, B.demos, retail.id, B);
assert.equal(result.matches.length, 1);
assert.equal(result.matches[0].values.price, '00349');
assert.equal(result.matches[0].issues.length, 0);
result = C.inspect({ source: 'text', text: good.slice(0, -1) + ((Number(good.at(-1)) + 1) % 10), format: 'ean13' }, B.demos, retail.id, B);
assert(result.matches[0].issues.some(x => /check digit/.test(x)));
assert.equal(C.inspect({ source: 'image', text: good, format: 'QRCode' }, B.demos, retail.id, B).matches.length, 0);
assert(C.inspect({ source: 'text', text: good }, B.demos, 'missing', B).issues[0].includes('not in this browser'));
const gs = '010950110153000317271231310301250010LOT42A';
result = C.inspect({ source: 'camera', text: gs, format: 'Code128', symbologyIdentifier: ']C1' }, B.demos, 'demo-logistics', B);
assert.equal(result.matches.length, 1);
assert.equal(result.matches[0].values.batch, 'LOT42A');
assert.equal(C.gs1Input('10LOT42\x1d17271231', B), '(10)LOT42(17)271231');
assert.throws(() => C.gs1Input('881234', B), /Unknown/);
assert.throws(() => C.gs1Input('01012', B), /length/);
assert.throws(() => C.gs1Input('10LOT(42)', B), /represented/);
assert(C.inspect({ source: 'text', text: good + '\r\n' }, B.demos, '', B).issues[0].includes('Whitespace'));
assert.equal(C.visible('\x1d\r\n'), '<GS><CR><LF>');
const spaced = { id: 'spaces', name: 'Spaces', symbology: 'code128', fields: [{ id: 'text', name: 'Text', type: 'text', length: 5 }] };
assert.equal(C.inspect({ source: 'text', text: ' A B ', format: 'code128' }, [spaced], 'spaces', B).matches[0].values.text, ' A B ');
assert.equal(C.inspect({ source: 'text', text: ' A B ', format: 'code128' }, [spaced], 'spaces', B).matches[0].issues.length, 0);
console.log('PASS layout validation, format restrictions, missing layouts, check digits and GS1 separators');

async function browserChecks() {
    const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
      <link rel="stylesheet" href="/pudl/pudl.css"><script src="/pudl/pudl-applets.js" defer></script><script src="/pudl/pudl-menu.js" defer></script>
      <script defer src="/registry.js"></script></head><body><main><div data-applet="barcode-scanner"></div></main></body></html>`;
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(fixture); return; }
        if (url.pathname === '/registry.js') { res.setHeader('Content-Type', 'application/javascript'); res.end("pudlApplets.define('barcode-scanner',{src:'/js/barcode-scanner.js',css:'/css/barcode-scanner.css',page:'/',ver:'test'});"); return; }
        try {
            const file = path.join(root, decodeURIComponent(url.pathname));
            res.setHeader('Content-Type', ({ '.js': 'application/javascript', '.css': 'text/css', '.wasm': 'application/wasm' })[path.extname(file)] || 'application/octet-stream');
            res.end(fs.readFileSync(file));
        } catch { res.statusCode = 404; res.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await pw[process.env.BARCODE_BROWSER || 'chromium'].launch();
    try {
        const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const errors = [], external = [];
        p.on('pageerror', e => errors.push(e.message));
        p.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:')) external.push(r.url()); });
        await p.goto('http://127.0.0.1:' + server.address().port);
        await p.getByRole('button', { name: 'Camera', exact: true }).waitFor();
        async function action(name) { await p.getByRole('button', { name: 'Actions', exact: true }).click(); await p.getByRole('button', { name, exact: true }).click(); }
        assert((await p.locator('.bs-stage').boundingBox()).height < 300, 'the empty reading border follows its content');
        await action('Install scanner');
        assert(await p.getByRole('dialog', { name: 'Install scanner', exact: true }).isVisible());
        assert.equal(await p.getByRole('link', { name: 'Open the standalone scanner' }).getAttribute('href'), '/page/barcode-scanner?frame');
        await p.keyboard.press('Escape');
        await p.getByLabel('Layout', { exact: true }).selectOption(retail.id);
        await action('Type or paste');
        await p.getByLabel('Scanned or pasted value').fill(good);
        await p.getByRole('button', { name: 'Decode value', exact: true }).click();
        assert((await p.locator('[data-role="results"]').textContent()).includes('00349'));
        assert(!p.url().includes(good));
        assert.equal(await p.locator('.bs-toolbar .btn:visible').count(), 2);
        assert.equal(await p.getByRole('button', { name: 'Camera', exact: true }).getAttribute('aria-pressed'), 'false');
        assert(await p.evaluate(() => {
            const stage = document.querySelector('.bs-stage').getBoundingClientRect();
            const fields = document.querySelector('.bs-fields').getBoundingClientRect();
            return stage.top >= 0 && stage.bottom <= innerHeight && fields.bottom <= stage.bottom && scrollY === 0;
        }), 'the result and decoded fields fit without page scrolling');
        await action('Scan details');
        assert(await p.getByRole('dialog', { name: 'Scan details' }).isVisible());
        await p.keyboard.press('Escape');
        assert.equal(await p.locator('dialog[open]').count(), 0);
        const png = await p.evaluate(() => {
            const B = pcBarcode, L = B.demos[0], s = B.encode(L.symbology, B.layouts.compose(L, L.sample).input);
            const canvas = document.createElement('canvas'); B.render(canvas, s.symbol, { px: 4 });
            return canvas.toDataURL('image/png').split(',')[1];
        });
        await p.locator('[data-role="image-file"]').setInputFiles({ name: 'price.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
        await p.waitForFunction(() => document.querySelector('[data-role="results"]').textContent.includes('EAN13'));
        assert((await p.locator('[data-role="results"]').textContent()).includes('00349'));
        const roundtrips = await p.evaluate(async () => {
            const out = [];
            for (const L of pcBarcode.demos) {
                const symbol = pcBarcode.encode(L.symbology, pcBarcode.layouts.compose(L, L.sample).input, L.options);
                const canvas = document.createElement('canvas'); pcBarcode.render(canvas, symbol.symbol, { px: 4 });
                const decoded = await ZXingWASM.readBarcodes(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height), { textMode: 'Plain' });
                const r = decoded.find(r => r.isValid);
                const match = r && pcBarcodeScanner.inspect({ ...r, source: 'image' }, pcBarcode.demos, L.id, pcBarcode);
                out.push({ id: L.id, format: r && r.format, ok: !!(match && match.matches.length && !match.matches[0].issues.length), issues: match && match.issues });
            }
            return out;
        });
        assert(roundtrips.every(r => r.ok), JSON.stringify(roundtrips));
        await p.addScriptTag({ url: '/js/vendor/qrcodegen-1.8.0.js' });
        const qrText = await p.evaluate(async () => {
            const symbol = pcBarcode.encode('qr', 'https://example.test/path?q=hello world');
            const canvas = document.createElement('canvas'); pcBarcode.render(canvas, symbol.symbol, { px: 5 });
            const decoded = await ZXingWASM.readBarcodes(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height), { textMode: 'Plain' });
            return decoded.find(r => r.isValid).text;
        });
        assert.equal(qrText, 'https://example.test/path?q=hello world');
        await p.locator('[data-role="layout-file"]').setInputFiles({ name: 'layout.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'pc-barcode-layouts', version: 1, layouts: [{ ...JSON.parse(JSON.stringify(retail)), id: 'test-private', name: 'Imported test' }] })) });
        await p.waitForFunction(() => !!document.querySelector('option[value="test-private"]'));
        await p.getByLabel('Layout', { exact: true }).selectOption('test-private');
        assert((await p.locator('[data-role="results"]').textContent()).includes('Imported test'));
        assert((await p.evaluate(() => localStorage.getItem('pc-barcode-layouts'))).includes('test-private'));
        // Product lookup never runs merely because the view or capture changed.
        let requests = 0, reply = { found: true, product: { product_name: '<Tea>', brands: 'Example', quantity: '250 g', ingredients_text: 'Tea leaves' } };
        await p.route('**/api/barcode-products/open-food-facts/*', async route => {
            requests++;
            await route.fulfill({ contentType: 'application/json', body: JSON.stringify(reply) });
        });
        await p.getByRole('button', { name: 'Lookup', exact: true }).click();
        assert.equal(requests, 0);
        assert((await p.locator('[data-role="lookup"]').textContent()).includes('restricted-circulation'));
        await action('Type or paste');
        await p.getByLabel('Scanned or pasted value').fill('3017620422003');
        await p.getByLabel('Input format', { exact: true }).selectOption('ean13');
        await p.getByRole('button', { name: 'Decode value', exact: true }).click();
        assert.equal(requests, 0);
        await p.getByRole('button', { name: 'Look up', exact: true }).click();
        await p.getByRole('heading', { name: '<Tea>', exact: true }).waitFor();
        assert.equal(requests, 1);
        assert.equal(await p.locator('[data-role="lookup"] tea').count(), 0);
        assert(!p.url().includes('3017620422003'));
        assert(!JSON.stringify(await p.evaluate(() => ({...localStorage}))).includes('3017620422003'));
        reply = { found: false };
        await p.getByRole('button', { name: 'Look up', exact: true }).click();
        await p.waitForFunction(() => document.querySelector('[data-role="lookup"]').textContent.includes('Not found in'));
        await p.getByRole('button', { name: 'Manage sources', exact: true }).click();
        await p.getByRole('button', { name: 'Copy as new source', exact: true }).click();
        const editor = p.getByLabel('Edit source JSON');
        const copy = JSON.parse(await editor.inputValue());
        assert(copy.id.startsWith('user:'));
        copy.name = 'My food lookup';
        await editor.fill(JSON.stringify(copy));
        await p.getByRole('button', { name: 'Save source', exact: true }).click();
        assert((await p.evaluate(() => localStorage.getItem('pc-barcode-lookup-sources'))).includes('My food lookup'));
        await p.getByRole('button', { name: 'Back to lookup', exact: true }).click();
        assert.equal(await p.getByLabel('Source', { exact: true }).inputValue(), copy.id);
        await action('Type or paste');
        await p.getByLabel('Scanned or pasted value').fill('https://example.test/path?q=hello');
        await p.getByLabel('Input format', { exact: true }).selectOption('qr');
        await p.getByRole('button', { name: 'Decode value', exact: true }).click();
        await p.getByLabel('Source', { exact: true }).selectOption('builtin:open-url');
        assert.equal(await p.getByRole('link', { name: 'Open URL', exact: true }).getAttribute('href'), 'https://example.test/path?q=hello');
        assert.equal(requests, 2);
        // A delayed provider response cannot replace a newer barcode.
        await action('Type or paste');
        await p.getByLabel('Scanned or pasted value').fill('3017620422003');
        await p.getByLabel('Input format', { exact: true }).selectOption('ean13');
        await p.getByRole('button', { name: 'Decode value', exact: true }).click();
        await p.getByLabel('Source', { exact: true }).selectOption('builtin:open-food-facts');
        await p.evaluate(() => {
            window.oldExecute = pcBarcodeLookup.execute;
            pcBarcodeLookup.execute = () => new Promise(resolve => { window.finishLookup = () => resolve({ found: true, title: 'Stale result', fields: [] }); });
        });
        await p.getByRole('button', { name: 'Look up', exact: true }).click();
        await action('Clear');
        await p.evaluate(() => { window.finishLookup(); pcBarcodeLookup.execute = window.oldExecute; });
        assert(!(await p.locator('[data-role="lookup"]').textContent()).includes('Stale result'));
        await p.getByRole('button', { name: 'Decode', exact: true }).click();
        console.log('PASS lookup privacy, product and missing results, source copying, QR preview and late-response cancellation');
        const cameraAPI = await p.evaluate(() => !!navigator.mediaDevices?.getUserMedia);
        if (cameraAPI) {
            // The late permission result must be released after the user stops.
            await p.evaluate(() => { window.stops = 0; navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.resolveCamera = () => resolve({ getTracks: () => [{ stop: () => window.stops++ }] }); }); });
            await p.getByRole('button', { name: 'Camera', exact: true }).click();
            assert.equal(await p.getByRole('button', { name: 'Camera', exact: true }).getAttribute('aria-pressed'), 'true');
            await p.getByRole('button', { name: 'Camera', exact: true }).click();
            assert.equal(await p.getByRole('button', { name: 'Camera', exact: true }).getAttribute('aria-pressed'), 'false');
            await p.evaluate(() => window.resolveCamera());
            await p.waitForFunction(() => window.stops === 1);
            // A real MediaStream from a generated barcode exercises the camera loop.
            await p.evaluate(() => {
                const B = pcBarcode, L = B.demos[0], canvas = document.createElement('canvas');
                B.render(canvas, B.encode(L.symbology, B.layouts.compose(L, L.sample).input).symbol, { px: 4 });
                window.testMedia = canvas.captureStream(5);
                navigator.mediaDevices.getUserMedia = async () => window.testMedia;
            });
            await p.getByRole('button', { name: 'Camera', exact: true }).click();
            await p.waitForFunction(() => document.querySelector('[data-role="details"]').textContent.includes('camera'));
            assert(await p.evaluate(() => window.testMedia.getTracks().every(t => t.readyState === 'ended')));
            // Clearing stops an active, undecodable stream too.
            await p.evaluate(() => {
                const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
                canvas.getContext('2d').fillRect(0, 0, 640, 480);
                window.testMedia = canvas.captureStream(5);
                navigator.mediaDevices.getUserMedia = async () => window.testMedia;
            });
            await p.getByRole('button', { name: 'Camera', exact: true }).click();
            await p.locator('video:visible').waitFor();
            assert(await p.evaluate(() => {
                const stage = document.querySelector('.bs-stage').getBoundingClientRect();
                const video = document.querySelector('video').getBoundingClientRect();
                return video.height > 0 && video.top >= stage.top && video.bottom <= stage.bottom && video.bottom <= innerHeight;
            }), 'the camera occupies the visible result area');
            await action('Clear');
            assert(await p.evaluate(() => window.testMedia.getTracks().every(t => t.readyState === 'ended')));
            await action('Clear');
            assert((await p.locator('[data-role="results"]').textContent()).includes('Ready for a barcode'));
            assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await p.evaluate(() => {
                const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
                window.testMedia = canvas.captureStream(5);
                navigator.mediaDevices.getUserMedia = async () => window.testMedia;
            });
            await p.getByRole('button', { name: 'Camera', exact: true }).click();
            await p.locator('video:visible').waitFor();
            await p.evaluate(() => pudlApplets.destroy(document.querySelector('main')));
            assert(await p.evaluate(() => window.testMedia.getTracks().every(t => t.readyState === 'ended')));
            console.log('PASS camera capture, cancellation and track cleanup');
        } else {
            await p.getByRole('button', { name: 'Camera', exact: true }).click();
            await p.waitForFunction(() => document.querySelector('[data-role="status"]').textContent.includes('Camera unavailable'));
            assert(await p.getByRole('button', { name: 'Camera', exact: true }).isEnabled());
            console.log('PASS unavailable-camera fallback; this browser build exposes no camera API');
        }
        assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        console.log('PASS actual ZXing image round trips for all 8 layouts plus QR, import, privacy and phone width');
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
browserChecks().catch(e => { console.error(e); process.exitCode = 1; });
