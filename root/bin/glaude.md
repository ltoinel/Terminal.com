---
name: glaude
desc: fabrique des sites web hideux et flashy avec un LLM local (WebGPU) — façon Claude Code, par "le Glaude"
alias: soupe
man: |
  # GLAUDE(1)

  ## NAME
  glaude — un atelier de création de sites web (volontairement laids et
  flashy) façon Claude Code, incarné par "le Glaude" du film *La Soupe aux Choux*

  ## SYNOPSIS
  glaude
  glaude --list
  glaude <number>
  glaude <model-id>
  glaude --unload

  ## DESCRIPTION
  glaude est un clin d'œil à Claude Code : l'allure (bannière, boîte d'accueil,
  invite ›) mais piloté par un LLM de *coding* open-source qui tourne
  entièrement dans le navigateur — aucun serveur, aucun appel réseau pour
  l'inférence. Le moteur (chargement, cache, GPU) est géré par le module LLM
  central (voir `llm` et le widget en haut à droite) ; glaude partage le modèle
  résident avec miaougpt et denree.

  Sa spécialité : pondre des **sites HTML horriblement laids et flashy** —
  fonds fluo, dégradés arc-en-ciel, Comic Sans, <marquee> qui défilent, texte
  qui clignote, emojis partout. Bref, l'esthétique GeoCities de 1997.

  Par défaut aucun modèle n'est chargé : glaude te propose un modèle de code et
  te demande de confirmer son téléchargement (sauf si un modèle est déjà chaud).

  Au lancement, glaude affiche "la Denrée" (l'extraterrestre du film) en ASCII
  art, puis — comme Claude Code amorce un projet — il **propose un nom de
  projet et son emplacement** dans ton système de fichiers
  (/home/guest/<projet>). Tu valides, glaude crée le dossier, y écrit un
  index.html de départ (bien moche) et s'y place.

  Décris ensuite la page voulue : le Glaude répond avec un document HTML
  complet. /save l'écrit dans le projet (persisté dans le navigateur), et
  /show ouvre un faux navigateur pour admirer le carnage.

  ## OPTIONS
  --list, -l        liste les modèles de code conseillés
  --unload, --stop  libère le modèle chargé de la mémoire GPU

  ## CHAT COMMANDS
  /show [fichier]   ouvre un faux navigateur sur le rendu (défaut index.html)
  /save [fichier]   écrit la dernière page générée dans le projet
  /download /zip    télécharge tout le projet dans une archive .zip
  /files /ls        liste les fichiers du projet
  /project /pwd     rappelle le projet et son chemin
  /reset /clear     oublie le contexte (garde le projet et le modèle)
  /model            affiche le modèle chargé
  /exit /quit /bye  ferme la session
  /help             liste ces commandes

  ## EXAMPLES
  glaude
  glaude 1
  glaude Qwen2.5-Coder-3B
  glaude --unload

  ## SEE ALSO
  llm, miaougpt, denree, mkdir, touch, ls
js: |
  // glaude — une parodie de Claude Code propulsée par le module LLM central
  // (ctx.llm), spécialisée dans la fabrication de sites HTML hideux et flashy.
  // Au lancement elle amorce un projet sous /home/guest/<projet>, puis ouvre une
  // session où "le Glaude" génère des pages. Le chargement du modèle, le cache
  // et le comptage des tokens sont gérés par le manager unique (src/lib/llm.ts).
  const E = ctx.escape;
  const args = ctx.args.slice();
  const first = args[0];

  // Modèles de code conseillés (du plus petit au plus gros). `base` = id sans le
  // suffixe de quantification ; le bon build est choisi par le manager central.
  const RECOMMENDED = [
    { label: 'Qwen2.5-Coder 0.5B', base: 'Qwen2.5-Coder-0.5B-Instruct', gb: 0.9 },
    { label: 'Qwen2.5-Coder 1.5B', base: 'Qwen2.5-Coder-1.5B-Instruct', gb: 1.9 },
    { label: 'Qwen2.5-Coder 3B',   base: 'Qwen2.5-Coder-3B-Instruct',   gb: 3.3 },
    { label: 'Qwen2.5-Coder 7B',   base: 'Qwen2.5-Coder-7B-Instruct',   gb: 8.1 },
  ];
  const DEFAULT = { base: 'Qwen2.5-Coder-1.5B-Instruct', label: 'Qwen2.5-Coder 1.5B', gb: 1.9 };

  // ---- glaude --unload : libère le modèle résident ----
  if (first === '--unload' || first === '--stop') {
    const freed = await ctx.llm.unload();
    ctx.line(freed ? 'glaude: modèle déchargé, mémoire GPU libérée.' : 'glaude: aucun modèle chargé.');
    return;
  }

  // ---- "la Denrée" en pixel-art coloré (l'extraterrestre de La Soupe aux Choux) ----
  const PAL = { R: '#e23b2e', D: '#a82018', B: '#e9c277', N: '#6e4a2b', W: '#ffffff', o: '#2a2a2a' };
  const PIXES = [
    "       RRRRRR       ",
    "      RRRRRRRR      ",
    "      DRRRRRRD      ",
    "      BBBBBBBB      ",
    "...RR.BBBBBBBB.RR...",
    ".DRRRRBBBBBBBBRRRRD.",
    ".DRRRRBNNBBNNBRRRRD.",
    ".DRRRRBWoBBoWBRRRRD.",
    "...RR.BBBNNBBB.RR...",
    ".......BBBooBBB.....",
    ".......BBBBBB.......",
    "..RRRRBBBBBBBBRRRR..",
    "DRRRRRBBBBBBBBRRRRRD",
    "..RRR.BBBBBBBB.RRR..",
    "....BBBBBBBBBBBB....",
    ".....BBBBBBBBBB.....",
    "......BBBBBBBB......",
  ];
  const blocksRow = (row) => {
    let html = '';
    for (let i = 0; i < row.length; ) {
      const ch = row[i];
      let j = i;
      while (j < row.length && row[j] === ch) j++;
      const n = j - i;
      if (ch === '.' || ch === ' ') html += '  '.repeat(n);
      else html += '<span style="color:' + (PAL[ch] || '#888') + '">' + '██'.repeat(n) + '</span>';
      i = j;
    }
    return '<div class="ln ascii-art">' + html + '</div>';
  };
  const narrow = typeof window !== 'undefined' && window.innerWidth < 680;
  if (narrow) {
    ctx.append('<div class="ln ascii-art"><span class="accent text-glow">░▒▓ la Denrée ▓▒░</span></div>');
  } else {
    for (const l of PIXES) { ctx.append(blocksRow(l)); await ctx.sleep(28); }
  }
  ctx.line('');

  // Boîte d'accueil façon Claude Code.
  const box = (t) => '<div class="ln ascii-art"><span class="accent">' + E(t) + '</span></div>';
  ctx.append(box('╭──────────────────────────────────────────────╮'));
  ctx.append('<div class="ln ascii-art"><span class="accent">│ </span><span class="accent text-glow">✻</span><span class="accent"> Bienvenue dans Glaude Code                 │</span></div>');
  ctx.append(box('│                                              │'));
  ctx.append(box('│   le pire webmaster du Bourbonnais 🥬        │'));
  ctx.append(box('│   /help · /show pour admirer · /exit         │'));
  ctx.append(box('╰──────────────────────────────────────────────╯'));
  ctx.line('');

  // ---- liste des modèles (pas besoin de WebGPU) ----
  if (first === '--list' || first === '-l') {
    ctx.line('Modèles de code conseillés (du plus petit au plus gros) :');
    ctx.line('');
    RECOMMENDED.forEach((r, i) => {
      ctx.append(
        '<div class="ln out"><span class="accent">' + (i + 1) + ')</span> ' +
        '<span class="cmd">' + E(r.label) + '</span> ' +
        '<span class="comment">≈ ' + E(r.gb.toFixed(1)) + ' Go</span></div>',
      );
    });
    ctx.line('');
    ctx.line('Démarre :  glaude <numéro>   (ex. glaude 1)   ·   tous les modèles : `llm --list-all`');
    return;
  }

  // ---- petits utilitaires fichiers ----
  const slugify = (s) =>
    (s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 48);
  const fileName = (s, def) => {
    let f = slugify(s) || def;
    if (!/\.[a-z0-9]+$/.test(f)) f += '.html';
    return f;
  };
  const extractHtml = (text) => {
    if (!text) return '';
    let m = text.match(/```html\s*([\s\S]*?)```/i);
    if (m) return m[1].trim();
    m = text.match(/```\s*([\s\S]*?)```/);
    if (m && /<[a-z!]/i.test(m[1])) return m[1].trim();
    if (/<!doctype|<html|<body|<div|<h1|<marquee/i.test(text)) return text.trim();
    return '';
  };

  // ---- faux navigateur : affiche le HTML rendu dans une fenêtre dédiée ----
  const openBrowser = (url, html) => {
    if (!document.getElementById('glb-style')) {
      const st = document.createElement('style');
      st.id = 'glb-style';
      st.textContent =
        '.glb-back{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9997}' +
        '.glb-win{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
        'width:min(900px,92vw);height:min(78vh,680px);min-width:320px;min-height:240px;' +
        'background:#c9d2da;border:1px solid #2a2f36;border-radius:8px;display:flex;' +
        'flex-direction:column;overflow:hidden;resize:both;z-index:9998;' +
        'box-shadow:0 40px 90px -30px rgba(0,0,0,.85)}' +
        '.glb-bar{display:flex;align-items:center;gap:.6rem;padding:.45rem .6rem;' +
        'background:linear-gradient(#eef2f6,#d3dbe2);border-bottom:1px solid #9aa4ad;' +
        'font:13px/1.2 system-ui,sans-serif;color:#333}' +
        '.glb-dots{display:flex;gap:.4rem}.glb-dots i{width:11px;height:11px;border-radius:50%;' +
        'display:inline-block;border:1px solid rgba(0,0,0,.25)}' +
        '.glb-nav{border:1px solid #9aa4ad;background:#fafcff;border-radius:5px;cursor:pointer;' +
        'font-size:14px;line-height:1;padding:2px 7px;color:#333}.glb-nav:hover{background:#fff}' +
        '.glb-url{flex:1;background:#fff;border:1px solid #9aa4ad;border-radius:12px;padding:3px 12px;' +
        'color:#225;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px/1.4 ui-monospace,monospace}' +
        '.glb-x{margin-left:.2rem;border:none;background:#e2554b;color:#fff;width:22px;height:22px;' +
        'border-radius:5px;cursor:pointer;font-size:12px}.glb-x:hover{filter:brightness(1.1)}' +
        '.glb-frame{flex:1;width:100%;border:0;background:#fff}';
      document.head.appendChild(st);
    }
    const oldWin = document.getElementById('glb-win'); if (oldWin) oldWin.remove();
    const oldBack = document.getElementById('glb-back'); if (oldBack) oldBack.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'glb-back'; backdrop.className = 'glb-back';
    const win = document.createElement('div');
    win.id = 'glb-win'; win.className = 'glb-win';
    win.innerHTML =
      '<div class="glb-bar">' +
      '<span class="glb-dots"><i style="background:#ff5f56"></i><i style="background:#ffbd2e"></i><i style="background:#27c93f"></i></span>' +
      '<button class="glb-nav" data-act="reload" title="Recharger" type="button">⟳</button>' +
      '<span class="glb-url"></span>' +
      '<button class="glb-x" data-act="close" title="Fermer" type="button">✕</button>' +
      '</div><iframe class="glb-frame" sandbox=""></iframe>';
    win.querySelector('.glb-url').textContent = url;
    const frame = win.querySelector('.glb-frame');
    frame.srcdoc = html;
    document.body.appendChild(backdrop);
    document.body.appendChild(win);

    const close = () => {
      win.remove(); backdrop.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', close);
    win.querySelector('[data-act=close]').addEventListener('click', close);
    win.querySelector('[data-act=reload]').addEventListener('click', () => { frame.srcdoc = html; });
  };

  // ---- mini-archiveur ZIP (méthode « stored », pur JS, sans dépendance) ----
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const concatBytes = (arrs) => {
    let len = 0;
    for (const a of arrs) len += a.length;
    const out = new Uint8Array(len);
    let p = 0;
    for (const a of arrs) { out.set(a, p); p += a.length; }
    return out;
  };
  const u16 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  const u32 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
  const buildZip = (files) => {
    const enc = new TextEncoder();
    const locals = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;
      const local = concatBytes([
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size), u16(name.length), u16(0), name, f.data,
      ]);
      locals.push(local);
      central.push(concatBytes([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset), name,
      ]));
      offset += local.length;
    }
    const cd = concatBytes(central);
    const end = concatBytes([
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(cd.length), u32(offset), u16(0),
    ]);
    return concatBytes([...locals, cd, end]);
  };

  // ---- amorçage du projet (avant le chargement du modèle, comme Claude Code) ----
  const HOME = (ctx.cfg && ctx.cfg.home) || '/home/guest';
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const NOUN = [
    'baguette', 'fromage', 'bistrot', 'potager', 'vignoble', 'escargot', 'accordeon',
    'camembert', 'terroir', 'marmite', 'soupe', 'chou', 'beret', 'croissant', 'pinard',
    'guinguette', 'brocante', 'rutabaga', 'pissenlit', 'topinambour',
  ];
  const ADJ = [
    'magnifique', 'flamboyant', 'formidable', 'fantastique', 'sensationnel', 'pittoresque',
    'majestueux', 'croustillant', 'authentique', 'rustique', 'epoustouflant', 'tonitruant',
    'savoureux', 'flashy', 'extraordinaire',
  ];
  const suggested = slugify(pick(NOUN) + '-' + pick(ADJ)) || 'projet-formidable';

  ctx.append('<div class="ln"><span class="accent text-glow">✻</span> <span class="comment">le Glaude : « Bon, on monte quel site aujourd\'hui ? »</span></div>');
  let projName = slugify(((await ctx.ask('nom du projet ? [' + suggested + ']')) || '').trim());
  if (!projName) projName = suggested;
  const projPath = HOME + '/' + projName;

  const ok = ((await ctx.ask('créer « ' + projPath + ' » et y travailler ? [Y/n]')) || '').trim().toLowerCase();
  if (ok === 'n' || ok === 'no' || ok === 'non') { ctx.line('glaude: annulé — pas de projet créé.'); return; }

  let mkErr = ctx.mkdir(projPath, true);
  if (mkErr) { ctx.error('glaude: ' + mkErr); return; }
  const STARTER =
    '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<title>' + projName + '</title>\n' +
    '<style>\n' +
    'body{margin:0;background:#ff00ea;font-family:"Comic Sans MS","Comic Sans",cursive;text-align:center;color:#00ff00}\n' +
    'h1{font-size:3rem;text-shadow:3px 3px 0 #ff0,6px 6px 0 #f00}\n' +
    '.rainbow{background:linear-gradient(90deg,red,orange,yellow,green,blue,indigo,violet);' +
    '-webkit-background-clip:text;background-clip:text;color:transparent}\n' +
    '.blink{animation:b .6s steps(2) infinite}@keyframes b{50%{opacity:0}}\n' +
    '</style>\n</head>\n<body>\n' +
    '<marquee behavior="alternate"><h1 class="rainbow">🥬 ' + projName + ' 🥬</h1></marquee>\n' +
    '<p class="blink">SITE EN CONSTRUCTION !!! Demande au Glaude de le remplir !</p>\n' +
    '<marquee direction="right">⭐⭐⭐ Bienvenue sur le plus beau site du web ⭐⭐⭐</marquee>\n' +
    '</body>\n</html>\n';
  const wErr = ctx.write(projPath + '/index.html', STARTER);
  if (wErr) { ctx.error('glaude: ' + wErr); return; }
  const cdErr = ctx.cd(projPath);
  if (cdErr) ctx.error('glaude: ' + cdErr);
  ctx.append('<div class="ln"><span class="comment">[</span><span class="accent text-glow"> OK </span><span class="comment">] projet « ' + E(projName) + ' » créé dans ' + E(projPath) + '</span></div>');
  ctx.append('<div class="ln comment">         index.html de départ écrit — tape /show pour l\'admirer.</div>');
  ctx.line('');

  // ---- chargement du modèle via le module central (consentement + barre) ----
  // Réutilise le modèle déjà chaud si présent et qu'aucun modèle n'est demandé ;
  // sinon propose un modèle de code (par numéro, id, ou le défaut).
  let session;
  try {
    const st = ctx.llm.state();
    if (st && st.modelId && !first) {
      session = { modelId: st.modelId, label: st.label };
      ctx.line('le Glaude réutilise le modèle déjà chaud : ' + (st.label || st.modelId));
    } else {
      let base = DEFAULT.base, label = DEFAULT.label, gb = DEFAULT.gb;
      if (first && /^\d+$/.test(first)) {
        const n = parseInt(first, 10);
        if (n >= 1 && n <= RECOMMENDED.length) { base = RECOMMENDED[n - 1].base; label = RECOMMENDED[n - 1].label; gb = RECOMMENDED[n - 1].gb; }
        else { ctx.error('glaude: pas de modèle conseillé n°' + n + ' — voir : glaude --list'); return; }
      } else if (first) {
        base = first; label = first; gb = undefined;
      }
      session = await ctx.llm.ensure({ base, label, gb, reason: 'le Glaude code ton site' });
    }
  } catch (e) {
    ctx.error('glaude: ' + ((e && (e.message || e.name)) || e));
    ctx.line('Le Glaude a besoin de WebGPU. Essaie un Chrome/Edge récent (≥ 113) ou Safari 18+.');
    ctx.line('(Ton projet « ' + projName + ' » reste créé — relance `glaude` pour /show.)');
    return;
  }
  if (!session) { ctx.line('glaude: annulé — aucun modèle chargé (ton projet « ' + projName + ' » reste créé).'); return; }
  const modelId = session.modelId;

  // Ancre scrollable du terminal (pour rester collé en bas pendant le stream).
  const scroller = (ctx.append('<div class="ln comment">moteur prêt — ' + E(session.label || modelId) + '</div>')).closest('.ssh-body');
  const toBottom = () => { if (scroller) scroller.scrollTop = scroller.scrollHeight; };

  // ---- session : génération de sites ----
  ctx.line('');
  ctx.append('<div class="ln"><span class="accent text-glow">● le Glaude bricole ton site</span> <span class="comment">— ' + E(modelId) + ' · projet ' + E(projName) + '</span></div>');
  ctx.line('Décris la page voulue, tape Entrée. Puis /save pour écrire, /show pour admirer.');
  ctx.line('Commandes : /help · /show · /save · /download · /files · /reset · /exit');
  ctx.line('');

  const SYSTEM = {
    role: 'system',
    content:
      "Tu es « le Glaude » (Claude Ratinier), un vieux paysan bourbonnais du film " +
      "*La Soupe aux Choux* reconverti en webmaster, à la manière de Claude Code. " +
      "Tu tournes entièrement dans le navigateur de l'utilisateur via WebLLM, sans serveur. " +
      "Ta spécialité : fabriquer des sites web VOLONTAIREMENT HIDEUX et ULTRA-FLASHY, " +
      "façon GeoCities 1997 — fonds fluo qui piquent les yeux, dégradés arc-en-ciel, " +
      "police Comic Sans, balises <marquee> qui défilent, texte qui clignote (animation CSS), " +
      "emojis partout, bordures clignotantes, couleurs qui jurent. " +
      "Le projet courant s'appelle « " + projName + " » et vit dans " + projPath + ". " +
      "RÈGLE ABSOLUE : réponds TOUJOURS avec UN SEUL document HTML complet et autonome " +
      "(de <!doctype html> à </html>), tout le CSS dans une balise <style>, le tout dans " +
      "un unique bloc de code ```html. Pas de JavaScript (le rendu est sandboxé). " +
      "Ajoute une courte phrase rustique avant le bloc, mais le code doit être complet et moche. " +
      "Réponds en français.",
  };
  let messages = [SYSTEM];
  let lastHtml = '';

  // Ctrl+C interrompt une génération en cours.
  if (ctx.signal) {
    ctx.signal.addEventListener('abort', () => { ctx.llm.interrupt(); }, { once: true });
  }

  while (true) {
    if (ctx.signal && ctx.signal.aborted) break;
    const raw = await ctx.ask('›');
    const q = (raw || '').trim();
    if (!q) continue;

    ctx.append('<div class="ln"><span class="prompt">›</span> <span class="cmd">' + E(q) + '</span></div>');

    const low = q.toLowerCase();
    if (low === '/exit' || low === '/quit' || low === '/bye') { ctx.line('Allez, à la revoyure ! 🍷'); break; }
    if (low === '/help') {
      ctx.line('/show [fichier]  voir le rendu  ·  /save [fichier]  écrire la page  ·  /files  lister');
      ctx.line('/download  télécharger le projet en .zip  ·  /project  rappeler le projet');
      ctx.line('/reset  oublier le contexte  ·  /model  ·  /exit');
      continue;
    }
    if (low === '/model') { ctx.line('modèle : ' + modelId); continue; }
    if (low === '/project' || low === '/pwd') { ctx.line('projet « ' + projName + ' » — ' + projPath); continue; }
    if (low === '/reset' || low === '/clear') { messages = [SYSTEM]; ctx.line('contexte oublié — on repart à neuf (le projet reste).'); continue; }
    if (low === '/files' || low === '/ls') {
      const r = ctx.list(projPath);
      if (r && r.error) ctx.error('glaude: ' + r.error);
      else {
        const entries = (r && r.entries) || [];
        ctx.line(entries.length ? entries.map((e2) => e2.name + (e2.type === 'dir' ? '/' : '')).join('  ') : '(projet vide)');
      }
      continue;
    }
    if (low === '/save' || low.startsWith('/save ')) {
      if (!lastHtml) { ctx.error('glaude: rien à enregistrer — demande d\'abord une page au Glaude.'); continue; }
      const f = fileName(q.replace(/^\/save\s*/i, ''), 'index.html');
      const e3 = ctx.write(projPath + '/' + f, lastHtml);
      if (e3) ctx.error('glaude: ' + e3);
      else ctx.line('💾 enregistré : ' + projPath + '/' + f + ' (' + lastHtml.length + ' octets)');
      continue;
    }
    if (low === '/show' || low.startsWith('/show ')) {
      const f = fileName(q.replace(/^\/show\s*/i, ''), 'index.html');
      const full = projPath + '/' + f;
      const r = ctx.read(full);
      let html = (r && r.content) || '';
      if ((!html || !html.trim()) && lastHtml) {
        const e3 = ctx.write(full, lastHtml);
        if (!e3) { html = lastHtml; ctx.line('💾 (enregistré ' + f + ' au passage)'); }
      }
      if (!html || !html.trim()) { ctx.error('glaude: ' + f + ' est vide — demande une page puis réessaie.'); continue; }
      const url = 'http://localhost/' + projName + (f === 'index.html' ? '' : '/' + f);
      openBrowser(url, html);
      ctx.line('🌐 navigateur ouvert sur ' + url + ' (Échap ou ✕ pour fermer).');
      continue;
    }
    if (low === '/download' || low === '/dl' || low === '/zip') {
      const enc = new TextEncoder();
      const files = [];
      const walk = (absDir, relDir) => {
        const r = ctx.list(absDir);
        if (!r || r.error || !r.entries) return;
        for (const ent of r.entries) {
          const abs = absDir + '/' + ent.name;
          const rel = relDir + '/' + ent.name;
          if (ent.type === 'dir') walk(abs, rel);
          else {
            const fr = ctx.read(abs);
            files.push({ name: rel, data: enc.encode((fr && typeof fr.content === 'string') ? fr.content : '') });
          }
        }
      };
      walk(projPath, projName);
      if (!files.length) { ctx.error('glaude: projet vide — rien à télécharger.'); continue; }
      try {
        const zip = buildZip(files);
        const blobUrl = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
        const a = document.createElement('a');
        a.href = blobUrl; a.download = projName + '.zip';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
        ctx.line('⬇️  ' + projName + '.zip téléchargé — ' + files.length + ' fichier(s).');
      } catch (e) {
        ctx.error('glaude: échec du zip — ' + (e.message || e.name));
      }
      continue;
    }

    messages.push({ role: 'user', content: q });

    // Stream de la réponse via le module central (tokens comptés par le widget).
    const row = ctx.append('<div class="ln out" style="white-space:pre-wrap"><span class="accent">le Glaude› </span><span class="reply comment">…</span></div>');
    const replyEl = row.querySelector('.reply');
    let result;
    try {
      result = await ctx.llm.chat({
        messages,
        stream: true,
        signal: ctx.signal,
        onToken: (delta, full) => {
          replyEl.classList.remove('comment');
          replyEl.textContent = full;
          toBottom();
        },
      });
    } catch (e) {
      if (!(ctx.signal && ctx.signal.aborted)) ctx.error('glaude: génération échouée — ' + (e.message || e.name));
    }

    const reply = (result && result.content) || replyEl.textContent || '';
    if (!reply) replyEl.textContent = '(la Denrée a mangé la réponse)';
    messages.push({ role: 'assistant', content: reply });

    const h = extractHtml(reply);
    if (h) {
      lastHtml = h;
      ctx.append('<div class="ln comment">↳ page HTML détectée (' + h.length + ' octets) — /save pour l\'écrire · /show pour l\'admirer.</div>');
    }

    if (result && result.usage && typeof result.usage.tokPerSec === 'number') {
      ctx.append('<div class="ln comment">' + E(result.usage.completionTokens + ' tokens · ' + result.usage.tokPerSec.toFixed(1) + ' tok/s') + '</div>');
    }

    if (ctx.signal && ctx.signal.aborted) break;
  }

  ctx.line('glaude: session close (le modèle reste chaud — `llm --unload` pour le libérer).');
---
