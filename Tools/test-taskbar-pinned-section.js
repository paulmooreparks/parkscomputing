/* Real-host acceptance of the shared pinned section and menu destinations. */
const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_SITE || 'https://beta.parkscomputing.com';
const fingerprint = process.env.PINS_CANDIDATE || '1793669234fd1c4ef50bee22a41807b91ff6a11a';

(async () => {
    const engine = process.env.PINS_ENGINE || 'firefox';
    const executablePath = engine === 'chromium' ? process.env.CHROMIUM_PATH : process.env.PINS_BROWSER_PATH;
    const browser = await ({ chromium, firefox, webkit })[engine].launch({ executablePath });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(base + '/?open=about,coincidences&top=about&launcher=collapsed', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.pcTaskbarPins?.ready);
        assert.equal(await page.evaluate(() => pcTaskbarPins.candidate), fingerprint);
        await page.evaluate(() => {
            window.hostActivations = [];
            document.querySelector('[data-win-layer]').addEventListener('pudl:taskbar-activate', e => hostActivations.push(e.detail.id));
        });
        const menus = await page.evaluate(() => pudlMenubar.siteMenus());
        assert(menus.some(m => m.id === 'view'));
        assert(menus.some(m => m.id === 'window'));
        assert(menus.some(m => m.id === 'help'));
        assert(!menus.some(m => m.id === 'site'), 'Launcher identity is not a menu');
        for (const [index, menu] of menus.entries()) {
            const title = page.locator('.menubar-title[data-menu-id="' + menu.id + '"]');
            if (index % 2) { await title.focus(); await page.keyboard.press('Shift+F10'); }
            else { await title.click({ button: 'right' }); }
            await page.getByRole('menuitem', { name: 'Pin to taskbar', exact: true }).click();
            await page.locator('.win-bar [data-win-menu-id="' + menu.id + '"]').waitFor();
        }
        const snapshot = await page.evaluate(() => pudlWindows.taskbarState());
        assert(menus.every(m => snapshot.references.some(r => r.id === 'pudl-menu-' + [...m.id].map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('') && r.provider === 'pudl-site-menus')));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.pcTaskbarPins?.ready);
        for (const menu of menus) { await page.locator('.win-bar [data-win-menu-id="' + menu.id + '"]').waitFor(); }
        assert.deepEqual(await page.evaluate(() => pudlWindows.taskbarState()), snapshot);
        assert.equal(await page.locator('.win-taskbar-heading').count(), 1);
        assert.equal(await page.locator('.win-taskbar-divider').count(), 1);
        const view = page.locator('.win-bar [data-win-menu-id="view"]');
        await view.click();
        await page.getByRole('menu', { name: 'View', exact: true }).waitFor();
        await page.keyboard.press('Escape');
        assert.equal(await view.evaluate(n => n === document.activeElement), true);
        await page.evaluate(() => pudlMenubar.ribbon(true));
        await view.click();
        await page.getByRole('menu', { name: 'View', exact: true }).waitFor();
        await page.keyboard.press('Escape');
        await page.evaluate(() => pudlMenubar.ribbon(false));
        console.log('PASS every real site menu pins by pointer/keyboard, retains built-in references across reload and opens as a focused popup in ribbon mode');

        await page.evaluate(async () => { await pudlWindows.open('terminal'); await pudlApplets.start('terminal'); });
        const front = page.locator('.menubar-front .menubar-title').first();
        await front.waitFor();
        const suppressed = await front.evaluate(n => {
            const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
            n.dispatchEvent(e); return e.defaultPrevented;
        });
        assert.equal(suppressed, true, 'Applet title consumes the context request');
        await front.focus(); await page.keyboard.press('Shift+F10');
        assert.equal(await page.getByRole('menuitem', { name: /^(Pin to taskbar|Unpin from taskbar)$/ }).count(), 0);
        assert.deepEqual(await page.evaluate(() => pudlMenubar.siteMenus()), menus);
        await page.evaluate(() => pudlWindows.close('terminal'));

        const aboutId = await page.locator('.win[data-win="about"]').getAttribute('data-win-destination');
        await page.evaluate(async id => { await pudlWindows.refreshTaskbarDestinations({ ids: [id] }); pudlWindows.pinTaskbar(id, true); }, aboutId);
        const about = page.locator('.win-bar [data-win-pin="' + aboutId + '"]');
        await about.waitFor();
        await page.evaluate(() => pudlWindows.raise('about'));
        await about.click();
        await page.waitForFunction(() => pudlWindows.state().min.about === true);
        await about.click();
        await page.waitForFunction(() => !pudlWindows.state().min.about && pudlWindows.state().top === 'about');
        await page.evaluate(() => pudlWindows.raise('coincidences'));
        await about.click();
        await page.waitForFunction(() => pudlWindows.state().top === 'about' && !pudlWindows.state().min.about);
        console.log('PASS applet title context suppression and foreground singleton minimize/restore/background raise');

        const ordered = await page.evaluate(id => {
            const viewId = pudlMenubar.siteMenuDestinationId('view');
            const before = pudlWindows.taskbarState();
            const cross = pudlWindows.reorderTaskbarEntry('pin:' + id, { after: 'coincidences' });
            const unchanged = JSON.stringify(before) === JSON.stringify(pudlWindows.taskbarState());
            const moved = pudlWindows.reorderTaskbarEntry('pin:' + id, { before: 'pin:' + viewId });
            return { cross, unchanged, moved, state: pudlWindows.taskbarState() };
        }, aboutId);
        assert.equal(ordered.cross, false);
        assert.equal(ordered.unchanged, true);
        assert.equal(ordered.moved, true);
        assert(ordered.state.order.indexOf('pin:' + aboutId) < ordered.state.order.indexOf('pin:' + snapshot.pins[0]));

        const arrange = page.locator('.win-bar-arrange');
        const dialog = page.getByRole('dialog', { name: 'Arrange taskbar', exact: true });
        const beforeDraft = await page.evaluate(() => pudlWindows.taskbarState());
        await arrange.click(); await dialog.waitFor();
        await dialog.locator('select').selectOption('pin:' + aboutId);
        await dialog.getByRole('button', { name: 'Move later', exact: true }).click();
        await arrange.click();
        assert.equal(await page.locator('.win-taskbar-arrangement').count(), 0);
        assert.deepEqual(await page.evaluate(() => pudlWindows.taskbarState()), beforeDraft);
        for (const key of ['Enter', 'Space']) {
            await arrange.focus(); await page.keyboard.press(key); await dialog.waitFor();
            await arrange.focus(); await page.keyboard.press(key);
            assert.equal(await page.locator('.win-taskbar-arrangement').count(), 0);
            assert.equal(await arrange.getAttribute('aria-expanded'), 'false');
        }
        console.log('PASS within-section ordering, cross-section rejection and Arrange pointer/keyboard toggle with draft cancellation');

        for (const width of [800, 480, 320]) {
            await page.setViewportSize({ width, height: 950 });
            await page.waitForFunction(() => document.querySelector('.win-bar').getBoundingClientRect().right <= innerWidth + 1);
            await page.waitForFunction(() => [...document.querySelectorAll('.win-bar *')]
                .every(n => !n.getClientRects().length || n.getBoundingClientRect().right <= innerWidth + 1));
            const dimensions = await page.locator('.win-bar').evaluate(bar => {
                const controls = [...bar.querySelectorAll('.win-tab,.win-bar-arrange,.win-bar-more')].filter(n => n.getClientRects().length);
                return { heights: controls.map(n => n.getBoundingClientRect().height), width: bar.getBoundingClientRect().width,
                    scroll: document.documentElement.scrollWidth, viewport: innerWidth,
                    overflow: [...bar.querySelectorAll('*')].filter(n => n.getClientRects().length && n.getBoundingClientRect().right > innerWidth + 1)
                        .slice(0, 8).map(n => ({ tag: n.tagName, classes: n.className, right: n.getBoundingClientRect().right, window: n.closest('[data-win]')?.getAttribute('data-win') })) };
            });
            assert.equal(dimensions.overflow.length, 0, JSON.stringify(dimensions));
            assert(Math.max(...dimensions.heights) - Math.min(...dimensions.heights) <= 2, JSON.stringify(dimensions));
        }
        await page.screenshot({ path: process.env.PINS_SHOTS + '/pinned-narrow-' + engine + '.png' });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await view.waitFor({ state: 'visible' });
        await page.screenshot({ path: process.env.PINS_SHOTS + '/pinned-wide-' + engine + '.png' });
        assert.deepEqual(await page.evaluate(() => pudlWindows.taskbarState()), beforeDraft);
        console.log('PASS narrow folding, taskbar bounds, common control heights and restored wide layout');

        await page.evaluate(() => {
            document.querySelector('[data-menubar-source] [data-menubar-id="view"]').remove();
            pudlMenubar.refresh();
        });
        const viewId = await page.evaluate(() => pudlMenubar.siteMenuDestinationId('view'));
        await page.waitForFunction(id => document.querySelector('[data-win-pin="' + id + '"]')?.getAttribute('aria-disabled') === 'true', viewId);
        assert((await page.evaluate(() => pudlWindows.taskbarState().pins)).includes(viewId));
        const missing = page.locator('.win-bar [data-win-pin="' + viewId + '"]');
        const box = await missing.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
        await page.getByRole('menuitem', { name: 'Unpin from taskbar', exact: true }).click();
        assert.equal(await missing.count(), 0);
        await page.evaluate(() => pudlWindows.taskbarState().pins.forEach(id => pudlWindows.pinTaskbar(id, false)));
        assert.equal(await page.locator('.win-taskbar-heading,.win-taskbar-divider').count(), 0);
        assert.deepEqual(errors, []);
        console.log('PASS unavailable site-menu membership remains removable and empty pinned section disappears (' + engine + ')');

        const restoredId = await page.evaluate(() => {
            const id = pudlMenubar.siteMenuDestinationId('unavailable-menu-with-a-long-stable-identity');
            localStorage.setItem('pc-taskbar-v1-guest', JSON.stringify({ version: 2, pins: [id], order: ['pin:' + id],
                references: [{ id, provider: 'pudl-site-menus' }] }));
            return id;
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.pcTaskbarPins?.ready);
        await page.locator('.win-bar [data-win-pin="' + restoredId + '"]').waitFor();
        assert((await page.evaluate(() => pudlWindows.taskbarState().references))
            .some(r => r.id === restoredId && r.provider === 'pudl-site-menus'));
        console.log('PASS unavailable long-ID menu pin restores from the complete guest envelope (' + engine + ')');

        if (engine !== 'firefox') {
            const touch = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 850 } });
            const t = await touch.newPage();
            await t.goto(base + '/?open=about&launcher=collapsed', { waitUntil: 'domcontentloaded' });
            await t.waitForFunction(() => window.pcTaskbarPins?.ready);
            const toggle = t.locator('.win-bar-arrange');
            await toggle.tap(); await t.getByRole('dialog', { name: 'Arrange taskbar', exact: true }).waitFor();
            await toggle.tap(); assert.equal(await t.locator('.win-taskbar-arrangement').count(), 0);
            await touch.close();
            console.log('PASS emulated touch Arrange toggle (' + engine + ')');
        }
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
