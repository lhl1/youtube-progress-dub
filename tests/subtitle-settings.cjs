const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const C=require('../YouTube中文同传/core.js');
const root=path.resolve(__dirname,'..'),extension=path.join(root,'YouTube中文同传'),checks=[],errors=[];
function pass(s){checks.push(s);console.log('PASS',s)}
const first='亲眼看到这些熟悉的东西，能唤起真实的回忆，让我们重新想起曾经经历的故事。';
const fixture=`<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#101010;color:#fff;font-family:Arial}#movie_player{position:relative;width:1100px;height:620px;margin:20px auto;background:linear-gradient(130deg,#33483d,#152e42)}.scene{padding:100px 70px;font-size:28px;color:#cfddd9}.ytp-chrome-bottom{position:absolute;bottom:0;height:48px;left:0;right:0;background:#0005}.ytp-right-controls{float:right;display:flex;height:48px}.ytp-button{width:48px;height:48px;background:none;border:0;color:white}.ytp-caption-window-container{position:absolute;bottom:130px;left:30px;font-size:18px}.ytp-caption-segment{background:#0008}</style></head>
<body><div id="movie_player"><div class="scene">中文字幕 · 自定义外观与双语</div><video class="html5-main-video" data-pos="0" data-paused="false"></video><div class="ytp-caption-window-container"><span class="ytp-caption-segment"></span></div><div class="ytp-chrome-bottom"><div class="ytp-right-controls"><button class="ytp-button ytp-subtitles-button" aria-pressed="false">CC</button><button class="ytp-button ytp-settings-button">⚙</button></div></div></div>
<script>const v=document.querySelector('video');v.volume=.8;window.ytInitialPlayerResponse={videoDetails:{videoId:'style-test',isLiveContent:false},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v=style-test&lang=en',languageCode:'en',vssId:'.en',name:{simpleText:'English'},isTranslatable:true}]}}};document.addEventListener('click',e=>{if(e.target.classList.contains('ytp-subtitles-button'))e.target.setAttribute('aria-pressed',e.target.getAttribute('aria-pressed')==='true'?'false':'true')});</script></body></html>`;
(async()=>{
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'dub-caption-settings-')),{
    executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,viewport:{width:1200,height:700},
    ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run']
  });
  try{
    await context.route('https://www.youtube.com/**',r=>r.fulfill(r.request().url().includes('/api/timedtext')?{
      contentType:'application/json',body:JSON.stringify({events:['Seeing familiar things can bring back real memories.','The second sentence follows the video timeline.','A third sentence finishes the story.'].map((text,i)=>({tStartMs:i*5000,dDurationMs:4800,segs:[{utf8:text}]}))})
    }:{contentType:'text/html',body:fixture}));
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    await worker.evaluate(async text=>{
      await chrome.storage.local.set({settings:{...DubCore.defaults,autoStart:false,rate:1.33,syncMode:'complete',autoTranslate:false}});
      const native=fetch;globalThis.fetch=async(url,options)=>String(url).startsWith('https://translate.googleapis.com/')?new Response(JSON.stringify([[[new URL(url).searchParams.get('q').startsWith('Seeing')?text:'这是视频时间轴中的下一句。','source']]])):native(url,options);
    },first);
    const id=worker.url().split('/')[2],page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const cdp=await context.newCDPSession(page);await cdp.send('Runtime.enable');let isolated;
    cdp.on('Runtime.executionContextCreated',({context:c})=>{if(c.origin==='chrome-extension://'+id&&c.auxData?.type==='isolated')isolated=c.id});
    async function run(expression){const r=await cdp.send('Runtime.evaluate',{contextId:isolated,expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
    async function ui(fn,...args){
      const tree=(await cdp.send('DOM.getDocument',{depth:-1,pierce:true})).root;
      function find(n){if(n.attributes?.includes('progress-dub')&&n.shadowRoots?.length)return n.shadowRoots[0];for(const c of [...n.children||[],...n.shadowRoots||[]]){const hit=find(c);if(hit)return hit}}
      const object=(await cdp.send('DOM.resolveNode',{backendNodeId:find(tree).backendNodeId})).object;
      const r=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:fn.toString(),arguments:args.map(value=>({value})),returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;
    }
    async function status(){return worker.evaluate(async()=>{const t=(await chrome.tabs.query({url:'https://www.youtube.com/*'}))[0];return chrome.tabs.sendMessage(t.id,{type:'STATUS'})})}
    async function stored(){return worker.evaluate(async()=>(await chrome.storage.local.get('settings')).settings)}
    async function until(fn){const end=Date.now()+8000;while(Date.now()<end){if(await fn())return;await page.waitForTimeout(40)}throw new Error('Timed out: '+JSON.stringify(await status()))}
    async function toggle(){await worker.evaluate(async()=>{const t=(await chrome.tabs.query({url:'https://www.youtube.com/*'}))[0];await chrome.tabs.sendMessage(t.id,{type:'TOGGLE'})})}
    async function change(patch){await ui(function(values){for(const [key,value]of Object.entries(values)){const e=this.querySelector(`[name="${key}"]`);if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event(['range','color'].includes(e.type)?'input':'change',{bubbles:true}))}},patch)}
    async function clickControl(selector){
      const point=await ui(function(selector){const e=this.querySelector(selector);for(let p=e.parentElement;p&&p!==this;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;const panel=this.querySelector('.panel');panel.scrollTop+=e.getBoundingClientRect().top-panel.getBoundingClientRect().top-65;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}},selector);
      await page.mouse.click(point.x,point.y);
    }
    await page.goto('https://www.youtube.com/watch?v=style-test');await page.waitForSelector('#progress-dub');
    const inject=`globalThis.__styleTest={spoken:[],cancel:0,pause:0,play:0};{const v=document.querySelector('video');Object.defineProperties(v,{currentTime:{get:()=>Number(v.dataset.pos)},paused:{get:()=>v.dataset.paused==='true'},playbackRate:{get:()=>1},duration:{get:()=>20},ended:{get:()=>false},seeking:{get:()=>false}});v.pause=()=>__styleTest.pause++;v.play=()=>__styleTest.play++}DubSpeech.prototype.speak=function(text,options){this.stop();this.current={text,options};__styleTest.engine=this;__styleTest.spoken.push(text);options.onStart?.();this.onState(this.current)};`;
    await run(inject);await toggle();await until(async()=>(await status()).cached===3&&await run('__styleTest.engine.current?.text')===first);
    await page.locator('.ytp-caption-segment').evaluate(e=>e.textContent='YouTube 原字幕示例');
    const token=await run('__styleTest.engine.token');
    await page.locator('#progress-dub-button').click();
    assert.equal(await ui(function(){return this.querySelector('.caption-settings').open}),false);
    const names=await ui(function(){return [...this.querySelectorAll('input,select')].map(e=>e.name)});
    for(const key of C.subtitleSettingKeys)assert.equal(names.filter(n=>n===key).length,1);
    assert.ok(await ui(function(){return this.querySelector('.panel').getBoundingClientRect().height<=520}));
    pass('All subtitle controls are inside a collapsed player section, without duplicated fields or a taller panel');
    await clickControl('[data-caption-preset=learning]');await until(async()=>(await stored()).bilingual===true);
    assert.equal(await ui(function(){return this.querySelector('.sub .source').hidden}),false);
    await change({subtitleFont:'serif',subtitleSize:1.6,subtitleColor:'#ffe66d',subtitleBold:true,subtitleEdge:'outline',subtitlePosition:'top',subtitleMargin:10,subtitleWidth:74,subtitleAlign:'left',subtitleTextOpacity:.7,subtitleBackgroundOpacity:.35,subtitleWindowOpacity:.15,subtitleLineHeight:1.4,bilingualOrder:'source-first',subtitleSourceSize:.9});
    await until(async()=>(await stored()).subtitleSize===1.6&&(await stored()).bilingualOrder==='source-first');
    const style=await ui(function(){const sub=this.querySelector('.sub'),s=getComputedStyle(sub),source=getComputedStyle(sub.querySelector('.source'));return{font:s.fontFamily,size:parseFloat(s.fontSize),color:s.color,weight:s.fontWeight,shadow:s.textShadow,window:s.backgroundColor,background:getComputedStyle(sub.querySelector('.chinese')).backgroundColor,align:s.textAlign,sourceOrder:source.order,sourceSize:parseFloat(source.fontSize),top:sub.style.top,bottom:sub.style.bottom,left:sub.style.left,previewColor:getComputedStyle(this.querySelector('.caption-preview .caption-surface')).color}});
    assert.match(style.font,/SimSun/);assert.equal(style.color,'rgba(255, 230, 109, 0.7)');assert.equal(style.previewColor,style.color);
    assert.equal(style.weight,'700');assert.notEqual(style.shadow,'none');assert.equal(style.window,'rgba(0, 0, 0, 0.15)');assert.equal(style.background,'rgba(0, 0, 0, 0.35)');
    assert.equal(style.align,'left');assert.equal(style.sourceOrder,'0');assert.equal(style.bottom,'auto');assert.equal(style.top,'62px');assert.equal(style.left,'13%');assert.ok(Math.abs(style.sourceSize/style.size-.9)<.01);
    assert.equal(await run('__styleTest.engine.token'),token);assert.equal((await status()).settings.rate,1.33);assert.equal(await run('__styleTest.spoken.length'),1);
    pass('Font, color, opacity, background, outline, alignment, position and bilingual order update live and save without interrupting narration');
    await ui(function(){this.querySelector('.panel').scrollTop=this.querySelector('.caption-settings').offsetTop-50});
    await page.screenshot({path:path.join(root,'dist/字幕设置预览.png')});
    await page.keyboard.press('Escape');await page.screenshot({path:path.join(root,'dist/字幕外观预览.png')});
    await change({subtitleTiming:'video',subtitleOffset:6});
    assert.equal(await ui(function(){return this.querySelector('.sub .chinese').textContent}),'这是视频时间轴中的下一句。');
    assert.equal(await run('__styleTest.engine.current?.text'),first);assert.equal((await status()).time,0);assert.equal((await status()).narrationTime,0);
    await change({subtitleTiming:'speech'});const restoredPage=await ui(function(){return this.querySelector('.sub .chinese').textContent});assert.ok(first.startsWith(restoredPage));assert.equal(await run('__styleTest.engine.current?.text'),first);
    assert.equal(await ui(function(){return this.querySelector('[name=subtitleOffset]').disabled}),true);
    pass('Video timeline offsets affect only subtitle display; speech mode returns to the same retained sentence');
    await change({hideNativeCaptions:true});assert.equal(await page.locator('.ytp-caption-window-container').evaluate(e=>getComputedStyle(e).visibility),'hidden');
    assert.equal(await page.locator('.ytp-subtitles-button').getAttribute('aria-pressed'),'true');
    await change({subtitleTiming:'video',subtitleOffset:-10});assert.equal(await ui(function(){return this.querySelector('.sub').hidden}),true);
    assert.equal(await page.locator('.ytp-caption-window-container').evaluate(e=>getComputedStyle(e).visibility),'visible');
    await change({subtitleTiming:'speech'});assert.equal(await page.locator('.ytp-caption-window-container').evaluate(e=>getComputedStyle(e).visibility),'hidden');
    await change({subtitle:false});assert.equal(await page.locator('.ytp-caption-window-container').evaluate(e=>getComputedStyle(e).visibility),'visible');
    assert.equal(await run('__styleTest.engine.token'),token);
    await change({subtitle:true});assert.equal(await page.locator('.ytp-caption-window-container').evaluate(e=>getComputedStyle(e).visibility),'hidden');
    await toggle();assert.equal(await page.locator('.ytp-caption-window-container').evaluate(e=>getComputedStyle(e).visibility),'visible');
    pass('Native captions can be hidden while capture stays enabled and restore when overlay captions or dubbing are turned off');
    await until(async()=>(await stored()).subtitleColor==='#ffe66d'&&(await stored()).hideNativeCaptions===true);
    await page.reload();await page.waitForSelector('#progress-dub');
    assert.equal(await ui(function(){return this.querySelector('[name=subtitleColor]').value}),'#ffe66d');
    assert.equal(await ui(function(){return this.querySelector('[name=subtitleSize]').value}),'1.6');
    assert.equal(await ui(function(){return this.querySelector('[name=bilingualOrder]').value}),'source-first');
    pass('Subtitle preferences survive refreshing the video page');
    await run(inject);await toggle();await until(async()=>(await status()).cached===3);
    await page.locator('#progress-dub-button').click();await clickControl('.caption-reset');
    await until(async()=>(await stored()).subtitleSize===.75&&(await stored()).bilingual===true);
    assert.equal((await status()).settings.rate,1.33);assert.equal((await status()).mode,'complete');assert.equal(await run('__styleTest.spoken.length'),1);
    pass('Resetting subtitle defaults preserves reading speed, complete mode and the current utterance');
    await change({subtitleSize:2.2,bilingual:true,subtitleWidth:50,subtitlePosition:'top',subtitleMargin:10});
    await page.locator('#movie_player').evaluate(e=>{e.style.width='320px';e.style.height='240px'});await page.waitForTimeout(200);
    const fit=await ui(function(){const r=this.querySelector('.sub').getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,font:parseFloat(getComputedStyle(this.querySelector('.sub')).fontSize)}});
    const playerRect=await page.locator('#movie_player').boundingBox();
    assert.ok(fit.top>=playerRect.y&&fit.bottom<=playerRect.y+playerRect.height);assert.ok(fit.left>=playerRect.x&&fit.right<=playerRect.x+playerRect.width);
    await page.locator('#movie_player').evaluate(e=>{e.style.width='1100px';e.style.height='620px'});await page.waitForTimeout(200);
    assert.ok(await ui(function(){return parseFloat(getComputedStyle(this.querySelector('.sub')).fontSize)})>fit.font);
    pass('Changing player dimensions resizes subtitles and fits the complete text inside a small player');
    const options=await context.newPage();options.on('pageerror',e=>errors.push(e.message));await options.goto(`chrome-extension://${id}/options.html`);
    await options.waitForFunction(()=>document.querySelector('#subtitleSize').value==='2.2');
    await options.locator('[data-caption-preset=cinema]').click();assert.equal(await options.locator('#subtitleColor').inputValue(),'#ffe66d');
    await options.locator('button[type=submit]').click();await options.waitForFunction(()=>document.querySelector('#message').textContent.includes('已保存'));
    await until(async()=>(await status()).settings.subtitleSize===.75&&(await status()).settings.subtitleEdge==='outline');
    pass('The advanced editor shares subtitle controls, previews and presets, and its save reaches the active video');
    assert.deepEqual(errors,[]);assert.equal(await run('__styleTest.pause'),0);assert.equal(await run('__styleTest.play'),0);
    fs.writeFileSync(path.join(root,'dist/subtitle-settings-report.json'),JSON.stringify({version:JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'))).version,actualExtensionLoaded:true,fixture:true,voiceSubstituted:true,checks,style,smallPlayer:fit,errors},null,2));
  }finally{await context.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
