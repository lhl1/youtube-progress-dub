(function (root) {
  'use strict';
  class SpeechEngine {
    constructor({synthesis = root.speechSynthesis, Utterance = root.SpeechSynthesisUtterance, onState = () => {}, onError = () => {}} = {}) {
      Object.assign(this, {synthesis, Utterance, onState, onError});
      this.token = 0; this.current = null; this.timer = null; this.resumeTimer = null; this.lastVoice = ''; this.failedVoices = new Map();
    }
    voices() { return (this.synthesis?.getVoices() || []).filter(v => /^zh|^cmn/i.test(v.lang)).sort((a, b) => this.score(b) - this.score(a)); }
    score(v) { return (/Online|Natural|Neural/i.test(v.name) ? 100 : 0) + (/Xiaoxiao|晓晓/i.test(v.name) ? 30 : 0) + (/zh-CN/i.test(v.lang) ? 20 : 0); }
    voice(name, offline = false) {
      // Some Edge versions mark natural/cloud voices as localService. Their
      // names remain a better hint when choosing a truly offline fallback.
      const voices = this.voices(), healthy = voices.filter(v => (this.failedVoices.get(v.name) || 0) < Date.now());
      const available = offline ? healthy.filter(v => v.localService && !/Online|Natural|Neural/i.test(v.name)) : healthy;
      return available.find(v => v.name === name) || available[0] || (offline ? undefined : voices[0]);
    }
    stop(reason = 'cancel') {
      this.token++; clearTimeout(this.timer); clearTimeout(this.resumeTimer); this.timer = this.resumeTimer = null;
      const previous = this.current; this.current = null;
      if (previous) { if(previous.utterance)this.synthesis?.cancel(); previous.finish?.(reason); }
      this.onState(null);
    }
    speak(text, options = {}) {
      this.stop();
      const parts=options.silent?[{from:0,to:text.length,pause:250}]:DubCore.narrationParts(text);
      const audible=parts.some(p=>p.text);
      if (audible && (!this.synthesis || !this.Utterance)) { this.onError(new Error('浏览器不支持语音朗读')); return; }
      const token = this.token;
      const voice = this.voice(options.voice, options.offline);
      if (audible && !voice) { this.onError(new Error('未发现中文声音，请使用 Edge 并在系统中安装中文语音')); return; }
      const offsets=parts.map(part=>part.from+(options.captionOffset||0));
      let index = 0, started = false, retried = false, generation = 0, interrupted = false;
      const current = {text, captionText: options.captionText || text, options, voice: voice?.name || '', paused: false, startedAt: Date.now(), charIndex: offsets[0] || 0, finish: options.onDone};
      this.current = current; if(voice)this.lastVoice = voice.name;
      const finish = reason => { if (token !== this.token) return; this.token++; clearTimeout(this.timer); clearTimeout(this.resumeTimer); this.timer = this.resumeTimer = null; this.current = null; this.onState(null); options.onDone?.(reason); };
      const next = () => {
        if (token !== this.token) return;
        if (index >= parts.length) { finish('end'); return; }
        if (current.paused) return;
        clearTimeout(this.resumeTimer); this.resumeTimer = null;
        const partGeneration = ++generation;
        const valid = () => token === this.token && partGeneration === generation;
        current.partStart = current.charIndex = offsets[index];
        current.partEnd = parts[index].to+(options.captionOffset||0);
        current.hasBoundary = false; current.progressStarted = false; current.pausedAt = null;
        const advance=()=>{
          if(!valid())return;
          generation++;clearTimeout(this.timer);clearTimeout(this.resumeTimer);this.timer=this.resumeTimer=null;
          current.charIndex=current.partEnd;current.progressStarted=false;current.utterance=null;current.resume=next;current.recoverResume=false;
          index++;retried=false;interrupted=false;next();
        };
        if(parts[index].pause){
          current.utterance=null;current.recoverResume=false;
          current.timerRemaining=DubCore.clamp(parts[index].pause/(options.rate||1),80,400);
          current.resume=()=>{
            if(!valid()||current.paused)return;
            current.timerStartedAt=Date.now();clearTimeout(this.timer);
            this.timer=setTimeout(advance,current.timerRemaining);
          };
          this.onState(current);current.resume();return;
        }
        const utterance = new this.Utterance(parts[index].text);
        current.utterance = utterance; utterance.voice = voice; utterance.lang = voice.lang || 'zh-CN';
        utterance.rate = DubCore.clamp(options.rate || 1, 0.1, 10); utterance.volume = options.volume ?? 1;
        started = false;
        const startTimer = () => {
          clearTimeout(this.timer);
          if (current.paused || !valid()) return;
          const deadline = Math.max(8000, parts[index].text.length / (3.5 * utterance.rate) * 1000 + 6000);
          current.timerStartedAt = Date.now();
          current.timerRemaining ??= started ? deadline : 7000;
          this.timer = setTimeout(() => {
            if (!valid() || current.paused) return;
            // A resumed cloud utterance can retain speaking=true but lose its
            // callbacks. Recover just its unfinished part once, never the cue.
            if (current.recoverResume) { current.recoverResume = false; restart(); return; }
            this.failedVoices.set(voice.name, Date.now() + 90000);
            const fallback = this.voice('', true);
            if (!retried && fallback && fallback.name !== voice.name && !started) {
              const retained = {...options, voice: fallback.name, offline: true, captionText: current.captionText, captionOffset: offsets[index]};
              this.onError(new Error('在线声音未响应，已尝试本地中文声音'));
              const remaining = text.slice(offsets[index] - (options.captionOffset || 0)); this.speak(remaining, retained); return;
            }
            this.onError(new Error(started ? '语音超时，已恢复后续朗读' : '语音未启动，请点击视频中的“开始同传”或换一个声音'));
            finish('timeout'); this.synthesis.cancel();
          }, current.timerRemaining);
        };
        const restart = () => {
          if (!valid()) return;
          generation++; current.utterance = null; current.timerRemaining = null;
          clearTimeout(this.timer); clearTimeout(this.resumeTimer);
          this.synthesis.cancel(); next();
        };
        current.timerRemaining = null; current.recoverResume = false;
        current.resume = () => {
          if (!valid()) return;
          current.recoverResume = true;
          this.synthesis.resume(); startTimer();
          // Wait for resume to settle before detecting a discarded utterance.
          this.resumeTimer = setTimeout(() => {
            if (valid() && !current.paused && this.synthesis.speaking === false && this.synthesis.pending === false) {
              current.recoverResume = false; restart();
            }
          }, 250);
        };
        utterance.onstart = () => {
          if (!valid()) return;
          started = true; current.timerRemaining = null; this.failedVoices.delete(voice.name); current.startedAt = Date.now(); this.onState(current);
          current.progressStarted = true; if(current.paused)current.pausedAt = Date.now();
          if (current.paused) this.synthesis.pause(); else options.onStart?.();
          startTimer();
        };
        utterance.onboundary = e => {
          if (!valid() || current.paused || !started || !Number.isFinite(e.charIndex)) return;
          // Native events are relative to this utterance, never to the full cue.
          // A voice that reports only an initial sentence boundary at zero
          // still needs the visual-clock fallback until real progress arrives.
          current.hasBoundary ||= e.charIndex > 0;
          current.charIndex = Math.max(current.charIndex, current.partStart + DubCore.clamp(e.charIndex, 0, parts[index].text.length - 1));
          this.onState(current);
        };
        utterance.onend = advance;
        utterance.onerror = e => {
          if (!valid()) return;
          if (['canceled', 'interrupted'].includes(e.error)) {
            // Our own cancellation already invalidates the event. An external
            // interruption must not leave an occupied, silent narration queue.
            if (!interrupted || current.paused) {
              interrupted = true; generation++; current.utterance = null; current.resume = next;
              clearTimeout(this.timer); clearTimeout(this.resumeTimer); next(); return;
            }
            this.onError(new Error('朗读被浏览器中断，请点击“恢复 / 重试”')); finish('error'); return;
          }
          if (e.error === 'not-allowed') {
            const error = new Error('浏览器需要一次页面点击才能朗读，点击视频后将继续。'); error.code = 'not-allowed';
            this.onError(error); finish('blocked'); return;
          }
          this.failedVoices.set(voice.name, Date.now() + 90000);
          if (!retried && !options.offline) {
            const fallback = this.voice('', true);
            if (fallback && fallback.name !== voice.name) {
              retried = true; this.onError(new Error('在线语音失败，切换本地中文声音'));
              this.speak(text.slice(offsets[index] - (options.captionOffset || 0)), {...options, voice: fallback.name, offline: true, captionText: current.captionText, captionOffset: offsets[index]}); return;
            }
          }
          this.onError(new Error(`语音失败：${e.error || 'unknown'}`)); finish('error');
        };
        this.onState(current); startTimer();
        if (this.synthesis.paused) this.synthesis.resume();
        this.synthesis.speak(utterance);
      };
      next();
    }
    progress() {
      const c = this.current;
      if (!c) return 0;
      if (c.hasBoundary || !c.progressStarted || !c.utterance) return c.charIndex;
      // Some Edge voices provide no word events. Estimate visual position only;
      // this never advances the narration queue or truncates an utterance.
      const now = c.paused ? (c.pausedAt ?? c.startedAt) : Date.now();
      const elapsed = Math.max(0, now - c.startedAt) / 1000;
      return Math.min(c.partEnd - 1, c.partStart + Math.floor(elapsed * 4.5 * c.utterance.rate));
    }
    setRate(rate) {
      if (!this.current) return;
      // Changing an utterance after enqueueing has no reliable audible effect.
      // Keep the current short part intact; next() reads the updated options.
      this.current.options.rate = DubCore.clamp(Number(rate) || 1, 0.1, 10);
      this.onState(this.current);
    }
    pause() {
      if (this.current && !this.current.paused) {
        const current = this.current; current.paused = true; current.pausedAt = Date.now();
        if (this.timer) current.timerRemaining = Math.max(1, current.timerRemaining - (Date.now() - current.timerStartedAt));
        clearTimeout(this.timer); clearTimeout(this.resumeTimer); this.timer = this.resumeTimer = null;
        if(current.utterance)this.synthesis?.pause(); this.onState(current);
      }
    }
    resume() {
      if (!this.current?.paused) return;
      const current = this.current; current.paused = false;
      if(current.pausedAt != null)current.startedAt += Date.now() - current.pausedAt;
      current.pausedAt = null;
      current.resume?.();
      if (this.current === current) this.onState(current);
    }
  }
  root.DubSpeech = SpeechEngine;
  if (typeof module !== 'undefined') module.exports = SpeechEngine;
})(globalThis);
