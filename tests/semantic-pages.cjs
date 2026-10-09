const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const sample=require('./fixtures/netflix.cjs');
sample.chinese[0]='那是2019年，一位网名叫上游者的网友正在观看Netflix，他在观看过程中注意到了一个让人震惊又无法解释的异常现象，这个现象不仅让他想起过去玩游戏的经历，还使他反复回忆那些熟悉的界面和操作方式，直到他再次仔细观察出现在眼前的画面，并确认其中的细节与记忆中的场景相互对应之后，他才决定把发现记录下来，再去查看其他网友是否也有类似的经历。';
const root=path.resolve(__dirname,'..'),extension=path.join(root,'YouTube中文同传'),checks=[],errors=[],captionRequests=[];
const fixture=`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#111;color:#fff;font:18px Arial}#movie_player{position:relative;width:1100px;height:620px;margin:20px auto;background:linear-gradient(125deg,#333a42,#181d25)}.scene{padding:100px;font-size:34px}.ytp-chrome-bottom{position:absolute;bottom:0;right:0;height:48px}.ytp-right-controls{display:flex;height:48px}.ytp-button{width:48px;height:48px;background:transparent;border:0;color:#fff}</style></head><body><div id="movie_player"><div class="scene">英语自动字幕 · 先按语义分句，再翻译朗读</div><video class="html5-main-video" data-pos="0"></video><div class="ytp-chrome-bottom"><div class="ytp-right-controls"><button class="ytp-button ytp-subtitles-button" aria-pressed="false">CC</button><button class="ytp-button ytp-settings-button">⚙</button></div></div></div><script>window.ytInitialPlayerResponse={videoDetails:{videoId:'asr-test'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=asr-test&lang=en&kind=asr',languageCode:'en',vssId:'a.en',kind:'asr',name:{simpleText:'English (auto-generated)'},isTranslatable:true}]}}};</script></body></html>`;
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
        return r.fulfill({contentType:'application/json',body:JSON.stringify({events:sample.rows.map(row=>({tStartMs:row.start*1000,dDurationMs:(row.end-row.start)*1000,segs:[{utf8:row.text}]}))})});
      }
      return r.fulfill({contentType:'text/html',body:fixture});
    });
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    await worker.evaluate(async sample=>{
      await chrome.storage.local.set({settings:{...DubCore.defaults,autoStart:false,syncMode:'complete',bilingual:true,autoTranslate:true}});
      const native=fetch;globalThis.__nativeFetch=native;globalThis.__asrRequests=[];
      globalThis.fetch=async(u,o)=>{
        if(String(u).startsWith('https://translate.googleapis.com/')){
          const text=new URL(u).searchParams.get('q'),i=sample.sentences.findIndex(s=>DubCore.translationInput({text:s,automatic:true},'en')===text);__asrRequests.push(text);
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
    await run(`globalThis.__asr={spoken:[],videoCalls:0,cancel:0};
      {const v=document.querySelector('video');Object.defineProperties(v,{currentTime:{get:()=>Number(v.dataset.pos)},paused:{get:()=>false},playbackRate:{get:()=>Number(v.dataset.rate||1)},duration:{get:()=>50},ended:{get:()=>false},seeking:{get:()=>false}});v.pause=()=>__asr.videoCalls++;v.play=()=>__asr.videoCalls++}
      {const speak=DubSpeech.prototype.speak;const synthesis={paused:false,getVoices:()=>[{name:'Test Chinese',lang:'zh-CN',localService:true}],cancel(){__asr.cancel++},pause(){},resume(){},speak(u){__asr.last=u;__asr.spoken.push(u.text);u.onstart()}};DubSpeech.prototype.speak=function(t,o){this.synthesis=synthesis;this.Utterance=class{constructor(t){this.text=t}};__asr.engine=this;return speak.call(this,t,o)}}`);
    await worker.evaluate(async()=>{const t=(await chrome.tabs.query({url:'https://www.youtube.com/*'}))[0];await chrome.tabs.sendMessage(t.id,{type:'TOGGLE'})});
    await until(async()=>(await status()).cached===6);
    assert.deepEqual(await worker.evaluate(()=>__asrRequests),await worker.evaluate(sentences=>sentences.map(text=>DubCore.translationInput({text,automatic:true},'en')),sample.sentences));
    assert.ok(captionRequests.length);assert.ok(captionRequests.every(u=>!new URL(u).searchParams.has('tlang')));
    pass('English ASR is grouped before translation even with YouTube auto-translation preference enabled');
    assert.equal((await status()).cues,6);
    pass('The screenshot paragraph yields six complete narrative units with its condition and relative clauses preserved');
    await run(`{const v=document.querySelector('video');for(let t=2;t<=40;t+=2){v.dataset.pos=t;v.dispatchEvent(new Event('timeupdate'))}}`);
    assert.equal((await status()).queued,6);
    const displays=[];
    for(let i=0;i<6;i++){
      await until(async()=>await run(`__asr.engine.current?.options.cue?.text === ${JSON.stringify(sample.sentences[i])}`));
      const text=sample.chinese[i],seen=[],metrics=[];
      let parts=0;
      while(await run(`__asr.engine.current?.options.cue?.text === ${JSON.stringify(sample.sentences[i])}`)) {
        const length=await run('__asr.last.text.length');
        for(let at=0;at<length;at++) {
          await run(`__asr.last.onboundary({charIndex:${at}})`);
          const display=await ui(function(){const sub=this.querySelector('.sub'),zh=sub.querySelector('.chinese'),line=sub.querySelector('.chinese-line'),s=getComputedStyle(line);return {chinese:zh.textContent,source:sub.querySelector('.source span').textContent,page:sub.dataset.page,lines:line.getBoundingClientRect().height/parseFloat(s.lineHeight),height:sub.getBoundingClientRect().height}});
          if(!seen.length||seen.at(-1)!==display.chinese){seen.push(display.chinese);metrics.push(display);}
        }
        if(i===0&&parts===0) {
          const progress=await run('__asr.engine.progress()');
          await run(`__asr.engine.pause();__asr.last.onboundary({charIndex:0})`);
          assert.equal(await run('__asr.engine.progress()'),progress);
          await run(`__asr.engine.resume();const v=document.querySelector('video');v.dataset.rate=2;v.dispatchEvent(new Event('ratechange'))`);
          assert.equal((await status()).queued,6);
          await page.screenshot({path:path.join(root,'dist/语义断句-长句分页预览.png')});
        }
        await run('__asr.last.onend()');parts++;
        if(parts>20)throw new Error('Narration loop did not advance');
      }
      assert.equal(seen.join(''),text);assert.ok(metrics.every(m=>m.lines<=2.1),JSON.stringify(metrics));
      if(i===0)assert.ok(seen.length>=3);
      displays.push({source:sample.sentences[i],pages:metrics,utterances:parts});
    }
    await until(async()=>(await status()).queued===0);
    assert.equal((await run('__asr.spoken')).join(''),sample.chinese.join(''));assert.ok(await run('__asr.spoken.length')>6);assert.equal(await run('__asr.cancel'),0);assert.equal(await run('__asr.videoCalls'),0);
    pass('Long sentence pages follow native word progress, freeze on pause and retain every character while complete speech runs in order without dropped text, cut-off speech or pausing the video');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(root,'dist/semantic-pages-report.json'),JSON.stringify({version:JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'))).version,actualExtensionLoaded:true,fixture:true,voiceSubstituted:true,checks,captionRequests,translationRequests:await worker.evaluate(()=>__asrRequests),displays,errors},null,2));
  }finally{await context.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
