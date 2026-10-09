// Bundled locally for MV3: no downloaded code, network model, or eval.
const wink = require('wink-nlp');
const model = require('wink-eng-lite-web-model');
let nlp;
globalThis.DubSyntax = {
  analyze(text) {
    nlp ||= wink(model, ['pos']);
    const result = []; let cursor = 0;
    // Bound individual model calls without changing the original offsets.
    // Windows end at whitespace; the overlap supplies local POS context.
    let start = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + 8000);
      if (end < text.length) end = text.lastIndexOf(' ', end) > start ? text.lastIndexOf(' ', end) : end;
      const context = Math.max(0, text.lastIndexOf(' ', Math.max(0, start - 200)) + 1);
      const doc = nlp.readDoc(text.slice(context, end));
      const values = doc.tokens().out(), tags = doc.tokens().out(nlp.its.pos);
      let local = context;
      for (let i = 0; i < values.length; i++) {
        const from = text.indexOf(values[i], local);
        if (from < local || from >= end) continue;
        const to = from + values[i].length; local = to;
        if (from < start || from < cursor) continue;
        result.push({word: values[i].toLowerCase().replace(/’/g, "'"), at: from, to, pos: tags[i]});
        cursor = to;
      }
      start = end;
    }
    return result;
  }
};
