// painter.js — procedural weather glyphs on a 24×24 grid, Cairo-only, zero
// image assets (the visual signature of the WeatherGlass extension, redrawn
// for static use: icons draw once per state change, no per-frame timers).
//
// Scene vocabulary: sun moon partly cloud fog wind rain sleet snow hail storm

import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Cairo from 'gi://cairo?version=1.0';

function rgb(hex) {
    return [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255,
    ];
}

const PAL = {
    day: {
        sunInner: '#FFF3B0', sunMid: '#FFC233', sunOuter: '#FF9800', ray: '#FBA41B',
        moon: '#E8EDF5', crater: 'rgba(96,108,130,0.22)',
        cloudHi: '#FFFFFF', cloudLo: '#C9D2DF',
        cloudStormHi: '#8A93A3', cloudStormLo: '#57606F',
        rain: '#4FA3E8', sleet: '#79C0E6', snow: '#EAF4FF', snowLine: '#AEc2D6',
        hail: '#DCEBF7', bolt: '#FFD42B', fog: '#B9C3CF', wind: '#9FB0C2',
    },
    night: {
        sunInner: '#FFE9A8', sunMid: '#F0A93C', sunOuter: '#DB7F1F', ray: '#DB8A26',
        moon: '#DFE6F2', crater: 'rgba(70,82,104,0.25)',
        cloudHi: '#95A2B6', cloudLo: '#57647A',
        cloudStormHi: '#6B7488', cloudStormLo: '#3A4250',
        rain: '#63AEE8', sleet: '#8AC8E4', snow: '#DDEAFF', snowLine: '#8DA3BC',
        hail: '#C4D8EA', bolt: '#FFDE59', fog: '#7C8798', wind: '#8CA0B8',
    },
};

// Deterministic pseudo-random in [0,1) — seeded so static glyphs never
// rearrange themselves between repaints (the extension's golden-seed trick).
function rnd(seed, n) {
    const x = Math.sin((n + 1) * 127.1 + (seed + 1) * 311.7) * 43758.5453;
    return x - Math.floor(x);
}

function col(cr, token, alpha = 1) {
    if (token.startsWith('rgba')) {
        const [r, g, b, a] = token.match(/[\d.]+/g).map(Number);
        cr.setSourceRGBA(r / 255, g / 255, b / 255, a * alpha);
    } else {
        const [r, g, b] = rgb(token);
        cr.setSourceRGBA(r, g, b, alpha);
    }
}

// --- primitives ---------------------------------------------------------------

function sunDisc(cr, pal, cx, cy, r, rays, seed, spin = 0) {
    // halo
    const glow = new Cairo.RadialGradient(cx, cy, r * 0.2, cx, cy, r * 2.3);
    glow.addColorStopRGBA(0, ...rgb(pal.sunOuter), 0.30);
    glow.addColorStopRGBA(1, ...rgb(pal.sunOuter), 0);
    cr.setSource(glow);
    cr.arc(cx, cy, r * 2.3, 0, 2 * Math.PI);
    cr.fill();

    // rays
    col(cr, pal.ray, 0.95);
    cr.setLineWidth(1.25);
    cr.setLineCap(Cairo.LineCap.ROUND);
    for (let i = 0; i < rays; i++) {
        const a = (i / rays) * 2 * Math.PI + rnd(seed, 1) * 0.35 + spin;
        const jitter = 0.9 + rnd(seed, 10 + i) * 0.2;
        cr.moveTo(cx + Math.cos(a) * r * 1.30, cy + Math.sin(a) * r * 1.30);
        cr.lineTo(cx + Math.cos(a) * r * 1.85 * jitter, cy + Math.sin(a) * r * 1.85 * jitter);
    }
    cr.stroke();

    // disc
    const face = new Cairo.RadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    face.addColorStopRGB(0, ...rgb(pal.sunInner));
    face.addColorStopRGB(0.55, ...rgb(pal.sunMid));
    face.addColorStopRGB(1, ...rgb(pal.sunOuter));
    cr.setSource(face);
    cr.arc(cx, cy, r, 0, 2 * Math.PI);
    cr.fill();
}

