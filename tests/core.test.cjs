const {test} = require('node:test');
const assert = require('node:assert/strict');
require('../YouTube中文同传/vendor/syntax.js');
const C = require('../YouTube中文同传/core.js');
const continuity = require('./fixtures/continuity.cjs');
const unpunctuated = require('./fixtures/unpunctuated.cjs');
const settle = () => new Promise(resolve => setImmediate(resolve));
function cues(hours = 1) { return Array.from({length: hours * 600}, (_, i) => ({id: String(i), start: i * 6, end: i * 6 + 5.8, text: `Sentence ${i}.`})); }

test('JSON3 parses multiline, inferred duration, ASR roll-up and append events', () => {
  const rows = C.parseJson3({events: [
    {tStartMs: 0, dDurationMs: 4000, segs: [{utf8: 'hello'}]},
    {tStartMs: 1000, dDurationMs: 4000, segs: [{utf8: 'hello world'}]},
    {tStartMs: 6000, segs: [{utf8: 'new\n'}, {utf8: 'line'}]},
    {tStartMs: 7000, aAppend: 1, segs: [{utf8: ' and more'}]},
    {tStartMs: 10000, dDurationMs: 1000, segs: [{utf8: '\n'}]}
  ]});
  assert.equal(rows[0].text, 'hello'); assert.equal(rows[1].text, 'world');
  assert.equal(rows[2].text, 'new line and more'); assert.equal(rows[0].end, 1);
  assert.ok(rows.every(c => c.end > c.start));
});
test('three successive ASR roll-up windows speak only newly added words', () => {
  const rows = C.normalize([{start:0,end:5,text:'hello'},{start:1,end:6,text:'hello world'},{start:2,end:7,text:'hello world again'},{start:3,end:8,text:'hello world again'}]);
  assert.deepEqual(rows.map(c=>c.text), ['hello','world','again']);
  assert.equal(rows.at(-1).end, 8);
});
test('VTT supports cue identifiers, settings and hour timestamps', () => {
  const rows = C.parseVtt('WEBVTT\n\n17\n01:02:03.450 --> 01:02:06.100 align:start\n<v John>Hello</v>\nthere\n\nNOTE ignore\n');
  assert.deepEqual(rows, [{start: 3723.45, end: 3726.1, text: 'Hello there'}]);
});
test('subtitle markup is stripped while comparisons and character entities remain readable', () => {
  assert.equal(C.clean('<c.red>A &amp; B</c> x < 10 and y > 0 &#x4e2d;'), 'A & B x < 10 and y > 0 中');
  assert.equal(C.clean('<00:01:02.200><i>hello</i>'), 'hello');
});
test('grouping respects sentence boundaries and gaps while bounding translation requests', () => {
  const rows = C.normalize([{start: 0, end: 2, text: 'Hello'}, {start: 2, end: 4, text: 'world.'}, {start: 4, end: 7, text: 'Next.'}, {start: 10, end: 30, text: 'A'.repeat(1000)}]);
  const grouped = C.groupCues(rows);
  assert.equal(grouped[0].text, 'Hello world.'); assert.equal(grouped[1].text, 'Next.');
  assert.ok(grouped.every(g => g.text.length <= 600));
  assert.equal(grouped.slice(2).map(g => g.text).join('').length, 1000);
});

test('screenshot fragments until / you see and real / memories translate as whole sentences', () => {
  const {rows, sentences} = continuity;
  const grouped = C.groupCues(rows);
  assert.deepEqual(grouped.map(c=>c.text), sentences);
  assert.equal(grouped.map(c=>c.text).join(' '), rows.map(r=>r.text).join(' '));
  assert.ok(grouped.every((c,i)=>c.end>c.start&&(!i||c.start>=grouped[i-1].end)));
  assert.ok(grouped[1].end-grouped[1].start>7);
});

test('a sentence crossing the old 170-character limit retains its linking clause and word order', () => {
  const first='When you stop playing your favorite game for a long time, you may gradually forget the places you explored and the challenges you overcame with your friends until';
  const last='you see the old console in front of your face again.';
  const grouped=C.groupCues([{start:0,end:8,text:first},{start:8,end:12,text:last}]);
  assert.equal(grouped.length,1);assert.equal(grouped[0].text,first+' '+last);
});

