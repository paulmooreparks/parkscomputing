/* Real-host compact navigation, source commands and window safety checks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_SITE || 'https://beta.parkscomputing.com';
const fingerprint = process.env.PINS_CANDIDATE || 'f464e535e2599ce812f38d19a551fb85db6d082d44cca0c689e7d0830975bba0';
const output = process.env.PINS_SHOTS;

(async () => {
    const engine = process.env.PINS_ENGINE || 'firefox';
    const executablePath = engine === 'chromium' ? process.env.CHROMIUM_PATH : process.env.PINS_BROWSER_PATH;
    const browser = await ({ chromium, firefox, webkit })[engine].launch({ executablePath });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
        await context.addInitScript(() => {
            if (localStorage.getItem('pc-taskbar-v1-guest')) { return; }
            const view = 'pudl-menu-0076006900650077';
            const pins = ['app-files', 'app-editor', 'app-terminal', 'article-coincidences', 'window-one-word-or-two', view, 'compact-unavailable'];
            localStorage.setItem('pc-taskbar-v1-guest', JSON.stringify({ version: 2, pins, order: pins.map(id => 'pin:' + id),
                references: pins.map(id => ({ id, provider: id === view ? 'pudl-site-menus' : id === 'compact-unavailable' ? 'absent-provider' : 'content' })) }));
        });
        const page = await context.newPage(), errors = [], measurements = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + '/?open=coincidences,about,power-of-guitar,barcode-flash-cards&top=coincidences&launcher=collapsed', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.pcTaskbarPins?.ready);
        assert.equal(await page.evaluate(() => pcTaskbarPins.candidate), fingerprint);
        await page.evaluate(() => pudlWindows.refreshTaskbarDestinations());
        const activePin = page.locator('[data-win-dock] [data-win-tab="coincidences"]');
        const original = await activePin.elementHandle();
        const preferences = await page.evaluate(() => pudlWindows.taskbarState());
        const settle = () => page.waitForFunction(() => [...document.querySelectorAll('.win-bar .win-tab,.win-bar .icon-btn')].filter(n => !n.closest('[data-win-dock]'))
            .every(n => !n.getClientRects().length || (n.getBoundingClientRect().x >= -1 && n.getBoundingClientRect().right <= innerWidth + 1)));
        const currentInView = () => page.waitForFunction(() => {
            const dock = document.querySelector('[data-win-dock]'), current = dock.querySelector('[aria-current="true"]');
            if (!current) return false;
            const d = dock.getBoundingClientRect(), c = current.getBoundingClientRect();
            return c.width > 0 && c.left >= d.left - 1 && c.right <= d.right + 1;
        });
        for (const theme of ['light', 'dark']) {
            await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
            for (const width of [480, 390, 320, 1440]) {
                await page.setViewportSize({ width, height: 950 }); await settle(); await currentInView();
                const value = await page.locator('.win-bar').evaluate(bar => {
                    const controls = [...bar.querySelectorAll('.win-tab,.icon-btn')].filter(n => n.getClientRects().length);
                    return { width: innerWidth, heading: !!bar.querySelector('.win-pins-more:not([hidden])'),
                        controls: controls.map(n => ({ name: n.getAttribute('aria-label') || n.textContent.trim(),
                            x: n.getBoundingClientRect().x, right: n.getBoundingClientRect().right, height: n.getBoundingClientRect().height,
                            folded: n.hasAttribute('data-win-tab-glyph') })) };
                });
                measurements.push({ theme, ...value });
                fs.writeFileSync(path.join(output, 'compact-geometry-' + engine + '.json'), JSON.stringify(measurements, null, 2));
                assert.equal(await original.evaluate(n => n === document.querySelector('[data-win-dock] [data-win-tab="coincidences"]')), true);
                assert.equal(await activePin.isVisible(), true);
                assert.equal(await activePin.getAttribute('data-win-pin'), 'article-coincidences');
                assert.equal(await page.locator('[data-win-dock] [data-win-tab="coincidences"]').count(), 1);
                assert(Math.max(...value.controls.map(c => c.height)) - Math.min(...value.controls.map(c => c.height)) <= 1);
                if (width <= 650) {
                    const launcher = await page.locator('#taskbar-launcher').boundingBox();
                    assert(launcher.x >= 0 && launcher.x <= 16);
                    assert.equal(value.controls[0].name, 'Open launcher');
                } else { assert.equal(await page.locator('#taskbar-launcher').isVisible(), false); }
                if (width <= 480) {
                    await page.locator('.win-bar-windows:visible').waitFor();
                    await page.locator('.win-pins-more:visible').waitFor();
                    assert.equal(await page.locator('.win-bar [data-win-back]:visible,.win-bar [data-win-restore]:visible,.win-bar [data-win-close-all]:visible').count(), 0);
                }
                assert.deepEqual(await page.evaluate(() => pudlWindows.taskbarState()), preferences);
                if (width === 390 || width === 1440) { await page.screenshot({ path: path.join(output, 'compact-' + width + '-' + theme + '-' + engine + '.png') }); }
            }
        }
        console.log('PASS 320/390/480 and desktop restoration in both themes, unchanged active pin identity/preferences and common heights (' + engine + ')');

        await page.setViewportSize({ width: 390, height: 950 }); await settle();
        const windowsButton = page.locator('.win-bar-windows:visible');
        const pinsButton = page.locator('.win-pins-more:visible');
        const windowsMenu = () => page.getByRole('menu', { name: 'Windows', exact: true });
        const pinsMenu = () => page.getByRole('menu', { name: 'Pinned', exact: true });
        await windowsButton.click();
        const labels = await windowsMenu().locator(':scope > .menu-action').allTextContents();
        assert.deepEqual(labels.map(t => t.trim()), ['Arrange taskbar', 'Minimize all', 'Close all windows']);
        assert.equal(await windowsMenu().locator('[data-win-tab],[data-win-pin],a').count(), 0);
        const close = windowsMenu().getByRole('menuitem', { name: 'Close all windows', exact: true });
        assert.equal(await close.evaluate(n => n.previousElementSibling?.getAttribute('role') === 'separator' || n.previousElementSibling?.tagName === 'HR'), true);
        await page.keyboard.press('Escape');
        await page.evaluate(() => pudlWindows.raise('power-of-guitar'));
        await currentInView();
        const ordinary = page.locator('[data-win-dock] [data-win-tab="power-of-guitar"]');
        assert.equal(await ordinary.evaluate(n => n.tagName), 'A', 'Window navigation retains anchors');
        await ordinary.click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Pin to taskbar', exact: true }).click();
        assert((await page.evaluate(() => pudlWindows.taskbarState().pins)).includes('window-power-of-guitar'));
        await page.evaluate(() => pudlWindows.raise('power-of-guitar'));
        assert.equal(await page.locator('[data-win-dock] [data-win-tab="power-of-guitar"]').count(), 1);
        await page.locator('[data-win-dock] [data-win-tab="power-of-guitar"]').waitFor({ state: 'visible' });
        await page.locator('[data-win-dock] [data-win-tab="power-of-guitar"]').click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Unpin from taskbar', exact: true }).click();
        assert.equal(await page.locator('[data-win-dock] [data-win-tab="power-of-guitar"]').getAttribute('data-win-pin'), null);
        await page.locator('[data-win-dock] [data-win-tab="power-of-guitar"]').waitFor({ state: 'visible' });
        await page.screenshot({ path: path.join(output, 'compact-active-ordinary-' + engine + '.png') });
        console.log('PASS actions-only Windows rows/separator and direct ordinary taskbar anchor/context Pin/Unpin without duplicate buttons');

        await pinsButton.click();
        const unavailable = pinsMenu().getByRole('menuitem', { name: /^Unavailable destination/ });
        await unavailable.click({ button: 'right', force: true });
        await page.getByRole('menuitem', { name: 'Unpin from taskbar', exact: true }).click();
        assert(!(await page.evaluate(() => pudlWindows.taskbarState().pins)).includes('compact-unavailable'));
        await pinsButton.click();
        await pinsMenu().getByRole('menuitem', { name: 'View, pinned menu', exact: true }).click();
        await page.getByRole('menu', { name: 'View', exact: true }).waitFor();
        assert.equal(await page.locator('#menubar-panel').getAttribute('data-menu-anchor'), await pinsButton.getAttribute('id'));
        await page.keyboard.press('Escape');
        assert.equal(await pinsButton.evaluate(n => n === document.activeElement), true);
        await pinsButton.click();
        await pinsMenu().getByRole('menuitem', { name: /^One Word Or Two\?/i }).locator('img').waitFor({ state: 'visible' });
        await page.screenshot({ path: path.join(output, 'compact-pins-popup-' + engine + '.png') });
        await page.keyboard.press('Escape');
        await page.route('**/api/taskbar/destinations/window-one-word-or-two', async route => {
            const response = await route.fetch({ headers: { ...route.request().headers(), 'accept-encoding': 'identity' } });
            const destination = await response.json(); destination.icon = '/compact-picture-missing.png';
            await route.fulfill({ response, json: destination });
        });
        await page.route('**/compact-picture-missing.png', route => route.fulfill({ status: 404, body: 'Unavailable' }));
        await page.evaluate(() => pudlWindows.refreshTaskbarDestinations({ ids: ['window-one-word-or-two'] }));
        await pinsButton.click();
        await pinsMenu().getByRole('menuitem', { name: /^One Word Or Two\?/i }).locator('.win-item-glyph:not([hidden])').waitFor();
        await page.keyboard.press('Escape');
        console.log('PASS unavailable Unpin, menu-pin anchoring/focus and article picture/broken fallback in pin navigation');

        await windowsButton.click();
        const beforeArrange = await page.evaluate(() => pudlWindows.taskbarState());
        await windowsMenu().getByRole('menuitem', { name: 'Arrange taskbar', exact: true }).click();
        const arrangement = page.getByRole('dialog', { name: 'Arrange taskbar', exact: true });
        await arrangement.waitFor();
        assert.equal(await arrangement.getAttribute('data-menu-anchor'), await windowsButton.getAttribute('id'));
        await arrangement.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.deepEqual(await page.evaluate(() => pudlWindows.taskbarState()), beforeArrange);
        await windowsButton.click();
        await windowsMenu().getByRole('menuitem', { name: 'Minimize all', exact: true }).click();
        await page.waitForFunction(() => pudlWindows.state().open.every(k => !!pudlWindows.state().min[k]));
        await windowsButton.click();
        assert.deepEqual((await windowsMenu().locator(':scope > .menu-action').allTextContents()).map(t => t.trim()), ['Arrange taskbar', 'Restore all', 'Close all windows']);
        await windowsMenu().getByRole('menuitem', { name: 'Restore all', exact: true }).click();
        await page.waitForFunction(() => pudlWindows.state().open.some(k => !pudlWindows.state().min[k]));
        console.log('PASS Windows-anchored Arrange cancellation and Minimize/Restore all');

        await page.evaluate(async () => { const result = await pudlWindows.open('terminal'); await pudlApplets.start(result.key); });
        await pinsButton.click();
        await pinsMenu().getByRole('menuitem', { name: /^Terminal,/ }).click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'New window', exact: true }).click();
        await page.locator('.win[data-win="terminal-2"]').waitFor();
        await page.waitForFunction(() => document.querySelector('[data-win-pin="app-terminal"]').getAttribute('aria-busy') !== 'true');
        await page.evaluate(() => pudlWindows.raise('terminal'));
        await page.locator('[data-win-dock] [data-win-pin="app-terminal"]').click();
        await page.locator('.win-stack-panel').waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        console.log('PASS applet pin source commands and canonical multi-instance stack');
        await pinsButton.click();
        await pinsMenu().getByRole('menuitem', { name: /^Files,/ }).click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Unpin from taskbar', exact: true }).click();
        assert(!(await page.evaluate(() => pudlWindows.taskbarState().pins)).includes('app-files'));
        await page.evaluate(() => pudlLauncher.present(document.getElementById('site-launcher'), 'popup', { focus: 'browse' }));
        await page.locator('[data-start-item]:has(a[data-win-open="files"])').click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Pin to taskbar', exact: true }).click();
        assert((await page.evaluate(() => pudlWindows.taskbarState().pins)).includes('app-files'));
        await page.evaluate(() => pudlLauncher.close(document.getElementById('site-launcher')));
        await pinsButton.click();
        await pinsMenu().getByRole('menuitem', { name: 'View, pinned menu', exact: true }).click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Unpin from taskbar', exact: true }).click();
        assert(!(await page.evaluate(() => pudlWindows.taskbarState().pins)).includes('pudl-menu-0076006900650077'));
        console.log('PASS applet source-row Unpin/Pin and menu-pin popup Unpin');

        const articleKeys = await page.locator('[data-start-item][data-start-category="articles"] a[data-win-open]').evaluateAll(rows => rows.map(n => n.getAttribute('data-win-open')).slice(0, 12));
        assert(articleKeys.length >= 10, 'The host supplies enough real articles to exercise scrolling');
        await page.evaluate(async keys => { for (const key of keys) { const result = await pudlWindows.open(key); if (!['opened', 'existing'].includes(result.status)) throw new Error('Article opening failed: ' + key); } }, articleKeys);
        await page.setViewportSize({ width: 320, height: 950 });
        await page.waitForFunction(() => document.querySelector('.win-bar').hasAttribute('data-win-taskbar-scroll'));
        await currentInView();
        const scrollState = await page.locator('[data-win-dock]').evaluate(dock => ({ width: dock.clientWidth, content: dock.scrollWidth, left: dock.scrollLeft,
            ordinary: [...dock.querySelectorAll('.win-tab:not([data-win-pin])')].map(n => ({ key: n.dataset.winTab, glyph: n.hasAttribute('data-win-tab-glyph'), hidden: n.hasAttribute('data-win-tab-over') })) }));
        assert(scrollState.content > scrollState.width + 1);
        assert(scrollState.ordinary.length >= 10);
        assert(scrollState.ordinary.every(n => n.glyph && !n.hidden));
        await page.evaluate(key => pudlWindows.raise(key), articleKeys[0]); await currentInView();
        const firstScroll = await page.locator('[data-win-dock]').evaluate(n => n.scrollLeft);
        await page.evaluate(key => pudlWindows.raise(key), articleKeys.at(-1)); await currentInView();
        const lastScroll = await page.locator('[data-win-dock]').evaluate(n => n.scrollLeft);
        assert(Math.abs(lastScroll - firstScroll) > 1, 'Activation scrolls to distant current entries');
        await windowsButton.click();
        assert.deepEqual((await windowsMenu().locator(':scope > .menu-action').allTextContents()).map(t => t.trim()), ['Arrange taskbar', 'Minimize all', 'Close all windows']);
        assert.equal(await windowsMenu().locator('[data-win-tab],[data-win-pin],a').count(), 0);
        await page.screenshot({ path: path.join(output, 'compact-actions-scrolling-' + engine + '.png') });
        await page.keyboard.press('Escape');
        fs.writeFileSync(path.join(output, 'compact-scroll-' + engine + '.json'), JSON.stringify({ ...scrollState, firstScroll, lastScroll }, null, 2));
        await page.setViewportSize({ width: 1440, height: 950 }); await currentInView();
        await page.waitForFunction(() => !document.querySelector('.win-bar').hasAttribute('data-win-taskbar-scroll'));
        assert(await page.locator('[data-win-dock] .win-tab:not([data-win-tab-glyph])').count() > 0);
        console.log('PASS ordinary glyph buttons remain in scrollable dock, activation reveals current entry, actions-only popup stays exact, widening restores labels');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
