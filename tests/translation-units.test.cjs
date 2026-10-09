const {test}=require('node:test'),assert=require('node:assert/strict');
require('../YouTube中文同传/vendor/syntax.js');
const C=require('../YouTube中文同传/core.js');

test('ASR translation retains direct objects, embedded clauses, negation and the scope of reported speech',()=>{
  const examples=[
    'the reason I wanted to share this story is that it shows how easily we can forget the people who helped us when we were young',
    'I noticed something unusual and the reason I wanted to share this story is that it shows how easily we can forget the people who helped us',
    'the company that makes these devices says the battery lasts much longer than the previous one',
    'he told me that the villagers left their homes because they believed the bridge would collapse and they would lose everything',
    'she does not believe that the document is authentic because it lacks a signature and the dates do not match the records',
    'if you compare the picture on the left with the one on the right you will see why this difference matters',
    'the data suggests that people who sleep less than six hours may have trouble remembering what they learned the night before'
  ];
  for(const text of examples){
    const cues=C.prepareCues([{start:0,end:30,text}],{automatic:true,language:'en'});
    assert.deepEqual(cues.map(c=>c.text),[text],text);
    assert.equal(cues[0].start,0);assert.equal(cues[0].end,30);
  }
});
test('a hesitation after until or real does not turn its continuation into a separate assertion',()=>{
  for(const [first,last] of [
    ['when you stop playing it you forget about it until','you see it physically in front of your face.'],
    ['seeing these familiar things can bring back real','memories.']
  ]){
    const rows=[{start:0,end:4,text:first},{start:6,end:10,text:last}];
    assert.deepEqual(C.prepareCues(rows,{automatic:true,language:'en'}).map(c=>c.text),[first+' '+last]);
    assert.deepEqual(C.prepareCues(rows,{automatic:false,language:'en'}).map(({start,end,text})=>({start,end,text})),rows);
  }
});
test('Chinese display prefers complete clauses over a rigid character count and does not strand modifiers',()=>{
  const examples=[
    ['直到你亲眼看到这些熟悉的东西出现在面前，才会重新想起那些真实的回忆。',['直到你亲眼看到这些熟悉的东西出现在面前，','才会重新想起那些真实的回忆。']],
    ['如果你把左边这张图片和右边那张图片仔细对照，就会发现房间已经变了。',['如果你把左边这张图片和右边那张图片仔细对照，','就会发现房间已经变了。']],
    ['后来我发现，这家公司声称电池续航更长，但独立测试得出了不同的结果。',['后来我发现，这家公司声称电池续航更长，','但独立测试得出了不同的结果。']]
  ];
  for(const [text,wanted] of examples){
    const pages=C.subtitlePages(text,24);
    assert.deepEqual(pages.map(p=>p.text),wanted);assert.equal(pages.map(p=>p.text).join(''),text);
  }
});
test('Chinese paging preserves numbers, Latin names, punctuation pairs and whole emoji graphemes',()=>{
  const text='根据研究记录，2019年4月发布的版本增加了25%的电池容量，而不是提高25%的运行速度。';
  const pages=C.subtitlePages(text,24);
  assert.equal(pages.map(p=>p.text).join(''),text);
  for(const phrase of ['2019年4月','25%','电池容量','运行速度'])assert.ok(pages.some(p=>p.text.includes(phrase)),phrase);
  for(const text of ['亲眼看到《真实的回忆》，你才会想起昨天一起度过的那些时光。','👩‍👩‍👧‍👦'.repeat(20),'YouTube Netflix Microsoft Edge '.repeat(15)]){
    const pages=C.subtitlePages(text,24),graphemes=new Set([...new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(text)].map(g=>g.index));graphemes.add(text.length);
    assert.equal(pages.map(p=>p.text).join(''),text);
    assert.ok(pages.every(p=>graphemes.has(p.from)&&graphemes.has(p.to)));
    assert.ok(pages.slice(0,-1).every(p=>!/[《（“]$/.test(p.text)&&!/[，。！？）》”]/.test(text[p.to])));
  }
});
test('long Chinese speech uses natural pause boundaries and keeps exactly the full translated content',()=>{
  const text=('直到你亲眼看到这些熟悉的东西出现在面前，才会重新想起那些真实的回忆；').repeat(9)+'这些回忆让我们重新理解那个年代。';
  const parts=C.speechParts(text);
  assert.equal(parts.join(''),text);assert.ok(parts.every(p=>p.length<=140));
  assert.ok(parts.slice(0,-1).every(p=>/[，；]$/.test(p)));
});
test('translation punctuation belongs only to explicit English ASR input and never changes saved source or time',()=>{
  const cue={automatic:true,text:'did anyone else see this on Netflix',start:1,end:8},original={...cue};
  assert.equal(C.translationInput(cue,'en'),'did anyone else see this on Netflix?');assert.deepEqual(cue,original);
  assert.equal(C.translationInput({...cue,text:'he remembers the story'},'en-US'),'he remembers the story.');
  for(const automatic of [false,undefined])assert.equal(C.translationInput({...cue,automatic},'en'),cue.text);
  assert.equal(C.translationInput(cue,'de'),cue.text);
  assert.equal(C.translationInput({...cue,text:'Already complete!'},'en'),'Already complete!');
  assert.equal(C.translationInput({...cue,text:'a'.repeat(4500)},'en').length,4500);
});
test('ASR context is bounded, does not enter display text, and changes only custom translation cache keys',()=>{
  const rows=[{start:0,end:5,text:'Earlier context. Current statement. Later context.'}];
  const cues=C.prepareCues(rows,{automatic:true,language:'en'});
  assert.equal(cues[1].text,'Current statement.');assert.equal(cues[1].contextBefore,'Earlier context.');assert.equal(cues[1].contextAfter,'Later context.');
  const changed={...cues[1],contextBefore:'Different previous context.'};
  assert.equal(C.cacheKey(cues[1],'en',C.defaults),C.cacheKey(changed,'en',C.defaults));
  assert.notEqual(C.cacheKey(cues[1],'en',{...C.defaults,provider:'custom'}),C.cacheKey(changed,'en',{...C.defaults,provider:'custom'}));
  const live=C.prepareCues(rows,{automatic:true,language:'en',live:true});assert.ok(live.every(c=>c.contextAfter===''));
  const long=C.prepareCues([{start:0,end:5,text:'x'.repeat(700)+'. Next statement.'}],{automatic:true,language:'en'});assert.ok(long.every(c=>c.contextBefore.length<=400&&c.contextAfter.length<=400));
});
test('bilingual pages use actual coarse sentence correspondences and preserve whole-source fallback',()=>{
  const source='The first part is much longer than the second. A reply.',target='前半句。后半句。';
  const split=source.indexOf(' A reply.'),alignment=[{from:0,to:4,sourceFrom:0,sourceTo:split},{from:4,to:8,sourceFrom:split+1,sourceTo:source.length}];
  assert.equal(C.pageSource({from:4,to:8},source,target,alignment),'A reply.');
  assert.equal(C.pageSource({from:2,to:6},source,target,alignment),source);
  assert.equal(C.pageSource({from:4,to:8},source,target),source);
  assert.equal(C.pageSource({from:0,to:8},source,target,alignment.slice(1)),source);
  const bad=[{from:0,to:100,sourceFrom:0,sourceTo:1},{from:0,to:4,sourceFrom:-1,sourceTo:1}];
  assert.deepEqual(C.validatedAlignment(bad,source,target),[]);assert.equal(C.pageSource({from:4,to:8},source,target,bad),source);
});
