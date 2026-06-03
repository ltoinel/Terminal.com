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

- Node.js ≥ 22.18 (exécution TypeScript native pour `scripts/` et les tests ; CI sur Node 22)

## Démarrer

```bash
npm install
npm run dev      # serveur de dev avec HMR -> http://localhost:4321
```

## Scripts

| Script                   | Rôle                                      |
| ------------------------ | ----------------------------------------- |
| `npm run dev`            | Serveur de développement (hot reload)     |
| `npm run build`          | Build statique optimisé → `dist/`         |
| `npm run preview`        | Prévisualise le build de `dist/`          |
| `npm run check`          | Vérification de types / diagnostics Astro |
| `npm run check:commands` | Valide les commandes (`root/bin/*.md`)    |
| `npm test`               | Tests unitaires (Vitest)                  |
| `npm run test:watch`     | Tests en mode watch                       |
| `npm run lint`           | ESLint                                    |
| `npm run format`         | Formate le code (Prettier)                |
| `npm run format:check`   | Vérifie le formatage sans modifier        |
| `npm run upgrade`        | Liste les mises à jour de dépendances     |
| `npm run upgrade:apply`  | Applique les mises à jour + rebuild       |

Toutes ces vérifications (`format:check`, `lint`, `check:commands`, `check`, `test`, `build`)
tournent automatiquement en CI sur chaque _push_ et _pull request_ (voir `.github/workflows/ci.yml`).

## Structure

```
public_html/
├── astro.config.mjs          ← config Astro (lit l'URL depuis site.config.ts)
├── src/
│   ├── site.config.ts        ← ⭐ SOURCE UNIQUE : identité, SEO, shell, liens/profils
│   ├── pages/index.astro     ← page d'accueil (terminal + bascule de thème)
│   ├── pages/[command].astro ← une page statique par commande/document (deep-links)
│   ├── pages/sitemap.xml.ts  ← sitemap généré
│   ├── layouts/Layout.astro  ← <head>, SEO, Open Graph, thème, polices
│   ├── components/           ← Terminal, ThemeToggle, JsonLd, MatrixRain
│   ├── lib/terminal.ts       ← moteur du shell (FS virtuel, commandes, drag/resize)
│   ├── lib/content.ts        ← parcourt root/ au build → arbre FS + registre de commandes
│   ├── lib/commands.ts       ← parsing + validation des commandes (partagé)
│   └── styles/global.css     ← Tailwind + thème terminal (variables CSS, effets CRT)
├── root/                     ← ⭐ LE FAUX FILESYSTEM (arborescence réelle sur disque)
│   ├── bin/                  ← une commande = un markdown (frontmatter name/desc/js)
│   ├── home/ludovic/         ← ~ du visiteur : docs parcourus via ls/cat (about.md…)
│   ├── etc/, var/, usr/, …   ← répertoires « décor » explorables
├── scripts/check-commands.ts ← validation standalone des commandes (npm run check:commands)
├── tests/                    ← tests Vitest (parsing, validation, rendu)
├── public/                   ← servi tel quel (favicons, robots, vCard, .well-known…)
└── dist/                     ← SORTIE GÉNÉRÉE (= racine web à servir)
```

## Modifier le contenu

- **Identité, SEO et profils** → **`src/site.config.ts`** : nom, rôle, entreprise,
  accroche, bio, URL, image OG, handle Twitter, token Google, et la liste `links`
  (chaque entrée alimente la commande `open`, le `sameAs` schema.org, ou les deux).
- **Contenu parcouru** → l'arborescence **`root/`** (voir « Shell interactif »).

L'unique icône (bascule de thème) utilise [astro-icon](https://www.astroicon.dev/)
avec le jeu `lucide`.

## Réutiliser ce portail

1. Éditez **`src/site.config.ts`** (identité, URL, profils, host/user du shell).
2. Remplacez le contenu de **`root/home/ludovic/`** (vos documents `.md`) et,
   au besoin, les fichiers « décor » de `root/etc`, `root/var`, etc.
3. Ajoutez/retirez des commandes dans **`root/bin/`** (voir ci-dessous).
4. Remplacez les `public/favicon*` et `public/portrait.jpg`.
5. `npm run lint && npm test && npm run build`.

> Le répertoire de home (`shell.home`) doit rester cohérent avec l'arborescence
> `root/home/...`.

