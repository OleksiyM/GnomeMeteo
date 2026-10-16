/* CANVAS-SCALE MOTION (deliberate app-only divergence): the extension tunes every
 * drift, fall and gravity in ABSOLUTE px for its fixed 330x420 popup. The standalone
 * window is ~4x that area, so absolute px/s reads as crawling — draw sites multiply
 * motion (speeds, streak/fog/snow/hail extents, gravities) by the canvas scale to
 * restore the popup’s kinetic feel at any window size; positions are relative. */
// sky.js — animated sky backdrop, ported from the WeatherGlass extension's
// sky.js: per-scene gradients, twilight palette blended by solar glow, noon
// blues, breathing sun / phase-accurate moon, drifting cloud sprites,
// rain/snow/hail/wind particles, fog ridges, lightning flashes, star fields.
// Exposes sampleSky()/bodyOf() so the ink judges (ink.js) see the EXACT
// ground the eye reads, disc included — the extension's prime directive.

import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Cairo from 'gi://cairo?version=1.0';
import { moonPhase } from './weather.js';
import { paintMoonBody, addFrameSubscriber, removeFrameSubscriber } from './glyph.js';

const TWO_PI = Math.PI * 2;
const rand = (min, max) => min + Math.random() * (max - min);

/* [top, bottom] sky gradients per scene/day-night (mockup PAL) */
const SKY_PALETTES = {
    clear: { d: [[0.18, 0.43, 0.70], [0.75, 0.88, 0.97]], n: [[0.04, 0.06, 0.15], [0.15, 0.20, 0.36]] },
    partly: { d: [[0.23, 0.43, 0.66], [0.66, 0.79, 0.89]], n: [[0.05, 0.07, 0.19], [0.16, 0.21, 0.38]] },
    sun: { d: [[0.18, 0.43, 0.70], [0.75, 0.88, 0.97]], n: [[0.04, 0.06, 0.15], [0.15, 0.20, 0.36]] },
    moon: { d: [[0.18, 0.43, 0.70], [0.75, 0.88, 0.97]], n: [[0.04, 0.06, 0.15], [0.15, 0.20, 0.36]] },
    cloud: { d: [[0.36, 0.44, 0.54], [0.71, 0.76, 0.81]], n: [[0.08, 0.09, 0.14], [0.17, 0.20, 0.26]] },
    fog: { d: [[0.47, 0.50, 0.55], [0.72, 0.74, 0.77]], n: [[0.11, 0.13, 0.17], [0.20, 0.23, 0.27]] },
    rain: { d: [[0.22, 0.27, 0.36], [0.44, 0.50, 0.58]], n: [[0.05, 0.07, 0.13], [0.14, 0.17, 0.24]] },
    sleet: { d: [[0.28, 0.35, 0.44], [0.55, 0.60, 0.66]], n: [[0.07, 0.09, 0.15], [0.16, 0.19, 0.29]] },
    snow: { d: [[0.41, 0.47, 0.55], [0.72, 0.78, 0.83]], n: [[0.09, 0.11, 0.17], [0.19, 0.23, 0.32]] },
    hail: { d: [[0.14, 0.17, 0.24], [0.30, 0.35, 0.43]], n: [[0.04, 0.05, 0.09], [0.11, 0.14, 0.20]] },
    storm: { d: [[0.11, 0.13, 0.19], [0.24, 0.28, 0.36]], n: [[0.03, 0.04, 0.07], [0.08, 0.11, 0.17]] },
    wind: { d: [[0.30, 0.43, 0.57], [0.66, 0.75, 0.83]], n: [[0.06, 0.09, 0.16], [0.15, 0.20, 0.29]] },
    error: { d: [[0.45, 0.30, 0.30], [0.70, 0.55, 0.55]], n: [[0.15, 0.09, 0.09], [0.25, 0.17, 0.17]] },
    loading: { d: [[0.30, 0.33, 0.38], [0.55, 0.58, 0.63]], n: [[0.09, 0.10, 0.12], [0.20, 0.22, 0.25]] },
};

const SCENE_FEATURES = {
    clear: { sun: 1 },
    sun: { sun: 1 },
    partly: { clouds: 3, sun: 1, moon: 1 },  // night: moon behind the clouds
    moon: { stars: 1, moon: 1 },
    cloud: { clouds: 5 },
    fog: { clouds: 2, fog: 1 },
    rain: { clouds: 6, drops: 90 },
    sleet: { clouds: 6, drops: 45, flakes: 30 },
    snow: { clouds: 6, flakes: 70 },
    hail: { clouds: 6, drops: 40, hail: 26 },
    storm: { clouds: 6, drops: 120, bolt: 1 },
    wind: { streaks: 22 },
    error: {},
    loading: {},
};

/* Twilight tints, [zenith, mid, low, horizon]: golden hour while the sun is
 * still up; a violet-to-ember afterglow once it is down. */
