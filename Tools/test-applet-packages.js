/* Browser checks for installed applet packages (Architecture/applet-packages-design.md,
   Pages/Services/AppletCatalog.cs), with the example package from the
   pudl-applet-packages repo installed at wwwroot/applets/hello:

     PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... UI_SITE=http://localhost:8102 node Tools/test-applet-packages.js

   The registry, the page the catalogue writes, the applet running on it
   and in a window, its entry in the Applets menu, the host's file service
   from an applet, its action through the broker, and its continuity. It
   runs signed out, so ~ is this browser's own. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.UI_SITE || 'http://localhost:8102';

let failures = 0;
function log(name, ok, detail) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + String(detail || '').slice(0, 400))); if (!ok) { failures++; } }

(async () => {
  const browser = await chromium.launch(Object.assign({ args: process.env.HOST_MAP ? ['--host-resolver-rules=' + process.env.HOST_MAP] : [] }, process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}));
  const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // The registry the server writes.
  const reg = await page.request.get(BASE + '/applets/registry.js');
  const regText = await reg.text();
  log('the registry is served as a script', reg.ok() && /javascript/.test(reg.headers()['content-type'] || ''), reg.status() + ' ' + (reg.headers()['content-type'] || ''));
  log('it defines the installed package from its manifest', /pudlApplets\.define\("hello", \{"src":"\/applets\/hello\/hello\.js","page":"\/page\/hello","ver":"0\.1\.0"/.test(regText), regText.slice(0, 300));
  log('and asks for its continuity', /pcContinuity\.add\("hello"\)/.test(regText));
  const again = await page.request.get(BASE + '/applets/registry.js', { headers: { 'If-None-Match': reg.headers().etag || '' } });
  log('a browser that has it is told so', again.status() === 304, again.status());

  // The page the catalogue writes, with the applet running on it.
  await page.goto(BASE + '/page/hello', { waitUntil: 'networkidle' });
  await page.waitForSelector('.hello-greeting', { timeout: 30000 });
  log('the package has a page, which runs the applet', (await page.textContent('.hello-greeting')) === 'Hello.');
  log('the page is an applet page: no tags, no dates', (await page.locator('.post-meta, .tag-row').count()) === 0);
  log('the host gives the applet pudlHost with the kit\'s helpers and the site\'s services', await page.evaluate(() => !!(window.pudlHost && pudlHost.identity && pudlHost.action && pudlHost.fs && pudlHost.config && pudlHost.pages === '/page/')));
  await page.waitForSelector('.hello-visits:not([hidden])', { timeout: 10000 });
  log('the applet keeps a file under ~ through the host\'s file service', /^Opened 1 time\.$/.test((await page.textContent('.hello-visits')).trim()), await page.textContent('.hello-visits'));
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('pc-terminal-home') || '{}'));
  log('and the file is in this browser\'s home directory', JSON.stringify(kept).includes('.hello') && JSON.stringify(kept).includes('visits.json'), JSON.stringify(kept).slice(0, 200));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.hello-visits:not([hidden])', { timeout: 10000 });
  log('the count goes up on the next visit', /^Opened 2 times\.$/.test((await page.textContent('.hello-visits')).trim()), await page.textContent('.hello-visits'));

  // Its state, kept by the site's continuity.
  await page.fill('#hello-name', 'Ada');
  await page.waitForTimeout(300);
  log('what the applet changes is kept for it', (await page.evaluate(() => localStorage.getItem('pc-hello'))) === 'Ada', await page.evaluate(() => localStorage.getItem('pc-hello')));

  // In the Applets menu and a window on the desktop.
  await page.goto(BASE + '/?view=window', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menubar-row', { timeout: 30000 });
  await page.click('.menubar-title[data-menu-id="applets"]');
  const item = page.locator('#menubar-panel').getByRole('menuitem', { name: 'Hello', exact: true });
  log('the Applets menu lists the package by its title', (await item.count()) === 1);
  await item.click();
  await page.waitForSelector('.win[data-win="hello"] .hello-greeting', { timeout: 30000 });
  log('and opens it in a window, where its state came back', (await page.textContent('.win[data-win="hello"] .hello-greeting')) === 'Hello, Ada.', await page.textContent('.win[data-win="hello"] .hello-greeting'));
  const size = await page.evaluate(() => { const w = document.querySelector('.win[data-win="hello"]'); return [w.getAttribute('data-win-min'), Math.round(w.getBoundingClientRect().width / innerWidth * 100)]; });
  log('the window takes the manifest\'s shape and least size', size[0] === '260,160' && size[1] >= 25 && size[1] <= 35, JSON.stringify(size));
  await page.click('.menubar-front .menubar-title', { timeout: 5000 }).catch(() => { });
  const front = await page.locator('#menubar-panel').innerText().catch(() => '');
  log('its menu has the applet\'s own entry and the window\'s commands', /Wave/.test(front) && /Open as a page/.test(front), front.slice(0, 200));
  await page.keyboard.press('Escape');

  // Its action, through the broker.
  const ran = await page.evaluate(async () => {
    await new Promise(r => { const s = document.createElement('script'); s.src = window.pcActionsSrc; s.onload = r; document.head.appendChild(s); });
    const cat = await window.pcActions.catalog();
    const out = await window.pcActions.invoke('example.hello/greet@1', { name: 'Ada' });
    return { listed: cat.some(m => m.id === 'example.hello'), output: out && out.output };
  }).catch(e => ({ error: String(e) }));
  log('the package\'s actions are in the broker\'s catalogue', ran.listed === true, JSON.stringify(ran));
  log('and run', ran.output && ran.output.greeting === 'Hello, Ada.', JSON.stringify(ran));

  log('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
