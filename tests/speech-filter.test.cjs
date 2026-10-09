const {test}=require('node:test'),assert=require('node:assert/strict');
global.DubCore=require('../YouTube中文同传/core.js');
const C=global.DubCore,Speech=require('../YouTube中文同传/speech.js');
class Utterance{constructor(text){this.text=text;}}
function fake(){return {spoken:[],cancellations:0,paused:false,getVoices:()=>[{name:'Chinese',lang:'zh-CN',localService:true}],speak(u){this.spoken.push(u);},pause(){this.paused=true;},resume(){this.paused=false;},cancel(){this.cancellations++;}};}

test('square bracket contents, symbols and full emoji graphemes become pauses while raw captions stay intact',()=>{
  for(const text of ['你好[音乐]世界[__]再见。','你好［音乐］世界【掌声[轻微]】再见。','你好[音乐未结束','你好✨👍🏽👩‍👩‍👧‍👦🇨🇳1️⃣世界。']){
    const plan=C.narrationParts(text),spoken=plan.filter(p=>p.text);
    assert.ok(plan.some(p=>p.pause));
    assert.ok(spoken.every(p=>p.text===text.slice(p.from,p.to)));
    assert.equal(spoken.map(p=>p.text).join(''),text.startsWith('你好[音乐未')?'你好':text.includes('再见')?'你好世界再见。':'你好世界。');
    assert.ok(plan.every((p,i)=>p.to>p.from&&(!i||p.from>=plan[i-1].to)));
  }
});
test('normal numbers, decimals, Chinese sentence punctuation and lexical apostrophes remain speakable',()=>{
  const text="你好，版本3.14已经发布！Don't worry. 数量25% + 3 = 28。";
  const spoken=C.narrationParts(text).filter(p=>p.text).map(p=>p.text);
  assert.ok(spoken.some(p=>p.includes('版本3.14已经发布！')));assert.ok(spoken.some(p=>p.includes("Don't worry.")));
  assert.deepEqual(spoken.slice(-3),['数量25','3','28。']);
  assert.ok(C.narrationParts('[Music] [__] ✨ *** 。！？').every(p=>!p.text));
  assert.equal(C.narrationParts('[Music] [__] ✨ *** 。！？').length,1);
});
test('silence-only captions complete without speech support, voices or a gesture, and never call synthesis',t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});let done='',errors=0;
  const engine=new Speech({synthesis:null,Utterance:null,onError:()=>errors++});engine.speak('[音乐] [__] 。！？',{onDone:r=>done=r});
  assert.ok(engine.current);t.mock.timers.tick(249);assert.equal(done,'');t.mock.timers.tick(1);
  assert.equal(done,'end');assert.equal(errors,0);assert.equal(engine.current,null);
  const synthesis=fake();synthesis.getVoices=()=>[];const other=new Speech({synthesis,Utterance,onError:()=>errors++});
  other.speak('音乐',{silent:true});t.mock.timers.tick(250);assert.equal(other.current,null);assert.equal(synthesis.spoken.length,0);assert.equal(errors,0);
});
test('a bracket in mid-sentence leaves a short silence and keeps full-caption character offsets',t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});const synthesis=fake(),engine=new Speech({synthesis,Utterance});let done='';
  const text='你好[音乐]世界。';engine.speak(text,{onDone:r=>done=r});const first=synthesis.spoken[0];first.onstart();first.onend();
  assert.equal(synthesis.spoken.length,1);assert.equal(engine.progress(),2);assert.equal(engine.current.captionText,text);t.mock.timers.tick(249);assert.equal(synthesis.spoken.length,1);
  t.mock.timers.tick(1);const next=synthesis.spoken[1];assert.equal(next.text,'世界。');next.onstart();next.onboundary({charIndex:1});assert.equal(engine.progress(),7);
  first.onend();assert.equal(synthesis.spoken.length,2);next.onend();assert.equal(done,'end');assert.equal(synthesis.cancellations,0);
});
test('pause/resume freezes annotation silence and applies multiplied speed to the next audible part',t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});const synthesis=fake(),engine=new Speech({synthesis,Utterance});
  engine.speak('[音乐]下一句。',{rate:2});t.mock.timers.tick(50);engine.pause();const progress=engine.progress();t.mock.timers.tick(30000);
  assert.equal(synthesis.spoken.length,0);assert.equal(engine.progress(),progress);engine.setRate(2.6);engine.resume();engine.resume();t.mock.timers.tick(74);assert.equal(synthesis.spoken.length,0);
  t.mock.timers.tick(1);assert.equal(synthesis.spoken[0].text,'下一句。');assert.equal(synthesis.spoken[0].rate,2.6);assert.equal(synthesis.cancellations,0);synthesis.spoken[0].onend();
});
test('canceling or seeking during silence prevents stale timers from starting removed text',t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});const synthesis=fake(),engine=new Speech({synthesis,Utterance});let canceled='';
  engine.speak('[音乐]旧句。',{onDone:r=>canceled=r});engine.speak('新句。');t.mock.timers.tick(1000);
  assert.equal(canceled,'cancel');assert.deepEqual(synthesis.spoken.map(u=>u.text),['新句。']);assert.equal(synthesis.cancellations,0);engine.stop();
});
test('voice fallback after a skipped annotation retains raw caption text and correct absolute progress',t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});const synthesis=fake();synthesis.getVoices=()=>[{name:'Xiaoxiao Online',lang:'zh-CN',localService:false},{name:'Chinese',lang:'zh-CN',localService:true}];
  const engine=new Speech({synthesis,Utterance}),text='前句。[音乐]后句。';engine.speak(text);synthesis.spoken[0].onend();t.mock.timers.tick(250);
  synthesis.spoken[1].onerror({error:'network'});const retry=synthesis.spoken.at(-1);retry.onstart();retry.onboundary({charIndex:1});
  assert.equal(retry.text,'后句。');assert.equal(engine.current.captionText,text);assert.equal(engine.progress(),8);retry.onend();assert.equal(engine.current,null);
});
