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
// clear-night (San Francisco case): full star field + moon, NO cloud
// masking — plus HiDPI sizes: GTK renders the cairo draw func at DEVICE
// resolution, so a 1400x950 logical window at 2x paints 2800x1900.
function benchSize(label, opts, W2, H2) {
    const W = W2, H = H2;
    const runs = [];
    let sky;
    for (let rep = 0; rep < 3; rep++) {
        sky = createSky();
        const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, W, H);
        const cr = new Cairo.Context(surf);
        paintSky(cr, { ...opts, w: W, h: H, time: 0, sky });
        const t0 = GLib.get_monotonic_time();
        for (let i = 1; i <= 60; i++)
            paintSky(cr, { ...opts, w: W, h: H, time: i / 20, sky });
        runs.push((GLib.get_monotonic_time() - t0) / 1000 / 60);
    }
    print(`${label.padEnd(22)} ${Math.min(...runs).toFixed(2)} ms/frame  builds=${sky.builds}`);
}
benchSize('clear night 1400x950', { scene: 'clear', night: true, phase: 0.62, solar: 0.2 }, 1400, 950);
benchSize('night 2800x1900 (STRESS', { scene: 'clear', night: true, phase: 0.62, solar: 0.2 }, 2800, 1900);
benchSize('noon 2800x1900 (STRESS', { scene: 'clear', night: false, glow: 0, solar: 1 }, 2800, 1900);
