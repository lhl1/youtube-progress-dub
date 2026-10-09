(function (root) {
  'use strict';
  const C = root.DubCore;
  const fonts = {
    sans:'Roboto,Arial,"Microsoft YaHei",sans-serif', serif:'"Songti SC",SimSun,serif',
    kaiti:'KaiTi,"STKaiti",serif', mono:'Consolas,"Microsoft YaHei",monospace'
  };
  const shadows = {none:'none',shadow:'0 1px 3px #000,0 0 2px #000',outline:'-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 0 2px #000',raised:'-1px -1px 0 #eee,1px 1px 0 #333,2px 2px 2px #000'};
  const css = `
    .caption-presets{display:flex;gap:5px;flex-wrap:wrap;margin:5px 0 9px}.caption-presets button{font-size:12px;padding:6px 9px;background:#ffffff12;border-radius:5px}
    .caption-controls .select-row{grid-template-columns:104px minmax(0,1fr)}.caption-controls input[type=color]{width:100%;height:29px;padding:2px;border:1px solid #5b5b5b;border-radius:5px;background:#303030;cursor:pointer}
    .caption-controls .range,.caption-controls .select-row,.caption-controls .check{margin:0}.caption-controls .range input{display:block}.caption-controls .range:has(input:disabled){opacity:.5}
    .caption-preview{border:1px solid #ffffff28;border-radius:7px;background:linear-gradient(130deg,#293e35,#233e4c);padding:14px 9px;margin:7px 0 12px;overflow-wrap:anywhere}
    .caption-surface{font-family:var(--dub-font);color:var(--dub-color);font-weight:var(--dub-weight);font-size:var(--dub-font-size);line-height:var(--dub-line-height);text-align:var(--dub-align);text-shadow:var(--dub-shadow);text-wrap:balance;background:var(--dub-window);border-radius:5px;display:flex;flex-direction:column;gap:var(--dub-gap);padding:3px 0;overflow-wrap:anywhere}
    .caption-surface span{background:var(--dub-background);padding:3px 10px;box-decoration-break:clone;-webkit-box-decoration-break:clone;border-radius:3px;white-space:pre-wrap}
    .caption-surface .chinese-line{order:var(--dub-chinese-order)}.caption-surface .source{order:var(--dub-source-order);font-size:var(--dub-source-size);color:var(--dub-source-color);margin:0}
    .caption-surface .source[hidden],.caption-surface[hidden]{display:none}
    .caption-settings .hint,.caption-preview-label{font-size:11px;line-height:1.6;color:#aaa}.caption-preview-label{margin:0 0 4px}.caption-controls summary{font-weight:500}
  `;
  function rgba(hex, opacity) { return `rgba(${parseInt(hex.slice(1,3),16)}, ${parseInt(hex.slice(3,5),16)}, ${parseInt(hex.slice(5,7),16)}, ${opacity})`; }
  function variables(settings, baseSize = 14) {
    const s=C.sanitizeSettings(settings);
    return {
      '--dub-font':fonts[s.subtitleFont], '--dub-color':rgba(s.subtitleColor,s.subtitleTextOpacity),
      '--dub-source-color':rgba(s.subtitleSourceColor,s.subtitleTextOpacity), '--dub-weight':s.subtitleBold?'700':'400',
      '--dub-font-size':`${baseSize*s.subtitleSize}px`, '--dub-line-height':String(s.subtitleLineHeight), '--dub-align':s.subtitleAlign,
      '--dub-shadow':shadows[s.subtitleEdge], '--dub-background':rgba(s.subtitleBackgroundColor,s.subtitleBackgroundOpacity),
      '--dub-window':rgba(s.subtitleWindowColor,s.subtitleWindowOpacity), '--dub-gap':s.bilingual?`${s.subtitleBilingualGap}px`:'0px',
      '--dub-source-size':`${s.subtitleSourceSize*100}%`, '--dub-chinese-order':s.bilingualOrder==='source-first'?'1':'0',
      '--dub-source-order':s.bilingualOrder==='source-first'?'0':'1'
    };
  }
  function apply(element, settings, baseSize) { for(const [key,value] of Object.entries(variables(settings,baseSize))) element.style.setProperty(key,value); }
  function valueLabel(field, value) {
    if(field.unit==='percent')return `${Math.round(value*100)}%`;
    if(field.unit==='pct')return `${Math.round(value)}%`;
    if(field.unit==='px')return `${Math.round(value)} 像素`;
    if(field.unit==='seconds')return `${value>0?'+':''}${Number(value).toFixed(1)} 秒`;
    return `${Number(value).toFixed(2)}×`;
  }
  function fieldMarkup([key,field]) {
    const attrs=`id="${key}" name="${key}" aria-label="${field.label}"`;
    if(field.type==='range')return `<label class="range"><span class="caption"><span>${field.label}</span><output class="value" data-caption-value="${key}"></output></span><input ${attrs} type="range" min="${field.min}" max="${field.max}" step="${field.step}"></label>`;
    if(field.type==='checkbox')return `<label class="check"><span>${field.label}</span><input ${attrs} type="checkbox"></label>`;
    return `<label class="select-row"><span>${field.label}</span>${field.type==='color'?`<input ${attrs} type="color">`:`<select ${attrs}>${field.choices.map(([v,label])=>`<option value="${v}">${label}</option>`).join('')}</select>`}</label>`;
  }
  function controlsMarkup() {
    const group=name=>Object.entries(C.subtitleFields).filter(([,f])=>f.group===name).map(fieldMarkup).join('');
    return `<div class="caption-controls">
      <div class="caption-presets">${Object.entries(C.subtitlePresets).map(([key,p])=>`<button type="button" data-caption-preset="${key}">${p.label}</button>`).join('')}</div>
      <p class="caption-preview-label">实时样式预览</p>${previewMarkup()}
      ${group('basic')}
      <details><summary>背景、透明度与行距</summary>${group('appearance')}</details>
      <details><summary>双语外观</summary>${group('bilingual')}<p class="hint">原文只在开启双语、且有独立原文时显示。</p></details>
      <details><summary>字幕同步与防重叠</summary>${group('timing')}<p class="hint">字幕偏移只在跟随视频时间轴时生效。正值提前显示，负值延后；不改变朗读和视频进度。隐藏原字幕只影响显示，不关闭 YouTube 的字幕读取。</p></details>
      <div class="actions"><button type="button" class="caption-reset">恢复字幕默认</button></div>
    </div>`;
  }
  function previewMarkup() { return `<div class="caption-preview"><div class="caption-surface"><div class="chinese-line"><span class="chinese">亲眼看到这些东西，能唤起真实的回忆。</span></div><div class="source"><span>Seeing these things brings back real memories.</span></div></div></div>`; }
  function refreshControls(parent, settings) {
    const s=C.sanitizeSettings(settings);
    for(const [key,field] of Object.entries(C.subtitleFields)) {
      const input=parent.querySelector(`[name="${key}"]`);if(!input)continue;
      if(field.type==='checkbox')input.checked=s[key];else if(input.value!==String(s[key]))input.value=s[key];
      if(field.type==='range'){const label=valueLabel(field,s[key]);parent.querySelector(`[data-caption-value="${key}"]`).textContent=label;input.setAttribute('aria-valuetext',label);}
      if(key==='subtitleOffset')input.disabled=s.subtitleTiming!=='video';
    }
    for(const preview of parent.querySelectorAll('.caption-preview .caption-surface')){apply(preview,s,14);preview.querySelector('.source').hidden=!s.bilingual;}
  }
  function bindButtons(parent, onChange, eventOptions) {
    for(const button of parent.querySelectorAll('[data-caption-preset]'))button.addEventListener('click',()=>onChange({...C.subtitlePresets[button.dataset.captionPreset].patch}),eventOptions);
    parent.querySelector('.caption-reset').addEventListener('click',()=>onChange(Object.fromEntries(C.subtitleSettingKeys.map(k=>[k,C.defaults[k]]))),eventOptions);
  }
  const api={css,variables,apply,controlsMarkup,previewMarkup,refreshControls,bindButtons};
  root.DubSubtitles=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
