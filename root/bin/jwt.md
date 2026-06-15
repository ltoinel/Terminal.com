---
name: jwt
desc: decode a JSON Web Token — e.g. jwt <token>
man: |
  # JWT(1)

  ## NAME
  jwt — decode a JSON Web Token

  ## SYNOPSIS
  jwt <token>

  ## DESCRIPTION
  Decodes a JWT and prints its header and payload as formatted JSON,
  then a readable view of the standard time claims (iat, nbf, exp) and
  whether the token has expired.

  Decoding happens entirely in your browser: the signature is NOT
  verified and nothing is sent anywhere.

  ## EXAMPLES
  jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.xxxxx

  ## SEE ALSO
  base64, sha256sum
js: |
  const token = (ctx.args[0] || '').trim();
  if (!token) {
    ctx.error('usage: jwt <token>');
    return;
  }
  const parts = token.split('.');
  if (parts.length < 2) {
    ctx.error('jwt: not a valid token (expected header.payload.signature)');
    return;
  }

  // base64url segment -> parsed JSON (UTF-8 safe via TextDecoder).
  const decode = (seg) => {
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  };

  const show = (label, obj) => {
    ctx.append(`<div class="ln"><span class="accent">${ctx.escape(label)}</span></div>`);
    for (const line of JSON.stringify(obj, null, 2).split('\n'))
      ctx.append(`<div class="ln out" style="white-space:pre-wrap">${ctx.escape(line)}</div>`);
  };

  try {
    show('HEADER', decode(parts[0]));
    ctx.line('');
    const payload = decode(parts[1]);
    show('PAYLOAD', payload);

    // Standard time claims (seconds since the epoch) -> readable UTC.
    const fmt = (t) => new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const claims = [];
    if (payload.iat) claims.push(`issued     ${fmt(payload.iat)}`);
    if (payload.nbf) claims.push(`not before ${fmt(payload.nbf)}`);
    if (payload.exp) claims.push(`expires    ${fmt(payload.exp)}`);
    if (claims.length) {
      ctx.line('');
      for (const c of claims) ctx.line(c);
    }
    if (payload.exp) {
      const expired = Date.now() / 1000 > payload.exp;
      ctx.append(
        `<div class="ln"><span style="color:${expired ? '#ff6b6b' : '#2bbf6a'}">${
          expired ? '✗ token expired' : '✓ token still valid'
        }</span></div>`,
      );
    }
  } catch (e) {
    ctx.error(`jwt: could not decode (${e.message || 'malformed token'})`);
  }
---
