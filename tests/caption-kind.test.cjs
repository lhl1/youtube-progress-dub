const {test}=require('node:test'),assert=require('node:assert/strict');
require('../YouTube中文同传/vendor/syntax.js');
const C=require('../YouTube中文同传/core.js'),sample=require('./fixtures/netflix.cjs');

test('only explicit ASR metadata enables semantic processing; language or translated Chinese does not imply ASR',()=>{
  assert.equal(C.isAutomaticTrack({kind:'asr'}),true);
  assert.equal(C.isAutomaticTrack({vssId:'a.en'}),true);
  assert.equal(C.isAutomaticTrack(null,'https://www.youtube.com/api/timedtext?kind=asr&lang=en&tlang=zh-Hans'),true);
  for(const t of [{vssId:'.en',languageCode:'en'},{vssId:'.zh-CN',languageCode:'zh-CN'},null])assert.equal(C.isAutomaticTrack(t,'https://www.youtube.com/api/timedtext?lang=en&tlang=zh-Hans'),false);
});
test('native captions retain original row boundaries and timing, including multiple sentences and an unfinished fragment',()=>{
  const rows=[{start:1,end:4,text:'First sentence. Second sentence! Until'},{start:4,end:7,text:'you see real memories.'},{start:7,end:29,text:sample.text}];
  const original=JSON.stringify(rows),cues=C.prepareCues(rows,{language:'en'});
  assert.equal(JSON.stringify(rows),original);
  assert.deepEqual(cues.map(({start,end,text})=>({start,end,text})),rows);
  assert.ok(cues.every(c=>c.automatic===false));
});
test('captured requests match their own track and ambiguous same-language captures preserve authored boundaries',()=>{
  const base='https://www.youtube.com/api/timedtext?lang=en',tracks=[{vssId:'a.en',baseUrl:base+'&signature=auto'},{vssId:'.en',baseUrl:base+'&signature=native'}];
  assert.equal(C.isAutomaticCapture(tracks,base+'&signature=native&fmt=json3&tlang=zh-Hans'),false);
  assert.equal(C.isAutomaticCapture(tracks,base+'&signature=auto&fmt=json3'),true);
  assert.equal(C.isAutomaticCapture(tracks,base+'&signature=renewed'),false);
  assert.equal(C.isAutomaticCapture([],base),false);
  assert.equal(C.isAutomaticCapture([],base+'&kind=asr&tlang=zh-Hans'),true);
});
test('native live rows are published without an inferred sentence boundary or tail delay',()=>{
  const rows=[{start:0,end:3,text:'直到你看到'},{start:3,end:8,text:'真正的回忆。下一句'}];
  assert.deepEqual(C.prepareCues(rows,{language:'zh-CN',live:true,automatic:false}).map(c=>c.text),rows.map(r=>r.text));
});
test('ASR still receives semantic grouping before translation and stable complete-reading identifiers',()=>{
  const cues=C.prepareCues(sample.rows,{language:'en',automatic:true});
  assert.deepEqual(cues.map(c=>c.text),sample.sentences);
  assert.ok(cues.every(c=>c.automatic===true));
  assert.deepEqual(cues.map(c=>c.id),C.prepareCues(sample.rows,{language:'en',automatic:true}).map(c=>c.id));
});
test('native and ASR cache entries are isolated even for identical text',()=>{
  const cue={text:'Some caption text'};
  assert.notEqual(C.cacheKey({...cue,automatic:false},'en',C.defaults),C.cacheKey({...cue,automatic:true},'en',C.defaults));
});
