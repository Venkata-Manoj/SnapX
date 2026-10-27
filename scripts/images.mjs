// One-off asset pipeline. Run with `npm run images`.
// Source: snapx-site-assets/ → public/
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'snapx-site-assets');
const pub = path.join(root, 'public');

const ensure = (p) => mkdir(p, { recursive: true });

async function main() {
  await Promise.all([
    ensure(path.join(pub, 'img')),
    ensure(path.join(pub, 'fonts')),
  ]);

  // Screenshots: 2× PNG (680 px wide) → AVIF + WebP at 680.
  const shots = ['popup-on-camera', 'popup-hidden'];
  for (const name of shots) {
    const input = path.join(src, 'screenshots', `${name}.png`);
    const meta = await sharp(input).metadata();
    if (meta.width !== 680) console.warn(`note: ${name} is ${meta.width}px wide`);

    await copyFile(input, path.join(pub, 'img', `${name}.png`));
    await sharp(input)
      .avif({ quality: 55, effort: 6 })
      .toFile(path.join(pub, 'img', `${name}.avif`));
    await sharp(input)
      .webp({ quality: 82, effort: 5 })
      .toFile(path.join(pub, 'img', `${name}.webp`));
  }

  // Favicons.
  await copyFile(
    path.join(src, 'logo', 'snapx-app-icon.svg'),
    path.join(pub, 'favicon.svg'),
  );
  await copyFile(path.join(src, 'icons', 'icon32.png'), path.join(pub, 'favicon-32.png'));
  await copyFile(path.join(src, 'og', 'og-image.png'), path.join(pub, 'og-image.png'));
  await copyFile(
    path.join(src, 'logo', 'snapx-app-icon.svg'),
    path.join(pub, 'icon.svg'),
  );

  // Apple touch icon: 180×180 on an ink field, 18px padding.
  const icon = await sharp(path.join(src, 'icons', 'icon128.png'))
    .resize(144, 144, { kernel: 'lanczos3' })
    .toBuffer();
  await sharp({
    create: {
      width: 180,
      height: 180,
      channels: 4,
      background: '#1E1B17',
    },
  })
    .composite([{ input: icon, top: 18, left: 18 }])
    .png()
    .toFile(path.join(pub, 'apple-touch-icon.png'));

  // 512 manifest icon from the SVG tile.
  await sharp(path.join(src, 'logo', 'snapx-app-icon.svg'), { density: 600 })
    .resize(512, 512)
    .png()
    .toFile(path.join(pub, 'icon-512.png'));

  // 128 manifest icon.
  await copyFile(path.join(src, 'icons', 'icon128.png'), path.join(pub, 'icon-128.png'));

  // Fonts + licence.
  const fonts = [
    'IBMPlexMono-normal-400.woff2',
    'IBMPlexMono-normal-500.woff2',
    'InstrumentSans-normal-400.woff2',
    'InstrumentSans-normal-500.woff2',
    'InstrumentSans-normal-600.woff2',
    'InstrumentSans-normal-700.woff2',
    'InstrumentSerif-italic-400.woff2',
    'InstrumentSerif-normal-400.woff2',
  ];
  for (const f of fonts) {
    await copyFile(path.join(src, 'fonts', f), path.join(pub, 'fonts', f));
  }

  console.log('images + assets written to public/');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
