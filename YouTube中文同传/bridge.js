/* MAIN world: only player metadata and subtitle text cross the page boundary. */
(() => {
  'use strict';
  if (window.__progressDubBridge) return;
  window.__progressDubBridge = true;
  const CHANNEL = 'progress-dub-v1';
  const nativeFetch = window.fetch;
  const controllers = new Map();
  let latest = null, lastBody = null, enabled = false, changedCaptions = false;
  let previousCaption = null, captionOwner = '';
  function id() { return new URL(location.href).searchParams.get('v') || location.pathname.split('/')[2] || ''; }
  function captionUrl(raw) {
    try { const u = new URL(raw, location.href); return u.origin === location.origin && u.pathname === '/api/timedtext' ? u : null; } catch { return null; }
  }
  function send(type, data = {}) { window.postMessage({channel: CHANNEL, direction: 'from-page', type, ...data}, location.origin); }
  function metadata(player) {
    if (!player || player.videoDetails?.videoId !== id()) return;
    latest = player;
    const renderer = player.captions?.playerCaptionsTracklistRenderer;
    send('TRACKS', {videoId: id(), live: !!player.videoDetails?.isLiveContent, tracks: (renderer?.captionTracks || []).map(t => ({
      baseUrl: t.baseUrl, languageCode: t.languageCode, vssId: t.vssId, kind: t.kind || '',
      isTranslatable: !!t.isTranslatable, name: t.name?.simpleText || t.name?.runs?.map(r => r.text).join('') || t.languageCode
    }))});
  }
  function inspect() {
    try { metadata(document.querySelector('#movie_player')?.getPlayerResponse?.()); } catch {}
    metadata(window.ytInitialPlayerResponse);
    if (latest?.videoDetails?.videoId === id()) metadata(latest);
  }
  function capture(url, text) {
    const u = captionUrl(url);
    if (!u || !text || text.length > 12_000_000) return;
    const vid = u.searchParams.get('v');
    if (vid !== id()) return;
    lastBody = {url: u.href, body: text, videoId: vid};
    if (enabled) send('CAPTURED', lastBody);
  }
  window.fetch = async function (...args) {
    const response = await Reflect.apply(nativeFetch, this, args);
    const raw = typeof args[0] === 'string' ? args[0] : args[0]?.url || String(args[0]);
    if (captionUrl(raw)) response.clone().text().then(t => capture(raw, t)).catch(() => {});
    else if (raw.includes('/youtubei/v1/player')) response.clone().json().then(metadata).catch(() => {});
    return response;
  };
  const originalOpen = XMLHttpRequest.prototype.open, originalSend = XMLHttpRequest.prototype.send;
  const xhrUrls = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    xhrUrls.set(this, String(url)); return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const raw = xhrUrls.get(this);
    if (captionUrl(raw)) this.addEventListener('load', () => {
      try {
        if (!this.responseType || this.responseType === 'text') capture(raw, this.responseText);
        else if (this.responseType === 'json') capture(raw, JSON.stringify(this.response));
      } catch {}
    }, {once: true});
    return originalSend.apply(this, args);
  };
  function enableCaptionCapture() {
    const player = document.querySelector('#movie_player');
    const button = document.querySelector('.ytp-subtitles-button');
    if (!player || !button || changedCaptions) return;
    previousCaption = button.getAttribute('aria-pressed');
    captionOwner = id();
    if (previousCaption === 'false') { button.click(); changedCaptions = true; }
  }
  function restoreCaptions() {
    const button = document.querySelector('.ytp-subtitles-button');
    if (changedCaptions && captionOwner === id() && previousCaption === 'false' && button?.getAttribute('aria-pressed') === 'true') button.click();
    changedCaptions = false; captionOwner = '';
  }
  window.addEventListener('message', async event => {
    const m = event.data;
    if (event.source !== window || event.origin !== location.origin || m?.channel !== CHANNEL || m.direction !== 'to-page') return;
    if (m.type === 'INSPECT') { inspect(); if (enabled && lastBody?.videoId === id()) send('CAPTURED', lastBody); }
    if (m.type === 'ENABLE') { enabled = true; inspect(); enableCaptionCapture(); if (lastBody?.videoId === id()) send('CAPTURED', lastBody); }
    if (m.type === 'DISABLE') { enabled = false; for (const c of controllers.values()) c.abort(); controllers.clear(); restoreCaptions(); }
    if (m.type === 'ABORT') controllers.get(m.requestId)?.abort();
    if (m.type !== 'FETCH_CAPTIONS') return;
    const url = captionUrl(m.url);
    if (!enabled || !url || url.searchParams.get('v') !== id() || typeof m.requestId !== 'string') return;
    const controller = new AbortController(); controllers.set(m.requestId, controller);
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const r = await nativeFetch.call(window, url.href, {credentials: 'include', signal: controller.signal});
      if (!r.ok) throw new Error(`字幕请求 HTTP ${r.status}`);
      const body = await r.text();
      if (!body.trim() || body.length > 12_000_000) throw new Error('字幕响应为空或过大');
      send('FETCH_RESULT', {requestId: m.requestId, body, url: url.href});
    } catch (error) { send('FETCH_RESULT', {requestId: m.requestId, error: error.message}); }
    finally { clearTimeout(timeout); controllers.delete(m.requestId); }
  });
  document.addEventListener('yt-navigate-finish', inspect);
})();
