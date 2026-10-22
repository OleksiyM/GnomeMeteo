/* tests/motion-frames.mjs -- animated-motion regression frames.
 *
 * The static matrix cannot see choreography, and two shipped bugs
 * lived exactly there: rain that bunched into side-to-side marching
 * waves (lane reseeding on near-equal periods) and a storm bolt
 * that was simply absent ~90% of each flash cycle. This renders
 * timed frames of both scenes on the dusk ground to
 * tools/out/motion/motion.png + manifest; certify-pixels.py --motion
 * grades lane occupancy and bolt presence from the pixels.
 */
import Cairo from 'gi://cairo';
import GLib from 'gi://GLib';
import { paintWeather, createParticles, GRID } from '../painter.js';

const OUT = 'tools/out/motion';
GLib.mkdir_with_parents(`${GLib.get_current_dir()}/${OUT}`, 0o755);

const CELL = 96, PAD = 6;
const ROWS = [
    // heavy-rain tier: all four lanes should be raining in every frame
    { kind: 'rain', pose: { scene: 'rain', intensity: 3 },
        times: Array.from({ length: 10 }, (_, k) => 2.0 + k * 0.12) },
    // flash baseline (0-52% of the 3.6s cycle): bolt present at 22%
    { kind: 'storm-base', pose: { scene: 'storm', intensity: 3 },
        times: [0.0, 0.9, 1.8] },
    // flash bursts (58% and 68%): bolt at full opacity
    { kind: 'storm-burst', pose: { scene: 'storm', intensity: 3 },
        times: [2.09, 2.45] },
];
const cols = Math.max(...ROWS.map(r => r.times.length));
const w = cols * (CELL + PAD) + PAD, h = ROWS.length * (CELL + PAD) + PAD;
const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, w, h);
const cr = new Cairo.Context(surf);
const particles = createParticles();
const cells = [];
ROWS.forEach((row, r) => {
    row.times.forEach((t, c) => {
        const x = PAD + c * (CELL + PAD), y = PAD + r * (CELL + PAD);
        cr.setSourceRGB(0.36, 0.40, 0.47);   // 'dusk' ground of the static matrix
        cr.rectangle(x, y, CELL, CELL);
        cr.fill();
        cr.save();
        cr.translate(x, y);
        cr.scale(CELL / GRID, CELL / GRID);
        paintWeather(cr, { ...row.pose, time: t, dark: true, night: true,
            windKmh: 12, phase: 0.25, groundLum: 0.23, pale: true,
            staticPose: false, particles });
        cr.restore();
        cells.push({ png: 'motion.png', kind: row.kind, x, y, size: CELL, t });
    });
});
surf.writeToPNG(`${OUT}/motion.png`);
GLib.file_set_contents(`${OUT}/manifest.json`,
    new TextEncoder().encode(JSON.stringify({ cells }, null, 1)));
print(`motion: ${cells.length} frames -> ${OUT}/manifest.json`);