const TWILIGHT_PALETTES = {
    d: [[0.30, 0.33, 0.66], [0.86, 0.50, 0.62], [1.00, 0.58, 0.30], [1.00, 0.72, 0.28]],
    n: [[0.08, 0.09, 0.24], [0.36, 0.22, 0.48], [0.78, 0.34, 0.30], [0.96, 0.50, 0.26]],
};
const TWILIGHT_STOPS = [0, 0.45, 0.8, 1];
const TWILIGHT_EASE = [[0.85, 1.5], [0.95, 1.0], [0.97, 0.6], [1.0, 0.45]];

const TWILIGHT_CLARITY = {
    clear: 1, sun: 1, moon: 1, partly: 0.9, wind: 0.8, cloud: 0.5, fog: 0.4,
    rain: 0.3, sleet: 0.3, snow: 0.35, hail: 0.15, storm: 0.15,
};

const mix = (a, b, t) => a.map((channelVal, idx) => channelVal + (b[idx] - channelVal) * t);

const NOON_PALETTE = [
    [[0.09, 0.32, 0.66], 0.6], [[0.32, 0.58, 0.86], 0.4],
    [[0.70, 0.84, 0.96], 0.3], [[0.88, 0.93, 0.97], 0.5],
];
const NOON_CLARITY = { clear: 1, sun: 1, moon: 1, partly: 0.8, wind: 0.7 };

const clamp01 = v => Math.max(0, Math.min(1, v || 0));

function twilightOf(scene, glow) {
    return clamp01(glow) * (TWILIGHT_CLARITY[scene] ?? 0);
}

function noonOf(scene, night, solar) {
    if (night || !Number.isFinite(solar))
        return 0;
    return clamp01(solar) ** 2 * (NOON_CLARITY[scene] ?? 0);
}

function sunSpot(width, height, night, solar) {
    const y = !night && Number.isFinite(solar) ? 0.21 - 0.09 * clamp01(solar) : 0.16;
    return [width * 0.82, height * y];
}

function skyStops(scene, night, glow, solar) {
    const [top, bottom] = paletteFor(scene, night);
    const twilight = twilightOf(scene, glow);
    const noon = noonOf(scene, night, solar);
    const tints = TWILIGHT_PALETTES[night ? 'n' : 'd'];
    return TWILIGHT_STOPS.map((offset, idx) => {
        const [strength, easing] = TWILIGHT_EASE[idx];
        const [noonRgb, noonStrength] = NOON_PALETTE[idx];
        const base = mix(mix(top, bottom, offset), noonRgb, noonStrength * noon);
        return [offset, mix(base, tints[idx], strength * twilight ** easing)];
    });
}

function paletteFor(scene, night) {
    return (SKY_PALETTES[scene] ?? SKY_PALETTES.cloud)[night ? 'n' : 'd'];
}

/** Approximate the composited sky RGB at height fraction f (0 top .. 1
 * bottom), gradient only — no discs, no clouds. */
export function sampleSky(scene, night, heightFraction = 0.62, glow = 0, solar = null) {
    const stops = skyStops(scene, night, glow, solar);
    const f = Math.max(0, Math.min(1, heightFraction));
    for (let i = 1; i < stops.length; i++) {
        const [offset, rgb] = stops[i], [prevOffset, prevRgb] = stops[i - 1];
        if (f <= offset)
            return mix(prevRgb, rgb, (f - prevOffset) / (offset - prevOffset));
    }
    return stops[stops.length - 1][1];
}

/* The disc the INK judge must believe exists: same position AND core radius
 * as drawCelestial paints (64 * scale). The judge sees only what this
 * reports — the opaque core is what legibility is judged against; the vast
 * aura (~0.3 alpha) is deliberately NOT modelled. Moon coverage scales with
 * illumination: a new moon must not drag the header to ink. */
export function bodyOf(scene, night, width, height, glow = 0, solar = null, phase = null) {
    const features = SCENE_FEATURES[scene] ?? {};
    const baseRadius = 64 * height / 420;
    const [sunX, sunY] = sunSpot(width, height, night, solar);
    if ((features.sun || features.moon) && !night)
        return {
            x: sunX, y: sunY, r: baseRadius, soft: 12,
            col: mix([1, 0.8, 0.4], SUNSET_CORE, twilightOf(scene, glow)), max: 0.9,
        };
    if (features.moon && night) {
        const f = phase ?? moonPhase().phase;
        const illum = (1 - Math.cos(TWO_PI * f)) / 2;
        const max = 0.85 * illum;
        if (max > 0.02)
            return {
                x: width * 0.82, y: height * 0.16, r: baseRadius * 0.85, soft: 12,
                col: [0.93, 0.94, 0.96], max,
            };
    }
    return null;
}

const MOON_COVER = 0.5;

/* ---------------- backdrop state & painting (verbatim mechanics) ---------- */

