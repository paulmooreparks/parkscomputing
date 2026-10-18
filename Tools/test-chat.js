/* The staff's Chat (pudl-chat, Chat/ in the engine,
   Architecture/chat-design.md) on a test instance: hidden from everyone but
   the staff, a reply streamed from a real provider with its thinking, a
   read-only tool run without asking, a tool that writes asking first, an
   attachment, the queue, Stop, and the conversation brought back by its
   address. It needs a provider in the instance's /etc/chat.json that
   answers (CHAT_PROVIDER and CHAT_MODEL, by default ollama and
   glm-5.3-flash:cloud) and a sign-in link for a super-user.

     PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... UI_SITE=http://localhost:8102 \
       PC_SIGNIN_LINK=<account-link output> node Tools/test-chat.js */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.UI_SITE || 'http://localhost:8102';
const LINK = process.env.PC_SIGNIN_LINK;

let failures = 0;
function log(name, ok, detail) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + String(detail || '').slice(0, 400))); if (!ok) { failures++; } }

(async () => {
    if (!LINK) { console.error('PC_SIGNIN_LINK is needed.'); process.exit(2); }
    const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const lastReply = () => page.evaluate(() => { const r = [...document.querySelectorAll('.chat-reply .msg-text')].pop(); return r ? r.textContent : ''; });
    const idle = (ms) => page.waitForFunction(() => !document.querySelector('.pudl-chat').classList.contains('is-working'), null, { timeout: ms || 120000 });
    async function ask(text) {
        await page.fill('.chat-text', text);
        await page.press('.chat-text', 'Enter');
        await page.waitForFunction(() => document.querySelector('.pudl-chat').classList.contains('is-working'), null, { timeout: 15000 }).catch(() => { });
    }

    // Signed out, there is nothing.
    const out = await page.request.get(BASE + '/api/admin/chat/providers');
    log('signed out, the chat\'s service answers 404', out.status() === 404, out.status());
    await page.goto(BASE + '/?view=window', { waitUntil: 'networkidle' });
    const publicMenu = await page.evaluate(() => [...document.querySelectorAll('[data-menubar-source] a, [data-menubar-source] button')].map(a => a.textContent.trim()));
    log('the menu offers no Chat to a reader', !publicMenu.includes('Chat'), publicMenu.join());
    await page.goto(BASE + '/page/chat', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-applet="chat"] .empty-state', { timeout: 30000 });
    log('the page says the chat is for the staff', /for the site's staff/.test(await page.textContent('[data-applet="chat"]')));

    // Signed in as the super-user.
    await page.goto(LINK);
    await page.locator('form[method="post"] button', { hasText: 'Sign in' }).last().click();
    await page.waitForTimeout(2500);
    await page.goto(BASE + '/?view=window', { waitUntil: 'networkidle' });
    const staffMenu = await page.evaluate(() => document.querySelector('[data-menubar-source]').textContent);
    log('the staff\'s Applets menu has Chat', /Chat/.test(staffMenu));

    await page.goto(BASE + '/page/chat', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-applet="chat"] [data-role="provider"] option', { state: 'attached', timeout: 30000 });
    const options = await page.$$eval('[data-role="provider"] option', os => os.map(o => o.textContent));
    log('the providers come from /etc/chat.json', options.includes('Ollama') && options.includes('Claude'), options.join());
    const toolsOffered = await page.evaluate(() => document.querySelector('[data-role="tools-wrap"]').hidden === false);
    log('the super-user is offered the site\'s tools', toolsOffered);

    // A reply, streamed, with its thinking.
    await page.click('[data-act="new"]');
    await page.waitForSelector('.chat-item.is-active', { timeout: 10000 });
    await ask('Reply with exactly one word: pong');
    await idle();
    log('a reply streams in', /pong/i.test(await lastReply()), await lastReply());
    log('the status says how long it took', /finished its reply/.test(await page.evaluate(() => [...document.querySelectorAll('.turn-row')].pop().textContent)), await page.textContent('[data-role="status"]'));
    log('the chat is named from the first message', /Reply with exactly one word/.test(await page.textContent('[data-role="title"]')));

    // A tool that only reads runs without asking.
    await ask('Call the tool site_files_list with path "~", then tell me how many entries it returned. Do not ask me anything.');
    await idle(180000);
    const readRow = await page.evaluate(() => [...document.querySelectorAll('.chat-tool')].map(t => t.querySelector('.tool-title').textContent + ':' + t.getAttribute('data-status')));
    log('a read-only tool runs without a question', readRow.some(r => /site_files_list|List a folder/.test(r) && /completed/.test(r)) && (await page.locator('.question').count()) === 0, readRow.join());

    // A tool that writes asks first.
    const stamp = 'chat-test-' + Date.now();
    await ask('Call the tool site_file_write to write the file ~/' + stamp + '.txt with the content "hello from the chat". Then say done.');
    const card = await page.waitForSelector('.question', { timeout: 120000 }).catch(() => null);
    log('a tool that writes asks first', !!card && /Allow/.test(await card.textContent()), card ? await card.textContent() : 'no question');
    if (card) {
        await page.click('.question .btn-primary');
        await idle(180000);
        /* The file is read from the instance's home folder, since the page's
           copy of the file tree learns of a write made on the server only
           when it loads again. */
        const written = process.env.PC_HOME_DIR
            ? (() => { try { return require('fs').readFileSync(require('path').join(process.env.PC_HOME_DIR, stamp + '.txt'), 'utf8'); } catch (err) { return null; } })()
            : await page.evaluate(p => pudlHost.fs.readText(p).catch(() => null), '~/' + stamp + '.txt');
        log('and runs once it is allowed', /hello from the chat/.test(written || ''), written);
        /* Deleting through the site asks the session for a passkey, which
           a test can't give, so the file goes from the instance's home
           folder when the test is told where that is. */
        if (process.env.PC_HOME_DIR) {
            try { require('fs').unlinkSync(require('path').join(process.env.PC_HOME_DIR, stamp + '.txt')); } catch (err) { }
        }
    }

    // An attachment.
    await page.setInputFiles('[data-role="files"]', { name: 'secret.txt', mimeType: 'text/plain', buffer: Buffer.from('The word is zebra.') });
    await page.waitForSelector('.attachments .attachment');
    await ask('What word is in the attached file? Answer with the word alone.');
    await idle();
    log('an attached file reaches the model', /zebra/i.test(await lastReply()), await lastReply());

    // The queue, then Stop.
    await ask('Count slowly from 1 to 200, one number per line.');
    await page.fill('.chat-text', 'Then say queued-ok.');
    await page.click('[data-role="send"]');
    await page.waitForSelector('[data-role="queue"]:not([hidden])', { timeout: 10000 }).catch(() => { });
    log('a message sent during a reply waits in the queue', /queued-ok/.test(await page.textContent('[data-role="queue-words"]')), await page.textContent('[data-role="queue"]'));
    await page.click('[data-act="stop"]');
    await idle(60000);
    log('Stop ends the reply and empties the queue', /You stopped the reply/.test(await page.evaluate(() => [...document.querySelectorAll('.turn-row')].pop().textContent)) && await page.isHidden('[data-role="queue"]'), await page.textContent('[data-role="status"]'));

    // The conversation comes back by its address.
    const id = await page.evaluate(() => { const a = document.querySelector('.chat-item.is-active'); return a ? a.getAttribute('data-open') : null; });
    await page.goto(BASE + '/page/chat?c=' + id, { waitUntil: 'load' });
    await page.waitForSelector('.chat-reply', { timeout: 30000 });
    log('a reload brings the conversation back', (await page.locator('.msg-row').count()) >= 6 && /zebra/i.test(await page.textContent('.chat-log')), await page.locator('.msg-row').count());
    /* Whether a model thinks aloud is its own choice for each reply, so
       this asks it of the conversation as a whole. */
    log('the model\'s thinking is kept and folded above its replies', (await page.locator('.chat-thought').count()) > 0);

    // Tidy up.
    await page.evaluate(id => pudlHost.fetch('/api/admin/chat/conversations/' + id, { method: 'DELETE' }), id);
    log('no page errors', errors.length === 0, errors.join(' | '));
    await browser.close();
    console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
