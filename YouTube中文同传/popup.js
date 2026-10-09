'use strict';
let tabId = null, current = null;
const $ = id => document.getElementById(id);
async function rpc(message) { const r = await chrome.runtime.sendMessage(message); if (!r?.ok) throw new Error(r?.error || '扩展未响应'); return r.data; }
async function videoMessage(type) {
  if (!tabId) throw new Error('请打开 YouTube 视频');
  return chrome.tabs.sendMessage(tabId, {type});
}
async function refresh() {
  try {
    current = await videoMessage('STATUS');
    if (!current?.videoId) throw new Error('请先打开一个 YouTube 视频，然后刷新页面');
    $('toggle').disabled = $('retry').disabled = $('export').disabled = false;
    $('toggle').textContent = current.active ? '停止同传' : '开始同传'; $('mode').value = current.mode;
    $('status').textContent = current.active ? `${current.source || '正在读取字幕…'}\n已准备约 ${Math.round(current.readySeconds)} 秒 · 翻译中 ${current.translating} 段\n${current.voice || '等待中文朗读'}` : '已连接视频，点击开始同传。';
    $('error').textContent = current.error || '';
    const m = current.metrics;
    $('diagnostics').textContent = `视频：${current.videoId}\n字幕：${current.cues} 段 · 内存译文：${current.cached} 段\n翻译成功：${m.translated} · 重试：${m.failures}\n取消旧任务：${m.aborted} · 语音恢复：${m.speechErrors}\n超时跟随：${m.skipped}\n中文声音：${current.voices.length} 个`;
  } catch (error) {
    $('status').textContent = '请在 YouTube 视频页使用。'; $('error').textContent = '如果刚安装或更新插件，请刷新 YouTube 页面。';
    $('toggle').disabled = $('retry').disabled = $('export').disabled = true;
  }
}
function attempt(task) { Promise.resolve().then(task).catch(e => { $('error').textContent = e.message; }); }
$('toggle').addEventListener('click', () => attempt(async () => { await videoMessage('TOGGLE'); await refresh(); }));
$('retry').addEventListener('click', () => attempt(async () => { await videoMessage('RETRY'); await refresh(); }));
$('export').addEventListener('click', () => attempt(() => videoMessage('EXPORT')));
$('options').addEventListener('click', () => attempt(async () => {
  if (current?.videoId) { await videoMessage('OPEN_PLAYER_SETTINGS'); window.close(); }
  else await chrome.runtime.openOptionsPage();
}));
$('mode').addEventListener('change', () => attempt(async () => { await rpc({type: 'SAVE_SETTINGS', settings: {syncMode: $('mode').value}}); await refresh(); }));
chrome.tabs.query({active: true, currentWindow: true}).then(tabs => { tabId = tabs[0]?.id; return refresh(); });
setInterval(refresh, 1500);
