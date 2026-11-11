import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const resources = path.join(root, 'resources');
mkdirSync(resources, { recursive: true });

function iconSvg({ rounded, scale = 1 }) {
  const art = `
    <rect x="168" y="118" width="236" height="180" rx="26" fill="#ffffff" opacity="0.26"/>
    <rect x="116" y="146" width="280" height="220" rx="30" fill="#ffffff"/>
    <g>
      <rect x="132" y="162" width="248" height="188" rx="18" fill="url(#sky)"/>
      <circle cx="196" cy="216" r="24" fill="#f59e0b"/>
      <path d="M132 350 L206 276 L272 342 L318 296 L380 358 L380 350 Z" fill="#64748b" opacity="0.5"/>
      <path d="M132 350 L206 276 L272 342 L318 296 L380 358 L132 358 Z" fill="#475569"/>
    </g>
    <circle cx="352" cy="322" r="70" fill="rgba(15,23,42,0.18)"/>
    <circle cx="352" cy="322" r="64" fill="none" stroke="#ffffff" stroke-width="22"/>
    <circle cx="352" cy="322" r="52" fill="url(#lens)"/>
    <line x1="400" y1="370" x2="446" y2="416" stroke="#ffffff" stroke-width="28" stroke-linecap="round"/>`;

  const roundedBg = `
    <rect width="512" height="512" fill="url(#bg)"/>
    <g clip-path="url(#round)">
      <rect width="512" height="512" fill="url(#bg)"/>`;

  const body = rounded
    ? `<g clip-path="url(#round)">
        <rect width="512" height="512" fill="url(#bg)"/>
        <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${art}</g>
      </g>`
    : `<rect width="512" height="512" fill="url(#bg)"/>
       <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${art}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6d4dff"/>
      <stop offset="0.55" stop-color="#8b3df0"/>
      <stop offset="1" stop-color="#c026d3"/>
    </linearGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#dbeafe"/>
      <stop offset="1" stop-color="#ede9fe"/>
    </linearGradient>
    <linearGradient id="lens" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7dd3fc" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#a78bfa" stop-opacity="0.6"/>
    </linearGradient>
    <clipPath id="round"><rect x="16" y="16" width="480" height="480" rx="112"/></clipPath>
  </defs>
  ${body}
</svg>`;
}

/** Только графика без фона — для adaptive-icon foreground в Android. */
function foregroundSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#dbeafe"/>
      <stop offset="1" stop-color="#ede9fe"/>
    </linearGradient>
    <linearGradient id="lens" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7dd3fc" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#a78bfa" stop-opacity="0.6"/>
    </linearGradient>
  </defs>
  <g transform="translate(256 256) scale(0.66) translate(-256 -256)">
    <rect x="168" y="118" width="236" height="180" rx="26" fill="#ffffff" opacity="0.3"/>
    <rect x="116" y="146" width="280" height="220" rx="30" fill="#ffffff"/>
    <rect x="132" y="162" width="248" height="188" rx="18" fill="url(#sky)"/>
    <circle cx="196" cy="216" r="24" fill="#f59e0b"/>
    <path d="M132 350 L206 276 L272 342 L318 296 L380 358 L132 358 Z" fill="#475569"/>
    <circle cx="352" cy="322" r="70" fill="rgba(15,23,42,0.15)"/>
    <circle cx="352" cy="322" r="64" fill="none" stroke="#ffffff" stroke-width="22"/>
    <circle cx="352" cy="322" r="52" fill="url(#lens)"/>
    <line x1="400" y1="370" x2="446" y2="416" stroke="#ffffff" stroke-width="28" stroke-linecap="round"/>
  </g>
</svg>`;
}

const svgMain = iconSvg({ rounded: true });
const svgFull = iconSvg({ rounded: false });
const svgMaskable = iconSvg({ rounded: false, scale: 0.8 });
const svgForeground = foregroundSvg();

writeFileSync(path.join(resources, 'icon.svg'), svgMain + '\n');
writeFileSync(path.join(resources, 'icon-maskable.svg'), svgMaskable + '\n');
writeFileSync(path.join(resources, 'icon-foreground.svg'), svgForeground + '\n');

function render(svg, size, out) {
  const tmp = path.join(resources, `.tmp-${size}-${path.basename(out)}.svg`);
  writeFileSync(tmp, svg);
  mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), '-o', out, tmp], {
    stdio: 'pipe',
  });
}

const iconsDir = path.join(root, 'public', 'icons');
render(svgMain, 192, path.join(iconsDir, 'icon-192.png'));
render(svgMain, 512, path.join(iconsDir, 'icon-512.png'));
render(svgMaskable, 512, path.join(iconsDir, 'icon-512-maskable.png'));
render(svgFull, 180, path.join(iconsDir, 'apple-touch-icon.png'));
render(svgMain, 32, path.join(root, 'public', 'favicon-32.png'));
writeFileSync(path.join(root, 'public', 'favicon.svg'), svgMain + '\n');

// Android (если проект уже добавлен)
const androidRes = path.join(root, 'android', 'app', 'src', 'main', 'res');
const densities = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};
const fgDensities = {
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432,
};
if (existsSync(androidRes)) {
  for (const [d, size] of Object.entries(densities)) {
    render(svgMain, size, path.join(androidRes, `mipmap-${d}`, 'ic_launcher.png'));
    render(svgFull, size, path.join(androidRes, `mipmap-${d}`, 'ic_launcher_round.png'));
  }
  for (const [d, size] of Object.entries(fgDensities)) {
    render(svgForeground, size, path.join(androidRes, `mipmap-${d}`, 'ic_launcher_foreground.png'));
  }
  writeFileSync(
    path.join(androidRes, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#6D4DFF</color>
</resources>
`,
  );
  console.log('Android icons written to', androidRes);
}

console.log('Icons generated in public/icons');
