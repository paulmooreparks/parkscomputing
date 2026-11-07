/* Responsive appearance must preserve the host's desktop preferences. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_SITE || 'https://beta.parkscomputing.com';
const output = process.env.PINS_SHOTS;

(async () => {
    const engine = process.env.PINS_ENGINE || 'firefox';
    const browser = await ({ chromium, firefox, webkit })[engine].launch({ executablePath: engine === 'chromium' ? process.env.CHROMIUM_PATH : process.env.PINS_BROWSER_PATH });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
        const page = await context.newPage(), errors = [], observations = [];
        page.on('pageerror', e => errors.push(e.message));
        const ready = () => page.waitForFunction(() => window.pcTaskbarPins?.ready && window.pcLauncher);
        const state = () => page.evaluate(() => pudlLauncher.state(document.getElementById('site-launcher')));
        const expect = (compact, visible, presentation) => page.waitForFunction(({ compact, visible, presentation }) => {
            const s = pudlLauncher.state(document.getElementById('site-launcher'));
            return s.compact === compact && s.visible === visible && s.presentation === presentation;
        }, { compact, visible, presentation });
        const root = page.locator('#site-launcher'), opener = page.locator('#taskbar-launcher');
        const title = () => page.locator('.menubar-title[data-menu-id="site"]');
        const sizePanel = page.locator('#catalog-size');
        async function sizeOpen() { await root.locator('[data-launcher-size]').click(); await sizePanel.waitFor({ state: 'visible' }); }
        async function sizeClose() { await page.keyboard.press('Escape'); await sizePanel.waitFor({ state: 'hidden' }); }
        await page.goto(base + '/?launcher=closed&open=about,coincidences,power-of-guitar', { waitUntil: 'domcontentloaded' }); await ready();
        await expect(false, false, 'closed');
        assert.equal(await opener.isVisible(), false);
        await title().click(); await expect(false, true, 'popup');
        await title().click(); await expect(false, false, 'closed');
        await title().focus(); await page.keyboard.press('Enter'); await expect(false, true, 'popup');
        assert.equal((await state()).width, 820); assert.equal((await state()).height, 620);
        await sizeOpen();
        assert.equal(await sizePanel.locator('[data-launcher-width]').isVisible(), true);
        assert.equal(await sizePanel.locator('[data-launcher-height]').isVisible(), true);
        await sizePanel.locator('[data-launcher-width]').fill('1100');
        await sizePanel.locator('[data-launcher-height]').fill('800');
        await sizeClose();
        await root.locator('[data-launcher-pin]').click(); await expect(false, true, 'pane');
        await sizeOpen();
        assert.equal(await sizePanel.locator('[data-launcher-height]').locator('..').isVisible(), false);
        await sizePanel.locator('[data-launcher-width]').fill('440');
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('pc-launcher-pane-size')).width === 440);
        await sizePanel.locator('[data-launcher-reset]').click();
        await page.waitForFunction(() => Math.abs(document.getElementById('catalog-slot').getBoundingClientRect().width - 560) < 2);
        await sizeClose();
        // A delayed keyboard splitter completion must not overwrite a newer explicit Size request.
        const divider = page.locator('.catalog-divider');
        await divider.focus(); await page.keyboard.press('ArrowRight');
        await page.evaluate(() => pudlLauncher.resize(document.getElementById('site-launcher'), { width: 450 }));
        await page.waitForTimeout(500);
        assert.equal((await state()).paneSize.width, 450);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pc-launcher-pane-size')).width), 450);
        console.log('PASS desktop title access, popup defaults, side-pane width/reset and delayed splitter persistence (' + engine + ')');

        for (const width of [650, 390, 320]) {
            await page.setViewportSize({ width, height: 850 }); await expect(true, true, 'pane');
            await page.waitForFunction(() => {
                const r=document.getElementById('site-launcher').getBoundingClientRect(),a=document.getElementById('catalog-workspace').getBoundingClientRect();
                return ['left','top','width','height'].every(key=>Math.abs(r[key]-a[key])<=2);
            });
            assert.equal(await opener.isVisible(), true);
            assert.equal(await root.getAttribute('popover'), 'manual');
            assert.equal(await root.locator('[data-launcher-pin]').isVisible(), false);
            const geometry = await root.evaluate(n => {
                const r = n.getBoundingClientRect(), a = document.getElementById('catalog-workspace').getBoundingClientRect();
                return { width: innerWidth, root: { left:r.left, top:r.top, width:r.width, height:r.height }, workspace: {left:a.left, top:a.top, width:a.width, height:a.height}, resize:getComputedStyle(n).resize };
            });
            for (const field of ['left', 'top', 'width', 'height']) assert(Math.abs(geometry.root[field] - geometry.workspace[field]) <= 2, field + ' fills workspace');
            assert.equal(geometry.resize, 'none'); observations.push(geometry);
            await sizeOpen();
            assert.equal(await sizePanel.locator('[data-launcher-width]').locator('..').isVisible(), false);
            assert.equal(await sizePanel.locator('[data-launcher-height]').locator('..').isVisible(), false);
            assert.equal(await sizePanel.locator('[data-launcher-size-note]').isVisible(), true);
            assert.equal(await sizePanel.getByRole('button', { name: 'Reset saved desktop size', exact: true }).isEnabled(), true);
            await page.screenshot({ path: path.join(output, 'responsive-size-' + width + '-' + engine + '.png') });
            await sizeClose();
            await opener.click(); await expect(true, false, 'pane');
            await opener.click(); await expect(true, true, 'pane');
        }
        assert.equal((await state()).width, 1100); assert.equal((await state()).height, 800);
        await root.locator('[data-launcher-close]').click(); await expect(true, false, 'pane');
        await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await expect(true, false, 'pane');
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pc-launcher-compact-visible'))), false);
        await opener.click(); await expect(true, true, 'pane');
        await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await expect(true, true, 'pane');
        await page.evaluate(() => {
            const url = new URL(location.href); url.searchParams.set('launcher-visible','0'); history.pushState(history.state,'',url);
            url.searchParams.set('launcher-visible','1'); history.pushState(history.state,'',url);
        });
        await page.goBack(); await expect(true,false,'pane');
        await page.goForward(); await expect(true,true,'pane');
        await page.setViewportSize({ width: 1440, height: 950 }); await expect(false, true, 'pane');
        assert.equal(await opener.isVisible(), false);
        assert.equal((await state()).paneSize.width, 450);
        await root.locator('[data-launcher-pin]').click(); await expect(false, false, 'closed');
        await title().click(); await expect(false, true, 'popup');
        assert.equal((await state()).width, 1100); assert.equal((await state()).height, 800);
        console.log('PASS compact 650/390/320 workspace geometry, Size guidance, independent reload visibility and wide desktop restoration (' + engine + ')');

        await page.setViewportSize({ width: 651, height: 850 }); await expect(false, true, 'popup');
        assert.equal((await state()).width, 1100);
        assert((await root.boundingBox()).width < 1100);
        await page.setViewportSize({ width: 1440, height: 950 }); await expect(false, true, 'popup');
        await page.waitForFunction(() => document.getElementById('site-launcher').getBoundingClientRect().width >= 1098);
        await page.setViewportSize({ width: 390, height: 850 }); await expect(true, true, 'popup');
        await sizeOpen(); await sizePanel.getByRole('button', { name: 'Reset saved desktop size', exact: true }).click(); await sizeClose();
        assert.equal((await state()).width, 820); assert.equal((await state()).height, 620);
        await page.keyboard.press('Escape'); await expect(true, false, 'popup');
        await page.locator('.menubar-one .menubar-title').click();
        await page.getByRole('menuitem', { name:'Open launcher', exact:true }).click(); await expect(true, true, 'popup');
        const query = root.locator('[data-start-query]');
        await root.locator('[data-start-category-key="articles"]').click();
        await query.fill('word');
        await root.locator('[data-start-items]').evaluate(n => { n.scrollTop = 12; });
        const catalog = await root.evaluate(n => ({ state:pudlStart.state(n), scroll:n.querySelector('[data-start-items]').scrollTop }));
        await opener.click(); await expect(true, false, 'popup'); await opener.click(); await expect(true, true, 'popup');
        assert.deepEqual(await root.evaluate(n => ({ state:pudlStart.state(n), scroll:n.querySelector('[data-start-items]').scrollTop })), catalog);
        await query.fill('');
        await root.locator('a[data-win-open="one-word-or-two"]').click();
        await expect(true, false, 'popup');
        await page.waitForFunction(() => pudlWindows.state().top === 'one-word-or-two');
        await opener.click(); await expect(true, true, 'popup');
        await page.locator('[data-win-dock] [data-win-tab="about"]').click(); await expect(true, false, 'popup');
        assert.equal(await page.evaluate(() => pudlWindows.state().top), 'about');
        await opener.click(); await expect(true, true, 'popup');
        await page.locator('.win-bar-windows:visible').click();
        const actions = page.getByRole('menu', { name:'Windows', exact:true });
        assert.deepEqual((await actions.locator(':scope > .menu-action').allTextContents()).map(t=>t.trim()), ['Arrange taskbar','Minimize all','Close all windows']);
        assert.equal((await state()).visible, true, 'Actions popup does not count as a window selection');
        await page.keyboard.press('Escape'); await expect(true, true, 'popup');
        await page.keyboard.press('Escape'); await expect(true, false, 'popup');
        await page.setViewportSize({ width:1440,height:950 }); await expect(false,true,'popup');
        await sizeOpen();
        assert.equal(await sizePanel.locator('[data-launcher-width]').inputValue(),'820');
        assert.equal(await sizePanel.locator('[data-launcher-height]').inputValue(),'620');
        await sizeClose();
        await page.screenshot({ path:path.join(output,'responsive-wide-restored-'+engine+'.png') });
        console.log('PASS requested popup dimensions survive constraints, compact Reset restores desktop defaults, catalog/taskbar acceptance returns to content and actions popup stays separate (' + engine + ')');

        await page.evaluate(() => {
            const layout = document.getElementById('catalog-workspace'); layout.classList.add('stacked');
            pudlLauncher.present(document.getElementById('site-launcher'), 'pane', { focus:false });
            pudlSplit.refresh(layout);
            pudlLauncher.resize(document.getElementById('site-launcher'), {height:340});
        });
        await sizeOpen();
        assert.equal(await sizePanel.locator('[data-launcher-width]').locator('..').isVisible(), false);
        assert.equal(await sizePanel.locator('[data-launcher-height]').isVisible(), true);
        assert.equal((await state()).paneSize.height,340);
        await sizePanel.getByRole('button',{name:'Reset pane height',exact:true}).click();
        assert.equal(await page.evaluate(()=>document.getElementById('catalog-workspace').style.getPropertyValue('--split-a')),'');
        await sizeClose();
        console.log('PASS stacked host layout exposes only pane height and resets to the stylesheet ('+engine+')');

        if (engine !== 'firefox') {
            const touchContext = await browser.newContext({ hasTouch:true, viewport:{width:390,height:850} });
            const touch = await touchContext.newPage(); touch.on('pageerror',e=>errors.push(e.message));
            await touch.goto(base+'/?launcher=closed', {waitUntil:'domcontentloaded'});
            await touch.waitForFunction(()=>window.pcLauncher&&window.pcTaskbarPins?.ready);
            await touch.evaluate(()=>{window.queryFocus=0;document.addEventListener('focusin',e=>{if(e.target.matches('[data-start-query]'))queryFocus++;});});
            await touch.locator('#taskbar-launcher').tap();
            await touch.waitForFunction(()=>document.activeElement.id==='site-launcher');
            assert.equal(await touch.evaluate(()=>queryFocus),0);
            await touch.screenshot({path:path.join(output,'responsive-touch-'+engine+'.png')});
            await touchContext.close();
            console.log('PASS compact touch opens for browsing without transient filter focus ('+engine+')');
        }
        fs.writeFileSync(path.join(output,'responsive-geometry-'+engine+'.json'),JSON.stringify(observations,null,2));
        assert.deepEqual(errors,[]);
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
