const {test}=require('node:test'),assert=require('node:assert/strict');
global.DubCore=require('../YouTube中文同传/core.js');
const Speech=require('../YouTube中文同传/speech.js');
const natural={name:'Microsoft Xiaoxiao Online (Natural)',voiceURI:'xiaoxiao',lang:'zh-CN',localService:false};
const local={name:'Microsoft Huihui',voiceURI:'huihui',lang:'zh-CN',localService:true};
function fixture(t){
  t.mock.timers.enable({apis:['setTimeout','Date']});
  t.mock.timers.setTime(200000);
  const synthesis={paused:false,speaking:true,pending:false,list:[natural,local],spoken:[],
    getVoices(){return this.list},speak(u){this.spoken.push(u)},cancel(){},pause(){this.paused=true},resume(){this.paused=false}};
  const errors=[],engine=new Speech({synthesis,Utterance:class{constructor(text){this.text=text}},onError:e=>errors.push(e)});
  t.after(()=>engine.stop());return {synthesis,engine,errors};
}
test('a synthesis failure during pause stays silent and resumes the unfinished part with the original voice',t=>{
  const {engine,synthesis}=fixture(t);engine.speak('已读完。待完成。最后一句。',{rate:1.3});
  synthesis.spoken[0].onstart();synthesis.spoken[0].onend();const paused=synthesis.spoken[1];paused.onstart();
  engine.pause();paused.onerror({error:'synthesis-failed'});t.mock.timers.tick(30000);
  assert.equal(synthesis.spoken.length,2);assert.equal(engine.current.paused,true);assert.equal(engine.failedVoices.size,0);
  engine.setRate(2.6);engine.resume();const resumed=synthesis.spoken.at(-1);
  assert.equal(resumed.text,'待完成。');assert.equal(resumed.voice.name,natural.name);assert.equal(resumed.rate,2.6);
  paused.onend();assert.equal(synthesis.spoken.at(-1),resumed);
  resumed.onstart();resumed.onend();assert.equal(synthesis.spoken.at(-1).text,'最后一句。');assert.equal(synthesis.spoken.at(-1).voice.name,natural.name);
  synthesis.spoken.at(-1).onstart();synthesis.spoken.at(-1).onend();assert.equal(engine.current,null);
});
test('a resume failure retries the same voice once and cannot loop or switch timbre',t=>{
  const {engine,synthesis}=fixture(t);let done;engine.speak('恢复后继续。',{onDone:r=>done=r});
  const first=synthesis.spoken[0];first.onstart();engine.pause();engine.resume();first.onerror({error:'network'});
  assert.equal(synthesis.spoken.length,2);assert.equal(synthesis.spoken[1].voice.name,natural.name);
  first.onend();assert.equal(engine.current.text,'恢复后继续。');
  synthesis.spoken[1].onerror({error:'network'});assert.equal(done,'error');assert.equal(engine.current,null);assert.equal(synthesis.spoken.length,2);
  engine.speak('恢复后继续。');assert.equal(synthesis.spoken.at(-1).voice.name,natural.name);
});
test('a voice that has already spoken stays selected for later cues even after a timeout',t=>{
  const {engine,synthesis}=fixture(t);engine.speak('前一句。');synthesis.spoken[0].onstart();t.mock.timers.tick(12000);
  assert.equal(engine.current,null);engine.speak('下一句。');assert.equal(synthesis.spoken.at(-1).voice.name,natural.name);
});
test('a selected voice temporarily absent from getVoices waits instead of silently using another voice',t=>{
  const {engine,synthesis,errors}=fixture(t);let done;
  engine.speak('第一句。',{voice:natural.name});synthesis.spoken[0].onstart();synthesis.spoken[0].onend();
  synthesis.list=[local];engine.speak('第二句。',{voice:natural.name,onDone:r=>done=r});
  assert.equal(done,'unavailable');assert.equal(synthesis.spoken.length,1);assert.equal(errors.at(-1).code,'voices-unavailable');
  synthesis.list=[{...natural},local];engine.speak('第二句。',{voice:natural.name});assert.equal(synthesis.spoken.at(-1).voice.name,natural.name);
});
test('automatic selection keeps the voice already heard across list refreshes and new preferred voices',t=>{
  const {engine,synthesis}=fixture(t);synthesis.list=[local];engine.speak('第一句。');synthesis.spoken[0].onstart();synthesis.spoken[0].onend();
  synthesis.list=[natural,{...local}];engine.speak('第二句。');assert.equal(synthesis.spoken.at(-1).voice.name,local.name);synthesis.spoken.at(-1).onstart();synthesis.spoken.at(-1).onend();
  synthesis.list=[natural];let done;engine.speak('第三句。',{onDone:r=>done=r});assert.equal(done,'unavailable');assert.equal(synthesis.spoken.length,2);
  synthesis.list=[natural,local];engine.speak('第三句。');assert.equal(synthesis.spoken.at(-1).voice.name,local.name);
});
test('only an explicit voice preference change releases the previous automatic voice lock',t=>{
  const {engine,synthesis}=fixture(t);engine.speak('第一句。');synthesis.spoken[0].onstart();synthesis.spoken[0].onend();
  engine.speak('手动换声音。',{voice:local.name});assert.equal(synthesis.spoken.at(-1).voice.name,local.name);synthesis.spoken.at(-1).onstart();synthesis.spoken.at(-1).onend();
  engine.speak('重新自动选择。',{voice:''});assert.equal(synthesis.spoken.at(-1).voice.name,natural.name);
});
test('an explicit voice does not fall back to a different timbre even before its first start',t=>{
  const {engine,synthesis}=fixture(t);engine.speak('等待所选声音。',{voice:natural.name});synthesis.spoken[0].onerror({error:'network'});
  assert.equal(synthesis.spoken.length,1);assert.equal(engine.current,null);
  engine.speak('等待所选声音。',{voice:natural.name});assert.equal(synthesis.spoken.at(-1).voice.name,natural.name);
});
test('a startup fallback chosen before any speech remains stable after the original voice cooldown expires',t=>{
  const {engine,synthesis}=fixture(t);engine.speak('第一句。');synthesis.spoken[0].onerror({error:'network'});
  const heard=synthesis.spoken.at(-1);assert.equal(heard.voice.name,local.name);heard.onstart();heard.onend();
  t.mock.timers.tick(100000);engine.speak('下一句。');assert.equal(synthesis.spoken.at(-1).voice.name,local.name);
});
