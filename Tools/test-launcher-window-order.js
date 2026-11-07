/* Real-host ordering checks for a launcher opening beside an existing article. */
const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_SITE || 'https://beta.parkscomputing.com';

(async () => {
    const engine = process.env.PINS_ENGINE || 'firefox';
    const executablePath = engine === 'chromium' ? process.env.CHROMIUM_PATH : process.env.PINS_BROWSER_PATH;
    const browser = await ({ chromium, firefox, webkit })[engine].launch(executablePath ? { executablePath } : {});
    try {
        for (const mode of ['pane', 'popup']) {
            const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
            const page = await context.newPage();
            const initial = page.locator('.win[data-win="barcode-flash-cards"]');
            for (const preserveSelection of [false, true]) {
                await page.goto(base + '/?launcher=collapsed&open=barcode-flash-cards&top=barcode-flash-cards', { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => !!window.pcTaskbarPins?.ready);
                await initial.locator('.win-head').click();
                await page.evaluate(mode => pudlLauncher.present(document.getElementById('site-launcher'), mode), mode);
                await page.locator('[data-start-query]').fill('Barbecue');
                let release, started;
                const gate = new Promise(resolve => { release = resolve; });
                const requested = new Promise(resolve => { started = resolve; });
                await page.route('**/window/barbecue-and-project-management', async route => {
                    started();
                    await gate;
                    await route.continue();
                });
                await page.locator('#site-launcher a[data-win-open="barbecue-and-project-management"]').click();
                await requested;
                if (mode === 'popup') {
                    await page.waitForFunction(() => !document.getElementById('site-launcher').matches(':popover-open'));
                }
                if (preserveSelection) { await initial.locator('.win-head').click(); }
                release();
                await page.locator('.win[data-win="barbecue-and-project-management"]').waitFor();
                const expected = preserveSelection ? 'barcode-flash-cards' : 'barbecue-and-project-management';
                assert.equal(await page.evaluate(() => pudlWindows.state().top), expected, mode + ' opening respects the latest selection');
                const order = await page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('.win[data-win]')).map(win => [win.dataset.win, Number(getComputedStyle(win).zIndex)])));
                const other = preserveSelection ? 'barbecue-and-project-management' : 'barcode-flash-cards';
                assert(order[expected] > order[other], 'Rendered stacking follows logical top');
                await page.unroute('**/window/barbecue-and-project-management');
                await page.evaluate(() => pudlWindows.close('barbecue-and-project-management'));
            }
            console.log('PASS ' + mode + ' opens Barbecue above Barcode Flash Cards and preserves intervening selection (' + engine + ')');
            await context.close();
        }
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
