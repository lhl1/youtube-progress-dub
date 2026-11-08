const {test}=require('node:test'),assert=require('node:assert/strict');
global.DubCore=require('../YouTube中文同传/core.js');
const C=DubCore,Speech=require('../YouTube中文同传/speech.js');
test('book title delimiters are removed without inserting an utterance or silence boundary',()=>{
  const raw='我读过《三体》和《活着》，完成了89%的内容。',plan=C.narrationParts(raw);
  assert.equal(plan.filter(x=>x.pause).length,0);assert.equal(plan.length,1);
  assert.equal(plan[0].text,'我读过三体和活着，完成了百分之八十九的内容。');
  assert.ok(plan[0].map.every((at,i,a)=>!i||at>=a[i-1]));assert.equal(raw,'我读过《三体》和《活着》，完成了89%的内容。');
});
test('percentages read naturally, including decimals, signs, full-width percent and grouped thousands',()=>{
  for(const [raw,want]of [['89%','百分之八十九'],['100%','百分之一百'],['0.05%','百分之零点零五'],['-12.5％','负百分之十二点五'],['+20%','正百分之二十'],['10,001 %','百分之一万零一'],['110%','百分之一百一十']]){
    const plan=C.narrationParts('约'+raw+'的人');assert.equal(plan.length,1);assert.equal(plan[0].text,'约'+want+'的人');
  }
});
test('speech boundary events and estimated progress map expanded percentages back to the unchanged caption',t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});let utterance;
  const synthesis={getVoices:()=>[{name:'Chinese',lang:'zh-CN'}],speak:u=>utterance=u,cancel(){},pause(){},resume(){}};
  const engine=new Speech({synthesis,Utterance:class{constructor(text){this.text=text;}}});
  const text='看过《三体》的有89%的人。';engine.speak(text,{captionText:'前文'+text,captionOffset:2});
  assert.equal(utterance.text,'看过三体的有百分之八十九的人。');utterance.onstart();
  utterance.onboundary({charIndex:utterance.text.indexOf('百')});assert.equal(engine.progress(),text.indexOf('89')+2);
  utterance.onboundary({charIndex:utterance.text.indexOf('的人')});assert.equal(engine.progress(),text.indexOf('的人')+2);
  assert.equal(engine.current.captionText,'前文'+text);utterance.onend();
});
test('skipped sound annotations still pause while title and percent transformations remain in the same spoken part',()=>{
  const plan=C.narrationParts('[音乐]《三体》的评分是89%[__]。');
  assert.equal(plan.filter(p=>p.pause).length,2);assert.deepEqual(plan.filter(p=>p.text).map(p=>p.text),['三体的评分是百分之八十九']);
});
test('missing voices finish as unavailable and can be retried when voices arrive',()=>{
  let ready=false,spoken,done;const synthesis={getVoices:()=>ready?[{name:'Chinese',lang:'zh-CN'}]:[],speak:u=>spoken=u,cancel(){}};
  const e=new Speech({synthesis,Utterance:class{constructor(t){this.text=t;}}});e.speak('下一句。',{onDone:r=>done=r});
  assert.equal(done,'unavailable');assert.equal(e.current,null);ready=true;e.speak('下一句。');assert.equal(spoken.text,'下一句。');spoken.onend();
});
test('expanded numeric tokens keep nonempty raw ranges even when speech must use multiple parts',()=>{
  const raw='9'.repeat(180)+'%';const plan=C.narrationParts(raw);
  assert.ok(plan.length>1);assert.ok(plan.every(p=>p.to>p.from));
  assert.equal(plan.filter(p=>p.text).map(p=>p.text).join(''),'百分之'+'九'.repeat(180));
});
test('original language uses explicit audio or unambiguous ASR and never a translated/authored Chinese track alone',()=>{
  const zh={languageCode:'zh-CN',vssId:'.zh',isTranslatable:true},en={languageCode:'en',vssId:'a.en',kind:'asr'};
  assert.equal(C.originalLanguage([zh]),'');assert.equal(C.originalLanguage([zh,en]),'en');assert.equal(C.originalLanguage([zh,en],'zh-Hans'),'zh-Hans');
  assert.equal(C.originalLanguage([{...zh,kind:'asr'}]),'zh-CN');assert.equal(C.originalLanguage([{...zh,kind:'asr'},en]),'');
  assert.equal(C.originalLanguage([{...zh,kind:'asr',baseUrl:'https://www.youtube.com/api/timedtext?lang=en&kind=asr&tlang=zh-Hans'}]),'en');
});
const target='第一段介绍开场内容，第二段说明实验方法，第三段讨论主要结果，第四段介绍未来计划。';
const cue={automatic:true,start:0,end:80,text:'intro method results future',alignment:[{from:0,to:10,sourceFrom:0,sourceTo:6},{from:10,to:20,sourceFrom:6,sourceTo:13},{from:20,to:30,sourceFrom:13,sourceTo:21},{from:30,to:target.length,sourceFrom:21,sourceTo:27}]};
test('seeking deep inside an ASR unit resumes at a nearby complete clause rather than its beginning',()=>{
  const c=structuredClone(cue),before=JSON.stringify(c),offset=C.narrationSeekOffset(c,target,55);
  assert.ok(offset>=20);assert.ok(offset<target.length);assert.equal(JSON.stringify(c),before);
  assert.equal(C.narrationSeekOffset(c,target,1),0);
});
test('timed original ASR rows take precedence over paragraph duration when available',()=>{
  const c={...cue,alignment:[{from:0,to:10,sourceFrom:0,sourceTo:6},{from:10,to:20,sourceFrom:6,sourceTo:13},{from:20,to:30,sourceFrom:13,sourceTo:21},{from:30,to:target.length,sourceFrom:21,sourceTo:26}]};
  const rows=[{start:0,end:70,text:'intro method results'},{start:70,end:80,text:'future'}];
  assert.ok(C.narrationSeekOffset(c,target,71,rows)>=30);
});
test('authored and unknown captions retain full narration even after seeking into a long row',()=>{
  for(const automatic of [false,undefined])assert.equal(C.narrationSeekOffset({...cue,automatic},target,60),0);
});
test('unpunctuated long ASR translations resume at word boundaries and never inside a title or surrogate pair',()=>{
  const text='这一段内容描述的是人们对于过去经历的不同理解以及他们在日常生活中形成的观点和记忆'.repeat(12);
  const c={automatic:true,start:0,end:120,text:'x'.repeat(500)};
  const offset=C.narrationSeekOffset(c,text,90);assert.ok(offset>text.length/2);assert.ok(offset<text.length);
  const title='开头。'+'《'+text+'》';assert.ok(C.narrationSeekOffset(c,title,90)<=3);
});