export function createSky() {
    return {
        sprite: null, w: 0, h: 0, scene: '', night: null,
        lastTime: null, lastT: null,
        drops: [], flakes: [], hail: [], clouds: [], stars: [],
        streaks: [], fog: [],
        // static-layer surface cache (see paintSky) + counters for tests
        cache: null, cacheKey: '', builds: 0, blits: 0,
    };
}

function rebuild(sky, width, height, scene) {
    const features = SCENE_FEATURES[scene] ?? {};
    const areaScaleFactor = Math.max(0.5, Math.min(1.5, (width * height) / (1050 * 420)));
    const mk = (count, factory) =>
        Array.from({ length: Math.round(count * areaScaleFactor) }, factory);
    sky.drops = mk(features.drops ?? 0, () => ({
        x: rand(-60, width + 60), y: rand(-height, height),
        length: rand(12, 34), speed: rand(260, 480),
    }));
    sky.flakes = mk(features.flakes ?? 0, () => ({
        x: rand(0, width), y: rand(-height, height),
        radius: rand(1.8, 3.6), speed: rand(28, 60), phase: rand(0, TWO_PI),
    }));
    sky.hail = mk(features.hail ?? 0, () => ({
        x: rand(0, width), y: rand(-height, height),
        vx: rand(-40, 40), vy: rand(180, 320), radius: rand(2.4, 4.4), bounces: 0,
    }));
    sky.streaks = mk(features.streaks ?? 0, () => ({
        x: rand(-width, width), y: rand(0, height),
        length: rand(40, 170), speed: rand(120, 320),
        width: rand(0.8, 2.2), opacity: rand(0.12, 0.4),
    }));
    sky.fog = mk(features.fog ? 15 : 0, () => ({
        x: rand(-width, width), y: rand(0.44 * height, 0.93 * height),
        length: rand(0.55, 1.2) * width, speed: rand(12, 34),
        height: rand(40, 130), opacity: rand(0.22, 0.42),
        tone: rand(0, 1) < 0.5 ? 1 : 0, // lit vs shadowed mist clumps
    }));
    sky.stars = mk(features.stars ? 70 : 0, () => {
        const isTwinkle = rand(0, 1) < 0.22;
        return {
            x: rand(0, width), y: rand(0, 0.6 * height),
            radius: isTwinkle ? rand(3.0, 5.6) : rand(0.8, 2.0),
            phase: rand(0, TWO_PI), isTwinkle, isCool: rand(0, 1) < 0.45,
        };
    });
    sky.clouds = mk(features.clouds ?? 0, () => ({
        x: rand(0, width), y: rand(0.02 * height, 0.42 * height),
        scale: rand(1.0, 2.6), speed: rand(6, 26),
    }));
    sky.w = width; sky.h = height; sky.scene = scene; sky.lastTime = null;
}

function makeCloudSprite() {
    const SW = 400, SH = 200;
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, SW, SH);
    const cr = new Cairo.Context(surface);
    cr.setOperator(Cairo.Operator.CLEAR);
    cr.paint();
    cr.setOperator(Cairo.Operator.OVER);
    for (const [nx, ny, nr] of [[0.32, 0.55, 0.27], [0.47, 0.44, 0.23],
        [0.62, 0.54, 0.21], [0.40, 0.63, 0.26], [0.56, 0.64, 0.23]]) {
        const radius = nr * SH, x = nx * SW, y = ny * SH;
        const gradient = new Cairo.RadialGradient(x, y, radius * 0.05, x, y, radius);
        gradient.addColorStopRGBA(0, 1, 1, 1, 0.5);
        gradient.addColorStopRGBA(0.55, 1, 1, 1, 0.22);
        gradient.addColorStopRGBA(1, 1, 1, 1, 0);
        cr.setSource(gradient);
        cr.arc(x, y, radius, 0, TWO_PI);
        cr.fill();
    }
    cr.$dispose();
    surface.flush();
    return surface;
}

function sparkle(cr, x, y, scale, alpha, isCool) {
    const r = isCool ? 0.55 : 1, g = isCool ? 0.83 : 1, b = 1;
    const waist = scale * 0.15;
    cr.save();
    cr.translate(x, y);
    cr.setSourceRGBA(r, g, b, alpha * 0.85);
    cr.newPath();
    cr.moveTo(0, -scale);
    cr.lineTo(waist, -waist);
    cr.lineTo(scale, 0);
    cr.lineTo(waist, waist);
    cr.lineTo(0, scale);
    cr.lineTo(-waist, waist);
    cr.lineTo(-scale, 0);
    cr.lineTo(-waist, -waist);
    cr.closePath();
    cr.fill();
    cr.newPath();
    cr.arc(0, 0, Math.max(0.6, scale * 0.16), 0, TWO_PI);
    cr.setSourceRGBA(r, g, b, Math.min(1, alpha * 1.5));
    cr.fill();
    cr.restore();
}

