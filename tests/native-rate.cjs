const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),extension=path.join(root,'YouTube中文同传');
(async()=>{
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'dub-native-rate-')),{
    executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,
    ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run']
  });
  try{
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=worker.url().split('/')[2];
    const page=await context.newPage();await page.goto(`chrome-extension://${id}/options.html`);
    await page.waitForFunction(()=>speechSynthesis.getVoices().some(v=>/^zh-CN/i.test(v.lang)));
    await page.evaluate(()=>document.querySelector('#volume').value='0');
    await page.locator('#testVoice').click(); // Real gesture; all measurements muted.
    await page.evaluate(()=>engine.stop());
    const result=await page.evaluate(async()=>{
      const text='你好，这是中文朗读速度测试。请保持视频继续播放。';
      const voices=speechSynthesis.getVoices().filter(v=>/^zh-CN/i.test(v.lang));
      const voice=voices.find(v=>/Natural|Online/i.test(v.name))||voices[0],rows=[];
      for(const rate of [.8,1.6,3.0]) {
        rows.push(await new Promise(resolve=>{
          let started=0;const timer=setTimeout(()=>{engine.stop();resolve({rate,error:'timeout'})},25000);
          const native=speechSynthesis.speak.bind(speechSynthesis);let sentRate;
          speechSynthesis.speak=u=>{sentRate=u.rate;native(u)};
          engine.speak(text,{voice:voice.name,rate,volume:0,onStart:()=>{started=performance.now()},onDone:reason=>{if(reason==='cancel')return;clearTimeout(timer);resolve({rate,sentRate,voice:engine.lastVoice,reason,durationMs:performance.now()-started})}});
          // Restore before the next sample; the engine keeps the same native API.
          speechSynthesis.speak=native;
        }));
      }
      return {voice:voice.name,text,rows};
    });
    fs.writeFileSync(path.join(root,'dist/native-rate-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
    if(!process.argv.includes('--probe')){
      assert.ok(result.rows.every(r=>r.reason==='end'&&Math.abs(r.sentRate-r.rate)<.00001));
      assert.ok(result.rows[1].durationMs<result.rows[0].durationMs*.85,'Faster setting must measurably reduce native speech duration');
    }
  }finally{await context.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
