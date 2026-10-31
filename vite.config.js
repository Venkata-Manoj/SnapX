import { defineConfig, loadEnv } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE, UNFILLED } from './src/config/site.config.js';
import { renderPricing, renderOffers } from './src/config/pricing.render.js';

const root = dirname(fileURLToPath(import.meta.url));
const partialsDir = resolve(root, 'src/partials');

function normalizeBase(value) {
  if (!value || value === '/') return '/';
  const withLead = value.startsWith('/') ? value : `/${value}`;
  return withLead.endsWith('/') ? withLead : `${withLead}/`;
}

const hostOf = (value, fallback) => {
  try {
    return new URL(value).host;
  } catch {
    return fallback;
  }
};

/** @if / @ifnot blocks, evaluated against the config flags. */
function applyConditionals(html, flags, filename) {
  const marker = /<!--\s*@(if|ifnot)\s+([A-Z0-9_]+)\s*-->|<!--\s*@endif\s*-->/g;
  const stack = [];
  let out = '';
  let last = 0;

  for (const match of html.matchAll(marker)) {
    if (stack.every((frame) => frame.keep)) out += html.slice(last, match.index);
    last = match.index + match[0].length;

    if (match[1]) {
      const name = match[2];
      if (!(name in flags)) {
        throw new Error(`${filename}: @${match[1]} ${name} is not a config flag.`);
      }
      stack.push({ keep: match[1] === 'if' ? Boolean(flags[name]) : !Boolean(flags[name]) });
    } else {
      if (!stack.length) throw new Error(`${filename}: @endif without @if.`);
      stack.pop();
    }
  }

  if (stack.length) throw new Error(`${filename}: unclosed @if block.`);
  out += html.slice(last);

  return out;
}

/**
 * Inlines partials, evaluates @if blocks, replaces {{TOKENS}} from site.config.js,
 * and resolves @@BASE@@ for sub-path deploys. Unknown tokens fail the build.
 */
function brandHtml() {
  let base = '/';
  let env = {};

  return {
    name: 'snapx-brand',
    configResolved(config) {
      base = config.base;
      env = loadEnv(config.mode, config.root, 'VITE_');
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const isHome = /[\\/]index\.html$/.test(ctx.filename);
        const supabaseHost = hostOf(env.VITE_SUPABASE_URL, 'Supabase');
        const accountUrl = `${base}account.html`;
        const hasPressKit = Boolean(SITE.SHOW_PRESS_KIT && SITE.PRESS_KIT_URL);
        const signin = new Set(SITE.ENABLED_SIGNIN);

        const flags = {
          ...SITE,
          HAS_PRESS_KIT: hasPressKit,
          HAS_PROJECT_LINKS: hasPressKit,
          HAS_PROFILE: Boolean(SITE.GITHUB_PROFILE_URL),
          HAS_PROVIDER_LOGIN: ['google', 'microsoft', 'apple'].some((provider) =>
            signin.has(provider),
          ),
          SIGNIN_GOOGLE: signin.has('google'),
          SIGNIN_EMAIL: signin.has('email'),
          SIGNIN_MICROSOFT: signin.has('microsoft'),
          SIGNIN_APPLE: signin.has('apple'),
        };
        const tokens = {
          ...Object.fromEntries(
            Object.entries(SITE).filter(([, value]) => typeof value === 'string'),
          ),
          SITE_HOST: hostOf(SITE.SITE_URL, 'this site'),
          SUPABASE_HOST: supabaseHost,
          ACCOUNT_URL: accountUrl,
          LOGIN_URL: `${base}login.html?next=${encodeURIComponent(accountUrl)}`,
          PRICING_CARDS: renderPricing({ base, onHome: isHome }),
          JSONLD_OFFERS: renderOffers(),
        };

        const expanded = html.replace(
          /<!--\s*@include\s+([\w.-]+)\s*-->/g,
          (_, file) => readFileSync(resolve(partialsDir, file), 'utf8'),
        );

        const conditional = applyConditionals(expanded, flags, ctx.filename);

        const replaced = conditional.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, name) => {
          if (!(name in tokens)) {
            throw new Error(
              `${ctx.filename}: {{${name}}} is not in site.config.js. Add it or remove the token.`,
            );
          }
          return String(tokens[name]);
        });

        return replaced.replaceAll('@@BASE@@', base);
      },
    },
  };
}

