/* Font completion must update the real host's cached taskbar widths. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const{chromium,firefox,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
    const engine=process.env.PINS_ENGINE||'firefox';
    const browser=await({chromium,firefox,webkit})[engine].launch({executablePath:engine==='chromium'?process.env.CHROMIUM_PATH:process.env.PINS_BROWSER_PATH});
    let release;
    try{
        const context=await browser.newContext({viewport:{width:1440,height:950}}),page=await context.newPage(),errors=[];
        if(process.env.PINS_WINDOWS_CONTROL) await page.route(/\/pudl-windows\.js(?:\?|$)/,route=>route.fulfill({path:process.env.PINS_WINDOWS_CONTROL,contentType:'application/javascript'}));
        await context.addInitScript(()=>{
            const apply=()=>{if(!document.documentElement)return false;document.documentElement.style.setProperty('--font','monospace');return true;};
            if(!apply()){const observer=new MutationObserver(()=>{if(apply())observer.disconnect();});observer.observe(document,{childList:true});}
        });
        page.on('pageerror',e=>errors.push(e.message));
        const gate=new Promise(resolve=>{release=resolve;});let fontRequests=0;
        await page.goto((process.env.UI_SITE||'https://beta.parkscomputing.com')+'/?launcher=collapsed&open=about,coincidences,power-of-guitar,barcode-flash-cards&top=barcode-flash-cards',{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>window.pcTaskbarPins?.ready&&window.pcLauncher);
        await page.evaluate(()=>document.fonts.ready);
        await page.route('**/Inter-latin.woff2?preflight-delayed=1',async route=>{fontRequests++;await gate;await route.continue();});
        await page.evaluate(()=>{
            const style=document.createElement('style');
            style.textContent='@font-face { font-family: "PreflightDelayedInter"; src: url("/pudl/fonts/Inter-latin.woff2?preflight-delayed=1") format("woff2"); font-weight: 400 900; font-display: swap; }';
            document.head.appendChild(style);
            document.documentElement.style.setProperty('--font','"PreflightDelayedInter", monospace');
            document.querySelector('[data-win-dock]').getBoundingClientRect();
            window.dispatchEvent(new Event('resize'));
        });
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await page.waitForFunction(()=>{
            const tab=document.querySelector('[data-win-dock] [aria-current="true"]');
            return window.pcTaskbarPins?.ready&&tab&&parseFloat(tab.style.getPropertyValue('--win-tab-natural'))>0&&document.fonts.status==='loading';
        });
        assert(fontRequests>0,'Real font requests reached the cold-context gate');
        const tab=page.locator('[data-win-dock] [aria-current="true"]');
        const measure=()=>tab.evaluate(n=>({natural:parseFloat(n.style.getPropertyValue('--win-tab-natural')),width:n.getBoundingClientRect().width,font:getComputedStyle(n).fontFamily}));
        const fallback=await measure();release();
        await page.evaluate(async()=>{
            await document.fonts.ready;
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        });
        const loaded=await measure();
        fs.writeFileSync(path.join(process.env.PINS_SHOTS,'delayed-fonts-'+engine+'.json'),JSON.stringify({fontRequests,fallback,loaded},null,2));
        for(let i=0;i<5;i++)await page.evaluate(()=>{window.dispatchEvent(new Event('resize'));return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
        const repeated=await measure();
        fs.writeFileSync(path.join(process.env.PINS_SHOTS,'delayed-fonts-'+engine+'.json'),JSON.stringify({fontRequests,fallback,loaded,repeated},null,2));
        await page.screenshot({path:path.join(process.env.PINS_SHOTS,'delayed-fonts-'+engine+'.png')});
        assert(Math.abs(fallback.width-loaded.width)>1,'The controlled font must measurably change rendered text geometry');
        assert(Math.abs(loaded.natural-repeated.natural)<=1/64+0.001,'Cached width was already current before explicit remeasurement');
        assert(Math.abs(loaded.width-repeated.width)<=1/64+0.001,'Settled width must not drift on later layout');
        assert.deepEqual(errors,[]);
        console.log('PASS controlled delayed font invalidates cached natural width before later remeasurement ('+engine+'): '+fallback.natural+' -> '+loaded.natural+'; settled '+loaded.width);
    }finally{release?.();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
