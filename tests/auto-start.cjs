const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),extension=path.join(root,'YouTube中文同传'),checks=[];
function pass(s){checks.push(s);console.log('PASS',s)}
const fixture=`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#111;color:#fff}#movie_player{position:relative;width:900px;height:650px;margin:20px auto;background:#292929}.ytp-right-controls{position:absolute;bottom:0;right:0;display:flex;height:48px}.ytp-button{width:48px;height:48px;background:none;border:0;color:white}</style></head><body><div id="movie_player"><div class="ytp-right-controls"><button class="ytp-button ytp-subtitles-button" aria-pressed="false">CC</button><button class="ytp-button ytp-settings-button">⚙</button></div></div><script>
function metadata(id){window.ytInitialPlayerResponse={videoDetails:{videoId:id,isLiveContent:false},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v='+id+'&lang=zh-CN',languageCode:'zh-CN',vssId:'.zh-CN',name:{simpleText:'中文'},isTranslatable:false}]}}}}
metadata(new URL(location.href).searchParams.get('v'));
window.navigate=id=>{metadata(id);history.pushState({},'',id?'/watch?v='+id:'/');document.dispatchEvent(new Event('yt-navigate-finish'))};
setTimeout(()=>{const v=document.createElement('video');v.className='html5-main-video';Object.defineProperties(v,{currentTime:{get:()=>0},paused:{get:()=>false},playbackRate:{get:()=>1},duration:{get:()=>12},ended:{get:()=>false},seeking:{get:()=>false}});v.volume=.8;document.querySelector('#movie_player').prepend(v)},2200);
document.addEventListener('click',e=>{if(e.target.classList.contains('ytp-subtitles-button'))e.target.setAttribute('aria-pressed',e.target.getAttribute('aria-pressed')==='true'?'false':'true')});
</script></body></html>`;
(async()=>{
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'dub-auto-start-')),{
    executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,viewport:{width:1040,height:720},
    ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run']
  });
  try{
    await context.route('https://www.youtube.com/**',r=>r.fulfill(r.request().url().includes('/api/timedtext')?{contentType:'application/json',body:JSON.stringify({events:[{tStartMs:0,dDurationMs:5000,segs:[{utf8:'这是自动开启测试。'}]}]})}:{contentType:'text/html',body:fixture}));
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    await worker.evaluate(async()=>chrome.storage.local.set({settings:{...DubCore.defaults,autoStart:true,syncMode:'complete'}}));
    const id=worker.url().split('/')[2],page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const cdp=await context.newCDPSession(page);await cdp.send('Runtime.enable');let isolated;
    cdp.on('Runtime.executionContextCreated',({context:c})=>{if(c.origin==='chrome-extension://'+id&&c.auxData?.type==='isolated')isolated=c.id});
    async function run(expression){const r=await cdp.send('Runtime.evaluate',{contextId:isolated,expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
    async function ui(fn,...args){
      const tree=(await cdp.send('DOM.getDocument',{depth:-1,pierce:true})).root;
      function find(n){if(n.attributes?.includes('progress-dub')&&n.shadowRoots?.length)return n.shadowRoots[0];for(const c of [...n.children||[],...n.shadowRoots||[]]){const hit=find(c);if(hit)return hit}}
      const object=(await cdp.send('DOM.resolveNode',{backendNodeId:find(tree).backendNodeId})).object;
      const r=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:fn.toString(),arguments:args.map(value=>({value})),returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;
    }
    async function status(){return worker.evaluate(async()=>{const t=(await chrome.tabs.query({url:'https://www.youtube.com/*'}))[0];return chrome.tabs.sendMessage(t.id,{type:'STATUS'})})}
    async function waitForState(fn,timeout=8000){const until=Date.now()+timeout;let s;while(Date.now()<until){s=await status();if(fn(s))return s;await page.waitForTimeout(100)}throw new Error('Unexpected state: '+JSON.stringify(s))}
    async function toggle(){await worker.evaluate(async()=>{const t=(await chrome.tabs.query({url:'https://www.youtube.com/*'}))[0];await chrome.tabs.sendMessage(t.id,{type:'TOGGLE'})})}
    await page.goto('https://www.youtube.com/watch?v=auto-video-1');await page.waitForSelector('#progress-dub');
    await run(`globalThis.__auto={calls:0,deny:true,done:0};const ready=()=>{const v=document.querySelector('video');if(v&&!v.__autoReady){v.__autoReady=true;Object.defineProperties(v,{currentTime:{get:()=>0},paused:{get:()=>false},playbackRate:{get:()=>1},duration:{get:()=>12},ended:{get:()=>false},seeking:{get:()=>false}});v.dispatchEvent(new Event('playing'))}};new MutationObserver(ready).observe(document.body,{childList:true,subtree:true});ready();DubSpeech.prototype.voices=function(){return [{name:'Test Chinese',lang:'zh-CN',localService:true}]};DubSpeech.prototype.speak=function(text,options={}){this.stop();__auto.calls++;if(__auto.deny){const e=new Error('浏览器需要页面点击');e.code='not-allowed';this.onError(e);options.onDone?.('blocked');return}this.current={text,options};options.onStart?.();const token=this.token;setTimeout(()=>{if(token!==this.token)return;this.current=null;__auto.done++;this.onState(null);options.onDone?.('end')},50)};`);
    await page.waitForTimeout(1000);assert.equal((await status()).active,false);
    await waitForState(s=>s.active&&s.voiceNeedsGesture);assert.equal(await page.locator('video').evaluate(v=>v.volume),.25);
    pass('A saved auto-start setting waits for a player arriving more than two seconds late, then starts and caps audio');
    await page.waitForTimeout(1200);assert.equal(await run('__auto.calls'),1);
    await run('__auto.deny=false');await page.locator('#movie_player').click({position:{x:50,y:50}});
    await waitForState(s=>!s.voiceNeedsGesture&&s.queued===0);assert.equal(await run('__auto.done'),1);
    pass('A browser speech permission block waits without retries; a real page click resumes the retained sentence');
    await toggle();await page.waitForTimeout(1600);assert.equal((await status()).active,false);
    pass('Stopping narration manually is respected even when automatic startup remains enabled');
    await page.evaluate(()=>navigate('auto-video-2'));await waitForState(s=>s.active&&s.videoId==='auto-video-2');
    pass('YouTube navigation to the next video starts narration automatically');
    await toggle();
    await ui(function(){const e=this.querySelector('[name=autoStart]');e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}))});
    await page.waitForTimeout(400);await page.evaluate(()=>navigate('auto-video-3'));await page.waitForTimeout(1400);
    assert.equal((await status()).active,false);
    pass('Disabling automatic startup prevents narration on a newly opened video');
    assert.ok(await ui(function(){return this.querySelector('[name=autoStart]').closest('details')===null}));
    await ui(function(){const e=this.querySelector('[name=autoStart]');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}))});
    await waitForState(s=>s.active);await page.waitForTimeout(400);
    assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('settings')).settings.autoStart),true);
    pass('The visible top-level automatic-start switch starts the current video immediately and persists its setting');
    await toggle();
    await page.goto('https://www.youtube.com/watch?v=auto-video-4');await page.waitForSelector('#progress-dub');
    await page.evaluate(()=>navigate(''));
    await page.waitForTimeout(3200);assert.equal((await status()).active,false);assert.equal((await status()).videoId,'');
    pass('Leaving the video before the player arrives cancels pending automatic startup');
    await worker.evaluate(() => {
      const read = chrome.storage.local.get.bind(chrome.storage.local);
      let delay = true;
      chrome.storage.local.get = async key => {
        if (key === 'settings' && delay) { delay = false; await new Promise(resolve => setTimeout(resolve, 2800)); }
        return read(key);
      };
    });
    await page.goto('https://www.youtube.com/watch?v=auto-video-5');
    await page.waitForSelector('#progress-dub');
    assert.equal((await status()).active,false);
    await waitForState(s=>s.active&&s.settings.autoStart&&s.videoId==='auto-video-5');
    pass('Saved automatic startup still applies when settings arrive after the player watchdog has run');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(root,'dist/auto-start-report.json'),JSON.stringify({actualExtensionLoaded:true,fixture:true,voiceSubstituted:true,checks,errors},null,2));
  }finally{await context.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
