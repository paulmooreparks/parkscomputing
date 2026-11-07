/* Unhandled compact Escape respects nested UI and the desktop preference. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
    const engine = process.env.PINS_ENGINE || 'firefox';
    const browser = await ({ chromium, firefox, webkit })[engine].launch({ executablePath: engine === 'chromium' ? process.env.CHROMIUM_PATH : process.env.PINS_BROWSER_PATH });
    try {
        const page = await browser.newPage({ viewport:{width:390,height:850} }), errors=[], observations=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto((process.env.UI_SITE||'https://beta.parkscomputing.com')+'/?launcher=pane&launcher-visible=1&open=about,coincidences,power-of-guitar',{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>window.pcLauncher&&window.pcTaskbarPins?.ready);
        const root=page.locator('#site-launcher'), opener=page.locator('#taskbar-launcher');
        const visible=value=>page.waitForFunction(value=>pudlLauncher.state(document.getElementById('site-launcher')).visible===value,value);
        const snapshot=async label=>observations.push({label,...await page.evaluate(()=>({launcher:pudlLauncher.state(document.getElementById('site-launcher')),focus:document.activeElement.getAttribute('aria-label')||document.activeElement.id||document.activeElement.tagName}))});
        const open=async()=>{await opener.click();await visible(true);};
        await visible(true);
        await page.locator('.win-bar-windows:visible').click();
        await page.getByRole('menu',{name:'Windows',exact:true}).waitFor();
        await page.keyboard.press('Escape');await visible(true);
        await page.getByRole('menu',{name:'Windows',exact:true}).waitFor({state:'hidden'});
        assert.equal(await root.evaluate(n=>n.contains(document.activeElement)),false);
        await snapshot('after Windows Escape');
        await page.keyboard.press('Escape');await visible(false);
        assert.equal(await opener.evaluate(n=>n===document.activeElement),true);
        assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pc-launcher-presentation'))),'pane');
        await snapshot('after second Escape');
        console.log('PASS exact compact Windows/Escape/Escape closes catalog, restores bottom-left focus and preserves desktop pane ('+engine+')');

        await open();
        await page.locator('.win-bar-windows').focus();await page.keyboard.press('Escape');await visible(false);
        assert.equal(await opener.evaluate(n=>n===document.activeElement),true);
        await open();await page.evaluate(()=>{document.body.tabIndex=-1;document.body.focus();});
        await page.keyboard.press('Escape');await visible(false);
        await open();await page.locator('.win-bar-windows').focus();
        for(const flags of [{ctrlKey:true},{altKey:true},{metaKey:true},{isComposing:true}]) {
            await page.evaluate(flags=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true,...flags})),flags);
            await visible(true);
        }
        await page.evaluate(()=>{
            const target=document.activeElement;
            target.addEventListener('keydown',e=>e.preventDefault(),{once:true});
            target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        });await visible(true);
        await page.keyboard.press('Escape');await visible(false);
        console.log('PASS outside taskbar/body focus, handled Escape, composition and modifier safeguards ('+engine+')');

        await open();await root.locator('[data-launcher-size]').click();
        await page.locator('#catalog-size').waitFor({state:'visible'});
        await page.keyboard.press('Escape');await page.locator('#catalog-size').waitFor({state:'hidden'});await visible(true);
        assert.equal(await root.locator('[data-launcher-size]').evaluate(n=>n===document.activeElement),true);
        await page.keyboard.press('Escape');await visible(false);
        await open();
        await page.evaluate(()=>{
            const popup=document.createElement('div');popup.id='escape-priority-popup';popup.setAttribute('popover','auto');
            const button=document.createElement('button');button.textContent='Native popup focus';popup.appendChild(button);document.body.appendChild(popup);popup.showPopover();button.focus();
        });
        await page.keyboard.press('Escape');await page.locator('#escape-priority-popup').waitFor({state:'hidden'});await visible(true);
        await page.keyboard.press('Escape');await visible(false);
        await page.evaluate(()=>document.getElementById('escape-priority-popup').remove());
        await open();
        await page.evaluate(()=>{
            const dialog=document.createElement('dialog');dialog.id='escape-priority-modal';
            const button=document.createElement('button');button.textContent='Modal focus';dialog.appendChild(button);document.body.appendChild(dialog);dialog.showModal();button.focus();
        });
        await page.keyboard.press('Escape');await page.locator('#escape-priority-modal').waitFor({state:'hidden'});await visible(true);
        await page.keyboard.press('Escape');await visible(false);
        await page.evaluate(()=>document.getElementById('escape-priority-modal').remove());
        console.log('PASS authored Size, native auto popover and modal dismissal precede compact catalog dismissal ('+engine+')');

        await page.setViewportSize({width:1440,height:950});
        await page.waitForFunction(()=>!pudlLauncher.state(document.getElementById('site-launcher')).compact);
        await visible(true);await page.evaluate(()=>document.body.focus());
        await page.keyboard.press('Escape');await visible(true);
        assert.equal(await page.evaluate(()=>pudlLauncher.state(document.getElementById('site-launcher')).presentation),'pane');
        await snapshot('desktop outside Escape');
        await page.screenshot({path:path.join(process.env.PINS_SHOTS,'escape-desktop-'+engine+'.png')});
        await page.setViewportSize({width:320,height:850});
        await page.waitForFunction(()=>pudlLauncher.state(document.getElementById('site-launcher')).compact);
        await visible(true);await page.locator('.win-bar-windows').focus();await page.keyboard.press('Escape');await visible(false);
        await page.screenshot({path:path.join(process.env.PINS_SHOTS,'escape-compact-closed-'+engine+'.png')});
        fs.writeFileSync(path.join(process.env.PINS_SHOTS,'escape-states-'+engine+'.json'),JSON.stringify(observations,null,2));
        assert.deepEqual(errors,[]);
        console.log('PASS wide desktop isolation and restored compact dismissal without browser errors ('+engine+')');
    } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
