const {chromium} = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const extension = path.resolve(__dirname, '../YouTube中文同传');
const artifacts = path.resolve(__dirname, '../dist');
const checks = [], errors = [];
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-dub-browser-'));
function pass(name) { checks.push(name); console.log('PASS', name); }
const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>body{margin:0;background:#0f0f0f;color:white;font:16px Roboto,Arial,sans-serif}#movie_player{position:relative;width:1100px;height:650px;margin:45px auto;background:linear-gradient(135deg,#39332e,#171717);overflow:hidden}.scene{padding:140px 60px}h1{font-size:48px}video{width:100%;height:100%;position:absolute;pointer-events:none}.ytp-caption-segment{display:none}.ytp-chrome-bottom{position:absolute;bottom:0;left:12px;right:12px;height:56px;background:linear-gradient(transparent,#0008);border-top:3px solid #f03}.ytp-right-controls{display:flex;float:right;height:48px}.ytp-right-controls-left,.ytp-right-controls-right{display:flex;align-items:center}.ytp-right-controls-left{background:#ffffff12;border-radius:24px}.ytp-button{width:48px;height:48px;background:transparent;border:0;color:#fff;font-size:23px;cursor:pointer;opacity:.95;display:inline-flex;align-items:center;justify-content:center}.ytp-button:hover{background:#ffffff12}.ytp-button:focus-visible{outline:2px solid white;outline-offset:-4px}.left{float:left;display:flex;align-items:center;gap:20px;height:48px;padding-left:10px;font-size:13px}</style></head><body>
<div id="movie_player" class="html5-video-player ytp-delhi-modern ytp-delhi-modern-icons"><video class="html5-main-video"></video><div class="scene"><small>LONG VIDEO TEST · 3 HOURS</small><h1>Learning through subtitles</h1><p>Progress-aware Chinese interpretation</p></div><span class="ytp-caption-segment"></span><div class="ytp-chrome-bottom"><div class="left"><span>▶</span><span>◖))</span><span>0:00 / 3:00:00</span></div><div class="ytp-right-controls"><div class="ytp-right-controls-left"><button class="ytp-button ytp-subtitles-button" aria-pressed="false" aria-label="字幕">▣</button><button class="ytp-button ytp-settings-button" aria-label="设置">⚙</button></div><div class="ytp-right-controls-right"><button class="ytp-button" aria-label="迷你播放器">▣</button><button class="ytp-button" aria-label="影院模式">▭</button><button class="ytp-button" aria-label="全屏">⛶</button></div></div></div></div>
<script>
window.ytInitialPlayerResponse={videoDetails:{videoId:'test-video-1',isLiveContent:false},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=test-video-1&lang=en',languageCode:'en',vssId:'.en',name:{simpleText:'English'},isTranslatable:true}]}}};
const v=document.querySelector('video');v.dataset.pos=0;v.dataset.paused='false';v.dataset.vol=.8;v.dataset.rate=1;
Object.defineProperties(v,{currentTime:{get:()=>Number(v.dataset.pos),set:n=>{v.dataset.pos=n}},paused:{get:()=>v.dataset.paused==='true'},volume:{get:()=>Number(v.dataset.vol),set:n=>{v.dataset.vol=n;v.dispatchEvent(new Event('volumechange'))}},playbackRate:{get:()=>Number(v.dataset.rate),set:n=>{v.dataset.rate=n;v.dispatchEvent(new Event('ratechange'))}},duration:{get:()=>10800},ended:{get:()=>false},seeking:{get:()=>false}});
v.pause=()=>{v.dataset.paused='true';v.dispatchEvent(new Event('pause'))};v.play=()=>{v.dataset.paused='false';v.dispatchEvent(new Event('play'));return Promise.resolve()};
document.addEventListener('click',function(e){if(e.target.classList.contains('ytp-subtitles-button'))e.target.setAttribute('aria-pressed',e.target.getAttribute('aria-pressed')==='true'?'false':'true')});
document.querySelector('#movie_player').getPlayerResponse=()=>window.ytInitialPlayerResponse;
window.jump=n=>{v.dispatchEvent(new Event('seeking'));v.dataset.pos=n;v.dispatchEvent(new Event('seeked'));v.dispatchEvent(new Event('timeupdate'))};
</script></body></html>`;
(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
    viewport: {width: 1280, height: 800},
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--disable-features=msEdgeSidebarV2']
  });
  try {
    await context.route('https://www.youtube.com/**', async route => {
      const u = new URL(route.request().url());
      if (u.pathname === '/api/timedtext') {
        if (u.searchParams.has('tlang')) return route.fulfill({status: 503, body: '', contentType: 'application/json'});
        const events = Array.from({length: 1800}, (_, i) => ({tStartMs: i * 6000, dDurationMs: 5800, segs: [{utf8: `Learning sentence ${i}.`}]}));
        return route.fulfill({body: JSON.stringify({events}), contentType: 'application/json'});
      }
      return route.fulfill({body: fixture, contentType: 'text/html'});
    });
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', {timeout: 20000});
    const extensionId = worker.url().split('/')[2];
    pass('Edge loaded the actual Manifest V3 extension and service worker');
    await worker.evaluate(async () => {
      await chrome.storage.local.set({settings:{...DubCore.defaults,autoStart:false,syncMode:'follow'}});
      globalThis.testTranslations = []; const native = fetch; globalThis.__nativeFetch = fetch;
      globalThis.fetch = async (url, options) => {
        if (String(url).startsWith('https://translate.googleapis.com/')) {
          const text = new URL(url).searchParams.get('q'); testTranslations.push(text);
          return new Response(JSON.stringify([[[`这是中文译文：${text.match(/\d+/)?.[0] || ''}`, text]]]), {headers: {'Content-Type': 'application/json'}});
        }
        return native(url, options);
      };
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    const cdp = await context.newCDPSession(page); await cdp.send('Runtime.enable');
    let isolated; const contexts = [];
    cdp.on('Runtime.executionContextCreated', ({context: c}) => { contexts.push(c); if (c.origin === `chrome-extension://${extensionId}` && c.auxData?.type === 'isolated') isolated = c.id; });
    await page.goto('https://www.youtube.com/watch?v=test-video-1');
    await page.waitForFunction(() => document.querySelector('#progress-dub'));
    assert.ok(isolated, 'Extension isolated context exists: ' + JSON.stringify(contexts));
    const isolatedEval = expression => cdp.send('Runtime.evaluate', {contextId: isolated, expression, returnByValue: true, awaitPromise: true}).then(r => {
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ':' + r.exceptionDetails.exception?.description);
      return r.result.value;
    });
    async function ui(fn,...args) {
      const tree=(await cdp.send('DOM.getDocument',{depth:-1,pierce:true})).root;
      function find(node) { if(node.attributes?.includes('progress-dub') && node.shadowRoots?.length)return node.shadowRoots[0]; for(const child of [...(node.children||[]),...(node.shadowRoots||[])]) {const hit=find(child);if(hit)return hit;} }
      const root=find(tree);assert.ok(root,'Closed settings shadow root exists');
      const object=(await cdp.send('DOM.resolveNode',{backendNodeId:root.backendNodeId})).object;
      const r=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:fn.toString(),arguments:args.map(value=>({value})),awaitPromise:true,returnByValue:true});
      if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
      return r.result.value;
    }
    assert.equal(await page.locator('#progress-dub-button').evaluate(el=>el.parentElement.className),'ytp-right-controls-left');
    assert.equal(await page.locator('#progress-dub-button').evaluate(el=>el.nextElementSibling.classList.contains('ytp-settings-button')),true);
    assert.equal(await page.locator('#progress-dub').count(),1);
    assert.equal(await page.locator('#progress-dub-button').isVisible(),true);
    assert.equal(await page.locator('#progress-dub-button svg').getAttribute('viewBox'),'6 6 24 24');
    pass('Modern nested YouTube controls mount one visible icon in the same pill immediately before the settings gear');
    assert.equal(await page.locator('#progress-dub-button').getAttribute('aria-expanded'),'false');
    const pagesBefore=context.pages().length;await page.locator('#progress-dub-button').click();
    assert.equal(await page.locator('#progress-dub-button').getAttribute('aria-expanded'),'true');
    assert.equal(context.pages().length,pagesBefore);
    const fields=await ui(function(){return [...this.querySelectorAll('input,select')].map(e=>e.name)});
    for(const key of ['voice','syncMode','rate','volume','originalVolume','track','lookahead','subtitle','bilingual','autoTranslate','autoStart','provider'])assert.ok(fields.includes(key));
    pass('White dubbing icon sits in the native YouTube control bar; its panel exposes all regular settings without a new tab');
    // Test transport and scheduler in a real loaded extension. Voice hardware is
    // substituted in this isolated context; native voice availability is recorded separately.
    const voices = await isolatedEval('speechSynthesis.getVoices().filter(v => /^zh/i.test(v.lang)).map(v=>v.name)');
    await isolatedEval(`globalThis.__dubTest={spoken:[],states:[]};
      {const v=document.querySelector('video');
        Object.defineProperties(v,{currentTime:{get:()=>Number(v.dataset.pos),set:n=>{v.dataset.pos=n}},paused:{get:()=>v.dataset.paused==='true'},volume:{get:()=>Number(v.dataset.vol),set:n=>{v.dataset.vol=n;v.dispatchEvent(new Event('volumechange'))}},playbackRate:{get:()=>Number(v.dataset.rate),set:n=>{v.dataset.rate=n;v.dispatchEvent(new Event('ratechange'))}},duration:{get:()=>10800},ended:{get:()=>v.dataset.ended==='true'},seeking:{get:()=>false}});
        __dubTest.pauseCalls=0;__dubTest.playCalls=0;
        v.pause=()=>{__dubTest.pauseCalls++;v.dataset.paused='true';v.dispatchEvent(new Event('pause'))};v.play=()=>{__dubTest.playCalls++;v.dataset.paused='false';v.dispatchEvent(new Event('play'));return Promise.resolve()};
      }
      DubSpeech.prototype.voices=function(){return [{name:'Test Chinese',lang:'zh-CN',localService:true}]};
      DubSpeech.prototype.speak=function(text,options={}){
        this.stop();const token=this.token;this.current={text,options,paused:false};this.lastVoice='Test Chinese';__dubTest.spoken.push(text);__dubTest.engine=this;
        options.onStart?.();this.onState(this.current);
        const finish=()=>{if(token!==this.token)return;this.current=null;this.onState(null);options.onDone?.('end')};__dubTest.finish=finish;
        if(!__dubTest.manual)setTimeout(finish,80);
      };
      document.querySelector('#progress-dub').__test=1;
      chrome.runtime.sendMessage({type:'GET_SETTINGS'}).then(r=>__dubTest.publicSettings=r.data);
    `);
    // Closed shadow roots intentionally prevent page scripts from accessing controls.
    // A real extension popup toggles the content script through its runtime channel.
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.evaluate(async () => {
      const tabs = await chrome.tabs.query({url: 'https://www.youtube.com/watch*'});
      await chrome.tabs.sendMessage(tabs[0].id, {type: 'TOGGLE'});
    });
    const getStatus = () => popup.evaluate(async () => {
      const tabs = await chrome.tabs.query({url: 'https://www.youtube.com/watch*'}); return chrome.tabs.sendMessage(tabs[0].id, {type: 'STATUS'});
    });
    const stableIcon=await page.locator('#progress-dub-button').evaluate(el=>({style:el.getAttribute('style'),html:el.innerHTML,title:el.title}));
    await page.waitForFunction(() => document.querySelector('.ytp-subtitles-button').getAttribute('aria-pressed') === 'true');
    for (let i = 0; i < 30; i++) { const s = await getStatus(); if (s.cues === 1800 && s.cached > 2) break; await page.waitForTimeout(250); }
    let s = await getStatus(); assert.equal(s.cues, 1800); assert.ok(s.cached > 2, JSON.stringify(s)); pass('Full 3-hour transcript loaded; rolling translations prepared without a remote dubbing server');
    assert.equal(s.language, 'en'); pass('YouTube auto-translation failure fell back to source captions plus per-segment translation');
    await page.waitForTimeout(150);
    assert.equal(await ui(function(){return Number(this.querySelector('[name=originalVolume]').value)}), .25);
    assert.ok((await isolatedEval('__dubTest.spoken')).length > 0); assert.equal(await page.evaluate(() => document.querySelector('video').volume), .25);
    pass('Original audio remains capped after narration instead of returning to loud volume between sentences');
    assert.deepEqual(await page.locator('#progress-dub-button').evaluate(el=>({style:el.getAttribute('style'),html:el.innerHTML,title:el.title})),stableIcon);
    assert.equal(await page.locator('#progress-dub-button').evaluate(el=>getComputedStyle(el).boxShadow),'none');
    assert.ok(await ui(function(){return this.querySelector('.panel').getBoundingClientRect().height<=520}));
    pass('Enabling narration keeps the control icon unchanged with no red bar, and the settings panel stays compact');
    await page.evaluate(()=>document.querySelector('video').pause());assert.equal(await page.evaluate(()=>document.querySelector('video').volume),.25);
    await page.evaluate(()=>document.querySelector('video').play());
    await ui(function(){const range=this.querySelector('[name=originalVolume]');range.value='.3';range.dispatchEvent(new Event('input',{bubbles:true}));const rate=this.querySelector('[name=rate]');rate.value='1.5';rate.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>document.querySelector('video').volume),.3);
    const persisted=await popup.evaluate(async()=> (await chrome.runtime.sendMessage({type:'GET_SETTINGS'})).data);
    assert.equal(persisted.originalVolume,.3);assert.equal(persisted.rate,1.5);
    pass('Inline audio settings update immediately and persist; pauses keep the same session volume cap');
    await page.keyboard.press('Escape');assert.equal(await page.locator('#progress-dub-button').getAttribute('aria-expanded'),'false');
    assert.equal(await getStatus().then(s=>s.active),true);pass('Escape closes the settings panel without stopping interpretation');
    const exposed = await isolatedEval('__dubTest.publicSettings'); assert.ok(!('apiKey' in exposed)); pass('Content-script settings omit API credentials');
    await page.evaluate(() => jump(7200)); await page.waitForTimeout(700);
    s = await getStatus(); assert.equal(s.time, 7200);
    assert.ok((await isolatedEval('__dubTest.spoken')).some(t => t.includes('1200'))); pass('Seeking to hour 2 immediately translated and narrated the new position');
    assert.equal(await page.evaluate(()=>document.querySelector('video').volume),.3);
    await page.evaluate(()=>document.querySelector('#movie_player').classList.add('ad-showing'));await page.waitForTimeout(300);
    assert.equal(await page.evaluate(()=>document.querySelector('video').volume),.3);
    await page.evaluate(()=>document.querySelector('#movie_player').classList.remove('ad-showing'));
    pass('Seeking and ad pauses keep the original audio capped throughout the active session');
    await page.evaluate(()=>{const bar=document.querySelector('.ytp-right-controls');bar.replaceWith(bar.cloneNode(true))});await page.waitForTimeout(1200);
    assert.equal(await page.locator('#progress-dub-button').count(),1);await page.locator('#progress-dub-button').click();
    assert.equal(await page.locator('#progress-dub-button').getAttribute('aria-expanded'),'true');
    await page.keyboard.press('Escape');pass('Replacing the YouTube control bar restores one working icon without duplicates');
    await page.evaluate(()=>{
      const bar=document.querySelector('.ytp-right-controls');
      document.querySelector('#movie_player').classList.remove('ytp-delhi-modern','ytp-delhi-modern-icons');
      for(const group of [...bar.children]){if(group.tagName==='DIV'){while(group.firstChild)bar.insertBefore(group.firstChild,group);group.remove()}}
    });await page.waitForTimeout(1200);
    assert.equal(await page.locator('#progress-dub-button').evaluate(el=>el.parentElement.className),'ytp-right-controls');
    assert.equal(await page.locator('#progress-dub-button svg').getAttribute('viewBox'),'0 0 36 36');
    assert.equal(await page.locator('#progress-dub-button').evaluate(el=>el.nextElementSibling.classList.contains('ytp-settings-button')),true);
    await page.locator('#progress-dub-button').click();assert.equal(await page.locator('#progress-dub-button').getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');
    pass('Switching to classic flat controls preserves a clickable icon immediately before the gear');
    await page.evaluate(()=>{
      const bar=document.querySelector('.ytp-right-controls'),left=document.createElement('div'),right=document.createElement('div');
      document.querySelector('#movie_player').classList.add('ytp-delhi-modern','ytp-delhi-modern-icons');
      left.className='ytp-right-controls-left';right.className='ytp-right-controls-right';
      for(const button of [...bar.children]) (button.classList.contains('ytp-subtitles-button')||button.classList.contains('ytp-settings-button')||button.id==='progress-dub-button'?left:right).append(button);
      bar.append(left,right);
      // A layout rebuild can keep the same parent but reorder its children.
      left.append(document.querySelector('#progress-dub-button'));
    });await page.waitForTimeout(1200);
    assert.equal(await page.locator('#progress-dub-button').evaluate(el=>el.nextElementSibling.classList.contains('ytp-settings-button')),true);
    assert.equal(await page.locator('#progress-dub-button').count(),1);assert.equal(await page.locator('#progress-dub').count(),1);
    assert.equal(await page.locator('#progress-dub-button svg').getAttribute('viewBox'),'6 6 24 24');
    pass('Moving existing buttons back to modern nested controls repairs the order without duplicate icons or panels');
    await page.evaluate(() => jump(0)); await page.waitForTimeout(250);
    assert.ok((await isolatedEval('__dubTest.spoken')).at(-1).includes('0')); pass('Rewind reused cached Chinese translation');
    const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.waitForSelector('#cacheStats'); await options.selectOption('#syncMode', 'complete'); await options.locator('button[type=submit]').click();
    await options.waitForFunction(() => document.querySelector('#message').textContent.includes('已保存'));
    await isolatedEval('__dubTest.manual=true;__dubTest.spoken=[];__dubTest.pauseCalls=0;__dubTest.playCalls=0');
    await page.evaluate(() => jump(60)); await page.waitForTimeout(650);
    s = await getStatus(); assert.equal(s.mode, 'complete'); assert.equal(await page.evaluate(() => document.querySelector('video').paused), false);
    assert.ok((await isolatedEval('__dubTest.spoken')).at(-1).endsWith('10'));
    await page.evaluate(()=>{const v=document.querySelector('video');for(let t=63;t<=78;t+=3){v.dataset.pos=t;v.dispatchEvent(new Event('timeupdate'))}});
    await page.waitForTimeout(350);s=await getStatus();assert.equal(s.queued,4);assert.equal(s.narrationTime,60);
    assert.equal((await isolatedEval('__dubTest.spoken')).length,1);assert.equal(await isolatedEval('__dubTest.pauseCalls'),0);
    assert.equal(await isolatedEval('__dubTest.playCalls'),0);
    pass('Complete reading keeps a slow sentence intact, queues every later sentence, and never pauses or resumes the video');
    await page.locator('#progress-dub-button').click();
    assert.ok(await ui(function(){return this.querySelector('.narration-info').textContent.includes('待读 4 句')}));
    await page.screenshot({path:path.join(artifacts,'完整朗读预览.png')});await page.keyboard.press('Escape');
    await ui(function(){const range=this.querySelector('[name=rate]');range.value='1.23';range.dispatchEvent(new Event('input',{bubbles:true}))});
    assert.equal(await isolatedEval('__dubTest.engine.current.options.rate'),1.23);
    assert.equal((await isolatedEval('__dubTest.spoken')).length,1);assert.equal((await getStatus()).queued,4);
    await page.evaluate(()=>document.querySelector('video').playbackRate=2);
    assert.equal(await isolatedEval('__dubTest.engine.current.options.rate'),2.46);
    s=await getStatus();assert.equal(s.effectiveRate,2.46);assert.equal(s.playbackRate,2);
    assert.ok(await ui(function(){return this.querySelector('.rate-info').textContent.includes('朗读 2.46×')}));
    await page.waitForTimeout(400);
    const rateSaved=await popup.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_SETTINGS'})).data.rate);assert.equal(rateSaved,1.23);
    await ui(function(){const range=this.querySelector('[name=rate]');range.value='1.5';range.dispatchEvent(new Event('input',{bubbles:true}))});
    assert.equal(await isolatedEval('__dubTest.engine.current.options.rate'),3);
    assert.equal((await isolatedEval('__dubTest.spoken')).length,1);assert.equal((await getStatus()).queued,4);
    assert.equal(await isolatedEval('__dubTest.pauseCalls'),0);assert.equal(await isolatedEval('__dubTest.playCalls'),0);
    pass('Complete-mode slider updates the current speech options without dropping its queue; base rate times video rate is shown and saved, including 3x');
    for(let i=0;i<4;i++){assert.ok((await isolatedEval('__dubTest.spoken')).at(-1).endsWith(String(10+i)));assert.equal(await isolatedEval('__dubTest.engine.current.options.rate'),3);await isolatedEval('__dubTest.finish()');await page.waitForTimeout(80)}
    assert.equal((await getStatus()).queued,0);
    assert.deepEqual((await isolatedEval('__dubTest.spoken')).map(t=>Number(t.split('：').at(-1))),[10,11,12,13]);
    await page.evaluate(()=>document.querySelector('video').playbackRate=1);
    pass('Only an end callback advances complete narration; queued sentences are read in subtitle order without omissions');
    await page.evaluate(()=>jump(120));await page.waitForTimeout(300);s=await getStatus();assert.equal(s.narrationTime,120);assert.equal(s.queued,1);
    pass('Explicit seeking discards the old complete-reading backlog and starts at the new position');
    await page.evaluate(()=>{const v=document.querySelector('video');for(const t of [123,126]){v.dataset.pos=t;v.dispatchEvent(new Event('timeupdate'))}v.dataset.ended='true';v.dataset.paused='true';v.dispatchEvent(new Event('pause'));v.dispatchEvent(new Event('ended'))});
    await isolatedEval('__dubTest.finish()');await page.waitForTimeout(150);
    assert.ok((await isolatedEval('__dubTest.spoken')).at(-1).endsWith('21'));
    await isolatedEval('__dubTest.finish()');await page.waitForTimeout(150);assert.equal((await getStatus()).queued,0);
    assert.equal(await isolatedEval('__dubTest.pauseCalls'),0);assert.equal(await isolatedEval('__dubTest.playCalls'),0);
    assert.equal(await page.evaluate(()=>document.querySelector('video').paused),true);
    pass('Video ending does not cut off complete reading; remaining sentences drain without restarting video playback');
    await isolatedEval('__dubTest.manual=false');
    await page.evaluate(()=>{const v=document.querySelector('video');v.dataset.ended='false';v.dataset.paused='false'});
    await popup.evaluate(async () => {
      const tabs = await chrome.tabs.query({url: 'https://www.youtube.com/watch*'}); await chrome.tabs.sendMessage(tabs[0].id, {type: 'TOGGLE'});
    });
    assert.equal(await page.evaluate(() => document.querySelector('.ytp-subtitles-button').getAttribute('aria-pressed')), 'false');
    s = await getStatus(); assert.equal(s.active, false); assert.equal(await page.evaluate(() => document.querySelector('video').volume), .8);
    pass('Stop cancels work and restores both CC and original volume');
    await page.waitForTimeout(300);
    const stored = await popup.evaluate(async () => (await chrome.runtime.sendMessage({type:'CACHE_GET',videoId:'test-video-1'})).data);
    assert.ok(Object.keys(stored).length > 2); pass('Prepared translations were persisted through the extension worker');
    // Exercise the actual Edge voice without making audible sound in the user's room.
    await options.evaluate(() => {
      globalThis.__nativeEvents=[];
      const native=speechSynthesis.speak.bind(speechSynthesis);
      speechSynthesis.speak=u=>{const a=u.onstart,b=u.onend,e=u.onerror;u.onstart=x=>{__nativeEvents.push('start');a?.(x)};u.onend=x=>{__nativeEvents.push('end');b?.(x)};u.onerror=x=>{__nativeEvents.push('error:'+x.error);e?.(x)};native(u)};
      document.querySelector('#volume').value='0';document.querySelector('#rate').value='2.5';
    });
    await options.locator('#testVoice').click();
    let nativeVoiceCompleted = false;
    try { await options.waitForFunction(() => __nativeEvents.includes('end'), undefined, {timeout: 18000}); nativeVoiceCompleted = true; } catch {}
    const nativeVoiceEvents = await options.evaluate(() => __nativeEvents);
    if (nativeVoiceCompleted) pass('Actual Edge Chinese speech synthesis produced start/end events (muted smoke test)');
    const googleProbe = await worker.evaluate(async () => {
      try { const r=await __nativeFetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=Hello%20world',{signal:AbortSignal.timeout(10000)});const body=await r.json();return {ok:r.ok,status:r.status,text:body?.[0]?.[0]?.[0]}; }
      catch(e) { return {ok:false,error:e.message}; }
    });
    if (googleProbe.ok && googleProbe.text) pass('Live Google translation endpoint returned Chinese for a non-user sample');
    await options.locator('#reset').click(); assert.equal(await options.locator('#originalVolume').inputValue(), '0.25');
    await options.selectOption('#syncMode', 'follow'); await options.locator('button[type=submit]').click();
    await options.waitForFunction(async () => (await chrome.runtime.sendMessage({type:'GET_SETTINGS'})).data.originalVolume === .25);
    await page.bringToFront();
    await popup.evaluate(async () => {const tabs=await chrome.tabs.query({url:'https://www.youtube.com/watch*'});await chrome.tabs.sendMessage(tabs[0].id,{type:'TOGGLE'})});
    await page.evaluate(() => jump(66)); await page.waitForTimeout(250);
    await page.locator('#progress-dub-button').click();
    await page.screenshot({path: path.join(artifacts, '播放器预览.png')});
    await page.keyboard.press('Escape');await page.screenshot({path:path.join(artifacts,'控制栏图标预览.png')});
    await options.reload(); await options.waitForFunction(() => document.querySelector('#voiceHint').textContent.includes('中文声音'));
    await options.addStyleTag({content: '.sticky{position:static}'});
    await options.screenshot({path: path.join(artifacts, '设置预览.png'), fullPage: true});
    assert.deepEqual(errors, []); pass('No unhandled page exceptions during browser integration checks');
    fs.writeFileSync(path.join(artifacts, 'browser-test-report.json'), JSON.stringify({browser: await context.browser().version(), extensionId, nativeChineseVoices: voices, nativeVoiceCompleted, nativeVoiceEvents, googleProbe, checks, errors, fixture: true, voiceSubstituted: true}, null, 2));
  } finally { await context.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
