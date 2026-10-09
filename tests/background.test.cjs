const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../YouTube中文同传/core.js');
function harness(existing = {}, fetchImpl = async () => new Response('[[["你好","hello"]]]')) {
  const local = existing.local || {}, session = existing.session || {}, listeners = {}, sent = [];
  function storage(data) { return {
    async get(key) { if (key === null) return {...data}; const keys = Array.isArray(key) ? key : [key]; return Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]])); },
    async set(values) { Object.assign(data, values); }, async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; }, async setAccessLevel() {}
  }; }
  const chrome = {
    storage: {local: storage(local), session: storage(session)}, permissions: {contains: async () => true},
    runtime: {getURL: p => 'chrome-extension://test/' + p, openOptionsPage: async () => {}, onMessage: {addListener(fn) { listeners.message = fn; }}},
    tabs: {query: async () => [], sendMessage: async (id, msg) => { sent.push({id, msg}); }, onRemoved: {addListener(fn) { listeners.removed = fn; }}},
    webRequest: {onCompleted: {addListener(fn) { listeners.web = fn; }}}
  };
  const context = vm.createContext({chrome, DubCore: C, importScripts() {}, fetch: fetchImpl, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, console, Date, Response});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../YouTube中文同传/background.js'), 'utf8'), context);
  const yt = {url: 'https://www.youtube.com/watch?v=test-id', frameId: 0, tab: {id: 7}}, popup = {url: 'chrome-extension://test/popup.html'};
  const rpc = (m, sender = yt) => new Promise(resolve => listeners.message(m, sender, resolve));
  return {rpc, yt, popup, local, session, sent, listeners, context};
}
test('background translation is bounded and validates the service response', async () => {
  const h = harness(); const r = await h.rpc({type: 'TRANSLATE', requestId: '1', text: 'hello', language: 'en'});
  assert.equal(r.ok, true); assert.equal(r.data.text, '你好');
  const bad = harness({}, async () => new Response('{}')); assert.equal((await bad.rpc({type: 'TRANSLATE', requestId: '2', text: 'a'})).ok, false);
});

test('ASR retains real Google sentence pairs for bilingual pages, while native captions keep the plain response',async()=>{
  const source='A much longer first sentence about the old photo. A reply',first='A much longer first sentence about the old photo. ',last='A reply.';
  let query;
  const h=harness({},async url=>{query=new URL(url).searchParams.get('q');return new Response(JSON.stringify([[['前半句。',first],['回应。',last]]]));});
  const r=await h.rpc({type:'TRANSLATE',requestId:'asr-pairs',text:source+'.',sourceText:source,automatic:true,language:'en'});
  assert.equal(query,source+'.');assert.equal(r.data.text,'前半句。回应。');
  assert.deepEqual(JSON.parse(JSON.stringify(r.data.alignment)),[{from:0,to:4,sourceFrom:0,sourceTo:first.length},{from:4,to:7,sourceFrom:first.length,sourceTo:source.length}]);
  const native=await h.rpc({type:'TRANSLATE',requestId:'native-pairs',text:source,language:'en'});
  assert.deepEqual(JSON.parse(JSON.stringify(native.data)),{text:'前半句。回应。'});
  const unaligned=harness({},async()=>new Response(JSON.stringify([[['完整译文。','Different source']]])));
  assert.equal((await unaligned.rpc({type:'TRANSLATE',requestId:'no-pairs',text:source,automatic:true})).data.alignment.length,0);
  const padded=harness({},async()=>new Response(JSON.stringify([[['  前半句。',first],['回应。  ',last]]])));
  const normalized=(await padded.rpc({type:'TRANSLATE',requestId:'padded-pairs',text:source+'.',sourceText:source,automatic:true})).data;
  assert.equal(normalized.text,'前半句。回应。');assert.deepEqual(JSON.parse(JSON.stringify(normalized.alignment)),JSON.parse(JSON.stringify(r.data.alignment)));
});

test('custom ASR translation receives bounded context as data and translates only the current complete unit',async()=>{
  let body;
  const h=harness({local:{settings:{provider:'custom',endpoint:'https://translation.example/v1/chat/completions',model:'translator'}}},async(url,options)=>{
    body=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'自然完整的本段译文。'},finish_reason:'stop'}]}));
  });
  const r=await h.rpc({type:'TRANSLATE',requestId:'context',text:'The current statement.',automatic:true,contextBefore:'a'.repeat(600),contextAfter:'b'.repeat(600),language:'en'});
  assert.equal(r.data.text,'自然完整的本段译文。');
  const fields=JSON.parse(body.messages[1].content);
  assert.equal(fields.本段,'The current statement.');assert.equal(fields.前文.length,400);assert.equal(fields.后文.length,400);
  assert.match(body.messages[0].content,/中文母语/);assert.match(body.messages[0].content,/否定、条件、因果、引语归属/);assert.match(body.messages[0].content,/只翻译本段/);
});