test('sentence detection preserves decimals, titles, initials, quotations and Chinese sentence boundaries', () => {
  const text='Dr. Lee met Mr. Jones in the U.S. at 2.5 p.m. He said, "Real memories." 然后他说：“我记得。”下一句。';
  const groups=C.groupCues([{start:0,end:20,text}]);
  assert.equal(groups[0].text,'Dr. Lee met Mr. Jones in the U.S. at 2.5 p.m.');
  assert.deepEqual(groups.slice(1).map(c=>c.text),['He said, "Real memories."','然后他说：“我记得。”','下一句。']);
});

test('contractions at sentence ends are not misidentified as single-letter initials', () => {
  const groups=C.groupCues([{start:0,end:8,text:"I don't. He wouldn't. Please read Fig. 2 before continuing."}]);
  assert.deepEqual(groups.map(c=>c.text),["I don't.","He wouldn't.",'Please read Fig. 2 before continuing.']);
});

test('splitting pathological Unicode strings preserves every surrogate pair and character', () => {
  const text='😀'.repeat(450);
  const groups=C.groupCues([{start:0,end:28,text}]);
  assert.equal(groups.map(c=>c.text).join(''),text);
  assert.equal(C.speechParts(text).join(''),text);
  assert.ok(groups.every(c=>!/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(c.text)));
});

test('unpunctuated captions use bounded clauses without losing words or splitting until from its clause', () => {
  const text=('we remember these moments because they matter to us until you see the pictures again ').repeat(28).trim();
  const groups=C.groupCues([{start:0,end:160,text}]);
  assert.equal(groups.map(c=>c.text).join(' '),text);
  assert.ok(groups.every(c=>c.text.length<=600&&c.end-c.start<=30.01));
  assert.ok(groups.every(c=>!/(?:until|because)$/.test(c.text)));
});

test('the unpunctuated Nintendo screenshot becomes four complete narrative units instead of a screenful', () => {
  const groups=C.groupCues(unpunctuated.rows,{language:'en'});
  assert.deepEqual(groups.map(c=>c.text),unpunctuated.sentences);
  assert.equal(groups.map(c=>c.text).join(' '),unpunctuated.text);
  assert.ok(groups.every(c=>c.text.length<180&&c.end-c.start<8));
  assert.ok(groups.every((c,i)=>c.end>c.start&&(!i||Math.abs(c.start-groups[i-1].end)<.001)));
  assert.match(groups[0].text,/if this was.*then it was/);
  assert.match(groups[2].text,/text that described.*characters who appeared/);
});

test('unpunctuated conditions, linking phrases, reporting complements and real memories remain connected', () => {
  for(const text of [
    'when you stop playing it for so long you kind of forget about it until you see it like physically in front of your face',
    'if you leave your favorite console untouched for a very long time then it will remain exactly where you put it until you see it again',
    'we learned a lot about the real memories that we made together with the people who we met along the way',
    'I looked at the old console for a long time and thought it was exactly the same model that we used to play together',
    'I looked carefully through the archive of all the old pictures and noticed it was showing the people who we met at the event'
  ])assert.deepEqual(C.groupCues([{start:0,end:12,text}],{language:'en'}).map(c=>c.text),[text]);
});

test('a new bare subject or coordinated independent clause is recognized without splitting row fragments', () => {
  const text='we looked at the old console and remembered all the games we played together I learned a lot about Marcus in the hours we chatted and we found the pictures we had been searching for';
  const groups=C.groupCues([{start:0,end:12,text}],{language:'en'});
  assert.deepEqual(groups.map(c=>c.text),[
    'we looked at the old console and remembered all the games we played together',
    'I learned a lot about Marcus in the hours we chatted',
    'and we found the pictures we had been searching for'
  ]);
});

