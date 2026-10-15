// perf-sky.js — CPU paint throughput for the backdrop (image-surface path,
// ~ what Cairo costs per frame before GSK upload). Run: gjs -m tests/perf-sky.js
import Cairo from 'gi://cairo?version=1.0';
import GLib from 'gi://GLib?version=2.0';
import { createSky, paintSky } from '../src/sky.js';

const W = 1200, H = 760, FRAMES = 240;
function bench(label, opts) {
    // min-of-3 reps: the box idles unpredictably; the fastest rep is the
    // honest cost, medians get inflated by whoever else is compiling
    const runs = [];
    let sky;
    for (let rep = 0; rep < 3; rep++) {
        sky = createSky();
        const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, W, H);
        const cr = new Cairo.Context(surf);
        paintSky(cr, { ...opts, w: W, h: H, time: 0, sky }); // warm + build
        const t0 = GLib.get_monotonic_time();
        for (let i = 1; i <= FRAMES; i++)
            paintSky(cr, { ...opts, w: W, h: H, time: i / 20, sky });
        runs.push((GLib.get_monotonic_time() - t0) / 1000 / FRAMES);
    }
    const ms = Math.min(...runs);
    print(`${label.padEnd(14)} ${ms.toFixed(2)} ms/frame  (${(1000 / ms).toFixed(0)} fps headroom)  builds/240fr=${sky.builds}`);
}
bench('clear noon', { scene: 'clear', night: false, glow: 0, solar: 1 });
bench('clear dawn', { scene: 'clear', night: false, glow: 0.9, solar: 0.08 });
bench('storm night', { scene: 'storm', night: true, phase: 0.5 });
bench('rain dusk', { scene: 'rain', night: false, glow: 0.6, solar: 0.3 });
bench('partly night', { scene: 'partly', night: true, phase: 0.5, glow: 0 });
