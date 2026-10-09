/* Compare exact source retention and display boundaries, optionally observing
 * the real default translator. --live sends only the public examples below.
 * --baseline FILE accepts a prior core.js, without importing private files.
 * Translation output is observational; this is not a BLEU/human quality score. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os');
require('../YouTube中文同传/vendor/syntax.js');
const C=require('../YouTube中文同传/core.js'),root=path.resolve(__dirname,'..');
const examples=[
  {name:'direct-object-and-how',text:'the reason I wanted to share this story is that it shows how easily we can forget the people who helped us when we were young'},
  {name:'reported-complement',text:'the company that makes these devices says the battery lasts much longer than the previous one'},
  {name:'reported-belief-and-cause',text:'he told me that the villagers left their homes because they believed the bridge would collapse and they would lose everything'},
  {name:'until-real-memories',text:'When you stop playing it for so long you kind of forget about it until you see it like physically in front of your face. Yeah. Seeing the stuff in person can bring back real memories.'},
  {name:'netflix-screenshot',text:require('../tests/fixtures/netflix.cjs').text}
];
const chineseExamples=[
  '直到你亲眼看到这些熟悉的东西出现在面前，才会重新想起那些真实的回忆。',
  '如果你把左边这张图片和右边那张图片仔细对照，就会发现房间已经变了。',
  '后来我发现，这家公司声称电池续航更长，但独立测试得出了不同的结果。'
];
async function main(){
  let browser,worker;
  if(process.argv.includes('--edge')&&process.argv.includes('--live')){
    const {chromium}=require('playwright');
    browser=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'dub-evaluate-')),{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${path.join(root,'YouTube中文同传')}`,`--load-extension=${path.join(root,'YouTube中文同传')}`,'--no-first-run']});
    worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
  }
  try{
  let baseline;
  const at=process.argv.indexOf('--baseline');
  if(at>=0){const context=vm.createContext({DubSyntax:globalThis.DubSyntax,Intl,URL,console});vm.runInContext(fs.readFileSync(process.argv[at+1],'utf8'),context);baseline=context.DubCore;}
  const result={version:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,liveRequested:process.argv.includes('--live'),scope:'Public illustrative samples, not a general translation-quality benchmark',examples:[],chinesePages:[]};
  for(const sample of examples){
    const rows=[{start:0,end:30,text:sample.text}],cues=C.prepareCues(rows,{automatic:true,language:'en'});
    if(cues.map(c=>c.text).join(' ')!==sample.text)throw new Error('Lost source text: '+sample.name);
    const observed={...sample,previousUnits:baseline?.prepareCues(rows,{automatic:true,language:'en'}).map(c=>c.text),units:cues.map(c=>c.text),translationInput:cues.map(c=>C.translationInput(c,'en'))};
    if(result.liveRequested){
      observed.actualTranslations=[];
      for(const text of observed.translationInput){
        try{
          const get=async text=>{const q=new URLSearchParams({client:'gtx',sl:'en',tl:'zh-CN',dt:'t',q:text});const r=await fetch('https://translate.googleapis.com/translate_a/single?'+q,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();};
          const d=worker?await worker.evaluate(get,text):await get(text),translated=d?.[0]?.map(p=>p[0]).join('');
          observed.actualTranslations.push({input:text,text:translated,pages:C.subtitlePages(translated,48).map(p=>p.text)});
        }catch(e){observed.actualTranslations.push({input:text,error:e.message});}
      }
    }
    result.examples.push(observed);
  }
  for(const text of chineseExamples)result.chinesePages.push({text,previousPages:baseline?.subtitlePages(text,24).map(p=>p.text),pages:C.subtitlePages(text,24).map(p=>p.text)});
  const long=('直到你亲眼看到这些熟悉的东西出现在面前，才会重新想起那些真实的回忆。').repeat(200),start=performance.now(),pages=C.subtitlePages(long,48);
  if(pages.map(p=>p.text).join('')!==long)throw new Error('Lost long Chinese text');
  result.longDisplay={characters:long.length,pages:pages.length,elapsedMs:Math.round((performance.now()-start)*100)/100};
  fs.mkdirSync(path.join(root,'dist'),{recursive:true});
  fs.writeFileSync(path.join(root,'dist/asr-redesign-report.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({version:result.version,sourceSamples:result.examples.length,realTranslations:result.examples.flatMap(e=>e.actualTranslations||[]).filter(t=>t.text).length,serviceFailures:result.examples.flatMap(e=>e.actualTranslations||[]).filter(t=>t.error).length,longDisplay:result.longDisplay},null,2));
  }finally{await browser?.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