test('existing punctuation and non-English language tracks retain their original grouping', () => {
  const punctuated=unpunctuated.sentences.join(' ') + '.';
  assert.deepEqual(C.groupCues([{start:0,end:24,text:punctuated}],{language:'en'}).map(c=>c.text),[punctuated]);
  const words='but then I thought well if this was an actual Nintendo event then it was probably promoted on their website so I checked the captures';
  assert.deepEqual(C.groupCues([{start:0,end:10,text:words}],{language:'de'}).map(c=>c.text),[words]);
});

test('live unpunctuated ASR emits stable finished units and holds the unfinished last unit', () => {
  const partial=unpunctuated.sentences.slice(0,2).join(' ');
  const first=C.groupCues([{start:0,end:10,text:partial}],{live:true,language:'en'});
  assert.deepEqual(first.map(c=>c.text),unpunctuated.sentences.slice(0,1));
  const expanded=C.groupCues([{start:0,end:10,text:partial},{start:10,end:20,text:unpunctuated.sentences.slice(2).join(' ')}],{live:true,language:'en'});
  assert.deepEqual(expanded.map(c=>c.text),unpunctuated.sentences.slice(0,3));
  assert.equal(first[0].id,expanded[0].id);
});

test('long unpunctuated ASR is bounded to sixteen seconds and keeps every word in sequence', () => {
  const text=('we remember these moments because they matter to us until you see the pictures again ').repeat(28).trim();
  const groups=C.groupCues([{start:0,end:160,text}],{language:'en'});
  assert.equal(groups.map(c=>c.text).join(' '),text);
  assert.ok(groups.every(c=>c.text.length<=320&&c.end-c.start<=16.01));
  assert.ok(groups.every(c=>!/(?:until|because|the|real)$/.test(c.text)));
  assert.match(C.cacheKey(groups[0],'en',C.defaults),/^sentence-v5:/);
});

test('Chinese line joins do not insert unnatural spaces and do not drop characters', () => {
  const groups=C.groupCues([{start:0,end:5,text:'直到你亲眼看到它'},{start:5,end:9,text:'出现在面前，才会想起那些真实的回忆。接着'},{start:9,end:12,text:'继续聊天。'}]);
  assert.deepEqual(groups.map(c=>c.text),['直到你亲眼看到它出现在面前，才会想起那些真实的回忆。','接着继续聊天。']);
});

test('live captions hold an unfinished tail until the sentence arrives instead of duplicating its first half', () => {
  const first={start:0,end:4,text:'This is complete. Until'};
  assert.deepEqual(C.groupCues([first],{live:true}).map(c=>c.text),['This is complete.']);
  const groups=C.groupCues([first,{start:4,end:7,text:'you see real memories.'}],{live:true});
  assert.deepEqual(groups.map(c=>c.text),['This is complete.','Until you see real memories.']);
  assert.equal(groups[0].id,C.groupCues([first],{live:true})[0].id);
});

