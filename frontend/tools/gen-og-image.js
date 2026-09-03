// Generates frontend/public/og.png — the Open Graph / social share card for
// roadconditions.drumandbytes.ee (1200x630). Mirrors the approach in
// drumandbytes/f1-walk's tools/gen-og-images.js: build an ImageMagick MVG
// (vector) and rasterise with `magick`, no headless browser.
//
// Run manually when the card copy or brand changes; the PNG is committed.
// Requires ImageMagick (`magick`) and the macOS system Helvetica/Arial fonts.
//
// Usage: node tools/gen-og-image.js
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = path.join(import.meta.dirname, '..', 'public', 'og.png');
const FONT = '/System/Library/Fonts/Helvetica.ttc';
const FONT_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';
const W = 1200, H = 630;

const NAVY = '#0F2F4A';   // favicon background
const DEEP = '#0a1c2c';   // lower panel
const ACCENT = '#2E9BFF'; // theme_color
const CYAN = '#6FD3FF';   // favicon signal rays

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// The favicon mark — rounded square, white road-sign triangle, cyan alert
// rays — drawn at (x, y) filling a `size`-wide box. The square gets a slightly
// lighter fill than the card so the icon stays legible against the navy panel.
function logoMark(x, y, size) {
  const s = size / 48; // favicon viewBox is 48x48
  const p = (px, py) => `${(x + px * s).toFixed(1)},${(y + py * s).toFixed(1)}`;
  return `
fill "#1d456a"
roundrectangle ${p(0, 0)} ${p(48, 48)} ${11 * s},${11 * s}
fill "#F4F7FA"
polygon ${p(9, 41)} ${p(23.5, 12)} ${p(39, 41)}
fill "#1d456a"
rectangle ${p(22.8, 33)} ${p(25.2, 40)}
rectangle ${p(23.1, 24)} ${p(24.9, 29.5)}
rectangle ${p(23.4, 17.5)} ${p(24.6, 21)}
stroke "${CYAN}"
stroke-width ${(1.8 * s).toFixed(2)}
stroke-linecap round
line ${p(24, 3.5)} ${p(24, 12.5)}
line ${p(27.9, 5.75)} ${p(20.1, 10.25)}
line ${p(20.1, 5.75)} ${p(27.9, 10.25)}
stroke none`;
}

function checklist(items, startY) {
  const rowH = 51;
  return items.map((text, i) => {
    const cy = startY + i * rowH;
    return `
fill "${ACCENT}"
circle 79,${cy} 90,${cy - 11}
font "${FONT_BOLD}"
font-size 15
fill "#ffffff"
text 73,${cy + 5} "✓"
font "${FONT}"
font-size 22
fill "#cfd8e0"
text 104,${cy + 7} "${esc(text)}"`;
  }).join('\n');
}

// A stylised winding road climbing the right third to a map pin at the top.
function road() {
  const pts = '745,600 910,500 800,395 960,290 892,196';
  const pin = { x: 892, y: 150 };
  return `
push graphic-context
stroke "#23425f"
stroke-width 48
fill none
stroke-linejoin round
stroke-linecap round
polyline ${pts}
stroke "#ffffff"
stroke-width 4
stroke-dasharray 20 24
polyline ${pts}
pop graphic-context

fill "${ACCENT}"
path "M ${pin.x} ${pin.y + 52} C ${pin.x - 34} ${pin.y + 8}, ${pin.x - 30} ${pin.y - 34}, ${pin.x} ${pin.y - 34} C ${pin.x + 30} ${pin.y - 34}, ${pin.x + 34} ${pin.y + 8}, ${pin.x} ${pin.y + 52} Z"
fill "#ffffff"
circle ${pin.x},${pin.y} ${pin.x + 12},${pin.y}`;
}

const mvg = `push graphic-context
viewbox 0 0 ${W} ${H}
fill "${NAVY}"
rectangle 0,0 ${W},312
fill "${DEEP}"
rectangle 0,312 ${W},${H}

${logoMark(60, 52, 92)}

font "${FONT_BOLD}"
font-size 92
fill "#ffffff"
text 176,120 "Teesilm"

font "${FONT}"
font-size 30
fill "${CYAN}"
text 178,168 "Eesti teeolud reaalajas"

font "${FONT}"
font-size 27
fill "#9fb2c2"
text 64,270 "Teeolud · ilmajaamad · liikluskaamerad · hoiatused"

stroke "${ACCENT}"
stroke-width 3
fill none
line 64,360 560,360
stroke none

${checklist([
  'Teeolud ja hoiatused kaardil reaalajas',
  'Täpsed asukohapõhised ohuhoiatused',
  'Tasuta · jälgimisvaba · töötab offline',
], 404)}

font "${FONT}"
font-size 18
fill "#4a5c6c"
text 64,588 "roadconditions.drumandbytes.ee"

${road()}
pop graphic-context
`;

const tmp = path.join('/tmp', `og-teesilm-${Date.now()}.mvg`);
fs.writeFileSync(tmp, mvg);
execFileSync('magick', [`mvg:${tmp}`, '-strip', OUT]);
fs.unlinkSync(tmp);
console.log(`generated ${path.relative(path.join(import.meta.dirname, '..'), OUT)}`);
