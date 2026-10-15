// sky-preview.js — headless PNG renders of the animated backdrop for visual
// QA (no display needed). Writes tests/out/sky-*.png.
import Cairo from 'gi://cairo?version=1.0';
import Pango from 'gi://Pango?version=1.0';
import PangoCairo from 'gi://PangoCairo?version=1.0';
import { createSky, paintSky, sampleSky, bodyOf } from '../src/sky.js';
import { pickInk, INK_DARK, INK_LIGHT } from '../src/ink.js';

const W = 330, H = 430;

function render(file, opts, secs) {
    const sky = createSky();
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, W, H);
    const cr = new Cairo.Context(surf);
    // advance the particle sim to a lively frame
    for (let t = 0; t <= secs; t += 0.05)
        paintSky(cr, { ...opts, w: W, h: H, time: t, sky });
    cr.$dispose();
    surf.flush();
    surf.writeToPNG(file);
    print('wrote', file);
}

// --- hero-style ground sampler (mirrors citypage #groundAtPx) ---------------
function groundAt(x, y, o) {
    let rgb = sampleSky(o.scene, o.night, y / H, o.glow ?? 0, o.solar ?? null);
    const b = bodyOf(o.scene, o.night, W, H, o.glow ?? 0, o.solar ?? null, o.phase ?? null);
    if (b) {
        const d = Math.hypot(x - b.x, y - b.y);
        if (d < b.r + b.soft) {
            const fall = 1 - Math.max(0, d - b.r) / b.soft;
            rgb = rgb.map((c, i) => c + (b.col[i] - c) * fall * b.max);
        }
    }
    return rgb;
}

function inkLabel(cr, text, x, y, size, bg) {
    const ink = pickInk(bg) === INK_DARK ? INK_DARK : INK_LIGHT;
    cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
    cr.setFontSize(size);
    const lay = PangoCairo.create_layout(cr);
    lay.set_font_description(Pango.FontDescription.from_string(`Bold ${size}`));
    lay.set_text(text, -1);
    cr.moveTo(x, y);
    const [r, g, bl] = ink;
    cr.setSourceRGBA(ink === INK_DARK ? 0.063 : 1, ink === INK_DARK ? 0.094 : 1, ink === INK_DARK ? 0.137 : 1, 1);
    void r; void g; void bl;
    PangoCairo.show_layout(cr, lay);
}

function cardMock(cr, x, y, w, h, dark) {
    const [r, g, b, a] = dark ? [0.05, 0.06, 0.09, 0.52] : [1, 1, 1, 0.55];
    const rr = 12, k = 0.5523 * rr;
    cr.newPath();
    cr.moveTo(x + rr, y);
    cr.lineTo(x + w - rr, y); cr.curveTo(x + w - rr + k, y, x + w, y + rr - k, x + w, y + rr);
    cr.lineTo(x + w, y + h - rr); cr.curveTo(x + w, y + h, x + w - rr + k, y + h, x + w - rr, y + h);
    cr.lineTo(x + rr, y + h); cr.curveTo(x, y + h, x, y + h - rr + k, x, y + h - rr);
    cr.lineTo(x, y + rr); cr.curveTo(x, y + rr - k, x + rr - k, y, x + rr, y);
    cr.closePath();
    cr.setSourceRGBA(r, g, b, a);
    cr.fillPreserve();
    cr.setSourceRGBA(1, 1, 1, 0.15);
    cr.setLineWidth(1);
    cr.stroke();
}

// -- scenes ------------------------------------------------------------------
render('tests/out/sky-noon.png',
    { scene: 'clear', night: false, glow: 0, solar: 1 }, 9);
render('tests/out/sky-twilight.png',
    { scene: 'clear', night: false, glow: 0.85, solar: 0.06 }, 9);
render('tests/out/sky-night-fullmoon.png',
    { scene: 'moon', night: true, phase: 0.5 }, 6);
render('tests/out/sky-partly-night.png',
    { scene: 'partly', night: true, phase: 0.15, glow: 0 }, 8);
render('tests/out/sky-rain.png',
    { scene: 'rain', night: false, glow: 0.4, solar: 0.2 }, 4);
render('tests/out/sky-storm-night.png',
    { scene: 'storm', night: true, phase: 0.9 }, 0.3); // catch the flash window
render('tests/out/sky-fog.png',
    { scene: 'fog', night: false, glow: 0 }, 6);
render('tests/out/sky-snow.png',
    { scene: 'snow', night: false, glow: 0 }, 8);

// -- ink-judged hero mock over noon sky (big sun in corner) -----------------
{
    const o = { scene: 'clear', night: false, glow: 0.9, solar: 0.08, phase: null };
    const sky = createSky();
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, W, H);
    const cr = new Cairo.Context(surf);
    for (let t = 0; t <= 9; t += 0.05)
        paintSky(cr, { ...o, w: W, h: H, time: t, sky });
    // hero text: judged at its own ground (left side, away from disc)
    inkLabel(cr, '24°', 130, 40, 52, groundAt(150, 75, o));
    inkLabel(cr, 'Mostly Clear', 130, 100, 15, groundAt(160, 110, o));
    // header-right clock sits ON the glowing disc — verdict must flip
    inkLabel(cr, '18:32', W - 80, 55, 22, groundAt(W - 40, 70, o));
    cardMock(cr, 12, 210, W - 24, 60, false);
    cr.setSourceRGBA(0.1, 0.1, 0.12, 1);
    cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
    cr.setFontSize(12); cr.moveTo(24, 232); cr.showText('glass card over the sky');
    cr.$dispose(); surf.flush(); surf.writeToPNG('tests/out/sky-inkmock.png');
    print('wrote tests/out/sky-inkmock.png');
}

