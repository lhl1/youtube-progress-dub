'use strict';

const BING_TAB = 'bingTranslatorTab';
const BING_BLOCK = 'bingTranslatorBlock';
let bingQueue = Promise.resolve();
let bingActiveRequest = null;

function isBingTranslator(url) {
  try {
    const page = new URL(url);
    return ['https://www.bing.com', 'https://cn.bing.com'].includes(page.origin) && page.pathname === '/translator';
  } catch {
    return false;
  }
}

async function openBingTranslator() {
  if (!await chrome.permissions.contains(DubCore.bingPermission)) {
    throw new Error('请在扩展设置中授权 Bing 翻译网页');
  }
  const saved = (await chrome.storage.session.get(BING_TAB))[BING_TAB];
  const tab = Number.isInteger(saved) ? await chrome.tabs.get(saved).catch(() => null) : null;
  if (tab && isBingTranslator(tab.pendingUrl || tab.url)) {
    await chrome.tabs.update(tab.id, {active: true});
  } else {
    const opened = await chrome.tabs.create({url: DubCore.bingUrl, active: true});
    await chrome.storage.session.set({[BING_TAB]: opened.id});
    await chrome.storage.session.remove(BING_BLOCK);
  }
}

// Runs in the extension's isolated world on the dedicated tab. The website
// itself sends the translation request and handles cookies and verification.
async function translateOnBingPage(text, maxWait) {
  if (!['https://www.bing.com', 'https://cn.bing.com'].includes(location.origin) || location.pathname !== '/translator') {
    return {error: '请保留扩展打开的 Bing 翻译网页'};
  }
  const input = document.querySelector('#tta_input_ta');
  const output = document.querySelector('#tta_output_ta');
  const target = document.querySelector('#tta_tgtsl');
  const clear = document.querySelector('#tta_clear');
  if (!input?.isContentEditable || !output || !target?.querySelector('option[value="zh-Hans"]') || !clear) {
    return {error: 'Bing 翻译网页未就绪，请打开网页并确认翻译框可用'};
  }
  const visible = element => element?.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
  const challenge = () => visible(document.querySelector('iframe[src*="captcha"], #b_captcha, #captcha'));
  if (challenge()) return {verification: true};
  clear.click();
  if (input.textContent.trim() || output.textContent.trim()) {
    return {error: 'Bing 翻译网页未清空旧译文，请刷新 Bing 标签页'};
  }
  if (target.value !== 'zh-Hans') {
    target.value = 'zh-Hans';
    target.dispatchEvent(new Event('change', {bubbles: true}));
  }
  const source = document.querySelector('#tta_srcsl');
  if (source?.querySelector('option[value="auto-detect"]') && source.value !== 'auto-detect') {
    source.value = 'auto-detect';
    source.dispatchEvent(new Event('change', {bubbles: true}));
  }
  // Use the browser's normal editor operation so the page sees its input event.
  input.focus({preventScroll: true});
  if (!document.execCommand('insertText', false, text)) {
    return {error: '当前浏览器无法在 Bing 网页中提交字幕'};
  }
  input.dispatchEvent(new KeyboardEvent('keyup', {bubbles: true, key: '.', code: 'Period', keyCode: 190}));
  return new Promise(resolve => {
    const finish = result => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(result);
    };
    const check = () => {
      if (challenge()) return finish({verification: true});
      const translated = output.textContent.trim();
      const normalize = value => value.replace(/\s+/g, ' ').trim();
      const pending = /^(?:\.{2,}|…+)$/.test(translated);
      if (translated && !pending && normalize(input.innerText) === normalize(text) && target.value === 'zh-Hans') {
        return finish({text: translated});
      }
      if (visible(document.querySelector('#tta_err'))) finish({error: 'Bing 网页未返回译文，请检查翻译页中的提示'});
    };
    // MutationObserver also works when the background tab's timers are throttled.
    const observer = new MutationObserver(check);
    const timer = setTimeout(() => finish({error: 'Bing 网页翻译超时，请检查翻译页是否需要验证'}), maxWait);
    observer.observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true});
    check();
  });
}

