/* Host integration checks for the content launcher, filter URLs and windows.
   UI_SITE, PLAYWRIGHT_MODULE and CHROMIUM_PATH select the beta and browser. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_SITE || 'https://beta.parkscomputing.com';

(async () => {
    const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const root = page.locator('#site-launcher');
        const query = root.locator('[data-start-query]');
        const mode = value => page.waitForFunction(value => window.pudlLauncher?.state(document.getElementById('site-launcher'))?.presentation === value, value);
        const open = async () => {
            const id = await page.evaluate(() => pudlMenubar.launcherButton({ visible: true }).id);
            const collapsedMenu = await page.locator('#' + id).getAttribute('aria-haspopup') === 'menu';
            await page.locator('#' + id).click();
            if (collapsedMenu) {
                await page.locator('#menubar-panel').getByRole('menuitem', { name: 'Open launcher', exact: true }).click();
            }
            await mode('popup');
        };
        async function taskbar() {
            const box = await page.locator('body > .win-bar').boundingBox();
            assert(box && Math.abs(box.x) < 1 && Math.abs(box.width - page.viewportSize().width) < 2);
            assert(Math.abs(box.y + box.height - page.viewportSize().height) < 2, JSON.stringify(box));
            assert.equal(await page.locator('.md-sidebar, #cat-filter-menu, [data-sidebar-toggle]').count(), 0);
            assert.equal(await page.locator('.pin-bar, [data-applet="pin-bar"], #pc-pins-data').count(), 0);
        }
        async function sizeCorner() {
            const panel = await root.boundingBox();
            const size = await root.locator('[data-launcher-size]').boundingBox();
            assert(panel && size);
            const rightGap = panel.x + panel.width - size.x - size.width;
            const bottomGap = panel.y + panel.height - size.y - size.height;
            assert(rightGap >= 8 && rightGap <= 20, 'Size keeps the right corner');
            assert(bottomGap >= 8 && bottomGap <= 20, 'Size keeps the bottom corner');
            assert.equal(await root.locator('.start-footer a, .start-footer button').count(), 1);
        }
        await page.goto(base + '/?open=about&top=about&launcher=pane');
        await mode('pane');
        await page.locator('[data-win="about"]').waitFor();
        await page.evaluate(() => { window.launcherTestWindow = document.querySelector('[data-win="about"]'); });
        await taskbar();
        assert.equal(await root.locator('.pin-bar').count(), 0);
        assert.equal(await root.locator('a[href="/home"]').count(), 0);
        assert.equal(await page.locator('.menubar-title[data-menu-id="go"], .menubar-title[data-menu-id="applets"]').count(), 0);
        assert.equal(await root.getAttribute('role'), 'region');
        assert.equal(await root.locator('.start-header .popover-title, [data-catalog-links]').count(), 0);
        assert.equal(await root.getByRole('link', { name: 'Home', exact: true }).count(), 0);
        assert.equal(await page.locator('.desktop-guide, .desktop-sections, [data-open-launcher]').count(), 0);
        assert.equal(await page.locator('.welcome-card h1').textContent(), 'Welcome to the desktop');
        assert.match(await page.locator('.welcome-card').textContent(), /Click its pin button to unpin it.*Parks Computing/s);
        assert.equal(await root.locator('.catalog-key-hint').isVisible(), true);
        assert.equal(await root.locator('.catalog-actions').getByRole('link', { name: 'Settings', exact: true }).count(), 1);
        const signInGlyph = root.locator('.catalog-actions [data-account-dialog] .glyph');
        assert(await signInGlyph.evaluate(element => {
            const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
            return bounds.width > 0 && bounds.height > 0 && style.maskImage !== 'none';
        }), 'Sign in has a visible account glyph');
        assert(await page.locator('.topbar [data-status="account"] .glyph').evaluate(element => getComputedStyle(element).maskImage !== 'none'));
        await root.locator('.catalog-actions [data-account-dialog]').click();
        await page.locator('dialog[data-account-live]').waitFor({ state: 'visible' });
        assert.equal(await page.locator('dialog[data-account-live]').getByRole('link', { name: /Create an account/ }).count(), 1);
        const signInLayout = await page.locator('dialog[data-account-live] [data-account-panel]').evaluate(panel => {
            const passkey = panel.querySelector('.account-alt'), actions = panel.querySelector('.dialog-actions');
            const passkeyBox = passkey.getBoundingClientRect(), actionsBox = actions.getBoundingClientRect();
            const visibleChildren = Array.from(panel.querySelector('form').children).filter(element => element.getBoundingClientRect().height > 0);
            return { passkeyBottom: passkeyBox.bottom, actionsTop: actionsBox.top, last: actions === visibleChildren.at(-1) };
        });
        assert(signInLayout.last && signInLayout.actionsTop >= signInLayout.passkeyBottom, 'Sign-in actions follow the passkey section at the bottom');
        assert(await page.locator('dialog[data-account-live]').evaluate(dialog => {
            const submit = dialog.querySelector('[type="submit"]'), passkey = dialog.querySelector('[data-passkey="signin"]');
            return submit.form === passkey.form && passkey.type === 'button';
        }), 'Moving the passkey section preserves the email form and button behavior');
        if (process.env.LAUNCHER_SHOTS) { await page.locator('dialog[data-account-live]').screenshot({ path: process.env.LAUNCHER_SHOTS + '/launcher-signin.png' }); }
        await page.locator('dialog[data-account-live] [data-account-cancel]').click();
        await sizeCorner();
        const headingGap = await root.locator('.start-heading').evaluate(element => {
            const heading = element.querySelector('[data-start-heading]');
            return heading.getBoundingClientRect().top - element.getBoundingClientRect().top;
        });
        assert(headingGap >= 8, 'The category heading has space above it');
        assert.equal(await page.evaluate(() => typeof window.pcPins), 'undefined');
        if (process.env.LAUNCHER_SHOTS) { await page.screenshot({ path: process.env.LAUNCHER_SHOTS + '/launcher-pinned.png' }); }
        const category = root.locator('[data-start-category-key]:not([data-start-category-key=""])').first();
        const categoryKey = await category.getAttribute('data-start-category-key');
        await category.click();
        await page.waitForFunction(key => new URL(location.href).searchParams.get('cat') === key, categoryKey);
        await query.fill('barcode');
        await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'barcode');
        assert.equal(new URL(page.url()).searchParams.has('cat'), false);
        assert(await root.locator('[data-start-item]:visible').count() > 0);
        await query.fill('');
        const tagged = await root.locator('[data-start-item]').evaluateAll(rows => rows.map(row => JSON.parse(row.dataset.catalogTags)).find(tags => tags.length));
        assert(tagged?.length, 'The catalog supplies real tags');
        await root.getByRole('button', { name: 'Tags', exact: true }).click();
        const tagBox = root.locator('[data-catalog-tag-menu] input');
        await tagBox.evaluateAll((boxes, tag) => boxes.find(box => box.value === tag).click(), tagged[0]);
        await page.waitForFunction(tag => new URL(location.href).searchParams.getAll('tag').includes(tag), tagged[0]);
        assert.equal(await root.locator('[data-remove-tag]').count(), 1);
        const visibleTags = await root.locator('[data-start-item]:visible').evaluateAll(rows => rows.map(row => JSON.parse(row.dataset.catalogTags)));
        assert(visibleTags.every(tags => tags.includes(tagged[0])));
        await page.keyboard.press('Escape');
        await root.locator('[data-remove-tag]').click();
        await page.waitForFunction(() => !new URL(location.href).searchParams.has('tag'));
        await page.goBack();
        await page.waitForFunction(() => document.querySelectorAll('[data-remove-tag]').length === 1);
        await root.locator('[data-catalog-clear]').click();
        await page.waitForFunction(() => !new URL(location.href).searchParams.has('tag'));
        assert(await page.evaluate(() => window.launcherTestWindow === document.querySelector('[data-win="about"]')), 'Filtering preserves the mounted window');

        const divider = page.locator('.catalog-divider');
        const width = await page.locator('#catalog-slot').evaluate(element => element.getBoundingClientRect().width);
        await divider.focus(); await page.keyboard.press('ArrowRight');
        await page.waitForFunction(width => document.getElementById('catalog-slot').getBoundingClientRect().width > width, width);
        await page.waitForFunction(() => !!localStorage.getItem('pc-launcher-pane-width'));
        await root.locator('[data-launcher-pin]').click();
        await mode('closed');
        await open();
        await root.locator('[data-launcher-pin]').click(); await mode('pane');
        await root.locator('[data-launcher-pin]').click(); await mode('popup');
        await page.keyboard.press('Escape'); await mode('closed');
        assert(await page.evaluate(() => document.activeElement === pudlMenubar.launcherButton({ visible: true })));
        await open();
        await query.fill('coincidences');
        await query.press('ArrowDown');
        assert(await page.evaluate(() => !!document.activeElement.closest('[data-start-item]')));
        await page.keyboard.press('Enter');
        await mode('closed');
        await taskbar();
        await page.locator('.menubar-title[data-menu-id="view"]').first().click();
        await page.locator('#menubar-panel').waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        await page.locator('.menubar-title[data-menu-id="help"]').first().click();
        assert.equal(await page.locator('#menubar-panel').getByRole('menuitem', { name: 'About Parks Computing', exact: true }).count(), 1);
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.pcLauncher.open());
        await mode('popup');
        await root.locator('[data-catalog-clear]').click();
        await sizeCorner();
        if (process.env.LAUNCHER_SHOTS) { await page.screenshot({ path: process.env.LAUNCHER_SHOTS + '/launcher-desktop.png' }); }
        await page.evaluate(() => window.pudlSetTheme('light'));
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
        if (process.env.LAUNCHER_SHOTS) { await page.screenshot({ path: process.env.LAUNCHER_SHOTS + '/launcher-light.png' }); }
        await page.evaluate(() => pudlLauncher.resize(document.getElementById('site-launcher'), { width: 340 }));
        await root.locator('.catalog-key-hint').waitFor({ state: 'hidden' });
        await sizeCorner();
        await page.evaluate(() => pudlLauncher.resize(document.getElementById('site-launcher'), { width: 820 }));

        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(base + '/?open=about&top=about&launcher=closed');
        await mode('closed'); await open();
        let bounds = await root.boundingBox();
        assert(bounds.x >= 0 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 845, JSON.stringify(bounds));
        await sizeCorner();
        if (process.env.LAUNCHER_SHOTS) { await page.screenshot({ path: process.env.LAUNCHER_SHOTS + '/launcher-phone-open.png' }); }
        await root.locator('[data-launcher-pin]').click(); await mode('pane');
        await sizeCorner();
        await query.fill('coincidences');
        const flash = await root.locator('[data-start-item]:visible a').first().evaluate(link => {
            window.launcherActivationCount = 0;
            link.addEventListener('click', () => { window.launcherActivationCount++; });
            link.click();
            return { activations: window.launcherActivationCount, highlighted: link.closest('[data-start-item]').hasAttribute('data-launcher-selected'), mode: pudlLauncher.state(document.getElementById('site-launcher')).presentation };
        });
        assert(flash.activations === 1 && flash.highlighted && flash.mode === 'pane', 'Selection is highlighted while the launcher is still visible');
        await mode('collapsed');
        assert.equal(await page.evaluate(() => window.launcherActivationCount), 1, 'The original click executes once without replay');
        await taskbar();
        assert.equal(await page.locator('.catalog-reader').isVisible(), true);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (process.env.LAUNCHER_SHOTS) { await page.screenshot({ path: process.env.LAUNCHER_SHOTS + '/launcher-phone.png' }); }

        await page.goto(base + '/home');
        await page.locator('.menubar-row').waitFor();
        assert.equal(await root.count(), 0);
        assert.deepEqual(errors, []);
        const plain = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } });
        await plain.goto(base + '/?open=&cat=articles&q=barcode');
        assert(await plain.locator('#site-launcher').isVisible());
        assert(await plain.locator('[data-start-item]:visible a').count() > 0);
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
            const firstVisit = await browser.newPage({ viewport });
            await firstVisit.goto(base + '/?open=');
            await firstVisit.waitForFunction(() => window.pudlLauncher?.state(document.getElementById('site-launcher'))?.presentation === 'pane');
            assert.equal(await firstVisit.locator('[data-launcher-pin]').getAttribute('aria-pressed'), 'true');
            await firstVisit.locator('[data-start-query]').focus();
            await firstVisit.keyboard.press('Escape');
            await firstVisit.waitForFunction(() => pudlLauncher.state(document.getElementById('site-launcher')).presentation === 'collapsed');
            await firstVisit.goto(base + '/?open=');
            await firstVisit.waitForFunction(() => window.pudlLauncher?.state(document.getElementById('site-launcher'))?.presentation === 'collapsed');
            await firstVisit.close();
        }
        console.log('PASS launcher categories, search, tags, history, window identity, resize, pin/unpin, menus, phone, classic and no-script catalog');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
