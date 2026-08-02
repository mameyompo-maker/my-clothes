// One-off script to rasterize the app icon SVG into the PNG sizes the PWA manifest needs.
// Run with: node scripts/generate-icons.mjs
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const outDir = path.join(process.cwd(), "public", "icons");
await mkdir(outDir, { recursive: true });

const glyph = (scale, offsetX, offsetY) =>
  `<path transform="translate(${offsetX},${offsetY}) scale(${scale})" d="M70,45 L85,45 Q100,58 115,45 L130,45 L157,70 L136,88 L128,78 L128,158 L72,158 L72,78 L64,88 L43,70 Z" fill="#ffffff"/>`;

function iconSvg({ maskable = false }) {
  const scale = maskable ? 0.62 : 0.82;
  const contentSize = 200 * scale;
  const offset = (200 - contentSize) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <rect width="200" height="200" fill="#ff5a5f"/>
    ${glyph(scale, offset, offset)}
  </svg>`;
}

const targets = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180, maskable: false },
];

for (const target of targets) {
  const svg = iconSvg(target);
  await sharp(Buffer.from(svg)).resize(target.size, target.size).png().toFile(path.join(outDir, target.file));
  console.log(`wrote ${target.file}`);
}

await writeFile(path.join(outDir, "source.svg"), iconSvg({ size: 200, maskable: false }));
console.log("done");
