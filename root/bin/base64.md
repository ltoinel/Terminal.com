---
name: base64
desc: encode/decode base64 — e.g. base64 hello, base64 -d aGVsbG8=
man: |
  # BASE64(1)

  ## NAME
  base64 — encode or decode base64

  ## SYNOPSIS
  base64 [-d] <text...>

  ## DESCRIPTION
  Encodes the given <text> to base64, or decodes it with -d. Encoding
  is UTF-8 aware: accented characters survive an encode → decode
  round-trip.

  ## OPTIONS
  -d, --decode   decode the input instead of encoding it

  ## EXAMPLES
  base64 hello
  base64 -d aGVsbG8=

  ## SEE ALSO
  sha256sum, echo
js: |
  // `-d` / `--decode` flips to decoding; everything else is the payload.
  const decode = ctx.args[0] === '-d' || ctx.args[0] === '--decode';
  const input = (decode ? ctx.args.slice(1) : ctx.args).join(' ');
  if (!input) { ctx.error('usage: base64 [-d] <text>'); return; }
  try {
    if (decode) {
      // atob -> latin1 bytes -> UTF-8 string (so accents survive a round-trip).
      const bin = atob(input.replace(/\s+/g, ''));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      ctx.raw(new TextDecoder().decode(bytes));
    } else {
      // UTF-8 bytes -> latin1 string -> btoa (btoa alone chokes on non-ASCII).
      const bytes = new TextEncoder().encode(input);
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      ctx.raw(btoa(bin));
    }
  } catch (e) {
    ctx.error(`base64: invalid input (${e.name || 'error'})`);
  }
---