function moonDisc(cr, pal, cx, cy, r, phase = 0.62) {
    const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
    const waxing = phase <= 0.5;
    const litSide = waxing ? 1 : -1;

    cr.save();
    // base disc (opaque, so the CLEAR pass below behaves predictably)
    col(cr, pal.moon, 1);
    cr.arc(cx, cy, r, 0, 2 * Math.PI);
    cr.fillPreserve();
    cr.clip();
    cr.newPath();

    // maria speckles go down *before* the CLEAR pass so the shadow trims them
    if (illum > 0.15) {
        col(cr, pal.crater, 1);
        cr.newSubPath();
        cr.arc(cx + r * 0.30 * litSide, cy - r * 0.18, r * 0.20, 0, 2 * Math.PI);
        cr.newSubPath();
        cr.arc(cx + r * 0.05 * litSide, cy + r * 0.34, r * 0.13, 0, 2 * Math.PI);
        cr.fill();
    }

    // Crescent regime (illum ≤ ~0.5): punch an equal-radius shadow disc
    // offset away from the lit limb (CLEAR, clipped to the base disc).
    // Gibbous regime: lay a translucent dusk-toned disc over the dark side —
    // reads as shading on any card color.
    if (illum <= 0.52) {
        const dx = 2 * r * illum * -litSide;
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.newPath();
        cr.arc(cx + dx, cy, r, 0, 2 * Math.PI);
        cr.fill();
        cr.setOperator(Cairo.Operator.OVER);
    } else {
        col(cr, 'rgba(14,18,28,0.55)', 1);
        cr.newPath();
        cr.arc(cx - 2 * r * (1 - illum) * litSide, cy, r * 1.06, 0, 2 * Math.PI);
        cr.fill();
    }
    cr.restore();
}

// Union-fill cloud: three lobes + a rounded slab, one nonzero path.
function cloudShape(cr, cx, cy, s) {
    const rr = (x0, y0, x1, y1, rad) => {
        cr.newSubPath();
        cr.arc(x1 - rad, y0 + rad, rad, -Math.PI / 2, 0);
        cr.arc(x1 - rad, y1 - rad, rad, 0, Math.PI / 2);
        cr.arc(x0 + rad, y1 - rad, rad, Math.PI / 2, Math.PI);
        cr.arc(x0 + rad, y0 + rad, rad, Math.PI, 3 * Math.PI / 2);
        cr.closePath();
    };
    cr.arc(cx, cy - s * 0.12, s * 0.46, 0, 2 * Math.PI);                      // crown lobe
    cr.newSubPath();
    cr.arc(cx - s * 0.40, cy + s * 0.05, s * 0.32, 0, 2 * Math.PI);           // left lobe
    cr.newSubPath();
    cr.arc(cx + s * 0.42, cy + s * 0.01, s * 0.36, 0, 2 * Math.PI);           // right lobe
    const bw = s * 0.72, bh = s * 0.24, br = s * 0.16;                        // slab
    rr(cx - bw, cy + s * 0.14, cx + bw, cy + bh + s * 0.14, Math.min(br, bh / 2));
}

function cloudFill(cr, pal, cx, cy, s, { storm = false, alpha = 1 } = {}) {
    const grad = new Cairo.LinearGradient(0, cy - s * 0.6, 0, cy + s * 0.4);
    grad.addColorStopRGB(0, ...rgb(storm ? pal.cloudStormHi : pal.cloudHi));
    grad.addColorStopRGB(1, ...rgb(storm ? pal.cloudStormLo : pal.cloudLo));
    cr.save();
    cr.opacity = alpha;
    cloudShape(cr, cx, cy, s);
    cr.setSource(grad);
    cr.setFillRule(Cairo.FillRule.WINDING);
    cr.fill();
    cr.restore();
}

function dropOne(cr, pal, x, y, seed, i, lean = -0.12) {
    void seed;
    col(cr, pal.rain, 0.95);
    const len = 1.05 + rnd(seed + i, 40) * 0.45;
    cr.save();
    cr.translate(x, y);
    cr.rotate(lean * 3);
    cr.scale(0.42, len);
    cr.arc(0, 0, 0.62, 0, 2 * Math.PI);
    cr.fill();
    cr.restore();
}

