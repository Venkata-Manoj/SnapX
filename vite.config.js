import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const partialsDir = resolve(root, 'src/partials');

function normalizeBase(value) {
  if (!value || value === '/') return '/';
  const withLead = value.startsWith('/') ? value : `/${value}`;
  return withLead.endsWith('/') ? withLead : `${withLead}/`;
}

/** Inlines <!-- @include header.html --> and resolves @@BASE@@ for GitHub Pages. */
function partials() {
  let base = '/';
  return {
    name: 'snapx-partials',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const expanded = html.replace(
          /<!--\s*@include\s+([\w.-]+)\s*-->/g,
          (_, file) => readFileSync(resolve(partialsDir, file), 'utf8'),
        );
        return expanded.replaceAll('@@BASE@@', base);
      },
    },
  };
}

export default defineConfig({
  base: normalizeBase(process.env.BASE_PATH),
  plugins: [partials()],
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        privacy: resolve(root, 'privacy.html'),
        changelog: resolve(root, 'changelog.html'),
        notfound: resolve(root, '404.html'),
      },
    },
  },
});
