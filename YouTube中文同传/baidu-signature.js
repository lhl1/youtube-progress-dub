'use strict';

// RFC 1321. Baidu's API requires this digest, which Web Crypto doesn't expose.
const md5Constants = Array.from({length: 64}, (_, i) => Math.floor(2 ** 32 * Math.abs(Math.sin(i + 1))));
const md5Shifts = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]];

function baiduMd5(value) {
  const bytes = new TextEncoder().encode(value);
  const buffer = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  const padded = new DataView(buffer.buffer);
  padded.setBigUint64(buffer.length - 8, BigInt(bytes.length) * 8n, true);
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];

  for (let offset = 0; offset < buffer.length; offset += 64) {
    let [a, b, c, d] = state;
    for (let i = 0; i < 64; i++) {
      const round = i >>> 4;
      let mixed, word;
      switch (round) {
        case 0: mixed = (b & c) | (~b & d); word = i; break;
        case 1: mixed = (d & b) | (~d & c); word = (5 * i + 1) % 16; break;
        case 2: mixed = b ^ c ^ d; word = (3 * i + 5) % 16; break;
        default: mixed = c ^ (b | ~d); word = (7 * i) % 16;
      }
      const sum = (a + mixed + md5Constants[i] + padded.getUint32(offset + word * 4, true)) | 0;
      const shift = md5Shifts[round][i % 4];
      const rotated = (sum << shift) | (sum >>> (32 - shift));
      [a, b, c, d] = [d, (b + rotated) | 0, b, c];
    }
    [a, b, c, d].forEach((part, i) => { state[i] = (state[i] + part) | 0; });
  }
  const digest = new DataView(new ArrayBuffer(16));
  state.forEach((word, i) => digest.setUint32(i * 4, word, true));
  return Array.from(new Uint8Array(digest.buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}