function drawBackdrop(cr, height, stops) {
    const gradient = new Cairo.LinearGradient(0, 0, 0, height);
    for (const [offset, rgb] of stops)
        gradient.addColorStopRGB(offset, ...rgb);
    cr.setSource(gradient);
    cr.paint();
}

function drawHorizonGlow(cr, width, height, twilight, night, time) {
    if (twilight <= 0.01) return;
    const breath = 1 + 0.06 * Math.sin(time * 0.4);
    const alpha = twilight * (night ? 0.42 : 0.34) * breath;
    const [r, g, b] = night ? [1.0, 0.45, 0.28] : [1.0, 0.62, 0.30];
    cr.save();
    cr.translate(width * 0.7, height * 1.04);
    cr.scale(width * 0.95, height * 0.42);
    const haze = new Cairo.RadialGradient(0, 0, 0, 0, 0, 1);
    haze.addColorStopRGBA(0, r, g, b, alpha);
    haze.addColorStopRGBA(0.45, r, g * 0.92, Math.min(1, b * 1.1), alpha * 0.45);
    haze.addColorStopRGBA(1, r, g, b, 0);
    cr.setSource(haze);
    cr.arc(0, 0, 1, 0, TWO_PI);
    cr.fill();
    cr.restore();
}

const SUNSET_CORE = [1.0, 0.56, 0.26];
const SUNSET_RAY = [1.0, 0.52, 0.30];

function drawSun(cr, sunX, sunY, radius, scale, time, twilight = 0, noon = 0) {
    const warm = (rgb, target) =>
        mix(mix(rgb, [1.0, 0.97, 0.86], 0.35 * noon), target, twilight);
    const auraRadius = radius * (3.6 + 1.2 * twilight);
    const aura = new Cairo.RadialGradient(sunX, sunY, radius * 0.2, sunX, sunY, auraRadius);
    const auraBreath = (0.40 + 0.08 * Math.sin(time * 0.7)) * (1 + 0.3 * twilight);
    aura.addColorStopRGBA(0, ...warm([1.0, 0.88, 0.45], [1.0, 0.66, 0.36]), auraBreath);
    aura.addColorStopRGBA(0.35, ...warm([1.0, 0.72, 0.22], [1.0, 0.50, 0.30]), auraBreath * 0.5);
    aura.addColorStopRGBA(0.7, ...warm([1.0, 0.58, 0.12], [0.95, 0.40, 0.36]), auraBreath * 0.2);
    aura.addColorStopRGBA(1, ...warm([1.0, 0.50, 0.05], [0.90, 0.36, 0.40]), 0);
    cr.setSource(aura);
    cr.arc(sunX, sunY, auraRadius, 0, TWO_PI);
    cr.fill();

    const rayCount = 16;
    const stepAngle = TWO_PI / rayCount;
    cr.save();
    cr.translate(sunX, sunY);
    cr.rotate(time * 0.03);
    for (let k = 0; k < rayCount; k++) {
        cr.save();
        cr.rotate(k * stepAngle);
        const isPrimary = k % 2 === 0;
        let rayRadius, baseHalfWidth, rayAlpha;
        if (isPrimary) {
            const wave = Math.sin(time * 0.85 + k * 0.7);
            rayRadius = radius * (2.1 + 0.22 * wave);
            baseHalfWidth = 4.2 * scale;
            rayAlpha = 0.20 + 0.05 * wave;
        } else {
            const wave = Math.sin(time * 0.85 + Math.PI * 0.6 + k * 0.7);
            rayRadius = radius * (1.65 + 0.16 * wave);
            baseHalfWidth = 2.8 * scale;
            rayAlpha = 0.13 + 0.04 * wave;
        }
        rayAlpha *= 1 - 0.3 * twilight;
        const beamGrad = new Cairo.LinearGradient(0, -radius * 0.6, 0, -rayRadius);
        beamGrad.addColorStopRGBA(0, ...warm([1.0, 0.90, 0.50], SUNSET_RAY), rayAlpha);
        beamGrad.addColorStopRGBA(0.5, ...warm([1.0, 0.78, 0.28], SUNSET_RAY), rayAlpha * 0.6);
        beamGrad.addColorStopRGBA(1, ...warm([1.0, 0.65, 0.15], SUNSET_RAY), 0);
        cr.setSource(beamGrad);
        cr.newPath();
        cr.moveTo(-baseHalfWidth, -radius * 0.6);
        cr.lineTo(0, -rayRadius);
        cr.lineTo(baseHalfWidth, -radius * 0.6);
        cr.closePath();
        cr.fill();
        cr.restore();
    }
    cr.restore();

    const coronaRadius = radius * 1.9;
    const corona = new Cairo.RadialGradient(sunX, sunY, radius * 0.5, sunX, sunY, coronaRadius);
    const coronaBreath = 0.65 + 0.12 * Math.sin(time * 1.5);
    corona.addColorStopRGBA(0, ...warm([1.0, 0.94, 0.60], [1.0, 0.74, 0.46]), coronaBreath);
    corona.addColorStopRGBA(0.5, ...warm([1.0, 0.78, 0.25], [1.0, 0.50, 0.28]), coronaBreath * 0.45);
    corona.addColorStopRGBA(1, ...warm([1.0, 0.65, 0.15], [0.95, 0.38, 0.30]), 0);
    cr.setSource(corona);
    cr.arc(sunX, sunY, coronaRadius, 0, TWO_PI);
    cr.fill();

    const coreRadius = radius * 0.85;
    const core = new Cairo.RadialGradient(
        sunX - radius * 0.25, sunY - radius * 0.25, radius * 0.1, sunX, sunY, coreRadius);
    core.addColorStopRGBA(0, ...warm([1.0, 0.99, 0.88], [1.0, 0.90, 0.66]), 1.0);
    core.addColorStopRGBA(0.45, ...warm([1.0, 0.88, 0.35], [1.0, 0.68, 0.32]), 0.98);
    core.addColorStopRGBA(0.85, ...warm([1.0, 0.70, 0.14], SUNSET_CORE), 0.96);
    core.addColorStopRGBA(1, ...warm([0.98, 0.55, 0.08], [0.94, 0.36, 0.16]), 0.90);
    cr.setSource(core);
    cr.arc(sunX, sunY, coreRadius, 0, TWO_PI);
    cr.fill();
}

