---
name: qr
desc: render text or a URL as a QR code — e.g. qr https://ludovic.toinel.com
man: |
  # QR(1)

  ## NAME
  qr — render text or a URL as a QR code

  ## SYNOPSIS
  qr <text|url>

  ## DESCRIPTION
  Encodes the given text (everything after the command) as a QR code
  and renders it inline as black-on-white blocks, with the standard
  quiet zone so it scans reliably.

  The code is generated entirely in your browser (a self-hosted
  encoder) — nothing is sent anywhere.

  ## EXAMPLES
  qr https://ludovic.toinel.com
  qr WIFI:T:WPA;S:MyNetwork;P:secret;;

  ## SEE ALSO
  open, base64
js: |
  const text = ctx.args.join(' ').trim();
  if (!text) {
    ctx.error('usage: qr <text|url>');
    return;
  }

  // Self-hosted ESM encoder (qrcode-generator), served from our own origin so
  // `script-src 'self'` allows it; loaded on demand like the webllm engine.
  let qrcode;
  try {
    qrcode = (await import('/vendor/qrcode-generator-1.4.4.js')).default;
  } catch {
    ctx.error('qr: could not load the QR encoder');
    return;
  }

  let qr;
  try {
    qr = qrcode(0, 'M'); // type 0 = auto-size, medium error correction
    qr.addData(text);
    qr.make();
  } catch {
    ctx.error('qr: text is too long to encode');
    return;
  }

  // Render two module-rows per text line with half-block glyphs, on a white card
  // with black ink so any scanner reads it. A 4-module quiet zone frames it.
  const n = qr.getModuleCount();
  const QUIET = 4;
  const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c);
  let out = '';
  for (let r = -QUIET; r < n + QUIET; r += 2) {
    for (let c = -QUIET; c < n + QUIET; c++) {
      const top = dark(r, c);
      const bot = dark(r + 1, c);
      out += top && bot ? '█' : top ? '▀' : bot ? '▄' : ' ';
    }
    out += '\n';
  }

  ctx.append(
    `<div class="ln"><pre style="display:inline-block;margin:.4rem 0;padding:12px;` +
      `background:#fff;color:#000;line-height:1;border-radius:6px;font-family:monospace;` +
      `white-space:pre">${ctx.escape(out)}</pre></div>`,
  );
---
