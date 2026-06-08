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
  l'inférence. Le moteur est WebLLM (@mlc-ai/web-llm) accéléré par WebGPU et la
  famille **Qwen2.5-Coder** ; les poids sont téléchargés une fois puis mis en
  cache. glaude partage le moteur et le cache avec la commande webllm.

  Sa spécialité : pondre des **sites HTML horriblement laids et flashy** —
  fonds fluo, dégradés arc-en-ciel, Comic Sans, <marquee> qui défilent, texte
  qui clignote, emojis partout. Bref, l'esthétique GeoCities de 1997.

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
  webllm, mkdir, touch, ls
js: |
  // glaude — une parodie de Claude Code propulsée par WebLLM (WebGPU, 100 % local),
  // spécialisée dans la fabrication de sites HTML hideux et flashy. Au lancement
  // elle amorce un projet sous /home/guest/<projet> (mkdir + index.html via la
  // nouvelle mutation ctx.write, persistée en localStorage), puis ouvre une session
  // où "le Glaude" génère des pages. /save écrit le fichier, /show l'affiche dans un
  // faux navigateur. Réutilise le moteur/cache partagés avec `webllm`.
  const E = ctx.escape;
  const args = ctx.args.slice();
  const first = args[0];

  // Pin la version du moteur (même bundle auto-hébergé que webllm).
  const WEBLLM_VERSION = '0.2.84';
  const WEBLLM_URL = '/vendor/web-llm-' + WEBLLM_VERSION + '.js';

  // Modèles de code conseillés, du plus petit au plus gros. `base` = id sans le
  // suffixe de quantification ; le bon build (q4f16 vs q4f32) est choisi à
  // l'exécution selon le support GPU de shader-f16. DEFAULT_BASE = lancement nu.
  const RECOMMENDED = [
    { label: 'Qwen2.5-Coder 0.5B', base: 'Qwen2.5-Coder-0.5B-Instruct', gb16: 0.5, gb32: 0.9 },
    { label: 'Qwen2.5-Coder 1.5B', base: 'Qwen2.5-Coder-1.5B-Instruct', gb16: 1.0, gb32: 1.9 },
    { label: 'Qwen2.5-Coder 3B',   base: 'Qwen2.5-Coder-3B-Instruct',   gb16: 1.8, gb32: 3.3 },
    { label: 'Qwen2.5-Coder 7B',   base: 'Qwen2.5-Coder-7B-Instruct',   gb16: 4.5, gb32: 8.1 },
  ];
  const DEFAULT_BASE = 'Qwen2.5-Coder-1.5B-Instruct';

  // Slot moteur partagé avec webllm : un modèle reste résident pour la session.
  const slot = (globalThis.__ltshWebLLM = globalThis.__ltshWebLLM || { engine: null, modelId: null });

  // ---- glaude --unload : libère le modèle résident (sans import / GPU) ----
  if (first === '--unload' || first === '--stop') {
    if (slot.engine) {
      try { await slot.engine.unload(); } catch (e) { /* ignore */ }
      slot.engine = null; slot.modelId = null;
      ctx.line('glaude: modèle déchargé, mémoire GPU libérée.');
    } else {
      ctx.line('glaude: aucun modèle chargé.');
    }
    return;
  }

  // ---- "la Denrée" en pixel-art coloré (l'extraterrestre de La Soupe aux Choux) ----
  // Une grille simplifiée : chaque caractère = un pixel, peint en bloc plein (██).
  // R/D = rouge (crête, oreilles, épaulettes), B = beige (visage/corps),
  // N = brun (sourcils/nez), W = blanc (yeux), o = sombre (pupilles/bouche), '.' = vide.
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
  // Peint une ligne de pixels : regroupe les pixels consécutifs de même couleur
  // en un <span> coloré de blocs (deux ██ par pixel pour des carrés plus carrés).
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

  // Boîte d'accueil façon Claude Code (le clin d'œil au vrai CLI).
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
        '<span class="comment">≈ ' + E(r.gb16.toFixed(2)) + '–' + E(r.gb32.toFixed(2)) + ' Go</span></div>',
      );
    });
    ctx.line('');
    ctx.line('Démarre :  glaude <numéro>   (ex. glaude 1)   ·   tous les modèles : `webllm --list-all`');
    return;
  }

  // ---- petits utilitaires fichiers ----
  // Nettoie une saisie en nom sûr : minuscules, [a-z0-9._-], sans espaces ni accents.
  const slugify = (s) =>
    (s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 48);
  // Nom de fichier web : slug + extension .html par défaut.
  const fileName = (s, def) => {
    let f = slugify(s) || def;
    if (!/\.[a-z0-9]+$/.test(f)) f += '.html';
    return f;
  };
  // Extrait un document HTML d'une réponse : bloc ```html, sinon bloc ``` qui
  // contient des balises, sinon le texte brut s'il ressemble à du HTML.
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
    frame.srcdoc = html; // propriété (pas d'attribut) → pas d'échappement à gérer
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
  // Construit une archive ZIP non compressée à partir de [{name, data:Uint8Array}].
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
  // Nom de projet aléatoire, bien francophone (nom + adjectif, à la GeoCities du terroir).
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

  // Crée le dossier (idempotent : -p), puis y écrit un index.html de départ bien moche.
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

  // ---- vérification WebGPU ----
  if (!('gpu' in navigator) || !navigator.gpu) {
    ctx.error('glaude: WebGPU n\'est pas disponible dans ce navigateur.');
    ctx.line('Le Glaude a besoin de WebGPU pour coder. Essaie un Chrome/Edge récent (≥ 113) ou Safari 18+.');
    ctx.line('Sur Linux + Chrome, il faut parfois activer : chrome://flags/#enable-unsafe-webgpu');
    ctx.line('(Ton projet « ' + projName + ' » reste créé — `cat index.html`, relance `glaude` pour /show.)');
    return;
  }
  let adapter = null;
  try { adapter = await navigator.gpu.requestAdapter(); } catch (e) { /* aucun */ }
  if (!adapter) {
    ctx.error('glaude: aucun adaptateur WebGPU — le GPU est bloqué ou indisponible.');
    return;
  }
  const hasF16 = !!(adapter.features && typeof adapter.features.has === 'function' && adapter.features.has('shader-f16'));
  const QUANT = hasF16 ? 'q4f16_1' : 'q4f32_1';

  // Ancre scrollable du terminal (pour rester collé en bas pendant le stream).
  const anchor = ctx.append('<div class="ln comment">moteur WebLLM @' + E(WEBLLM_VERSION) + ' · shader-f16: ' + (hasF16 ? 'oui' : 'non') + '</div>');
  const scroller = anchor.closest('.ssh-body');
  const toBottom = () => { if (scroller) scroller.scrollTop = scroller.scrollHeight; };

  // ---- chargement paresseux du moteur WebLLM auto-hébergé ----
  ctx.line('le Glaude allume le fourneau (chargement du moteur)…');
  let webllm;
  try {
    webllm = await import(WEBLLM_URL);
  } catch (e) {
    ctx.error('glaude: impossible de charger le moteur — ' + (e.message || e.name));
    ctx.line('Le bundle est attendu à ' + WEBLLM_URL + ' (servi par ce site).');
    return;
  }

  const ids = (webllm.prebuiltAppConfig && webllm.prebuiltAppConfig.model_list || []).map((m) => m.model_id);
  const idSet = new Set(ids);

  // Résout un `base` vers le build qui tournera vraiment sur ce GPU.
  const pickId = (base) => {
    const here = ids.find((id) => id.includes(base + '-' + QUANT));
    if (here) return here;
    if (hasF16) { const alt = ids.find((id) => id.includes(base + '-q4f32_1')); if (alt) return alt; }
    return undefined;
  };
  const recommended = RECOMMENDED.map((r) => ({ ...r, id: pickId(r.base) })).filter((r) => r.id);

  // ---- résout le modèle demandé (numéro, id, sous-chaîne, ou défaut) ----
  let modelId = null;
  if (!first) {
    modelId = pickId(DEFAULT_BASE) || (recommended[0] && recommended[0].id) || null;
    if (!modelId) { ctx.error('glaude: aucun modèle de code compatible avec ce GPU — voir `webllm --list-all`.'); return; }
  } else if (/^\d+$/.test(first)) {
    const n = parseInt(first, 10);
    if (n >= 1 && n <= recommended.length) modelId = recommended[n - 1].id;
    else { ctx.error('glaude: pas de modèle conseillé n°' + n + ' — voir : glaude --list'); return; }
  } else if (idSet.has(first)) {
    modelId = first;
  } else {
    const needle = first.toLowerCase();
    const hits = ids.filter((id) => id.toLowerCase().includes(needle));
    if (hits.length === 1) modelId = hits[0];
    else if (hits.length > 1) {
      ctx.error('glaude: ambigu — ' + hits.length + ' modèles correspondent à "' + first + '" :');
      hits.slice(0, 8).forEach((h) => ctx.line('  ' + h));
      return;
    } else { ctx.error('glaude: modèle inconnu "' + first + '" — voir : glaude --list'); return; }
  }

  // q4f16 sur un GPU sans shader-f16 → bascule transparente vers q4f32.
  if (!hasF16 && /q4f16/.test(modelId)) {
    const swapped = modelId.replace(/q4f16/g, 'q4f32');
    if (idSet.has(swapped)) { ctx.line('note: ce GPU n\'a pas shader-f16 → bascule sur ' + swapped); modelId = swapped; }
    else { ctx.error('glaude: "' + modelId + '" exige shader-f16, absent sur ce GPU. Choisis un build q4f32.'); return; }
  }

  // ---- chargement du modèle (ou réutilisation du résident) + barre ----
  let engine;
  if (slot.engine && slot.modelId === modelId) {
    engine = slot.engine;
    ctx.line('modèle « ' + modelId + ' » déjà chaud — on reprend.');
  } else {
    if (slot.engine) { try { await slot.engine.unload(); } catch (e) { /* ignore */ } slot.engine = null; slot.modelId = null; }

    const BARW = 28;
    const renderBar = (p) => {
      const f = Math.max(0, Math.min(BARW, Math.round((p || 0) * BARW)));
      return '[' + '#'.repeat(f) + '·'.repeat(BARW - f) + '] ' + Math.round((p || 0) * 100) + '%';
    };
    ctx.append('<div class="ln"><span class="accent text-glow">↓ mijotage</span> <span class="comment">' + E(modelId) + '</span></div>');
    const progEl = ctx.append('<div class="ln comment">préparation…</div>');
    const onProgress = (r) => {
      progEl.innerHTML =
        '<span class="accent">' + E(renderBar(r.progress)) + '</span> ' +
        '<span class="comment">' + E((r.text || '').slice(0, 80)) + '</span>';
      toBottom();
    };

    try {
      engine = await webllm.CreateMLCEngine(modelId, { initProgressCallback: onProgress });
    } catch (e) {
      // Certains GPU annoncent shader-f16 mais échouent à compiler les shaders f16
      // (Invalid ShaderModule) ; on retente une fois avec le build q4f32.
      const msg = String((e && (e.message || e.name)) || e);
      const shaderIssue = /ShaderModule|shader-f16|f16|compute stage|createShaderModule|previous error/i.test(msg);
      const f32 = modelId.replace(/q4f16/g, 'q4f32');
      if (shaderIssue && /q4f16/.test(modelId) && idSet.has(f32)) {
        ctx.line('compilation shader échouée → on retente avec ' + f32);
        try { engine = await webllm.CreateMLCEngine(f32, { initProgressCallback: onProgress }); modelId = f32; }
        catch (e2) { ctx.error('glaude: échec d\'initialisation — ' + (e2.message || e2.name)); return; }
      } else {
        ctx.error('glaude: échec d\'initialisation du modèle — ' + (e.message || e.name));
        ctx.line('Le premier lancement télécharge les poids ; vérifie ta connexion et ton espace disque.');
        return;
      }
    }
    slot.engine = engine; slot.modelId = modelId;
    progEl.innerHTML = '<span class="accent">' + E(renderBar(1)) + '</span> <span class="comment">prêt</span>';
  }

  // ---- session : génération de sites ----
  ctx.line('');
  ctx.append('<div class="ln"><span class="accent text-glow">● le Glaude bricole ton site</span> <span class="comment">— ' + E(modelId) + ' · projet ' + E(projName) + '</span></div>');
  ctx.line('Décris la page voulue, tape Entrée. Puis /save pour écrire, /show pour admirer.');
  ctx.line('Commandes : /help · /show · /save · /download · /files · /reset · /exit');
  ctx.line('');

  // Le "system prompt" : le Glaude, webmaster du laid et du flashy.
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
  let lastHtml = ''; // dernier document HTML généré (pour /save et /show)

  // Ctrl+C (ctx.signal) interrompt une génération en cours et clôt la session.
  let interrupted = false;
  if (ctx.signal) {
    ctx.signal.addEventListener('abort', () => {
      interrupted = true;
      try { engine.interruptGenerate(); } catch (e) { /* ignore */ }
    }, { once: true });
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
      // Pas encore enregistré ? On sauve la dernière page générée au passage.
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
      // Rassemble récursivement tous les fichiers du projet, puis télécharge un .zip.
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

    // Stream de la réponse dans une ligne unique (textContent — jamais d'HTML).
    const row = ctx.append('<div class="ln out" style="white-space:pre-wrap"><span class="accent">le Glaude› </span><span class="reply comment">…</span></div>');
    const replyEl = row.querySelector('.reply');
    let reply = '';
    let usage = null;
    try {
      const stream = await engine.chat.completions.create({
        messages,
        stream: true,
        stream_options: { include_usage: true },
      });
      for await (const chunk of stream) {
        const ch0 = chunk.choices && chunk.choices[0];
        const delta = ch0 && ch0.delta && ch0.delta.content ? ch0.delta.content : '';
        if (delta) {
          reply += delta;
          replyEl.classList.remove('comment');
          replyEl.textContent = reply;
          toBottom();
        }
        if (chunk.usage) usage = chunk.usage;
        if (ctx.signal && ctx.signal.aborted) break;
      }
    } catch (e) {
      if (!(ctx.signal && ctx.signal.aborted)) ctx.error('glaude: génération échouée — ' + (e.message || e.name));
    }

    if (!reply) replyEl.textContent = interrupted ? '⏹ interrompu' : '(la Denrée a mangé la réponse)';
    messages.push({ role: 'assistant', content: reply });

    // Mémorise le HTML produit (s'il y en a) pour /save et /show.
    const h = extractHtml(reply);
    if (h) {
      lastHtml = h;
      ctx.append('<div class="ln comment">↳ page HTML détectée (' + h.length + ' octets) — /save pour l\'écrire · /show pour l\'admirer.</div>');
    }

    if (usage && usage.extra && typeof usage.extra.decode_tokens_per_s === 'number') {
      ctx.append(
        '<div class="ln comment">' +
        E((usage.completion_tokens || 0) + ' tokens · ' + usage.extra.decode_tokens_per_s.toFixed(1) + ' tok/s') +
        '</div>',
      );
    }

    if (ctx.signal && ctx.signal.aborted) break;
  }

  ctx.line('glaude: session close (le modèle reste chaud — `glaude --unload` pour le libérer).');
---
