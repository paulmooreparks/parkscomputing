/* Retained launcher controls must track later popup and pane presentation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_SITE || 'https://beta.parkscomputing.com';

(async () => {
    const engine = process.env.PINS_ENGINE || 'firefox';
    const executablePath = engine === 'chromium' ? process.env.CHROMIUM_PATH : process.env.PINS_BROWSER_PATH;
    const browser = await ({ chromium, firefox, webkit })[engine].launch({ executablePath });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 950 } }), errors = [], observations = [];
        let phase = 'initial title routes';
        page.on('pageerror', e => { errors.push(e.message); console.error('BROWSER ERROR during ' + phase + ': ' + e.stack); });
        if (process.env.PINS_RESIZE_TRACE) await page.addInitScript(() => {
            const NativeObserver = window.ResizeObserver;
            window.resizeTrace = [];
            window.ResizeObserver = class extends NativeObserver {
                constructor(callback) {
                    const origin = new Error().stack;
                    super((entries, observer) => {
                        resizeTrace.push({ time: performance.now(), origin, targets: entries.map(e => ({ id: e.target.id, classes: e.target.className, width: e.contentRect.width, height: e.contentRect.height })) });
                        if (resizeTrace.length > 80) resizeTrace.shift();
                        callback(entries, observer);
                    });
                }
            };
            window.addEventListener('error', e => { if (e.message.includes('ResizeObserver')) window.resizeErrorTrace = resizeTrace.slice(); });
        });
        const response = await page.goto(base + '/?launcher=closed', { waitUntil: 'domcontentloaded' });
        const authored = (await response.text()).match(/<section\b[^>]*\bid="site-launcher"[^>]*>/i)?.[0];
        assert(authored && !/\spopover(?:\s|=|>)/.test(authored), 'The real host initially embeds the catalog without popover markup');
        await page.waitForFunction(() => window.pcTaskbarPins?.ready && window.pcLauncher);
        const root = page.locator('#site-launcher'), primary = page.locator('#taskbar-launcher');
        const titleId = await page.evaluate(() => pudlMenubar.launcherButton().id);
        const title = page.locator('#' + titleId);
        const glyph = page.locator('.menubar-menu:first-child > .menubar-glyph');
        const mode = presentation => page.waitForFunction(presentation => pudlLauncher.state(document.getElementById('site-launcher')).presentation === presentation, presentation);
        async function synchronized(presentation) {
            await mode(presentation);
            const visible = ['popup', 'pane'].includes(presentation);
            const popup = ['popup', 'closed'].includes(presentation);
            await page.waitForFunction(({ id, visible, popup }) => {
                const controls = [document.getElementById('taskbar-launcher'), document.getElementById(id), document.querySelector('.menubar-menu:first-child > .menubar-glyph')];
                return controls.every(n => n && n.getAttribute('aria-expanded') === String(visible)
                    && (popup ? n.getAttribute('popovertarget') === 'site-launcher' : !n.hasAttribute('popovertarget')));
            }, { id: titleId, visible, popup });
            observations.push({ presentation, controls: await page.evaluate(id => [document.getElementById('taskbar-launcher'), document.getElementById(id), document.querySelector('.menubar-menu:first-child > .menubar-glyph')]
                .map(n => ({ id: n.id, target: n.getAttribute('popovertarget'), expanded: n.getAttribute('aria-expanded'), popup: n.getAttribute('aria-haspopup') })), titleId) });
        }
        await synchronized('closed');
        await title.click(); await synchronized('popup');
        await page.waitForFunction(() => document.activeElement.hasAttribute('data-start-query'));
        await title.click(); await synchronized('closed');
        await primary.click(); await synchronized('popup');
        await primary.click(); await synchronized('closed');
        await title.focus(); await page.keyboard.press('Enter'); await synchronized('popup');
        await page.keyboard.press('Escape'); await synchronized('closed');
        assert.equal(await page.evaluate(() => !!document.activeElement.getClientRects().length), true);
        await glyph.click(); await synchronized('popup');
        await glyph.click(); await synchronized('closed');
        console.log('PASS initially embedded markup, exact initial title route, both native toggles, Enter and companion glyph (' + engine + ')');

        phase = 'pane transitions';
        await page.evaluate(() => pudlLauncher.present(document.getElementById('site-launcher'), 'pane', { focus: false }));
        await synchronized('pane');
        await title.click(); await synchronized('collapsed');
        await title.click(); await synchronized('pane');
        await primary.click(); await synchronized('collapsed');
        await primary.click(); await synchronized('pane');
        await root.locator('[data-launcher-pin]').click(); await synchronized('closed');
        await title.click(); await synchronized('popup');
        await root.locator('[data-launcher-pin]').click(); await synchronized('pane');
        await root.locator('[data-launcher-pin]').click(); await synchronized('popup');
        await root.locator('[data-launcher-pin]').click(); await synchronized('pane');
        await root.locator('[data-launcher-close]').click(); await synchronized('collapsed');
        await glyph.click(); await synchronized('pane');
        await page.evaluate(() => pudlLauncher.present(document.getElementById('site-launcher'), 'closed', { focus: false }));
        await synchronized('closed');
        console.log('PASS pane/collapsed/popup transitions synchronize primary, title and companion expanded/target state (' + engine + ')');

        phase = 'resize and collapsed routes';
        await page.setViewportSize({ width: 320, height: 850 });
        const collapsed = page.locator('.menubar-one .menubar-title');
        await collapsed.waitFor({ state: 'visible' });
        await collapsed.click();
        await page.getByRole('menuitem', { name: 'Open launcher', exact: true }).click();
        await mode('popup');
        await page.waitForFunction(() => document.activeElement.hasAttribute('data-start-query'));
        await page.keyboard.press('Escape'); await mode('closed');
        await primary.focus(); await page.keyboard.press('ArrowDown'); await mode('popup');
        await page.waitForFunction(() => document.activeElement.hasAttribute('data-start-query'));
        await page.screenshot({ path: path.join(process.env.PINS_SHOTS, 'routes-collapsed-' + engine + '.png') });
        fs.writeFileSync(path.join(process.env.PINS_SHOTS, 'route-states-' + engine + '.json'), JSON.stringify(observations, null, 2));
        console.log('PASS collapsed menubar Open launcher and permanent-opener ArrowDown route (' + engine + ')');

        if (engine !== 'firefox') {
            const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 950 } });
            const touch = await context.newPage();
            await touch.goto(base + '/?launcher=closed', { waitUntil: 'domcontentloaded' });
            await touch.waitForFunction(() => window.pcTaskbarPins?.ready && window.pcLauncher);
            await touch.evaluate(() => {
                window.queryFocus = [];
                document.addEventListener('focusin', e => { if (e.target.matches('[data-start-query]')) queryFocus.push('query'); });
            });
            const id = await touch.evaluate(() => pudlMenubar.launcherButton().id);
            await touch.locator('#' + id).tap();
            await touch.waitForFunction(() => document.activeElement.id === 'site-launcher');
            assert.deepEqual(await touch.evaluate(() => queryFocus), []);
            await touch.locator('#' + id).tap();
            await touch.waitForFunction(() => pudlLauncher.state(document.getElementById('site-launcher')).presentation === 'closed');
            await touch.locator('.menubar-menu:first-child > .menubar-glyph').tap();
            await touch.waitForFunction(() => document.activeElement.id === 'site-launcher');
            assert.deepEqual(await touch.evaluate(() => queryFocus), []);
            await touch.screenshot({ path: path.join(process.env.PINS_SHOTS, 'routes-touch-title-' + engine + '.png') });
            await context.close();
            console.log('PASS touch title and companion open for browsing without transient filter focus (' + engine + ')');
        }
        if (process.env.PINS_RESIZE_TRACE) fs.writeFileSync(path.join(process.env.PINS_SHOTS, 'resize-trace-' + engine + '.json'), JSON.stringify(await page.evaluate(() => ({ atError: window.resizeErrorTrace, recent: window.resizeTrace })), null, 2));
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