## Shell interactif

À l'ouverture, le portail simule une **connexion SSH** à `ludovic.toinel.com`
et affiche le message du jour (`motd`), puis rend la main. Le visiteur tape
ensuite ses commandes pour explorer le contenu.
La fenêtre est **déplaçable** (glisser la barre de titre), **redimensionnable**
(poignée en bas à droite) et possède des boutons fermer / réduire / agrandir
(double-clic sur la barre = agrandir).

**Le contenu vit dans l'arborescence `root/` (= le faux filesystem) :**

- **`root/home/ludovic/`** = le répertoire `~` du visiteur : documents parcourus
  avec `ls` / `cat` (`about.md`, `projects.md`, `skills.md`, `contact.md`).
  Pour **ajouter un document**, créez `root/home/ludovic/mon-fichier.md` : il devient
  accessible via `cat mon-fichier.md` (ou juste `mon-fichier`) et apparaît dans `ls`.

- **`root/bin/`** = **une commande = un markdown** ; le build (`content.ts`) découvre
  automatiquement les commandes en listant ce répertoire (elles apparaissent aussi
  dans `/bin`). Frontmatter :
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

  Le `js` reçoit un objet **`ctx`** : `args`, `body`, `cfg`, `history`, `commands`,
  les helpers d'affichage `print/line/raw/error/append/escape`, de navigation
  `cwd/cwdLabel/cd/list/read/fileList/resolveFile`, et `open/theme/su/clear/exit/exec`.
  Une commande statique (sans `js`) affiche juste son corps.

  > Les fichiers `root/bin/*.md` sont validés au build et par `npm run check:commands`
  > (frontmatter, nom, **syntaxe JS** sans exécution, doublons).

Format markdown supporté : `# Titre`, `## Sous-titre`, `> note`, `- puce`,
`**gras**`, `` `code` `` et liens `[texte](https://…)` ou `[…](mailto:…)`.

> ⚠️ Les commandes dynamiques s'exécutent via `new Function` (eval). N'autorisez
> donc que des commandes **de confiance**. Une **CSP stricte** (`unsafe-eval`
> interdit) les casserait ; aucune CSP n'est configurée par défaut.

**Commandes intégrées** : `help`, `ls`/`ll`, `cd`, `pwd`, `cat`, `whoami`, `motd`,
`mail`, `open <nom>`, `theme [crt|amber]`, `neofetch`, `date`, `echo`, `uname`,
`nslookup`, `ping`, `su`, `history`, `clear`/`cls`, `sudo`, `exit`. `su` simule un
passage en root (invite `#`, accès à `/root`) ; `exit` revient à l'utilisateur.
Plus : navigation dans l'arborescence (`cd`/`pwd`), historique persistant (↑/↓), autocomplétion (Tab),
édition de ligne (`Ctrl+A/E/U/K/W`), `Ctrl+L` (clear), `Ctrl+C`.

Le moteur est dans `src/lib/terminal.ts` ; la fenêtre dans `src/components/Terminal.astro`.

> **SEO** : le terminal nécessite JavaScript (pas de fallback statique). Le
> référencement repose donc sur le `<head>` : `<title>`, meta description,
> Open Graph, Twitter Card et surtout le **JSON-LD `Person`** (rendus côté serveur,
> donc lisibles sans exécuter de JS). Un visiteur **sans JS** voit une page vide.

## SEO & données structurées

Générés depuis **`src/site.config.ts`** ; le `<head>` est dans `src/layouts/Layout.astro`
et le bloc structuré dans `src/components/JsonLd.astro` :

- `<title>`, meta description, canonical, `theme-color`
- Open Graph + Twitter Card (image : `public/portrait.jpg`, 800×800)
- JSON-LD `schema.org/Person` (jobTitle, worksFor, birthPlace, **sameAs** incluant
  Wikidata + les profils marqués `sameAs` dans `site.config.ts`)
- Sitemap généré (`/sitemap.xml`) + `robots.txt`

## Déploiement

⚠️ La **racine web (DocumentRoot)** doit désormais pointer vers **`dist/`**.
Les anciens fichiers Bootstrap (index.html, style.css, vendors/…) ont été
supprimés de la racine : tant que le DocumentRoot n'est pas basculé sur `dist/`,
le site live n'est plus servi.

```bash
npm install && npm run build   # -> dist/
```