function drawMoon(cr, moonX, moonY, radius, phase, phaseValue) {
    const lunarPhase = Number.isFinite(phase) ? phase : (phaseValue ?? moonPhase().phase);
    const illum = (1 - Math.cos(TWO_PI * lunarPhase)) / 2;
    const alpha = 0.08 + 0.22 * illum;
    const moonGlow = new Cairo.RadialGradient(moonX, moonY, radius * 0.6, moonX, moonY, radius * 3.4);
    moonGlow.addColorStopRGBA(0, 0.80, 0.87, 0.99, alpha);
    moonGlow.addColorStopRGBA(0.45, 0.70, 0.80, 0.96, alpha * 0.38);
    moonGlow.addColorStopRGBA(1, 0.70, 0.80, 0.96, 0);
    cr.setSource(moonGlow);
    cr.arc(moonX, moonY, radius * 3.4, 0, TWO_PI);
    cr.fill();
    cr.pushGroup();
    cr.newPath();
    paintMoonBody(cr, moonX, moonY, radius * 0.85, lunarPhase, true);
    cr.popGroupToSource();
    cr.paintWithAlpha(MOON_COVER);
}

function drawStars(cr, stars, time, twilight = 0, keepOut = null) {
    const visibility = 1 - 0.85 * twilight;
    if (visibility <= 0.02) return;
    for (const star of stars) {
        const wave = Math.abs(Math.sin(time * 1.3 + star.phase));
        const alpha = (0.25 + 0.5 * wave) * visibility;
        // stars whose reach touches the moon disc are not drawn at all
        if (keepOut && Math.hypot(star.x - keepOut.x, star.y - keepOut.y) <
            keepOut.r + star.radius * (star.isTwinkle ? 1.2 : 1))
            continue;
        if (star.isTwinkle) {
            sparkle(cr, star.x, star.y, star.radius * (0.7 + 0.5 * wave), alpha, star.isCool);
            continue;
        }
        if (star.isCool)
            cr.setSourceRGBA(0.72, 0.86, 1.0, alpha);
        else
            cr.setSourceRGBA(1, 1, 1, alpha);
        cr.newPath();
        cr.arc(star.x, star.y, star.radius, 0, TWO_PI);
        cr.fill();
    }
}

/** Celestial bodies ONLY (into the cached layer). The star twinkle rides
 * separately per-frame, honoring the moon keep-out. */
function drawBodies(cr, width, height, scale, features, time, night, phase,
    twilight, solar, noon) {
    const [sunX, sunY] = sunSpot(width, height, night, solar);
    const radius = 64 * scale;
    if ((features.sun || features.moon) && !night)
        drawSun(cr, sunX, sunY, radius, scale, time, twilight, noon);
    else if (features.moon)
        drawMoon(cr, sunX, sunY, radius, phase);
}

