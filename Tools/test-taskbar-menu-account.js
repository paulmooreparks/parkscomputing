/* Signed-in beta persistence uses a disposable test-account sign-in link. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_SITE || 'https://beta.parkscomputing.com';

(async () => {
    assert(process.env.PC_SIGNIN_LINK, 'A beta test-account sign-in link is required');
    assert.equal(new URL(process.env.PC_SIGNIN_LINK).origin, new URL(base).origin);
    assert.equal(new URL(base).hostname, 'beta.parkscomputing.com');
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
    let page, original;
    async function restore() {
        if (!original) { return; }
        const status = await page.evaluate(async record => (await fetch('/api/account/taskbar', {
            method: 'PUT', headers: { Accept: 'application/json', 'Content-Type': 'application/json',
                RequestVerificationToken: document.querySelector('meta[name="request-verification-token"]').content },
            body: JSON.stringify({ scope: record.scope, preferences: record.preferences })
        })).status, original);
        assert.equal(status, 200, 'Original account preferences are restored');
    }
    try {
        page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const confirmation = await page.goto(process.env.PC_SIGNIN_LINK, { waitUntil: 'domcontentloaded' });
        assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).count(), 1,
            'Sign-in confirmation ' + confirmation.status() + ': ' + (await page.locator('h1').allTextContents()).join(' '));
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await page.waitForURL(u => u.pathname !== '/account/link');
        await page.goto(base + '/?open=about&launcher=pane', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.pcTaskbarPins?.ready);
        assert.notEqual(await page.evaluate(() => pcTaskbarPins.scope), 'guest');
        original = await page.evaluate(async () => (await fetch('/api/account/taskbar', { headers: { Accept: 'application/json' } })).json());
        const menus = await page.evaluate(() => pudlMenubar.siteMenus());
        for (const menu of menus) {
            const id = await page.evaluate(id => pudlMenubar.siteMenuDestinationId(id), menu.id);
            if ((await page.evaluate(() => pudlWindows.taskbarState().pins)).includes(id)) { continue; }
            await page.locator('.menubar-title[data-menu-id="' + menu.id + '"]').click({ button: 'right' });
            await page.getByRole('menuitem', { name: 'Pin to taskbar', exact: true }).click();
            await page.locator('.win-bar [data-win-menu-id="' + menu.id + '"]').waitFor();
        }
        const row = page.locator('[data-start-item]:has(a[data-win-open="one-word-or-two"])');
        await row.click({ button: 'right' });
        const action = page.getByRole('menuitem', { name: /^(Pin to taskbar|Unpin from taskbar)$/ });
        if (await action.innerText() === 'Pin to taskbar') { await action.click(); }
        else { await page.keyboard.press('Escape'); }
        const expected = await page.evaluate(() => pudlWindows.taskbarState());
        await page.waitForFunction(async expected => {
            const record = await (await fetch('/api/account/taskbar', { headers: { Accept: 'application/json' } })).json();
            return JSON.stringify(record.preferences.pins) === JSON.stringify(expected.pins)
                && JSON.stringify(record.preferences.references) === JSON.stringify(expected.references);
        }, expected);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.pcTaskbarPins?.ready);
        for (const menu of menus) { await page.locator('.win-bar [data-win-menu-id="' + menu.id + '"]').waitFor(); }
        const picture = page.locator('[data-win-pin="window-one-word-or-two"] img');
        await picture.waitFor().catch(async error => {
            const diagnostic = await page.evaluate(() => ({ state: pudlWindows.taskbarState(),
                entry: document.querySelector('[data-win-pin="window-one-word-or-two"]')?.outerHTML }));
            throw new Error(error.message + '\n' + JSON.stringify(diagnostic));
        });
        await page.waitForFunction(() => {
            const image = document.querySelector('[data-win-pin="window-one-word-or-two"] img');
            return image?.complete && image.naturalWidth > 0 && !image.hidden;
        });
        assert.deepEqual(await page.evaluate(() => pudlWindows.taskbarState()), expected);
        const longId = await page.evaluate(() => pudlMenubar.siteMenuDestinationId('unavailable-menu-with-a-long-stable-identity'));
        assert(longId.length > 100);
        const withUnavailable = { version: 2, pins: expected.pins.concat(longId),
            order: expected.order.concat('pin:' + longId),
            references: expected.references.concat({ id: longId, provider: 'pudl-site-menus' }) };
        const saved = await page.evaluate(async preferences => (await fetch('/api/account/taskbar', {
            method: 'PUT', headers: { Accept: 'application/json', 'Content-Type': 'application/json',
                RequestVerificationToken: document.querySelector('meta[name="request-verification-token"]').content },
            body: JSON.stringify({ scope: pcTaskbarPins.scope, preferences })
        })).status, withUnavailable);
        assert.equal(saved, 200, 'Canonical menu IDs are not truncated to the host content-key limit');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.pcTaskbarPins?.ready);
        const missing = page.locator('[data-win-pin="' + longId + '"]');
        await missing.waitFor();
        await page.waitForFunction(id => document.querySelector('[data-win-pin="' + id + '"]').getAttribute('aria-disabled') === 'true', longId);
        const box = await missing.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
        await page.getByRole('menuitem', { name: 'Unpin from taskbar', exact: true }).click();
        await page.waitForFunction(async id => !(await (await fetch('/api/account/taskbar', { headers: { Accept: 'application/json' } })).json()).preferences.pins.includes(id), longId);
        console.log('PASS long canonical site-menu ID survives account storage and unavailable reload, then remains removable');
        const guard = await page.evaluate(async () => (await fetch('/api/account/taskbar', {
            method: 'PUT', headers: { 'Content-Type': 'application/json', RequestVerificationToken: document.querySelector('meta[name="request-verification-token"]').content },
            body: JSON.stringify({ scope: 'another-account', preferences: { version: 2, pins: [], order: [], references: [] } })
        })).status);
        assert.equal(guard, 409);
        const guest = await browser.newPage();
        await guest.goto(base + '/?launcher=collapsed', { waitUntil: 'domcontentloaded' });
        await guest.waitForFunction(() => window.pcTaskbarPins?.ready);
        assert.equal(await guest.evaluate(() => pcTaskbarPins.scope), 'guest');
        assert.equal((await guest.evaluate(() => pudlWindows.taskbarState().pins)).length, 0);
        await guest.close();
        console.log('PASS signed-in site menus (' + menus.map(m => m.id).join(', ') + '), content references, dormant pictures, reload, account-scope rejection and guest isolation');
    } finally {
        try { await restore(); if (original) { console.log('PASS original beta test-account preferences restored'); } }
        finally { await browser.close(); }
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
