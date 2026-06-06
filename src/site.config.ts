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
  /** Short tagline — meta description / Open Graph default. */
  tagline:
    'Architecte Fullstack & Innovation chez Capgemini. Blogueur, hacker, photographe, pilote de drones, voyageur et musicien.',
  /** Long bio — used as the schema.org Person `description`. */
  bio: "Passionné de technologie depuis toujours, je conçois et fais évoluer des plateformes fullstack et explore l'innovation au quotidien en tant qu'architecte chez Capgemini. En dehors du travail, je partage mes découvertes sur mon blog Geeek.org, je bricole et code des projets open source, je pratique le hacking éthique, la photographie et le pilotage de drones FPV. J'aime aussi prendre la route : Apollovan raconte mes voyages en van aménagé. Et quand je débranche, je fais de la musique.",
  knowsAbout: [
    'Architecture logicielle',
    'Développement Fullstack',
    'Innovation',
    'Cybersécurité',
    'Nouvelles technologies',
    'Photographie',
    'Drones FPV',
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
  /** Wikidata entity — used for `rel=me` and as the first `sameAs` entry. */
  wikidata: 'https://www.wikidata.org/wiki/Q140004299',

  /* --------------------------- interactive shell ---------------------- */
  shell: {
    /** Host shown in the prompt and SSH animation. */
    host: 'ludovic.toinel.com',
    /** User shown in the prompt. */
    user: 'ludovic@toinel.com',
    /** Absolute home directory — must match the `root/home/...` tree. */
    home: '/home/ludovic',
  },

  /* --------------------------- profiles & links ----------------------- */
  // Each entry can feed the `open` command, the schema.org `sameAs`, or both.
  links: [
    { url: 'https://www.geeek.org', open: 'blog', sameAs: true},
    { url: 'https://github.com/ltoinel', open: 'github', sameAs: true },
    { url: 'https://www.linkedin.com/in/ltoinel', open: 'linkedin', sameAs: true },
    { url: 'https://www.facebook.com/ltoinel', open: 'facebook', sameAs: true },
    { url: 'https://soundcloud.com/ludovic-toinel', open: 'soundcloud', sameAs: true },
    { url: 'https://app.hackthebox.com/profile/290482', open: 'htb', sameAs: true},
    { url: 'https://x.com/ltoinel', open: "x", sameAs: true },
    { url: 'https://unsplash.com/fr/@ltoinel', open: 'photographie', sameAs: true },
    { url: 'https://apollovan.fr', open: 'apollovan', sameAs: true },
    { url: 'https://www.geeek.org/fermeture-du-site-wiki-fpv/', open: 'drones-fpv' },
    { url: 'https://tekkit.io/actu/portraits/ludovic7777', sameAs: true },
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

/** schema.org `sameAs` list: Wikidata first, then every flagged profile. */
export const sameAs: string[] = [
  site.wikidata,
  ...site.links.filter((l) => l.sameAs).map((l) => l.url),
];