test('the sentence translation cache does not reuse old independently translated fragments', () => {
  const cue={text:'real memories.'},settings=C.defaults;
  assert.notEqual(C.cacheKey(cue,'en',settings),`${settings.provider}:${settings.cacheRevision}:en:${C.hash(cue.text)}`);
});
test('track selection favors native Chinese and manual subtitles; explicit choice wins', () => {
  const tracks = [{vssId: 'a.en', languageCode: 'en', kind: 'asr'}, {vssId: '.en', languageCode: 'en'}, {vssId: '.zh', languageCode: 'zh-CN'}];
  assert.equal(C.chooseTrack(tracks).vssId, '.zh'); assert.equal(C.chooseTrack(tracks, '.en').vssId, '.en');
  assert.equal(C.chooseTrack(tracks.slice(0, 2)).vssId, '.en');
});
test('time lookup and URL validation work late into a ten-hour video', () => {
  const rows = cues(10);
  assert.equal(C.lowerBound(rows, 9 * 3600), 5400);
  assert.equal(C.videoId('https://www.youtube.com/watch?v=abc'), 'abc');
  assert.equal(C.videoId('https://www.youtube.com/live/abc'), 'abc');
  assert.equal(C.videoId('https://evil.example/watch?v=abc'), '');
});
test('settings clamp user input and do not expose credentials to content scripts', () => {
  const s = C.sanitizeSettings({rate: 100, lookahead: NaN, originalVolume: -1, provider: 'bad', apiKey: 'secret'});
  assert.equal(s.rate, 2.5); assert.equal(s.lookahead, 100); assert.equal(s.originalVolume, 0);
  assert.equal(s.provider, 'google-free'); assert.ok(!('apiKey' in C.publicSettings(s)));
});
test('custom endpoint permissions use the host pattern while requests retain their port', () => {
  assert.equal(C.permissionOrigin('http://127.0.0.1:11434/v1/chat/completions'), 'http://127.0.0.1/*');
  assert.equal(C.permissionOrigin('https://translation.example:8443/v1/chat/completions'), 'https://translation.example/*');
});
test('rolling scheduler translates all three hours; it never stops at an initial chunk', async () => {
  const scheduler = new C.Scheduler({translate: async c => '中文 ' + c.id, maxCache: 1100});
  scheduler.setCues(cues(3), 'en'); scheduler.enabled = true;
  for (let t = 0; t < 10800; t += 6) { scheduler.tick(t, 1, t * 1000); await settle(); }
  assert.equal(scheduler.metrics.translated, 1800);
  assert.ok(scheduler.cache.size <= 1100); assert.equal(scheduler.get(scheduler.cues.at(-1)), '中文 1799');
});
test('seeking cancels old jobs, ignores late results and prioritizes the new position', async () => {
  const jobs = [], scheduler = new C.Scheduler({translate: (cue, lang, signal) => new Promise(resolve => jobs.push({cue, signal, resolve}))});
  scheduler.setCues(cues(3), 'en'); scheduler.enabled = true;
  scheduler.tick(0, 1, 0); await settle();
  assert.equal(jobs.length, 2); scheduler.tick(7200, 1, 1000); await settle();
  assert.ok(jobs[0].signal.aborted); assert.ok(jobs[1].signal.aborted);
  assert.equal(jobs[2].cue.start, 7200); assert.equal(jobs[3].cue.start, 7206);
  jobs[0].resolve('过期结果'); jobs[2].resolve('新位置'); await settle();
  assert.equal(scheduler.cache.has('0'), false); assert.equal(scheduler.get(scheduler.cues[1200]), '新位置');
});
test('rewinding reuses cached translations without another network request', async () => {
  let calls = 0; const scheduler = new C.Scheduler({translate: async c => { calls++; return c.text; }});
  scheduler.setCues(cues(), 'en'); scheduler.enabled = true;
  scheduler.tick(0, 1, 0); await settle(); scheduler.tick(12, 1, 12000); await settle();
  const before = calls; scheduler.tick(0, 1, 13000); await settle();
  assert.equal(calls, before + 2); // Newly pre-read 6/7, while the current 0/1 come from cache.
  assert.equal(scheduler.get(scheduler.cues[0]), 'Sentence 0.');
});
test('a failed segment retries with backoff and does not block later segments', async () => {
  let count = 0;
  const scheduler = new C.Scheduler({translate: async c => { if (c.id === '0' && count++ < 1) throw new Error('offline'); return '译文'; }});
  scheduler.setCues(cues(), 'en'); scheduler.enabled = true;
  const now = Date.now(); scheduler.tick(0, 1, now); await settle();
  assert.equal(scheduler.failures.get('0').count, 1);
  scheduler.tick(0, 1, now + 100); await settle(); assert.equal(count, 1); assert.ok(scheduler.cache.has('2'));
  scheduler.tick(0, 1, now + 3000); await settle(); assert.equal(count, 2); assert.equal(scheduler.get(scheduler.cues[0]), '译文');
});
test('rate-limited service honors retry-after; empty translations are retryable', async () => {
  const scheduler = new C.Scheduler({translate: async c => { if (c.id === '0') { const e = new Error('429'); e.retryAfter = 30; throw e; } return ''; }});
  scheduler.setCues(cues(), 'en'); scheduler.enabled = true;
  const now = Date.now(); scheduler.tick(0, 1, now); await settle();
  assert.ok(scheduler.failures.get('0').next >= now + 30000); assert.ok(scheduler.failures.has('1'));
  const failed = scheduler.metrics.failures;
  scheduler.tick(6, 1, now + 5000); await settle(); assert.equal(scheduler.metrics.failures, failed);
});
test('native Chinese captions need no translation requests', async () => {
  let calls = 0; const scheduler = new C.Scheduler({translate: async () => { calls++; return 'x'; }});
  scheduler.setCues([{id: 'zh', start: 0, end: 5, text: '中文原字幕'}], 'zh-CN', true); scheduler.enabled = true;
  scheduler.tick(0); await settle(); assert.equal(calls, 0); assert.equal(scheduler.get(scheduler.cues[0]), '中文原字幕');
});
test('stopping and navigation invalidate requests before they can update caches', async () => {
  let resolve; const scheduler = new C.Scheduler({translate: () => new Promise(r => { resolve = r; })});
  scheduler.setCues(cues(), 'en'); scheduler.enabled = true; scheduler.tick(0); await settle();
  scheduler.stop(); resolve('stale'); await settle(); assert.equal(scheduler.cache.size, 0); assert.equal(scheduler.active.size, 0);
});
test('pre-read horizon adapts to latency and video rate, with an upper limit', () => {
  const scheduler = new C.Scheduler({translate: async () => 'x'});
  assert.equal(scheduler.horizon(1), 100); assert.equal(scheduler.horizon(2), 200);
  scheduler.latency = 20; assert.equal(scheduler.horizon(2), 300);
});

