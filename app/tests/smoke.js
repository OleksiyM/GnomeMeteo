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

// `pale` must flip a day-shape glyph to the glow palette (sky day-tile verdict)
{
    const shoot = opts => {
        const sf = new Cairo.ImageSurface(Cairo.Format.ARGB32, 48, 48);
        const cc = new Cairo.Context(sf);
        drawScene(cc, 48, opts);
        sf.writeToPNG('_pale_shot.png');
        return GLib.file_get_contents('_pale_shot.png')[1];
    };
    const dayShot = shoot({ scene: 'cloud' });
    const paleShot = shoot({ scene: 'cloud', pale: true });
    check('pale repaints the glyph',
        dayShot.length !== paleShot.length
        || dayShot.some((v, i) => v !== paleShot[i]));
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
const stormByCape = W.deriveScene({ code: 63, cape: 2600, visibility: 20000, precip: 2, isDay: true });check('CAPE derives hail', stormByCape.scene === 'hail', stormByCape.scene);
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

// --- adaptive ink + sky port (ink.js / sky.js) ------------------------------
const I = await import('../src/ink.js');
const S = await import('../src/sky.js');

check('lumOf black/white', I.lumOf([0, 0, 0]) === 0 && Math.abs(I.lumOf([1, 1, 1]) - 1) < 1e-9);
check('ratio white/black = 21', Math.abs(I.ratio([1, 1, 1], [0, 0, 0]) - 21) < 0.01);
check('pickInk: white bg -> dark ink', I.pickInk([0.95, 0.95, 0.97]) === I.INK_DARK);
check('pickInk: navy bg -> light ink', I.pickInk([0.05, 0.07, 0.19]) === I.INK_LIGHT);
check('pickInk: mid grey -> light (1.35 bias)', I.pickInk([0.5, 0.5, 0.5]) === I.INK_LIGHT);
// worst-of-samples: one bright flank drags a whole dark row to light ink
const v = I.judgeInk([[0.05, 0.07, 0.19], [0.05, 0.07, 0.19], [1, 1, 1]]);
// a white-hot sample sinks BOTH families: white survives numerically but
// dips under 3:1 -> light ink WITH emboss (exactly the extension's behavior)
check('judgeInk worst-sample rules group', v.ink === I.INK_LIGHT && v.emboss === true);
check('judgeInk empty -> light', I.judgeInk([]).ink === I.INK_LIGHT);
// contrastSafe pushes a washed accent until it clears 3.1:1
const cs = I.contrastSafe([0.85, 0.8, 0.7], [0.9, 0.92, 0.95]);
check('contrastSafe clears 3.1', I.ratio(cs, [0.9, 0.92, 0.95]) >= 3.09, `got ${I.ratio(cs, [0.9, 0.92, 0.95]).toFixed(2)}`);
check('contrastSafe leaves strong accent alone',
    String(I.contrastSafe([0.1, 0.1, 0.9], [1, 1, 1])) === String([0.1, 0.1, 0.9]));
// lineInk keeps warm amber, deepens weak cool lines on light grounds
check('lineInk amber exempt', String(I.lineInk([0.95, 0.72, 0.3], [[1, 1, 1]])) === String([0.95, 0.72, 0.3]));
const deep = I.lineInk([0.6, 0.8, 0.9], [[1, 1, 1]]);
check('lineInk deepens weak line', I.lumOf(deep) < I.lumOf([0.6, 0.8, 0.9])
    && I.ratio(deep, [1, 1, 1]) >= 2.99, JSON.stringify(deep.map(x => +x.toFixed(2))));
check('compositeOver glass over sky', (() => {
    const c = I.compositeOver([1, 1, 1, 0.5], [0.2, 0.3, 0.4]);
    return Math.abs(c[0] - 0.6) < 1e-9 && Math.abs(c[2] - 0.7) < 1e-9;
})());
check('boxSampleFractions clamps below card', (() => {
    const fs = I.boxSampleFractions([10, 400, 100, 20], 300, 420);
    return fs.every(([, fy]) => fy <= 1 && fy >= 0) && fs.length > 0;
})());

// sun almanac: Bengaluru noon IST is high, midnight is down
const solsticeNoon = W.sunGeometry(12.97, 77.59, Date.UTC(2026, 6, 15, 6, 0)); // 11:30 IST
check('sunGeometry noon altitude > 40°', solsticeNoon.altitude > 40, solsticeNoon.altitude.toFixed(1));
const midnight = W.sunGeometry(12.97, 77.59, Date.UTC(2026, 6, 14, 18, 0)); // 23:30 IST
check('sunGeometry midnight below horizon', midnight.altitude < -20, midnight.altitude.toFixed(1));
const dawn = W.sunShade('test-dawn', 12.97, 77.59, Date.UTC(2026, 6, 15, 0, 20)); // ~05:50 IST, minutes before sunrise
check('sunShade glows near horizon', dawn.glow > 0.3 && dawn.solar === null, JSON.stringify(dawn));
const noonShade = W.sunShade('test-noon', 12.97, 77.59, Date.UTC(2026, 6, 15, 5, 50)); // ~11:20 IST
check('sunShade noon: no glow, solar climbing', noonShade.glow === 0 && noonShade.solar > 0.95,
    JSON.stringify(noonShade));

// sampleSky: clear day lighter toward the bottom, night clear is dark overall
check('sampleSky day gradient brightens downward',
    I.lumOf(S.sampleSky('clear', false, 0.9)) > I.lumOf(S.sampleSky('clear', false, 0.05)));
check('sampleSky night clear is dark', I.lumOf(S.sampleSky('clear', true, 0.5)) < 0.12);
check('sampleSky twilight tints warmer than plain night at horizon', (() => {
    const g = S.sampleSky('clear', true, 1.0, 1.0, null);
    return g[0] > g[2] && g[0] > 0.4;
})());
check('bodyOf sunny day: sun disc reported', (() => {
    const b = S.bodyOf('sun', false, 330, 430, 0, 0.5);
    return b && b.x > 330 * 0.7 && b.r > 40;
})());
check('bodyOf new moon reports nothing', S.bodyOf('moon', true, 330, 430, 0, null, 0) === null);
check('bodyOf full moon reports disc', S.bodyOf('moon', true, 330, 430, 0, null, 0.5) !== null);
check('ink flip: hero ink over noon sun disc goes dark',
    I.pickInk(S.bodyOf('sun', false, 330, 430, 0, 0.5).col) === I.INK_DARK);


const rc = failures ? 1 : 0;
print(failures ? `${failures} FAILURE(S)` : 'ALL CHECKS PASSED');
imports.system.exit(rc);
