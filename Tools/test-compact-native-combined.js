/* Native taskbar activation and actions-popup reopening after returning from a tab. */
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
        await page.locator('#taskbar-launcher').click();
        await page.waitForFunction(() => pudlLauncher.state(document.getElementById('site-launcher')).visible);
        await page.evaluate(() => {
            window.sourceClicks = [];
            document.querySelector('[data-win-dock] [data-win-tab="one-word-or-two"]').addEventListener('click', e => sourceClicks.push(e));
        });
        const row = page.locator('[data-win-dock] [data-win-tab="one-word-or-two"]');
        await row.scrollIntoViewIfNeeded();
        assert.equal(await row.evaluate(n => n.tagName), 'A');
        const target = new URL(await row.getAttribute('href'), base).href;
        const newPage = context.waitForEvent('page', { timeout: 10000 });
        await row.click({ modifiers: ['Control'], noWaitAfter: true });
        const opened = await newPage;
        await opened.waitForURL(target, { waitUntil: 'commit', timeout: 15000 });
        await opened.close();
        await page.bringToFront();
        assert.deepEqual(await page.evaluate(() => sourceClicks.map(e => ({ control: e.ctrlKey, prevented: e.defaultPrevented }))), [{ control: true, prevented: false }]);
        assert.equal(await page.evaluate(() => pudlWindows.state().top), 'about');
        assert.equal(await page.evaluate(() => pudlLauncher.state(document.getElementById('site-launcher')).visible), true);
        console.log('PASS native modified taskbar anchor opened its original href with one native event and no original-window activation (' + engine + ')');
        await page.keyboard.press('Escape');
        await page.locator('.win-bar-windows:visible').click();
        const menu = page.getByRole('menu', { name: 'Windows', exact: true });
        await menu.waitFor({ timeout: 3000 }).catch(async error => {
            throw new Error(error.message + '\n' + JSON.stringify(await page.evaluate(() => ({
                menus: [...document.querySelectorAll('[role="menu"]')].filter(n => n.getClientRects().length).map(n => ({ name: n.getAttribute('aria-label'), text: n.innerText })),
                popovers: [...document.querySelectorAll(':popover-open')].map(n => ({ id: n.id, text: n.innerText })),
                state: pudlWindows.state()
            }))));
        });
        assert.deepEqual((await menu.locator(':scope > .menu-action').allTextContents()).map(t => t.trim()), ['Arrange taskbar', 'Minimize all', 'Close all windows']);
        assert.equal(await menu.locator('[data-win-tab],[data-win-pin],a').count(), 0);
        await page.keyboard.press('Escape');
        await row.scrollIntoViewIfNeeded();
        await row.click();
        await page.waitForFunction(() => pudlWindows.state().top === 'one-word-or-two');
        await page.waitForFunction(() => !pudlLauncher.state(document.getElementById('site-launcher')).visible);
        assert.deepEqual(await page.evaluate(() => sourceClicks.map(e => ({ control: e.ctrlKey, prevented: e.defaultPrevented }))), [{ control: true, prevented: false }, { control: false, prevented: true }]);
        console.log('PASS tab-return/Escape reopens actions-only Windows popup and direct taskbar activation executes once (' + engine + ')');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
