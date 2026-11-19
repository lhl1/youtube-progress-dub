const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');

const extension = path.resolve(__dirname, '../YouTube中文同传');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dub-providers-'));
const fixture = id => `<div id="movie_player"><video class="html5-main-video"></video><div class="ytp-right-controls"><button class="ytp-subtitles-button" aria-pressed="false">CC</button></div></div>
<script>window.ytInitialPlayerResponse = ${JSON.stringify({videoDetails: {videoId: id}, captions: {
  playerCaptionsTracklistRenderer: {captionTracks: [{
    baseUrl: `https://www.youtube.com/api/timedtext?v=${id}&lang=en&kind=asr`,
    languageCode: 'en', kind: 'asr', vssId: 'a.en', isTranslatable: true
  }]}
}})};</script>`;

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run']
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async () => {
      const native = fetch;
      globalThis.googleCalls = 0;
      globalThis.aliyunCalls = [];
      globalThis.baiduCalls = [];
      globalThis.batchCalls = [];
      globalThis.deeplCalls = [];
      const originalContains = chrome.permissions.contains.bind(chrome.permissions);
      const fixtureOrigins = ['https://mt.aliyuncs.com/*', 'https://fanyi-api.baidu.com/*', 'https://api-free.deepl.com/*'];
      chrome.permissions.contains = details => details.origins?.some(origin => fixtureOrigins.includes(origin))
        ? Promise.resolve(true) : originalContains(details);
      globalThis.fetch = async (url, options) => {
        if (String(url).startsWith('https://translate.googleapis.com/translate_a/t?')) {
          const texts = new URLSearchParams(options.body).getAll('q');
          batchCalls.push(texts);
          return Response.json(texts.map((text, index) => `批量译文 ${index + 1}`));
        }
        if (String(url).startsWith('https://translate.googleapis.com/')) {
          globalThis.googleCalls++;
          return new Response('', {status: 429, headers: {'Retry-After': '45'}});
        }
        if (url === 'https://mt.aliyuncs.com/') {
          aliyunCalls.push({body: Object.fromEntries(new URLSearchParams(options.body)), action: options.headers['x-acs-action']});
          return Response.json({Code: 200, Data: {Translated: '来自阿里云的译文。'}});
        }
        if (url === 'https://fanyi-api.baidu.com/api/trans/vip/translate') {
          baiduCalls.push(Object.fromEntries(new URLSearchParams(options.body)));
          return Response.json({trans_result: [{dst: '这是百度通用文本翻译。'}]});
        }
        if (url === 'https://api-free.deepl.com/v2/translate') {
          const request = JSON.parse(options.body);
          deeplCalls.push(request);
          return Response.json({translations: request.text.map(() => ({text: 'DeepL 译文。'}))});
        }
        return native(url, options);
      };
    });
    const captionRequests = [];
    await context.route('https://www.youtube.com/**', route => {
      const url = new URL(route.request().url());
      const id = url.searchParams.get('v');
      if (url.pathname !== '/api/timedtext') return route.fulfill({contentType: 'text/html', body: fixture(id)});
      const translated = url.searchParams.get('tlang') === 'zh-Hans';
      captionRequests.push({id, translated});
      const events = id === 'unavailable' && translated ? [] : [{
        tStartMs: 0, dDurationMs: 5000, segs: [{utf8: translated ? '这是站内译文。' : 'This is a complete sentence.'}]
      }];
      if (['batch-selected', 'deepl-selected'].includes(id)) {
        events.push({tStartMs: 12000, dDurationMs: 5000, segs: [{utf8: 'A second independent sentence.'}]});
      }
      return route.fulfill({json: {events}});
    });
    async function check(id, provider, ready) {
      if (provider) await worker.evaluate(async provider => {
        await chrome.storage.local.set({settings: {...DubCore.defaults, autoStart: true, provider}});
      }, provider);
      const page = await context.newPage();
      try {
        await page.goto(`https://www.youtube.com/watch?v=${id}`);
        let state;
        for (let i = 0; i < 120; i++) {
          state = await worker.evaluate(async id => {
            const tab = (await chrome.tabs.query({url: `https://www.youtube.com/watch?v=${id}` }))[0];
            return tab && chrome.tabs.sendMessage(tab.id, {type: 'STATUS'}).catch(() => null);
          }, id);
          if (state && ready(state)) return state;
          await page.waitForTimeout(50);
        }
        assert.fail(JSON.stringify(state));
      } finally {
        await page.close();
      }
    }
    const first = await check('youtube-first', 'youtube', state => state.language === 'zh-Hans');
    assert.equal(first.automatic, true);
    assert.equal(await worker.evaluate(() => googleCalls), 0);
    assert.ok(captionRequests.some(r => r.id === 'youtube-first' && r.translated));
    console.log('PASS YouTube-only mode reads translated ASR without Google');
    const batched = await check('batch-selected', 'google-batch', state => state.readySeconds >= 16);
    assert.equal(batched.cues, 2);
    const batchCalls = await worker.evaluate(() => globalThis.batchCalls);
    assert.deepEqual(batchCalls, [['This is a complete sentence.', 'A second independent sentence.']]);
    console.log('PASS Google batches two separate ASR cues and buffers both translations');
    const fallback = await check('google-limited', 'google-free', state => state.language === 'zh-Hans');
    assert.equal(fallback.automatic, true);
    assert.ok(captionRequests.some(r => r.id === 'google-limited' && !r.translated));
    assert.ok(captionRequests.some(r => r.id === 'google-limited' && r.translated));
    const googleCallsAfterFallback = await worker.evaluate(() => googleCalls);
    assert.ok(googleCallsAfterFallback > 0);
    console.log('PASS Google 429 recovers via the YouTube caption track');
    await check('unavailable', 'youtube', state => /未取得 YouTube 中文译轨/.test(state.error));
    assert.equal(await worker.evaluate(() => googleCalls), googleCallsAfterFallback);
    console.log('PASS Missing YouTube translation gives a clear error without using external services');
    const options = await context.newPage();
    const extensionId = new URL(worker.url()).host;
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.waitForFunction(() => document.querySelector('#provider').value === 'youtube');
    await options.evaluate(() => {
      const request = chrome.permissions.request.bind(chrome.permissions);
      const fixtureOrigins = ['https://mt.aliyuncs.com/*', 'https://fanyi-api.baidu.com/*', 'https://api-free.deepl.com/*'];
      chrome.permissions.request = details => details.origins?.some(origin => fixtureOrigins.includes(origin))
        ? Promise.resolve(true) : request(details);
    });
    await options.locator('#provider').selectOption('aliyun');
    await options.locator('#aliyunAccessKeyId').fill('ExampleId');
    await options.locator('#aliyunAccessKeySecret').fill('ExampleSecret');
    await options.locator('button[type=submit]').click();
    await options.waitForFunction(() => document.querySelector('#message').textContent.includes('已保存'));
    const ali = await check('aliyun-selected', null, state => state.readySeconds > 0);
    assert.equal(ali.settings.provider, 'aliyun');
    assert.equal(ali.settings.aliyunConfigured, true);
    assert.ok(!ali.settings.aliyunAccessKeyId && !ali.settings.aliyunAccessKeySecret);
    const calls = await worker.evaluate(() => aliyunCalls);
    assert.ok(calls.some(call => call.action === 'TranslateGeneral' && call.body.TargetLanguage === 'zh' &&
      call.body.SourceText.includes('This is a complete sentence.')));
    assert.equal(await worker.evaluate(() => googleCalls), googleCallsAfterFallback);
    console.log('PASS Aliyun settings save through the UI and the player receives the official API fixture translation');
    await options.locator('#provider').selectOption('baidu');
    await options.locator('#baiduAppId').fill('12345');
    await options.locator('#baiduSecret').fill('FixtureSigningSecret');
    await options.locator('button[type=submit]').click();
    await options.waitForFunction(() => document.querySelector('#message').textContent.includes('已保存'));
    const baidu = await check('baidu-selected', null, state => state.readySeconds > 0);
    assert.equal(baidu.settings.provider, 'baidu');
    assert.equal(baidu.settings.baiduConfigured, true);
    assert.ok(!baidu.settings.baiduAppId && !baidu.settings.baiduSecret);
    const baiduRequests = await worker.evaluate(() => baiduCalls);
    assert.ok(baiduRequests.some(call => call.to === 'zh' && call.appid === '12345' &&
      /^[0-9a-f]{32}$/.test(call.sign) && call.q.includes('This is a complete sentence.')));
    assert.equal(await worker.evaluate(() => googleCalls), googleCallsAfterFallback);
    console.log('PASS Baidu settings save through the UI and the player receives a signed API fixture translation');
    await options.locator('#provider').selectOption('deepl');
    await options.locator('#deeplKey').fill('ExampleKey:fx');
    await options.locator('button[type=submit]').click();
    await options.waitForFunction(() => document.querySelector('#message').textContent.includes('已保存'));
    await options.close();
    const deepl = await check('deepl-selected', null, state => state.readySeconds >= 16);
    assert.equal(deepl.settings.deeplConfigured, true);
    assert.ok(!deepl.settings.deeplKey);
    assert.equal(deepl.cues, 2);
    const deeplCalls = await worker.evaluate(() => globalThis.deeplCalls);
    assert.deepEqual(deeplCalls, [{target_lang: 'ZH-HANS', text: ['This is a complete sentence.', 'A second independent sentence.']}]);
    console.log('PASS DeepL settings save and the player receives both rows from the Free endpoint');
  } finally {
    await context.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
