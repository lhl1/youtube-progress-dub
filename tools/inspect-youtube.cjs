const {chromium} = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
(async () => {
  const extension=path.resolve(__dirname,'../YouTube中文同传');
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'dub-live-inspect-')), {
    executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,
    viewport:{width:1440,height:900},ignoreDefaultArgs:['--disable-extensions'],
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run']
  });
  try {
    const page=await context.newPage();const errors=[];const playerCss=[];page.on('pageerror', e=>errors.push(e.message.slice(0,300)));
    page.on('response',async r=>{if(/\/s\/player\/.*\.css/.test(r.url()))try{playerCss.push({url:r.url(),text:await r.text()})}catch{}});
    await page.goto(process.argv[2] || 'https://www.youtube.com/watch?v=jNQXAC9IVRw',{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(8000);
    const result=await page.evaluate(()=>{
      const p=document.querySelector('#movie_player');
      const describe=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {tag:el.tagName,class:el.className,id:el.id,parent:el.parentElement.className,display:s.display,visibility:s.visibility,width:s.width,height:s.height,padding:s.padding,flex:s.flex,lineHeight:s.lineHeight,opacity:s.opacity,rect:{x:r.x,y:r.y,w:r.width,h:r.height},html:el.outerHTML.slice(0,6000)}};
      return {url:location.href,title:document.title,playability:window.ytInitialPlayerResponse?.playabilityStatus?.status,
        player:p?describe(p):null,controls:[...(p?.querySelectorAll('[class*="controls"], [class*="settings-button"], [class*="subtitles-button"], #progress-dub-button')||[])].map(describe),
        dubHostCount:document.querySelectorAll('#progress-dub').length,iconCount:document.querySelectorAll('#progress-dub-button').length,
        settingsParent:p?.querySelector('.ytp-settings-button')?.parentElement.className,
        chrome:p?.querySelector('.ytp-chrome-bottom')?.outerHTML,
        bodyHint:document.body.innerText.slice(0,600)};
    });result.errors=errors;
    const label=process.argv[3]||'after';
    fs.writeFileSync(path.resolve(__dirname,`../dist/live-player-${label}.json`),JSON.stringify(result,null,2));
    fs.writeFileSync(path.resolve(__dirname,'../dist/live-player-css.json'),JSON.stringify(playerCss,null,2));
    console.log(JSON.stringify({...result,chrome:undefined,player:result.player&&{...result.player,html:undefined},controls:result.controls.filter(c=>['ytp-right-controls','ytp-right-controls-left','ytp-right-controls-right','progress-dub-button'].some(s=>c.id===s||c.class===s)||c.class.includes('ytp-settings-button')).map(c=>({...c,html:undefined}))},null,2));
    if(label==='after') {
      const assert=require('node:assert/strict');assert.equal(result.iconCount,1);assert.equal(result.dubHostCount,1);
      assert.equal(result.controls.find(c=>c.id==='progress-dub-button')?.parent,result.settingsParent);assert.deepEqual(errors,[]);
      // The blocked video remains blocked; this checks the extension settings
      // independently, without altering YouTube's login requirement or player.
      await page.locator('#progress-dub-button').evaluate(el=>el.click());
      assert.equal(await page.locator('#progress-dub-button').getAttribute('aria-expanded'),'true');
      console.log('Actual YouTube DOM: one icon beside native settings; opens successfully; zero mounting exceptions.');
    }
    await page.screenshot({path:path.resolve(__dirname,`../dist/真实YouTube-${label}.png`)});
  } finally {await context.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
