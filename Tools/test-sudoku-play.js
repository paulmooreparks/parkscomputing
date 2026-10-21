/* Sudoku played from outside (pudl-sudoku 1.1.0, the broker's live
   handlers in js/applet-actions.js, Architecture/chat-design.md): on the
   windowed desktop, the actions new, board and enter open the board the
   reader watches and play on it, a solver call checks a right digit from
   a wrong one, and then the chat's model is asked to start a game and make
   one move, and asked about the chat itself through chat_info. It needs a
   provider that answers and a super-user's sign-in link, as test-chat.js.

     PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... UI_SITE=http://localhost:8102 \
       PC_SIGNIN_LINK=<account-link output> node Tools/test-sudoku-play.js */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.UI_SITE || 'http://localhost:8102';
const LINK = process.env.PC_SIGNIN_LINK;

let failures = 0;
function log(name, ok, detail) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + String(detail || '').slice(0, 400))); if (!ok) { failures++; } }

(async () => {
    if (!LINK) { console.error('PC_SIGNIN_LINK is needed.'); process.exit(2); }
    const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    /* A passkey request goes to a virtual authenticator, not Windows Hello. */
    await require('./test-no-passkey')(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const run = (ref, input) => page.evaluate(([r, i]) => pudlHost.actions.run(r, i), [ref, input]);

    await page.goto(LINK);
    await page.locator('form[method="post"] button', { hasText: 'Sign in' }).last().click();
    await page.waitForTimeout(2500);
    await page.goto(BASE + '/?view=window', { waitUntil: 'networkidle' });

    // The actions, run through the page's broker as the chat runs them.
    log('Sudoku is not open yet', (await page.locator('[data-applet="sudoku"]').count()) === 0);
    const fresh = await run('parks.sudoku/new@1', { difficulty: 'easy' }).catch(e => ({ error: e.message }));
    log('new opens Sudoku on the desktop', (await page.locator('[data-applet="sudoku"]').count()) === 1, JSON.stringify(fresh).slice(0, 200));
    log('and gives an easy board', fresh.difficulty === 'easy' && /^[1-9.]{81}$/.test(fresh.puzzle || '') && fresh.empty === 30 && fresh.rows && fresh.rows.length === 9, JSON.stringify(fresh).slice(0, 200));
    const board = await run('parks.sudoku/board@1', {}).catch(e => ({ error: e.message }));
    log('board gives the same board', board.puzzle === fresh.puzzle && board.board === fresh.board, JSON.stringify(board).slice(0, 200));
    const solved = await run('parks.sudoku/solve@1', { puzzle: fresh.puzzle });
    log('the solver agrees the puzzle has one solution', solved.solutions === 'one' && /^[1-9]{81}$/.test(solved.solution || ''), JSON.stringify(solved).slice(0, 120));
    const at = fresh.puzzle.indexOf('.'), row = Math.floor(at / 9) + 1, col = at % 9 + 1;
    const right = +solved.solution.charAt(at), wrong = right === 9 ? 1 : right + 1;
    const marked = await run('parks.sudoku/enter@1', { entries: [{ row, col, marks: [right, wrong] }] });
    log('pencil marks go on a cell', marked.entries[0].result === 'marked' && marked.marks.some(m => m.row === row && m.col === col && m.digits.length === 2), JSON.stringify(marked.entries));
    const bad = await run('parks.sudoku/enter@1', { entries: [{ row, col, digit: wrong }] });
    log('a wrong digit is marked wrong and left', bad.entries[0].result === 'wrong' && bad.wrong.some(w => w.row === row && w.col === col), JSON.stringify(bad.entries) + ' ' + JSON.stringify(bad.wrong));
    const good = await run('parks.sudoku/enter@1', { entries: [{ row, col, digit: right }] });
    log('the right digit is placed and the board has one fewer empty cell', good.entries[0].result === 'placed' && good.empty === 29 && good.wrong.length === 0, JSON.stringify(good.entries) + ' empty ' + good.empty);
    const onBoard = await page.evaluate(([r, c]) => document.querySelector('[data-applet="sudoku"] [data-cell="' + (r - 1) + '-' + (c - 1) + '"]').textContent.trim(), [row, col]);
    log('and the reader sees it on the board', onBoard.indexOf(String(right)) >= 0, onBoard);
    const clue = fresh.puzzle.search(/[1-9]/), clueRow = Math.floor(clue / 9) + 1, clueCol = clue % 9 + 1;
    const refused = await run('parks.sudoku/enter@1', { entries: [{ row: clueRow, col: clueCol, digit: 5 }] });
    log('a clue cannot be changed', refused.entries[0].result === 'clue', JSON.stringify(refused.entries));
    await page.evaluate(() => { document.querySelector('[data-applet="sudoku"]').closest('.win').querySelector('[data-win-action="close"]').click(); });
    await page.waitForTimeout(500);
    const gone = await run('parks.sudoku/board@1', {}).then(() => null, e => e.message);
    log('with the window closed, board says Sudoku is not open', /not open/.test(gone || ''), gone);

    // The chat's model starts a game and makes one move, and knows itself.
    await page.locator('.menubar-title', { hasText: /^Applets$/ }).first().click();
    await page.locator('[role="menuitem"]', { hasText: /^Chat$/ }).first().click();
    await page.waitForFunction(() => { const c = window.pudlCommands && document.querySelector('.pudl-chat') && window.pudlCommands.list(document.querySelector('.pudl-chat')).find(c => c.id === 'provider'); return c && c.items && c.items.length; }, null, { timeout: 30000 });
    const idle = (ms) => page.waitForFunction(() => !document.querySelector('.pudl-chat').classList.contains('is-working'), null, { timeout: ms || 180000 });
    const lastReply = () => page.evaluate(() => { const r = [...document.querySelectorAll('.chat-reply .msg-text')].pop(); return r ? r.textContent : ''; });
    async function ask(text) {
        await page.fill('.pudl-chat .chat-text', text);
        await page.press('.pudl-chat .chat-text', 'Enter');
        await page.waitForFunction(() => document.querySelector('.pudl-chat').classList.contains('is-working'), null, { timeout: 15000 }).catch(() => { });
    }
    // The settings open as a window of their own, GK's way.
    await page.locator('.menubar-title', { hasText: /^File$/ }).first().click();
    await page.locator('[role="menuitem"]', { hasText: 'Chat settings' }).first().click();
    await page.waitForSelector('.chat-settings-view .chat-provider', { timeout: 15000 }).catch(() => { });
    const settingsWin = await page.evaluate(() => {
        const v = document.querySelector('.chat-settings-view'); if (!v) { return null; }
        const win = v.closest('.win'), r = v.getBoundingClientRect(), t = v.querySelector('.chat-settings-tabs').getBoundingClientRect();
        return { inWindow: !!win, title: win ? win.textContent.slice(0, 60) : '', tabsAtTop: Math.abs(t.top - r.top) < 2, tabsFullWidth: Math.abs(t.width - r.width) < 2, heading: !!v.querySelector('h2') };
    });
    log('the settings open in a window of their own', !!settingsWin && settingsWin.inWindow && /Chat Settings/.test(settingsWin.title), JSON.stringify(settingsWin));
    log('with the tab strip at the very top, across the whole width, and no heading', !!settingsWin && settingsWin.tabsAtTop && settingsWin.tabsFullWidth && !settingsWin.heading, JSON.stringify(settingsWin));
    await page.click('.chat-settings-view [data-s="cancel"]');
    await page.waitForTimeout(500);
    log('Cancel closes the settings window', (await page.locator('.chat-settings-view').count()) === 0);
    await page.click('.pudl-chat [data-act="new"]');
    await page.waitForSelector('.pudl-chat .chat-item.is-active', { state: 'attached', timeout: 30000 }).catch(async () => { await page.screenshot({ path: 'sudoku-play-chat.png' }); });
    await ask('Which models does this chat offer, and which provider and model is this conversation using? Answer from chat_info, in two lines.');
    await idle();
    const infoRows = await page.evaluate(() => [...document.querySelectorAll('.chat-tool')].map(t => t.querySelector('.tool-title').textContent + ':' + t.getAttribute('data-status')));
    log('the model asks the chat about itself without a permission question', infoRows.some(r => /Ask the chat about itself:completed/.test(r)) && (await page.locator('.question').count()) === 0, infoRows.join());
    log('and names a provider the chat has', /Ollama|Claude/i.test(await lastReply()), await lastReply());

    await ask('Start a new easy Sudoku game with parks.sudoku/new@1, then enter one digit you are sure of into one empty cell with parks.sudoku/enter@1 (rows and columns count from 1), and stop after that one move. Say which cell and digit you entered.');
    /* The reply runs for a while: every question it asks is allowed, for
       good, as it comes, until the reply ends or five minutes pass. */
    for (const end = Date.now() + 300000; Date.now() < end;) {
        const working = await page.evaluate(() => document.querySelector('.pudl-chat').classList.contains('is-working'));
        if (!working) { break; }
        const question = page.locator('.pudl-chat .question button').first();
        if (await question.count()) {
            const always = page.locator('.pudl-chat .question button', { hasText: /always/i }).first();
            if (await always.count()) { await always.click(); } else { await page.click('.pudl-chat .question .btn-primary'); }
        }
        await page.waitForTimeout(1000);
    }
    const stillWorking = await page.evaluate(() => document.querySelector('.pudl-chat').classList.contains('is-working'));
    if (stillWorking) { await page.screenshot({ path: 'sudoku-play-stuck.png' }); await page.click('.pudl-chat [data-command="stop"]').catch(() => { }); await idle(60000).catch(() => { }); }
    log('the model\'s game ends within five minutes', !stillWorking, await lastReply());
    const playRows = await page.evaluate(() => [...document.querySelectorAll('.chat-tool')].map(t => t.querySelector('.tool-title').textContent + ':' + t.getAttribute('data-status')));
    log('the model opens a game through the chat', (await page.locator('[data-applet="sudoku"]').count()) === 1 && playRows.some(r => /new@1 \(on your desktop\):completed/.test(r)), playRows.join());
    log('and makes a move on the board', playRows.some(r => /enter@1 \(on your desktop\):completed/.test(r)), playRows.join());
    const after = await run('parks.sudoku/board@1', {}).catch(e => ({ error: e.message }));
    log('the board shows one entry', after.empty === 29 || (after.empty === 30 && after.wrong.length === 0 && after.marks.length > 0), JSON.stringify({ empty: after.empty, wrong: after.wrong, marks: after.marks }).slice(0, 200));

    const id = await page.evaluate(() => document.querySelector('.pudl-chat .chat-item.is-active').getAttribute('data-open'));
    await page.evaluate(id => pudlHost.fetch('/api/admin/chat/conversations/' + id, { method: 'DELETE' }), id);
    log('no page errors', errors.length === 0, errors.join(' | '));
    await browser.close();
    console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
