const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const input = process.argv[2];
if (!input) throw new Error('Usage: node sign-crx.cjs extension.zip');
const keyPath = process.env.DUB_SIGNING_KEY ? path.resolve(process.env.DUB_SIGNING_KEY) : path.join(__dirname, 'local-signing-key.pem');
if (process.env.DUB_SIGNING_KEY && !fs.existsSync(keyPath)) throw new Error('DUB_SIGNING_KEY must point to an existing private signing key.');
let key;
if (fs.existsSync(keyPath)) key = crypto.createPrivateKey(fs.readFileSync(keyPath));
else { key = crypto.generateKeyPairSync('rsa', {modulusLength: 2048}).privateKey; fs.writeFileSync(keyPath, key.export({type: 'pkcs8', format: 'pem'})); }
const pub = crypto.createPublicKey(key).export({type: 'spki', format: 'der'});
if (input === '--prepare') {
  const manifestPath = path.resolve(__dirname, '../YouTube中文同传/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); manifest.key = pub.toString('base64');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('Stable extension public key added to manifest.'); process.exit(0);
}
function varint(n) { const bytes = []; do { const b = n & 127; n = Math.floor(n / 128); bytes.push(b | (n ? 128 : 0)); } while (n); return Buffer.from(bytes); }
function field(n, bytes) { return Buffer.concat([varint(n * 8 + 2), varint(bytes.length), bytes]); }
const signedData = field(1, crypto.createHash('sha256').update(pub).digest().subarray(0, 16));
const length = Buffer.alloc(4); length.writeUInt32LE(signedData.length);
const zip = fs.readFileSync(input);
const payload = Buffer.concat([Buffer.from('CRX3 SignedData\0'), length, signedData, zip]);
const signature = crypto.sign('sha256', payload, key);
assert.ok(crypto.verify('sha256', payload, crypto.createPublicKey(key), signature));
const header = Buffer.concat([field(2, Buffer.concat([field(1, pub), field(2, signature)])), field(10000, signedData)]);
const prefix = Buffer.alloc(12); prefix.write('Cr24'); prefix.writeUInt32LE(3, 4); prefix.writeUInt32LE(header.length, 8);
const target = input.replace(/\.zip$/i, '.crx'); fs.writeFileSync(target, Buffer.concat([prefix, header, zip]));
console.log('CRX3 signed; RSA signature verified. Private signing key remains outside the distribution.');