function snowOne(cr, pal, x, y, i, seed, t) {
    void i;
    void t;
    col(cr, pal.snow, 0.95);
    cr.setLineWidth(0.55);
    cr.setLineCap(Cairo.LineCap.ROUND);
    const rad = 0.62 + rnd(seed, 40 + i) * 0.30;
    const spin = rnd(seed, 60 + i) * Math.PI + t * 0.4;
    for (let k = 0; k < 3; k++) {
        const a = spin + (k * Math.PI) / 3;
        cr.moveTo(x - Math.cos(a) * rad, y - Math.sin(a) * rad);
        cr.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    cr.stroke();
}

function hailDot(cr, pal, x, y, seed, i) {
    const rad = 0.42 + rnd(seed, 40 + i) * 0.26;
    col(cr, pal.hail, 1);
    cr.newPath();
    cr.arc(x, y, rad, 0, 2 * Math.PI);
    cr.fill();
    col(cr, '#FFFFFF', 0.65);
    cr.newPath();
    cr.arc(x - rad * 0.3, y - rad * 0.3, rad * 0.35, 0, 2 * Math.PI);
    cr.fill();
}

function lightningBolt(cr, pal, t = 0) {
    const blink = 0.85 + 0.15 * Math.max(0, Math.sin(t * 2.2));
    const pts = [[12.9, 11.6], [16.1, 11.6], [13.7, 15.3], [16.4, 15.3],
        [10.6, 21.8], [12.3, 16.7], [9.9, 16.7]];
    cr.save();
    // faux glow: wide soft stroke under a crisp fill (no shadow API in GJS)
    cr.newPath();
    col(cr, pal.bolt, 0.35 * blink);
    cr.setLineWidth(1.8);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) cr.lineTo(x, y);
    cr.closePath();
    cr.strokePreserve();
    col(cr, pal.bolt, blink);
    cr.fill();
    cr.restore();
}

function fogBars(cr, pal, cx, y0, gap) {
    cr.setLineWidth(1.15);
    cr.setLineCap(Cairo.LineCap.ROUND);
    col(cr, pal.fog, 0.95);
    const widths = [5.6, 4.6, 5.1];
    widths.forEach((w, i) => {
        const y = y0 + i * gap;
        const off = (i % 2 === 0 ? 0.6 : -0.9);
        cr.moveTo(cx - w + off, y);
        cr.lineTo(cx + w + off, y);
    });
    cr.stroke();
}

function windStreamlines(cr, pal, t = 0) {
    const lanes = [
        { y: 8.2, len: 13.6, curl: 2.4, alpha: 0.95 },
        { y: 12.2, len: 16.4, curl: 2.8, alpha: 0.75 },
        { y: 16.2, len: 11.2, curl: 2.0, alpha: 0.55 },
    ];
    cr.setLineCap(Cairo.LineCap.ROUND);
    lanes.forEach((l, i) => {
        cr.setLineWidth(1.35 - i * 0.15);
        col(cr, pal.wind, l.alpha);
        const x0 = 3.4 + Math.sin(t * 1.3 + i * 2.1) * 0.35;
        const lift = Math.sin(t * 0.9 + i) * 0.25;
        const xTail = x0 + l.len - l.curl;
        cr.newPath();
        cr.moveTo(x0, l.y);
        cr.curveTo(x0 + l.len * 0.5, l.y - 0.9 + lift, xTail - 2, l.y - 0.7, xTail, l.y - 0.2);
        cr.curveTo(xTail + l.curl * 0.8, l.y + 0.2,
            xTail + l.curl * 0.75, l.y + l.curl * 0.9,
            xTail + l.curl * 0.15, l.y + l.curl * 0.75);
        cr.stroke();
    });
}

// --- scene assembly -------------------------------------------------------------

