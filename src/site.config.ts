/**
 * Single source of truth for everything identity-related: SEO / meta tags,
 * schema.org structured data, and the interactive shell.
 *
 * To reuse this portal, this is the main file to edit — the rest of the code
 * (Layout, JsonLd, Terminal, sitemap, astro.config) derives from it. The browsed
 * content itself lives in the `root/` directory tree.
 */

/** A profile / link, surfaced in the `open` command and/or schema.org `sameAs`. */
export interface SiteLink {
  /** Target URL. */
  url: string;
  /** Key for the `open` command (kebab-case). Omit to keep it out of `open`. */
  open?: string;
  /** Extra `open` aliases (e.g. `htb`). */
  aliases?: string[];
  /** Include in schema.org `sameAs` (SEO entity disambiguation). */
  sameAs?: boolean;
}

export const site = {
  /* ----------------------------- identity ----------------------------- */
  name: 'Ludovic Toinel',
  firstName: 'Ludovic',
  lastName: 'Toinel',
  gender: 'Male',
  role: 'Architecte Fullstack & Innovation',
  company: 'Capgemini',
  companyUrl: 'https://www.capgemini.com/',
  nationality: 'France',
  birthPlace: 'Rennes',
  /** Languages spoken (BCP-47 tags) — schema.org Person `knowsLanguage`. */
  knowsLanguage: ['fr', 'en'],
  /** Short tagline — meta description / Open Graph default. */
  tagline:
    'Architecte Fullstack & Innovation chez Capgemini. Blogueur tech, hacker éthique, photographe, pilote de drone FPV, vanexplorateur et musicien.',
  /** Long bio — used as the schema.org Person `description`. */
  bio: "Architecte Fullstack et Innovation chez Capgemini, je suis spécialisé dans la conception de plateformes logicielles et l'exploration des technologies émergentes. Fondateur du blog Geeek.org, je contribue activement à des projets open source et m'intéresse de près à la cybersécurité et au hacking éthique. Polyvalent et curieux, je partage également mes passions pour la photographie, les drones FPV et les voyages en van à travers le projet Apollovan, sans oublier la création musicale.",
  knowsAbout: [
    'Architecture logicielle',
    'Développement Fullstack',
    'Innovation',
    'Cybersécurité',
    'Nouvelles technologies',
    'Photographie',
    'Drones FPV',
    'Intelligence Artificielle générative',
    'OSINT',
    'Web',
  ],

  /* ----------------------------- site & SEO --------------------------- */
  /** Canonical origin (no trailing slash). */
  url: 'https://ludovic.toinel.com',
  locale: 'fr_FR',
  lang: 'fr',
  /** Absolute-from-root path of the portrait / Open Graph image. */
  ogImage: '/ludovic-toinel.jpg',
  /** Twitter / X handle (with `@`). */
  twitter: '@ltoinel',
  /** Google Search Console verification token (empty to omit the meta tag). */
  googleSiteVerification: '2gYYxN0DAxC3iK23exWNrujGcR9AmqtKM87J2GLkN5o',

  /* --------------------------- interactive shell ---------------------- */
  shell: {
    /** Host shown in the prompt and SSH animation. */
    host: 'ludovic.toinel.com',
    /** User shown in the prompt. */
    user: 'guest',
    /** Absolute home directory — must match the `root/home/...` tree. */
    home: '/home/guest',
  },

  /* --------------------------- profiles & links ----------------------- */
  // Each entry can feed the `open` command, the schema.org `sameAs`, or both.
  links: [
    { url: 'https://www.geeek.org', open: 'blog', sameAs: true },
    { url: 'https://apollovan.fr', open: 'apollovan', sameAs: true },
    { url: 'https://github.com/ltoinel', open: 'github', sameAs: true },
    { url: 'https://www.linkedin.com/in/ltoinel', open: 'linkedin', sameAs: true },
    { url: 'https://www.facebook.com/ltoinel', open: 'facebook', sameAs: true },
    { url: 'https://soundcloud.com/ludovic-toinel', open: 'soundcloud', sameAs: true },
    { url: 'https://app.hackthebox.com/profile/290482', open: 'htb', sameAs: true },
    { url: 'https://x.com/ltoinel', open: 'x', sameAs: true },
    { url: 'https://unsplash.com/fr/@ltoinel', open: 'photographie', sameAs: true },
    { url: 'https://www.geeek.org/tag/drones/', open: 'drones-fpv' },
    { url: 'https://tekkit.io/actu/portraits/ludovic7777', open: 'tekkit', sameAs: true },
    { url: 'https://www.youtube.com/@LudovicToinel', open: 'youtube', sameAs: true },
    { url: 'https://www.instagram.com/ltoinel', open: 'instagram', sameAs: true },
    { url: 'https://www.twitch.tv/ltoinel', open: 'twitch', sameAs: true },
    { url: 'https://ko-fi.com/ltoinel', open: 'kofi', sameAs: true },
  ] as SiteLink[],
};

/** `open` command registry — `key -> URL`, including aliases. */
export const openLinks: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const l of site.links) {
    if (l.open) out[l.open] = l.url;
    for (const a of l.aliases ?? []) out[a] = l.url;
  }
  return out;
})();

/** schema.org `sameAs` list: every profile flagged `sameAs` in the link list. */
export const sameAs: string[] = site.links.filter((l) => l.sameAs).map((l) => l.url);
