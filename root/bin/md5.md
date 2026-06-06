---
name: md5
desc: compute an MD5 checksum — e.g. md5 hello
alias: md5sum
man: |
  # MD5(1)

  ## NAME
  md5 — compute an MD5 checksum

  ## SYNOPSIS
  md5 <text...>

  ## DESCRIPTION
  Computes the MD5 checksum of the given text (UTF-8 encoded) and prints
  it as lowercase hex, followed by " -" (as for standard input). The Web
  Crypto API has no MD5, so it is computed in JavaScript.

  MD5 is broken for security use (collisions are cheap) — it lives here as
  a checksum and as a companion to hashcat.

  ## EXAMPLES
  md5 hello
  md5 The quick brown fox

  ## SEE ALSO
  sha256sum, base64, hashcat
js: |
  const input = ctx.args.join(' ');
  if (!input) { ctx.error('usage: md5 <text>'); return; }
  // MD5 in pure JS (Web Crypto has no MD5). UTF-8 in, lowercase hex out.
  const SHIFT = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = [];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;

  const bytes = new TextEncoder().encode(input);
  const ml = bytes.length;
  // Pad: append 0x80, then zeros, then the 64-bit little-endian bit length.
  const total = (((ml + 8) >> 6) + 1) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[ml] = 0x80;
  const bitLen = ml * 8;
  buf[total - 8] = bitLen & 0xff;
  buf[total - 7] = (bitLen >>> 8) & 0xff;
  buf[total - 6] = (bitLen >>> 16) & 0xff;
  buf[total - 5] = (bitLen >>> 24) & 0xff;
  const hi = Math.floor(ml / 0x20000000); // high 32 bits of the bit length
  buf[total - 4] = hi & 0xff;
  buf[total - 3] = (hi >>> 8) & 0xff;
  buf[total - 2] = (hi >>> 16) & 0xff;
  buf[total - 1] = (hi >>> 24) & 0xff;

  let a0 = 0x67452301;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let j = 0; j < 16; j++) {
      const k = off + j * 4;
      M[j] = buf[k] | (buf[k + 1] << 8) | (buf[k + 2] << 16) | (buf[k + 3] << 24);
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
      else { f = c ^ (b | ~d); g = (7 * i) & 15; }
      f = (f + a + K[i] + M[g]) | 0;
      a = d;
      d = c;
      c = b;
      const s = SHIFT[i];
      b = (b + ((f << s) | (f >>> (32 - s)))) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  const le = (w) =>
    [w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff, (w >>> 24) & 0xff]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
  const hex = le(a0) + le(b0) + le(c0) + le(d0);
  ctx.append(`<div class="ln"><span class="accent">${hex}</span><span class="comment">  -</span></div>`);
---
