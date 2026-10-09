// A local UI harness using the DOM and CSS captured from the real YouTube
// response. It exercises visible geometry without changing the live login gate.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
  const capture=JSON.parse(fs.readFileSync(path.join(root,'dist/live-player-after.json')));
  const styles=JSON.parse(fs.readFileSync(path.join(root,'dist/live-player-css.json')));
  assert.ok(styles.length);assert.ok(capture.chrome.includes('ytp-right-controls-left'));
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1040,height:640},deviceScaleFactor:2}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<html lang="zh-CN"><body style="margin:0;background:#111"><div id="movie_player"></div></body></html>');
    for(const sheet of styles)await page.addStyleTag({content:sheet.text});
    await page.evaluate(({classes,html})=>{
      const p=document.querySelector('#movie_player');
      p.className=classes.split(' ').filter(c=>!['unstarted-mode','ytp-hide-controls','ytp-hide-info-bar'].includes(c)).join(' ');
      p.style.cssText='width:996px;height:560px;margin:20px auto;background:linear-gradient(135deg,#39332e,#171717);--yt-delhi-pill-height:40px;--yt-delhi-pill-top-height:8px;--yt-delhi-bottom-controls-height:56px;--yt-delhi-big-mode-pill-height:48px;--yt-delhi-big-mode-pill-top-height:12px;--yt-delhi-big-mode-bottom-controls-height:72px';
      p.innerHTML=html; p.querySelector('#progress-dub-button')?.remove();
      p.querySelector('.ytp-chrome-bottom').style.opacity='1';p.querySelector('.ytp-chrome-bottom').style.display='block';
      p.querySelector('.ytp-subtitles-button').style.display='';
      const label=document.createElement('p');label.style.cssText='color:#fff;padding:40px;font:18px Arial';label.textContent='真实 YouTube 控制栏结构与样式 · 本地显示验证';p.prepend(label);
    },{classes:capture.player.class,html:capture.chrome});
    await page.addScriptTag({path:path.join(root,'YouTube中文同传/core.js')});
    await page.addScriptTag({path:path.join(root,'YouTube中文同传/subtitle-ui.js')});
    await page.addScriptTag({path:path.join(root,'YouTube中文同传/player-ui.js')});
    await page.evaluate(()=>{
      globalThis.dubView=new DubPlayerUI(document.querySelector('#movie_player'),{getVoices:()=>[],onToggle:()=>{},onRetry:()=>{},onPreview:()=>{},onExport:()=>{},onAdvanced:()=>{},onClearCache:()=>{},onTrack:()=>{},onChange:()=>{},onSave:async()=>{}});
      dubView.sync(DubCore.defaults);dubView.render({active:false,status:'实际控制栏布局检查',error:''});
    });
    const check=async label=>{
      const icon=page.locator('#progress-dub-button');await icon.waitFor({state:'visible'});
      const geometry=await icon.evaluate(el=>{
        const r=el.getBoundingClientRect(),gear=el.parentElement.querySelector('.ytp-settings-button').getBoundingClientRect();
        return {parent:el.parentElement.className,rect:{x:r.x,y:r.y,w:r.width,h:r.height},gear:{x:gear.x,y:gear.y,w:gear.width,h:gear.height},beforeGear:el.nextElementSibling.classList.contains('ytp-settings-button'),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===el};
      });
      assert.equal(geometry.parent,'ytp-right-controls-left');assert.equal(geometry.beforeGear,true);assert.equal(geometry.hit,true);
      assert.ok(geometry.rect.w>0&&geometry.rect.h>0);assert.ok(geometry.rect.x+geometry.rect.w<=geometry.gear.x+1);
      await icon.click();assert.equal(await icon.getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');
      return {label,...geometry};
    };
    const checks=[await check('actual modern player CSS, standard size')];
    const interactionChecks=[];
    const pass=name=>{interactionChecks.push(name);console.log('PASS',name)};
    const open=async()=>{await page.locator('#progress-dub-button').click();assert.equal(await page.evaluate(()=>dubView.open),true)};
    await open();
    assert.equal(await page.evaluate(()=>dubView.panel.matches(':popover-open')),true);
    assert.equal(await page.evaluate(()=>dubView.shadow.querySelector('.body').firstElementChild.querySelector('select').name),'track');
    assert.equal(await page.evaluate(()=>!!dubView.shadow.querySelector('.tracks').closest('details')),false);
    pass('Subtitle source is the first always-visible setting');
    await page.evaluate(()=>{dubView.shadow.querySelector('[name=autoStart]').click()});
    assert.equal(await page.evaluate(()=>dubView.open),true);
    pass('Interacting with settings keeps the panel open');
    await page.evaluate(()=>{
      const r=dubView.panel.getBoundingClientRect(),cover=document.createElement('div');cover.id='cover';
      cover.style.cssText=`position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:2147483647;background:red`;document.body.append(cover);
      const p=document.querySelector('#movie_player');p.style.zIndex='0';p.style.overflow='hidden';
    });
    assert.equal(await page.evaluate(()=>{
      const r=dubView.panel.getBoundingClientRect();return document.elementFromPoint(r.left+20,r.top+20)===dubView.host;
    }),true);
    pass('Top-layer panel remains clickable above a maximum-z-index outside element and clipped player');
    await page.screenshot({path:path.join(root,'dist/面板层级与字幕来源.png')});
    await page.evaluate(()=>document.querySelector('#cover').remove());
    await page.locator('.ytp-settings-button').click();assert.equal(await page.evaluate(()=>dubView.open),false);
    pass('Mouse click on the native settings gear collapses the dubbing panel');
    await open();await page.keyboard.press('Tab'); // Move into other native controls explicitly below.
    await page.evaluate(()=>document.querySelector('.ytp-subtitles-button').focus());
    assert.equal(await page.evaluate(()=>dubView.open),false);
    await page.keyboard.press('Enter');
    pass('Keyboard focus on another native control also closes the panel');
    await open();await page.evaluate(()=>document.querySelector('.ytp-settings-button').click());
    assert.equal(await page.evaluate(()=>dubView.open),false);
    pass('Native click activation without pointerdown closes the panel');
    await open();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement===dubView.icon),true);
    pass('Escape closes the panel and returns focus to the dubbing icon');
    await page.evaluate(()=>document.querySelector('.ytp-fullscreen-button').addEventListener('click',()=>document.querySelector('#movie_player').requestFullscreen()));
    await open();await page.locator('.ytp-fullscreen-button').click();
    await page.waitForFunction(()=>!!document.fullscreenElement);
    assert.equal(await page.evaluate(()=>dubView.open),false);
    await open();
    assert.equal(await page.evaluate(()=>{
      const r=dubView.panel.getBoundingClientRect();return dubView.panel.matches(':popover-open')&&document.elementFromPoint(r.left+20,r.top+20)===dubView.host;
    }),true);
    await page.evaluate(()=>document.exitFullscreen());await page.waitForFunction(()=>!document.fullscreenElement&&!dubView.open);
    assert.equal(await page.evaluate(()=>dubView.open),false);
    pass('Panel opens above a real fullscreen player and closes cleanly on entering or leaving fullscreen');
    await page.screenshot({path:path.join(root,'dist/新版YouTube控制栏-实测样式.png')});
    await page.locator('.ytp-right-controls').screenshot({path:path.join(root,'dist/图标位置-真实样式验证.png')});
    await page.evaluate(()=>document.querySelector('#movie_player').classList.add('ytp-big-mode'));
    checks.push(await check('actual modern player CSS, fullscreen-style large controls'));
    assert.deepEqual(errors,[]);
    const result={sourceUrl:capture.url,sourcePlayerClasses:capture.player.class,capturedCss:styles.map(s=>s.url),localLayoutHarness:true,livePlayability:capture.playability,checks,interactionChecks,errors};
    fs.writeFileSync(path.join(root,'dist/real-player-layout-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
