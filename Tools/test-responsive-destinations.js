/* Compact browsing returns to content only after accepted destinations. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.UI_SITE || 'https://beta.parkscomputing.com';
(async () => {
    const engine = process.env.PINS_ENGINE || 'firefox';
    const browser = await ({ chromium, firefox, webkit })[engine].launch({ executablePath: engine === 'chromium' ? process.env.CHROMIUM_PATH : process.env.PINS_BROWSER_PATH });
    try {
        const context = await browser.newContext({ viewport: {width:390,height:850} });
        await context.addInitScript(() => {
            const menu='pudl-menu-0076006900650077';
            const pins=['app-files','app-editor','app-terminal','article-coincidences','window-one-word-or-two',menu];
            if(!localStorage.getItem('pc-taskbar-v1-guest')) localStorage.setItem('pc-taskbar-v1-guest',JSON.stringify({version:2,pins,order:pins.map(id=>'pin:'+id),references:pins.map(id=>({id,provider:id===menu?'pudl-site-menus':'content'}))}));
        });
        const page = await context.newPage(), errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto(base+'/?launcher=popup&launcher-visible=1&open=about',{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>window.pcTaskbarPins?.ready&&window.pcLauncher);
        await page.evaluate(()=>{
            window.activationTrace=[];
            for(const type of ['pudl:taskbar-activate','pudl:taskbar-activation-end','pudl:launcher-change']) document.addEventListener(type,e=>activationTrace.push({type,id:e.detail.id,status:e.detail.status,error:e.detail.error?.message,visible:e.detail.visible,presentation:e.detail.presentation}));
        });
        const visible = async value => {
            try { await page.waitForFunction(value=>pudlLauncher.state(document.getElementById('site-launcher')).visible===value,value); }
            catch(error) {
                const evidence=await page.evaluate(()=>({launcher:pudlLauncher.state(document.getElementById('site-launcher')),windows:pudlWindows.state(),active:document.activeElement.outerHTML,trace:activationTrace,toasts:[...document.querySelectorAll('[role="alert"],.toast')].map(n=>n.textContent)}));
                fs.writeFileSync(path.join(process.env.PINS_SHOTS,'responsive-destination-failure-'+engine+'.json'),JSON.stringify(evidence,null,2));
                await page.screenshot({path:path.join(process.env.PINS_SHOTS,'responsive-destination-failure-'+engine+'.png')});throw error;
            }
        };
        const open = async()=>{await page.locator('#taskbar-launcher').click();await visible(true);};
        const pins=page.locator('.win-pins-more:visible');
        const menu=()=>page.getByRole('menu',{name:'Pinned',exact:true});
        await visible(true);
        await pins.click(); await menu().getByRole('menuitem',{name:'View, pinned menu',exact:true}).click();
        await page.getByRole('menu',{name:'View',exact:true}).waitFor();await visible(true);
        await page.keyboard.press('Escape');await visible(true);
        await pins.click();await menu().getByRole('menuitem',{name:/^One Word Or Two\?/i}).click();
        await visible(false);
        await page.waitForFunction(()=>pudlWindows.state().top==='one-word-or-two');
        assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pc-launcher-presentation'))),'popup');
        await open();
        await page.locator('[data-win-dock] [data-win-tab="one-word-or-two"]').click();await visible(false);
        assert.equal(await page.evaluate(()=>!!pudlWindows.state().min['one-word-or-two']),true);
        console.log('PASS pinned menu leaves compact browsing intact; dormant destination and foreground singleton return to content ('+engine+')');

        await open();await pins.click();
        await menu().getByRole('menuitem',{name:/^Terminal,/}).click();await visible(false);
        await page.waitForFunction(()=>document.querySelector('.win[data-win="terminal"] [data-applet-state="running"]') || document.querySelector('.win[data-win="terminal"][data-applet-state="running"]'));
        await open();await page.locator('[data-win-dock] [data-win-pin="app-terminal"]').click({button:'right'});
        await page.getByRole('menuitem',{name:'New window',exact:true}).click();
        await page.locator('.win[data-win="terminal-2"]').waitFor();await visible(false);
        await open();await page.locator('[data-win-dock] [data-win-pin="app-terminal"]').click();
        const stack=page.locator('.win-stack-panel:visible');await stack.waitFor();await visible(true);
        await stack.locator('[data-win-tab="terminal"]').click();
        await page.waitForFunction(()=>pudlWindows.state().top==='terminal');await visible(false);
        console.log('PASS command readiness and New window return to content, while opening a stack waits for accepted row selection ('+engine+')');
        assert.deepEqual(errors,[]);
    } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
