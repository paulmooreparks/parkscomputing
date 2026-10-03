const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.UI_SITE || 'http://localhost';
(async () => {
 const browser = await chromium.launch();
 try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  for (const key of ['settings', 'settings-2', 'barcodes', 'barcode-scanner', 'dice']) {
   const response = await page.request.get(origin + '/window/' + key);
   assert.equal(response.status(), 200);
   assert.match(await response.text(), /data-win-size="content"/);
  }
  const html = 'excel-employee-capacity-spreadsheet';
  await page.goto(origin + '/?view=window&open=' + html + ',settings&top=settings&p.' + html + '=floating:0.02,0.03,0.55,0.85&p.settings=floating:0.65,0.05,0.3,0.7');
  await page.locator('[data-win="settings"][data-win-size="content"]').waitFor();
  const frame = page.frameLocator('[data-win="' + html + '"] iframe');
  await frame.locator('body').waitFor();
  await page.waitForFunction(() => window.pudlWindows?.state().top === 'settings');
  await frame.locator('body').click({ position: { x: 25, y: 80 } });
  await page.waitForFunction(key => window.pudlWindows.state().top === key, html);
  // Repeat to verify activation is not a one-time frame-load effect.
  await page.evaluate(() => window.pudlWindows.raise('settings'));
  await frame.locator('body').click({ position: { x: 25, y: 80 } });
  await page.waitForFunction(key => window.pudlWindows.state().top === key, html);
  // An input must receive its first click and retain typed text after activation.
  await frame.locator('body').evaluate(body => {
   const input = document.createElement('input');
   input.id = 'activation-check';
   input.style.cssText = 'position:fixed;left:25px;top:80px;z-index:99999';
   body.appendChild(input);
  });
  await page.evaluate(() => window.pudlWindows.raise('settings'));
  await frame.locator('#activation-check').click();
  await page.keyboard.type('still focused');
  assert.equal(await frame.locator('#activation-check').inputValue(), 'still focused');
  assert.equal(await page.evaluate(() => window.pudlWindows.state().top), html);
  assert.deepEqual(errors, []);
  console.log('PASS: applet-owned sizing on initial and fetched windows, numbered instances, repeated HTML frame activation, and input focus.');
 } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