function drawClouds(cr, sky, width, scale, dt, time, scene, night, twilight) {
    if (!sky.clouds.length) return;
    if (!sky.sprite) sky.sprite = makeCloudSprite();
    const tint = night ? 0.45 + 0.35 * twilight : 1;
    const [gr, gg, gb] = night ? [1.0, 0.50, 0.46] : [1.0, 0.62, 0.48];
    for (const cloud of sky.clouds) {
        cloud.x += cloud.speed * dt * scale;
        if (cloud.x > width + 200 * scale) cloud.x = -260 * scale;
        const cw = 400 * cloud.scale * 0.24 * scale, ch = 200 * cloud.scale * 0.24 * scale;
        cr.save();
        cr.translate(cloud.x, cloud.y + Math.sin(time * 0.3 + cloud.y) * 4 * scale);
        cr.scale(cw / 400, ch / 200);
        cr.setSourceSurface(sky.sprite, 0, 0);
        cr.paintWithAlpha((scene === 'clear' || scene === 'sun' ? 0.45 : 0.8) * tint);
        if (twilight > 0.01) {
            cr.setSourceRGBA(gr, gg, gb, 0.55 * twilight);
            cr.maskSurface(sky.sprite, 0, 0);
        }
        cr.restore();
    }
}

function drawFogHills(cr, width, height, night) {
    const ridges = [
        { base: 0.30, amp: 0.060, f1: 1.7, f2: 4.1, p1: 0.6, p2: 2.2,
            c: night ? [0.09, 0.11, 0.15] : [0.42, 0.45, 0.51] },
        { base: 0.44, amp: 0.075, f1: 2.3, f2: 5.3, p1: 2.9, p2: 0.4,
            c: night ? [0.05, 0.07, 0.10] : [0.28, 0.32, 0.39] },
    ];
    for (const r of ridges) {
        cr.setSourceRGBA(r.c[0], r.c[1], r.c[2], 1);
        cr.moveTo(0, height);
        for (let x = 0; x <= width; x += 8) {
            const u = x / width;
            const y = height * (r.base
                - r.amp * Math.sin(u * Math.PI * r.f1 + r.p1)
                - r.amp * 0.5 * Math.sin(u * Math.PI * r.f2 + r.p2));
            cr.lineTo(x, y);
        }
        cr.lineTo(width, height);
        cr.closePath();
        cr.fill();
    }
    const washColor = night ? [0.50, 0.55, 0.64] : [0.82, 0.85, 0.88];
    const wash = new Cairo.LinearGradient(0, 0.34 * height, 0, height);
    wash.addColorStopRGBA(0, ...washColor, 0);
    wash.addColorStopRGBA(0.30, ...washColor, night ? 0.30 : 0.45);
    wash.addColorStopRGBA(1, ...washColor, night ? 0.62 : 0.78);
    cr.setSource(wash);
    cr.rectangle(0, 0.34 * height, width, height * 0.66);
    cr.fill();
}

function drawFog(cr, sky, width, dt, time, night, scale = 1) {
    const litColor = night ? [0.55, 0.60, 0.70] : [0.93, 0.95, 0.97];
    const shadeColor = night ? [0.07, 0.09, 0.14] : [0.40, 0.44, 0.50];
    for (const fog of sky.fog) {
        fog.x += fog.speed * dt * scale;
        if (fog.x > width + fog.length) fog.x = -fog.length;
        const y = fog.y + Math.sin(time * 0.35 + (fog.x + width) * 0.01) * 4 * scale;
        const tint = fog.tone ? litColor : shadeColor;
        cr.save();
        cr.translate(fog.x + fog.length / 2, y);
        cr.scale(fog.length / (fog.height * 2), 1);
        const gradient = new Cairo.RadialGradient(0, 0, 0, 0, 0, fog.height * scale);
        gradient.addColorStopRGBA(0, ...tint, fog.opacity);
        gradient.addColorStopRGBA(0.6, ...tint, fog.opacity * 0.65);
        gradient.addColorStopRGBA(1, ...tint, 0);
        cr.setSource(gradient);
        cr.arc(0, 0, fog.height * scale, 0, TWO_PI);
        cr.fill();
        cr.restore();
    }
}

function drawRain(cr, sky, width, height, scale, dt, scene) {
    const rainColor = scene === 'sleet' ? [0.63, 0.80, 0.93] : [0.73, 0.84, 0.94];
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(1.4 * scale);
    for (const drop of sky.drops) {
        drop.y += drop.speed * dt * scale;
        drop.x -= drop.speed * 0.28 * dt * scale;
        if (drop.y > height + 20) {
            drop.y = -20;
            drop.x = rand(0, width + 60);
        }
        cr.setSourceRGBA(...rainColor, 0.45);
        cr.moveTo(drop.x, drop.y);
        cr.lineTo(drop.x - drop.length * 0.3 * scale, drop.y + drop.length * scale);
        cr.stroke();
    }
}

function drawSnow(cr, sky, width, height, scale, dt, time) {
    for (const flake of sky.flakes) {
        flake.y += flake.speed * dt * scale;
        if (flake.y > height + 10) {
            flake.y = -10;
            flake.x = rand(0, width);
        }
        cr.setSourceRGBA(1, 1, 1, 0.85);
        cr.arc(flake.x + Math.sin(time * 1.2 + flake.phase) * 18 * scale, flake.y,
            flake.radius * scale, 0, TWO_PI);
        cr.fill();
    }
}

