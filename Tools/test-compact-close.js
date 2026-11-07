/* Bulk closing must preserve the Editor's real unsaved-work veto. */
const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_SITE || 'https://beta.parkscomputing.com';

(async () => {
    const engine = process.env.PINS_ENGINE || 'firefox';
    const executablePath = engine === 'chromium' ? process.env.CHROMIUM_PATH : process.env.PINS_BROWSER_PATH;
    const browser = await ({ chromium, firefox, webkit })[engine].launch({ executablePath });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
        await context.addInitScript(() => {
            const set = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key, value) {
                if (key === 'pc-editor-session') { throw new DOMException('Injected session quota failure', 'QuotaExceededError'); }
                return set.call(this, key, value);
            };
        });
        const page = await context.newPage();
        await page.goto(base + '/?open=about,coincidences,power-of-guitar&launcher=closed', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.pcTaskbarPins?.ready);
        await page.evaluate(async () => { const result = await pudlWindows.open('editor'); await pudlApplets.start(result.key); });
        const editor = page.locator('.win[data-win="editor"]');
        await editor.locator('.cm-content').fill('Unsaved compact navigation test');
        await editor.locator('.doc-tab-dirty').waitFor();
        await page.setViewportSize({ width: 320, height: 850 });
        await page.locator('.win-bar-windows:visible').click();
        await page.getByRole('menu', { name: 'Windows', exact: true }).getByRole('menuitem', { name: 'Close all windows', exact: true }).click();
        const question = page.getByRole('dialog', { name: 'Save changes before closing?', exact: true });
        await question.waitFor();
        assert((await page.evaluate(() => pudlWindows.state().open)).includes('editor'));
        await question.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert((await page.evaluate(() => pudlWindows.state().open)).includes('editor'));
        await page.setViewportSize({ width: 1440, height: 950 });
        await editor.locator('.cm-content').waitFor({ state: 'visible' });
        assert.equal(await editor.locator('.cm-content').innerText(), 'Unsaved compact navigation test');
        console.log('PASS compact Windows Close all respects real Editor unsaved-work veto and Cancel (' + engine + ')');
        await editor.locator('[data-win-action="close"]').click();
        await question.getByRole('button', { name: "Don't save", exact: true }).click();
        await editor.waitFor({ state: 'detached' });
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