test('a negative subtitle offset after a seek prepares its older sentence alongside current audio',async()=>{
  const calls=[],scheduler=new C.Scheduler({translate:async cue=>{calls.push(cue.id);return '译文 '+cue.id}});
  scheduler.setCues(cues(),'en');scheduler.settings={...C.defaults,subtitleTiming:'video',subtitleOffset:-10};scheduler.enabled=true;
  scheduler.tick(600,1,0);await settle();assert.deepEqual(calls,['100','98']);
  assert.equal(scheduler.get(C.subtitleCue(scheduler.cues,600,scheduler.settings)),'译文 98');
});

test('video-following subtitles prepare ahead of a lagging complete-reading queue without aborting either required job',async()=>{
  const jobs=[],scheduler=new C.Scheduler({translate:(cue,lang,signal)=>new Promise(resolve=>jobs.push({cue,signal,resolve}))});
  scheduler.setCues(cues(),'en');scheduler.settings={...C.defaults,syncMode:'complete',subtitleTiming:'video',subtitleOffset:0};scheduler.enabled=true;
  scheduler.tick(600,1,0,0);await settle();assert.deepEqual(jobs.map(j=>j.cue.id),['0','100']);
  scheduler.tick(602,1,2000,0);await settle();assert.ok(jobs.every(j=>!j.signal.aborted));
  jobs[0].resolve('朗读句');jobs[1].resolve('画面句');await settle();assert.equal(scheduler.get(scheduler.cues[0]),'朗读句');assert.equal(scheduler.get(scheduler.cues[100]),'画面句');
});

test('a displayed sentence far ahead of complete narration retains translation retry backoff',async()=>{
  let attempts=0;const scheduler=new C.Scheduler({translate:async cue=>{if(cue.id==='100'){attempts++;throw new Error('offline')}return '朗读译文'}});
  scheduler.setCues(cues(),'en');scheduler.settings={...C.defaults,syncMode:'complete',subtitleTiming:'video'};scheduler.enabled=true;
  const now=Date.now();scheduler.tick(600,1,now,0);await settle();
  scheduler.tick(600,1,now+100,0);await settle();scheduler.tick(600,1,now+200,0);await settle();
  assert.equal(attempts,1);assert.ok(scheduler.failures.has('100'));
});

