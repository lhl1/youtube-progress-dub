const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),extension=path.join(root,'YouTube中文同传'),checks=[],errors=[];
const fixture=`<!doctype html><html><head><meta charset="utf-8"><style>#movie_player{position:relative;width:900px;height:600px}.ytp-right-controls{position:absolute;bottom:0;right:0}.ytp-button{width:48px;height:48px}</style></head><body><div id="movie_player"><video class="html5-main-video" data-pos="0" data-paused="false"></video><div class="ytp-right-controls"><button class="ytp-button ytp-subtitles-button" aria-pressed="false">CC</button><button class="ytp-button ytp-settings-button">Settings</button></div></div><script>window.ytInitialPlayerResponse={videoDetails:{videoId:'voice-stability'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=voice-stability&lang=en',languageCode:'en',vssId:'.en',name:{simpleText:'English'},isTranslatable:true}]}}};</script></body></html>`;
(async()=>{
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'dub-voice-stability-')),{
    executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,
    ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run']
  });
  const pass=s=>{checks.push(s);console.log('PASS',s)};
  try{
    await context.route('https://www.youtube.com/**',r=>r.fulfill(r.request().url().includes('/api/timedtext')?{contentType:'application/json',body:JSON.stringify({events:[0,1].map(i=>({tStartMs:i*6000,dDurationMs:5800,segs:[{utf8:`Caption ${i}.`}]}))})}:{contentType:'text/html',body:fixture}));
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    await worker.evaluate(async()=>{
      await chrome.storage.local.set({settings:{...DubCore.defaults,autoStart:false,syncMode:'complete',autoTranslate:false,rate:1.5,voice:'Test Natural Chinese'}});
      const native=fetch;globalThis.fetch=async(u,o)=>String(u).startsWith('https://translate.googleapis.com/')?new Response(JSON.stringify([[[new URL(u).searchParams.get('q').includes('0')?'第一小句。第二小句。第三小句。':'下一段。']]]),{headers:{'Content-Type':'application/json'}}):native(u,o);
    });
    const id=worker.url().split('/')[2],page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const cdp=await context.newCDPSession(page);await cdp.send('Runtime.enable');let isolated;
    cdp.on('Runtime.executionContextCreated',({context:c})=>{if(c.origin===`chrome-extension://${id}`&&c.auxData?.type==='isolated')isolated=c.id});
    async function run(expression){const r=await cdp.send('Runtime.evaluate',{contextId:isolated,expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
    async function status(){return worker.evaluate(async()=>{const t=(await chrome.tabs.query({url:'https://www.youtube.com/*'}))[0];return chrome.tabs.sendMessage(t.id,{type:'STATUS'})})}
    async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await page.waitForTimeout(40)}throw new Error('Timed out: '+JSON.stringify(await status()))}
    await page.goto('https://www.youtube.com/watch?v=voice-stability');await page.waitForSelector('#progress-dub');
    await run(`globalThis.__voice={spoken:[],videoCalls:0,resumes:0};
      {const v=document.querySelector('video');Object.defineProperties(v,{currentTime:{get:()=>Number(v.dataset.pos)},paused:{get:()=>v.dataset.paused==='true'},playbackRate:{get:()=>Number(v.dataset.rate||1)},duration:{get:()=>12},ended:{get:()=>false},seeking:{get:()=>false},readyState:{get:()=>4}});v.pause=()=>__voice.videoCalls++;v.play=()=>__voice.videoCalls++}
      {const speak=DubSpeech.prototype.speak;const natural={name:'Test Natural Chinese',voiceURI:'natural',lang:'zh-CN',localService:false},local={name:'Test Local Chinese',voiceURI:'local',lang:'zh-CN',localService:true};
      const synthesis={paused:false,speaking:true,pending:false,list:[natural,local],getVoices(){return this.list},cancel(){},pause(){this.paused=true},resume(){this.paused=false;__voice.resumes++},speak(u){__voice.last=u;__voice.spoken.push({text:u.text,rate:u.rate,voice:u.voice.name});u.onstart()}};__voice.synthesis=synthesis;__voice.natural=natural;__voice.local=local;
      DubSpeech.prototype.voices=function(){return synthesis.getVoices()};DubSpeech.prototype.speak=function(t,o){this.synthesis=synthesis;this.Utterance=class{constructor(t){this.text=t}};__voice.engine=this;return speak.call(this,t,o)}}`);
    await worker.evaluate(async()=>{const t=(await chrome.tabs.query({url:'https://www.youtube.com/*'}))[0];await chrome.tabs.sendMessage(t.id,{type:'TOGGLE'})});
    await until(async()=>await run('__voice.spoken.length')===1);
    await run('__voice.last.onend()');assert.equal(await run('__voice.last.text'),'第二小句。');
    await run(`{const v=document.querySelector('video');v.dataset.paused='true';v.dispatchEvent(new Event('pause'));__voice.old=__voice.last;__voice.last.onerror({error:'synthesis-failed'});v.dataset.rate=2;v.dispatchEvent(new Event('ratechange'));}`);
    await page.waitForTimeout(400);assert.equal(await run('__voice.spoken.length'),2);assert.equal(await run('__voice.engine.current.paused'),true);
    pass('A speech failure while video is paused retains the current part and emits no fallback audio');
    await run(`{const v=document.querySelector('video');v.dataset.paused='false';v.dispatchEvent(new Event('play'));v.dispatchEvent(new Event('playing'));v.dispatchEvent(new Event('playing'));}`);
    await until(async()=>await run('__voice.spoken.length')===3);
    assert.equal(await run('__voice.last.voice.name'),'Test Natural Chinese');assert.equal(await run('__voice.last.text'),'第二小句。');assert.equal(await run('__voice.last.rate'),3);
    await run('__voice.old.onend()');assert.equal(await run('__voice.spoken.length'),3);
    pass('Resume keeps the same voice, multiplied speed and unfinished part, ignoring stale callbacks');
    await run(`document.querySelector('video').dispatchEvent(new Event('waiting'));document.querySelector('video').dispatchEvent(new Event('playing'));__voice.last.onerror({error:'network'})`);
    assert.equal(await run('__voice.spoken.length'),4);assert.equal(await run('__voice.last.voice.name'),'Test Natural Chinese');
    await run('__voice.last.onend()');assert.equal(await run('__voice.last.text'),'第三小句。');
    pass('A transient error after resume retries the same voice and preserves subsequent sentence parts');
    await run(`{const v=document.querySelector('video');v.dataset.pos=6;v.dispatchEvent(new Event('timeupdate'));__voice.synthesis.list=[__voice.local];__voice.last.onend();window.speechSynthesis.dispatchEvent(new Event('voiceschanged'));}`);
    await until(async()=>!await run('!!__voice.engine.current'));
    const waitingCount=await run('__voice.spoken.length');await page.waitForTimeout(500);
    assert.equal(await run('__voice.spoken.length'),waitingCount);assert.equal((await status()).queued,1);
    assert.equal((await status()).settings.voice,'Test Natural Chinese');
    pass('If the selected voice disappears between cues, the next cue waits instead of changing voice');
    await run(`__voice.synthesis.list=[__voice.local,{...__voice.natural}];window.speechSynthesis.dispatchEvent(new Event('voiceschanged'))`);
    await until(async()=>await run('__voice.last.text')==='下一段。'&&await run('!!__voice.engine.current'));
    assert.equal(await run('__voice.last.voice.name'),'Test Natural Chinese');await run('__voice.last.onend()');
    await until(async()=>(await status()).queued===0);
    const spoken=await run('__voice.spoken');assert.ok(spoken.every(u=>u.voice==='Test Natural Chinese'));
    assert.equal(spoken.filter(u=>u.text==='第一小句。').length,1);assert.equal(await run('__voice.videoCalls'),0);
    assert.equal(await page.locator('video').evaluate(v=>v.volume),.25);
    pass('The original voice returns automatically and all queued content finishes without controlling video playback');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(root,'dist/voice-stability-report.json'),JSON.stringify({version:JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'))).version,actualExtensionLoaded:true,fixture:true,voiceSubstituted:true,checks,spoken,errors},null,2));
  }finally{await context.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
