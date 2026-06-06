# Terminal.com

Personal portal — **[Astro](https://astro.build) + [Tailwind CSS](https://tailwindcss.com) v4**.
Static site, **terminal / phosphor aesthetic**, zero framework JS, with built-in SEO
and schema.org structured data. Config-driven and reusable: every site-specific
value (host, identity, links) lives in **`src/site.config.ts`**.

**Design**: a single terminal window. Two themes: **CRT green** (with a "Matrix"
digital-rain background) and **amber monochrome**. Top-right controls: open a new
shell window, toggle the theme, and go fullscreen. Fonts **VT323** (CRT display)
and **IBM Plex Mono** (body). Effects: scanlines, grain, vignette, phosphor glow,
blinking cursor — all disabled under `prefers-reduced-motion`.

## Requirements

- Node.js ≥ 22.18 (native TypeScript execution for `scripts/` and the tests; CI on Node 22)
- PHP ≥ 8.1 + Composer — only for the Web Push backend (`api/push.php`); the site
  itself is fully static.

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
│   ├── pages/index.astro     ← home page (terminal + top-right controls)
│   ├── pages/[command].astro ← one static page per command/document (deep links)
│   ├── pages/sitemap.xml.ts  ← generated sitemap
│   ├── pages/sw.js.ts        ← service worker, generated (cache version + Web Push)
│   ├── pages/shell-*.json.ts ← externalised FS tree + command registry (fetched once)
│   ├── layouts/Layout.astro  ← <head>, SEO, Open Graph, theme, fonts, SW + update toast
│   ├── components/           ← Terminal, ThemeToggle, FullscreenButton, NewShellButton,
│   │                            JsonLd, MatrixRain
│   ├── lib/terminal.ts       ← shell engine (virtual FS, commands, drag/resize)
│   ├── lib/content.ts        ← walks root/ at build time → FS tree + command registry
│   ├── lib/commands.ts       ← command parsing + validation (shared)
│   └── styles/global.css     ← Tailwind + terminal theme (CSS variables, CRT effects)
├── root/                     ← ⭐ THE FAKE FILESYSTEM (a real on-disk directory tree)
│   ├── bin/                  ← one command = one markdown (frontmatter name/desc/js)
│   ├── home/guest/           ← visitor's ~ : docs browsed via ls/cat (about/projects/contact)
│   ├── etc/, var/, usr/, …   ← explorable "decor" directories
├── public/                   ← served as-is
│   ├── api/push.php          ← Web Push backend (?action=send|subscribe)
│   ├── icons/                ← favicon.svg + sized PNGs + maskable icon
│   ├── favicon.ico, apple-touch-icon.png  ← kept at root (browser/iOS convention)
│   └── manifest.json, robots.txt, ludovic-toinel.jpg (OG image)
├── deploy/nginx.conf         ← server block (static + php-fpm + CSP + caching)
├── scripts/check-commands.ts ← standalone command validation (npm run check:commands)
├── tests/                    ← Vitest tests (parsing, validation, rendering)
└── dist/                     ← GENERATED OUTPUT (= the web root to serve)
```

> Not committed (gitignored), created on the server: `vendor/` (Composer),
> `push.config.php` (VAPID keys + owner secret), and a writable `data/` directory
> holding the Web Push runtime state — all one level above `dist/`.

## Editing the content

- **Identity, SEO and profiles** → **`src/site.config.ts`**: name, role, company,
  tagline, bio, URL, OG image, Twitter handle, Google token, and the `links` list
  (each entry feeds the `open` command, the schema.org `sameAs`, or both).
- **Browsed content** → the **`root/`** tree (see "Interactive shell").

The top-right buttons use [astro-icon](https://www.astroicon.dev/) with the
`lucide` set.

## Reusing this portal

1. Edit **`src/site.config.ts`** (identity, URL, profiles, shell host/user).
2. Replace the contents of **`root/home/<user>/`** (your `.md` documents; `<user>`
   is `shell.user`, e.g. `guest`) and, if needed, the "decor" files under
   `root/etc`, `root/var`, etc.
3. Add/remove commands in **`root/bin/`** (see below).
4. Replace the icons (`public/icons/*`, `public/favicon.ico`, `public/apple-touch-icon.png`)
   and the OG image (`public/ludovic-toinel.jpg`).
5. `npm run lint && npm test && npm run build`.

> The home directory (`shell.home`) must stay consistent with the
> `root/home/...` tree.

## Interactive shell

On load, the portal simulates an **SSH connection** to the configured host
(`shell.host` in `src/site.config.ts`) and prints the message of the day
(`motd`), then hands over control. The visitor then types commands to explore
the content.
The window is **draggable** (grab the title bar), **resizable** (handle at the
bottom right) and has close / minimize / maximize buttons (double-click the bar
to maximize).

**The content lives in the `root/` tree (= the fake filesystem):**

- **`root/home/<user>/`** (the `shell.user`, e.g. `guest`) = the visitor's `~`
  directory: documents browsed with `ls` / `cat` (`about.md`, `projects.md`,
  `contact.md`). To **add a document**, create `root/home/<user>/my-file.md`: it
  becomes reachable via `cat my-file.md` (or just `my-file`) and shows up in `ls`.

- **`root/bin/`** = **one command = one markdown**; the build (`content.ts`)
  discovers commands automatically by listing this directory (they also appear
  in `/bin`). Frontmatter:
  - `name`: command name
  - `desc`: description (shown by `help`)
  - `alias` (optional): comma/space-separated alternate names (e.g. `cls` → `clear`)
  - `man: |` (optional): authored manual page, shown by `man <name>`
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
  the display helpers `print/line/raw/error/append/sysLine/escape`, the timing
  helpers `sleep/type`, the interactive `ask`, the navigation helpers
  `cwd/cwdLabel/cd/list/read/fileList/resolveFile`, the persistent FS mutations
  `mkdir/touch/rm`, and `open/theme/su/clear/exit/exec`. A static command (no `js`)
  simply prints its body.

  > Files in `root/bin/*.md` are validated at build time and by `npm run check:commands`
  > (frontmatter, name, **JS syntax** without executing it, duplicates).

Supported markdown: `# Title`, `## Subtitle`, `> note`, `- bullet`,
`**bold**`, `` `code` `` and links `[text](https://…)` or `[…](mailto:…)`.

> ⚠️ Dynamic commands run via `AsyncFunction` (eval). Only allow **trusted**
> commands. The deployed CSP (`deploy/nginx.conf`) is therefore a hardening
> layer, not a sandbox: it allows `unsafe-eval` (for the command engine) and
> `blob:` workers (for `hashcat`).

**Built-in commands**

- _Filesystem_: `ls`/`ll`, `cd`, `pwd`, `cat`, `tree`, `find`, `grep`,
  `mkdir`, `touch`, `rm` (FS mutations persist per-browser in `localStorage`).
- _System / identity_: `whoami`, `neofetch`, `uname`, `date`, `echo`, `motd`,
  `su`/`sudo`, `theme [crt|amber]`, `clear`/`cls`, `history`, `help`, `man`,
  `boot`, `exit`.
- _Network_: `nslookup`, `ping`, `checkip`, `weather`, `open <name>`.
- _Crypto / fun_: `base64`, `sha256sum`, `md5`/`md5sum`, `hashcat`
  (multi-core MD5 brute-forcer using Web Workers).
- _Messaging_: `msg <text>` sends the owner a **Web Push** notification
  (`msg --subscribe <secret>` registers a recipient, owner-only).

`su` simulates switching to root (a `#` prompt, access to `/root`); `exit` returns
to the user. Plus: tree navigation (`cd`/`pwd`), persistent history (↑/↓),
autocompletion (Tab), line editing (`Ctrl+A/E/U/K/W`), `Ctrl+L` (clear), `Ctrl+C`.

The engine is in `src/lib/terminal.ts`; the window in `src/components/Terminal.astro`.

> **SEO**: the terminal requires JavaScript (no static fallback). Search ranking
> therefore relies on the `<head>`: `<title>`, meta description, Open Graph,
> Twitter Card and above all the **`Person` JSON-LD** (server-rendered, so
> readable without running JS). The per-command pages (`[command].astro`) also
> emit each command's manual as crawlable, server-rendered HTML.

## Web Push backend (`msg`)

The `msg` command notifies the owner's browser via **Web Push** (delivered even
with no tab open). A single PHP endpoint, **`public/api/push.php`**, serves two
actions selected by `?action=`:

- `?action=send` — deliver a visitor's message (public, rate-limited).
- `?action=subscribe` — register the current browser as a recipient (owner-only,
  guarded by a shared secret).

It uses `minishlink/web-push` (VAPID). Config and state live **outside the web
root** (above `dist/`): `push.config.php` (keys + secret) and a writable `data/`
directory (`push-store.json`, `push-rate.json`, `msg.log`). The matching VAPID
public key is also embedded in `root/bin/msg.md`. The service worker
(`src/pages/sw.js.ts`) receives the push and shows the notification.

**Deploy steps**: `composer install` (vendor gitignored), create `push.config.php`,
and make `data/` writable by the php-fpm user (e.g. `chown :www-data data && chmod 2775 data`).

## PWA & service worker

`src/pages/sw.js.ts` generates `/sw.js` at build time with a content-derived
cache version. It caches the externalised shell data, receives Web Push
notifications, and — via `Layout.astro` — surfaces an **"update available" toast**
when a new build's service worker is waiting. Manifest and icons (theme-colored
terminal glyph) live in `public/` (`manifest.json`, `icons/`).

## SEO & structured data

Generated from **`src/site.config.ts`**; the `<head>` lives in `src/layouts/Layout.astro`
and the structured-data block in `src/components/JsonLd.astro`:

- `<title>`, meta description, canonical, `theme-color`
- Open Graph + Twitter Card (image: `public/ludovic-toinel.jpg`, 800×800)
- `schema.org/Person` JSON-LD (jobTitle, worksFor, birthPlace, **sameAs** including
  Wikidata + the profiles flagged `sameAs` in `site.config.ts`)
- Generated sitemap (`/sitemap.xml`) + `robots.txt`

## Deployment

The **web root (DocumentRoot)** must point to **`dist/`**; the secrets and the
writable `data/` directory sit one level above it. A reference server block is in
**`deploy/nginx.conf`** (static serving + php-fpm for `api/push.php` + security
headers/CSP + caching).

```bash
npm install && npm run build   # -> dist/
```
