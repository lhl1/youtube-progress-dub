'use strict';
const $ = id => document.getElementById(id);
let saved = {...DubCore.defaults};
const fields = [...DubCore.playerSettingKeys,'endpoint','model','apiKey'];
const captionStyle=document.createElement('style');captionStyle.textContent=DubSubtitles.css;document.head.appendChild(captionStyle);
$('captionSettings').innerHTML=DubSubtitles.controlsMarkup();
const engine = new DubSpeech({onError: e => { $('voiceMessage').textContent = e.message; }});
async function rpc(m) { const r = await chrome.runtime.sendMessage(m); if (!r?.ok) throw new Error(r?.error || '扩展未响应'); return r.data; }
function labels() {
  $('rateValue').textContent = `${Number($('rate').value).toFixed(2)}×`;
  for (const key of ['volume', 'originalVolume']) $(key + 'Value').textContent = `${Math.round(Number($(key).value) * 100)}%`;
  $('lookaheadValue').textContent = `${$('lookahead').value} 秒`;
  $('customFields').classList.toggle('hidden', $('provider').value !== 'custom');
  const captionSettings={...saved};
  for(const key of DubCore.subtitleSettingKeys){const e=$(key);captionSettings[key]=e.type==='checkbox'?e.checked:e.type==='range'?Number(e.value):e.value;}
  DubSubtitles.refreshControls($('captionSettings'),captionSettings);
}
DubSubtitles.bindButtons($('captionSettings'),patch=>{
  for(const [key,value] of Object.entries(patch)){const e=$(key);if(e.type==='checkbox')e.checked=value;else e.value=value;}
  labels();
});
function voiceList(selected) {
  const name = typeof selected === 'string' ? selected : $('voice').value;
  const voices = engine.voices(); $('voice').replaceChildren(new Option('自动选择 · 优先 Edge 自然声音', ''));
  for (const v of voices) $('voice').append(new Option(`${v.name}${v.localService && !/Online|Natural|Neural/i.test(v.name) ? ' · 本地' : ' · 自然 / 在线'}`, v.name));
  if (name && !voices.some(v => v.name === name)) $('voice').append(new Option(`${name} · 当前未提供（自动备用）`, name));
  $('voice').value = name;
  $('voiceHint').textContent = voices.length ? `已发现 ${voices.length} 个中文声音。在线自然声音需要网络连接。` : '暂未发现中文声音。请用 Edge 打开本页，稍候重新获取，或在 Windows 中安装中文语音。';
}
function fill(s) {
  for (const key of fields) { const e = $(key); if (e.type === 'checkbox') e.checked = s[key]; else e.value = s[key]; }
  voiceList(s.voice); labels();
}
async function cacheStats() {
  const stats = await rpc({type: 'CACHE_STATS'}); $('cacheStats').textContent = `${stats.videos} 个视频 · 约 ${(stats.bytes / 1024 / 1024).toFixed(2)} MB 译文`;
}
$('form').addEventListener('input', labels);
$('form').addEventListener('submit', async event => {
  event.preventDefault(); $('message').textContent = '正在保存…';
  const next = {...saved};
  for (const key of fields) { const e = $(key); next[key] = e.type === 'checkbox' ? e.checked : e.type === 'range' ? Number(e.value) : e.value.trim(); }
  try {
    if (next.provider === 'custom') {
      const u = new URL(next.endpoint);
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))) throw new Error('请填写 HTTPS 地址或本机 HTTP 地址');
      if (u.username || u.password) throw new Error('地址不能包含账号密码');
      if (!next.model) throw new Error('请填写模型名称');
      const granted = await chrome.permissions.request({origins: [DubCore.permissionOrigin(u.href)]});
      if (!granted) throw new Error('未获得该翻译域名的访问权限，设置未保存');
    }
    await rpc({type: 'SAVE_SETTINGS', settings: next}); saved = {...next};
    $('message').textContent = '设置已保存，当前视频立即生效。'; $('message').classList.add('success');
  } catch (e) { $('message').textContent = e.message; $('message').classList.remove('success'); }
});
$('testVoice').addEventListener('click', () => {
  engine.failedVoices.clear();
  $('voiceMessage').textContent = '正在试听…';
  engine.speak('你好，这是 YouTube 中文同传。字幕会跟随播放进度，持续翻译并用中文朗读。', {
    voice: $('voice').value, rate: Number($('rate').value), volume: Number($('volume').value),
    onDone: reason => { if (reason === 'end') $('voiceMessage').textContent = `试听完成：${engine.lastVoice}`; }
  });
});
$('refreshVoices').addEventListener('click', voiceList);
$('reset').addEventListener('click', () => { fill(DubCore.defaults); $('message').textContent = '已填入推荐设置，点击“保存设置”生效。'; });
$('clearCache').addEventListener('click', async () => {
  try { await rpc({type: 'CLEAR_CACHE'}); await cacheStats(); $('message').textContent = '本地译文已清除；当前视频的内存译文会保留到刷新页面。'; }
  catch (e) { $('message').textContent = e.message; }
});
speechSynthesis.addEventListener('voiceschanged', voiceList);
window.addEventListener('pagehide', () => engine.stop());
rpc({type: 'GET_SETTINGS'}).then(s => { saved = s; fill(s); return cacheStats(); }).catch(e => { $('message').textContent = e.message; });
voiceList();
