/* Native modified activation and plain source delegation in Windows navigation. */
const assert = require('node:assert/strict');
const { chromium, firefox } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_SITE || 'https://beta.parkscomputing.com';

(async () => {
    const engine = process.env.PINS_ENGINE || 'firefox';
    assert(['chromium', 'firefox'].includes(engine), 'WebKit real-site native navigation remains unclaimed');
    const executablePath = engine === 'chromium' ? process.env.CHROMIUM_PATH : process.env.PINS_BROWSER_PATH;
    const browser = await ({ chromium, firefox })[engine].launch({ executablePath });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 850 } });
        const page = await context.newPage();
        await page.goto(base + '/?open=about,coincidences,one-word-or-two,power-of-guitar&top=about&launcher=closed', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.pcTaskbarPins?.ready);
        await page.evaluate(() => {
            window.sourceClicks = 0;
            document.querySelector('[data-win-dock] [data-win-tab="one-word-or-two"]').addEventListener('click', () => sourceClicks++);
        });
        await page.locator('.win-bar-windows:visible').click();
        const row = page.getByRole('menu', { name: 'Windows', exact: true }).getByRole('menuitem', { name: /^One Word Or Two\?/i });
        assert.equal(await row.evaluate(n => n.tagName), 'A');
        const target = new URL(await row.getAttribute('href'), base).href;
        const newPage = context.waitForEvent('page', { timeout: 10000 });
        await row.click({ modifiers: ['Control'], noWaitAfter: true });
        const opened = await newPage;
        await opened.waitForURL(target, { waitUntil: 'commit', timeout: 15000 });
        await opened.close();
        await page.bringToFront();
        assert.equal(await page.evaluate(() => sourceClicks), 0);
        assert.equal(await page.evaluate(() => pudlWindows.state().top), 'about');
        console.log('PASS native modified Windows row opened its original href without a source click (' + engine + ')');
        await page.goto(base + '/?open=about,coincidences,one-word-or-two,power-of-guitar&top=about&launcher=closed', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.pcTaskbarPins?.ready);
        await page.evaluate(() => {
            window.sourceClicks = 0;
            document.querySelector('[data-win-dock] [data-win-tab="one-word-or-two"]').addEventListener('click', () => sourceClicks++);
        });
        await page.locator('.win-bar-windows:visible').click();
        await row.waitFor({ timeout: 3000 }).catch(async error => {
            throw new Error(error.message + '\n' + JSON.stringify(await page.evaluate(() => ({
                menus: [...document.querySelectorAll('[role="menu"]')].filter(n => n.getClientRects().length).map(n => ({ name: n.getAttribute('aria-label'), text: n.innerText })),
                popovers: [...document.querySelectorAll(':popover-open')].map(n => ({ id: n.id, text: n.innerText })),
                state: pudlWindows.state()
            }))));
        });
        await row.click();
        await page.waitForFunction(() => pudlWindows.state().top === 'one-word-or-two');
        assert.equal(await page.evaluate(() => sourceClicks), 1);
        console.log('PASS Windows navigation preserves native modified anchor behavior and plain source activation (' + engine + ')');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
