---
name: uuid
desc: generate a random UUID (v4) — e.g. uuid 5
man: |
  # UUID(1)

  ## NAME
  uuid — generate random UUIDs

  ## SYNOPSIS
  uuid [count]

  ## DESCRIPTION
  Generates one or more version-4 (random) UUIDs using the browser's
  cryptographically secure random source. The optional count defaults
  to 1 and is capped at 64.

  ## EXAMPLES
  uuid
  uuid 5

  ## SEE ALSO
  sha256sum, base64
js: |
  const n = Math.min(Math.max(parseInt(ctx.args[0], 10) || 1, 1), 64);
  // Prefer the native generator; fall back to a getRandomValues-based v4.
  const gen = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
  for (let i = 0; i < n; i++) ctx.line(gen());
---