/** robots.txt, sitemap.xml and site.webmanifest are derived from the config. */
function generatedFiles() {
  const files = (base) => {
    const url = (path) => `${SITE.SITE_URL}${base}${path}`;
    const pages = ['', 'pricing', 'privacy', 'terms', 'refund', 'contact', 'changelog'];

    return {
      'robots.txt': {
        type: 'text/plain; charset=utf-8',
        body: `User-agent: *\nAllow: /\n\nSitemap: ${url('sitemap.xml')}\n`,
      },
      'sitemap.xml': {
        type: 'application/xml; charset=utf-8',
        body: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((page) => `  <url>\n    <loc>${url(page)}</loc>\n  </url>`).join('\n')}
</urlset>
`,
      },
      'site.webmanifest': {
        type: 'application/manifest+json; charset=utf-8',
        body: `${JSON.stringify(
          {
            name: SITE.BRAND_NAME,
            short_name: SITE.BRAND_NAME,
            description: SITE.SITE_DESCRIPTION,
            start_url: base,
            scope: base,
            display: 'standalone',
            background_color: '#F5F2EC',
            theme_color: '#1E1B17',
            icons: [
              { src: 'favicon-32.png', sizes: '32x32', type: 'image/png' },
              { src: 'icon-128.png', sizes: '128x128', type: 'image/png' },
              { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
              { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
              { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
            ],
          },
          null,
          2,
        )}\n`,
      },
    };
  };

  let base = '/';
  let out = {};

  return {
    name: 'snapx-generated-files',
    configResolved(config) {
      base = config.base;
      out = files(base);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0].replace(base, '/').replace(/^\//, '');
        const file = out[path];
        if (!file) return next();
        res.setHeader('Content-Type', file.type);
        res.end(file.body);
      });
    },
    /**
     * `vite preview` does not apply Vercel's cleanUrls or 404 handling. Mirror
     * both locally so `/pricing` works and `/nope` returns 404.html with a 404.
     */
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();

        const [rawPath, query] = (req.url || '/').split('?');
        let path;
        try {
          path = decodeURIComponent(rawPath);
        } catch {
          return next();
        }

        if (!path.startsWith(base)) return next();
        const rel = path.slice(base.length).replace(/\/+$/, '');
        if (!rel || rel.endsWith('.html') || /\.[a-z0-9]+$/i.test(rel)) return next();

        const clean = resolve(root, 'dist', `${rel}.html`);
        if (existsSync(clean)) {
          req.url = `${base}${rel}.html${query ? `?${query}` : ''}`;
          return next();
        }

        const index = resolve(root, 'dist', rel, 'index.html');
        if (existsSync(index)) return next();

        const missing = resolve(root, 'dist/404.html');
        if (!existsSync(missing)) return next();

        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(req.method === 'HEAD' ? undefined : readFileSync(missing, 'utf8'));
      });
    },
    generateBundle() {
      for (const [name, file] of Object.entries(out)) {
        this.emitFile({ type: 'asset', fileName: name, source: file.body });
      }
    },
  };
}

/**
 * The registered postal address is a legal disclosure, not a warning: a build
 * without it must not ship.
 */
function requiredConfig() {
  return {
    name: 'snapx-required-config',
    apply: 'build',
    buildStart() {
      const address = String(SITE.OPERATOR_POSTAL_ADDRESS || '').trim();
      if (!address || /to be added/i.test(address)) {
        throw new Error(
          'site.config.js: OPERATOR_POSTAL_ADDRESS must be a real registered address. ' +
            'The build cannot ship Contact, Privacy and Terms without it.',
        );
      }
    },
  };
}

function configWarning() {
  return {
    name: 'snapx-config-warning',
    apply: 'build',
    buildStart() {
      if (!UNFILLED.length) return;
      this.warn(
        `site.config.js still has unfilled values: ${UNFILLED.join(', ')}. ` +
          'Fill the required values before launch and the release links when they exist (see docs/CONFIG.md).',
      );
    },
  };
}

export default defineConfig({
  base: normalizeBase(process.env.BASE_PATH),
  // No SPA fallback: unknown paths must reach the real 404, as they do on Vercel.
  appType: 'mpa',
  plugins: [brandHtml(), generatedFiles(), requiredConfig(), configWarning()],
  preview: {
    // Allows a temporary Cloudflare quick-tunnel share of the built site.
    allowedHosts: ['.trycloudflare.com'],
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        pricing: resolve(root, 'pricing.html'),
        privacy: resolve(root, 'privacy.html'),
        terms: resolve(root, 'terms.html'),
        refund: resolve(root, 'refund.html'),
        contact: resolve(root, 'contact.html'),
        changelog: resolve(root, 'changelog.html'),
        login: resolve(root, 'login.html'),
        account: resolve(root, 'account.html'),
        callback: resolve(root, 'auth/callback.html'),
        notfound: resolve(root, '404.html'),
      },
    },
  },
});
