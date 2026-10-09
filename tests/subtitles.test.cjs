const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../YouTube中文同传/core.js');global.DubCore=C;
const UI=require('../YouTube中文同传/subtitle-ui.js');

test('existing installations receive subtitle defaults while preserving voice, speed, bilingual and service choices',()=>{
  const s=C.sanitizeSettings({rate:1.63,voice:'Old Voice',bilingual:true,provider:'custom',apiKey:'secret'});
  assert.equal(s.rate,1.63);assert.equal(s.voice,'Old Voice');assert.equal(s.bilingual,true);assert.equal(s.provider,'custom');
  assert.equal(s.subtitleSize,.75);assert.equal(s.subtitleTiming,'speech');assert.equal(s.hideNativeCaptions,true);
  assert.equal(s.subtitleBackgroundOpacity,0);
});

test('subtitle controls bound dimensions and opacity, validate enums and reject injected CSS',()=>{
  const s=C.sanitizeSettings({subtitleSize:100,subtitleMargin:-20,subtitleWidth:NaN,subtitleOffset:999,subtitleTextOpacity:0,subtitlePosition:'fixed',subtitleFont:'url(evil)',subtitleColor:'#fff; background:url(evil)',subtitleBackgroundColor:['#AABBCC']});
  assert.equal(s.subtitleSize,2.2);assert.equal(s.subtitleMargin,0);assert.equal(s.subtitleWidth,86);assert.equal(s.subtitleOffset,10);
  assert.equal(s.subtitleTextOpacity,.25);assert.equal(s.subtitlePosition,'bottom');assert.equal(s.subtitleFont,'sans');
  assert.equal(s.subtitleColor,'#ffffff');assert.equal(s.subtitleBackgroundColor,'#aabbcc');
  assert.ok(!JSON.stringify(UI.variables(s)).includes('evil'));
});

test('subtitle opacity affects text and its background separately and bilingual styling has independent size and order',()=>{
  const v=UI.variables({...C.defaults,subtitleColor:'#ffff00',subtitleTextOpacity:.5,subtitleBackgroundOpacity:0,subtitleWindowOpacity:.3,bilingual:true,bilingualOrder:'source-first',subtitleSourceSize:.85,subtitleSize:1.5},20);
  assert.equal(v['--dub-color'],'rgba(255, 255, 0, 0.5)');assert.equal(v['--dub-background'],'rgba(0, 0, 0, 0)');
  assert.equal(v['--dub-window'],'rgba(0, 0, 0, 0.3)');assert.equal(v['--dub-font-size'],'30px');
  assert.equal(v['--dub-source-size'],'85%');assert.equal(v['--dub-source-order'],'0');assert.equal(v['--dub-chinese-order'],'1');
});

test('subtitle presets only touch caption controls and never overwrite voice, translation or playback settings',()=>{
  const original={...C.defaults,rate:1.77,voice:'Chosen',autoStart:true,provider:'custom',apiKey:'secret',syncMode:'complete',subtitleTiming:'video',subtitleOffset:2.1,hideNativeCaptions:true};
  for(const preset of Object.values(C.subtitlePresets)){
    const s=C.sanitizeSettings({...original,...preset.patch});
    for(const k of ['rate','voice','autoStart','provider','apiKey','syncMode','subtitleTiming','subtitleOffset','hideNativeCaptions'])assert.equal(s[k],original[k]);
    assert.ok(Object.keys(preset.patch).every(k=>C.subtitleSettingKeys.includes(k)));
  }
});

test('speech-following subtitles keep the spoken sentence even when the video is several sentences ahead',()=>{
  const rows=[{start:0,end:4,text:'first'},{start:4.1,end:8,text:'second'},{start:8.1,end:12,text:'third'}];
  assert.equal(C.subtitleCue(rows,10,{...C.defaults,subtitleOffset:8},rows[0],rows[1]),rows[0]);
  assert.equal(C.subtitleCue(rows,10,C.defaults,null,rows[1]),rows[1]);
});

test('video-following subtitle offsets advance or delay only the displayed cue and ignore a lagging voice',()=>{
  const rows=[{start:0,end:4,text:'first'},{start:5,end:9,text:'second'}],s={...C.defaults,subtitleTiming:'video'};
  assert.equal(C.subtitleCue(rows,2,{...s,subtitleOffset:4},rows[0]),rows[1]);
  assert.equal(C.subtitleCue(rows,6,{...s,subtitleOffset:-4},rows[1]),rows[0]);
  assert.equal(C.subtitleCue(rows,4.5,s,rows[0]),null);assert.equal(C.subtitleCue(rows,50,s,rows[0]),null);
  assert.deepEqual(rows.map(c=>[c.start,c.end]),[[0,4],[5,9]]);
});

test('changing caption styles never invalidates translated sentence cache keys',()=>{
  const cue={text:'Real memories.'};
  assert.equal(C.cacheKey(cue,'en',C.defaults),C.cacheKey(cue,'en',{...C.defaults,subtitleColor:'#ffff00',subtitleTiming:'video',subtitleOffset:5}));
});
