const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');

const live = process.argv.includes('--live');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dub-bing-'));
const extension = path.join(root, 'extension');
fs.cpSync(path.resolve(__dirname, '../YouTube中文同传'), extension, {recursive: true});
const manifestPath = path.join(extension, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath));
// Pregrant the optional permission in this isolated test profile only.
manifest.permissions.push('scripting');
delete manifest.optional_permissions;
manifest.host_permissions.push('https://www.bing.com/*', 'https://cn.bing.com/*');
fs.writeFileSync(manifestPath, JSON.stringify(manifest));

const fixture = `<!doctype html><html lang="zh-CN"><head><title>Isolated Bing fixture</title></head><body>
<select id="tta_srcsl"><option value="en">English</option><option value="auto-detect">Auto</option></select>
<div id="tta_input_ta" contenteditable="true"></div>
<select id="tta_tgtsl"><option value="en">English</option><option value="zh-Hans">Chinese</option></select>
<button id="tta_clear">Clear</button><div id="tta_output_ta"></div><div id="tta_err" hidden>Error</div>
<script>
 const input=document.querySelector('#tta_input_ta'), output=document.querySelector('#tta_output_ta');
 document.querySelector('#tta_clear').onclick=()=>{input.textContent='';output.textContent=''};
 input.addEventListener('input',async()=>{
   output.textContent='...';
   const response=await fetch('/ttranslatev3',{method:'POST',body:input.innerText});
   if(response.ok) output.textContent=(await response.json())[0].translations[0].text;
 });
</script></body></html>`;

(async () => {
  const context = await chromium.launchPersistentContext(path.join(root, 'profile'), {
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run']
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    let attempts = 0, status = 200;
    if (!live) await context.route(/^https:\/\/(www|cn)\.bing\.com\//, route => {
      if (new URL(route.request().url()).pathname === '/ttranslatev3') {
        attempts++;
        assert.equal(route.request().postData(), 'A public caption.');
        return route.fulfill({status, json: status === 200 ? [{translations: [{text: '一条公开字幕。'}]}] : {ShowCaptcha: true}});
      }
      return route.fulfill({contentType: 'text/html; charset=utf-8', body: fixture});
    });
    await context.route('https://www.youtube.com/**', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Test page</title>'
    }));
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    await options.waitForFunction(() => document.querySelector('#provider').value === 'google-free');
    await options.locator('#provider').selectOption('bing');
    await options.locator('button[type=submit]').click();
    await options.waitForFunction(() => document.querySelector('#message').textContent.includes('已保存'));
    const opening = context.waitForEvent('page');
    await options.locator('#openBing').click();
    const bing = await opening;
    await bing.locator('#tta_input_ta').waitFor({timeout: 25000});
    await bing.waitForLoadState('load');
    if (!live && await bing.title() !== 'Isolated Bing fixture') {
      await bing.reload();
    }
    if (!live) assert.equal(await bing.title(), 'Isolated Bing fixture');
    if (live) await bing.waitForTimeout(800);
    const youtube = await context.newPage();
    await youtube.goto('https://www.youtube.com/watch?v=bing-test');
    const cdp = await context.newCDPSession(youtube);
    const contexts = [];
    cdp.on('Runtime.executionContextCreated', ({context}) => contexts.push(context));
    await cdp.send('Runtime.enable');
    const world = contexts.find(context => context.origin === `chrome-extension://${id}`);
    assert.ok(world, 'missing YouTube extension content context');
    const send = async message => (await cdp.send('Runtime.evaluate', {
      contextId: world.id, expression: `chrome.runtime.sendMessage(${JSON.stringify(message)})`,
      awaitPromise: true, returnByValue: true
    })).result.value;
    const translate = () => send({type: 'TRANSLATE', requestId: 'bing-test', language: 'en', text: 'A public caption.'});
    const first = await translate();
    if (live) {
      if (first.ok) assert.match(first.data.text, /\p{Script=Han}/u);
      console.log('LIVE', first.ok ? 'translation received from Bing' : first.error);
      return;
    }
    assert.ok(first.ok, first.error);
    assert.equal(first.data.text, '一条公开字幕。');
    assert.equal(attempts, 1);
    console.log('PASS Bing settings and a background tab translate through the website itself');
    status = 401;
    const blocked = await translate();
    assert.match(blocked.error, /Bing 要求验证/);
    const count = attempts;
    assert.match((await translate()).error, /Bing 要求验证/);
    assert.equal(attempts, count);
    status = 200;
    await send({type: 'RESUME_BING_TRANSLATOR'});
    assert.equal((await translate()).data.text, '一条公开字幕。');
    console.log('PASS Bing verification blocks further requests until the user retries');
    status = 429;
    assert.match((await translate()).error, /限流/);
    const limited = attempts;
    await send({type: 'RESUME_BING_TRANSLATOR'});
    assert.match((await translate()).error, /限流/);
    assert.equal(attempts, limited);
    console.log('PASS Manual verification retry preserves the rate-limit wait');
  } finally {
    await context.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
