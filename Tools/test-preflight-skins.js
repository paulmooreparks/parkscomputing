/* Real-host skin changes must retain taskbar geometry and application state. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
    const engine=process.env.PINS_ENGINE||'firefox', base=process.env.UI_SITE||'https://beta.parkscomputing.com';
    const browser=await ({chromium,firefox,webkit})[engine].launch({executablePath:engine==='chromium'?process.env.CHROMIUM_PATH:process.env.PINS_BROWSER_PATH});
    try {
        const page=await browser.newPage({viewport:{width:1440,height:950}}), errors=[], observations=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto(base+'/?launcher=collapsed&open=about,coincidences,power-of-guitar,barcode-flash-cards&top=power-of-guitar',{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>window.pcTaskbarPins?.ready&&window.pcLauncher);
        assert.equal(await page.evaluate(()=>pcTaskbarPins.candidate),process.env.PINS_CANDIDATE);
        await page.evaluate(async()=>{
            for(const id of ['bevel','gel','glaze','matte','ink','alloy','glass']) await new Promise((resolve,reject)=>{
                const link=document.createElement('link');link.rel='stylesheet';link.href='/pudl/pudl-skin-'+id+'.css';link.setAttribute('data-pudl-skin',id);
                link.onload=resolve;link.onerror=()=>reject(new Error('Skin failed to load: '+id));
                const host=document.querySelector('link[href*="css/pudl-site.css"]');document.head.insertBefore(link,host);
            });
        });
        await page.addScriptTag({url:base+'/pudl/pudl-skins.js'});
        assert.equal(await page.evaluate(()=>pudlSkins.available().length),8);
        const current=page.locator('[data-win-dock] [data-win-tab="power-of-guitar"]');
        const original=await current.elementHandle();
        const before=await page.evaluate(()=>({preferences:pudlWindows.taskbarState(),open:pudlWindows.state().open,top:pudlWindows.state().top,url:location.href}));
        const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        for(const theme of ['light','dark']) for(const skin of ['standard','bevel','gel','glaze','matte','ink','alloy','glass']) {
            await page.evaluate(({theme,skin})=>{pudlSetTheme(theme);if(!pudlSkins.select(skin))throw new Error('Skin unavailable');},{theme,skin});
            await page.evaluate(()=>document.fonts.ready);await frames();
            for(const width of [650,390,320,1440]) {
                await page.setViewportSize({width,height:950});await frames();
                await page.waitForFunction(()=>{
                    const d=document.querySelector('[data-win-dock]').getBoundingClientRect(),a=document.querySelector('[data-win-tab="power-of-guitar"]').getBoundingClientRect();
                    return a.width>0&&a.left>=d.left-1&&a.right<=d.right+1;
                });
                assert.equal(await original.evaluate(n=>n===document.querySelector('[data-win-dock] [data-win-tab="power-of-guitar"]')),true);
                const first=await current.boundingBox();
                for(let i=0;i<5;i++){await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await frames();}
                const last=await current.boundingBox();
                assert(Math.abs(first.width-last.width)<=1/64+0.001,'Unchanged active width drifted in '+skin+'/'+theme+'/'+width+': '+first.width+' -> '+last.width);
                const height=await page.locator('.win-bar').evaluate(bar=>[...bar.querySelectorAll('.win-tab,.icon-btn')].filter(n=>n.getClientRects().length).map(n=>n.getBoundingClientRect().height));
                assert(Math.max(...height)-Math.min(...height)<=1,'Taskbar controls have unequal heights');
                const after=await page.evaluate(()=>({preferences:pudlWindows.taskbarState(),open:pudlWindows.state().open,top:pudlWindows.state().top}));
                assert.deepEqual(after,{preferences:before.preferences,open:before.open,top:before.top});
                observations.push({skin,theme,width,firstWidth:first.width,lastWidth:last.width,height:height[0]});
            }
            if(['standard','bevel','glass'].includes(skin)) await page.screenshot({path:path.join(process.env.PINS_SHOTS,'preflight-'+skin+'-'+theme+'-'+engine+'.png')});
        }
        await page.evaluate(()=>pudlSkins.select('standard'));await frames();
        assert.equal(await page.evaluate(()=>pudlSkins.current()),'standard');
        assert.deepEqual(errors,[]);
        fs.writeFileSync(path.join(process.env.PINS_SHOTS,'preflight-skin-geometry-'+engine+'.json'),JSON.stringify(observations,null,2));
        console.log('PASS '+observations.length+' skin/theme/width observations, five repeated measurements each, stable active DOM/width, equal heights and unchanged preferences/windows ('+engine+')');
        console.log('Skin registration is test-only through the documented optional runtime; this does not add a host skin selector.');
    } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
