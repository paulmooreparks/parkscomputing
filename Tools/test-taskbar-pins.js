/* Real beta host checks for the frozen taskbar candidate. */
const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_SITE || 'https://beta.parkscomputing.com';
(async () => {
    const engine = process.env.PINS_ENGINE || 'chromium';
    const executablePath = engine === 'chromium' ? process.env.CHROMIUM_PATH : process.env.PINS_BROWSER_PATH;
    const browser = await ({ chromium, firefox, webkit })[engine].launch(executablePath ? { executablePath } : {});
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(() => { if (!localStorage.getItem('pc-taskbar-v1-guest')) { localStorage.setItem('pc-taskbar-v1-guest', JSON.stringify({ version: 1, pins: ['app-terminal', 'article-coincidences'], order: [] })); } });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(base + '/?open=about&top=about&launcher=collapsed', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.pcTaskbarPins?.ready);
        assert.equal(await page.evaluate(() => pcTaskbarPins.candidate), process.env.PINS_CANDIDATE || '1793669234fd1c4ef50bee22a41807b91ff6a11a');
        const pin = id => page.locator('.win-bar [data-win-pin="' + id + '"]');
        const windowFor = key => page.locator('.win[data-win="' + key + '"]');
        await page.evaluate(() => { pudlWindows.pinTaskbar('app-terminal', true); pudlWindows.pinTaskbar('article-coincidences', true); });
        await pin('app-terminal').waitFor();
        let requests = 0, release, startedResolve;
        const started = new Promise(resolve => { startedResolve = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        await page.route('**/window/terminal', async route => { requests++; startedResolve(); await gate; await route.continue(); });
        await pin('app-terminal').click();
        await pin('app-terminal').waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.querySelector('[data-win-pin="app-terminal"]').getAttribute('aria-busy') === 'true');
        await pin('app-terminal').evaluate(el => { el.click(); el.click(); });
        await started;
        await page.locator('[data-win="about"] .win-title').click();
        release();
        await windowFor('terminal').waitFor();
        await page.waitForFunction(() => document.querySelector('[data-win-pin="app-terminal"]').getAttribute('aria-busy') !== 'true');
        assert.equal(requests, 1);
        assert.equal(await windowFor('terminal').getAttribute('data-win-destination'), 'app-terminal');
        assert.equal(await page.evaluate(() => pudlWindows.state().top), 'about', 'Delayed opening preserves later active window');
        await pin('app-terminal').click();
        await page.waitForFunction(() => pudlWindows.state().top === 'terminal');
        await page.evaluate(() => pudlWindows.minimize('terminal'));
        await pin('app-terminal').click();
        await page.waitForFunction(() => !pudlWindows.state().min.terminal);
        console.log('PASS dormant async open, repeat suppression, destination identity, delayed focus and singleton restore');

        await pin('app-terminal').click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'New window', exact: true }).click();
        await windowFor('terminal-2').waitFor();
        await page.waitForFunction(() => document.querySelector('[data-win-pin="app-terminal"]').getAttribute('aria-busy') !== 'true');
        assert.equal(await windowFor('terminal-2').getAttribute('data-win-destination'), 'app-terminal');
        await pin('app-terminal').click();
        await page.locator('.win-stack-panel').waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        await page.evaluate(() => { pudlWindows.close('terminal-2'); pudlWindows.close('terminal'); });
        await windowFor('terminal').waitFor({ state: 'detached' });
        await pin('app-terminal').waitFor();
        await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => !!window.pcTaskbarPins?.ready);
        await pin('app-terminal').waitFor(); await pin('article-coincidences').waitFor();
        console.log('PASS New window, multi-instance chooser, close-last pin retention and guest reload');

        await page.evaluate(() => {
            window.pinEnds = [];
            document.querySelector('[data-win-layer]').addEventListener('pudl:taskbar-activation-end', e => pinEnds.push({ id: e.detail.id, status: e.detail.status }));
        });
        await page.route('**/window/terminal', route => route.fulfill({ status: 503, contentType: 'text/html', body: 'Unavailable' }));
        await pin('app-terminal').click();
        await page.waitForFunction(() => pinEnds.some(e => e.status === 'failed'), null, { timeout: 5000 });
        assert.notEqual(await pin('app-terminal').getAttribute('aria-busy'), 'true');
        await page.unroute('**/window/terminal');
        await pin('app-terminal').click(); await windowFor('terminal').waitFor();
        await page.waitForFunction(() => pinEnds.some(e => e.status === 'completed'));
        assert.equal(new URL(await pin('article-coincidences').getAttribute('href'), base).href, base + '/page/coincidences');
        await pin('article-coincidences').click(); await windowFor('coincidences').waitFor();
        assert.equal(await windowFor('coincidences').getAttribute('data-win-destination'), 'article-coincidences');
        console.log('PASS failed command open clears pending and permits retry; article pin retains its canonical link and identity');

        await windowFor('coincidences').locator('[data-win-action="menu"]').click();
        await page.locator('[popover]:popover-open').getByText('Unpin from taskbar', { exact: true }).click();
        await pin('article-coincidences').waitFor({ state: 'detached' });
        await windowFor('coincidences').waitFor();
        await page.evaluate(() => pudlWindows.closeAll());
        await pin('app-terminal').waitFor();
        assert.equal(await page.locator('.pin-bar, [data-applet="pin-bar"]').count(), 0);
        console.log('PASS standard chrome unpin preserves its window; bulk close preserves taskbar pins without the retired Pins applet');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => pudlLauncher.present(document.getElementById('site-launcher'), 'pane'));
        await pin('app-terminal').click();
        await windowFor('terminal').waitFor();
        assert.equal(await page.locator('.catalog-reader').isVisible(), true, 'Taskbar activation reveals the phone workspace');
        await page.locator('.menubar-one .menubar-title').click();
        await page.getByRole('menuitem', { name: 'Open launcher', exact: true }).waitFor();
        await page.keyboard.press('Escape');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (process.env.PINS_SHOTS) { await page.screenshot({ path: process.env.PINS_SHOTS + '/taskbar-' + engine + '-phone.png' }); }
        assert.deepEqual(errors, []);
        console.log('PASS folded launcher discoverability, narrow layout and no page errors (' + engine + ')');
        await context.close();
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
