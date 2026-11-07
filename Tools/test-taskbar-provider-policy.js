/* Real-host permission, opt-out, unavailable-reference and native-link checks. */
const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_SITE || 'https://beta.parkscomputing.com';
(async () => {
    const engine = process.env.PINS_ENGINE || 'firefox';
    const executablePath = engine === 'chromium' ? process.env.CHROMIUM_PATH : process.env.PINS_BROWSER_PATH;
    const browser = await ({ chromium, firefox, webkit })[engine].launch(executablePath ? { executablePath } : {});
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        context.setDefaultTimeout(15000);
        context.setDefaultNavigationTimeout(15000);
        await context.addInitScript(() => {
            if (!localStorage.getItem('pc-taskbar-v1-guest')) {
                localStorage.setItem('pc-taskbar-v1-guest', JSON.stringify({ version: 2,
                    pins: ['window-missing-article'], order: ['pin:window-missing-article'],
                    references: [{ id: 'window-missing-article', provider: 'content' }] }));
            }
        });
        const page = await context.newPage();
        await page.goto(base + '/?open=one-word-or-two,conway&launcher=collapsed', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.pcTaskbarPins?.ready);
        assert.deepEqual(await page.evaluate(async () => {
            const statuses = [];
            for (const [id, scope] of [['window-one-word-or-two', 'guest'], ['account', 'guest'], ['window-logs', 'guest'], ['window-one-word-or-two', 'another-account']]) {
                statuses.push((await fetch('/api/taskbar/destinations/' + id, { headers: { Accept: 'application/json', 'X-Taskbar-Scope': scope } })).status);
            }
            return statuses;
        }), [200, 403, 403, 409]);
        const missing = page.locator('[data-win-pin="window-missing-article"]');
        await missing.waitFor();
        assert.equal(await missing.getAttribute('aria-disabled'), 'true');
        await missing.click({ button: 'right', force: true });
        await page.getByRole('menuitem', { name: 'Unpin from taskbar', exact: true }).click();
        await missing.waitFor({ state: 'detached' });
        await page.evaluate(() => pudlWindows.refreshTaskbarDestinations());
        const article = page.locator('[data-win="one-word-or-two"]');
        await article.evaluate(win => win.setAttribute('data-win-pinnable', 'false'));
        await page.locator('.win-bar [data-win-tab="one-word-or-two"]').click({ button: 'right' });
        assert.equal(await page.getByRole('menuitem', { name: 'Pin to taskbar', exact: true }).count(), 0);
        await page.keyboard.press('Escape');
        await article.evaluate(win => win.removeAttribute('data-win-pinnable'));
        await page.evaluate(() => pudlWindows.refreshTaskbarDestinations());
        await page.locator('.win-bar [data-win-tab="conway"]').click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Pin to taskbar', exact: true }).click();
        await page.locator('[data-win-pin="window-conway"] img').waitFor();
        await page.evaluate(() => pudlWindows.close('conway'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.pcTaskbarPins?.ready);
        await page.locator('[data-win-pin="window-conway"] img').waitFor();
        assert.equal(await page.locator('[data-win-pin="window-missing-article"]').count(), 0);
        console.log('PASS guest permissions, account-scope denial, explicit root exclusion, unavailable Unpin and generic applet dormant restoration (' + engine + ')');
        await page.evaluate(() => pudlWindows.refreshTaskbarDestinations());
        await page.locator('.win-bar [data-win-tab="one-word-or-two"]').click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Pin to taskbar', exact: true }).click();
        await page.evaluate(() => pudlWindows.close('one-word-or-two'));
        const pin = page.locator('[data-win-pin="window-one-word-or-two"]');
        await page.route('**/api/taskbar/destinations/window-one-word-or-two', async route => {
            const response = await route.fetch({ headers: { ...route.request().headers(), 'accept-encoding': 'identity' } });
            const destination = await response.json();
            destination.icon = '/taskbar-test-missing-picture.png';
            await route.fulfill({ response, json: destination });
        });
        await page.evaluate(() => pudlWindows.refreshTaskbarDestinations({ ids: ['window-one-word-or-two'] }));
        await pin.locator('.win-item-glyph').waitFor({ state: 'visible' });
        await page.waitForFunction(() => {
            const picture = document.querySelector('[data-win-pin="window-one-word-or-two"] img');
            return !picture || (picture.complete && picture.naturalWidth === 0);
        });
        await page.unroute('**/api/taskbar/destinations/window-one-word-or-two');
        await page.evaluate(() => pudlWindows.refreshTaskbarDestinations({ ids: ['window-one-word-or-two'] }));
        await pin.locator('img').waitFor({ state: 'visible' });
        console.log('PASS injected broken destination picture falls back to its glyph and a refreshed valid picture recovers');
        if (process.env.PINS_SKIP_NATIVE === '1') {
            console.log('SKIP native modified-link probe; navigation is verified separately');
            await context.close();
            return;
        }
        const newPage = context.waitForEvent('page', { timeout: 10000 }).catch(() => null);
        await pin.click({ modifiers: ['Control'], noWaitAfter: true });
        const opened = await newPage;
        if (!opened) {
            console.log('Native-link diagnostic', JSON.stringify({ source: page.url(), pin: await pin.evaluate(el => el.outerHTML), pages: context.pages().map(p => p.url()) }));
            throw new Error('Modified dormant link did not create another tab within 10 seconds');
        }
        await opened.waitForURL(url => url.pathname === '/page/one-word-or-two', { waitUntil: 'commit', timeout: 15000 });
        assert.equal(new URL(page.url()).pathname, '/');
        await opened.close();
        console.log('PASS modified dormant article link opens its canonical page in another tab (' + engine + ')');
        await context.close();
    } catch (error) {
        console.error('Provider policy failure (' + engine + ')', error);
        throw error;
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