function drawHail(cr, sky, width, height, dt) {
    const gs = height / 420;   // same canvas-scale motion doctrine (see note)
    for (const stone of sky.hail) {
        stone.vy += 900 * gs * dt;
        stone.x += stone.vx * gs * dt;
        stone.y += stone.vy * gs * dt;
        if (stone.y > height - 6 * gs - stone.radius * gs && stone.vy > 0) {
            stone.y = height - 6 * gs - stone.radius * gs;
            stone.vy *= -0.42;
            stone.vx = rand(-160, 160) * gs;
            stone.bounces += 1;
        }
        if (stone.bounces > 2 || stone.x < -10 || stone.x > width + 10)
            Object.assign(stone, {
                x: rand(0, width), y: -10, vx: rand(-40, 40),
                vy: rand(180, 320), radius: rand(2.4, 4.4), bounces: 0,
            });
        cr.setSourceRGBA(0.94, 0.96, 0.99, 0.92);
        cr.arc(stone.x, stone.y, stone.radius * gs, 0, TWO_PI);
        cr.fill();
    }
}

function drawWindStreaks(cr, sky, width, height, dt, scale = 1) {
    for (const streak of sky.streaks) {
        streak.x += streak.speed * dt * scale;
        if (streak.x > width + streak.length * scale) {
            streak.x = -streak.length * scale;
            streak.y = rand(0, height);
        }
        cr.setSourceRGBA(0.86, 0.93, 0.98, streak.opacity);
        cr.setLineWidth(streak.width * scale);
        cr.moveTo(streak.x, streak.y);
        cr.lineTo(streak.x + streak.length * scale, streak.y);
        cr.stroke();
    }
}

function drawLightning(cr, width, height, scale, time) {
    const cycle = time % 3.1;
    let flash = 0;
    if (cycle < 0.08) flash = cycle / 0.08;
    else if (cycle < 0.18) flash = 1 - (cycle - 0.08) / 0.1;
    else if (cycle < 0.26) flash = 0.5 * (cycle - 0.18) / 0.08;
    else if (cycle < 0.38) flash = 0.5 * (1 - (cycle - 0.26) / 0.12);
    if (flash <= 0) return;
    cr.setSourceRGBA(1, 0.99, 0.92, 0.10 * flash);
    cr.paint();
    cr.save();
    cr.translate(width * 0.5, height * 0.05);
    cr.setSourceRGBA(1, 0.86, 0.31, flash);
    cr.setLineWidth(3.4 * scale);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.moveTo(0, 0);
    cr.lineTo(-38 * scale, 90 * scale);
    cr.lineTo(14 * scale, 96 * scale);
    cr.lineTo(-30 * scale, 210 * scale);
    cr.stroke();
    cr.restore();
}

/**
 * Paint one frame. `getState()` -> {scene, night, phase, glow, solar} and
 * `animate()` gates motion (paused frames advance time by 0 via dt clamp).
 *
 * Layered for throughput: everything that changes slowly (sky gradient,
 * horizon glow, sun/moon with its breathing and ray rotation, fog ridges)
 * builds ONCE onto an offscreen surface — celestial breathing quantizes to
 * eighth-seconds, so the rebuild runs a few times a second at most and
 * never for body-less scenes until a resize. Every frame is then a single
 * opaque blit plus the genuinely dynamic list: stars, clouds, particles,
 * lightning, scrim.
 */
