/* Real-host regressions for default article pinning and picture lifecycles. */
const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_SITE || 'https://beta.parkscomputing.com';

(async () => {
    const engine = process.env.PINS_ENGINE || 'firefox';
    const executablePath = engine === 'chromium' ? process.env.CHROMIUM_PATH : process.env.PINS_BROWSER_PATH;
    const browser = await ({ chromium, firefox, webkit })[engine].launch(executablePath ? { executablePath } : {});
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + '/?open=coincidences&launcher=collapsed', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.pcTaskbarPins?.ready);
        const pins = [];
        for (const key of ['coincidences', 'one-word-or-two', 'power-of-guitar']) {
            const result = await page.evaluate(async key => {
                const result = await pudlWindows.open(key);
                return result.status;
            }, key);
            assert(['opened', 'existing'].includes(result), 'Article opens: ' + key);
            const destination = await page.locator('.win[data-win="' + key + '"]').getAttribute('data-win-destination');
            await page.evaluate(id => pudlWindows.refreshTaskbarDestinations({ ids: [id] }), destination);
            const tab = page.locator('.win-bar [data-win-tab="' + key + '"]');
            await tab.click({ button: 'right' });
            await page.getByRole('menuitem', { name: 'Pin to taskbar', exact: true }).click();
            const pin = page.locator('.win-bar [data-win-pin][data-win-tab="' + key + '"]');
            await pin.waitFor();
            const id = await pin.getAttribute('data-win-pin');
            pins.push({ key, id });
            await pin.locator('img').waitFor();
            await page.waitForFunction(id => {
                const picture = document.querySelector('[data-win-pin="' + id + '"] img');
                return picture && picture.complete && picture.naturalWidth > 0 && !picture.hidden;
            }, id);
            assert.equal(await pin.locator('img').getAttribute('src'), '/favicon-16x16.png');
        }
        console.log('PASS successive article windows offer Pin and retain their picture');
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pc-taskbar-v1-guest')));
        assert.equal(saved.version, 2);
        assert.deepEqual(saved.references.map(r => r.id).sort(), pins.map(p => p.id).sort());
        assert(saved.references.every(r => r.provider === 'content'));
        await page.evaluate(() => pudlWindows.closeAll());
        for (const { id } of pins) {
            const pin = page.locator('.win-bar [data-win-pin="' + id + '"]');
            await pin.locator('img').waitFor();
            assert.equal(await pin.locator('img').getAttribute('src'), '/favicon-16x16.png');
        }
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.pcTaskbarPins?.ready);
        for (const { key, id } of pins) {
            const pin = page.locator('.win-bar [data-win-pin="' + id + '"]');
            await pin.locator('img').waitFor();
            if (process.env.PINS_SHOTS && key === pins[0].key) {
                await page.screenshot({ path: process.env.PINS_SHOTS + '/dormant-pictures-' + engine + '.png' });
            }
            await pin.click();
            await page.locator('.win[data-win="' + key + '"]').waitFor();
            await pin.click({ button: 'right' });
            await page.getByRole('menuitem', { name: 'Unpin from taskbar', exact: true }).click();
            await pin.waitFor({ state: 'detached' });
            await page.locator('.win-bar [data-win-tab="' + key + '"] img').waitFor();
        }
        assert.deepEqual(errors, []);
        console.log('PASS close-last, dormant reload, reopen and unpin preserve article pictures (' + engine + ')');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
