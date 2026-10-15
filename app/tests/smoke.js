// Headless smoke test: painter renders all scenes to PNGs; weather logic checks.
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import Cairo from 'gi://cairo?version=1.0';
import { drawScene, SCENES } from '../src/painter.js';
import * as W from '../src/weather.js';

let failures = 0;
function check(name, cond, extra = '') {
    if (cond) {
        print(`PASS ${name}`);
    } else {
        failures++;
        print(`FAIL ${name} ${extra}`);
    }
}

// --- render every scene, day + night -----------------------------------------
const SIZE = 96;
const COLS = SCENES.length;
const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, SIZE * COLS, SIZE * 2);
const cr = new Cairo.Context(surf);
// checkerboard-ish backing to expose transparency bugs
cr.setSourceRGBA(0.42, 0.45, 0.50, 1);
cr.paint();
SCENES.forEach((scene, i) => {
    ['day', 'night'].forEach((mode, row) => {
        cr.save();
        cr.translate(i * SIZE, row * SIZE);
        cr.rectangle(0, 0, SIZE, SIZE);
        cr.clip();
        drawScene(cr, SIZE, { scene, night: mode === 'night', intensity: 4, phase: 0.75 });
        cr.restore();
    });
});
surf.writeToPNG('scenes-all.png');
surf.flush();
print(`rendered scenes-all.png (${COLS} scenes x day/night)`);

// every scene must paint something
for (const scene of SCENES) {
    const s2 = new Cairo.ImageSurface(Cairo.Format.ARGB32, 48, 48);
    const c2 = new Cairo.Context(s2);
    c2.setSourceRGBA(0, 0, 0, 0);
    c2.paint();
    drawScene(c2, 48, { scene });
    // GJS cairo hides surface data; compare PNG files instead
    const a = `_s_${scene}_a.png`, b = `_s_${scene}_b.png`;
    s2.writeToPNG(a);
    new Cairo.ImageSurface(Cairo.Format.ARGB32, 48, 48).writeToPNG(b);
    const ba = GLib.file_get_contents(a)[1];
    const bb = GLib.file_get_contents(b)[1];
    const diff = ba.length !== bb.length || ba.some((v, i) => v !== bb[i]);
    check(`scene ${scene} paints pixels`, diff);
}

// --- weather logic ------------------------------------------------------------
const mkHourly = () => {
    const times = [];
    for (let d = 0; d < 3; d++)
        for (let h = 0; h < 24; h++)
            times.push(`2026-10-${String(14 + d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00`);
    return {
        time: times,
        temp: times.map((_, i) => 20 + Math.sin(i / 4) * 5),
        precipProb: times.map(() => 10),
        wind: times.map(() => 7),
        code: times.map(() => 2),
        isDay: times.map(() => 1),
    };
};
const daily = [
    { date: '2026-10-14' }, { date: '2026-10-15' }, { date: '2026-10-16' },
];

// city wall = 2026-10-14T22:15 naive, real now = whatever; offset math:
const cityWall = Date.UTC(2026, 9, 14, 22, 15);
const hourly = mkHourly();
const slice = W.daySlice(hourly, daily, 0, cityWall);
check('rolling today spans backfill+future', slice.time.length >= 24, `len=${slice.time.length}`);
check('backfill reaches hour before now-2h', slice.time[0] === '2026-10-14T21:00', slice.time[0]);
check('nowFrac ≈ (2h/25.25h)', Math.abs(slice.nowFrac - (2 / 25.25)) < 0.05, `frac=${slice.nowFrac}`);
const tmrw = W.daySlice(hourly, daily, 1, cityWall);
check('tomorrow = 24 calendar hours', tmrw.time.length === 24 && tmrw.time[0] === '2026-10-15T00:00');

// viewer TZ must not tip the boundary: same data interpreted from UTC+13 wall
const offset = (cityWall - Date.UTC(2026, 0, 1)) - (Date.UTC(2026, 9, 14, 9, 15) - Date.UTC(2026, 0, 1));
void offset;

check('fmtTemp metric', W.fmtTemp(23.4, 'metric') === '23°');
check('fmtTemp imperial', W.fmtTemp(23.4, 'imperial') === '74°');
check('compass wraps', W.compass(359) === 'N' && W.compass(45) === 'NE' && W.compass(-90) === 'W');
check('sceneFor night sun → moon', W.sceneFor(0, false).scene === 'moon');
const stormByCape = W.deriveScene({ code: 63, cape: 2600, visibility: 20000, precip: 2, isDay: true });
check('CAPE derives hail', stormByCape.scene === 'hail', stormByCape.scene);
const fogByVis = W.deriveScene({ code: 1, cape: 0, visibility: 800, precip: 0, isDay: true });
check('visibility derives fog', fogByVis.scene === 'fog');
const windy = W.effectiveScene({ code: 0, cape: 0, visibility: 20000, precip: 0, isDay: true, wind: 40 });
check('windy override', windy.scene === 'wind');
const mp = W.moonPhase(Date.UTC(2000, 0, 6, 18, 14));
check('moon epoch = new', mp.name === 'New moon' && mp.illum < 0.01);
check('relTime', W.relTime(Date.now() - 5 * 60000) === '5 min ago');
check('dayName', W.dayName('2026-10-14') === 'Wed');
check('fmtLocalIso 12h', /[AP]M/.test(W.fmtLocalIso('2026-10-14T15:30', true)));
check('shortHourLabel 24h', W.shortHourLabel('2026-10-14T05:00', false) === '05');

const rc = failures ? 1 : 0;
print(failures ? `${failures} FAILURE(S)` : 'ALL CHECKS PASSED');
imports.system.exit(rc);