export function paintSky(cr, { w: width, h: height, time, scene, night, sky,
    scrim = null, radius = 0, phase = null, glow = 0, solar = null,
    quiet = false }) {
    const rw = Math.round(width), rh = Math.round(height);
    if (sky.scene !== scene || sky.w !== rw || sky.h !== rh)
        rebuild(sky, rw, rh, scene);

    const lastTime = sky.lastTime ?? sky.lastT;
    const dt = lastTime === null ? 0 : Math.min(0.1, time - lastTime);
    sky.lastTime = time;
    sky.lastT = time;
    const features = SCENE_FEATURES[scene] ?? {};
    const twilight = twilightOf(scene, glow);
    const noon = noonOf(scene, night, solar);
    const scale = height / 420;

    // Cache boundary: ONLY the time-invariant gradient wash (per scene/
    // family/glow/solar/phase + size). Horizon glow and the celestial
    // bodies BREATHE AND ROTATE in real time on the live path below --
    // a sun quantized into a 4 Hz slideshow reads as "animation is slow",
    // and the extension has always painted bodies every frame. The cache
    // now rebuilds only on resize or the upstream per-minute glow/solar
    // refresh, exactly as often as the sky's palette actually changes.
    const key = `${scene}|${night ? 'n' : 'd'}|${Number(glow).toFixed(3)}`
        + `|${Number.isFinite(solar) ? solar.toFixed(3) : '-'}|`
        + `${phase == null ? '-' : Number(phase).toFixed(4)}|${rw}x${rh}`
        + `|${quiet ? 'q' : 'a'}`;
    if (!sky.cache || sky.cacheKey !== key) {
        const reuse = sky.cache
            && sky.cache.getWidth() === rw && sky.cache.getHeight() === rh;
        const surface = reuse
            ? sky.cache
            : new Cairo.ImageSurface(Cairo.Format.ARGB32, rw, rh);

        const sc = new Cairo.Context(surface);
        sc.setOperator(Cairo.Operator.CLEAR);
        sc.paint();
        sc.setOperator(Cairo.Operator.OVER);
        drawBackdrop(sc, rh, skyStops(scene, night, glow, solar));
        if (scene === 'fog')
            drawFogHills(sc, rw, rh, night);
        sc.$dispose();
        surface.flush();
        sky.cache = surface;
        sky.cacheKey = key;
        sky.builds++;
    }

    cr.save();
    cr.rectangle(0, 0, width, height);
    if (radius > 0) {
        const r = Math.min(radius, width / 2, height / 2), k = 0.5523 * r;
        cr.newPath();
        cr.moveTo(r, 0);
        cr.lineTo(width - r, 0);
        cr.curveTo(width - r + k, 0, width, r - k, width, r);
        cr.lineTo(width, height - r);
        cr.curveTo(width, height - r + k, width - r + k, height, width - r, height);
        cr.lineTo(r, height);
        cr.curveTo(r - k, height, 0, height - r + k, 0, height - r);
        cr.lineTo(0, r);
        cr.curveTo(0, r - k, r - k, 0, r, 0);
        cr.closePath();
    }
    cr.clip();

    cr.setOperator(Cairo.Operator.SOURCE);
    cr.setSourceSurface(sky.cache, 0, 0);
    cr.paint();
    cr.setOperator(Cairo.Operator.OVER);
    sky.blits++;

    drawHorizonGlow(cr, rw, rh, twilight, night, time);
    if (!quiet)
        drawBodies(cr, rw, rh, scale, features, time, night, phase,
            twilight, solar, noon);

    if (quiet) {
        if (scrim) {
            cr.setSourceRGBA(...scrim);
            cr.paint();
        }
        cr.restore();
        return;
    }

    const hasMoon = features.moon && night;
    if (night && (features.stars || features.moon)) {
        const [sx, sy] = sunSpot(rw, rh, night, solar);
        drawStars(cr, sky.stars, time, twilight,
            hasMoon ? { x: sx, y: sy, r: 64 * scale * 0.85 } : null);
    }
    drawClouds(cr, sky, width, scale, dt, time, scene, night, twilight);
    drawFog(cr, sky, width, dt, time, night, scale);
    drawRain(cr, sky, width, height, scale, dt, scene);
    drawSnow(cr, sky, width, height, scale, dt, time);
    drawHail(cr, sky, width, height, dt);
    drawWindStreaks(cr, sky, width, height, dt, scale);
    if (features.bolt)
        drawLightning(cr, width, height, scale, time);
    if (scrim) {
        cr.setSourceRGBA(...scrim);
        cr.paint();
    }
    cr.restore();
}

// ---------------------------------------------------------------------------
// Widget: full-page backdrop, ticking only while mapped AND animated, 20 fps
// like the extension. Sun glow/solar are solved at paint time (per-minute
// cached) from the city's clock, never at fetch time.

export function makeSkyBackdrop(getState, animate = () => true) {
    const area = new Gtk.DrawingArea();
    const sky = createSky();
    const t0 = GLib.get_monotonic_time();
    const tPauseStatic = 42; // frozen-frame time for animate() === false

    area.set_hexpand(true);
    area.set_vexpand(true);
    area.set_draw_func((_w, cr, w, h) => {
        const st = getState() ?? {};
        let time = (GLib.get_monotonic_time() - t0) / 1e6;
        if (!animate()) time = tPauseStatic;
        const { glow = 0, solar = null } = st;
        paintSky(cr, {
            w, h, time,
            scene: st.scene ?? 'partly',
            night: !!st.night,
            glow, solar,
            phase: st.phase ?? null,
            scrim: st.scrim ?? null,
            sky,
        });
    });

    let sub = 0;
    area.connect('map', () => {
        if (sub || !animate()) return;
        sub = addFrameSubscriber(() => {
            if (!animate()) {
                removeFrameSubscriber(sub);
                sub = 0;
                area.queue_draw(); // settle on the static frame
                return;
            }
            area.queue_draw();
        });
    });
    area.connect('unmap', () => {
        if (sub) {
            removeFrameSubscriber(sub);
            sub = 0;
        }
    });
    area.invalidateState = () => area.queue_draw();
    return area;
}
