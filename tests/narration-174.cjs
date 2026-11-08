const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),extension=path.join(root,'YouTube中文同传'),checks=[],errors=[];
const raw='complicated '.repeat(140).trim();
const translated='我读过《三体》，完成了89%的内容，开头讲解场景和背景信息，随后介绍这次实验中的观察方法，接着说明不同条件下的变化过程，然后详细比较这些变化所带来的影响，在此基础上讨论相关结果和可能的原因，最后总结这些发现对于未来研究的启发。';
const fixture=`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#111;color:white}#movie_player{position:relative;width:1000px;height:620px;margin:20px auto}.ytp-chrome-bottom{position:absolute;bottom:0;right:0;height:48px}.ytp-right-controls{display:flex;height:48px}.ytp-button{width:48px;height:48px;background:none;color:white;border:0}</style></head><body><div id="movie_player"><video class="html5-main-video" data-pos="0" data-paused="false" data-seeking="false"></video><div class="ytp-chrome-bottom"><div class="ytp-right-controls"><button class="ytp-button ytp-subtitles-button" aria-pressed="false">CC</button><button class="ytp-button ytp-settings-button">⚙</button></div></div></div><script>
function metadata(id){const chinese=id==='chinese-original',authored=id==='authored',kind=authored?'':'asr',lang=chinese?'zh-CN':'en';window.ytInitialPlayerResponse={videoDetails:{videoId:id,...(chinese?{defaultAudioLanguage:'zh-CN'}:{})},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?v='+id+'&lang='+lang+(kind?'&kind=asr':''),languageCode:lang,vssId:(kind?'a.':'.')+lang,kind,name:{simpleText:lang},isTranslatable:false},...(id==='english-with-chinese-caption'?[{baseUrl:'https://www.youtube.com/api/timedtext?v='+id+'&lang=zh-CN',languageCode:'zh-CN',vssId:'.zh-CN',name:{simpleText:'Chinese'},isTranslatable:false}]:[])]}}};}
metadata(new URL(location.href).searchParams.get('v'));window.navigate=id=>{metadata(id);history.pushState({},'','/watch?v='+id);document.dispatchEvent(new Event('yt-navigate-finish'))};
const v=document.querySelector('video');Object.defineProperties(v,{currentTime:{get:()=>Number(v.dataset.pos)},paused:{get:()=>v.dataset.paused==='true'},playbackRate:{get:()=>Number(v.dataset.rate||1)},duration:{get:()=>120},ended:{get:()=>false},seeking:{get:()=>v.dataset.seeking==='true'},readyState:{get:()=>4}});v.volume=.8;
</script></body></html>`;
(async()=>{
const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'dub-174-')),{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,viewport:{width:1120,height:720},ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run']});
const pass=x=>{checks.push(x);console.log('PASS',x)};
try{
await context.route('https://www.youtube.com/**',r=>r.fulfill(r.request().url().includes('/api/timedtext')?{contentType:'application/json',body:JSON.stringify({events:[{tStartMs:0,dDurationMs:120000,segs:[{utf8:new URL(r.request().url()).searchParams.get('lang')==='zh-CN'?'中文原声示例。':raw}]}]})}:{contentType:'text/html',body:fixture}));
const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
await worker.evaluate(async text=>{await chrome.storage.local.set({settings:{...DubCore.defaults,autoStart:true,autoTranslate:false,voice:'',syncMode:'complete'}});const native=fetch;globalThis.fetch=async(u,o)=>String(u).startsWith('https://translate.googleapis.com/')?new Response(JSON.stringify([[[text,new URL(u).searchParams.get('q')]]])):native(u,o);},translated);
const id=worker.url().split('/')[2],page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const cdp=await context.newCDPSession(page);await cdp.send('Runtime.enable');let isolated;
cdp.on('Runtime.executionContextCreated',({context:c})=>{if(c.origin===`chrome-extension://${id}`&&c.auxData?.type==='isolated')isolated=c.id});
async function run(expression){const r=await cdp.send('Runtime.evaluate',{contextId:isolated,expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function status(){return worker.evaluate(async()=>{const t=(await chrome.tabs.query({url:'https://www.youtube.com/*'}))[0];return chrome.tabs.sendMessage(t.id,{type:'STATUS'})});}
async function until(fn){for(let i=0;i<180;i++){if(await fn())return;await page.waitForTimeout(40);}throw new Error('Timed out '+JSON.stringify(await status()));}
await page.goto('https://www.youtube.com/watch?v=long-asr');await page.waitForSelector('#progress-dub');
await run(`globalThis.__test={ready:false,spoken:[],calls:0,videoCalls:0,deny:false};
{const v=document.querySelector('video');Object.defineProperties(v,{currentTime:{get:()=>Number(v.dataset.pos)},paused:{get:()=>v.dataset.paused==='true'},playbackRate:{get:()=>Number(v.dataset.rate||1)},duration:{get:()=>120},ended:{get:()=>false},seeking:{get:()=>v.dataset.seeking==='true'},readyState:{get:()=>4}});v.pause=()=>__test.videoCalls++;v.play=()=>__test.videoCalls++;}
{const original=DubSpeech.prototype.speak;const synthesis={paused:false,speaking:true,pending:false,getVoices:()=>__test.ready?[{name:'Test Chinese',lang:'zh-CN',localService:true}]:[],speak(u){__test.last=u;__test.spoken.push(u.text);if(__test.deny){u.onerror({error:'not-allowed'});return;}u.onstart();},pause(){this.paused=true;},resume(){this.paused=false;},cancel(){}};
DubSpeech.prototype.voices=function(){return synthesis.getVoices()};DubSpeech.prototype.speak=function(t,o){this.synthesis=synthesis;this.Utterance=class{constructor(text){this.text=text}};__test.engine=this;__test.calls++;return original.call(this,t,o)};}`);
await until(async()=>(await status()).active&&(await status()).metrics.speechErrors>0);
assert.equal(await run('__test.spoken.length'),0);assert.equal((await status()).cues,1);
await run('__test.ready=true;window.speechSynthesis.dispatchEvent(new Event("voiceschanged"))');
await until(async()=>await run('!!__test.engine.current?.utterance'));
assert.ok((await run('__test.spoken[0]')).includes('三体'));assert.ok((await run('__test.spoken[0]')).includes('百分之八十九'));assert.ok(!/[《》%]/.test(await run('__test.spoken[0]')));
assert.equal(await run('__test.engine.current.captionText'),translated);
pass('Automatic startup recovers when Chinese voices arrive late, without toggling; spoken titles/percentages are normalized while captions stay unchanged');
const token=await run('__test.engine.token');
await run(`{const v=document.querySelector('video');v.dataset.paused='true';v.dispatchEvent(new Event('pause'));v.dispatchEvent(new Event('waiting'));v.dataset.paused='false';v.dispatchEvent(new Event('play'));}`);
assert.equal(await run('__test.engine.current.paused'),false);assert.equal(await run('__test.engine.token'),token);
pass('Playing a ready video after pause/waiting resumes the same narration without a manual switch');
async function seek(at){await run(`{const v=document.querySelector('video');v.dataset.seeking='true';v.dataset.pos=${at};v.dispatchEvent(new Event('seeking'));v.dataset.seeking='false';v.dispatchEvent(new Event('seeked'));}`);await until(async()=>await run('!!__test.engine.current?.utterance'));return run('__test.engine.current.options.captionOffset');}
const first=await seek(62),second=await seek(95),back=await seek(38);
assert.ok(first>0);assert.ok(second>first);assert.ok(back<second);assert.ok(back>0);assert.equal((await status()).cues,1);assert.equal(await run('__test.engine.current.captionText'),translated);
assert.equal(await run('__test.engine.current.options.cue.text'),raw);assert.equal(await run('__test.videoCalls'),0);
pass('Forward and backward seeking within one two-minute ASR unit choose a nearby reading position without replacing or splitting its subtitle text');
await run(`document.querySelector('video').dataset.pos=0;__test.deny=true`);await page.evaluate(()=>navigate('blocked'));
await until(async()=>(await status()).voiceNeedsGesture);const blocked=await run('__test.calls');await page.waitForTimeout(500);assert.equal(await run('__test.calls'),blocked);
await run('__test.deny=false');await page.locator('#movie_player').click({position:{x:80,y:80}});
await until(async()=>(await status()).active&&!(await status()).voiceNeedsGesture&&await run('!!__test.engine.current?.utterance'));
pass('A genuine browser speech-activation block retains the queue and recovers on a page click, without an off/on cycle');
await run(`__test.engine.stop();__test.ready=false`);
// Change the actual inline control through its closed shadow root using CDP.
const tree=(await cdp.send('DOM.getDocument',{depth:-1,pierce:true})).root;
function shadow(n){if(n.attributes?.includes('progress-dub')&&n.shadowRoots?.length)return n.shadowRoots[0];for(const c of [...n.children||[],...n.shadowRoots||[]]){const hit=shadow(c);if(hit)return hit;}}
const object=(await cdp.send('DOM.resolveNode',{backendNodeId:shadow(tree).backendNodeId})).object;
await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:`function(){const e=this.querySelector('[name=syncMode]');e.value='follow';e.dispatchEvent(new Event('change',{bubbles:true}));}`,returnByValue:true});
await until(async()=>(await status()).mode==='follow');await page.evaluate(()=>navigate('follow-retry'));
await until(async()=>(await status()).active&&(await status()).metrics.speechErrors>0);
await run(`__test.ready=true;window.speechSynthesis.dispatchEvent(new Event('voiceschanged'))`);
await until(async()=>await run('!!__test.engine.current?.utterance'));
await run(`for(let i=0;i<30&&__test.engine.current;i++)__test.last.onend()`);
await until(async()=>!await run('!!__test.engine.current'));
const completedFollow=await run('__test.calls');
await run(`window.speechSynthesis.dispatchEvent(new Event('voiceschanged'))`);
await page.locator('#movie_player').click({position:{x:80,y:80}});await page.waitForTimeout(350);
assert.equal(await run('__test.calls'),completedFollow);
pass('Follow mode recovers delayed voices, then clears retries after success so later voice events or clicks do not replay a completed cue');
await page.evaluate(()=>navigate('chinese-original'));await until(async()=>(await status()).chineseOriginal&&!(await status()).active);
assert.equal(await page.locator('video').evaluate(v=>v.volume),.8);const chineseCalls=await run('__test.calls');await page.waitForTimeout(1100);assert.equal(await run('__test.calls'),chineseCalls);
pass('Chinese original audio skips automatic dubbing and restores the original volume');
await page.evaluate(()=>navigate('english-with-chinese-caption'));await until(async()=>(await status()).active&&!(await status()).chineseOriginal&&await run('!!__test.engine.current'));
pass('A Chinese caption track on an English ASR video does not falsely classify its original audio as Chinese');
await page.evaluate(()=>navigate('authored'));await until(async()=>(await status()).active&&!(await status()).automatic&&await run('__test.engine.current?.options.cue?.automatic===false'));
assert.equal(await seek(90),0);assert.equal(await run('__test.engine.current.options.cue.text'),raw);
pass('Authored captions retain their full original entry and reading boundary after a seek');
assert.deepEqual(errors,[]);
fs.writeFileSync(path.join(root,'dist/narration-174-report.json'),JSON.stringify({version:JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'))).version,actualExtensionLoaded:true,fixture:true,voiceSubstituted:true,checks,seekOffsets:{first,second,back},errors},null,2));
}finally{await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
