const {test} = require('node:test');
const assert = require('node:assert/strict');
global.DubCore = require('../YouTube中文同传/core.js');
const Speech = require('../YouTube中文同传/speech.js');
class Utterance { constructor(text) { this.text = text; } }
function fake() {
  return {paused: false, spoken: [], cancellations: 0,
    getVoices: () => [{name: 'Microsoft Huihui', lang: 'zh-CN', localService: true}, {name: 'Microsoft Xiaoxiao Online (Natural)', lang: 'zh-CN', localService: false}, {name: 'English', lang: 'en-US', localService: true}],
    speak(u) { this.spoken.push(u); }, cancel() { this.cancellations++; }, pause() { this.paused = true; }, resume() { this.paused = false; }};
}
test('prefers Edge online Chinese voice and breaks long narration into short utterances', () => {
  const synthesis = fake(); let done = '';
  const engine = new Speech({synthesis, Utterance}); engine.speak('你好。第二句话！' + '长'.repeat(160), {rate: 1.4, onDone: r => { done = r; }});
  assert.match(synthesis.spoken[0].voice.name, /Xiaoxiao/); assert.equal(synthesis.spoken[0].rate, 1.4);
  let index = 0;
  while (engine.current) { const u = synthesis.spoken[index++]; assert.ok(u.text.length <= 140); u.onstart(); u.onend(); }
  assert.equal(done, 'end'); assert.ok(index >= 4);
});

test('a natural Chinese sentence longer than the old 70-character limit is spoken without a mid-phrase reset', () => {
  const synthesis=fake(),engine=new Speech({synthesis,Utterance});
  const text=require('./fixtures/continuity.cjs').longChinese;
  assert.ok(text.length>70&&text.length<140);
  engine.speak(text);assert.equal(synthesis.spoken[0].text,text);synthesis.spoken[0].onend();
  assert.equal(synthesis.spoken.length,1);assert.equal(synthesis.cancellations,0);
});

test('long speech uses comma pauses, retains all text and never emits punctuation-only parts', () => {
  const synthesis=fake(),engine=new Speech({synthesis,Utterance});
  const clause='这里是需要完整读出的中文内容，它包含了同一个意思的前后联系和一些细节，';
  const text=clause.repeat(7)+'最后完整地结束。';engine.speak(text);let i=0;
  while(engine.current){const u=synthesis.spoken[i++];assert.ok(u.text.length<=140);assert.ok(/[\p{L}\p{N}]/u.test(u.text));u.onend()}
  assert.equal(synthesis.spoken.map(u=>u.text).join(''),text);
  assert.ok(synthesis.spoken.slice(0,-1).every(u=>/[，。]$/.test(u.text)));
  assert.equal(synthesis.cancellations,0);
});
test('voice cancellation ignores stale end events after a seek', () => {
  const synthesis = fake(), engine = new Speech({synthesis, Utterance});
  engine.speak('old'); const old = synthesis.spoken.at(-1); engine.speak('new');
  old.onend(); assert.equal(engine.current.text, 'new'); engine.stop(); assert.equal(engine.current, null);
});

test('speed changes preserve the current short part and apply to the next part without canceling', () => {
  const synthesis=fake(),engine=new Speech({synthesis,Utterance});let done='';
  engine.speak('第一句话。第二句话。第三句话。',{rate:1.2,onDone:r=>done=r});
  const first=synthesis.spoken[0],canceled=synthesis.cancellations;first.onstart();engine.setRate(3);
  assert.equal(first.rate,1.2);assert.equal(engine.current.options.rate,3);assert.equal(synthesis.cancellations,canceled);
  first.onend();assert.equal(synthesis.spoken[1].rate,3);assert.equal(synthesis.spoken[1].text,'第二句话。');
  engine.setRate(.375);synthesis.spoken[1].onend();assert.equal(synthesis.spoken[2].rate,.375);
  synthesis.spoken[2].onend();assert.equal(done,'end');assert.equal(synthesis.cancellations,canceled);
});

