/* Real-host invocation focus and retained catalog state. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_SITE || 'https://beta.parkscomputing.com';

(async () => {
    const engine = process.env.PINS_ENGINE || 'firefox';
    const executablePath = engine === 'chromium' ? process.env.CHROMIUM_PATH : process.env.PINS_BROWSER_PATH;
    const browser = await ({ chromium, firefox, webkit })[engine].launch({ executablePath });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 950 } }), issues = [];
        await page.goto(base + '/?launcher=closed', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.pcTaskbarPins?.ready && window.pcLauncher);
        const root = page.locator('#site-launcher'), opener = page.locator('#taskbar-launcher');
        assert.equal(await opener.getAttribute('popovertarget'), 'site-launcher');
        assert.equal(await opener.evaluate(n => !!n.closest('[data-win-dock]')), false);
        await opener.click();
        await page.waitForFunction(() => document.activeElement.hasAttribute('data-start-query'));
        const panel = await root.boundingBox(), button = await opener.boundingBox();
        assert(panel.y + panel.height <= button.y + 1, 'Popup is above the taskbar opener');
        await page.keyboard.press('Escape');
        assert.equal(await opener.evaluate(n => n === document.activeElement), true);
        await opener.focus(); await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.activeElement.hasAttribute('data-start-query'));
        await page.keyboard.press('Escape');
        const titleId = await page.evaluate(() => pudlMenubar.launcherButton({ visible: true }).id);
        await page.locator('#' + titleId).click();
        await page.waitForFunction(() => document.activeElement.hasAttribute('data-start-query'), undefined, { timeout: 2000 }).catch(async () => {
            issues.push(await page.evaluate(() => ({ route: 'title', state: pudlLauncher.state(document.getElementById('site-launcher')),
                focus: document.activeElement.id, popup: document.getElementById('site-launcher').matches(':popover-open') })));
        });
        console.log('PASS permanent bottom-left opener, placement above and mouse/keyboard search focus (' + engine + ')');

        if (engine !== 'firefox') {
            const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 850 } });
            const touch = await context.newPage();
            await touch.goto(base + '/?launcher=closed', { waitUntil: 'domcontentloaded' });
            await touch.waitForFunction(() => window.pcTaskbarPins?.ready && window.pcLauncher);
            await touch.evaluate(() => {
                window.queryFocus = [];
                document.addEventListener('focusin', e => { if (e.target.matches('[data-start-query]')) queryFocus.push('query'); });
            });
            const launch = touch.locator('#taskbar-launcher');
            await launch.tap();
            await touch.waitForFunction(() => pudlLauncher.state(document.getElementById('site-launcher')).presentation === 'popup');
            await touch.waitForFunction(() => document.activeElement.id === 'site-launcher');
            assert.equal(await touch.evaluate(() => document.activeElement.id), 'site-launcher');
            assert.deepEqual(await touch.evaluate(() => queryFocus), [], 'No transient filter focus on touch open');
            const query = touch.locator('[data-start-query]');
            await query.tap(); assert.equal(await query.evaluate(n => n === document.activeElement), true);
            await query.fill('a');
            const retained = await touch.evaluate(() => {
                const root = document.getElementById('site-launcher');
                const category = root.querySelector('[data-start-category-key="articles"]') || root.querySelector('[data-start-category-key]:not([data-start-category-key=""])');
                pudlStart.setState(root, { category: category.getAttribute('data-start-category-key') });
                const list = root.querySelector('[data-start-items]'); list.scrollTop = 180;
                return { state: pudlStart.state(root), scroll: list.scrollTop };
            });
            assert(retained.scroll > 0);
            await launch.tap();
            await touch.waitForFunction(() => pudlLauncher.state(document.getElementById('site-launcher')).presentation === 'closed');
            await touch.evaluate(() => { queryFocus = []; });
            await launch.tap();
            await touch.waitForFunction(() => pudlLauncher.state(document.getElementById('site-launcher')).presentation === 'popup');
            await touch.waitForFunction(() => document.activeElement.id === 'site-launcher');
            assert.deepEqual(await touch.evaluate(() => queryFocus), []);
            const restored = await touch.evaluate(() => {
                const root = document.getElementById('site-launcher');
                return { state: pudlStart.state(root), scroll: root.querySelector('[data-start-items]').scrollTop };
            });
            assert.deepEqual(restored, retained);
            await touch.screenshot({ path: path.join(process.env.PINS_SHOTS, 'compact-touch-launcher-' + engine + '.png') });
            await context.close();
            console.log('PASS one-tap touch browsing, explicit filter entry and retained query/category/scroll without transient input focus (' + engine + ')');
        }
        assert.deepEqual(issues, [], 'Existing title launcher route remains functional');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
