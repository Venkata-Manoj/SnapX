/**
 * Fails the build if any template token survived into dist/.
 * Covers pages, generated robots/sitemap/manifest and bundled assets, so a
 * {{TOKEN}} can never reach production.
 */
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const TEXT = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.xml',
  '.txt',
  '.json',
  '.webmanifest',
  '.svg',
]);
const PATTERN = /\{\{[A-Z0-9_]+\}\}|@@BASE@@/g;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

let scanned = 0;
const hits = [];

try {
  for await (const file of walk(dist)) {
    if (!TEXT.has(extname(file))) continue;
    scanned += 1;
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(PATTERN)) {
      const line = text.slice(0, match.index).split('\n').length;
      hits.push(`${relative(dist, file)}:${line}  ${match[0]}`);
    }
  }
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error('check:placeholders — dist/ not found. Run `npm run build` first.');
    process.exit(1);
  }
  throw error;
}

if (hits.length) {
  console.error(`check:placeholders — ${hits.length} unresolved token(s) in dist/:\n`);
  for (const hit of hits.slice(0, 40)) console.error(`  ${hit}`);
  if (hits.length > 40) console.error(`  …and ${hits.length - 40} more`);
  process.exit(1);
}

console.log(`check:placeholders — clean (${scanned} files scanned, 0 tokens).`);
