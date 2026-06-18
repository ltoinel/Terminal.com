---
name: motd
desc: message of the day (welcome banner)
man: |
  # MOTD(1)

  ## NAME
  motd — message of the day (welcome banner)

  ## SYNOPSIS
  motd

  ## DESCRIPTION
  Shows the welcome banner: the Lud'OS ASCII logo, a systemd-style boot
  sequence, the last-login date and a random quote. This is what the
  connection plays (see boot).

  ## EXAMPLES
  motd

  ## SEE ALSO
  boot
js: |
  const E = ctx.escape;
  // `.ascii-art` forces a block-capable monospace (see global.css) so the art aligns.
  const art = (t) => `<div class="ln ascii-art"><span class="accent text-glow">${E(t)}</span></div>`;
  const narrow = typeof window !== 'undefined' && window.innerWidth < 680;

  // systemd-style boot sequence.
  const ok = (msg) =>
    ctx.append(
      `<div class="ln"><span class="comment">[</span><span class="accent text-glow"> OK </span><span class="comment">] ${E(msg)}</span></div>`,
    );
  const steps = [
    'Lud\'OS 1.0 kernel loaded',
    `${ctx.commands.length} commands mounted on /bin`,
    'Encrypted LTS link established',
    'CRT theme calibrated · glow nominal',
    'Coffee: brewing ☕',
  ];
  for (const s of steps) {
    ok(s);
    await ctx.sleep(55);
  }
  ctx.line('');

  // Last login: persisted in localStorage → we show the PREVIOUS session (like a
  // real `last login`), then record the current one.
  const LL_KEY = 'ltsh.lastlogin';
  let prev = null;
  try {
    prev = JSON.parse(localStorage.getItem(LL_KEY) || 'null');
  } catch {
    /* localStorage unavailable / corrupt value */
  }
  if (prev && prev.date) {
    const when = new Date(prev.date).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const from = prev.ip ? ` from ${E(prev.ip)}` : '';
    ctx.append(`<div class="ln comment">Last login: ${E(when)}${from}</div>`);
  } else {
    ctx.append('<div class="ln comment">First connection — welcome. 👋</div>');
  }
  // Record the current session. The date is set right away; the real IP is fetched
  // in the background (fire-and-forget) and patched in for next time.
  try {
    localStorage.setItem(LL_KEY, JSON.stringify({ date: Date.now(), ip: null }));
    fetch('https://api64.ipify.org?format=json', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const cur = JSON.parse(localStorage.getItem(LL_KEY) || 'null');
        if (cur && d && d.ip) {
          cur.ip = d.ip;
          localStorage.setItem(LL_KEY, JSON.stringify(cur));
        }
      })
      .catch(() => {
        /* offline / blocked: keep the date without an IP */
      });
  } catch {
    /* localStorage unavailable */
  }

  // Random fortune (backticks become code via the inline renderer).
  const fortunes = [
    "There's no place like `127.0.0.1`.",
    'When in doubt: `man`, then coffee.',
    '99 little bugs in the code… `127` little bugs in the code.',
    "The best code is the code you don't have to write.",
    '`sudo` make me a sandwich.',
    'The drone is ready. So is the sky.',
    "There are 10 kinds of people: those who read binary and those who don't.",
  ];
  ctx.line('');
  ctx.line('☞ ' + fortunes[Math.floor(Math.random() * fortunes.length)]);
  ctx.line('');

  // Quick start.
  ctx.line('→ `help` lists everything · `whoami` who am I · `ls` explore');
---
