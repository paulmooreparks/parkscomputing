/* Every command an applet's toolbar shows is on the applet's own ribbon
   tabs. A toolbar marked ribbon: 'hide' (PUDL 0.80.1) is hidden while the
   menu bar shows as a ribbon, and the ribbon is built from the applet's
   menus, so a command on the toolbar but in none of the applet's own menu
   titles would be out of reach (Architecture/pudl-adoption.md, D86). The
   site's own tabs (Go, View, Help and the rest) do not count, because the
   applet's commands are looked for on its tabs.

     PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... UI_SITE=http://localhost:8102 \
       PC_SIGNIN_LINK=... node Tools/test-ribbon-coverage.js

   Each case opens an address, selects an entry first where commands need
   one, and compares the toolbar's showing commands with every control on
   the applet's tabs, menu buttons and folded groups opened. The Editor's
   cases need ~/probe.md in the signed-in account's home and the test page
   test-visual-editor writes. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const BASE = process.env.UI_SITE || 'http://localhost:8102';
const HOST = ['site', 'go', 'applets', 'view', 'window', 'help', 'pins'];
const CASES = [
    ['files', '/page/files', 'about'],
    ['files', '/page/files', 'articles'],
    ['files', '/page/files', null],
    ['editor', '/page/editor', null],
    ['editor', '/page/editor?file=~/probe.md', null],
    ['editor', '/page/editor?file=/wwwroot/content/visual-editor-test.md', null],
    ['editor', '/?open=editor&top=editor', null]
];

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
    const page = await browser.newPage({ viewport: { width: 1900, height: 900 } });
    let failed = 0;
    await page.goto(process.env.PC_SIGNIN_LINK);
    await page.locator('form[method="post"] button', { hasText: 'Sign in' }).last().click();
    await page.waitForTimeout(2500);
    for (const [applet, address, select] of CASES) {
        await page.goto(BASE + address, { waitUntil: 'load' });
        await page.waitForSelector('.toolbar[data-toolbar-ribbon="hide"]', { timeout: 30000 });
        await page.waitForTimeout(2000);
        if (select) { await page.locator('[data-applet="' + applet + '"]').getByText(select, { exact: true }).first().click(); await page.waitForTimeout(800); }
        const bar = await page.evaluate(a => {
            const root = document.querySelector('[data-applet="' + a + '"]');
            const list = window.pudlCommands.list(root);
            const tb = document.querySelector('.toolbar[data-toolbar-ribbon="hide"]');
            const ids = [...new Set([...tb.querySelectorAll('[data-command]')].map(e => e.getAttribute('data-command')))];
            const out = ids.map(id => list.find(c => c.id === id)).filter(c => c && !c.hidden).map(c => ({ id: c.id, label: c.label }));
            tb.querySelectorAll('[data-command-choice]').forEach(e => {
                list.filter(c => c.choice === e.getAttribute('data-command-choice') && !c.hidden).forEach(c => out.push({ id: c.id, label: c.label }));
            });
            return out;
        }, applet);
        await page.click('.menubar-ribbon-toggle');
        await page.waitForTimeout(600);
        const tabs = (await page.locator('.site-menubar .menubar-title').evaluateAll(n => n.map(x => x.getAttribute('data-menu-id')).filter(Boolean)))
            .filter(t => !HOST.includes(t));
        const words = [];
        for (const t of tabs) {
            await page.locator('.site-menubar .menubar-title[data-menu-id="' + t + '"]').first().evaluate(e => e.click());
            await page.waitForTimeout(400);
            words.push(...await page.evaluate(async () => {
                const row = document.getElementById('menubar-ribbon-row');
                if (!row) { return []; }
                const found = new Set();
                row.querySelectorAll('button, a').forEach(e => {
                    const w = (e.querySelector('.toolbar-words') || e).textContent.trim();
                    if (w) { found.add(w); }
                    if (e.getAttribute('aria-label')) { found.add(e.getAttribute('aria-label')); }
                });
                for (const btn of row.querySelectorAll('.menu-btn[popovertarget]')) {
                    const panel = document.getElementById(btn.getAttribute('popovertarget'));
                    if (!panel) { continue; }
                    try { panel.showPopover(); } catch { }
                    await new Promise(r => setTimeout(r, 150));
                    panel.querySelectorAll('[role^=menuitem], button, a').forEach(e => { const w = e.textContent.trim(); if (w) { found.add(w); } });
                    try { panel.hidePopover(); } catch { }
                }
                return [...found];
            }));
        }
        await page.click('.menubar-ribbon-toggle');
        await page.waitForTimeout(300);
        const norm = s => s.toLowerCase().replace(/…|\.\.\./g, '').trim();
        const seen = words.map(norm);
        const missing = bar.filter(c => !seen.some(s => s.startsWith(norm(c.label))));
        const name = applet + ' at ' + address + (select ? ' with ' + select + ' selected' : '');
        if (missing.length) { failed++; console.log('FAIL ' + name + ': not on its tabs: ' + missing.map(c => c.label).join(', ')); }
        else { console.log('PASS ' + name + ': all ' + bar.length + ' toolbar commands on its tabs (' + tabs.join(', ') + ')'); }
    }
    await browser.close();
    if (failed) { process.exitCode = 1; } else { console.log('all checks passed'); }
})().catch(e => { console.error(e); process.exitCode = 1; });
