# ludovic.toinel.com

Personal portal — **[Astro](https://astro.build) + [Tailwind CSS](https://tailwindcss.com) v4**.
Static site, **terminal / phosphor aesthetic**, zero framework JS, with built-in SEO
and schema.org structured data.

**Design**: a single terminal window. Two themes: **CRT green** (with a "Matrix"
digital-rain background) and **amber monochrome**, toggled from the top right.
Fonts **VT323** (CRT display) + **IBM Plex Mono** (body). Effects: scanlines,
grain, vignette, phosphor glow, blinking cursor — all disabled under
`prefers-reduced-motion`.

## Requirements

- Node.js ≥ 22.18 (native TypeScript execution for `scripts/` and the tests; CI on Node 22)

## Getting started

```bash
npm install
npm run dev      # dev server with HMR -> http://localhost:4321
```

## Scripts

| Script                   | Purpose                                 |
| ------------------------ | --------------------------------------- |
| `npm run dev`            | Development server (hot reload)         |
| `npm run build`          | Optimized static build → `dist/`        |
| `npm run preview`        | Preview the `dist/` build               |
| `npm run check`          | Type checking / Astro diagnostics       |
| `npm run check:commands` | Validate the commands (`root/bin/*.md`) |
| `npm test`               | Unit tests (Vitest)                     |
| `npm run test:watch`     | Tests in watch mode                     |
| `npm run lint`           | ESLint                                  |
| `npm run format`         | Format the code (Prettier)              |
| `npm run format:check`   | Check formatting without writing        |
| `npm run upgrade`        | List dependency updates                 |
| `npm run upgrade:apply`  | Apply updates + rebuild                 |

All of these checks (`format:check`, `lint`, `check:commands`, `check`, `test`, `build`)
run automatically in CI on every _push_ and _pull request_ (see `.github/workflows/ci.yml`).

## Structure

```
public_html/
├── astro.config.mjs          ← Astro config (reads the URL from site.config.ts)
├── src/
│   ├── site.config.ts        ← ⭐ SINGLE SOURCE: identity, SEO, shell, links/profiles
│   ├── pages/index.astro     ← home page (terminal + theme toggle)
│   ├── pages/[command].astro ← one static page per command/document (deep links)
│   ├── pages/sitemap.xml.ts  ← generated sitemap
│   ├── layouts/Layout.astro  ← <head>, SEO, Open Graph, theme, fonts
│   ├── components/           ← Terminal, ThemeToggle, JsonLd, MatrixRain
│   ├── lib/terminal.ts       ← shell engine (virtual FS, commands, drag/resize)
│   ├── lib/content.ts        ← walks root/ at build time → FS tree + command registry
│   ├── lib/commands.ts       ← command parsing + validation (shared)
│   └── styles/global.css     ← Tailwind + terminal theme (CSS variables, CRT effects)
├── root/                     ← ⭐ THE FAKE FILESYSTEM (a real on-disk directory tree)
│   ├── bin/                  ← one command = one markdown (frontmatter name/desc/js)
│   ├── home/ludovic/         ← visitor's ~ : docs browsed via ls/cat (about.md…)
│   ├── etc/, var/, usr/, …   ← explorable "decor" directories
├── scripts/check-commands.ts ← standalone command validation (npm run check:commands)
├── tests/                    ← Vitest tests (parsing, validation, rendering)
├── public/                   ← served as-is (favicons, robots, vCard, .well-known…)
└── dist/                     ← GENERATED OUTPUT (= the web root to serve)
```

## Editing the content

- **Identity, SEO and profiles** → **`src/site.config.ts`**: name, role, company,
  tagline, bio, URL, OG image, Twitter handle, Google token, and the `links` list
  (each entry feeds the `open` command, the schema.org `sameAs`, or both).
- **Browsed content** → the **`root/`** tree (see "Interactive shell").

The single icon (theme toggle) uses [astro-icon](https://www.astroicon.dev/)
with the `lucide` set.

## Reusing this portal

1. Edit **`src/site.config.ts`** (identity, URL, profiles, shell host/user).
2. Replace the contents of **`root/home/ludovic/`** (your `.md` documents) and,
   if needed, the "decor" files under `root/etc`, `root/var`, etc.
3. Add/remove commands in **`root/bin/`** (see below).
4. Replace `public/favicon*` and `public/portrait.jpg`.
5. `npm run lint && npm test && npm run build`.

> The home directory (`shell.home`) must stay consistent with the
> `root/home/...` tree.

## Interactive shell

On load, the portal simulates an **SSH connection** to `ludovic.toinel.com`
and prints the message of the day (`motd`), then hands over control. The visitor
then types commands to explore the content.
The window is **draggable** (grab the title bar), **resizable** (handle at the
bottom right) and has close / minimize / maximize buttons (double-click the bar
to maximize).

**The content lives in the `root/` tree (= the fake filesystem):**

- **`root/home/ludovic/`** = the visitor's `~` directory: documents browsed
  with `ls` / `cat` (`about.md`, `projects.md`, `skills.md`, `contact.md`).
  To **add a document**, create `root/home/ludovic/my-file.md`: it becomes
  reachable via `cat my-file.md` (or just `my-file`) and shows up in `ls`.

- **`root/bin/`** = **one command = one markdown**; the build (`content.ts`)
  discovers commands automatically by listing this directory (they also appear
  in `/bin`). Frontmatter:
  - `name`: command name
  - `desc`: description (shown by `help`)
  - `js: |` (optional): JavaScript executed if the command is **dynamic**
  - the **markdown body**: shown as-is if the command is **static** (no `js`)

  ```markdown
  ---
  name: date
  desc: date and time
  js: |
    ctx.line(new Date().toString());
  ---
  ```

  The `js` receives a **`ctx`** object: `args`, `body`, `cfg`, `history`, `commands`,
  the display helpers `print/line/raw/error/append/escape`, the navigation helpers
  `cwd/cwdLabel/cd/list/read/fileList/resolveFile`, and `open/theme/su/clear/exit/exec`.
  A static command (no `js`) simply prints its body.

  > Files in `root/bin/*.md` are validated at build time and by `npm run check:commands`
  > (frontmatter, name, **JS syntax** without executing it, duplicates).

Supported markdown: `# Title`, `## Subtitle`, `> note`, `- bullet`,
`**bold**`, `` `code` `` and links `[text](https://…)` or `[…](mailto:…)`.

> ⚠️ Dynamic commands run via `new Function` (eval). Only allow **trusted**
> commands. A **strict CSP** (`unsafe-eval` forbidden) would break them; no CSP
> is configured by default.

**Built-in commands**: `help`, `ls`/`ll`, `cd`, `pwd`, `cat`, `whoami`, `motd`,
`mail`, `open <name>`, `theme [crt|amber]`, `neofetch`, `date`, `echo`, `uname`,
`nslookup`, `ping`, `checkip`, `su`, `history`, `clear`/`cls`, `sudo`, `exit`. `su` simulates
switching to root (a `#` prompt, access to `/root`); `exit` returns to the user.
Plus: tree navigation (`cd`/`pwd`), persistent history (↑/↓), autocompletion (Tab),
line editing (`Ctrl+A/E/U/K/W`), `Ctrl+L` (clear), `Ctrl+C`.

The engine is in `src/lib/terminal.ts`; the window in `src/components/Terminal.astro`.

> **SEO**: the terminal requires JavaScript (no static fallback). Search ranking
> therefore relies on the `<head>`: `<title>`, meta description, Open Graph,
> Twitter Card and above all the **`Person` JSON-LD** (server-rendered, so
> readable without running JS). A visitor **without JS** sees a blank page.

## SEO & structured data

Generated from **`src/site.config.ts`**; the `<head>` lives in `src/layouts/Layout.astro`
and the structured-data block in `src/components/JsonLd.astro`:

- `<title>`, meta description, canonical, `theme-color`
- Open Graph + Twitter Card (image: `public/portrait.jpg`, 800×800)
- `schema.org/Person` JSON-LD (jobTitle, worksFor, birthPlace, **sameAs** including
  Wikidata + the profiles flagged `sameAs` in `site.config.ts`)
- Generated sitemap (`/sitemap.xml`) + `robots.txt`

## Deployment

⚠️ The **web root (DocumentRoot)** must now point to **`dist/`**.
The old Bootstrap files (index.html, style.css, vendors/…) have been removed from
the root: until the DocumentRoot is switched to `dist/`, the live site is no
longer served.

```bash
npm install && npm run build   # -> dist/
```
