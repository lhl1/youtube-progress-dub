const {test}=require('node:test'),assert=require('node:assert/strict');
require('../YouTube中文同传/vendor/syntax.js');
const C=require('../YouTube中文同传/core.js');
const sample=require('./fixtures/netflix.cjs');

test('Netflix screenshot becomes six complete source units without correcting or losing ASR words',()=>{
  const cues=C.groupCues(sample.rows,{language:'en'});
  assert.deepEqual(cues.map(c=>c.text),sample.sentences);
  assert.equal(cues.map(c=>c.text).join(' '),sample.text);
  assert.ok(cues.every((c,i)=>c.end>c.start&&(!i||Math.abs(c.start-cues[i-1].end)<.001)));
});
test('local POS identifies verbs outside the legacy dictionary, while keeping embedded relatives and complements',()=>{
  for(const verb of ['logs','writes','investigates','discovers','explores']) {
    const text=`we remember these moments because they matter to us until you see the pictures again he ${verb} the results on his computer`;
    const cues=C.groupCues([{start:0,end:12,text}],{language:'en'});
    assert.deepEqual(cues.map(c=>c.text),[text.slice(0,text.indexOf(' he ')),text.slice(text.indexOf(' he ')+1)]);
  }
  for(const text of [
    "this anomaly he found is so strange and so specific that he immediately takes to Reddit to see if anyone else has noticed it",
    "the user is watching the documentary when he notices something shocking something he can't explain",
    'the games we played together are the same ones that we remember from the years when we were young',
    'if the archive is available then we can inspect it until we understand what the records mean'
  ])assert.deepEqual(C.groupCues([{start:0,end:35,text}],{language:'en'}).map(c=>c.text),[text]);
});
test('genuinely long uncertain sentences retain translation context instead of fixed 16-second slicing',()=>{
  const text='When you leave '+('the old pictures and memories of your childhood in the attic for a very long time ').repeat(7)+'you may forget them until you see them in front of you again.';
  assert.equal(C.groupCues([{start:0,end:50,text}],{language:'en'}).length,1);
  assert.equal(C.groupCues([{start:0,end:50,text}],{language:'en'})[0].text,text);
});
test('nested introductory conditions with compound verbs retain their independent consequence',()=>{
  const text='if you have visited the village where he has lived for many years I will explain the story when you arrive at the station';
  assert.deepEqual(C.groupCues([{start:0,end:24,text}],{language:'en'}).map(c=>c.text),[text]);
});
test('display continuations retain exact text and surrogate pairs without creating translation cues',()=>{
  for(const text of [sample.text,...sample.chinese,'直到你看到那些真实的回忆，才会重新想起过去。'.repeat(15),'😀'.repeat(80),'abc '.repeat(600),'a'.repeat(100)]) {
    const pages=C.subtitlePages(text,60);
    assert.equal(pages.map(p=>p.text).join(''),text);
    assert.ok(pages.every(p=>p.to>p.from&&p.text===text.slice(p.from,p.to)));
    assert.ok(pages.every(p=>!/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(p.text)));
    // The viewport budget is soft: a natural clause may use up to 30% more
    // space instead of stranding a word/particle at the page boundary.
    assert.ok(pages.every(p=>p.text.trim().length<=78));
  }
});
test('model windows preserve offsets and words on long transcripts',()=>{
  const text=sample.text.repeat(22),tokens=DubSyntax.analyze(text);
  assert.ok(text.length>8000);
  assert.ok(tokens.every((t,i)=>text.slice(t.at,t.to).toLowerCase().replace(/’/g,"'")===t.word&&(!i||t.at>=tokens[i-1].to)));
  assert.equal(tokens.at(-1).to,text.length);
});
