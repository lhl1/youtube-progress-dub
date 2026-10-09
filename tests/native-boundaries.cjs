const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const original=require('./fixtures/netflix.cjs');
const annotations=process.argv.includes('--annotations');
const sample=annotations?{sentences:['[Music]','Hello [Music] World [__] Goodbye.','@#__','Final spoken.'],chinese:['音乐','你好[音乐]世界✨[__]再见。','符号','最后一句。']}:{sentences:[original.text,'First sentence. Second sentence! Until','you see real memories.'],chinese:[('当你亲眼看到那些熟悉的画面时，你会逐渐想起过去的经历和完整的故事，').repeat(6)+'最后把这条字幕完整读完。','第一句。第二句！直到','你看见真实的回忆。']};
sample.rows=sample.sentences.map((text,i)=>({start:i*8,end:i*8+8,text}));
const root=path.resolve(__dirname,'..'),extension=path.join(root,'YouTube中文同传'),checks=[],errors=[],captionRequests=[];
const fixture=`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#111;color:#fff;font:18px Arial}#movie_player{position:relative;width:1100px;height:620px;margin:20px auto;background:linear-gradient(125deg,#333a42,#181d25)}.scene{padding:100px;font-size:34px}.ytp-chrome-bottom{position:absolute;bottom:0;right:0;height:48px}.ytp-right-controls{display:flex;height:48px}.ytp-button{width:48px;height:48px;background:transparent;border:0;color:#fff}</style></head><body><div id="movie_player"><div class="scene">英语自动字幕 · 先按语义分句，再翻译朗读</div><video class="html5-main-video" data-pos="0"></video><div class="ytp-chrome-bottom"><div class="ytp-right-controls"><button class="ytp-button ytp-subtitles-button" aria-pressed="false">CC</button><button class="ytp-button ytp-settings-button">⚙</button></div></div></div><script>window.ytInitialPlayerResponse={videoDetails:{videoId:'asr-test'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=asr-test&lang=en',languageCode:'en',vssId:'.en',name:{simpleText:'English'},isTranslatable:true}]}}};</script></body></html>`;
(async()=>{
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'dub-asr-')),{
    executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,viewport:{width:1200,height:700},
    ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run']
  });
  const pass=s=>{checks.push(s);console.log('PASS',s)};
  try{
    await context.route('https://www.youtube.com/**',r=>{
      if(r.request().url().includes('/api/timedtext')){
        captionRequests.push(r.request().url());
        return r.fulfill({contentType:'application/json',body:JSON.stringify({events:sample.rows.map(row=>({tStartMs:row.start*1000,dDurationMs:(row.end-row.start)*1000,segs:[{utf8:new URL(r.request().url()).searchParams.has('tlang') ? sample.chinese[sample.rows.indexOf(row)] : row.text}]}))})});
      }
      return r.fulfill({contentType:'text/html',body:fixture});
    });
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    await worker.evaluate(async sample=>{
      await chrome.storage.local.set({settings:{...DubCore.defaults,autoStart:false,syncMode:'complete',bilingual:true,autoTranslate:false}});
      const native=fetch;globalThis.__nativeFetch=native;globalThis.__asrRequests=[];
      globalThis.fetch=async(u,o)=>{
        if(String(u).startsWith('https://translate.googleapis.com/')){
          const text=new URL(u).searchParams.get('q'),i=sample.sentences.indexOf(text);__asrRequests.push(text);
          if(i<0)throw new Error('Fragmented ASR translation request: '+text);
          return new Response(JSON.stringify([[[sample.chinese[i],text]]]),{headers:{'Content-Type':'application/json'}});
        }
        return native(u,o);
      };
    },sample);
    const id=worker.url().split('/')[2],page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const cdp=await context.newCDPSession(page);await cdp.send('Runtime.enable');let isolated;
    cdp.on('Runtime.executionContextCreated',({context:c})=>{if(c.origin===`chrome-extension://${id}`&&c.auxData?.type==='isolated')isolated=c.id});
    async function run(expression){const r=await cdp.send('Runtime.evaluate',{contextId:isolated,expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
    async function ui(fn){
      const tree=(await cdp.send('DOM.getDocument',{depth:-1,pierce:true})).root;
      function find(n){if(n.attributes?.includes('progress-dub')&&n.shadowRoots?.length)return n.shadowRoots[0];for(const c of [...n.children||[],...n.shadowRoots||[]]){const hit=find(c);if(hit)return hit}}
      const object=(await cdp.send('DOM.resolveNode',{backendNodeId:find(tree).backendNodeId})).object;
      const r=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:fn.toString(),returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value;
    }
    async function status(){return worker.evaluate(async()=>{const t=(await chrome.tabs.query({url:'https://www.youtube.com/*'}))[0];return chrome.tabs.sendMessage(t.id,{type:'STATUS'})})}
    async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await page.waitForTimeout(40)}throw new Error('Timed out: '+JSON.stringify(await status()))}
    await page.goto('https://www.youtube.com/watch?v=asr-test');await page.waitForSelector('#progress-dub');
    await run(`globalThis.__asr={spoken:[],videoCalls:0,cancel:0,calls:[]};
      {const v=document.querySelector('video');Object.defineProperties(v,{currentTime:{get:()=>Number(v.dataset.pos)},paused:{get:()=>v.dataset.paused==='true'},playbackRate:{get:()=>Number(v.dataset.rate||1)},duration:{get:()=>30},ended:{get:()=>false},seeking:{get:()=>false}});v.pause=()=>__asr.videoCalls++;v.play=()=>__asr.videoCalls++}
      {const speak=DubSpeech.prototype.speak;const synthesis={paused:false,getVoices:()=>[{name:'Test Chinese',lang:'zh-CN',localService:true}],cancel(){__asr.cancel++},pause(){},resume(){},speak(u){__asr.last=u;__asr.spoken.push(u.text);u.onstart()}};DubSpeech.prototype.speak=function(t,o){this.synthesis=synthesis;this.Utterance=class{constructor(t){this.text=t}};__asr.engine=this;__asr.calls.push({text:t,source:o.cue?.text,silent:o.silent});return speak.call(this,t,o)}}`);
    await worker.evaluate(async()=>{const t=(await chrome.tabs.query({url:'https://www.youtube.com/*'}))[0];await chrome.tabs.sendMessage(t.id,{type:'TOGGLE'})});
    await until(async()=>(await status()).cached===sample.sentences.length);
    assert.deepEqual(await worker.evaluate(()=>__asrRequests),sample.sentences);
    assert.ok(captionRequests.length);assert.ok(captionRequests.every(u=>!new URL(u).searchParams.has('tlang')));
    if(annotations){
      await until(async()=>await run('__asr.calls.length')===1&&!await run('__asr.engine.current'));
      assert.deepEqual(await run('__asr.spoken'),[]);pass('An annotation-only source stays silent even when the translator removes its brackets');
      await run(`{const v=document.querySelector('video');for(let t=2;t<=24;t+=2){v.dataset.pos=t;v.dispatchEvent(new Event('timeupdate'))}}`);
      await until(async()=>await run('__asr.spoken.length')===1);
      assert.equal(await run('__asr.last.text'),'你好');
      const display=await ui(function(){const sub=this.querySelector('.sub');return {chinese:sub.querySelector('.chinese').textContent,source:sub.querySelector('.source span').textContent,page:sub.dataset.page}});
      assert.equal(display.chinese,sample.chinese[1]);assert.equal(display.source,sample.sentences[1]);assert.equal(display.page,'1/1');
      await run(`__asr.last.onend();{const v=document.querySelector('video');v.dataset.paused='true';v.dispatchEvent(new Event('pause'))}`);
      await page.waitForTimeout(350);assert.equal(await run('__asr.spoken.length'),1);assert.equal(await run('__asr.engine.current.paused'),true);
      await run(`{const v=document.querySelector('video');v.dataset.rate=2;v.dispatchEvent(new Event('ratechange'));v.dataset.paused='false';v.dispatchEvent(new Event('play'));v.dispatchEvent(new Event('playing'))}`);
      await until(async()=>await run('__asr.spoken.length')===2);assert.equal(await run('__asr.last.text'),'世界');assert.equal(await run('__asr.last.rate'),2.6);
      await run('__asr.last.onboundary({charIndex:1})');assert.equal(await run('__asr.engine.progress()'),7);await run('__asr.last.onend()');
      await until(async()=>await run('__asr.spoken.length')===3);assert.equal(await run('__asr.last.text'),'再见。');await run('__asr.last.onend()');
      await until(async()=>await run('__asr.spoken.length')===4);assert.equal(await run('__asr.last.text'),'最后一句。');await run('__asr.last.onend()');
      await until(async()=>(await status()).queued===0);
      assert.deepEqual(await run('__asr.spoken'),['你好','世界','再见。','最后一句。']);assert.equal(await run('__asr.videoCalls'),0);assert.equal(await run('__asr.cancel'),0);
      assert.deepEqual((await run('__asr.calls')).map(c=>c.silent),[true,false,true,false]);assert.deepEqual(errors,[]);
      pass('Mixed annotations and symbols produce pauses, preserve caption text and offsets, resume correctly and leave subsequent speech at video-multiplied speed without controlling the video');
      fs.writeFileSync(path.join(root,'dist/speech-filter-report.json'),JSON.stringify({version:JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'))).version,actualExtensionLoaded:true,fixture:true,voiceSubstituted:true,checks,display,spoken:await run('__asr.spoken'),calls:await run('__asr.calls'),errors},null,2));
      return;
    }
    assert.equal((await status()).automatic,false);pass('Native metadata preserves all three original rows, including multiple sentences and partial sentence continuations');
    await run(`{const v=document.querySelector('video');for(let t=2;t<=24;t+=2){v.dataset.pos=t;v.dispatchEvent(new Event('timeupdate'))}}`);
    assert.equal((await status()).queued,3);
    const displays=[];
    for(let i=0;i<3;i++) {
      await until(async()=>await run(`__asr.engine.current?.options.cue?.text === ${JSON.stringify(sample.sentences[i])}`));
      let parts=0;
      while(await run(`__asr.engine.current?.options.cue?.text === ${JSON.stringify(sample.sentences[i])}`)) {
        await run('__asr.last.onboundary({charIndex:Math.max(0,__asr.last.text.length-1)})');
        const display=await ui(function(){const sub=this.querySelector('.sub');return {chinese:sub.querySelector('.chinese').textContent,source:sub.querySelector('.source span').textContent,page:sub.dataset.page,continuationHidden:sub.querySelector('.page-info').hidden}});
        assert.equal(display.chinese,sample.chinese[i]);assert.equal(display.source,sample.sentences[i]);assert.equal(display.page,'1/1');assert.equal(display.continuationHidden,true);
        displays.push(display);await run('__asr.last.onend()');parts++;
      }
      if(i===0)assert.ok(parts>1);
    }
    await until(async()=>(await status()).queued===0);
    assert.equal((await run('__asr.spoken')).join(''),sample.chinese.join(''));assert.deepEqual(await worker.evaluate(()=>__asrRequests),sample.sentences);assert.equal(await run('__asr.cancel'),0);assert.equal(await run('__asr.videoCalls'),0);
    pass('Native rows remain whole on screen across speech parts and reach translation without re-segmentation without dropped text, cut-off speech or pausing the video');
    await ui(function(){const control=this.querySelector('[name=autoTranslate]');control.checked=true;control.dispatchEvent(new Event('change',{bubbles:true}))});
    await until(async()=>(await status()).language==='zh-Hans'&&(await status()).cues===3);
    assert.equal((await status()).automatic,false);assert.equal((await status()).cues,3);
    assert.ok(captionRequests.some(u=>new URL(u).searchParams.has('tlang')));
    assert.deepEqual(await worker.evaluate(()=>__asrRequests),sample.sentences);
    await until(async()=>await run('__asr.engine.current?.options.cue?.text')===sample.chinese[2]);
    pass('YouTube automatic translation of an authored track stays authored and keeps the same three rows');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(root,'dist/native-boundaries-report.json'),JSON.stringify({version:JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'))).version,actualExtensionLoaded:true,fixture:true,voiceSubstituted:true,checks,captionRequests,translationRequests:await worker.evaluate(()=>__asrRequests),displays,errors},null,2));
  }finally{await context.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
