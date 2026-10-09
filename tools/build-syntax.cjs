const path = require('node:path'), fs = require('node:fs');
const root = path.resolve(__dirname, '..'), target = path.join(root, 'YouTube中文同传/vendor');
fs.mkdirSync(target, {recursive: true});
require('esbuild').buildSync({entryPoints:[path.join(__dirname,'syntax-entry.cjs')],outfile:path.join(target,'syntax.js'),bundle:true,minify:true,platform:'browser',format:'iife',target:'chrome120',legalComments:'eof'});
for (const name of ['wink-nlp','wink-eng-lite-web-model']) {
  const directory = path.dirname(require.resolve(name + '/package.json'));
  const license = fs.readdirSync(directory).find(n=>/^licen[sc]e(?:\.md|\.txt)?$/i.test(n));
  if (!license) throw new Error('Missing license: ' + name);
  fs.copyFileSync(path.join(directory,license),path.join(target,name+'-LICENSE.txt'));
}
console.log('Local POS bundle:',fs.statSync(path.join(target,'syntax.js')).size,'bytes');