export const SCENES = ['sun', 'moon', 'partly', 'cloud', 'fog', 'wind',
    'rain', 'sleet', 'snow', 'hail', 'storm', 'loading', 'error'];

/**
 * Paint one glyph into `cr`, assuming a `size`×`size` px target.
 * opts: { scene, night=false, intensity=1 (0..6), seed=0, phase=moon 0..1 }
 */
export function drawScene(cr, size, opts = {}) {
    const { scene = 'partly', night = false, intensity = 1, seed = 3,
        phase = 0.62 } = opts;
    // t advances only when the caller animates; static callers stay frozen.
    const t = opts.timeSec ?? 0;
    const pal = night ? PAL.night : PAL.day;
    cr.scale(size / 24, size / 24);
    cr.setLineJoin(Cairo.LineJoin.ROUND);

    const precipZone = { yTop: 13.0, yBottom: 21.6, xl: 6.2, xr: 17.8 };
    const fall = (i, speed) => (t * speed + rnd(seed, 90 + i) + i * 0.137) % 1;

    switch (scene) {
    case 'sun':
        sunDisc(cr, pal, 12, 12, 4.4, 12, seed, t * 0.14);
        break;
    case 'moon':
        moonDisc(cr, pal, 12.4, 11.8, 5.0, phase);
        break;
    case 'partly':
        if (night) moonDisc(cr, pal, 8.4, 7.6, 2.9, phase);
        else sunDisc(cr, pal, 8.6, 7.8, 2.9, 9, seed, t * 0.14);
        cloudFill(cr, pal, 13.4, 13.0, 6.4);
        break;
    case 'cloud':
        cloudFill(cr, pal, 15.4 + Math.sin(t * 0.3) * 0.15, 8.6, 5.2, { alpha: 0.55 });
        cloudFill(cr, pal, 11.6, 11.6, 7.4);
        break;
    case 'fog':
        cloudFill(cr, pal, 12.6, 8.8, 6.2, { alpha: 0.85 });
        fogBars(cr, pal, 12 + Math.sin(t * 0.5) * 0.35, 14.2, 2.4);
        break;
    case 'wind':
        windStreamlines(cr, pal, t);
        break;
    case 'rain': {
        cloudFill(cr, pal, 12, 8.6, 7.6);
        const count = 3 + Math.min(6, intensity);
        for (let i = 0; i < count; i++) {
            const fx = (i + 0.5 + (rnd(seed, i) - 0.5) * 0.8) / count;
            const x = precipZone.xl + fx * (precipZone.xr - precipZone.xl);
            const y = precipZone.yTop + fall(i, 0.85) * (precipZone.yBottom - precipZone.yTop);
            dropOne(cr, pal, x, y, seed, i);
        }
        break;
    }
    case 'sleet': {
        cloudFill(cr, pal, 12, 8.6, 7.6);
        const n = 3 + Math.min(4, intensity);
        for (let i = 0; i < n; i++) {
            const fx = (i + 0.5) / n;
            const x = precipZone.xl + fx * (precipZone.xr - precipZone.xl) - 0.8;
            const y = precipZone.yTop + fall(i, 0.8) * (precipZone.yBottom - precipZone.yTop - 1.4);
            if (i % 2 === 0) dropOne(cr, pal, x, y, seed, i, -0.35);
            else snowOne(cr, pal, x + 1.6, precipZone.yTop + 2 +
                ((t * 0.3 + rnd(seed, i) + i * 0.2) % 1) * (precipZone.yBottom - precipZone.yTop - 2),
                i, seed + 11, t);
        }
        break;
    }
    case 'snow': {
        cloudFill(cr, pal, 12, 8.6, 7.6);
        const count = 3 + Math.min(5, intensity);
        for (let i = 0; i < count; i++) {
            const fx = (i + 0.5 + (rnd(seed, i) - 0.5) * 0.8) / count;
            const drift = Math.sin(t * 0.8 + i * 1.7) * 0.4;
            const x = precipZone.xl + fx * (precipZone.xr - precipZone.xl) + drift;
            const y = precipZone.yTop + ((t * 0.28 + rnd(seed, 20 + i) + i * 0.19) % 1)
                * (precipZone.yBottom - precipZone.yTop);
            snowOne(cr, pal, x, y, i, seed, t);
        }
        break;
    }
    case 'hail': {
        cloudFill(cr, pal, 12, 8.4, 7.6, { storm: true });
        dropOne(cr, pal, 7.6, precipZone.yTop + 2 + fall(0, 0.9) * 6, seed, 0, -0.25);
        dropOne(cr, pal, 16.9, precipZone.yTop + 1 + fall(1, 0.9) * 7, seed, 1, -0.25);
        const dots = 3 + Math.min(3, Math.ceil(intensity / 2));
        for (let i = 0; i < dots; i++) {
            const ph = fall(i + 30, 1.1);
            const bounce = ph > 0.82 ? Math.abs(Math.sin((ph - 0.82) * 20)) * 1.1 * (1 - ph) : 0;
            const x = precipZone.xl + 1.4 + (i + 0.5) / dots * (precipZone.xr - precipZone.xl - 2.8);
            const y = precipZone.yTop + 2.4 + ph * (precipZone.yBottom - precipZone.yTop - 3) - bounce;
            hailDot(cr, pal, x, y, seed, i);
        }
        break;
    }
    case 'storm':
        cloudFill(cr, pal, 12, 8.4, 7.6, { storm: true });
        dropOne(cr, pal, 7.4, precipZone.yTop + fall(0, 1.2) * 7, seed, 0, -0.25);
        dropOne(cr, pal, 16.8, precipZone.yTop + fall(1, 1.1) * 8, seed + 5, 1, -0.25);
        lightningBolt(cr, pal, t);
        break;
    case 'loading': {
        col(cr, pal.fog, 0.8);
        cr.setLineWidth(1.6);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.newPath();
        cr.arc(12, 12, 6.5, t * 2.4, t * 2.4 + 4.1);
        cr.stroke();
        break;
    }
    case 'error':
        col(cr, '#E05B5B');
        cr.setLineWidth(1.7);
        cr.newPath();
        cr.arc(12, 11, 6.4, 0, 2 * Math.PI);
        cr.stroke();
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.newPath();
        cr.moveTo(12, 7.8);
        cr.lineTo(12, 11.8);
        cr.stroke();
        break;
    default:
        cloudFill(cr, pal, 12, 10.6, 7.6);
    }
}

