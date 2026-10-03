/* Integration checks against the running site's PUDL menu contract. */
const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.MENU_SITE || 'http://localhost';

async function check(engine, name) {
    const browser = await engine.launch();
    const context = await browser.newContext({ viewport: { width: 1800, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
        if (m.type() === 'warning' && /menubar/i.test(m.text())) errors.push(m.text());
    });
    const panel = page.locator('#menubar-panel');
    const title = id => page.locator('.menubar-title[data-menu-id="' + id + '"]').first();
    async function open(slug, expected) {
        await page.goto(origin + (slug ? '/?open=' + slug : '/?open='));
        await page.waitForFunction(() => !!document.querySelector('.menubar-row'));
        if (expected) {
            await page.waitForFunction(expected => {
                const labels = [...document.querySelectorAll('.menubar-front .menubar-title')].map(x => x.textContent.trim());
                return JSON.stringify(labels) === JSON.stringify(expected);
            }, expected);
        }
        const ids = await page.locator('.menubar-menu:not(.menubar-front):not(.menubar-one) .menubar-title').evaluateAll(nodes => nodes.map(n => n.dataset.menuId));
        assert.deepEqual(ids, slug ? ['site', 'go', 'applets', 'view', 'window', 'help'] : ['site', 'go', 'applets', 'view', 'help']);
    }
    async function command(menu, label) {
        await title(menu).click();
        await panel.getByRole('menuitem', { name: label, exact: true }).click();
    }
    try {
        await open('');
        const initialUrl = page.url();
        const initialHistory = await page.evaluate(() => history.length);
        await title('site').click();
        assert(await panel.isVisible());
        await title('site').click();
        assert(!(await panel.isVisible()));
        const glyph = page.locator('.menubar-menu').first().locator('button.menubar-glyph');
        await glyph.click();
        assert(await panel.isVisible());
        await glyph.click();
        assert(!(await panel.isVisible()));
        await title('go').click();
        await title('view').hover();
        await title('view').click();
        assert(!(await panel.isVisible()));
        await title('go').focus();
        await page.keyboard.press('ArrowDown');
        assert(await panel.isVisible());
        await page.keyboard.press('Escape');
        assert(!(await panel.isVisible()));
        assert(await title('go').evaluate(el => el === document.activeElement));
        assert.equal(page.url(), initialUrl);
        assert.equal(await page.evaluate(() => history.length), initialHistory);

        const menus = {
            'barcode-scanner': ['Barcode Scanner', 'File', 'Edit', 'Scan'],
            editor: ['Editor', 'File', 'Edit'], terminal: ['Terminal', 'Session'],
            dice: ['Dice', 'Roll', 'Set'], diff: ['Diff Viewer', 'File', 'Compare'],
            'theme-studio': ['Theme Studio', 'File', 'Palette'],
            sudoku: ['Sudoku', 'Edit', 'Game'], conway: ["Conway's Game of Life", 'Simulation'],
            flashcards: ['Barcode Flash Cards', 'Deck'], barcodes: ['Barcode Tool', 'File', 'Layout'],
            about: ['About', 'File']
        };
        for (const [slug, labels] of Object.entries(menus)) await open(slug, labels);

        await open('terminal', menus.terminal);
        const originalKey = await page.locator('.win[data-win]').first().getAttribute('data-win');
        await page.locator('.menubar-front .menubar-title').filter({ hasText: /^Session$/ }).click();
        await panel.getByRole('menuitem', { name: 'New terminal here', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('.win [data-applet="terminal"]').length === 2);
        await page.waitForFunction(key => document.querySelector('.win.active').getAttribute('data-win') !== key, originalKey);
        const secondKey = await page.locator('.win.active').getAttribute('data-win');
        await page.locator('.menubar-front .menubar-title').first().click();
        await page.evaluate(key => pudlWindows.open(key), originalKey);
        await panel.waitFor({ state: 'hidden' });
        await page.locator('.menubar-front .menubar-title').first().click();
        await panel.getByRole('menuitem', { name: 'Close window', exact: true }).click();
        await page.locator('.win[data-win="' + originalKey + '"]').waitFor({ state: 'detached' });
        assert.equal(await page.locator('.win[data-win="' + secondKey + '"]').count(), 1);

        await open('files', ['Files', 'File']);
        await command('go', 'Your home directory');
        await title('file').waitFor();
        await title('file').click();
        assert.match(await panel.innerText(), /New file/);
        await page.keyboard.press('Escape');
        await title('help').click();
        assert.match(await panel.innerText(), /Files quick help/);
        await page.keyboard.press('Escape');

        await open('barcode-scanner', menus['barcode-scanner']);
        await title('window').click();
        const windowText = await panel.innerText();
        assert.match(windowText, /Minimize all/);
        assert.match(windowText, /Barcode Scanner/);
        assert(!/Maximize|Snap|Dock/.test(windowText));
        await page.keyboard.press('Escape');
        await page.locator('.menubar-front .menubar-title').first().click();
        assert.match(await panel.innerText(), /Open as a page/);
        assert.match(await panel.innerText(), /Copy link to this applet/);
        assert.match(await panel.innerText(), /Close window/);
        await page.evaluate(() => { navigator.clipboard.writeText = async text => { window.copiedMenuLink = text; }; });
        await panel.getByRole('menuitem', { name: 'Copy link to this applet', exact: true }).click();
        assert.match(await page.evaluate(() => window.copiedMenuLink), /\/page\/barcode-scanner/);
        await page.locator('.menubar-front .menubar-title').first().click();
        await page.evaluate(() => pudlWindows.close('barcode-scanner'));
        await panel.waitFor({ state: 'hidden' });

        await open('editor', menus.editor);
        await page.locator('.cm-content').waitFor();
        await command('go', 'Go to line…');
        await page.locator('.cm-panel').waitFor();
        assert.match(await page.locator('.cm-panel').innerText(), /Go to line/);
        await page.keyboard.press('Escape');
        const wrap = page.locator('[data-applet="editor"] input[type="checkbox"]').first();
        const wasWrapped = await wrap.isChecked();
        await title('view').click();
        assert.match(await panel.innerText(), /EDITOR/);
        await panel.getByRole('menuitemcheckbox', { name: 'Wrap lines', exact: true }).click();
        assert.equal(await wrap.isChecked(), !wasWrapped);
        await page.locator('.md-filter').first().focus();
        await page.keyboard.press('Control+Alt+g');
        assert.equal(await page.locator('.cm-panel:visible').count(), 0);
        await page.locator('.cm-content').click();
        await page.keyboard.press('Control+Alt+g');
        await page.locator('.cm-panel').waitFor();
        await page.keyboard.press('Escape');
        await page.locator('.cm-content').fill('Menu migration check');
        await page.locator('.menubar-front .menubar-title').first().click();
        await panel.getByRole('menuitem', { name: 'Close window', exact: true }).click();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(await page.locator('.win[data-win="editor"]').count(), 1);
        await command('window', 'Close all windows');
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(await page.locator('.win[data-win="editor"]').count(), 1);

        await page.goto(origin + '/page/barcode-scanner');
        await page.locator('.menubar-front').waitFor();
        await page.locator('.menubar-front .menubar-title').first().click();
        assert(!/Close window/.test(await panel.innerText()));
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 375, height: 812 });
        await page.waitForTimeout(200);
        const mobileTitle = page.locator('.menubar-one .menubar-title');
        await mobileTitle.click();
        const mobileText = await panel.innerText();
        assert.match(mobileText, /Parks Computing/);
        assert.match(mobileText, /Barcode Scanner/);
        await panel.getByRole('menuitem', { name: 'Scan', exact: true }).click();
        assert.match(await panel.innerText(), /Type or paste/);
        await panel.getByRole('menuitem', { name: /Back/ }).click();
        assert.match(await panel.innerText(), /Barcode Scanner/);
        await mobileTitle.click();
        assert(!(await panel.isVisible()));
        assert.deepEqual(errors, []);
        console.log(name + ': menu ordering, applets, keyboard, contributions, close guards, target removal, and mobile passed');
    } finally {
        await browser.close();
    }
}

(async () => {
    for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) await check(engine, name);
})().catch(e => { console.error(e); process.exitCode = 1; });
