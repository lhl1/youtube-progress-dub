(() => {
  'use strict';
  const C = DubCore, CHANNEL = 'progress-dub-v1';
  let settings = {...C.defaults}, currentId = '', active = false, video = null, videoListeners = null;
  let tracks = [], trackKey = '', sourceLang = 'auto', sourceName = '', sourceAutomatic = false, isLive = false;
  let loading = false, loadSerial = 0, retryAt = 0, captionFailures = 0, lastCaptionRefresh = 0;
  let lastCaptureUrl = '', lastCapturedBody = null, fallbackText = '';
  let cacheRows = {}, dirtyCache = {}, cacheTimer = null, cacheOwner = '';
  let errorText = '', errorUntil = 0, lastSpoken = '', mediaWaiting = false, speechRetryAt = 0;
  const narration = new C.NarrationQueue();
  const sessionVolume = new DubVolume();
  let sessionToken = 0, view = null, speechErrors = 0, skipped = 0;
  let pendingStartId = '', pendingStartAt = 0, voiceNeedsGesture = false;
  const pendingPage = new Map();
  const scheduler = new C.Scheduler({
    translate: requestTranslation,
    onResult: (cue, text) => {
      const key = C.cacheKey(cue, sourceLang, settings);
      cacheRows[key] = {source: cue.text, text, ...(cue.automatic?{alignment:C.validatedAlignment(cue.alignment,cue.text,text)}:{})}; dirtyCache[key] = cacheRows[key];
      if (Object.keys(cacheRows).length > 1200) cacheRows = Object.fromEntries(Object.entries(cacheRows).slice(-1100));
      if (!cacheTimer) cacheTimer = setTimeout(flushCache, 2000);
      tick();
    },
    onError: error => report(error.message),
    onReset: () => { speech.stop(); restoreVolume(); lastSpoken = ''; narration.reset(video?.currentTime || 0); }
  });
  const speech = new DubSpeech({
    onState: current => { if (!current) restoreVolume(); render(); },
    onError: error => { speechErrors++; if (error.code === 'not-allowed') voiceNeedsGesture = true; report(error.message, 15000); }
  });
  function sendPage(type, data = {}) { window.postMessage({channel: CHANNEL, direction: 'to-page', type, ...data}, location.origin); }
  function rpc(message, timeout = 17000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('扩展请求超时，正在恢复')), timeout);
      chrome.runtime.sendMessage(message).then(r => {
        clearTimeout(timer);
        if (!r?.ok) { const e = new Error(r?.error || '扩展服务未响应'); e.retryAfter = r?.retryAfter; reject(e); }
        else resolve(r.data);
      }, e => { clearTimeout(timer); reject(new Error(e.message?.includes('context invalidated') ? '插件已更新，请刷新 YouTube 页面' : e.message)); });
    });
  }
  async function requestTranslation(cue, lang, signal) {
    const key = C.cacheKey(cue, lang, settings), cached = cacheRows[key];
    if (cached?.source === cue.text) { cue.alignment=C.validatedAlignment(cached.alignment,cue.text,cached.text); return cached.text; }
    const requestId = crypto.randomUUID();
    const cancel = () => rpc({type: 'CANCEL', requestId}, 3000).catch(() => {});
    signal.addEventListener('abort', cancel, {once: true});
    try {
      if (signal.aborted) throw new DOMException('取消', 'AbortError');
      const r = await rpc({type: 'TRANSLATE', requestId, text: C.translationInput(cue,lang), language: lang, ...(cue.automatic?{automatic:true,sourceText:cue.text,contextBefore:cue.contextBefore,contextAfter:cue.contextAfter}:{})});
      if (signal.aborted) throw new DOMException('取消', 'AbortError');
      if(cue.automatic)cue.alignment=C.validatedAlignment(r.alignment,cue.text,r.text);
      return r.text;
    } finally { signal.removeEventListener('abort', cancel); }
  }
  function fetchPage(url) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        pendingPage.delete(requestId); sendPage('ABORT', {requestId}); reject(new Error('字幕请求超时'));
      }, 13500);
      pendingPage.set(requestId, {resolve, reject, timer}); sendPage('FETCH_CAPTIONS', {url, requestId});
    });
  }
  async function fetchCaption(url) {
    try { return C.parseCaptions(await fetchPage(url), DOMParser); }
    catch (pageError) {
      const r = await rpc({type: 'FETCH_CAPTIONS', url});
      return C.parseCaptions(r.body, DOMParser);
    }
  }
  function report(message, duration = 10000) { errorText = message; errorUntil = Date.now() + duration; render(); }
  function flushCache() {
    clearTimeout(cacheTimer); cacheTimer = null;
    const rows = dirtyCache, owner = cacheOwner; dirtyCache = {};
    if (!owner || !Object.keys(rows).length) return;
    rpc({type: 'CACHE_PUT', videoId: owner, rows}, 8000).catch(() => {});
  }
  function installRows(rows, lang, translated, name, {liveAppend = false, automatic = false} = {}) {
    if (!rows.length) throw new Error('字幕中没有可读内容');
    // Replacing a live transcript every poll would interrupt the current voice.
    if (liveAppend && sourceAutomatic === automatic && scheduler.cues.length) {
      const old = new Map(scheduler.cues.map(c => [c.id, c]));
      for (const c of C.prepareCues(rows, {live: true, language: lang, automatic})) old.set(c.id, c);
      scheduler.cues = [...old.values()].sort((a, b) => a.start - b.start).slice(-5000);
    } else {
      sourceLang = lang; sourceName = name;
      const prepared=C.prepareCues(rows,{live:isLive,language:lang,automatic});
      const same=sourceAutomatic===automatic && scheduler.lang===lang && scheduler.translated===translated && prepared.length===scheduler.cues.length && prepared.every((c,i)=>{
        const old=scheduler.cues[i];return c.id===old.id && c.text===old.text && c.start===old.start && c.end===old.end;
      });
      // The page fetch and network capture can deliver the same transcript.
      // Preserve its in-flight translation and voice instead of reinstalling.
      if(!same) {
        scheduler.setCues(prepared,lang,translated);
        scheduler.enabled = active;
        for (const cue of scheduler.cues) {
          const cached = cacheRows[C.cacheKey(cue, lang, settings)];
          if (cached?.source === cue.text) { cue.alignment=C.validatedAlignment(cached.alignment,cue.text,cached.text); scheduler.put(cue, cached.text); }
        }
      }
    }
    sourceAutomatic = automatic; sourceName = name; captionFailures = 0; retryAt = 0; errorText = ''; lastCaptionRefresh = Date.now(); renderTracks(); tick();
  }
  function capturedAutomatic(url) {
    // Match the captured source, not whichever track happens to be selected.
    // A translated ASR URL still carries the original source kind.
    return C.isAutomaticCapture(tracks,url);
  }
  function capturedBody(url, body) {
    if (!active || !body || body.length > 12_000_000) return;
    try {
      const u = new URL(url); if (u.searchParams.get('v') !== currentId || u.origin !== location.origin || u.pathname !== '/api/timedtext') return;
      lastCaptureUrl = url; lastCapturedBody = {url, body};
      if (scheduler.cues.length && !isLive) return;
      const lang = u.searchParams.get('tlang') || u.searchParams.get('lang') || 'auto';
      const rows = C.parseCaptions(body, DOMParser);
      if (rows.length) installRows(rows, lang, C.isChinese(lang), `已捕获 ${lang} 字幕${isLive ? '（直播）' : ''}`, {liveAppend: isLive && sourceLang === lang, automatic: capturedAutomatic(url)});
    } catch (e) { report(e.message); }
  }
  async function loadCaptions(force = false) {
    if (!active || loading || (!force && Date.now() < retryAt)) return;
    if (!tracks.length && !lastCaptureUrl) { sendPage('INSPECT'); retryAt = Date.now() + 4000; return; }
    loading = true;
    const serial = ++loadSerial, id = currentId, token = sessionToken;
    const valid = () => active && id === currentId && token === sessionToken && serial === loadSerial;
    render();
    try {
      const selected = C.chooseTrack(tracks, trackKey);
      const base = selected?.baseUrl || lastCaptureUrl;
      const lang = selected?.languageCode || new URL(base).searchParams.get('lang') || 'auto';
      if (!base) throw new Error('暂未取得字幕地址');
      const candidates = [];
      // Translating raw ASR rows first loses English syntax before we can infer
      // sentence boundaries. Group the English ASR source before translation.
      const automatic = C.isAutomaticTrack(selected, base);
      const englishAsr = /^en(?:-|$)/i.test(lang) && automatic;
      if (settings.autoTranslate && !englishAsr && !C.isChinese(lang) && selected?.isTranslatable && settings.provider !== 'custom') {
        const u = new URL(base); u.searchParams.set('tlang', 'zh-Hans');
        candidates.push({url: u.href, lang: 'zh-Hans', translated: true, automatic, name: 'YouTube 自动翻译中文'});
      }
      candidates.push({url: base, lang, translated: C.isChinese(lang), automatic, name: selected?.name || lang});
      // YouTube can renew signed caption URLs during long sessions. A recently
      // observed request is a useful fallback when the player's old URL expires.
      if (lastCaptureUrl && lastCaptureUrl !== base) {
        const captured = new URL(lastCaptureUrl), captureLang = captured.searchParams.get('tlang') || captured.searchParams.get('lang') || 'auto';
        if (!trackKey || captureLang === lang || C.isChinese(captureLang)) candidates.push({url: lastCaptureUrl, lang: captureLang, translated: C.isChinese(captureLang), automatic: capturedAutomatic(lastCaptureUrl), name: `已更新 ${captureLang} 字幕`});
      }
      let lastError;
      for (const candidate of candidates) {
        if (!valid()) return;
        try {
          let rows = await fetchCaption(candidate.url);
          if (!rows.length) throw new Error('字幕返回为空');
          if (!valid()) return;
          installRows(rows, candidate.lang, candidate.translated, candidate.name, {liveAppend: isLive && sourceLang === candidate.lang, automatic: candidate.automatic});
          return;
        } catch (e) { lastError = e; }
      }
      throw lastError || new Error('字幕加载失败');
    } catch (e) {
      if (!valid()) return;
      captionFailures++;
      sendPage('INSPECT');
      retryAt = Date.now() + Math.min(60000, 3000 * 2 ** Math.min(captionFailures, 4));
      report(`${e.message}；将自动重试，也可使用当前屏幕字幕`, 15000);
    } finally { if (serial === loadSerial) loading = false; render(); }
  }
  function duckVolume() {
    if (active && video) sessionVolume.start(video, settings.originalVolume);
  }
  function restoreVolume(force = false) {
    if (active && !force) { sessionVolume.enforce(); return; }
    sessionVolume.stop();
  }
  function cueAt(position) {
    const c = scheduler.cues[C.lowerBound(scheduler.cues, position - 0.05)];
    return c && c.start <= position + 0.12 && c.end > position - 0.05 ? c : null;
  }
  function speakCue(cue, translated) {
    lastSpoken = cue.id;
    const token = sessionToken, vid = video;
    const seconds = Math.max(0.8, (cue.end - video.currentTime + 0.5) / video.playbackRate);
    const estimate = Math.max(0.5, [...translated].filter(ch => !/\s/.test(ch)).length / 5);
    const rate = C.speechRate(settings, video.playbackRate, estimate / seconds);
    const complete = settings.syncMode === 'complete';
    speechRetryAt = Date.now() + 5000;
    speech.speak(translated, {
      voice: settings.voice, volume: settings.volume, rate, cue, cueEnd: cue.end + 1,
      onStart: () => { if (token === sessionToken && vid === video) duckVolume(); },
      onDone: reason => {
        if (token !== sessionToken || vid !== video || reason === 'cancel') return;
        if (complete && reason === 'end') { narration.finish(cue.id); speechRetryAt = 0; }
        else if (complete) speechRetryAt = Date.now() + 5000;
        restoreVolume(); render();
        if (reason === 'end') setTimeout(tick, 0);
      }
    });
  }
  function updateSpeechRate() {
    if (!video || !speech.current) return;
    const seconds = Math.max(0.8, ((speech.current.options.cueEnd ?? video.currentTime + 3) - video.currentTime) / video.playbackRate);
    const estimate = Math.max(0.5, [...speech.current.text].filter(ch => !/\s/.test(ch)).length / 5);
    speech.setRate(C.speechRate(settings, video.playbackRate, estimate / seconds));
  }
  function scanScreenCaption(position) {
    const text = C.clean([...document.querySelectorAll('.ytp-caption-segment')].map(n => n.textContent).join(' '));
    if (!text || text === fallbackText) return;
    const previousText = fallbackText; fallbackText = text;
    const existing = scheduler.cues.at(-1);
    if (existing?.text === text && position < existing.end) return;
    const novel = previousText && text.startsWith(previousText + ' ') ? text.slice(previousText.length).trim() : text;
    const cue = {start: position, end: position + 5, text: novel, automatic: false, id: `screen:${position.toFixed(2)}:${C.hash(novel)}`};
    // Screen fallback is bounded; it only claims access to actually displayed captions.
    scheduler.cues.push(cue);
    scheduler.cues = settings.syncMode === 'complete' ? scheduler.cues.filter(c => c.end >= Math.min(position - 120, narration.head?.start ?? position)) : scheduler.cues.filter(c => c.end >= position - 120).slice(-200);
    scheduler.cues.sort((a, b) => a.start - b.start); sourceName = '当前屏幕字幕（无法预读）';
  }
  function tick() {
    if (!active || !video) { render(); return; }
    const position = video.currentTime, wall = Date.now();
    if (document.querySelector('#movie_player')?.classList.contains('ad-showing')) { if (settings.syncMode === 'complete') speech.pause(); else speech.stop(); restoreVolume(); render('广告期间暂停同传'); return; }
    if ((!scheduler.cues.length && !sourceName) || sourceName.startsWith('当前屏幕')) scanScreenCaption(position);
    const complete = settings.syncMode === 'complete';
    if (complete) narration.update(scheduler.cues, position);
    scheduler.tick(position, video.playbackRate, wall, complete ? narration.head?.start : null);
    if (complete) narration.update(scheduler.cues, position);
    if (mediaWaiting || video.seeking || (video.paused && !video.ended)) { render(); return; }
    if (voiceNeedsGesture) { render(); return; }
    if (speech.current?.paused) speech.resume();
    if (video.ended && !complete) { render(); return; }
    const cue = complete ? narration.head : cueAt(position), text = cue && scheduler.get(cue);
    if (speech.current && settings.syncMode === 'follow' && position > (speech.current.options.cueEnd ?? Infinity)) { speech.stop(); restoreVolume(); skipped++; }
    if (cue && (complete || cue.id !== lastSpoken)) {
      if (text && !speech.current && (!complete || wall >= speechRetryAt)) {
        speakCue(cue, text);
        if (speech.current) speech.current.options.cueEnd = cue.end + 1;
      }
    }
    if (!loading && (((!scheduler.cues.length && (!isLive || !sourceName)) || sourceName.startsWith('当前屏幕')) && wall >= retryAt || isLive && wall - lastCaptionRefresh > 30000)) {
      lastCaptionRefresh = wall; loadCaptions().catch(e => report(e.message));
    }
    render();
  }
  function bindVideo(next) {
    if (video === next) return;
    speech.stop(); restoreVolume(true); videoListeners?.abort(); video = next; mediaWaiting = false;
    narration.reset(video?.currentTime || 0);
    if (!video) return;
    videoListeners = new AbortController(); const o = {signal: videoListeners.signal};
    video.addEventListener('timeupdate', tick, o);
    video.addEventListener('pause', () => { if (!video.ended) { if (settings.syncMode === 'complete') speech.pause(); else { speech.stop(); lastSpoken = ''; } } restoreVolume(); render(); }, o);
    video.addEventListener('play', tick, o);
    video.addEventListener('waiting', () => { mediaWaiting = true; speech.pause(); restoreVolume(); }, o);
    video.addEventListener('playing', () => { mediaWaiting = false; tick(); }, o);
    video.addEventListener('seeking', () => {
      scheduler.invalidate(); fallbackText = ''; lastSpoken = ''; speechRetryAt = 0; restoreVolume();
      if (sourceName.startsWith('当前屏幕')) scheduler.cues = [];
    }, o);
    video.addEventListener('seeked', () => { narration.reset(video.currentTime); speechRetryAt = 0; tick(); }, o);
    video.addEventListener('ratechange', () => { updateSpeechRate(); restoreVolume(); tick(); }, o);
    video.addEventListener('ended', () => { mediaWaiting = false; if (settings.syncMode !== 'complete') speech.stop(); restoreVolume(); tick(); }, o);
    if (active) duckVolume();
  }
  async function start() {
    if (!currentId || !video) { report('请先打开一个 YouTube 视频'); return; }
    if (active) return;
    pendingStartId = ''; voiceNeedsGesture = false;
    active = true; sessionToken++; errorText = ''; lastSpoken = ''; scheduler.enabled = true;
    narration.reset(video.currentTime); speechRetryAt = 0;
    duckVolume();
    scheduler.settings = settings; speechErrors = 0; skipped = 0;
    cacheOwner = currentId;
    const token = sessionToken;
    sendPage('ENABLE'); render();
    // Touch voice enumeration on the actual player button click (a real user gesture).
    speech.voices();
    let cached = {};
    try {
      await rpc({type: 'CLAIM_AUDIO'}, 5000);
      cached = await rpc({type: 'CACHE_GET', videoId: currentId}, 5000);
      if (!lastCaptureUrl && !tracks.length) {
        const captured = await rpc({type: 'CAPTION_URL', videoId: currentId}, 5000);
        if (captured?.url) lastCaptureUrl = captured.url;
      }
    } catch (e) { report(e.message); }
    if (!active || token !== sessionToken) return;
    cacheRows = cached;
    for (const cue of scheduler.cues) {
      const cached = cacheRows[C.cacheKey(cue, sourceLang, settings)];
      if (cached?.source === cue.text) { cue.alignment=C.validatedAlignment(cached.alignment,cue.text,cached.text); scheduler.put(cue, cached.text); }
    }
    if (lastCapturedBody) capturedBody(lastCapturedBody.url, lastCapturedBody.body);
    loadCaptions().catch(e => report(e.message)); tick();
  }
  function stop() {
    pendingStartId = ''; voiceNeedsGesture = false;
    active = false; sessionToken++; loadSerial++; loading = false;
    scheduler.stop(); speech.stop(); restoreVolume(); flushCache(); sendPage('DISABLE');
    for (const job of pendingPage.values()) { clearTimeout(job.timer); job.reject(new Error('字幕读取已取消')); }
    pendingPage.clear(); lastSpoken = ''; render();
  }
  function resetVideo(id) {
    const wasActive = active; stop();
    currentId = id; tracks = []; trackKey = ''; sourceLang = 'auto'; sourceName = ''; sourceAutomatic = false; isLive = false;
    lastCapturedBody = null; lastCaptureUrl = ''; cacheRows = {}; dirtyCache = {}; cacheOwner = '';
    fallbackText = ''; errorText = ''; captionFailures = 0; retryAt = 0; scheduler.setCues([], 'auto');
    renderTracks(); sendPage('INSPECT');
    if (id && (settings.autoStart || wasActive)) { pendingStartId = id; pendingStartAt = Date.now() + 300; }
  }
  function tryAutoStart() {
    if (active || !video || !pendingStartId || Date.now() < pendingStartAt || pendingStartId !== currentId || pendingStartId !== C.videoId(location.href)) return;
    start().catch(e => report(e.message));
  }
  function status() {
    return {
      active, videoId: currentId, source: sourceName, language: sourceLang, automatic: sourceAutomatic, cues: scheduler.cues.length,
      time: video?.currentTime || 0, readySeconds: scheduler.readySeconds(video?.currentTime || 0),
      translating: scheduler.active.size, cached: scheduler.cache.size, voice: speech.lastVoice,
      error: errorUntil > Date.now() ? errorText : '', metrics: {...scheduler.metrics, speechErrors, skipped},
      mode: settings.syncMode, settings, voices: speech.voices().map(v => ({name: v.name, lang: v.lang, local: v.localService})),
      queued: narration.pending.length, narrationTime: narration.head?.start ?? null,
      playbackRate: video?.playbackRate || 1, effectiveRate: speech.current?.options.rate ?? C.speechRate(settings, video?.playbackRate || 1), voiceNeedsGesture
    };
  }
  function exportSubtitles() {
    const rows = scheduler.cues.filter(c => scheduler.get(c));
    const stamp = t => {
      const ms = Math.round(t * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
    };
    const body = rows.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${scheduler.get(c)}${settings.bilingual ? '\n' + c.text : ''}\n`).join('\n');
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob(['\uFEFF' + body], {type: 'text/plain;charset=utf-8'}));
    a.href = url; a.download = `YouTube-${currentId}-已准备中文字幕.srt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    report(`已导出 ${rows.length} 条已准备字幕（按进度翻译，不包含未处理部分）`);
  }
  async function applySettings(next) {
    const old = settings; settings = C.sanitizeSettings(next); scheduler.settings = settings;
    if (active) duckVolume();
    if (active && (old.cacheRevision !== settings.cacheRevision || old.autoTranslate !== settings.autoTranslate)) {
      scheduler.setCues([], sourceLang); scheduler.enabled = true; loadCaptions(true).catch(e => report(e.message));
    }
    if (old.syncMode !== settings.syncMode || old.voice !== settings.voice) {
      speech.stop(); lastSpoken = ''; speechRetryAt = 0;
      if (old.syncMode !== settings.syncMode) narration.reset(video?.currentTime || 0);
    }
    else if (old.rate !== settings.rate) updateSpeechRate();
    view?.sync(settings); render();
    if (!old.autoStart && settings.autoStart && !active) { pendingStartId = currentId || C.videoId(location.href); pendingStartAt = Date.now(); }
    else if (old.autoStart && !settings.autoStart) pendingStartId = '';
    tryAutoStart();
  }
  chrome.runtime.onMessage.addListener((m, sender, respond) => {
    if (m.type === 'STATUS') { respond(status()); return; }
    if (m.type === 'OPEN_PLAYER_SETTINGS') { mount(); view?.setOpen(true); respond({ok: !!view}); return; }
    if (m.type === 'STOP_OTHER_TAB') { stop(); report('已在另一个视频开启同传，本页朗读已停止'); respond({ok: true}); return; }
    if (m.type === 'TOGGLE') { if (active) stop(); else start(); respond({active}); return; }
    if (m.type === 'RETRY') {
      retryAt = 0; speechRetryAt = 0; voiceNeedsGesture = false; scheduler.failures.clear(); scheduler.cooldownUntil = 0; errorText = ''; speech.stop(); speech.failedVoices.clear(); lastSpoken = '';
      if (!scheduler.cues.length || sourceName.startsWith('当前屏幕')) loadCaptions(true).catch(e => report(e.message));
      tick(); respond({ok: true}); return;
    }
    if (m.type === 'EXPORT') { exportSubtitles(); respond({ok: true}); return; }
    if (m.type === 'CAPTION_CAPTURED' && m.videoId === currentId) {
      lastCaptureUrl = m.url;
      if (active && !scheduler.cues.length) loadCaptions().catch(e => report(e.message));
    }
    if (m.type === 'SETTINGS_CHANGED') applySettings(m.settings);
  });
  window.addEventListener('message', event => {
    const m = event.data;
    if (event.source !== window || event.origin !== location.origin || m?.channel !== CHANNEL || m.direction !== 'from-page') return;
    if (m.type === 'FETCH_RESULT') {
      const job = pendingPage.get(m.requestId); if (!job) return;
      clearTimeout(job.timer); pendingPage.delete(m.requestId);
      if (m.error) job.reject(new Error(String(m.error).slice(0, 300))); else job.resolve(String(m.body || ''));
    }
    if (m.videoId !== currentId) return;
    if (m.type === 'TRACKS' && Array.isArray(m.tracks)) {
      tracks = m.tracks.slice(0, 100).filter(t => {
        try { const u = new URL(t.baseUrl); return u.origin === location.origin && u.pathname === '/api/timedtext' && u.searchParams.get('v') === currentId; } catch { return false; }
      });
      isLive = !!m.live; renderTracks();
      if (active && !loading && !scheduler.cues.length) loadCaptions().catch(e => report(e.message));
    }
    if (m.type === 'CAPTURED') capturedBody(m.url, m.body);
  });
  function mount() {
    const player = document.querySelector('#movie_player');
    if (!player || !currentId) { view?.destroy(); view = null; return; }
    if (view?.host.isConnected && view.player === player) { view.attachButton(); return; }
    view?.destroy();
    view = new DubPlayerUI(player, {
      getVoices: () => speech.voices(),
      onToggle: () => active ? stop() : start(),
      onRetry: () => {
        retryAt = 0; speechRetryAt = 0; voiceNeedsGesture = false; scheduler.failures.clear(); scheduler.cooldownUntil = 0;
        speech.stop(); speech.failedVoices.clear(); lastSpoken = ''; errorText = '';
        if (!active) start(); else { if (!scheduler.cues.length || sourceName.startsWith('当前屏幕')) loadCaptions(true).catch(e => report(e.message)); tick(); }
      },
      onTrack: key => {
        trackKey = key; lastSpoken = ''; loadSerial++; loading = false;
        scheduler.setCues([], sourceLang); scheduler.enabled = active;
        if (active) loadCaptions(true).catch(e => report(e.message));
      },
      onChange: next => applySettings(next),
      onSave: async next => {
        const keys = C.playerSettingKeys;
        await rpc({type: 'SAVE_PLAYER_SETTINGS', settings: Object.fromEntries(keys.map(k => [k, next[k]]))});
      },
      onPreview: () => {
        speech.failedVoices.clear();
        speech.speak('你好，这是中文同传。开启后，视频原声会全程保持较低音量。', {voice: settings.voice, rate: C.speechRate({...settings, syncMode:'complete'}, video?.playbackRate || 1), volume: settings.volume});
      },
      onExport: exportSubtitles,
      onAdvanced: () => rpc({type:'OPEN_OPTIONS'}).catch(e => report(e.message)),
      onClearCache: () => rpc({type:'CLEAR_PLAYER_CACHE'}).then(() => report('已清除本地缓存；当前视频译文保留到刷新')).catch(e => report(e.message))
    });
    view.sync(settings); renderTracks(); render();
  }
  function renderTracks() { view?.tracks(tracks, trackKey); }
  function render(override = '') {
    if (!view) return;
    const pos = video?.currentTime || 0;
    const text = override || (!active ? '点击“开启”，用中文听视频' : loading ? '正在取得字幕，可先继续播放…' :
      !scheduler.cues.length ? '正在等字幕；可开启 YouTube 的 CC' :
      `${sourceName || '字幕'} · ${scheduler.cues.length} 段\n已准备约 ${Math.round(scheduler.readySeconds(pos))} 秒 · 正在翻译 ${scheduler.active.size} 段\n${speech.current ? '中文朗读中' : video?.paused ? '视频已暂停' : '等待下一句'} · 原声全程限音量`);
    const complete = active && settings.syncMode === 'complete', head = complete ? narration.head : null;
    const cue = active && C.subtitleCue(scheduler.cues, pos, settings, speech.current?.options.cue, head);
    const translated = cue && scheduler.get(cue);
    const captionProgress = !cue ? 0 : settings.subtitleTiming === 'speech' ? (speech.current?.options.cue?.id === cue.id ? speech.progress() : 0) : C.clamp((pos + settings.subtitleOffset - cue.start) / Math.max(.01, cue.end - cue.start), 0, 1) * (translated?.length || 0);
    const queueStatus = complete ? `视频照常播放 · 待读 ${narration.pending.length} 句${head ? ` · 落后约 ${Math.max(0, Math.round(pos - head.start))} 秒` : ''}${head && !scheduler.get(head) ? ' · 等待本句翻译' : ''}` : '';
    view.render({active, status: text, queueStatus, playbackRate: video?.playbackRate || 1, effectiveRate: speech.current?.options.rate ?? C.speechRate(settings, video?.playbackRate || 1), error: voiceNeedsGesture ? '浏览器需要一次页面点击才能朗读，点击视频后将继续。' : errorUntil > Date.now() ? errorText : '', translated, source: cue?.text, captionProgress, alignment:cue?.alignment, paginate: cue?.automatic === true});
  }
  function discover() {
    const id = C.videoId(location.href);
    bindVideo(document.querySelector('#movie_player video.html5-main-video') || document.querySelector('video.html5-main-video'));
    if (id !== currentId) resetVideo(id);
    mount();
    tryAutoStart();
    if (!tracks.length && active) sendPage('INSPECT');
    tick();
  }
  window.addEventListener('pagehide', () => stop());
  document.addEventListener('yt-navigate-finish', discover);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) discover(); });
  function resumeAfterGesture(event) {
    if (!event.isTrusted || !active || !voiceNeedsGesture) return;
    voiceNeedsGesture = false; speechRetryAt = 0; lastSpoken = ''; errorText = ''; tick();
  }
  document.addEventListener('pointerdown', resumeAfterGesture, {capture:true});
  document.addEventListener('keydown', resumeAfterGesture, {capture:true});
  rpc({type: 'GET_SETTINGS'}).then(async s => { await applySettings(s); discover(); }).catch(e => report(e.message));
  // Event-driven updates handle playback; this watchdog recovers missed SPA/player events.
  setInterval(discover, 1000); setInterval(() => { if (active) tick(); }, 250);
})();
