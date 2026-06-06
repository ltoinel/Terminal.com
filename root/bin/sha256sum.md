---
name: sha256sum
desc: compute a SHA-256 checksum — e.g. sha256sum hello
man: |
  # SHA256SUM(1)

  ## NAME
  sha256sum — compute a SHA-256 checksum

  ## SYNOPSIS
  sha256sum <text...>

  ## DESCRIPTION
  Computes the SHA-256 checksum of the given text (UTF-8 encoded) via
  the Web Crypto API and prints it as lowercase hex, followed by " -"
  (as for standard input).

  ## EXAMPLES
  sha256sum hello

  ## SEE ALSO
  md5, base64
js: |
  const input = ctx.args.join(' ');
  if (!input) { ctx.error('usage: sha256sum <text>'); return; }
  // Hash the UTF-8 bytes via the Web Crypto API, then render as lowercase hex.
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Mirror the real `sha256sum` layout: "<hash>  -" (the dash means stdin).
  ctx.append(`<div class="ln"><span class="accent">${hex}</span><span class="comment">  -</span></div>`);
---