function bingUnavailable(message, retryAfter = 15) {
  const error = new Error(message);
  error.retryAfter = retryAfter;
  return error;
}

async function translateBing(text, signal) {
  const end = Date.now() + 14500;
  const task = bingQueue.then(async () => {
    signal.throwIfAborted();
    if (!await chrome.permissions.contains(DubCore.bingPermission)) {
      throw bingUnavailable('请在「配置接口与密钥」中授权并打开 Bing 翻译页');
    }
    const session = await chrome.storage.session.get([BING_TAB, BING_BLOCK]);
    const tabId = session[BING_TAB], block = session[BING_BLOCK];
    if (!Number.isInteger(tabId)) throw bingUnavailable('请先在扩展设置中打开 Bing 翻译页');
    if (block?.tabId === tabId && (block.verification || block.until > Date.now())) {
      throw bingUnavailable(block.message, block.verification ? 86400 : Math.ceil((block.until - Date.now()) / 1000));
    }
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!isBingTranslator(tab?.url)) throw bingUnavailable('请在扩展设置中重新打开 Bing 翻译页');
    if (tab.active) throw bingUnavailable('请切回 YouTube，保留 Bing 翻译标签页', 3);
    const parts = [];
    for (const chunk of DubCore.splitTranslationText(text, 1000)) {
      if (!chunk.trim()) continue;
      signal.throwIfAborted();
      const margin = end - Date.now();
      if (margin < 500) throw bingUnavailable('Bing 网页翻译超时，请稍后重试');
      let notify;
      const failed = new Promise(resolve => { notify = resolve; });
      bingActiveRequest = {tabId, notify};
      const wait = Math.min(6500, margin - 350);
      const timer = setTimeout(() => notify({error: 'Bing 网页翻译超时，请检查翻译页是否需要验证'}), wait + 200);
      try {
        const injected = chrome.scripting.executeScript({
          target: {tabId}, func: translateOnBingPage, args: [chunk.trim(), wait]
        }).then(results => results[0]?.result).catch(() => ({error: 'Bing 翻译页不可用，请在扩展设置中重新打开'}));
        const result = await Promise.race([injected, failed]);
        if (result?.verification || result?.limit) {
          const message = result.verification
            ? 'Bing 要求验证，请在翻译页手动完成后回到 YouTube 点「恢复 / 重试」'
            : 'Bing 网页翻译限流，稍后自动重试';
          const retryAfter = result.verification ? 3600 * 24 : Math.max(result.retryAfter || 0, 60);
          await chrome.storage.session.set({[BING_BLOCK]: {tabId, until: Date.now() + retryAfter * 1000, message, verification: !!result.verification}});
          throw bingUnavailable(message, retryAfter);
        }
        signal.throwIfAborted();
        if (typeof result?.text !== 'string' || !result.text.trim() || result.text.length > 12000) {
          throw bingUnavailable(result?.error || 'Bing 网页未返回有效译文');
        }
        parts.push(result.text.trim());
      } finally {
        clearTimeout(timer);
        bingActiveRequest = null;
      }
    }
    const translation = parts.join('\n');
    if (!translation || translation.length > 12000) throw bingUnavailable('Bing 网页未返回有效完整译文');
    return translation;
  });
  bingQueue = task.catch(() => {});
  return task;
}

async function resumeBingTranslator() {
  const candidate = (await chrome.storage.session.get(BING_BLOCK))[BING_BLOCK];
  if (candidate?.verification) await chrome.storage.session.remove(BING_BLOCK);
}

function watchBingTranslation(details) {
  const request = bingActiveRequest;
  if (!request || details.tabId !== request.tabId) return;
  if (details.statusCode === 401 || details.statusCode === 403) request.notify({verification: true});
  if (details.statusCode === 429) {
    const retry = details.responseHeaders?.find(header => header.name.toLowerCase() === 'retry-after')?.value;
    const retryAfter = /^\d+$/.test(retry || '') ? Number(retry) : Math.ceil((Date.parse(retry) - Date.now()) / 1000);
    request.notify({limit: true, retryAfter: Math.min(3600, retryAfter || 60)});
  }
}