/**
 * A Gtk.DrawingArea painting a weather glyph. `getOpts()` is consulted on
 * every draw, so callers mutate state freely and just call queue_draw().
 * When `animate()` returns true (typically wired to the user preference),
 * the glyph animates at the extension's 20 fps cadence — but only while the
 * widget is mapped, so hidden tabs cost nothing.
 */
export function makeWeatherIcon(size, getOpts = null, animate = () => true) {
    const area = new Gtk.DrawingArea();
    area.set_size_request(size, size);
    area.set_halign(Gtk.Align.CENTER);
    area.set_valign(Gtk.Align.CENTER);
    area.set_content_width(size);
    area.set_content_height(size);

    const t0 = GLib.get_monotonic_time();
    let timer = 0;

    area.set_draw_func((_w, cr, w, h) => {
        cr.save();
        const side = Math.min(w, h);
        cr.translate((w - side) / 2, (h - side) / 2);
        const userOpts = getOpts ? getOpts() : {};
        const timeSec = (GLib.get_monotonic_time() - t0) / 1e6;
        drawScene(cr, side, animate()
            ? { ...userOpts, timeSec }
            : { ...userOpts, timeSec: 0 });
        cr.restore();
    });

    area.connect('map', () => {
        if (timer || !animate())
            return;
        timer = GLib.timeout_add(GLib.PRIORITY_LOW, 50, () => {
            if (!animate()) {
                timer = 0;
                return GLib.SOURCE_REMOVE;
            }
            area.queue_draw();
            return GLib.SOURCE_CONTINUE;
        });
    });
    area.connect('unmap', () => {
        if (timer) {
            GLib.Source.remove(timer);
            timer = 0;
        }
    });
    return area;
}
