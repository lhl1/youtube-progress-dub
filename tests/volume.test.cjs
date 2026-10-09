const {test} = require('node:test');
const assert = require('node:assert/strict');
const Volume = require('../YouTube中文同传/volume.js');
class Media extends EventTarget {
  constructor(value=0.8) { super(); this.value=value; this.writes=[]; this.muted=false; }
  get volume() { return this.value; }
  set volume(v) { this.value=v; this.writes.push(v); this.dispatchEvent(new Event('volumechange')); }
}
test('the session volume cap remains between utterances, during pauses, seeks and ads', () => {
  const v=new Media(), policy=new Volume(); policy.start(v,.18);
  for(let i=0;i<10;i++) policy.enforce();
  assert.equal(v.volume,.18); assert.deepEqual(v.writes,[.18]);
  policy.stop(); assert.equal(v.volume,.8);
});
test('explicit attempts to raise the original audio are capped and remembered for stopping', () => {
  const v=new Media(), policy=new Volume(); policy.start(v,.18);
  v.volume=.9; assert.equal(v.volume,.18);
  policy.stop(); assert.equal(v.volume,.9);
});
test('manual lower volume remains respected and is restored when dubbing stops', () => {
  const v=new Media(), policy=new Volume(); policy.start(v,.18); v.volume=.08;
  policy.enforce(); assert.equal(v.volume,.08); policy.stop(); assert.equal(v.volume,.08);
});
test('updating the cap live does not overwrite the pre-session restoration volume', () => {
  const v=new Media(), policy=new Volume(); policy.start(v,.18); policy.start(v,.4);
  assert.equal(v.volume,.4); policy.start(v,0); assert.equal(v.volume,0);
  policy.stop(); assert.equal(v.volume,.8);
});
test('player replacement restores the old video and caps the replacement', () => {
  const old=new Media(.6), next=new Media(.9), policy=new Volume();
  policy.start(old,.18); policy.start(next,.18);
  assert.equal(old.volume,.6); assert.equal(next.volume,.18);
  policy.stop(); assert.equal(next.volume,.9);
});
test('quiet or already muted videos are never boosted or unmuted by the cap', () => {
  const v=new Media(.05), policy=new Volume(); v.muted=true;
  policy.start(v,.18); assert.equal(v.volume,.05); assert.equal(v.muted,true);
  policy.stop(); assert.equal(v.muted,true);
});