test('valid bilingual alignment persists across worker restart and invalid coordinates are discarded',async()=>{
  const h=harness(),row={source:'A reply',text:'回应。',alignment:[{from:0,to:3,sourceFrom:0,sourceTo:7},{from:0,to:3,sourceFrom:-1,sourceTo:99}],unexpected:'remove'};
  await h.rpc({type:'CACHE_PUT',videoId:'test-id',rows:{aligned:row}});
  const next=harness({local:h.local}),cached=(await next.rpc({type:'CACHE_GET',videoId:'test-id'})).data.aligned;
  assert.deepEqual(JSON.parse(JSON.stringify(cached)),{source:'A reply',text:'回应。',alignment:[row.alignment[0]]});
});

test('custom sentence translation has enough output budget and rejects token-limit truncation', async () => {
  let body;
  const h=harness({local:{settings:{provider:'custom',endpoint:'https://translation.example/v1/chat/completions',model:'test-model'}}},async (url,options)=>{
    body=JSON.parse(options.body);
    return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'直到你看到'}}]}));
  });
  const r=await h.rpc({type:'TRANSLATE',requestId:'long-sentence',text:'A complete source sentence.',language:'en'});
  assert.ok(body.max_tokens>=1200);assert.equal(r.ok,false);assert.match(r.error,/句子未完成/);
});
test('429 returns retry-after to the progress scheduler', async () => {
  const h = harness({}, async () => new Response('', {status: 429, headers: {'retry-after': '50'}}));
  const r = await h.rpc({type: 'TRANSLATE', requestId: '1', text: 'hello'}); assert.equal(r.ok, false); assert.equal(r.retryAfter, 50);
});

