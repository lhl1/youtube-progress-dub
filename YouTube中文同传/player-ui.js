(function (root) {
  'use strict';
  const icon = `<svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M8 8.5h20v16H17l-5 4v-4H8z"/><path d="m11.5 20 3-8 3 8m-5-2.5h4M20 13h6m-3-2v2m-2 2c.5 2.6 2.3 4.5 5 5m-1-5c-.5 2.6-2.3 4.5-5 5"/></g></svg>`;
  const ranges = {
    rate: ['基础朗读语速', 0.6, 2.5, 0.01], volume: ['中文音量', 0, 1, 0.05],
    originalVolume: ['原视频音量上限 · 全程', 0, 1, 0.01], lookahead: ['字幕预读', 30, 240, 10]
  };
  const labels = {autoTranslate: '优先使用 YouTube 中文翻译'};
  const css = `
    :host{font-family:Roboto,Arial,"Microsoft YaHei",sans-serif;color:#fff;font-size:13px;color-scheme:dark}
    *{box-sizing:border-box}button,input,select{font:inherit}button,input,select,summary{touch-action:manipulation}button{cursor:pointer}
    button{border:0;background:transparent;color:inherit;border-radius:4px;padding:8px 10px}button:hover{background:#ffffff1a}
    button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid #fff;outline-offset:2px}
    .panel{position:absolute;z-index:2;bottom:70px;right:12px;width:360px;max-width:calc(100% - 24px);max-height:min(520px,calc(100% - 96px));overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;background:#1c1c1cf5;box-shadow:0 6px 24px #0009;border-radius:12px;pointer-events:auto;line-height:1.45}
    .panel[popover]{position:fixed;inset:auto;margin:0;padding:0;border:0;max-width:none;color:inherit}.panel::backdrop{background:transparent;pointer-events:none}
    .panel[hidden],.sub[hidden]{display:none}.header{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #ffffff24;position:sticky;top:0;background:#1c1c1c;z-index:1}
    .title{font-size:15px;font-weight:600;flex:1}.close{padding:5px;width:30px;height:30px;font-size:23px;line-height:20px}
    .toggle{font-size:12px;font-weight:600;background:#fff;color:#0f0f0f;padding:6px 13px;border-radius:18px;min-width:65px}.toggle:hover{background:#e5e5e5}.toggle.active{background:#f03;color:#fff}.toggle.active:hover{background:#e0002e}
    .body{padding:2px 16px 10px}.select-row{padding:8px 0;display:grid;grid-template-columns:76px minmax(0,1fr);align-items:center;gap:10px}
    select{width:100%;min-width:0;color:#fff;background:#303030;border:1px solid #5b5b5b;border-radius:5px;padding:6px 8px;font-size:12px}
    .range{display:block;padding:6px 0}.range .caption{display:flex;justify-content:space-between;gap:8px;margin-bottom:4px}.value{font-variant-numeric:tabular-nums;color:#d9d9d9}
    input[type=range]{width:100%;height:18px;margin:0;accent-color:#f03;cursor:pointer}input[type=checkbox]{appearance:none;position:relative;width:32px;height:18px;border-radius:10px;background:#666;flex:none;cursor:pointer;margin:0}
    input[type=checkbox]:before{content:"";position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#fff}input[type=checkbox]:checked{background:#f03}input[type=checkbox]:checked:before{left:16px}
    .check{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;cursor:pointer}.check span{min-width:0}
    details{border-top:1px solid #ffffff24;margin-top:8px;padding-top:4px}summary{cursor:pointer;padding:9px 0;list-style:none;font-weight:500}summary:after{content:"⌄";float:right;font-size:17px}details[open]>summary:after{content:"⌃"}
    .hint{color:#aaa;font-size:11px;line-height:1.55;margin:5px 0 9px;overflow-wrap:anywhere}.status{font-size:11px;color:#bbb;line-height:1.6;white-space:pre-wrap;margin:9px 0 0}.error{color:#ffc9bc;overflow-wrap:anywhere;font-size:12px;line-height:1.5;margin-top:6px}
    .actions{display:flex;gap:5px;flex-wrap:wrap;margin:7px -6px 0}.actions button{font-size:12px;padding:7px 9px;background:#ffffff0a}.saved{font-size:11px;color:#aaa;min-height:16px;margin-top:8px}
    .sub{position:absolute;z-index:1;pointer-events:none}
    .page-info{position:absolute;right:0;bottom:calc(100% + 3px);font:11px Arial,sans-serif;color:#ddd;background:#0008;border-radius:3px;padding:2px 5px}.page-info[hidden]{display:none}
    @media(max-height:380px){.panel{bottom:52px;max-height:calc(100% - 62px)}}
    ${DubSubtitles.css}
  `;
  class PlayerUI {
    constructor(player, handlers) {
      this.player = player; this.handlers = handlers; this.open = false; this.settings = {...DubCore.defaults}; this.lastVoiceSignature = '';
      this.abort = new AbortController(); this.saveTimer = null; this.saveRevision = 0; this.pendingPatch = {};
      this.host = document.createElement('div'); this.host.id = 'progress-dub';
      this.host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:63;';
      this.shadow = this.host.attachShadow({mode: 'closed'});
      this.shadow.innerHTML = `<style>${css}</style>
        <section id="dub-settings" class="panel" role="dialog" aria-label="中文同传设置" hidden>
          <header class="header"><span class="title">中文同传</span><button type="button" class="toggle">开启</button><button type="button" class="close" aria-label="关闭中文同传设置">×</button></header>
          <div class="body">
            <label class="select-row"><span>字幕来源</span><select class="tracks" name="track" aria-label="字幕来源"><option value="">自动选择字幕</option></select></label>
            <label class="check auto-start"><span>打开视频自动开启同传</span><input type="checkbox" name="autoStart" aria-label="打开视频自动开启同传"></label>
            <label class="select-row"><span>中文声音</span><select name="voice" aria-label="中文声音"><option value="">自动 · 优先自然声音</option></select></label>
            <label class="select-row"><span>同步方式</span><select name="syncMode" aria-label="同步方式"><option value="follow">跟随视频 · 自动语速</option><option value="complete">完整朗读 · 不暂停视频</option></select></label>
            <p class="narration-info hint" role="status" hidden></p>
            ${this.range('rate')}
            <p class="rate-info hint" role="status"></p>
            ${['volume', 'originalVolume'].map(k => this.range(k)).join('')}
            <p class="hint">开启后原声全程保持音量上限，句子之间也不恢复大音量；停止同传后恢复。</p>
            <div class="actions"><button type="button" class="preview">试听声音</button><button type="button" class="retry">恢复 / 重试</button></div>
            <details class="caption-settings"><summary>字幕设置</summary>
              <label class="check"><span>显示中文字幕</span><input type="checkbox" name="subtitle" aria-label="显示中文字幕"></label>
              <label class="check"><span>同时显示原文</span><input type="checkbox" name="bilingual" aria-label="同时显示原文"></label>
              ${DubSubtitles.controlsMarkup()}
            </details>
            <details><summary>字幕与播放</summary>
              ${this.range('lookahead')}${Object.entries(labels).map(([k, label]) => `<label class="check"><span>${label}</span><input type="checkbox" name="${k}" aria-label="${label}"></label>`).join('')}
              <div class="actions"><button type="button" class="export">导出已准备字幕</button></div>
            </details>
            <details><summary>翻译服务与缓存</summary>
              <label class="select-row"><span>翻译服务</span><select name="provider" aria-label="翻译服务"><option value="google-free">Google 翻译 · 无需密钥</option><option value="custom">已配置的自定义服务</option></select></label>
              <p class="provider-hint hint"></p>
              <div class="actions"><button type="button" class="advanced">配置接口与密钥 ↗</button><button type="button" class="clear-cache">清除译文缓存</button><button type="button" class="reset">恢复推荐设置</button></div>
              <p class="hint">首次配置接口或授权服务域名时，才需要打开扩展设置页。</p>
            </details>
            <div class="status" role="status"></div><div class="error" aria-live="polite"></div><div class="saved" aria-live="polite"></div>
          </div>
        </section>
        <div class="sub caption-surface" hidden><span class="page-info" hidden></span><div class="chinese-line"><span class="chinese"></span></div><div class="source"><span></span></div></div>`;
      player.appendChild(this.host);
      this.panel = this.shadow.querySelector('.panel');
      // A top-layer popover escapes both player stacking contexts and clipping.
      // It remains non-modal so the native controls can receive the same click.
      if (typeof this.panel.showPopover === 'function') this.panel.setAttribute('popover', 'manual');
      this.nativeCaptionStyle = document.createElement('style');
      this.nativeCaptionStyle.textContent = '#movie_player[data-progress-dub-hide-captions="true"] .ytp-caption-window-container{visibility:hidden!important;opacity:0!important;pointer-events:none!important}';
      player.appendChild(this.nativeCaptionStyle);
      this.icon = document.createElement('button'); this.icon.id = 'progress-dub-button'; this.icon.type = 'button';
      this.icon.className = 'ytp-button'; this.icon.title = '中文同传'; this.icon.setAttribute('aria-label', '中文同传设置');
      this.icon.setAttribute('aria-haspopup', 'dialog'); this.icon.setAttribute('aria-expanded', 'false');
      this.icon.style.cssText = 'width:var(--ytp-control-width,48px);height:100%;padding:0;position:relative;display:inline-flex;align-items:center;justify-content:center;color:#fff;vertical-align:top;box-shadow:none;';
      this.icon.innerHTML = icon;
      this.attachButton();
      const o = {signal: this.abort.signal};
      this.icon.addEventListener('click', event => { event.stopPropagation(); this.setOpen(!this.open); }, o);
      this.icon.addEventListener('keydown', event => { if (['Enter',' ','Escape'].includes(event.key)) event.stopPropagation(); }, o);
      this.shadow.querySelector('.close').addEventListener('click', () => this.setOpen(false), o);
      this.shadow.querySelector('.toggle').addEventListener('click', () => handlers.onToggle(), o);
      this.shadow.querySelector('.retry').addEventListener('click', () => handlers.onRetry(), o);
      this.shadow.querySelector('.preview').addEventListener('click', () => handlers.onPreview(), o);
      this.shadow.querySelector('.export').addEventListener('click', () => handlers.onExport(), o);
      this.shadow.querySelector('.advanced').addEventListener('click', () => handlers.onAdvanced(), o);
      this.shadow.querySelector('.clear-cache').addEventListener('click', () => handlers.onClearCache(), o);
      this.shadow.querySelector('.reset').addEventListener('click', () => this.changeSettings(Object.fromEntries(DubCore.playerSettingKeys.filter(k=>k!=='provider').map(k => [k, DubCore.defaults[k]]))), o);
      DubSubtitles.bindButtons(this.shadow, patch=>this.changeSettings(patch), o);
      this.shadow.querySelector('.tracks').addEventListener('change', e => handlers.onTrack(e.target.value), o);
      for (const input of this.shadow.querySelectorAll('input,select:not(.tracks)')) {
        input.addEventListener(['range','color'].includes(input.type) ? 'input' : 'change', () => {
          const value = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
          if (input.name === 'provider' && value === 'custom' && !this.settings.endpoint) {
            input.value = this.settings.provider; this.message('请先在“配置接口与密钥”中授权翻译服务。'); return;
          }
          this.changeSettings({[input.name]: value});
        }, o);
      }
      // Keep player shortcuts from consuming settings interactions (space, arrows).
      this.shadow.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); this.setOpen(false); }
        event.stopPropagation();
      }, o);
      this.shadow.querySelector('.panel').addEventListener('click', e => e.stopPropagation(), o);
      const closeOutside = event => {
        if (this.open && !event.composedPath().includes(this.host) && !event.composedPath().includes(this.icon)) this.setOpen(false, false);
      };
      for (const type of ['pointerdown', 'click', 'focusin']) document.addEventListener(type, closeOutside, {...o, capture: true});
      this.panel.addEventListener('toggle', event => {
        if (event.newState === 'closed' && this.open && !this.panel.matches(':popover-open')) this.setOpen(false, false);
      }, o);
      document.addEventListener('fullscreenchange', () => this.setOpen(false, false), o);
      document.addEventListener('scroll', () => this.positionPanel(), {...o, capture: true, passive: true});
      root.addEventListener('resize', () => this.positionPanel(), o);
      for (const type of ['resize', 'scroll']) root.visualViewport?.addEventListener(type, () => this.positionPanel(), {...o, passive: true});
      document.addEventListener('keydown', event => {
        if (this.open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.setOpen(false); }
      }, {...o, capture: true});
      root.speechSynthesis?.addEventListener('voiceschanged', () => this.refreshVoices(), o);
      this.resizeObserver = new ResizeObserver(() => { this.applySubtitleStyle(); this.fitSubtitle(); this.positionPanel(); });
      this.resizeObserver.observe(player);
    }
    range(k) {
      const [label, min, max, step] = ranges[k];
      return `<label class="range"><span class="caption"><span>${label}</span><output class="value" data-value="${k}"></output></span><input type="range" name="${k}" min="${min}" max="${max}" step="${step}" aria-label="${label}" autocomplete="off"></label>`;
    }
    attachButton() {
      const controls = this.player.querySelector('.ytp-right-controls');
      if (!controls) return;
      for (const duplicate of controls.querySelectorAll('#progress-dub-button')) if (duplicate !== this.icon) duplicate.remove();
      // Modern YouTube nests CC/settings inside .ytp-right-controls-left. A
      // descendant cannot be used as insertBefore's reference on the outer bar.
      const settings = controls.querySelector('.ytp-settings-button');
      const captions = controls.querySelector('.ytp-subtitles-button');
      const parent = settings?.parentElement || captions?.parentElement || controls.querySelector('.ytp-right-controls-left') || controls;
      // Modern player CSS forces native SVGs to 24px. Crop our original 36px
      // canvas so its white symbol has the same visual size as its neighbours.
      const svg = this.icon.querySelector('svg');
      const viewBox = this.player.classList.contains('ytp-delhi-modern-icons') ? '6 6 24 24' : '0 0 36 36';
      if (svg.getAttribute('viewBox') !== viewBox) svg.setAttribute('viewBox', viewBox);
      let before = settings || (captions ? captions.nextSibling : parent.firstChild);
      if (before === this.icon) before = this.icon.nextSibling;
      if (this.icon.parentElement !== parent || this.icon.nextSibling !== before) parent.insertBefore(this.icon, before);
    }
    setOpen(open, focus = true) {
      this.open = open; this.panel.hidden = !open; this.icon.setAttribute('aria-expanded', String(open));
      this.host.style.zIndex = open ? '2147483647' : '63';
      if (this.panel.hasAttribute('popover')) {
        if (open) { this.positionPanel(); if (!this.panel.matches(':popover-open')) this.panel.showPopover(); }
        else if (this.panel.matches(':popover-open')) this.panel.hidePopover();
      }
      if (open) { this.refreshVoices(); if (focus) this.shadow.querySelector('.toggle').focus({preventScroll: true}); }
      else if (focus) this.icon.focus({preventScroll: true});
    }
    positionPanel() {
      if (!this.open || !this.panel.hasAttribute('popover')) return;
      const r = this.player.getBoundingClientRect(), viewport = root.visualViewport;
      const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
      const width = viewport?.width || root.innerWidth, height = viewport?.height || root.innerHeight;
      const panelWidth = Math.max(1, Math.min(360, r.width - 24, width - 24));
      const controls = this.player.querySelector('.ytp-chrome-bottom');
      const controlsHeight = controls?.getBoundingClientRect().height || 48;
      const bottom = Math.max(top + 48, Math.min(top + height - 12, r.bottom - Math.min(controlsHeight + 12, r.height / 3)));
      Object.assign(this.panel.style, {
        width: `${panelWidth}px`, left: `${Math.max(left + 12, Math.min(r.right - panelWidth - 12, left + width - panelWidth - 12))}px`,
        bottom: `${root.innerHeight - bottom}px`, maxHeight: `${Math.max(1, Math.min(520, bottom - Math.max(top + 12, r.top + 12)))}px`
      });
    }
    async changeSettings(patch) {
      Object.assign(this.pendingPatch, patch);
      this.settings = DubCore.sanitizeSettings({...this.settings, ...patch}); this.fill();
      this.handlers.onChange(this.settings); this.message('正在保存…'); clearTimeout(this.saveTimer);
      this.saveRevision++;
      this.saveTimer = setTimeout(() => this.persist(this.saveRevision), 250);
    }
    async persist(revision) {
      if (revision !== this.saveRevision) return;
      this.saveTimer = null; this.pendingPatch = {};
      try {
        await this.handlers.onSave(this.settings);
        if (revision === this.saveRevision) this.message('已保存 · 立即生效');
      } catch (e) { if (revision === this.saveRevision) this.message(`保存失败：${e.message}，请重试`); }
    }
    message(text) { this.text(this.shadow.querySelector('.saved'), text); }
    fill() {
      for (const input of this.shadow.querySelectorAll('input,select:not(.tracks)')) {
        const value = this.settings[input.name];
        if (input.type === 'checkbox') input.checked = value;
        else if (String(input.value) !== String(value)) input.value = value;
      }
      for (const k of Object.keys(ranges)) this.text(this.shadow.querySelector(`[data-value="${k}"]`), k === 'rate' ? `${this.settings[k].toFixed(2)}×` : k === 'lookahead' ? `${this.settings[k]} 秒` : `${Math.round(this.settings[k] * 100)}%`);
      this.text(this.shadow.querySelector('.provider-hint'), this.settings.provider === 'custom' ? this.settings.endpoint ? `已配置：${this.settings.model || '自定义模型'}` : '尚未配置自定义服务，请先点击“配置接口与密钥”。' : '无中文字幕时按进度翻译，无需填写密钥。');
      DubSubtitles.refreshControls(this.shadow, this.settings); this.applySubtitleStyle(); this.fitSubtitle();
    }
    sync(settings) { this.settings = {...settings, ...this.pendingPatch}; this.refreshVoices(); this.fill(); }
    refreshVoices() {
      const voices = this.handlers.getVoices(), signature = voices.map(v => v.name).join('|') + this.settings.voice;
      if (signature === this.lastVoiceSignature) return;
      this.lastVoiceSignature = signature;
      const select = this.shadow.querySelector('[name=voice]'); select.replaceChildren(new Option(voices.length ? '自动 · 优先自然声音' : '未发现中文声音 · 点击重新打开面板', ''));
      for (const voice of voices) select.append(new Option(voice.name.replace(/^Microsoft /, ''), voice.name));
      if (this.settings.voice && !voices.some(v => v.name === this.settings.voice)) select.append(new Option(this.settings.voice + ' · 暂不可用', this.settings.voice));
      select.value = this.settings.voice;
    }
    tracks(tracks, selected) {
      const select = this.shadow.querySelector('.tracks'), signature = tracks.map(t => `${t.vssId}:${t.name}`).join('|');
      if (select.dataset.signature !== signature) {
        select.dataset.signature = signature; select.replaceChildren(new Option('自动选择字幕', ''));
        for (const t of tracks) select.append(new Option(`${t.name}${t.kind === 'asr' ? ' · 自动生成' : ''}`, t.vssId));
      }
      select.value = selected;
    }
    render({active, status, error, translated, source, captionProgress = 0, paginate = true, queueStatus = '', playbackRate = 1, effectiveRate = DubCore.speechRate(this.settings, playbackRate)}) {
      this.active = active;
      const toggle = this.shadow.querySelector('.toggle'); toggle.classList.toggle('active', active); this.text(toggle, active ? '关闭' : '开启');
      this.text(this.shadow.querySelector('.rate-info'), `基础 ${this.settings.rate.toFixed(2)}× · 视频 ${playbackRate.toFixed(2)}× · 朗读 ${effectiveRate.toFixed(2)}×；调速从下一段短句生效。`);
      const queueInfo = this.shadow.querySelector('.narration-info'); queueInfo.hidden = !queueStatus; this.text(queueInfo, queueStatus);
      this.text(this.shadow.querySelector('.status'), status); this.text(this.shadow.querySelector('.error'), error);
      const sub = this.shadow.querySelector('.sub'); sub.hidden = !this.settings.subtitle || !translated || !active;
      this.captionVisible = !sub.hidden;
      this.applySubtitleStyle();
      const width = this.player.clientWidth * this.settings.subtitleWidth / 100;
      const limit = Math.max(18,Math.min(80,Math.floor(width / Math.max(10,this.subtitleBaseSize) * 1.65)));
      const signature = `${paginate}:${limit}:${translated}:${source}:${this.settings.subtitleSourceSize}`;
      if (signature !== this.pageSignature) {
        this.pageSignature = signature;
        this.chinesePages = DubCore.subtitlePages(translated,paginate ? limit : Math.max(12,translated?.length || 0));
        this.sourcePages = DubCore.subtitlePages(source,paginate ? Math.max(60,Math.min(240,Math.floor(limit * 1.7 / this.settings.subtitleSourceSize))) : Math.max(12,source?.length || 0));
      }
      const pageAt = (pages, offset) => pages.findIndex(p=>offset < p.to);
      const chineseIndex = Math.max(0,pageAt(this.chinesePages,Math.min(captionProgress,Math.max(0,(translated?.length || 0)-1))));
      const fraction = (translated?.length || 0) ? captionProgress / translated.length : 0;
      const sourceIndex = Math.max(0,pageAt(this.sourcePages,Math.min(Math.floor(fraction*(source?.length || 0)),Math.max(0,(source?.length || 0)-1))));
      this.text(sub.querySelector('.chinese'), this.chinesePages[chineseIndex]?.text.trim() || '');
      sub.dataset.page = `${chineseIndex+1}/${this.chinesePages.length}`;
      const pageInfo=sub.querySelector('.page-info');
      pageInfo.hidden=this.chinesePages.length<2;
      this.text(pageInfo,`续 ${chineseIndex+1}/${this.chinesePages.length}`);
      const original = sub.querySelector('.source'); original.hidden = !this.settings.bilingual || !source || source === translated;
      this.text(original.querySelector('span'), this.sourcePages[sourceIndex]?.text.trim() || '');
      this.applySubtitleStyle(); this.fitSubtitle();
    }
    applySubtitleStyle() {
      const hide = this.active && this.captionVisible && this.settings.subtitle && this.settings.hideNativeCaptions;
      if (hide) { if(this.player.getAttribute('data-progress-dub-hide-captions')!=='true')this.player.setAttribute('data-progress-dub-hide-captions','true'); }
      else this.player.removeAttribute('data-progress-dub-hide-captions');
      const width=this.player.clientWidth, height=this.player.clientHeight;
      const signature=JSON.stringify(DubCore.subtitleSettingKeys.map(k=>this.settings[k]))+`:${width}:${height}`;
      if(signature===this.subtitleStyleSignature)return;
      this.subtitleStyleSignature=signature; this.subtitleFitSignature='';
      const sub=this.shadow.querySelector('.sub'), s=this.settings;
      const baseSize=Math.max(10,Math.min(32,width*.0235,height*.08));
      this.subtitleBaseSize=baseSize*s.subtitleSize;
      DubSubtitles.apply(sub,s,baseSize);
      const side=(100-s.subtitleWidth)/2;sub.style.left=`${side}%`;sub.style.right=`${side}%`;
      const controlsHeight=this.player.querySelector('.ytp-chrome-bottom')?.getBoundingClientRect().height||48;
      this.subtitleInset=s.subtitlePosition==='bottom'?Math.max(height*s.subtitleMargin/100,Math.min(controlsHeight+12,height/3)):Math.max(4,height*s.subtitleMargin/100);
      sub.style.top=s.subtitlePosition==='top'?`${this.subtitleInset}px`:'auto';
      sub.style.bottom=s.subtitlePosition==='bottom'?`${this.subtitleInset}px`:'auto';
    }
    fitSubtitle() {
      const sub=this.shadow.querySelector('.sub');if(sub.hidden)return;
      const signature=this.subtitleStyleSignature+sub.textContent+String(sub.querySelector('.source').hidden);
      if(signature===this.subtitleFitSignature)return;this.subtitleFitSignature=signature;
      sub.style.fontSize=`${this.subtitleBaseSize}px`;
      const available=Math.max(40,this.player.clientHeight-this.subtitleInset-(this.settings.subtitlePosition==='top'?60:12));
      const height=sub.getBoundingClientRect().height;
      if(height>available)sub.style.fontSize=`${Math.max(10,this.subtitleBaseSize*available/height)}px`;
    }
    text(el, text) { if (el.textContent !== text) el.textContent = text; }
    destroy() {
      this.setOpen(false, false);
      const pending = !!this.saveTimer;
      clearTimeout(this.saveTimer);
      this.abort.abort(); this.resizeObserver.disconnect(); this.host.remove(); this.icon.remove(); this.nativeCaptionStyle.remove();
      this.player.removeAttribute('data-progress-dub-hide-captions');
      // Pending control edits still persist if YouTube replaces the player.
      if (pending) this.persist(this.saveRevision);
    }
  }
  root.DubPlayerUI = PlayerUI;
})(globalThis);
