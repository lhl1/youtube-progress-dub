const {chromium} = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const sample = require('./fixtures/continuity.cjs');
const C = require('../YouTube中文同传/core.js');
const root = path.resolve(__dirname, '..'), extension = path.join(root, 'YouTube中文同传'), checks = [], errors = [];
const grouped = C.groupCues(sample.rows);
function pass(message) { checks.push(message); console.log('PASS', message); }
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#111;color:#fff;font-family:Arial}#movie_player{position:relative;width:1100px;height:620px;margin:20px auto;background:linear-gradient(135deg,#19372b,#314450)}.scene{padding:120px 100px;font-size:30px;color:#d6ece2}.ytp-right-controls{position:absolute;bottom:0;right:0;display:flex;height:48px}.ytp-button{width:48px;height:48px;background:none;border:0;color:white}</style></head>
<body><div id="movie_player"><div class="scene">连续字幕 · 完整语义与朗读衔接</div><video class="html5-main-video" data-pos="1504" data-paused="false"></video><div class="ytp-right-controls"><button class="ytp-button ytp-subtitles-button" aria-pressed="false">CC</button><button class="ytp-button ytp-settings-button">⚙</button></div></div>
<script>const v=document.querySelector('video');v.volume=.8;window.ytInitialPlayerResponse={videoDetails:{videoId:'continuity-test',isLiveContent:false},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=continuity-test&lang=en&kind=asr',languageCode:'en',vssId:'a.en',kind:'asr',name:{simpleText:'English (auto-generated)'},isTranslatable:true}]}}};document.addEventListener('click',e=>{if(e.target.classList.contains('ytp-subtitles-button'))e.target.setAttribute('aria-pressed',e.target.getAttribute('aria-pressed')==='true'?'false':'true')});</script></body></html>`;
(async () => {
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'dub-continuity-')), {
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
    viewport: {width:1200,height:700}, ignoreDefaultArgs:['--disable-extensions'],
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run']
  });
  try {
    await context.route('https://www.youtube.com/**', r => r.fulfill(r.request().url().includes('/api/timedtext') ? {
      contentType:'application/json', body:JSON.stringify({events:sample.rows.map(row=>({tStartMs:row.start*1000,dDurationMs:(row.end-row.start)*1000,segs:[{utf8:row.text}]}))})
    } : {contentType:'text/html',body:fixture}));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async ({sentences,chinese}) => {
      await chrome.storage.local.set({settings:{...DubCore.defaults,autoStart:false,syncMode:'complete',autoTranslate:false,bilingual:true}});
      const native = fetch; globalThis.__nativeFetch = native; globalThis.__requests = [];
      globalThis.fetch = async (url, options) => {
        if (String(url).startsWith('https://translate.googleapis.com/')) {
          const text = new URL(url).searchParams.get('q'); __requests.push(text);
          const index = sentences.indexOf(text);
          if (index < 0) throw new Error('Unexpected fragmented translation: ' + text);
          return new Response(JSON.stringify([[[chinese[index],text]]]), {headers:{'Content-Type':'application/json'}});
        }
        return native(url, options);
      };
    }, sample);
    const id=worker.url().split('/')[2], page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
    const cdp=await context.newCDPSession(page); await cdp.send('Runtime.enable'); let isolated;
    cdp.on('Runtime.executionContextCreated',({context:c})=>{if(c.origin==='chrome-extension://'+id&&c.auxData?.type==='isolated')isolated=c.id});
    async function run(expression) {
      const r=await cdp.send('Runtime.evaluate',{contextId:isolated,expression,returnByValue:true,awaitPromise:true});
      if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;
    }
    async function ui(fn) {
      const tree=(await cdp.send('DOM.getDocument',{depth:-1,pierce:true})).root;
      function find(n){if(n.attributes?.includes('progress-dub')&&n.shadowRoots?.length)return n.shadowRoots[0];for(const c of [...n.children||[],...n.shadowRoots||[]]){const hit=find(c);if(hit)return hit}}
      const object=(await cdp.send('DOM.resolveNode',{backendNodeId:find(tree).backendNodeId})).object;
      const r=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:fn.toString(),returnByValue:true});
      if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value;
    }
    async function status(){return worker.evaluate(async()=>{const t=(await chrome.tabs.query({url:'https://www.youtube.com/*'}))[0];return chrome.tabs.sendMessage(t.id,{type:'STATUS'})})}
    async function until(fn, timeout=8000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await page.waitForTimeout(40)}throw new Error('Timed out: '+JSON.stringify(await status()))}
    async function advance(target){await run(`{const v=document.querySelector('video');while(Number(v.dataset.pos)<${target}){v.dataset.pos=Math.min(Number(v.dataset.pos)+2,${target});v.dispatchEvent(new Event('timeupdate'))}}`)}
    await page.goto('https://www.youtube.com/watch?v=continuity-test'); await page.waitForSelector('#progress-dub');
    await run(`globalThis.__continuity={spoken:[],cancel:0,pause:0,play:0};
      {const v=document.querySelector('video');Object.defineProperties(v,{currentTime:{get:()=>Number(v.dataset.pos)},paused:{get:()=>v.dataset.paused==='true'},playbackRate:{get:()=>1},duration:{get:()=>1600},ended:{get:()=>false},seeking:{get:()=>false}});v.pause=()=>__continuity.pause++;v.play=()=>__continuity.play++}
      {const speak=DubSpeech.prototype.speak;const synthesis={paused:false,getVoices:()=>[{name:'Test Chinese',lang:'zh-CN',localService:true}],cancel(){__continuity.cancel++},pause(){this.paused=true},resume(){this.paused=false},speak(u){__continuity.last=u;__continuity.spoken.push({text:u.text,at:Date.now()});u.onstart()}};
      DubSpeech.prototype.speak=function(text,options){this.synthesis=synthesis;this.Utterance=class{constructor(text){this.text=text}};__continuity.engine=this;return speak.call(this,text,options)}}`);
    await worker.evaluate(async()=>{const t=(await chrome.tabs.query({url:'https://www.youtube.com/*'}))[0];await chrome.tabs.sendMessage(t.id,{type:'TOGGLE'})});
    await until(async()=>{const s=await status();return s.cues===6&&s.cached===6});
    assert.deepEqual(await worker.evaluate(()=>__requests),sample.sentences);
    pass('The screenshot fragments reach the translation service as six complete sentences, including until you see and real memories');
    await advance(grouped[1].start+.1); await run('__continuity.last.onend()');
    await until(async()=>await run('__continuity.spoken.length')===2);
    assert.equal(await ui(function(){return this.querySelector('.sub .chinese').textContent}),sample.chinese[1]);
    assert.equal(await ui(function(){return this.querySelector('.sub .source span').textContent}),sample.sentences[1]);
    await advance(grouped[3].start+.2);
    assert.equal(await ui(function(){return this.querySelector('.sub .source span').textContent}),sample.sentences[1]);
    await page.screenshot({path:path.join(root,'dist/连续字幕-完整句子预览.png')});
    pass('Chinese and bilingual subtitles keep the complete currently spoken sentence while the video advances');
    await run('__continuity.last.onend()'); await until(async()=>await run('__continuity.spoken.length')===3);
    await run('__continuity.last.onend()'); await until(async()=>await run('__continuity.spoken.length')===4);
    assert.equal(await ui(function(){return this.querySelector('.sub .source span').textContent}),sample.sentences[3]);
    assert.equal(await ui(function(){return this.querySelector('.sub .chinese').textContent}),sample.chinese[3]);
    await page.screenshot({path:path.join(root,'dist/连续字幕-真实回忆预览.png')});
    await advance(1526);
    for(let n=4;n<6;n++){await run('__continuity.last.onend()');await until(async()=>await run('__continuity.spoken.length')===n+1)}
    await run('__continuity.last.onend()'); await until(async()=>(await status()).queued===0);
    const completeSpeech=await run('__continuity.spoken');
    assert.deepEqual(completeSpeech.map(s=>s.text),sample.chinese);
    assert.equal(await run('__continuity.cancel'),0);assert.equal(await run('__continuity.pause'),0);assert.equal(await run('__continuity.play'),0);
    pass('Full Chinese sentences finish in order without omitted words, extra cancellation, video pause or video restart');
    await ui(function(){const input=this.querySelector('[name=syncMode]');input.value='follow';input.dispatchEvent(new Event('change',{bubbles:true}))});
    await until(async()=>(await status()).mode==='follow');
    await run(`{const v=document.querySelector('video');v.dispatchEvent(new Event('seeking'));v.dataset.pos=${grouped[1].start+.1};v.dispatchEvent(new Event('seeked'))}`);
    await until(async()=>await run('__continuity.engine.current?.text')===sample.chinese[1]);
    await advance(grouped[1].end+.2);
    assert.equal(await run('__continuity.engine.current.text'),sample.chinese[1]);
    assert.equal(await ui(function(){return this.querySelector('.sub .source span').textContent}),sample.sentences[1]);
    pass('Follow mode also displays the sentence actually being spoken instead of prematurely replacing it with the next row');
    // Optional live translation observation; quality is not inferred from mocks.
    const liveTranslation=await worker.evaluate(async texts=>{
      const results=[];
      for(const text of texts){try{const q=new URLSearchParams({client:'gtx',sl:'en',tl:'zh-CN',dt:'t',q:text});const r=await __nativeFetch('https://translate.googleapis.com/translate_a/single?'+q,{signal:AbortSignal.timeout(6000)});const data=await r.json();results.push({source:text,ok:r.ok,text:data?.[0]?.map(x=>x[0]).join('')})}catch(e){results.push({source:text,ok:false,error:e.message})}}
      return results;
    },[sample.sentences[1],sample.sentences[3]]);
    const nativePage=await context.newPage();await nativePage.goto(`chrome-extension://${id}/options.html`);
    await nativePage.waitForFunction(()=>speechSynthesis.getVoices().some(v=>/^zh-CN/i.test(v.lang)));
    await nativePage.evaluate(()=>document.querySelector('#volume').value='0');
    await nativePage.locator('#testVoice').click();await nativePage.evaluate(()=>engine.stop());
    const nativeSentence=await nativePage.evaluate(text=>new Promise(resolve=>{
      const utterances=[],native=speechSynthesis.speak.bind(speechSynthesis);let started=0;
      speechSynthesis.speak=u=>{utterances.push({text:u.text,rate:u.rate});native(u)};
      const timer=setTimeout(()=>{engine.stop();speechSynthesis.speak=native;resolve({reason:'timeout',utterances})},25000);
      engine.speak(text,{rate:1.5,volume:0,onStart:()=>{started=performance.now()},onDone:reason=>{
        if(reason==='cancel')return;clearTimeout(timer);speechSynthesis.speak=native;
        resolve({reason,voice:engine.lastVoice,utterances,durationMs:performance.now()-started});
      }});
    }),sample.longChinese);
    assert.equal(nativeSentence.reason,'end');assert.equal(nativeSentence.utterances.length,1);assert.equal(nativeSentence.utterances[0].text,sample.longChinese);
    pass('An actual Edge Chinese voice completes the longer-than-70-character sentence as one utterance (muted timing check)');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(root,'dist/continuity-report.json'),JSON.stringify({version:JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'))).version,actualExtensionLoaded:true,fixture:true,voiceSubstituted:true,checks,sourceRows:sample.rows,grouped,translationRequests:await worker.evaluate(()=>__requests),completeSpeech,liveTranslation,nativeSentence,errors},null,2));
  } finally {await context.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
