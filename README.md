# ludovic.toinel.com

Portail personnel — **[Astro](https://astro.build) + [Tailwind CSS](https://tailwindcss.com) v4**.
Site statique, **esthétique terminal / phosphore**, zéro JS de framework, SEO et
données structurées schema.org intégrés.

**Design** : fenêtre de terminal unique. Deux thèmes : **vert CRT** (avec fond
« Matrix » digital-rain) et **ambre monochrome**, bascule en haut à droite.
Polices **VT323** (affichage CRT) + **IBM Plex Mono** (corps). Effets : scanlines,
grain, vignette, glow phosphore, curseur clignotant — tous désactivés sous
`prefers-reduced-motion`.

## Prérequis

- Node.js ≥ 18.20 (testé avec Node 22)

## Démarrer

```bash
npm install
npm run dev      # serveur de dev avec HMR -> http://localhost:4321
```

## Scripts

| Script                  | Rôle                                                       |
|-------------------------|------------------------------------------------------------|
| `npm run dev`           | Serveur de développement (hot reload)                      |
| `npm run build`         | Build statique optimisé → `dist/`                          |
| `npm run preview`       | Prévisualise le build de `dist/`                           |
| `npm run check`         | Vérification de types / diagnostics Astro                  |
| `npm run upgrade`       | Liste les mises à jour de dépendances                      |
| `npm run upgrade:apply` | Applique les mises à jour + rebuild                        |

## Structure

```
public_html/
├── astro.config.mjs          ← config Astro (site, sitemap, icônes, Tailwind)
├── src/
│   ├── pages/index.astro     ← page d'accueil (terminal + bascule de thème)
│   ├── layouts/Layout.astro  ← <head>, SEO, Open Graph, JSON-LD, thème, polices
│   ├── components/           ← Terminal, ThemeToggle
│   ├── home/                 ← ~ du visiteur : docs parcourus via ls/cat (about.md, projects.md…)
│   ├── commands/             ← une commande = un markdown (frontmatter name/desc/js)
│   ├── lib/terminal.ts       ← moteur du shell interactif (SSH, commandes, drag/resize)
│   ├── data/                 ← données (SEO sameAs + liens de la commande `open`)
│   │   ├── site.ts           ← identité, accroche, texte « À propos »
│   │   ├── socials.ts        ← réseaux sociaux + sameAs SEO
│   │   └── projects.ts       ← cartes de la grille Projets
│   ├── assets/               ← images optimisées au build (portrait…)
│   └── styles/global.css     ← Tailwind + thème terminal (variables CSS, effets CRT)
├── public/                   ← servi tel quel (favicon, og-image, robots, vCard, .well-known…)
└── dist/                     ← SORTIE GÉNÉRÉE (= racine web à servir)
```

## Modifier le contenu

Le contenu affiché au visiteur vit dans **`src/home/`** et **`src/commands/`**
(voir la section « Shell interactif » ci-dessous).

Les fichiers **`src/data/`** sont de la **configuration** (pas du contenu affiché) :

- **`site.ts`** : identité (nom, rôle, entreprise, accroche, bio) — alimente le
  `<title>`, les meta, l'Open Graph et le JSON-LD.
- **`socials.ts`** : réseaux (label + URL). `sameAs: true` injecte le lien dans
  les données structurées schema.org, et chaque entrée devient une cible de `open`.
- **`projects.ts`** : liens supplémentaires (label + URL) pour la commande `open`.

L'unique icône (bascule de thème) utilise [astro-icon](https://www.astroicon.dev/)
avec le jeu `lucide`.

## Shell interactif

À l'ouverture, le portail simule une **connexion SSH** à `ludovic.toinel.com`
et affiche le message du jour (`motd`), puis rend la main. Le visiteur tape
ensuite ses commandes pour explorer le contenu.
La fenêtre est **déplaçable** (glisser la barre de titre), **redimensionnable**
(poignée en bas à droite) et possède des boutons fermer / réduire / agrandir
(double-clic sur la barre = agrandir).

**Le contenu vit dans deux répertoires :**

- **`src/home/`** = le répertoire `~` du visiteur : documents parcourus avec
  `ls` / `cat` (`about.md`, `projects.md`, `skills.md`, `contact.md`).
  Pour **ajouter un document**, créez `src/home/mon-fichier.md` : il devient
  accessible via `cat mon-fichier.md` (ou juste `mon-fichier`) et apparaît dans `ls`.

- **`src/commands/`** = **une commande = un markdown** ; `terminal.ts` découvre
  automatiquement les commandes en listant ce répertoire. Frontmatter :
  - `name` : nom de la commande
  - `desc` : description (affichée par `help`)
  - `js: |` (optionnel) : code JavaScript exécuté si la commande est **dynamique**
  - le **corps markdown** : affiché tel quel si la commande est **statique** (pas de `js`)

  ```markdown
  ---
  name: date
  desc: date et heure
  js: |
    ctx.line(new Date().toString());
  ---
  ```

  Le `js` reçoit un objet **`ctx`** : `args`, `body`, `cfg`, `history`, `files`,
  `commands`, et des helpers `print/line/error/append/escape/fileList/resolveFile/
  open/theme/clear/exit/exec`. Une commande statique (sans `js`) affiche juste son corps.

Format markdown supporté : `# Titre`, `## Sous-titre`, `> note`, `- puce`,
`**gras**`, `` `code` `` et liens `[texte](https://…)` ou `[…](mailto:…)`.

> ⚠️ Les commandes dynamiques s'exécutent via `new Function` — une **CSP stricte**
> (`unsafe-eval` interdit) les casserait. Aucune CSP n'est configurée par défaut.

**Commandes intégrées** : `help`, `ls`/`ll`, `cat`, `whoami`, `motd`, `mail`, `open <nom>`,
`theme [crt|amber]`, `neofetch`, `date`, `pwd`, `echo`, `uname`, `history`,
`clear`, `sudo`, `exit`. Plus : historique persistant (↑/↓), autocomplétion (Tab),
édition de ligne (`Ctrl+A/E/U/K/W`), `Ctrl+L` (clear), `Ctrl+C`.

Le moteur est dans `src/lib/terminal.ts` ; la fenêtre dans `src/components/Terminal.astro`.

> **SEO** : le terminal nécessite JavaScript (pas de fallback statique). Le
> référencement repose donc sur le `<head>` : `<title>`, meta description,
> Open Graph, Twitter Card et surtout le **JSON-LD `Person`** (rendus côté serveur,
> donc lisibles sans exécuter de JS). Un visiteur **sans JS** voit une page vide.

## SEO & données structurées

Gérés dans `src/layouts/Layout.astro`, générés depuis `src/data/` :

- `<title>`, meta description, canonical, `theme-color`
- Open Graph + Twitter Card (image : `public/og-image.jpg`, 1200×630)
- JSON-LD `schema.org/Person` (jobTitle, worksFor, birthPlace, **sameAs** incluant
  Wikidata + tous les réseaux)
- Sitemap généré automatiquement (`/sitemap-index.xml`) + `robots.txt`

> Pour régénérer l'image Open Graph après un changement de photo/texte, voir le
> bloc ImageMagick dans l'historique, ou remplacez simplement `public/og-image.jpg`
> (1200×630).

## Déploiement

⚠️ La **racine web (DocumentRoot)** doit désormais pointer vers **`dist/`**.
Les anciens fichiers Bootstrap (index.html, style.css, vendors/…) ont été
supprimés de la racine : tant que le DocumentRoot n'est pas basculé sur `dist/`,
le site live n'est plus servi.

```bash
npm install && npm run build   # -> dist/
```
