const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),extension=path.join(root,'YouTube中文同传'),checks=[],errors=[];
const fixture=`<!doctype html><html><head><meta charset="utf-8"><style>body{background:#111}#movie_player{position:relative;width:900px;height:600px}.ytp-right-controls{position:absolute;bottom:0;right:0}.ytp-button{width:48px;height:48px}</style></head><body><div id="movie_player"><video class="html5-main-video" data-pos="0" data-paused="false"></video><div class="ytp-right-controls"><button class="ytp-button ytp-subtitles-button" aria-pressed="false">CC</button><button class="ytp-button ytp-settings-button">设置</button></div></div><script>window.ytInitialPlayerResponse={videoDetails:{videoId:'resume-test'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=resume-test&lang=en',languageCode:'en',vssId:'.en',name:{simpleText:'English'},isTranslatable:true}]}}};</script></body></html>`;
(async()=>{
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'dub-resume-')),{
    executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,
    ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run']
  });
  const pass=s=>{checks.push(s);console.log('PASS',s)};
  try{
    await context.route('https://www.youtube.com/**',r=>r.fulfill(r.request().url().includes('/api/timedtext')?{contentType:'application/json',body:JSON.stringify({events:[0,1].map(i=>({tStartMs:i*6000,dDurationMs:5800,segs:[{utf8:`Caption ${i}.`}]}))})}:{contentType:'text/html',body:fixture}));
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    await worker.evaluate(async()=>{
      await chrome.storage.local.set({settings:{...DubCore.defaults,autoStart:false,syncMode:'complete',autoTranslate:false,rate:1.5}});
      const native=fetch;globalThis.fetch=async(u,o)=>String(u).startsWith('https://translate.googleapis.com/')?new Response(JSON.stringify([[[new URL(u).searchParams.get('q').includes('0')?'第一小句。第二小句。第三小句。':'下一段。']]]),{headers:{'Content-Type':'application/json'}}):native(u,o);
    });
    const id=worker.url().split('/')[2],page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const cdp=await context.newCDPSession(page);await cdp.send('Runtime.enable');let isolated;
    cdp.on('Runtime.executionContextCreated',({context:c})=>{if(c.origin===`chrome-extension://${id}`&&c.auxData?.type==='isolated')isolated=c.id});
    async function run(expression){const r=await cdp.send('Runtime.evaluate',{contextId:isolated,expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
    async function status(){return worker.evaluate(async()=>{const t=(await chrome.tabs.query({url:'https://www.youtube.com/*'}))[0];return chrome.tabs.sendMessage(t.id,{type:'STATUS'})})}
    async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await page.waitForTimeout(40)}throw new Error('Timed out: '+JSON.stringify(await status()))}
    await page.goto('https://www.youtube.com/watch?v=resume-test');await page.waitForSelector('#progress-dub');
    await run(`globalThis.__resume={spoken:[],videoCalls:0,resumes:0};
      {const v=document.querySelector('video');Object.defineProperties(v,{currentTime:{get:()=>Number(v.dataset.pos)},paused:{get:()=>v.dataset.paused==='true'},playbackRate:{get:()=>Number(v.dataset.rate||1)},duration:{get:()=>12},ended:{get:()=>false},seeking:{get:()=>false}});v.pause=()=>__resume.videoCalls++;v.play=()=>__resume.videoCalls++}
      {const speak=DubSpeech.prototype.speak;const synthesis={paused:false,speaking:true,pending:false,getVoices:()=>[{name:'Test Chinese',lang:'zh-CN',localService:true}],cancel(){},pause(){this.paused=true},resume(){this.paused=false;__resume.resumes++},speak(u){__resume.last=u;__resume.spoken.push({text:u.text,rate:u.rate});u.onstart()}};DubSpeech.prototype.speak=function(t,o){this.synthesis=synthesis;this.Utterance=class{constructor(t){this.text=t}};__resume.engine=this;return speak.call(this,t,o)}}`);
    await worker.evaluate(async()=>{const t=(await chrome.tabs.query({url:'https://www.youtube.com/*'}))[0];await chrome.tabs.sendMessage(t.id,{type:'TOGGLE'})});
    await until(async()=>await run('__resume.spoken.length')===1);
    await run('__resume.last.onend()');assert.equal(await run('__resume.last.text'),'第二小句。');
    await run(`{const v=document.querySelector('video');v.dataset.paused='true';v.dispatchEvent(new Event('pause'));v.dispatchEvent(new Event('playing'))}`);
    assert.equal(await run('__resume.engine.current.paused'),true);assert.equal(await run('__resume.resumes'),0);
    pass('A late playing event while the video is still paused cannot restart narration');
    await run(`{const v=document.querySelector('video');v.dataset.paused='false';v.dispatchEvent(new Event('play'));v.dispatchEvent(new Event('playing'));v.dispatchEvent(new Event('playing'))}`);
    assert.equal(await run('__resume.engine.current.paused'),false);assert.equal(await run('__resume.resumes'),1);
    assert.equal(await run('__resume.spoken.length'),2);
    pass('Play plus repeated playing events resume once and do not replay the completed first part');
    await run(`{const v=document.querySelector('video');v.dispatchEvent(new Event('waiting'));v.dispatchEvent(new Event('play'));v.dispatchEvent(new Event('timeupdate'))}`);
    assert.equal(await run('__resume.engine.current.paused'),true);assert.equal(await run('__resume.resumes'),1);
    await run(`{const v=document.querySelector('video');v.dataset.pos=2;v.dispatchEvent(new Event('timeupdate'));v.dataset.pos=4;v.dispatchEvent(new Event('timeupdate'));v.dataset.pos=6;v.dispatchEvent(new Event('timeupdate'));v.dataset.rate=2;v.dispatchEvent(new Event('ratechange'));v.dispatchEvent(new Event('playing'))}`);
    assert.equal(await run('__resume.resumes'),2);assert.equal((await status()).queued,2);
    pass('Buffering stays paused until playing; subtitles arriving during buffering remain queued');
    await run('__resume.last.onend()');assert.equal(await run('__resume.last.text'),'第三小句。');assert.equal(await run('__resume.last.rate'),3);
    await run(`{const v=document.querySelector('video');v.dataset.paused='true';v.dispatchEvent(new Event('pause'));__resume.last.onend()}`);
    assert.equal(await run('__resume.spoken.length'),3);
    await run(`{const v=document.querySelector('video');v.dataset.paused='false';v.dispatchEvent(new Event('play'))}`);
    await until(async()=>await run('__resume.spoken.length')===4);
    assert.equal(await run('__resume.last.text'),'下一段。');await run('__resume.last.onend()');
    await until(async()=>(await status()).queued===0);
    assert.deepEqual((await run('__resume.spoken')).map(u=>u.text),['第一小句。','第二小句。','第三小句。','下一段。']);
    assert.equal(await run('__resume.videoCalls'),0);assert.equal(await page.locator('video').evaluate(v=>v.volume),.25);
    pass('All retained parts finish in order with multiplied speed and a steady volume cap, without controlling video playback');
    // A real native voice probe uses the same release engine, with silent output.
    const nativePage=await context.newPage();await nativePage.goto(`chrome-extension://${id}/options.html`);
    await nativePage.waitForFunction(()=>speechSynthesis.getVoices().some(v=>/^zh-CN/i.test(v.lang)));
    await nativePage.locator('#volume').fill('0');await nativePage.locator('#testVoice').click();await nativePage.evaluate(()=>engine.stop());
    const native=await nativePage.evaluate(()=>new Promise(resolve=>{
      const utterances=[],nativeSpeak=speechSynthesis.speak.bind(speechSynthesis);let pauses=0,armed=false;
      speechSynthesis.speak=u=>{utterances.push(u.text);nativeSpeak(u)};
      const finish=reason=>{clearTimeout(deadline);speechSynthesis.speak=nativeSpeak;resolve({reason,voice:engine.lastVoice,utterances,pauses})};
      const deadline=setTimeout(()=>{engine.stop();finish('timeout')},30000);
      engine.speak('第一句已经完整读完。接下来这一句用来检查暂停以后继续朗读，保留前面已经读完的内容并顺利完成。',{
        volume:0,rate:1.5,onStart:()=>{
          if(utterances.length<2||armed)return;armed=true;
          setTimeout(()=>{engine.pause();pauses++;setTimeout(()=>{engine.resume();setTimeout(()=>{engine.pause();pauses++;setTimeout(()=>engine.resume(),350)},250)},350)},250);
        },onDone:r=>{if(r!=='cancel')finish(r)}
      });
    }));
    assert.equal(native.reason,'end');assert.equal(native.pauses,2);assert.equal(native.utterances.filter(s=>s==='第一句已经完整读完。').length,1);
    pass('Actual Edge Chinese synthesis finishes after two pause/resume cycles, without replaying the completed sentence (muted)');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(root,'dist/playback-resume-report.json'),JSON.stringify({actualExtensionLoaded:true,fixture:true,transportVoiceSubstituted:true,checks,native,errors},null,2));
  }finally{await context.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
