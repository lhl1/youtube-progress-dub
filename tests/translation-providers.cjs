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
      globalThis.fetch = async (url, options) => {
        if (String(url).startsWith('https://translate.googleapis.com/')) {
          globalThis.googleCalls++;
          return new Response('', {status: 429, headers: {'Retry-After': '45'}});
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
      return route.fulfill({json: {events}});
    });
    async function check(id, provider, ready) {
      await worker.evaluate(async provider => {
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
  } finally {
    await context.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
