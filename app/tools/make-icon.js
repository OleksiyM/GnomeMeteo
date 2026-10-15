// make-icon.js — render the app icon from the REAL extension art pipeline
// (paintSky + drawScene), so the grid icon is the extension's own visual
// identity, not a transcription. Writes data/icons/*.png; install.sh ships
// them into hicolor.
//
//   gjs -m tools/make-icon.js
import Cairo from 'gi://cairo?version=1.0';
import { createSky, paintSky } from '../src/sky.js';
import { drawScene } from '../src/painter.js';

const M = 1024;

function roundedClip(cr, x, y, w, h, r) {
    const k = 0.5523 * r;
    cr.newPath();
    cr.moveTo(x + r, y);
    cr.lineTo(x + w - r, y);
    cr.curveTo(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
    cr.lineTo(x + w, y + h - r);
    cr.curveTo(x + w, y + h, x + w - r + k, y + h, x + w - r, y + h);
    cr.lineTo(x + r, y + h);
    cr.curveTo(x, y + h, x, y + h - r + k, x, y + h - r);
    cr.lineTo(x, y + r);
    cr.curveTo(x, y + r - k, x + r - k, y, x + r, y);
    cr.closePath();
}

const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, M, M);
const cr = new Cairo.Context(surf);

// Badge: a twilight sky — the app's signature — as a squircle.
// Scene 'cloud' has no celestial body competing with the glyph; the glow
// warms the horizon like every golden hour in the popup.
paintSky(cr, {
    w: M, h: M, time: 3.2, scene: 'clear', night: false,
    glow: 0.8, solar: null, phase: null, radius: M * 0.235,
    quiet: true,
    sky: createSky(),
});

// Hairline rim, slightly brighter at top
roundedClip(cr, 8, 8, M - 16, M - 16, M * 0.235 - 8);
const rim = new Cairo.LinearGradient(0, 0, 0, M);
rim.addColorStopRGBA(0, 1, 1, 1, 0.28);
rim.addColorStopRGBA(1, 1, 1, 1, 0.08);
cr.setSource(rim);
cr.setLineWidth(14);
cr.stroke();

// The glyph: 'partly', sun crowning over cloud — the franchise pose.
const G = 700;
cr.save();
cr.translate((M - G) / 2, (M - G) / 2 + 28);
drawScene(cr, G, { scene: 'partly', night: false, intensity: 2, seed: 7 });
cr.restore();

surf.flush();
surf.writeToPNG('data/icons/dev.vijaybala.weatherglass-1024.png');

// Downscale ladder (Gaussian via cairo's GOOD filter)
for (const s of [512, 256, 128, 96, 64, 48, 32]) {
    const t = new Cairo.ImageSurface(Cairo.Format.ARGB32, s, s);
    const tc = new Cairo.Context(t);
    tc.scale(s / M, s / M);
    tc.setSourceSurface(surf, 0, 0);
    tc.paint();
    t.flush();
    t.writeToPNG(`data/icons/dev.vijaybala.weatherglass-${s}.png`);
}
print('icons written to data/icons/');
