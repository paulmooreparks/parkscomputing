/* The barcode collection as installed applet packages (pudl-barcodes,
   wwwroot/applets/barcodes, barcode-scanner and flashcards): each page
   runs its package's script, the layouts kept in this browser move into
   ~/barcode-layouts.json and the scanner reads them there, the site's
   Open and Save as dialogs and its product lookup reach the packages
   through pudlHost, and the tool keeps its window, icon, menus and
   continuity. It runs signed out, so ~ is this browser's own.

     PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... UI_SITE=http://localhost:8102 node Tools/test-barcodes-package.js */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.UI_SITE || 'http://localhost:8102';

let failures = 0;
function log(name, ok, detail) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + String(detail || '').slice(0, 400))); if (!ok) { failures++; } }

const SHELF = { id: 'my-shelf', name: 'My shelf label', symbology: 'code128', fields: [{ id: 'item', name: 'Item', type: 'text', length: 6 }], sample: { item: 'ABC123' } };
const OTHER = Object.assign({}, SHELF, { id: 'my-other', name: 'Another label' });
const file = list => JSON.stringify({ format: 'pc-barcode-layouts', version: 1, layouts: list });

(async () => {
  const browser = await chromium.launch(Object.assign({ args: process.env.HOST_MAP ? ['--host-resolver-rules=' + process.env.HOST_MAP] : [] }, process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}));
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  const errors = [], scripts = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { const p = new URL(r.url()).pathname; if (/barcode|flashcards/.test(p) && /\.js$/.test(p)) { scripts.push(p); } });
  const menu = () => page.textContent('[data-applet="barcodes"] [data-role="layout-menu"]');
  const notice = () => page.textContent('[data-applet="barcodes"] [data-role="notice-text"]');

  // The tool, and the layouts this browser kept before.
  await page.goto(BASE + '/page/barcodes', { waitUntil: 'networkidle' });
  await page.evaluate(l => { localStorage.removeItem('pc-barcode-layouts-moved'); localStorage.setItem('pc-barcode-layouts', l); }, file([SHELF]));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => /My shelf label/.test((document.querySelector('[data-applet="barcodes"] [data-role="layout-menu"]') || {}).textContent || ''), null, { timeout: 30000 });
  log('the page runs the package\'s script, not the site\'s old one', scripts.includes('/applets/barcodes/barcode-tool.js') && !scripts.some(s => s.startsWith('/js/barcode')), scripts.join());
  log('the layouts this browser kept move into ~/barcode-layouts.json', /my-shelf/.test(await page.evaluate(() => pudlHost.fs.readText('~/barcode-layouts.json'))));
  log('and move once, the browser\'s copy kept aside', await page.evaluate(() => localStorage.getItem('pc-barcode-layouts') === null && !!localStorage.getItem('pc-barcode-layouts-moved')));
  log('the Layout menu says where they are', /Your layouts \(in ~\/barcode-layouts\.json\)/.test(await menu()), await menu());

  // A change to the file, as the Editor or the Terminal would make it.
  await page.evaluate(l => pudlHost.fs.writeText('~/barcode-layouts.json', l), file([SHELF, OTHER]));
  await page.waitForFunction(() => /Another label/.test(document.querySelector('[data-applet="barcodes"] [data-role="layout-menu"]').textContent), null, { timeout: 5000 }).catch(() => { });
  log('a change to the file reaches the tool', /Another label/.test(await menu()), await menu());

  // Save as, through the site's dialog.
  await page.fill('[data-applet="barcodes"] [data-role="data"]', '400638133393');
  await page.click('[data-applet="barcodes"] [data-action="svg"]');
  await page.waitForSelector('dialog[open] [data-pick="input"]', { timeout: 10000 });
  await page.fill('dialog[open] [data-pick="input"]', 'test-barcode.svg');
  await page.click('dialog[open] [data-pick="ok"]');
  await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-applet="barcodes"] [data-role="notice-text"]').textContent), null, { timeout: 10000 }).catch(() => { });
  const svg = await page.evaluate(() => pudlHost.fs.readText('~/test-barcode.svg'));
  log('Save SVG goes through the site\'s dialog into ~', /Saved ~\/test-barcode\.svg/.test(await notice()) && /^<svg|<\?xml/.test(svg || ''), await notice());

  // Open, through the site's dialog, refusing the library itself.
  await page.evaluate(() => { window.opened = pudlHost.fs.open({ title: 'Open layouts', accept: ['.json'], check: p => p === '~/barcode-layouts.json' ? 'This is the library.' : null }); });
  await page.waitForSelector('dialog[open] [data-pick="input"]', { timeout: 10000 });
  await page.fill('dialog[open] [data-pick="input"]', '~/barcode-layouts.json');
  await page.click('dialog[open] [data-pick="ok"]');
  await page.waitForTimeout(300);
  const refused = await page.evaluate(() => { const e = document.querySelector('dialog[open] [data-pick="error"]'); return e && !e.hidden ? e.textContent : ''; });
  log('the host\'s Open asks the applet\'s check', /This is the library/.test(refused), refused);
  await page.evaluate(l => pudlHost.fs.writeText('~/more-layouts.json', l), file([SHELF]));
  await page.fill('dialog[open] [data-pick="input"]', '~/more-layouts.json');
  await page.click('dialog[open] [data-pick="ok"]');
  const got = await Promise.race([page.evaluate(() => window.opened), new Promise(r => setTimeout(() => r({ error: 'the dialog did not close' }), 5000))]).catch(e => ({ error: e.message }));
  log('and gives the file\'s path, name and text', got && got.path === '~/more-layouts.json' && got.name === 'more-layouts.json' && /my-shelf/.test(got.text || ''), JSON.stringify(got).slice(0, 200));

  // The scanner reads the same library, and looks products up through the site.
  scripts.length = 0;
  await page.goto(BASE + '/page/barcode-scanner', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-applet="barcode-scanner"] [data-role="layout"]', { timeout: 30000 });
  await page.waitForFunction(() => !!document.querySelector('[data-applet="barcode-scanner"] option[value="my-other"]'), null, { timeout: 10000 }).catch(() => { });
  log('the scanner runs its package\'s script', scripts.includes('/applets/barcode-scanner/barcode-scanner.js') && !scripts.some(s => s.startsWith('/js/barcode')), scripts.join());
  log('and offers the layouts in ~/barcode-layouts.json', await page.evaluate(() => !!document.querySelector('[data-applet="barcode-scanner"] option[value="my-shelf"]') && !!document.querySelector('[data-applet="barcode-scanner"] option[value="my-other"]')));
  let asked = null;
  await page.route('**/api/barcode-products/open-food-facts/*', route => { asked = new URL(route.request().url()).pathname; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ found: true, product: { product_name: 'Test tea' } }) }); });
  await page.click('[data-applet="barcode-scanner"] .bs-toolbar .menu-btn');
  await page.click('[data-applet="barcode-scanner"] [data-action="type"]');
  await page.fill('[data-applet="barcode-scanner"] [data-role="text"]', '3017620422003');
  await page.selectOption('[data-applet="barcode-scanner"] [data-role="format"]', 'ean13');
  await page.click('[data-applet="barcode-scanner"] [data-role="text-form"] button[type="submit"]');
  await page.click('[data-applet="barcode-scanner"] [data-view="lookup"]');
  await page.waitForSelector('[data-applet="barcode-scanner"] [data-lookup="run"]', { timeout: 5000 }).catch(() => { });
  const lookupText = await page.textContent('[data-applet="barcode-scanner"] [data-role="lookup"]');
  log('Open Food Facts is offered, through this site', /Open Food Facts through this site/.test(lookupText), lookupText.slice(0, 300));
  await page.click('[data-applet="barcode-scanner"] [data-lookup="run"]').catch(() => { });
  await page.waitForFunction(() => /Test tea/.test(document.querySelector('[data-applet="barcode-scanner"] [data-role="lookup"]').textContent), null, { timeout: 5000 }).catch(() => { });
  log('the lookup goes to the site\'s service', asked === '/api/barcode-products/open-food-facts/3017620422003' && /Test tea/.test(await page.textContent('[data-applet="barcode-scanner"] [data-role="lookup"]')), asked);
  log('the scanner\'s page still links its web-app manifest', (await page.getAttribute('link[rel="manifest"]', 'href').catch(() => null)) === '/barcode-scanner.webmanifest');

  // The flash cards' scans come from their package.
  const scans = [];
  page.on('response', r => { if (/\/scans\//.test(r.url())) { scans.push(new URL(r.url()).pathname + ' ' + r.status()); } });
  await page.goto(BASE + '/page/flashcards', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-applet="flashcards"] [data-action="next"]', { timeout: 30000 });
  for (let i = 0; i < 60 && !scans.length; i++) { await page.click('[data-applet="flashcards"] [data-action="next"]'); await page.waitForTimeout(50); }
  log('a flash card\'s scan comes from the package', scans.length > 0 && scans.every(s => /^\/applets\/flashcards\/scans\/\S+ 200$/.test(s)), scans.join(', ') || 'no scan card shown');

  // The tool in a window: icon, menus, continuity.
  await page.goto(BASE + '/?view=window&open=barcodes&top=barcodes', { waitUntil: 'networkidle' });
  await page.waitForSelector('.win[data-win="barcodes"] [data-role="data"]', { timeout: 30000 });
  log('the tool opens in a window with its icon', (await page.getAttribute('.win[data-win="barcodes"]', 'data-window-icon')) === '/images/icons/barcodes.svg', await page.getAttribute('.win[data-win="barcodes"]', 'data-window-icon'));
  const titles = await page.evaluate(() => {
    const src = pudlApplets.menuSourceIn(document.querySelector('.win[data-win="barcodes"]'));
    const m = src && src.menus && src.menus();
    return m ? m.titles.map(t => t.label + ':' + (t.items || []).map(i => typeof i === 'string' ? i : i.label).join('|')).join(' / ') : '';
  });
  log('its menus have the window\'s commands and its own', /^Barcode Tool:.*Open as a page/.test(titles) && /File:Open layouts/.test(titles), titles);
  await page.fill('.win[data-win="barcodes"] [data-role="data"]', '480036140036');
  await page.waitForTimeout(800);
  log('its state is kept under the key it always had, pc-barcodes', /480036140036/.test(await page.evaluate(() => localStorage.getItem('pc-barcodes') || '')));

  log('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
