/* Browser checks for the terminal's scripting (Architecture/applet-platform-design.md,
   P1): the line parser's variables and operators, the Lua and POSIX shell
   interpreters, scripts by name from PATH, source and ~/.profile.

     PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... UI_SITE=http://localhost:8102 node Tools/test-terminal-scripting.js

   It types into the terminal on its own page and reads what the screen
   shows. Files go into ~ through the site's file system (js/sitefs.js), as
   a reader's own would. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.UI_SITE || 'http://localhost:8102';

let failures = 0;
function log(name, ok, detail) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + (detail || ''))); if (!ok) { failures++; } }

(async () => {
  const browser = await chromium.launch(Object.assign({ args: process.env.HOST_MAP ? ['--host-resolver-rules=' + process.env.HOST_MAP] : [] }, process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}));
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  let page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/page/terminal', { waitUntil: 'networkidle' });
  await page.waitForSelector('.xterm-helper-textarea', { timeout: 30000 });
  await page.waitForTimeout(800);

  /* The screen's text, all of its rows. */
  const screen = () => page.evaluate(() => [...document.querySelectorAll('.xterm-rows > div')].map(r => r.textContent.replace(/ /g, ' ').trimEnd()).join('\n'));
  let mark = 0;
  /* Types a line on a cleared screen, waits until the prompt is back and
     the screen has stopped changing, and gives what the line printed. */
  async function run(line, wait) {
    await page.focus('.xterm-helper-textarea');
    await page.keyboard.press('Control+L');
    await page.waitForTimeout(150);
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
    const deadline = Date.now() + (wait || 15000);
    let rows = [], at = -1, prev = '';
    while (Date.now() < deadline) {
      await page.waitForTimeout(200);
      rows = (await screen()).split('\n').filter(r => r.trim());
      at = rows.findIndex(r => r.includes(line));
      const last = rows[rows.length - 1] || '';
      if (at >= 0 && rows.length - 1 > at && /[$#]$/.test(last.trim())) {
        const now = rows.join('\n');
        if (now === prev) { break; }
        prev = now;
      }
    }
    return at < 0 ? '' : rows.slice(at + 1, rows.length - 1).join('\n');
  }
  const fsCall = (fn, args) => page.evaluate(([fn, args]) => {
    const F = window.pcSiteFs, home = F.home();
    if (fn === 'mkdir') { return F.mkdir(home, args[0], true); }
    return F.write(home, args[0], args[1], false).then(r => r.error || null);
  }, [fn, args]);

  // Variables and operators.
  log('export and $NAME', (await run('export GREETING=hello; echo $GREETING world')) === 'hello world');
  log('${NAME:-default} for an unset name', (await run('echo ${NOPE:-fallback}')) === 'fallback');
  log('&& runs on success, || on failure', (await run('true && echo yes || echo no; false && echo yes || echo no')) === 'yes\nno');
  log('$? is the last status', (await run('false; echo $?')) === '1');
  log('single quotes keep $ as it is', (await run("echo '$GREETING'")) === '$GREETING');
  log('a comment ends the line', (await run('echo shown # not this')) === 'shown');
  await run('echo first line > ~/in.txt');
  log('< feeds a file into a command', (await run('cat < ~/in.txt')) === 'first line');
  log('env lists HOME and PATH', /HOME=\/home\//.test(await run('env')) && /PATH=~\/bin:\/site\/bin/.test(await run('env')));
  log('cd - goes back', (await run('cd /site; cd ~; cd -; pwd')).trim() === '/site');

  // Lua.
  log('lua -e prints', (await run('lua -e "print(6 * 7)"', 30000)) === '42');
  log('Lua reads a pipe', (await run('echo abc | lua -e "print(io.read(\'a\'):upper())"', 30000)).trim() === 'ABC');
  log('Lua sees the variables', (await run('lua -e "print(os.getenv(\'GREETING\'))"', 30000)) === 'hello');
  log('Lua requires the bundled json module', (await run('lua -e "local j = require \'json\'; print(j.encode({a = 1}))"', 30000)) === '{"a":1}');

  // The POSIX shell.
  log('sh -c with a for loop', (await run('sh -c \'for i in 1 2 3; do printf "%s." "$i"; done; echo\'', 60000)) === '1.2.3.');
  log('the shell runs terminal commands', (await run("sh -c 'ls /site | head -n 1 | wc -l'", 60000)).trim() === '1');
  log('the shell does arithmetic and functions', (await run("sh -c 'sq() { echo $(( $1 * $1 )); }; sq 9'", 60000)) === '81');

  // Scripts by name from ~/bin, in each language.
  await fsCall('mkdir', ['bin']);
  await fsCall('write', ['bin/twice.sh', '#!/bin/sh\n# twice: says its argument twice\necho "$1 $1"\n']);
  await fsCall('write', ['bin/square.lua', '-- square: squares a number\nprint(math.tointeger(tonumber(arg[1]) ^ 2))\n']);
  await fsCall('write', ['bin/greet', '# greet: the terminal\'s own script\necho hi $1\n']);
  log('a .sh script runs by its name', (await run('twice ho', 60000)) === 'ho ho');
  log('a .lua script runs by its name', (await run('square 7', 30000)) === '49');
  log('the terminal\'s own script still runs', (await run('greet you')) === 'hi you');
  log('man reads a Lua script\'s comment', /squares a number/.test(await run('man square')));
  const helpText = (await run('help | grep square')) + '\n' + (await run('help | grep twice'));
  log('help gives a Lua script\'s summary', /square\.lua\s+squares a number/.test(helpText), helpText.split('\n').filter(l => /square|twice/.test(l)).join(' | '));
  log('help gives a shell script\'s summary without its name', /twice\.sh\s+says its argument twice/.test(helpText), helpText.split('\n').filter(l => /twice/.test(l)).join(' | '));
  log('which finds a script with its extension', /~\/bin\/square\.lua/.test(await run('which square')));

  // source and ~/.profile.
  await fsCall('write', ['setup.sh', 'export FROM_SOURCE=kept\ncd /site\n']);
  log('a sourced shell script leaves its variables and directory', (await run('source ~/setup.sh; echo $FROM_SOURCE; pwd', 60000)) === 'kept\n/site');
  await fsCall('write', ['.profile', 'export FROM_PROFILE=yes\n']);
  // A new tab has no snapshot to carry on from, so its terminal starts
  // afresh, with the same ~ (this browser's storage), and runs ~/.profile.
  page = await page.context().newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/page/terminal', { waitUntil: 'networkidle' });
  await page.waitForSelector('.xterm-helper-textarea', { timeout: 30000 });
  await page.waitForTimeout(4000);
  log('~/.profile runs as a terminal starts', (await run('echo $FROM_PROFILE', 30000)) === 'yes');

  log('no page errors', errors.length === 0, errors.join(' | '));
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