test('a natural voice failure retains multiplied rates; resumed current parts keep their original rate', () => {
  const synthesis=fake(),engine=new Speech({synthesis,Utterance});
  engine.speak('测试新的速度。',{rate:4});assert.equal(synthesis.spoken.at(-1).rate,4);
  synthesis.spoken.at(-1).onerror({error:'network'});assert.equal(synthesis.spoken.at(-1).rate,4);
  engine.setRate(3);engine.pause();engine.resume();assert.equal(synthesis.spoken.at(-1).rate,4);assert.equal(engine.current.options.rate,3);engine.stop();
});
test('network voice failure falls back once to a local Chinese voice', () => {
  const synthesis = fake(); let errors = 0;
  const engine = new Speech({synthesis, Utterance, onError: () => { errors++; }});
  engine.speak('测试'); synthesis.spoken.at(-1).onerror({error: 'network'});
  assert.equal(synthesis.spoken.at(-1).voice.localService, true); assert.equal(errors, 1);
  synthesis.spoken.at(-1).onerror({error: 'audio-busy'}); assert.equal(engine.current, null); assert.equal(errors, 2);
});
test('Edge natural voices incorrectly marked local do not block the offline fallback', () => {
  const synthesis = fake(), original = synthesis.getVoices;
  synthesis.getVoices = () => original().map(v => ({...v, localService: true}));
  const engine = new Speech({synthesis, Utterance}); engine.speak('测试');
  synthesis.spoken.at(-1).onerror({error: 'synthesis-failed'});
  assert.equal(synthesis.spoken.at(-1).voice.name, 'Microsoft Huihui'); engine.stop();
});
test('a failed online voice is temporarily skipped for subsequent subtitle segments', () => {
  const synthesis = fake(), engine = new Speech({synthesis, Utterance});
  engine.speak('第一段'); synthesis.spoken.at(-1).onerror({error:'network'}); synthesis.spoken.at(-1).onend();
  engine.speak('第二段'); assert.equal(synthesis.spoken.at(-1).voice.localService, true); engine.stop();
});
test('pause/resume continues the same utterance without replaying completed parts', () => {
  const synthesis = fake(), engine = new Speech({synthesis, Utterance}); engine.speak('恢复测试');
  synthesis.spoken.at(-1).onstart(); engine.pause(); assert.equal(engine.current.paused, true);
  engine.resume();engine.resume(); assert.equal(engine.current.paused, false); assert.equal(synthesis.spoken.length, 1);assert.equal(synthesis.cancellations,0); engine.stop();
});

test('native word boundaries use full-cue offsets, ignore stale callbacks and freeze during pause', () => {
  const synthesis=fake(),engine=new Speech({synthesis,Utterance});
  engine.speak('已经读完。  正在完整朗读的下一句话。');
  const first=synthesis.spoken[0];first.onstart();first.onend();const second=synthesis.spoken[1];second.onstart();
  second.onboundary({charIndex:3});assert.equal(engine.progress(),10);
  first.onboundary({charIndex:20});assert.equal(engine.progress(),10);
  engine.pause();second.onboundary({charIndex:8});assert.equal(engine.progress(),10);
  engine.resume();second.onboundary({charIndex:8});assert.equal(engine.progress(),15);
  second.onboundary({charIndex:1});assert.equal(engine.progress(),15);
  engine.stop();second.onboundary({charIndex:9});assert.equal(engine.current,null);
});
test('voices without word callbacks use a paused, per-utterance visual clock and keep rate changes independent', t => {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const synthesis=fake(),engine=new Speech({synthesis,Utterance});engine.speak('字幕'.repeat(40),{rate:2});
  synthesis.spoken[0].onstart();synthesis.spoken[0].onboundary({charIndex:0});t.mock.timers.tick(1000);assert.equal(engine.progress(),9);
  engine.pause();t.mock.timers.tick(30000);assert.equal(engine.progress(),9);
  engine.setRate(4);engine.resume();t.mock.timers.tick(1000);assert.equal(engine.progress(),18);
  assert.equal(synthesis.spoken.length,1);assert.equal(synthesis.cancellations,0);engine.stop();
});
test('voice fallback keeps absolute subtitle offsets without replaying completed parts',()=>{
  const synthesis=fake(),engine=new Speech({synthesis,Utterance});const text='已经读完。 下一段需要完成。 最后一段。';
  engine.speak(text);synthesis.spoken[0].onend();synthesis.spoken[1].onerror({error:'network'});
  const retry=synthesis.spoken.at(-1);retry.onstart();retry.onboundary({charIndex:3});
  assert.equal(engine.current.captionText,text);assert.equal(engine.progress(),9);assert.equal(retry.text,'下一段需要完成。');
  retry.onend();synthesis.spoken.at(-1).onstart();synthesis.spoken.at(-1).onboundary({charIndex:2});assert.equal(engine.progress(),17);engine.stop();
});

