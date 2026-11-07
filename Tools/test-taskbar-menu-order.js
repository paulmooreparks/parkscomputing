/* A running window's taskbar commands retain their order when it is pinned. */
const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_SITE || 'https://beta.parkscomputing.com';
(async () => {
    const engine = process.env.PINS_ENGINE || 'firefox';
    const executablePath = engine === 'chromium' ? process.env.CHROMIUM_PATH : process.env.PINS_BROWSER_PATH;
    const browser = await ({ chromium, firefox, webkit })[engine].launch(executablePath ? { executablePath } : {});
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        page.setDefaultTimeout(15000);
        await page.goto(base + '/?open=windragsens&launcher=collapsed', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.pcTaskbarPins?.ready);
        await page.evaluate(() => pudlWindows.refreshTaskbarDestinations());
        const menu = () => page.locator('.context-menu:popover-open');
        const labels = () => menu().evaluate(node => Array.from(node.children)
            .map(child => child.matches('hr') ? '|' : child.querySelector('.menubar-words')?.textContent.trim()).filter(Boolean));
        await page.locator('.win-bar [data-win-tab="windragsens"]').click({ button: 'right' });
        const unpinned = (await labels()).map(label => label.trim());
        await page.getByRole('menuitem', { name: 'Pin to taskbar', exact: true }).click();
        const pin = page.locator('.win-bar [data-win-pin="window-windragsens"]');
        await pin.waitFor();
        await pin.click({ button: 'right' });
        const pinned = (await labels()).map(label => label.trim());
        console.log(JSON.stringify({ engine, unpinned, pinned }, null, 2));
        assert.deepEqual(pinned.map(label => label === 'Unpin from taskbar' ? 'Pin to taskbar' : label), unpinned);
        assert.equal(pinned[0], 'Taskbar order');
        assert.equal(pinned.at(-1), 'Close');
        await page.evaluate(() => pudlWindows.minimize('windragsens'));
        await page.getByRole('menuitem', { name: 'Restore', exact: true }).waitFor();
        assert.equal((await labels())[0], 'Taskbar order');
        assert.equal((await labels()).at(-1), 'Close');
        await page.getByRole('menuitem', { name: 'Unpin from taskbar', exact: true }).click();
        await page.locator('.win-bar [data-win-tab="windragsens"]').click({ button: 'right' });
        await page.evaluate(() => pudlWindows.raise('windragsens'));
        await page.getByRole('menuitem', { name: 'Minimize', exact: true }).waitFor();
        assert.deepEqual(await labels(), unpinned, 'Ordinary live refresh retains command order and separators');
        await page.keyboard.press('Escape');
        await page.evaluate(() => { pudlWindows.pinTaskbar('window-windragsens', true); pudlWindows.close('windragsens'); });
        await pin.click({ button: 'right' });
        const dormant = await labels();
        assert.equal(dormant[0], 'Taskbar order');
        assert(dormant.indexOf('Unpin from taskbar') < dormant.indexOf('Open'));
        await page.evaluate(() => pudlWindows.refreshTaskbarDestinations({ ids: ['window-windragsens'] }));
        // Provider revalidation may replace the link while availability is pending.
        if (!await menu().count()) { await pin.click({ button: 'right' }); }
        assert.deepEqual(await labels(), dormant, 'Dormant revalidation retains command groups');
        await page.keyboard.press('Escape');
        console.log('PASS WinDragSens order/separators, ordinary/pinned live updates and dormant revalidation (' + engine + ')');

        await page.goto(base + '/?open=terminal,terminal-2&launcher=collapsed', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!window.pcTaskbarPins?.ready);
        await page.evaluate(async () => {
            // Exercise optional ordinary stacks with real host application windows.
            for (const key of ['terminal', 'terminal-2']) {
                const win = document.querySelector('[data-win="' + key + '"]');
                win.setAttribute('data-win-group', 'menu-order-terminals');
                win.setAttribute('data-win-group-label', 'Terminals');
            }
            document.querySelector('[data-win-layer]').setAttribute('data-win-taskbar-stacks', 'always');
            await pudlWindows.refreshTaskbarDestinations();
        });
        await page.locator('.win-bar [data-win-stack="menu-order-terminals"]').click({ button: 'right' });
        const ordinaryStack = await labels();
        assert.equal(ordinaryStack[0], 'Taskbar order');
        assert(ordinaryStack.at(-1).startsWith('Close these'));
        await page.evaluate(() => pudlWindows.minimize('terminal-2'));
        assert.deepEqual(await labels(), ordinaryStack, 'Ordinary stack live refresh retains groups');
        await page.keyboard.press('Escape');
        await page.evaluate(() => pudlWindows.pinTaskbar('app-terminal', true));
        await page.locator('.win-bar [data-win-pin="app-terminal"]').click({ button: 'right' });
        const pinnedStack = await labels();
        assert.equal(pinnedStack[0], 'Taskbar order');
        assert(pinnedStack.at(-1).startsWith('Close these'));
        const common = list => list.filter(label => !['New window', 'Pin to taskbar', 'Unpin from taskbar'].includes(label));
        assert.deepEqual(common(pinnedStack), common(ordinaryStack), 'Stack membership preserves common commands and separators');
        await page.evaluate(() => pudlWindows.minimize('terminal'));
        assert.deepEqual(await labels(), pinnedStack, 'Pinned stack live refresh retains groups');
        if (process.env.PINS_SHOTS) { await page.screenshot({ path: process.env.PINS_SHOTS + '/stack-menu-' + engine + '.png' }); }
        console.log('PASS ordinary/pinned stack order and live refresh (' + engine + ')');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