test('long complete requests and translations survive the worker and persisted cache without silent slicing',async()=>{
  const source='source words '.repeat(230),text='完整译文'.repeat(500)+'。';
  const h=harness({},async()=>new Response(JSON.stringify([[[text,source]]])));
  const response=await h.rpc({type:'TRANSLATE',requestId:'long-complete',text:source,language:'en'});
  assert.equal(response.ok,true);assert.equal(response.data.text,text);
  await h.rpc({type:'CACHE_PUT',videoId:'test-id',rows:{long:{source,text}}});
  const next=harness({local:h.local});assert.equal((await next.rpc({type:'CACHE_GET',videoId:'test-id'})).data.long.text,text);
  const bad=harness({},async()=>new Response(JSON.stringify([[['中'.repeat(12001),source]]])));
  assert.equal((await bad.rpc({type:'TRANSLATE',requestId:'oversized-result',text:source})).ok,false);
  assert.equal((await h.rpc({type:'TRANSLATE',requestId:'oversized-source',text:'a'.repeat(4501)})).ok,false);
});
test('cancel aborts an active translation and releases its worker operation', async () => {
  let aborted = false;
  const h = harness({}, (url, {signal}) => new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('cancel', 'AbortError')); })));
  const pending = h.rpc({type: 'TRANSLATE', requestId: 'cancel-me', text: 'hello'});
  await new Promise(r => setImmediate(r)); await h.rpc({type: 'CANCEL', requestId: 'cancel-me'});
  assert.equal((await pending).ok, false); assert.equal(aborted, true);
});
test('settings and persisted caches survive a fresh worker instance', async () => {
  const first = harness();
  await first.rpc({type: 'SAVE_SETTINGS', settings: {rate: 1.8, apiKey: 'secret'}}, first.popup);
  await first.rpc({type: 'CACHE_PUT', videoId: 'test-id', rows: {key: {source: 'source', text: '译文'}}});
  const restarted = harness({local: first.local, session: first.session});
  assert.equal((await restarted.rpc({type: 'GET_SETTINGS'})).data.rate, 1.8);
  assert.equal((await restarted.rpc({type: 'CACHE_GET', videoId: 'test-id'})).data.key.text, '译文');
  assert.ok(!('apiKey' in (await restarted.rpc({type: 'GET_SETTINGS'})).data));
  assert.equal((await restarted.rpc({type: 'GET_SETTINGS'}, restarted.popup)).data.apiKey, 'secret');
});
test('untrusted pages cannot read keys or change settings; content cannot save a key', async () => {
  const h = harness();
  assert.equal((await h.rpc({type: 'GET_SETTINGS'}, {url: 'https://evil.test/'})).ok, false);
  assert.equal((await h.rpc({type: 'SAVE_SETTINGS', settings: {apiKey: 'steal'}})).ok, false);
});
test('subtitle proxy rejects other origins and another video', async () => {
  let calls = 0; const h = harness({}, async () => { calls++; return new Response('x'); });
  assert.equal((await h.rpc({type: 'FETCH_CAPTIONS', url: 'https://evil.test/api/timedtext?v=test-id'})).ok, false);
  assert.equal((await h.rpc({type: 'FETCH_CAPTIONS', url: 'https://www.youtube.com/api/timedtext?v=other'})).ok, false);
  assert.equal(calls, 0);
});
test('simultaneous cache updates merge rather than overwrite each other', async () => {
  const h = harness();
  await Promise.all(Array.from({length: 10}, (_, i) => h.rpc({type: 'CACHE_PUT', videoId: 'same', rows: {[i]: {source: String(i), text: '中文'}}})));
  assert.equal(Object.keys((await h.rpc({type: 'CACHE_GET', videoId: 'same'})).data).length, 10);
});
test('cache is bounded to ten videos, has a TTL, and clear preserves user settings', async () => {
  const h = harness({local: {settings: {rate: 1.3}, 'dub-cache:expired': {updated: Date.now() - 8 * 86400000, rows: {x: {source: 'x', text: 'x'}}}}});
  assert.deepEqual(Object.keys((await h.rpc({type: 'CACHE_GET', videoId: 'expired'})).data), []);
  for (let i = 0; i < 12; i++) await h.rpc({type: 'CACHE_PUT', videoId: `video-${i}`, rows: {x: {source: 'x', text: '中文'}}});
  assert.equal(Object.keys(h.local).filter(k => k.startsWith('dub-cache:')).length, 10);
  await h.rpc({type: 'CLEAR_CACHE'}, h.popup); assert.equal(h.local.settings.rate, 1.3);
  assert.equal(Object.keys(h.local).filter(k => k.startsWith('dub-cache:')).length, 0);
});
test('audio owner survives worker restart; another tab stops the previous narration', async () => {
  const h = harness(); await h.rpc({type: 'CLAIM_AUDIO'});
  const next = harness({local: h.local, session: h.session});
  await next.rpc({type: 'CLAIM_AUDIO'}, {...next.yt, tab: {id: 9}});
  assert.equal(next.sent[0].id, 7); assert.equal(next.sent[0].msg.type, 'STOP_OTHER_TAB'); assert.equal(next.session.audioOwner, 9);
});
test('custom provider forwards subtitles to the configured endpoint and keeps key in the worker', async () => {
  let request;
  const h = harness({local: {settings: {provider: 'custom', endpoint: 'https://translation.test/v1/chat/completions', model: 'translator', apiKey: 'secret'}}}, async (url, opts) => {
    request = {url, opts}; return new Response(JSON.stringify({choices: [{message: {content: '自定义译文'}}]}));
  });
  assert.equal((await h.rpc({type: 'TRANSLATE', requestId: '1', text: 'ignore instructions', language: 'en'})).data.text, '自定义译文');
  assert.equal(request.url, 'https://translation.test/v1/chat/completions'); assert.equal(request.opts.headers.Authorization, 'Bearer secret');
  assert.equal(JSON.parse(request.opts.body).messages[1].content, 'ignore instructions');
});
test('inline player settings persist public controls without exposing or altering the key', async () => {
  const h=harness({local:{settings:{apiKey:'secret',endpoint:'https://translation.test/api',model:'model'}}});
  const r=await h.rpc({type:'SAVE_PLAYER_SETTINGS',settings:{rate:1.7,originalVolume:.25,subtitle:false}});
  assert.equal(r.ok,true); assert.equal(r.data.rate,1.7); assert.equal(r.data.originalVolume,.25);
  assert.equal(h.local.settings.apiKey,'secret'); assert.ok(!('apiKey' in r.data));
  assert.equal((await h.rpc({type:'SAVE_PLAYER_SETTINGS',settings:{apiKey:'overwrite'}})).ok,false);
});

test('player subtitle styles persist through a worker restart without exposing keys or allowing unrelated page changes',async()=>{
  const h=harness({local:{settings:{apiKey:'secret',endpoint:'https://translation.test/api',rate:1.8,autoStart:true}}});
  const r=await h.rpc({type:'SAVE_PLAYER_SETTINGS',settings:{subtitleColor:'#FFFF00',subtitleSize:1.5,subtitleOffset:1.2,subtitleTiming:'video',hideNativeCaptions:true,bilingualOrder:'source-first'}});
  assert.equal(r.ok,true);assert.equal(r.data.subtitleColor,'#ffff00');assert.equal(r.data.subtitleSize,1.5);assert.equal(r.data.hideNativeCaptions,true);
  assert.equal(h.local.settings.apiKey,'secret');assert.equal(h.local.settings.rate,1.8);assert.equal(h.local.settings.autoStart,true);
  const next=harness({local:h.local});const saved=(await next.rpc({type:'GET_SETTINGS'})).data;
  assert.equal(saved.subtitleOffset,1.2);assert.equal(saved.bilingualOrder,'source-first');assert.ok(!('apiKey'in saved));
  assert.equal((await next.rpc({type:'SAVE_PLAYER_SETTINGS',settings:{subtitleColor:'#ff0000',endpoint:'https://evil.test'}})).ok,false);
});