test('complete speech speed multiplies the base setting by video speed including values above 2.5', () => {
  const settings={rate:1.5,syncMode:'complete'};
  assert.equal(C.speechRate(settings,2,9),3);
  assert.equal(C.speechRate({...settings,rate:1.23},2),2.46);
  assert.equal(C.speechRate(settings,.25),.375);
  assert.equal(C.speechRate({...settings,rate:2.5},4),10);
  assert.equal(C.speechRate(settings,NaN),1.5);
});

test('follow mode multiplies base speed too and can speed up further to fit a subtitle', () => {
  assert.equal(C.speechRate({rate:1.5,syncMode:'follow'},2,1),3);
  assert.equal(C.speechRate({rate:1.5,syncMode:'follow'},2,4),4);
});

test('complete narration retains every due cue through hours of lag and only advances after finishing', () => {
  const queue = new C.NarrationQueue(), rows = cues(3);
  queue.update(rows, 0); queue.update(rows, 10800);
  assert.equal(queue.pending.length, 1800); assert.equal(queue.head.id, '0');
  queue.finish('17'); assert.equal(queue.head.id, '0');
  for (let i = 0; i < 1800; i++) { assert.equal(queue.head.id, String(i)); queue.finish(String(i)); }
  assert.equal(queue.head, null); queue.update(rows, 10800); assert.equal(queue.pending.length, 0);
});

test('complete narration starts at the current position and an explicit seek drops the previous backlog', () => {
  const queue = new C.NarrationQueue(), rows = cues(3);
  queue.reset(7200); queue.update(rows, 7260); assert.equal(queue.head.id, '1200');
  queue.reset(12); queue.update(rows, 12); assert.deepEqual(queue.pending.map(c => c.id), ['2']);
});

test('live transcript replacement does not duplicate completed or pending narration', () => {
  const queue = new C.NarrationQueue(), rows = cues();
  queue.update(rows.slice(0, 3), 6); queue.finish('0');
  queue.update(rows.slice(0, 5), 18); assert.deepEqual(queue.pending.map(c => c.id), ['1','2','3']);
  queue.update(rows.slice(1, 6), 24); assert.deepEqual(queue.pending.map(c => c.id), ['1','2','3','4']);
});

test('complete reading translates the oldest unread cue despite playback being hours ahead', async () => {
  const calls = [], scheduler = new C.Scheduler({translate: async c => { calls.push(c.id); return '中文 ' + c.id; }});
  scheduler.setCues(cues(3), 'en'); scheduler.settings.syncMode = 'complete'; scheduler.enabled = true;
  scheduler.tick(7200, 1, 0, 0); await settle();
  assert.deepEqual(calls, ['0','1']); assert.equal(scheduler.get(scheduler.cues[0]), '中文 0');
  scheduler.tick(7206, 1, 6000, 6); await settle();
  assert.deepEqual(calls, ['0','1','2','3']);
});

test('video advancing does not cancel a delayed translation required by complete reading', async () => {
  const jobs = [], scheduler = new C.Scheduler({translate: (cue,lang,signal) => new Promise(resolve => jobs.push({cue,signal,resolve}))});
  scheduler.setCues(cues(3), 'en'); scheduler.settings.syncMode = 'complete'; scheduler.enabled = true;
  scheduler.tick(0, 1, 0, 0); await settle();
  scheduler.tick(300, 1, 300000, 0); await settle();
  assert.equal(jobs.length, 2); assert.ok(jobs.every(j => !j.signal.aborted));
  jobs[0].resolve('延迟的第一句'); await settle(); assert.equal(scheduler.get(scheduler.cues[0]), '延迟的第一句');
});

test('complete translation still detects real seeks using the video clock', async () => {
  const jobs = []; let resets = 0;
  const scheduler = new C.Scheduler({translate: (cue,lang,signal) => new Promise(resolve => jobs.push({cue,signal,resolve})), onReset:()=>resets++});
  scheduler.setCues(cues(3), 'en'); scheduler.settings.syncMode = 'complete'; scheduler.enabled = true;
  scheduler.tick(0, 1, 0, 0); await settle();
  scheduler.tick(7200, 1, 1000, 7200); await settle();
  assert.equal(resets, 2); assert.ok(jobs[0].signal.aborted); assert.equal(jobs[2].cue.id, '1200');
});
