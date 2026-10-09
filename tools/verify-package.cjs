const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const os = require('node:os');
const {chromium} = require('playwright');
const currentManifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../YouTube中文同传/manifest.json')));
const core=require('../YouTube中文同传/core.js');
const archive = path.resolve(__dirname, `../dist/YouTube中文同传-v${currentManifest.version}.zip`);
const crx = fs.readFileSync(archive.replace(/\.zip$/, '.crx'));
function decode(bytes) {
  let pos = 0; const fields = new Map();
  function read() { let n = 0, shift = 0, b; do { b = bytes[pos++]; n += (b & 127) * 2 ** shift; shift += 7; } while (b & 128); return n; }
  while (pos < bytes.length) { const tag = read(); assert.equal(tag & 7, 2); const length = read(); fields.set(tag >>> 3, bytes.subarray(pos, pos + length)); pos += length; }
  return fields;
}
assert.equal(crx.subarray(0, 4).toString(), 'Cr24'); assert.equal(crx.readUInt32LE(4), 3);
const headerLength = crx.readUInt32LE(8), fields = decode(crx.subarray(12, 12 + headerLength));
const proof = decode(fields.get(2)), signed = fields.get(10000), zip = crx.subarray(12 + headerLength);
assert.deepEqual(zip, fs.readFileSync(archive));
const len = Buffer.alloc(4); len.writeUInt32LE(signed.length);
const payload = Buffer.concat([Buffer.from('CRX3 SignedData\0'), len, signed, zip]);
assert.ok(crypto.verify('sha256', payload, crypto.createPublicKey({key: proof.get(1), type: 'spki', format: 'der'}), proof.get(2)));
assert.deepEqual(decode(signed).get(1), crypto.createHash('sha256').update(proof.get(1)).digest().subarray(0, 16));
const unpacked = process.argv[2];
if (!unpacked) throw new Error('Pass a freshly extracted ZIP directory');
const manifest = JSON.parse(fs.readFileSync(path.join(unpacked, 'manifest.json')));
assert.equal(manifest.key, proof.get(1).toString('base64'));
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dub-package-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${unpacked}`, `--load-extension=${unpacked}`, '--no-first-run']
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const metadata = await worker.evaluate(() => ({manifest: chrome.runtime.getManifest(), id: chrome.runtime.id}));
    const expectedId = [...decode(signed).get(1)].map(b => String.fromCharCode(97 + (b >>> 4), 97 + (b & 15))).join('');
    assert.equal(metadata.id, expectedId); assert.equal(metadata.manifest.version, currentManifest.version);
    const page = await context.newPage(); await page.goto(`chrome-extension://${metadata.id}/options.html`);
    const settings = await page.evaluate(async () => chrome.runtime.sendMessage({type: 'GET_SETTINGS'})); assert.equal(settings.ok, true);
    assert.deepEqual(settings.data,core.sanitizeSettings(core.defaults));
    const controls=async()=>page.evaluate(keys=>Object.fromEntries(keys.map(key=>{
      const e=document.getElementById(key);return [key,e.type==='checkbox'?e.checked:e.type==='range'?Number(e.value):e.value];
    })),core.playerSettingKeys);
    const expected=Object.fromEntries(core.playerSettingKeys.map(key=>[key,core.defaults[key]]));
    await page.waitForFunction(rate=>Number(document.getElementById('rate').value)===rate,core.defaults.rate);
    assert.deepEqual(await controls(),expected);
    await page.evaluate(async()=>chrome.runtime.sendMessage({type:'SAVE_SETTINGS',settings:{rate:1.7,subtitleSize:1.8,autoStart:false,originalVolume:.4}}));
    await page.reload();await page.waitForFunction(()=>Number(document.getElementById('rate').value)===1.7);
    await page.locator('#reset').click();assert.deepEqual(await controls(),expected);
    await page.locator('button[type=submit]').click();await page.waitForFunction(()=>document.getElementById('message').textContent.includes('已保存'));
    const restored=await page.evaluate(async()=>chrome.runtime.sendMessage({type:'GET_SETTINGS'}));
    assert.deepEqual(restored.data,core.sanitizeSettings(core.defaults));
    const result = {version:metadata.manifest.version,zipBytes: zip.length, crxBytes: crx.length, rsaSignature: true, payloadMatchesZip: true, keyMatchesManifest: true, edgeLoadedExtractedPackage: true, extensionId: metadata.id, defaultSettingsRead: true,defaultSettingsMatch:true,defaultControlsMatch:true,restoreDefaultsSaved:true};
    fs.writeFileSync(path.resolve(__dirname, '../dist/package-verification.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await context.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
