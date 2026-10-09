/* Pure subtitle parsing and progress-driven scheduling. Shared with deterministic tests. */
(function (root) {
  'use strict';
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const clean = text => String(text || '')
    .replace(/<\/?(?:v(?:\s[^>]+)?|c(?:\.[\w-]+)*|b|i|u|ruby|rt|lang(?:\s[^>]+)?)>/gi, '')
    .replace(/<\d{2}:\d{2}:\d{2}\.\d+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[\da-f]+|\d+);/gi, entity => {
      const named = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' '};
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const number = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
      return number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
    }).replace(/\s+/g, ' ').trim();
  const isChinese = lang => /^zh(?:-|$)|^cmn(?:-|$)/i.test(lang || '');
  function videoId(url) {
    try {
      const u = new URL(url);
      if (u.hostname !== 'www.youtube.com') return '';
      return u.searchParams.get('v') || u.pathname.match(/^\/(?:shorts|live)\/([^/?]+)/)?.[1] || '';
    } catch { return ''; }
  }
  function normalize(rows) {
    const out = []; let previousRaw = null;
    for (const r of rows.sort((a, b) => a.start - b.start)) {
      let text = clean(r.text);
      if (!text || !Number.isFinite(r.start) || r.start < 0) continue;
      const end = Math.max(r.start + 0.25, Number.isFinite(r.end) ? r.end : r.start + 3);
      const prev = out.at(-1), rawText = text;
      // ASR roll-up repeats previous words. Only de-duplicate overlapping windows.
      if (prev && previousRaw && r.start < previousRaw.end + 0.05) {
        if (text === previousRaw.text) { prev.end = Math.max(prev.end, end); previousRaw = {text: rawText, end}; continue; }
        if (text.startsWith(previousRaw.text + ' ')) text = text.slice(previousRaw.text.length).trim();
      }
      previousRaw = {text: rawText, end};
      if (text) out.push({start: r.start, end, text});
    }
    for (let i = 0; i < out.length - 1; i++) out[i].end = Math.min(out[i].end, Math.max(out[i].start + 0.25, out[i + 1].start));
    return out;
  }
  function parseJson3(data) {
    const events = (data.events || []).filter(e => e.segs?.length && Number.isFinite(e.tStartMs));
    const rows = [];
    for (let i = 0; i < events.length; i++) {
      const e = events[i], text = e.segs.map(s => s.utf8 || '').join('');
      const start = e.tStartMs / 1000;
      const end = start + (e.dDurationMs > 0 ? e.dDurationMs / 1000 : Math.max(0.25, ((events[i + 1]?.tStartMs ?? e.tStartMs + 3000) - e.tStartMs) / 1000));
      if (e.aAppend && rows.length && start <= rows.at(-1).end) {
        rows.at(-1).text += text;
        rows.at(-1).end = Math.max(rows.at(-1).end, end);
      } else rows.push({start, end, text});
    }
    return normalize(rows);
  }
  function timestamp(s) {
    const p = s.replace(',', '.').split(':').map(Number);
    return p.reduce((a, b) => a * 60 + b, 0);
  }
  function parseVtt(text) {
    const rows = [];
    for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
      const lines = block.split('\n'), i = lines.findIndex(l => l.includes('-->'));
      if (i < 0) continue;
      const [a, b] = lines[i].split('-->').map(s => s.trim().split(/\s+/)[0]);
      rows.push({start: timestamp(a), end: timestamp(b), text: lines.slice(i + 1).join(' ')});
    }
    return normalize(rows);
  }
  function parseCaptions(text, Parser) {
    const body = text.trim();
    if (!body) throw new Error('字幕响应为空');
    if (body.startsWith('{')) return parseJson3(JSON.parse(body));
    if (body.startsWith('WEBVTT') || /\d:\d\d.*-->/.test(body)) return parseVtt(body);
    if (!Parser) throw new Error('字幕不是 JSON3 / VTT');
    const doc = new Parser().parseFromString(body, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('字幕 XML 无法解析');
    return normalize([...doc.querySelectorAll('text, p')].map(n => {
      const srv3 = n.tagName === 'p';
      const start = Number(n.getAttribute(srv3 ? 't' : 'start')) / (srv3 ? 1000 : 1);
      const duration = Number(n.getAttribute(srv3 ? 'd' : 'dur')) / (srv3 ? 1000 : 1);
      return {start, end: start + (duration || 3), text: n.textContent};
    }));
  }
  // Display rows are not sentences. Resolve punctuation across row boundaries
  // before translation; otherwise "until / you see" and "real / memories"
  // become unrelated requests. Offsets retain each row's original time range.
  function sentenceRanges(text) {
    const ranges = []; let from = 0;
    const punctuation = /[.!?。！？]+["'”’）)\]]*/gu;
    for (const match of text.matchAll(punctuation)) {
      const at = match.index, to = at + match[0].length, mark = match[0];
      if (mark[0] === '.') {
        if (/[\p{L}\p{N}]/u.test(text[to] || '')) continue; // decimals, domains, initials
        const word = text.slice(Math.max(0, at - 32), at + 1).match(/(?:^|[\s([{])([\p{L}.]+\.)$/u)?.[1] || '';
        const following = text.slice(to, to + 80).trimStart().match(/^[A-Za-z]+/)?.[0];
        if (/^(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|e\.g|i\.e)\.$/i.test(word)) continue;
        if (/^(?:no|fig|sec|vol)\.$/i.test(word) && /^\s*\d/.test(text.slice(to, to + 80))) continue;
        if (/^(?:[A-Za-z]\.)+$/.test(word) && following && !(word.length > 2 && /^(?:I|You|He|She|It|We|They|This|That|These|Those|The|There|Then|However|But|When)$/.test(following))) continue;
        if (mark.startsWith('..') && /^\s*[a-z]/.test(text.slice(to, to + 80))) continue;
      }
      if (to < text.length && !/\s|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text[to])) continue;
      ranges.push({from, to, complete: true}); from = to;
    }
    if (from < text.length && text.slice(from).trim()) ranges.push({from, to: text.length, complete: false});
    return ranges;
  }
  function naturalCut(text, limit) {
    const sample = text.slice(0, limit + 1), floor = Math.max(1, Math.floor(limit * 0.45));
    let cut = 0;
    for (const m of sample.matchAll(/[,，;；:：、]\s*|\s+[—–-]\s+/gu)) if (m.index + m[0].length >= floor && m.index + m[0].length <= limit) cut = m.index + m[0].length;
    if (cut) return cut;
    // If punctuation is missing, keep a linking word with its following clause.
    for (const m of sample.matchAll(/\s+(?=(?:until|when|while|because|although|unless|before|after|but|which|where|if)\b)/gi)) if (m.index >= floor) cut = m.index;
    if (cut) return cut;
    for (const m of sample.matchAll(/\s+/gu)) {
      if (m.index < floor || m.index > limit) continue;
      if (/\b(?:a|an|the|of|to|in|on|for|with|and|or|until|because|if|when|that|this|these|those|my|your|his|her|our|their)$/i.test(text.slice(0, m.index))) continue;
      cut = m.index;
    }
    if (cut) return cut;
    // Last resort for unpunctuated CJK / pathological unbroken strings.
    return /[\uDC00-\uDFFF]/.test(text[limit] || '') ? (limit > 1 ? limit - 1 : 2) : limit;
  }
  // ASR often has no punctuation at all. Infer conservative independent-clause
  // starts, rather than treating a display row or a fixed character count as a
  // sentence. This is a local heuristic, not a grammatical completeness proof.
  const finiteVerb = /^(?:am|is|are|was|were|be|have|has|had|do|does|did|can|could|will|would|shall|should|may|might|must|need|needs|want|wants|know|knows|think|thinks|thought|say|says|said|see|sees|saw|get|gets|got|go|goes|went|come|comes|came|take|takes|took|make|makes|made|find|finds|found|feel|feels|felt|mean|means|meant|remember|remembers|forget|forgets|forgot|look|looks|seem|seems|keep|keeps|kept|put|let|tell|tells|told|hear|hears|heard|bring|brings|brought|learn|learns|play|plays|work|works|turn|turns|try|tries|use|uses|check|checks|notice|notices|show|shows|start|starts|stop|stops|happen|happens|understand|understands|understood|leave|leaves|left|read|reads|watch|watches|believe|believes|realize|realizes|become|becomes|became|hold|holds|held|run|runs|ran|live|lives|agree|agrees|[a-z]{3,}ed)$/i;
  function legacyEnglishRanges(text) {
    const words = [...text.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)?|\d+(?:[.:]\d+)*/g)].map(m=>({word:m[0].toLowerCase().replace(/’/g,"'"), at:m.index}));
    const subject = /^(?:i|we|you|he|she|they|it|this|that|there|i'm|we're|you're|he's|she's|it's|they're)$/;
    const linker = /^(?:if|when|while|until|because|although|unless|before|after|that|which|who|whom|whose|where|whether|than|as|what)$/;
    const incomplete = /\b(?:a|an|the|of|to|in|on|for|with|and|or|but|so|then|until|because|if|when|that|which|who|this|these|those|my|your|his|her|our|their|very|more|most|real)$/i;
    const reporting = /^(?:saw|see|heard|hear|watched|watch|told|tell|asked|ask|made|make|let|help|helped|thought|think|knew|know|realized|realize|remember|remembered|believe|believed|said|say|noticed|notice|found|find|understand|understood|forget|forgot)$/;
    const discourse = /^(?:so|but|and|then|now|however|anyway|meanwhile|afterwards|instead|next)$/;
    const relativeNoun = /^(?:thing|things|game|games|picture|pictures|photo|photos|hour|hours|time|times|person|people|man|woman|place|places|way|ways|day|days|moment|moments|stuff|book|books|story|stories)$/;
    const finishedAdverb = /^(?:again|together|today|yesterday|anymore|earlier|later|instead|ago|already|outside|inside|here|there|back|too|well)$/;
    const mainStart = i => {
      if (!subject.test(words[i]?.word || '')) return false;
      const tail = words.slice(i+1,i+6).map(w=>w.word);
      // Permit a short modifier, but not arbitrary words between subject/verb.
      while (tail.length && /^(?:just|really|actually|already|also|still|finally|probably|never|always|usually|sometimes|only|kind|of|sort|then|don't|doesn't|didn't)$/.test(tail[0])) tail.shift();
      return finiteVerb.test(tail[0] || '') || /^(?:i'm|we're|you're|he's|she's|it's|they're)$/.test(words[i]?.word || '');
    };
    const ranges = []; let from = 0, wordFrom = 0;
    for (let i=1;i<words.length;i++) {
      const w=words[i], previous=words[i-1].word;
      let next=i+1;
      if (words[next]?.word==='then' && w.word!=='then') next++;
      const strong = discourse.test(w.word) && mainStart(next) || /^(?:yeah|okay|alright)$/.test(w.word) && (mainStart(next) || finiteVerb.test(words[next]?.word || ''));
      const temporal = /^(?:upon|afterwards|meanwhile)$/.test(w.word) || w.word==='then' && /^(?:right|beneath|below|above|inside|outside|at|on|in|from|under|over)$/.test(words[i+1]?.word || '');
      // A noun followed by "we played" may have an omitted relative "that"
      // ("the games we played"), not a new sentence. Bare subjects therefore
      // need additional evidence instead of accepting every subject/verb pair.
      const plain = mainStart(i) && (w.word==='i' && !relativeNoun.test(previous) || finishedAdverb.test(previous)) && !linker.test(previous) && !reporting.test(previous) && !discourse.test(previous);
      if (!strong && !temporal && !plain) continue;
      const prefix=text.slice(from,w.at);
      if(plain && /\b(?:how|why|whether|what)\s+(?:[a-z]+\s+){0,3}$/i.test(prefix))continue;
      if(/^(?:and|or|but)$/.test(w.word) && /\b(?:because|whether|so that)\b/i.test(prefix))continue;
      if(/^(?:and|or|but)$/.test(w.word) && /\b(?:told|said|says|believed|thought|claimed|explained)\b[\s\S]*\bthat\b/i.test(prefix))continue;
      const left=text.slice(from,w.at).trim(), leftWords=words.slice(wordFrom,i);
      if(left.length<(strong||temporal?28:45)||leftWords.length<5||incomplete.test(left))continue;
      const predicates=leftWords.filter(t=>finiteVerb.test(t.word)).length;
      if(!predicates)continue;
      // Keep a conditional and its consequence, or an introductory dependent
      // clause and its main clause, in the same unit.
      if(w.word==='then' && /\bif\b/i.test(left))continue;
      if(/^(?:if|when|while|unless|although|because|until|before|after|once)\b/i.test(left) && predicates<2)continue;
      if(temporal && !words.slice(i+1,i+22).some(t=>finiteVerb.test(t.word)))continue;
      ranges.push({from,to:w.at,complete:true,inferred:true});from=w.at;wordFrom=i;
    }
    if(from<text.length)ranges.push({from,to:text.length,complete:false,inferred:true});
    return ranges;
  }
  function englishRanges(text) {
    if (!root.DubSyntax) return legacyEnglishRanges(text);
    const words = root.DubSyntax.analyze(text).filter(t => t.pos !== 'PUNCT');
    if (!words.length) return [{from:0,to:text.length,complete:false,inferred:true}];
    const pronoun = /^(?:i|we|you|he|she|they|it|this|that|there)$/;
    const linker = /^(?:if|when|while|until|because|although|unless|before|after|that|which|who|whom|whose|where|whether|than|as|what)$/;
    const discourse = /^(?:so|but|and|then|now|however|anyway|meanwhile|afterwards|instead|next|yeah|okay|alright)$/;
    const reporting = /^(?:saw|see|heard|hear|watched|watch|told|tell|asked|ask|made|make|let|help|helped|thought|think|knew|know|realized|realize|remember|remembered|believe|believed|said|say|noticed|notice|found|find|understand|understood|forget|forgot)$/;
    const predicate = t => t && (t.pos === 'AUX' || t.pos === 'VERB' && !/ing$/.test(t.word));
    const at = i => words[i]?.word || '';
    const skipModifiers = i => { while(words[i]?.pos==='ADV'||/^(?:n't|not)$/.test(at(i)))i++; return i; };
    const mainStart = i => pronoun.test(at(i)) && predicate(words[skipModifiers(i+1)]);
    // NP + finite predicate, allowing an omitted relative inside the NP:
    // "this anomaly he found is ...". Never mistake "something he can't
    // explain" or "the games we played" for a new independent subject.
    const nounStart = i => {
      if (words[i]?.pos!=='DET' || !/^(?:this|these|those|the|an|a)$/.test(at(i)))return false;
      let j=i+1,noun=false;
      while(j<Math.min(i+7,words.length)&&['ADJ','NOUN','PROPN','NUM'].includes(words[j].pos)){noun ||= /NOUN|PROPN/.test(words[j].pos);j++;}
      if(!noun)return false;
      if(predicate(words[j]))return true;
      if(mainStart(j)) {
        j=skipModifiers(j+1)+1;
        // An embedded relative requires a separate main predicate afterwards.
        for(let k=j;k<Math.min(j+7,words.length);k++)if(words[k].pos==='AUX')return true;
      }
      return false;
    };
    const legacy = new Set(legacyEnglishRanges(text).slice(1).map(r=>r.from));
    const candidates=[{i:0,at:0,score:0}];
    for(let i=1;i<words.length;i++) {
      const w=words[i],prev=words[i-1];let score=0;
      if(legacy.has(w.at))score=11;
      if(discourse.test(w.word)&&mainStart(i+1))score=11;
      // Bare subjects require a closed-looking left phrase. A preceding noun
      // can be an omitted relative; a reporting verb can take a complement.
      if(mainStart(i)&&!linker.test(prev.word)&&!reporting.test(prev.word)&&!discourse.test(prev.word)&&!['NOUN','PROPN','DET','ADJ','ADP','PART'].includes(prev.pos))score=Math.max(score,9.5);
      if(nounStart(i)&&!['ADP','PART','DET','CCONJ','NOUN'].includes(prev.pos)&&!linker.test(prev.word)&&!reporting.test(prev.word))score=Math.max(score,9.5);
      // Inverted independent question: "did anyone else see ...".
      if(w.pos==='AUX'&&words[i+1]?.pos==='PRON'&&predicate(words[skipModifiers(i+2)])&&!linker.test(prev.word))score=Math.max(score,10);
      if(!score)continue;
      // Translation units must close their object/complement before a new
      // subject. POS alone mistakes "share / this story" for two sentences.
      const head = text.slice(0,w.at);
      const bare = mainStart(i) || nounStart(i);
      // A demonstrative can refer back to a closed indefinite object:
      // "something he can't explain / this anomaly ...". This is different
      // from the still-missing object in "wanted to share / this story ...".
      const closedReference=nounStart(i)&&/^(?:this|these|those)$/.test(w.word)&&at(i-2)!=='to'&&/\b(?:something|anything|everything|nothing)\s+(?:i|we|you|he|she|they|it)\s+(?:[a-z]+(?:['’][a-z]+)?\s+){1,5}$/i.test(head);
      if(bare && prev.pos==='VERB' && !closedReference)continue;
      if(bare && /\b(?:how|why|whether|what)\s+(?:[a-z]+\s+){0,3}$/i.test(head))continue;
      // Coordinated reported/causal clauses belong to the same proposition:
      // "they believed ... and they would ...", not a new assertion by us.
      if(/^(?:and|or|but)$/.test(w.word) && /\b(?:because|whether|in order to|so that)\b/i.test(head))continue;
      if(/^(?:and|or|but)$/.test(w.word) && /\b(?:told|tell|said|says|say|believed|believe|thought|think|claimed|claims|explained|explains|knew|know)\b[\s\S]*\bthat\b/i.test(head))continue;
      // Never cut just before a relative pronoun, complement, or article.
      if(/^(?:something|anything|everything|nothing)$/.test(prev.word)&&mainStart(i))continue;
      candidates.push({i,at:w.at,score});
    }
    candidates.push({i:words.length,at:text.length,score:0});
    // Constrained shortest path over plausible boundaries. Length is a soft
    // cost, never permission to split a phrase at an arbitrary character.
    const costs=Array(candidates.length).fill(Infinity),previous=[];costs[0]=0;
    for(let b=1;b<candidates.length;b++) {
      for(let a=b-1;a>=0;a--) {
        const left=words.slice(candidates[a].i,candidates[b].i),n=left.length;
        if(a<b-1&&n>160)break; // Bound search, retaining the one-unit path.
        if(b<candidates.length-1) {
          if(n<6||!left.some(predicate))continue;
          const last=left.at(-1);
          if(['DET','ADP','CCONJ','SCONJ','PART'].includes(last.pos)&&!/out|up|back|away/.test(last.word))continue;
          if(/^(?:if|when|while|unless|although|because|until|before|after|once)$/.test(left[0].word)) {
            // Count predicate phrases, not every auxiliary plus participle.
            // "if you have visited where he has lived / I ..." still needs
            // its main clause even though it contains four verb tokens.
            const heads=left.filter((t,j)=>{
              if(!predicate(t))return false;
              let k=j-1;while(k>=0&&['ADV','PART'].includes(left[k].pos))k--;
              return !predicate(left[k]);
            }).length;
            const dependent=left.filter(t=>linker.test(t.word)).length;
            if(heads<=Math.max(1,dependent))continue;
          }
          if(at(candidates[b].i)==='then'&&left.some(t=>t.word==='if'))continue;
        }
        const lengthCost=Math.pow(Math.max(0,n-38)/14,2);
        const value=costs[a]+lengthCost+(b===candidates.length-1?0:9-candidates[b].score);
        if(value<costs[b]){costs[b]=value;previous[b]=a;}
      }
      // Always retain a lossless whole tail if no safe boundary is available.
      if(b===candidates.length-1 && !Number.isFinite(costs[b])){costs[b]=0;previous[b]=0;}
    }
    const selected=[];let b=candidates.length-1;
    while(b>0){const a=previous[b];selected.unshift({from:candidates[a].at,to:candidates[b].at,complete:b<candidates.length-1,inferred:true});b=a;}
    return selected;
  }
  // Display pages are continuations of the same translated/voiced sentence.
  // Exact offsets include whitespace; concatenating pages recovers the input.
  let pageWords, pageGraphemes;
  function subtitlePages(text, limit=48) {
    text=String(text||'');limit=Math.max(12,Math.floor(limit));
    if(!text)return [];
    if(text.length<=limit)return [{from:0,to:text.length,text}];
    const points=new Map([[0,0],[text.length,0]]), hard=Math.ceil(limit*1.3);
    // Word boundaries protect Chinese compounds, numbers, Latin names and
    // grapheme clusters. Punctuation is preferred; length is only a soft cost.
    if(typeof Intl.Segmenter==='function') {
      pageWords ||= new Intl.Segmenter('zh',{granularity:'word'});
      pageGraphemes ||= new Intl.Segmenter('zh',{granularity:'grapheme'});
      for(const t of pageWords.segment(text))points.set(t.index+t.segment.length,9);
      // Emergency candidates only inside a token too wide for the viewport.
      for(const t of pageWords.segment(text))if(t.segment.length>hard)
        for(const g of pageGraphemes.segment(t.segment))points.set(t.index+g.index+g.segment.length,30);
    } else { let at=0;for(const c of text){at+=c.length;points.set(at,30);} }
    const opening=/[（(《「『“‘]$/, closing=/^[，。！？；：、,.!?;:）)》」』”’]/;
    for(const m of text.matchAll(/[。！？!?；;]+[”’」』）》)]*|[，,：:]+/gu)) {
      let to=m.index+m[0].length;while(to<text.length&&/\s/.test(text[to]))to++;
      points.set(to,/[。！？!?；;]/.test(m[0])?0:2);
    }
    const candidates=[...points].sort((a,b)=>a[0]-b[0]).filter(([at])=>
      at===0||at===text.length||(!opening.test(text.slice(0,at))&&!closing.test(text.slice(at))));
    const cost=Array(candidates.length).fill(Infinity), previous=[];cost[0]=0;
    for(let b=1;b<candidates.length;b++)for(let a=b-1;a>=0;a--) {
      const size=candidates[b][0]-candidates[a][0];if(size>hard)break;
      if(!Number.isFinite(cost[a]))continue;
      const part=text.slice(candidates[a][0],candidates[b][0]),last=b===candidates.length-1;
      let penalty=last?0:candidates[b][1];
      // Do not strand function words or the degree modifier before an adjective.
      if(!last && /(?:的|得|地|把|被|在|向|与|和|及|或|而|不|没|更|最|很|第|一个|这些|那些|因为|如果|虽然|直到|为了|以至于|因此|所以|那么|但是|不过|然而|而且|并且|不仅|只要|除非|尽管|既然|即使|无论|一旦)$/.test(part.trim()))penalty+=24;
      if(!last && /^(?:的|得|地|了|着|过|吗|呢|吧|们|时|后|前)/.test(text.slice(candidates[b][0])))penalty+=15;
      const short=part.trim().length<Math.max(4,limit*.22)?10:0;
      const value=cost[a]+penalty+short+Math.pow((size-limit*.85)/limit,2)*4+Math.pow(Math.max(0,size-limit)/limit,2)*20;
      if(value<cost[b]){cost[b]=value;previous[b]=a;}
    }
    if(!Number.isFinite(cost.at(-1))) {
      // A single quoted/name token may exceed the budget: never lose text.
      const pages=[];let from=0;while(from<text.length){const cut=naturalCut(text.slice(from),limit);pages.push({from,to:Math.min(text.length,from+cut),text:text.slice(from,from+cut)});from+=cut;}return pages;
    }
    const pages=[];let b=candidates.length-1;
    while(b>0){const a=previous[b],from=candidates[a][0],to=candidates[b][0];pages.unshift({from,to,text:text.slice(from,to)});b=a;}
    return pages;
  }
  function translationInput(cue, language='') {
    const text=cue.text;
    if(text.length>=4500 || !cue.automatic || !/^en(?:-|$)/i.test(language) || /[.!?。！？][”’"')]*$/.test(text))return text;
    // Only terminal punctuation; raw captions and timestamps remain untouched.
    return text+(/^(?:did|does|do|can|could|would|will|is|are|was|were)\s+(?:i|we|you|he|she|they|it|anyone|anybody)\b/i.test(text)?'?':'.');
  }
  function validatedAlignment(alignment, source, target) {
    if(!Array.isArray(alignment)||alignment.length>256)return [];
    let end=0;
    return alignment.filter(a=>{
      if(!a || !['from','to','sourceFrom','sourceTo'].every(k=>Number.isInteger(a[k])) || a.from<end || a.from<0 || a.to<=a.from || a.to>target.length || a.sourceFrom<0 || a.sourceTo<=a.sourceFrom || a.sourceTo>source.length)return false;
      end=a.to;return true;
    }).map(a=>({from:a.from,to:a.to,sourceFrom:a.sourceFrom,sourceTo:a.sourceTo}));
  }
  function pageSource(page, source, translated, alignment=[]) {
    source=String(source||'');translated=String(translated||'');
    const matched=validatedAlignment(alignment,source,translated).filter(a=>a.to>page.from&&a.from<page.to);
    if(!matched.length)return source; // Unaligned MT: show the whole source unit, never guessed word ratios.
    let covered=page.from;
    for(const a of matched){
      if(a.from>covered && translated.slice(covered,a.from).trim())return source;
      covered=Math.max(covered,a.to);
    }
    if(covered<page.to && translated.slice(covered,page.to).trim())return source;
    return source.slice(Math.min(...matched.map(a=>a.sourceFrom)),Math.max(...matched.map(a=>a.sourceTo)));
  }
  function speechParts(text, maxLength = 140) {
    const parts = [];
    for (const range of sentenceRanges(text)) {
      let remaining = text.slice(range.from, range.to).trim();
      if (remaining.length>maxLength && /\p{Script=Han}/u.test(remaining)) {
        // Utterance boundaries need the same word/punctuation protection as
        // display pages, with a much larger budget to preserve natural prosody.
        parts.push(...subtitlePages(remaining, Math.floor(maxLength/1.3)).map(p=>p.text.trim()).filter(Boolean));
        continue;
      }
      while (remaining.length > maxLength) {
        const cut = naturalCut(remaining, maxLength);
        parts.push(remaining.slice(0, cut).trim()); remaining = remaining.slice(cut).trim();
      }
      if (remaining) parts.push(remaining);
    }
    return parts;
  }
  function isAutomaticTrack(track, url = '') {
    if (track?.kind === 'asr' || track?.vssId?.startsWith('a.')) return true;
    try { return new URL(url || track?.baseUrl).searchParams.get('kind') === 'asr'; } catch { return false; }
  }
  function isAutomaticCapture(tracks, url) {
    if (isAutomaticTrack(null,url)) return true;
    try {
      const u=new URL(url), comparable=value=>{
        const result=new URL(value);result.searchParams.delete('fmt');result.searchParams.delete('tlang');result.searchParams.sort();return result.href;
      };
      const matches=tracks.filter(t=>{
        try { const base=new URL(t.baseUrl);return base.origin===u.origin&&base.pathname===u.pathname&&base.searchParams.get('lang')===u.searchParams.get('lang')&&base.searchParams.get('kind')===u.searchParams.get('kind'); } catch{return false;}
      });
      const exact=matches.filter(t=>comparable(t.baseUrl)===comparable(url)), identified=exact.length?exact:matches;
      // If ASR and authored tracks share a language but no distinct metadata,
      // preserve the captured rows rather than guessing from selection order.
      return identified.length>0&&identified.every(t=>isAutomaticTrack(t,t.baseUrl));
    } catch{return false;}
  }
  function prepareCues(rows, {automatic = false, live = false, language = ''} = {}) {
    if (automatic) {
      const cues=groupCues(rows,{live,language}).map(c=>({...c,automatic:true}));
      for(let i=0;i<cues.length;i++) {
        cues[i].contextBefore=(cues[i-1]?.text||'').slice(-400);
        cues[i].contextAfter=live?'':(cues[i+1]?.text||'').slice(0,400);
      }
      return cues;
    }
    // Authored captions already have intentional boundaries. Do not combine
    // rows, infer sentences, split punctuation, or hold an unfinished live row.
    return rows.filter(r => clean(r.text)).map(r => ({...r, text: clean(r.text), automatic: false,
      id: `native:${r.start.toFixed(3)}:${hash(clean(r.text))}`}));
  }
  function groupCues(rows, {live = false, language = ''} = {}) {
    const groups = [], blocks = []; let block = null;
    for (const row of rows) {
      const text = clean(row.text); if (!text) continue;
      const gap=block?row.start-block.end:0, tail=block?.pieces.length?block.chunks.at(-1):'';
      const waitingForComplement=/\b(?:until|because|although|unless|if|when|while|that|which|who|of|to|with|for|and|or|a|an|the|very|more|real)\s*$/i.test(tail);
      // A short hesitation after "until" is not a sentence boundary. Very
      // long silence still closes a block; captions cannot establish intent.
      if (!block || gap>1.5 && (gap>=6 || !waitingForComplement)) { block = {chunks: [], pieces: [], length: 0, end: row.end}; blocks.push(block); }
      const previous = block.chunks.at(-1) || '';
      const join = !previous || /^[,.;:!?。！？、，；：）)\]]/u.test(text) || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(previous) && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ? '' : ' ';
      block.chunks.push(join, text); block.length += join.length;
      block.pieces.push({from: block.length, to: block.length + text.length, start: row.start, end: row.end});
      block.length += text.length; block.end = row.end;
    }
    for (const [b, block] of blocks.entries()) {
      const text = block.chunks.join(''), pieces = block.pieces;
      function timeAt(offset, end = false) {
        let lo = 0, hi = pieces.length - 1;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (end ? pieces[mid].to < offset : pieces[mid].to <= offset) lo = mid + 1; else hi = mid; }
        const p = pieces[lo]; return p.start + (p.end - p.start) * clamp((offset - p.from) / (p.to - p.from), 0, 1);
      }
      const ranges = sentenceRanges(text).flatMap(range => {
        const value=text.slice(range.from,range.to);
        const unpunctuatedEnglish=!range.complete && (!language || language==='auto' || /^en(?:-|$)/i.test(language)) && (value.match(/[A-Za-z]/g)||[]).length>value.length*.6;
        return unpunctuatedEnglish && value.length>100 ? englishRanges(value).map(r=>({...r,from:r.from+range.from,to:r.to+range.from})) : [range];
      });
      for (const range of ranges) {
        let from = range.from;
        while (from < range.to) {
          while (/\s/u.test(text[from] || '') && from < range.to) from++;
          if (from >= range.to) break;
          let to = range.to;
          // Limits protect requests for captions without punctuation. Prefer a
          // complete sentence; only genuinely long sentences need clause cuts.
          // Human language may contain a genuinely long sentence. Keep its
          // translation context; screen pages and speech parts handle length.
          // Only pathological/service-size inputs need a protective clause cut.
          const naturalLanguage=/\s|[\p{Script=Han}]/u.test(text.slice(from,range.to));
          const maxChars=naturalLanguage?4500:600,maxSeconds=Infinity;
          if (to - from > maxChars || timeAt(to, true) - timeAt(from) > maxSeconds) {
            let limit = Math.min(maxChars, to - from), lo = from + 1, hi = from + limit;
            while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (timeAt(mid, true) - timeAt(from) <= maxSeconds) lo = mid; else hi = mid - 1; }
            limit = Math.max(1, lo - from);
            to = from + naturalCut(text.slice(from, range.to), limit);
          }
          if (live && b === blocks.length - 1 && !range.complete && to === text.length) break;
          const value = text.slice(from, to).trim();
          if (value) { const start = timeAt(from), end = Math.max(start + 0.01, timeAt(to, true)); groups.push({start, end, text: value}); }
          from = to;
        }
      }
    }
    return groups.map(g => ({...g, id: `${g.start.toFixed(3)}:${hash(g.text)}`}));
  }
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  }
  function lowerBound(cues, time) {
    let lo = 0, hi = cues.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (cues[mid].end < time) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function chooseTrack(tracks, selected = '') {
    return tracks.find(t => t.vssId === selected) || tracks.find(t => isChinese(t.languageCode) && t.kind !== 'asr') ||
      tracks.find(t => isChinese(t.languageCode)) || tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr') ||
      tracks.find(t => t.kind !== 'asr') || tracks[0];
  }
  const subtitleFields = {
    subtitleFont: {label:'字体',type:'select',value:'sans',group:'basic',choices:[['sans','无衬线 · 清晰'],['serif','宋体 · 衬线'],['kaiti','楷体'],['mono','等宽字体']]},
    subtitleSize: {label:'字幕大小',type:'range',value:.75,min:.6,max:2.2,step:.05,group:'basic',unit:'percent'},
    subtitleColor: {label:'文字颜色',type:'color',value:'#ffffff',group:'basic'},
    subtitleBold: {label:'粗体文字',type:'checkbox',value:false,group:'basic'},
    subtitleEdge: {label:'文字边缘',type:'select',value:'shadow',group:'basic',choices:[['none','无'],['shadow','阴影'],['outline','描边'],['raised','浮雕']]},
    subtitlePosition: {label:'字幕位置',type:'select',value:'bottom',group:'basic',choices:[['bottom','底部'],['top','顶部']]},
    subtitleMargin: {label:'距离边缘',type:'range',value:2,min:0,max:35,step:1,group:'basic',unit:'pct'},
    subtitleWidth: {label:'字幕区域宽度',type:'range',value:86,min:50,max:96,step:1,group:'basic',unit:'pct'},
    subtitleAlign: {label:'文字对齐',type:'select',value:'center',group:'basic',choices:[['left','左对齐'],['center','居中'],['right','右对齐']]},
    subtitleTextOpacity: {label:'文字不透明度',type:'range',value:1,min:.25,max:1,step:.05,group:'appearance',unit:'percent'},
    subtitleBackgroundColor: {label:'文字背景颜色',type:'color',value:'#000000',group:'appearance'},
    subtitleBackgroundOpacity: {label:'文字背景不透明度',type:'range',value:0,min:0,max:1,step:.05,group:'appearance',unit:'percent'},
    subtitleWindowColor: {label:'整块字幕底色',type:'color',value:'#000000',group:'appearance'},
    subtitleWindowOpacity: {label:'整块底色不透明度',type:'range',value:0,min:0,max:1,step:.05,group:'appearance',unit:'percent'},
    subtitleLineHeight: {label:'字幕行距',type:'range',value:1.5,min:1.2,max:2,step:.05,group:'appearance',unit:'ratio'},
    bilingualOrder: {label:'双语顺序',type:'select',value:'zh-first',group:'bilingual',choices:[['zh-first','中文在上 · 原文在下'],['source-first','原文在上 · 中文在下']]},
    subtitleSourceSize: {label:'原文相对大小',type:'range',value:.65,min:.4,max:1.2,step:.05,group:'bilingual',unit:'percent'},
    subtitleSourceColor: {label:'原文颜色',type:'color',value:'#dddddd',group:'bilingual'},
    subtitleBilingualGap: {label:'双语间距',type:'range',value:6,min:0,max:20,step:1,group:'bilingual',unit:'px'},
    subtitleTiming: {label:'字幕跟随',type:'select',value:'speech',group:'timing',choices:[['speech','当前中文朗读 · 推荐'],['video','视频时间轴']]},
    subtitleOffset: {label:'字幕提前 / 延后',type:'range',value:0,min:-10,max:10,step:.1,group:'timing',unit:'seconds'},
    hideNativeCaptions: {label:'显示同传字幕时隐藏 YouTube 原字幕',type:'checkbox',value:true,group:'timing'}
  };
  const subtitleDefaults = Object.fromEntries(Object.entries(subtitleFields).map(([k,f])=>[k,f.value]));
  const subtitleAppearanceDefaults = Object.fromEntries(Object.entries(subtitleFields).filter(([,f])=>f.group!=='timing').map(([k,f])=>[k,f.value]));
  const subtitleSettingKeys = ['subtitle','bilingual',...Object.keys(subtitleFields)];
  const playerSettingKeys = ['voice','rate','volume','originalVolume','lookahead','autoTranslate','autoStart','syncMode','provider',...subtitleSettingKeys];
  const subtitlePresets = {
    classic: {label:'经典',patch:{...subtitleAppearanceDefaults}},
    cinema: {label:'影院',patch:{...subtitleAppearanceDefaults,subtitleColor:'#ffe66d',subtitleBackgroundOpacity:0,subtitleEdge:'outline',subtitleBold:true}},
    large: {label:'大字',patch:{...subtitleAppearanceDefaults,subtitleSize:1.5,subtitleBold:true,subtitleBackgroundOpacity:.9}},
    learning: {label:'双语学习',patch:{...subtitleAppearanceDefaults,bilingual:true,subtitleSourceSize:.85,subtitleSourceColor:'#b7e7ff',subtitleBilingualGap:9}}
  };
  const defaults = {
    voice: 'Microsoft Xiaoxiao (Natural) - Chinese (Simplified, China)', rate: 1.3, volume: 1, originalVolume: 0.25, lookahead: 100,
    subtitle: true, bilingual: true, autoTranslate: true, autoStart: true,
    syncMode: 'complete', provider: 'google-free', endpoint: '', apiKey: '', model: '', cacheRevision: 0, ...subtitleDefaults
  };
  function sanitizeSettings(input) {
    const s = {...defaults, ...input};
    for (const [key, lo, hi] of [['rate', 0.6, 2.5], ['volume', 0, 1], ['originalVolume', 0, 1], ['lookahead', 30, 240]]) {
      s[key] = clamp(Number.isFinite(Number(s[key])) ? Number(s[key]) : defaults[key], lo, hi);
    }
    for (const key of ['subtitle', 'bilingual', 'autoTranslate', 'autoStart']) s[key] = !!s[key];
    s.syncMode = s.syncMode === 'complete' ? 'complete' : 'follow';
    s.provider = s.provider === 'custom' ? 'custom' : 'google-free';
    for (const key of ['voice', 'endpoint', 'apiKey', 'model']) s[key] = String(s[key] || '').slice(0, 2048);
    s.cacheRevision = Number(s.cacheRevision) || 0;
    for (const [key,field] of Object.entries(subtitleFields)) {
      if (field.type === 'range') s[key] = clamp(Number.isFinite(Number(s[key])) ? Number(s[key]) : field.value, field.min, field.max);
      else if (field.type === 'select') s[key] = field.choices.some(([v])=>v===s[key]) ? s[key] : field.value;
      else if (field.type === 'color') s[key] = /^#[\da-f]{6}$/i.test(String(s[key])) ? String(s[key]).toLowerCase() : field.value;
      else s[key] = !!s[key];
    }
    return s;
  }
  function subtitleCue(cues, position, settings, spokenCue = null, queuedCue = null) {
    if (settings.subtitleTiming !== 'video' && (spokenCue || queuedCue)) return spokenCue || queuedCue;
    const at = position + (settings.subtitleTiming === 'video' ? Number(settings.subtitleOffset) || 0 : 0);
    const cue = cues[lowerBound(cues, at - .05)];
    return cue && cue.start <= at + .12 && cue.end > at - .05 ? cue : null;
  }
  function publicSettings(s) { const {apiKey, ...rest} = sanitizeSettings(s); return rest; }
  function cacheKey(cue, lang, settings) {
    const context=cue.automatic && settings.provider==='custom'?`${cue.contextBefore||''}|${cue.contextAfter||''}`:'';
    return `${cue.automatic===false?'sentence-v5:native':'meaning-v6:asr'}:${settings.provider}:${settings.cacheRevision}:${lang}:${hash(context?cue.text+'|'+context:cue.text)}`;
  }
  function permissionOrigin(endpoint) {
    const u = new URL(endpoint);
    return `${u.protocol}//${u.hostname}/*`;
  }
  function speechRate(settings, playbackRate = 1, catchupRate = 0) {
    const speed = Number(playbackRate);
    const base = Number(settings.rate);
    const requested = (Number.isFinite(base) && base > 0 ? base : defaults.rate) * (Number.isFinite(speed) && speed > 0 ? speed : 1);
    return clamp(settings.syncMode === 'complete' ? requested : Math.max(requested, catchupRate || 0), 0.1, 10);
  }
  // Retain every due subtitle until it has finished speaking. Playback can run
  // far ahead; the queue cursor, rather than playback, drives translation work.
  class NarrationQueue {
    constructor() { this.reset(0); }
    reset(position) { this.floor = position; this.pending = []; this.seen = new Set(); this.list = null; this.index = 0; }
    update(cues, position) {
      if (this.list !== cues) { this.list = cues; this.index = lowerBound(cues, this.floor - 0.05); }
      while (this.index < cues.length && cues[this.index].start <= position + 0.12) {
        const cue = cues[this.index++];
        if (!this.seen.has(cue.id)) { this.seen.add(cue.id); this.pending.push(cue); }
      }
    }
    get head() { return this.pending[0] || null; }
    finish(id) { if (this.head?.id === id) this.pending.shift(); }
  }
  class Scheduler {
    constructor({translate, onResult = () => {}, onError = () => {}, onReset = () => {}, concurrency = 2, maxCache = 1100}) {
      Object.assign(this, {translate, onResult, onError, onReset, concurrency, maxCache});
      this.cues = []; this.cache = new Map(); this.failures = new Map(); this.active = new Map();
      this.epoch = 0; this.enabled = false; this.latency = 1; this.lastPos = null; this.lastWall = null; this.cooldownUntil = 0;
      this.metrics = {translated: 0, failures: 0, aborted: 0}; this.settings = {...defaults};
    }
    setCues(cues, lang, translated = false) {
      this.invalidate(); this.cues = cues; this.lang = lang; this.translated = translated;
      this.cache.clear(); this.failures.clear(); this.lastPos = null; this.cooldownUntil = 0;
    }
    invalidate() {
      this.epoch++;
      for (const job of this.active.values()) job.controller.abort();
      this.metrics.aborted += this.active.size; this.active.clear();
      this.onReset();
    }
    stop() { this.enabled = false; this.invalidate(); }
    get(cue) { return this.translated ? cue.text : this.cache.get(cue.id); }
    put(cue, text) {
      this.cache.delete(cue.id); this.cache.set(cue.id, text);
      while (this.cache.size > this.maxCache) this.cache.delete(this.cache.keys().next().value);
    }
    horizon(rate) { return clamp(Math.max(this.settings.lookahead, this.latency * 12) * rate, 30, 300); }
    tick(position, rate = 1, wall = Date.now(), narrationPosition = null) {
      if (!this.enabled) return;
      if (this.lastPos !== null) {
        const expected = Math.max(0, (wall - this.lastWall) / 1000) * rate;
        if (position < this.lastPos - 0.8 || position > this.lastPos + expected + 5) this.invalidate();
      }
      this.lastPos = position; this.lastWall = wall;
      if (this.translated) return;
      const displayCue = this.settings.subtitle && this.settings.subtitleTiming === 'video' ? subtitleCue(this.cues, position, this.settings) : null;
      // Still detect seeks using the actual video clock, while preserving old
      // translations needed by an uninterrupted complete-reading queue.
      if (this.settings.syncMode === 'complete' && Number.isFinite(narrationPosition)) position = narrationPosition;
      const horizon = this.horizon(rate), end = position + horizon;
      // Release irrelevant requests immediately after a seek or window movement.
      for (const [id, job] of this.active) if ((job.cue.end < position - 2 || job.cue.start > end) && job.cue.id !== displayCue?.id) {
        job.controller.abort(); this.active.delete(id); this.metrics.aborted++;
      }
      if (wall < this.cooldownUntil) return;
      const first = lowerBound(this.cues, position);
      const prepare = cue => {
        if (!cue || this.active.size >= this.concurrency || this.cache.has(cue.id) || this.active.has(cue.id) || (this.failures.get(cue.id)?.next || 0) > wall) return;
        this.launch(cue, wall);
      };
      // Keep audio first, but also prepare an offset subtitle (or a current
      // video subtitle when complete narration is lagging far behind).
      if(this.cues[first]?.start<=end)prepare(this.cues[first]);
      prepare(displayCue);
      for (let i = first; i < this.cues.length && this.active.size < this.concurrency; i++) {
        const cue = this.cues[i];
        if (cue.start > end) break;
        if (this.cache.has(cue.id) || this.active.has(cue.id) || (this.failures.get(cue.id)?.next || 0) > wall) continue;
        this.launch(cue, wall);
      }
      for (const [id, failure] of this.failures) if (id !== displayCue?.id && (failure.cue.end < position - 120 || failure.cue.start > end + 120)) this.failures.delete(id);
    }
    launch(cue, wall) {
      const controller = new AbortController(), epoch = this.epoch;
      const job = {cue, controller}; this.active.set(cue.id, job);
      const started = Date.now();
      Promise.resolve().then(() => this.translate(cue, this.lang, controller.signal)).then(text => {
        if (controller.signal.aborted || epoch !== this.epoch) return;
        if (!text?.trim()) throw new Error('翻译结果为空');
        this.latency = this.latency * 0.75 + (Date.now() - started) / 1000 * 0.25;
        this.put(cue, text.trim()); this.failures.delete(cue.id); this.metrics.translated++;
        this.onResult(cue, text.trim());
      }).catch(error => {
        if (controller.signal.aborted || epoch !== this.epoch) return;
        const count = (this.failures.get(cue.id)?.count || 0) + 1;
        const delay = Math.max(Number(error.retryAfter) || 0, Math.min(60, 2 ** Math.min(count, 6))) * 1000;
        if (error.retryAfter) this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + delay);
        this.failures.set(cue.id, {cue, count, next: Math.max(wall, Date.now()) + delay});
        this.metrics.failures++; this.onError(error, cue, count);
      }).finally(() => { if (this.active.get(cue.id) === job) this.active.delete(cue.id); });
    }
    readySeconds(position) {
      let last = position;
      for (let i = lowerBound(this.cues, position); i < this.cues.length; i++) {
        const c = this.cues[i]; if (!this.get(c)) break; last = c.end;
      }
      return Math.max(0, last - position);
    }
  }
  const api = {clamp, clean, isChinese, videoId, parseJson3, parseVtt, parseCaptions, normalize, sentenceRanges, englishRanges, subtitlePages, translationInput, validatedAlignment, pageSource, speechParts, isAutomaticTrack, isAutomaticCapture, prepareCues, groupCues, lowerBound, chooseTrack, hash, defaults, subtitleFields, subtitleSettingKeys, playerSettingKeys, subtitlePresets, subtitleCue, sanitizeSettings, publicSettings, cacheKey, permissionOrigin, speechRate, NarrationQueue, Scheduler};
  root.DubCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
