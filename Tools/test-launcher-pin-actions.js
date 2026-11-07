/* Real-beta lazy pinning from launcher rows whose windows have never opened. */
const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_SITE || 'https://beta.parkscomputing.com';
(async () => {
    const engine = process.env.PINS_ENGINE || 'firefox';
    const executablePath = engine === 'chromium' ? process.env.CHROMIUM_PATH : process.env.PINS_BROWSER_PATH;
    const browser = await ({ chromium, firefox, webkit })[engine].launch(executablePath ? { executablePath } : {});
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        context.setDefaultTimeout(15000);
        const page = await context.newPage(), lookups = [], errors = [];
        page.on('request', request => {
            const path = new URL(request.url()).pathname;
            if (path.startsWith('/api/taskbar/destinations/')) { lookups.push(path.split('/').pop()); }
        });
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + '/?open=about&launcher=collapsed', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.pcTaskbarPins?.ready);
        await page.evaluate(() => pudlLauncher.present(document.getElementById('site-launcher'), 'popup'));
        const before = await page.evaluate(() => pudlWindows.state().open);
        const firstId = 'window-one-word-or-two';
        let release, started;
        const gate = new Promise(resolve => { release = resolve; });
        const requested = new Promise(resolve => { started = resolve; });
        await page.route('**/api/taskbar/destinations/' + firstId, async route => {
            started(); await gate; await route.continue();
        });
        await page.locator('[data-start-item]:has(a[data-win-open="one-word-or-two"])').click({ button: 'right' });
        await requested;
        const pending = page.getByRole('menuitem', { name: 'Resolving destination', exact: true });
        await pending.waitFor();
        assert.equal(await pending.isEnabled(), false);
        const retained = await pending.elementHandle();
        const focused = await page.evaluateHandle(() => document.activeElement);
        release();
        await page.getByRole('menuitem', { name: 'Pin to taskbar', exact: true }).waitFor();
        assert(await retained.evaluate(el => el.isConnected && el.textContent.includes('Pin to taskbar')), 'Pending menu row updates in place');
        assert(await page.evaluate(before => before === document.activeElement, focused), 'Resolution preserves focus');
        await page.getByRole('menuitem', { name: 'Pin to taskbar', exact: true }).click();
        await page.locator('[data-win-pin="' + firstId + '"] img').waitFor();
        assert.deepEqual(await page.evaluate(() => pudlWindows.state().open), before);
        assert.equal(await page.evaluate(() => pudlLauncher.state(document.getElementById('site-launcher')).presentation), 'popup');
        await page.unroute('**/api/taskbar/destinations/' + firstId);
        const second = page.locator('[data-start-item]:has(a[data-win-open="power-of-guitar"])');
        await second.hover();
        await second.locator('[data-row-actions]').click();
        await page.getByRole('menuitem', { name: 'Pin to taskbar', exact: true }).click();
        await page.locator('[data-win-pin="window-power-of-guitar"] img').waitFor();
        assert.deepEqual(await page.evaluate(() => pudlWindows.state().open), before);
        assert.equal(await page.evaluate(() => pudlLauncher.state(document.getElementById('site-launcher')).presentation), 'popup');
        assert(lookups.every(id => ['window-about', firstId, 'window-power-of-guitar'].includes(id)), 'Only requested row metadata is resolved');
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pc-taskbar-v1-guest')));
        assert.deepEqual(saved.references.map(r => r.id).sort(), [firstId, 'window-power-of-guitar'].sort());
        const excluded = page.locator('[data-start-item]:has(a[data-win-open="conway"])');
        await excluded.evaluate(row => row.setAttribute('data-win-pinnable', 'false'));
        await excluded.click({ button: 'right' });
        assert.equal(await page.locator('.context-menu:popover-open').count(), 0);
        assert(!lookups.includes('window-conway'), 'An excluded row performs no lookup');
        assert.equal(await page.evaluate(() => pudlLauncher.state(document.getElementById('site-launcher')).presentation), 'popup');
        console.log('PASS unopened rows resolve lazily, update the menu in place and pin without opening or dismissing the launcher (' + engine + ')');
        if (process.env.PINS_SHOTS) { await page.screenshot({ path: process.env.PINS_SHOTS + '/launcher-row-pins-' + engine + '.png' }); }
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.pcTaskbarPins?.ready);
        for (const id of [firstId, 'window-power-of-guitar']) {
            await page.locator('[data-win-pin="' + id + '"] img').waitFor();
            assert.equal(await page.locator('[data-win-pin="' + id + '"]').getAttribute('data-win-pin-running'), 'false');
        }
        assert.deepEqual(await page.evaluate(() => pudlWindows.state().open), before);
        assert.deepEqual(errors, []);
        console.log('PASS row-created references restore dormant pictures after reload (' + engine + ')');
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