// -- dark-theme variant: dark glass + white ink on rainy night ---------------
{
    const o = { scene: 'rain', night: true, glow: 0, solar: null, phase: 0.3 };
    const sky = createSky();
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, W, H);
    const cr = new Cairo.Context(surf);
    for (let t = 0; t <= 4; t += 0.05)
        paintSky(cr, { ...o, w: W, h: H, time: t, sky });
    cardMock(cr, 12, 210, W - 24, 60, true);
    inkLabel(cr, 'Rain', 24, 40, 16, groundAt(60, 55, o));
    cr.$dispose(); surf.flush(); surf.writeToPNG('tests/out/sky-rainnight.png');
    print('wrote tests/out/sky-rainnight.png');
}

const PAINTER = await import('../src/painter.js');

// -- day tiles straight on the sky (extension slab anatomy) --------------------
{
    void 0;
}
function tilesMock(file, o, theme) {
    const sky = createSky();
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, W, H);
    const cr = new Cairo.Context(surf);
    for (let t = 0; t <= 8; t += 0.05)
        paintSky(cr, { ...o, w: W, h: H, time: t, sky });
    const names = ['Today', 'Thu', 'Fri', 'Sat'];
    const scenes = ['sun', 'rain', 'cloud', 'storm'];
    const X0 = 14, GAP = 5, TW = (W - 2 * X0 - 3 * GAP) / 4, TY = 248, TH = 64;
    const slab = theme === 'dark' ? [16 / 255, 20 / 255, 28 / 255, 0.45] : [1, 1, 1, 0.68];
    for (let i = 0; i < 4; i++) {
        const tx = X0 + i * (TW + GAP);
        const cx = tx + TW / 2, cy = TY + TH / 2;
        const sel = i === 1;
        const ground = groundAt(cx, cy, o);
        const bg = sel ? composite(slab, ground) : ground;
        if (sel) {
            const rr = 12, k = 0.5523 * rr;
            cr.save();
            cr.newPath();
            cr.moveTo(tx + rr, TY);
            cr.lineTo(tx + TW - rr, TY); cr.curveTo(tx + TW - rr + k, TY, tx + TW, TY + rr - k, tx + TW, TY + rr);
            cr.lineTo(tx + TW, TY + TH - rr); cr.curveTo(tx + TW, TY + TH, tx + TW - rr + k, TY + TH, tx + TW - rr, TY + TH);
            cr.lineTo(tx + rr, TY + TH); cr.curveTo(tx, TY + TH, tx, TY + TH - rr + k, tx, TY + TH - rr);
            cr.lineTo(tx, TY + rr); cr.curveTo(tx, TY + rr - k, tx + rr - k, TY, tx + rr, TY);
            cr.closePath();
            cr.setSourceRGBA(...slab);
            cr.fillPreserve();
            cr.setSourceRGBA(theme === 'dark' ? 1 : 16 / 255, theme === 'dark' ? 1 : 24 / 255, theme === 'dark' ? 1 : 35 / 255, theme === 'dark' ? 0.18 : 0.35);
            cr.setLineWidth(1);
            cr.stroke();
            cr.restore();
        }
        const ink = pickInk(bg);
        const [ir, ig, ib] = ink;
        const lum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
        const pale = sel || ink === INK_LIGHT || lum < 0.30;
        cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        cr.setFontSize(10);
        const nm = names[i];
        let ext = cr.textExtents(nm);
        cr.setSourceRGBA(ir, ig, ib, 1);
        cr.moveTo(cx - ext.width / 2, TY + 6); cr.showText(nm);
        // glyph 26px centered
        cr.save();
        cr.translate(cx - 13, TY + 20);
        PAINTER.drawScene(cr, 26, { scene: scenes[i], night: false, pale, intensity: 2, seed: i * 13 + 5 });
        cr.restore();
        cr.setFontSize(10.5);
        const hi = ['29\u00b0', '21\u00b0', '24\u00b0', '18\u00b0'][i];
        const lo = ['19\u00b0', '15\u00b0', '17\u00b0', '11\u00b0'][i];
        const e1 = cr.textExtents(hi), e2 = cr.textExtents(lo);
        const tot = e1.width + 5 + e2.width;
        let x = cx - tot / 2;
        cr.setSourceRGBA(ir, ig, ib, 1);
        cr.moveTo(x, TY + TH - 15); cr.showText(hi); x += e1.width + 5;
        cr.setSourceRGBA(ir, ig, ib, 0.85);
        cr.moveTo(x, TY + TH - 15); cr.showText(lo);
    }
    cr.$dispose(); surf.flush(); surf.writeToPNG(file);
    print('wrote', file);
}

function composite(tint, dst) {
    const a = tint[3];
    return [0, 1, 2].map(i => tint[i] * a + dst[i] * (1 - a));
}

tilesMock('tests/out/sky-tiles-day.png',
    { scene: 'clear', night: false, glow: 0.35, solar: 0.75, phase: null }, 'light');
tilesMock('tests/out/sky-tiles-night.png',
    { scene: 'clear', night: true, glow: 0.9, solar: null, phase: 0.5 }, 'dark');
print('done');
