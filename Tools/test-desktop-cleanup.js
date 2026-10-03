/* Browser integration checks for the Windowed workspace. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.UI_SITE || 'http://localhost';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const toggle = page.locator('[data-sidebar-toggle]');
    const sidebar = page.locator('.md-sidebar');
    const waitPane = pane => page.waitForFunction(pane => document.querySelector('.md-layout').dataset.mdPane === pane, pane);
    const state = () => page.evaluate(() => window.pudlWindows.state());
    const openUrl = '/?view=window&open=coincidences,terminal,files&top=coincidences';
    try {
        await page.goto(origin + openUrl);
        await toggle.waitFor({ state: 'visible' });
        await page.locator('[data-win-tab="coincidences"] .task-icon').waitFor();
        await page.locator('[data-win="files"] [data-applet="files"]').waitFor();
        const bar = await page.locator('.win-bar').boundingBox();
        const list = await sidebar.boundingBox();
        assert.equal(bar.x, 0);
        assert.equal(bar.width, 1440);
        assert(list.y + list.height <= bar.y + 1);
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        await toggle.hover();
        await page.getByRole('tooltip').waitFor({ state: 'visible' });
        assert.equal(await page.getByRole('tooltip').innerText(), 'Hide sidebar');
        const before = await state();
        await toggle.click();
        assert(!(await sidebar.isVisible()));
        assert.deepEqual(await state(), before);
        await page.mouse.move(800, 50);
        // Let PUDL's delayed pointer-leave dismissal finish before re-entry.
        await page.waitForTimeout(200);
        await toggle.hover();
        await page.getByRole('tooltip').waitFor({ state: 'visible' });
        assert.equal(await page.getByRole('tooltip').innerText(), 'Show sidebar');
        await page.locator('.menubar-title[data-menu-id="view"]').first().click();
        await page.getByRole('menuitem', { name: 'Show sidebar', exact: true }).click();
        assert(await sidebar.isVisible());
        await page.locator('.menubar-title[data-menu-id="view"]').first().click();
        await page.getByRole('menuitem', { name: 'Hide sidebar', exact: true }).click();
        assert(!(await sidebar.isVisible()));
        await page.reload();
        await toggle.waitFor({ state: 'visible' });
        assert(!(await sidebar.isVisible()));
        await toggle.click();
        assert(await sidebar.isVisible());
        const splitter = page.locator('.md-resize');
        async function dragSplitter(delta) {
            const box = await splitter.boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 12 });
            await page.mouse.up();
        }
        assert.equal((await splitter.boundingBox()).width, 24);
        await toggle.click();
        assert(await splitter.isVisible());
        assert.equal(await splitter.getAttribute('aria-valuenow'), '0');
        assert(await sidebar.evaluate(el => el.inert));
        await dragSplitter(260);
        assert(await sidebar.isVisible());
        assert(Math.abs((await sidebar.boundingBox()).width - 260) < 2);
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        await dragSplitter(-260);
        assert(!(await sidebar.isVisible()));
        assert(await splitter.isVisible());
        await splitter.press('ArrowRight');
        assert(await sidebar.isVisible());
        await splitter.press('Home');
        assert(!(await sidebar.isVisible()));
        await splitter.press('Enter');
        assert(await sidebar.isVisible());
        assert.equal(await page.locator('[data-win-tab="coincidences"] img').getAttribute('src'), '/favicon-16x16.png');
        assert.equal(await page.locator('[data-win-tab="terminal"] .glyph').count(), 1);
        assert.equal(await page.locator('[data-win-tab="files"] .glyph').count(), 1);
        assert.equal(await page.locator('.view-seg a').first().innerText(), 'Windowed');

        for (const theme of ['light', 'dark']) {
            await page.evaluate(theme => window.pudlSetTheme(theme), theme);
            const colors = await page.locator('.menubar-menu').first().evaluate(el => {
                const css = getComputedStyle(el);
                return { background: css.backgroundColor, image: css.backgroundImage, border: css.borderTopWidth };
            });
            assert.equal(colors.image, 'none');
            assert.equal(colors.border, '1px');
            await page.screenshot({ path: process.env.TEMP + '/parks-ui-' + theme + '.png' });
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await waitPane('detail');
        assert.equal(await toggle.getAttribute('aria-label'), 'Show sidebar');
        assert(await splitter.isVisible());
        await dragSplitter(100);
        await waitPane('list');
        assert(await sidebar.isVisible());
        await splitter.press('Enter');
        await waitPane('detail');
        await page.evaluate(() => window.pudlWindows.minimize('files'));
        const visibleBefore = await state();
        await toggle.click();
        await waitPane('list');
        assert(await sidebar.isVisible());
        assert(await page.locator('.win-bar').isVisible());
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        await page.reload();
        await waitPane('list');
        await toggle.click();
        await waitPane('detail');
        const restored = await state();
        assert.deepEqual(restored.min, visibleBefore.min);
        assert.equal(restored.top, visibleBefore.top);
        await page.locator('.min-all').click();
        await waitPane('list');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        await page.locator('[data-win-tab="coincidences"]').click();
        await waitPane('detail');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        await page.screenshot({ path: process.env.TEMP + '/parks-ui-mobile.png' });
        await page.locator('.close-all').click();
        await waitPane('list');
        assert(await toggle.isDisabled());
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForFunction(() => !document.querySelector('[data-sidebar-toggle]').disabled);
        await toggle.click();
        assert(!(await sidebar.isVisible()));
        await toggle.click();
        await page.goto(origin + '/home');
        assert.equal(await page.locator('.view-seg a').first().innerText(), 'Windowed');
        assert.deepEqual(errors, []);
        console.log('PASS: taskbar bounds, sidebar preservation and persistence, mobile restoration and automatic state, icons, themes, Classic naming, and browser errors.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
