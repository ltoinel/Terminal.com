---
name: motd
desc: message du jour (bannière d'accueil)
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
  boot, neofetch
js: |
  const E = ctx.escape;
  // `.ascii-art` forces a block-capable monospace (see global.css) so the art aligns.
  const art = (t) => `<div class="ln ascii-art"><span class="accent text-glow">${E(t)}</span></div>`;
  const narrow = typeof window !== 'undefined' && window.innerWidth < 680;

  // Bannière « Lud'OS » (figlet bloody) — look glitch/CRT ; nécessite .ascii-art.
  const banner = [
    '  ',
    '  ',
    ' ██▓     █    ██ ▓█████▄ ██▓ ▒█████    ██████',
    '▓██▒     ██  ▓██▒▒██▀ ██▌▓█▒▒██▒  ██▒▒██    ▒',
    '▒██░    ▓██  ▒██░░██   █▌░▓░▒██░  ██▒░ ▓██▄',
    '▒██░    ▓▓█  ░██░░▓█▄   ▌ ▒ ▒██   ██░  ▒   ██▒',
    '░██████▒▒▒█████▓ ░▒████▓  ░ ░ ████▓▒░▒██████▒▒',
    '░ ▒░▓  ░░▒▓▒ ▒ ▒  ▒▒▓  ▒    ░ ▒░▒░▒░ ▒ ▒▓▒ ▒ ░',
    '░ ░ ▒  ░░░▒░ ░ ░  ░ ▒  ▒      ░ ▒ ▒░ ░ ░▒  ░ ░',
    '  ░ ░    ░░░ ░ ░  ░ ░  ░    ░ ░ ░ ▒  ░  ░  ░',
    '    ░  ░   ░        ░           ░ ░        ░',
    '                  ░',
  ];
  if (narrow) {
    ctx.append(`<div class="ln ascii-art"><span class="accent text-glow">░▒▓ Lud'OS ▓▒░</span></div>`);
  } else {
    for (const l of banner) {
      ctx.append(art(l));
      await ctx.sleep(40);
    }
  }

  ctx.append(
    '<div class="ln">' +
      '<span class="prompt-path">Architecte Fullstack</span><span class="comment"> · </span>' +
      '<span class="prompt-path">Hacker Ethique</span><span class="comment"> · </span>' +
      '<span class="prompt-path">Photographe</span><span class="comment"> · </span>' +
      '<span class="prompt-path">Pilote de drones</span></div>',
      '<span class="prompt-path">Blogueur</span></div>',
  );
  ctx.line('');

  // Séquence de boot façon systemd.
  const ok = (msg) =>
    ctx.append(
      `<div class="ln"><span class="comment">[</span><span class="accent text-glow"> OK </span><span class="comment">] ${E(msg)}</span></div>`,
    );
  const steps = [
    'noyau phosphor 1.0 chargé',
    `${ctx.commands.length} commandes montées sur /bin`,
    'liaison SSH chiffrée (ED25519) établie',
    'thème CRT calibré · glow nominal',
    'café : infusion en cours ☕',
  ];
  for (const s of steps) {
    ok(s);
    await ctx.sleep(55);
  }
  ctx.line('');

  // Dernière connexion : persistée en localStorage → on affiche la session
  // PRÉCÉDENTE (comme un vrai « last login »), puis on enregistre la session courante.
  const LL_KEY = 'ltsh.lastlogin';
  let prev = null;
  try {
    prev = JSON.parse(localStorage.getItem(LL_KEY) || 'null');
  } catch {
    /* localStorage indisponible / valeur corrompue */
  }
  if (prev && prev.date) {
    const when = new Date(prev.date).toLocaleString('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const from = prev.ip ? ` depuis ${E(prev.ip)}` : '';
    ctx.append(`<div class="ln comment">Dernière connexion : ${E(when)}${from}</div>`);
  } else {
    ctx.append('<div class="ln comment">Première connexion — bienvenue. 👋</div>');
  }
  // Enregistre la session courante. La date est posée tout de suite ; l'IP réelle
  // est récupérée en arrière-plan (fire-and-forget) et patchée pour la prochaine fois.
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
        /* hors-ligne / bloqué : on garde la date sans IP */
      });
  } catch {
    /* localStorage indisponible */
  }

  // Fortune aléatoire (les backticks deviennent du code via le rendu inline).
  const fortunes = [
    "There's no place like `127.0.0.1`.",
    'En cas de doute : `man`, puis café.',
    '99 little bugs in the code… `127` little bugs in the code.',
    "Le meilleur code est celui qu'on n'a pas à écrire.",
    '`sudo` make me a sandwich.',
    'Le drone est prêt. Le ciel aussi.',
    'Il y a 10 types de gens : ceux qui lisent le binaire et les autres.',
  ];
  ctx.line('');
  ctx.line('☞ ' + fortunes[Math.floor(Math.random() * fortunes.length)]);
  ctx.line('');

  // Démarrage rapide.
  ctx.line('→ `help` liste tout · `whoami` qui suis-je · `ls` explore · `su` ⚡');
---