test('discarded native utterances recover only the unfinished part, retaining cue metadata and new speed', t => {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const synthesis=fake(),engine=new Speech({synthesis,Utterance});let done='',starts=0;
  synthesis.speaking=true;synthesis.pending=false;
  const cue={id:'cue-7'};engine.speak('已经读完。还没有读完。最后一句。',{rate:2,cue,onStart:()=>starts++,onDone:r=>done=r});
  synthesis.spoken[0].onstart();synthesis.spoken[0].onend();const unfinished=synthesis.spoken[1];unfinished.onstart();
  engine.pause();engine.setRate(4);synthesis.speaking=false;engine.resume();t.mock.timers.tick(251);
  assert.deepEqual(synthesis.spoken.map(u=>u.text),['已经读完。','还没有读完。','还没有读完。']);
  assert.equal(engine.current.options.cue,cue);assert.equal(synthesis.spoken[2].rate,4);
  unfinished.onend();unfinished.onerror({error:'interrupted'});assert.equal(synthesis.spoken.length,3);
  synthesis.spoken[2].onstart();synthesis.spoken[2].onend();assert.equal(synthesis.spoken[3].text,'最后一句。');
  synthesis.spoken[3].onstart();synthesis.spoken[3].onend();assert.equal(done,'end');assert.equal(starts,4);assert.equal(engine.current,null);
});

test('end or interrupted events while paused do not start another part before resume', t => {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  for(const event of ['end','interrupted']) {
    const synthesis=fake(),engine=new Speech({synthesis,Utterance});engine.speak('第一句。第二句。');
    const first=synthesis.spoken[0];engine.pause();first.onstart();
    assert.equal(engine.timer,null);t.mock.timers.tick(40000);assert.equal(synthesis.spoken.length,1);
    if(event==='end')first.onend();else first.onerror({error:event});
    assert.equal(synthesis.spoken.length,1);engine.resume();assert.equal(synthesis.spoken.length,2);
    assert.equal(synthesis.spoken[1].text,event==='end'?'第二句。':'第一句。');
    first.onend();assert.equal(synthesis.spoken.length,2);engine.stop();
  }
});

test('stuck resume callbacks retry the unfinished part once without losing the sentence queue', t => {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const synthesis=fake(),engine=new Speech({synthesis,Utterance});synthesis.speaking=true;synthesis.pending=false;
  engine.speak('第一句。第二句。');synthesis.spoken[0].onstart();synthesis.spoken[0].onend();synthesis.spoken[1].onstart();
  engine.pause();t.mock.timers.tick(40000);engine.resume();t.mock.timers.tick(8001);
  assert.deepEqual(synthesis.spoken.map(u=>u.text),['第一句。','第二句。','第二句。']);
  synthesis.spoken[2].onstart();synthesis.spoken[2].onend();assert.equal(engine.current,null);
});

test('unexpected active interruption retries once then releases the silent queue', () => {
  const synthesis=fake();let done='',errors=0;const engine=new Speech({synthesis,Utterance,onError:()=>errors++});
  engine.speak('测试中断。',{onDone:r=>done=r});synthesis.spoken[0].onerror({error:'interrupted'});
  assert.equal(synthesis.spoken.length,2);synthesis.spoken[0].onend();assert.equal(engine.current.text,'测试中断。');
  synthesis.spoken[1].onerror({error:'interrupted'});assert.equal(done,'error');assert.equal(errors,1);assert.equal(engine.current,null);
});
test('missing Chinese voices surfaces an actionable error', () => {
  const synthesis = fake(); synthesis.getVoices = () => [];
  let error = ''; const engine = new Speech({synthesis, Utterance, onError: e => { error = e.message; }});
  engine.speak('测试'); assert.match(error, /中文声音/); assert.equal(engine.current, null);
});

test('a browser permission block requests a gesture without blacklisting or repeatedly switching voices', () => {
  const synthesis=fake();let error,done;
  const engine=new Speech({synthesis,Utterance,onError:e=>error=e});
  engine.speak('自动朗读测试',{onDone:r=>done=r});synthesis.spoken[0].onerror({error:'not-allowed'});
  assert.equal(error.code,'not-allowed');assert.equal(done,'blocked');assert.equal(engine.current,null);
  assert.equal(engine.failedVoices.size,0);assert.equal(synthesis.spoken.length,1);
});
test('a missing start event falls back to local speech and cannot retain an infinite queue', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const synthesis = fake(), engine = new Speech({synthesis, Utterance});
  engine.speak('测试卡住'); t.mock.timers.tick(7001);
  assert.equal(synthesis.spoken.at(-1).voice.localService, true);
  t.mock.timers.tick(7001); assert.equal(engine.current, null);
  // A late end event from the timed-out utterance must not restart stale speech.
  const before = synthesis.spoken.length; synthesis.spoken.at(-1).onend(); assert.equal(synthesis.spoken.length, before);
});
test('speech that starts but never ends times out and ignores late callbacks', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const synthesis = fake(), engine = new Speech({synthesis, Utterance}); let done = '';
  engine.speak('字幕', {onDone: r => { done = r; }}); const u = synthesis.spoken.at(-1); u.onstart();
  t.mock.timers.tick(9000); assert.equal(done, 'timeout'); assert.equal(engine.current, null);
  u.onend(); assert.equal(synthesis.spoken.length, 1);
});
