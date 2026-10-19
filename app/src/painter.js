/* == SYNCHED DESIGN BRAIN (byte-identity enforced by scripts/check-design-parity.py) == */
/* painter.js -- pure Cairo weather scene painter. */

import Cairo from 'gi://cairo';
import { paintMoon, moonPhase, illumOf } from './moon.js';

export const GRID = 24;

const TWO_PI = Math.PI * 2;

function rand(min, max) {
    return min + Math.random() * (max - min);
}

export function createParticles() {
    const drops = [];
    for (let i = 0; i < 16; i++)
        drops.push({ x: rand(3, 21), y: rand(14, 24), length: rand(1.6, 3.2), speed: rand(11, 18) });
    const flakes = [];
    for (let i = 0; i < 12; i++)
        flakes.push({
            x: rand(3, 21), y: rand(14, 24), radius: rand(0.8, 1.4),
            speed: rand(2.5, 4.5), phase: rand(0, TWO_PI)
        });
    const hail = [];
    for (let i = 0; i < 10; i++) {
        // scatter initial heights so the first cycle doesn't fall in unison
        hail.push(Object.assign(newHailStone(), { y: rand(14, FLOOR), vy: rand(2, 9) }));
    }
    const stars = [
        { x: 19.5, y: 4.5, phase: 0.0 }, { x: 21.5, y: 9, phase: 1.7 },
        { x: 17.5, y: 8, phase: 3.1 }, { x: 20.5, y: 13.5, phase: 4.4 },
    ];
    return { drops, flakes, hail, stars, lastTime: null, lastT: null };
}

const FLOOR = 21.8;   // where hailstones bounce

function newHailStone() {
    return {
        x: rand(3, 21), y: rand(13.5, 15.5),
        vx: rand(-1, 1.5), vy: rand(6, 10),
        radius: rand(0.7, 1.25), bounces: 0,
    };
}

function circle(cr, x, y, radius) {
    cr.newSubPath();
    cr.arc(x, y, radius, 0, TWO_PI);
}

function line(cr, x1, y1, x2, y2) {
    cr.moveTo(x1, y1);
    cr.lineTo(x2, y2);
}

/** Teardrop droplet: round bottom, pointed tip, always upright.
 *  (x, y) is the centre of the round bottom; s the drop scale. */
function teardrop(cr, x, y, s) {
    cr.moveTo(x, y - 2.35 * s);
    cr.curveTo(x + 0.62 * s, y - 1.35 * s, x + 0.95 * s, y - 0.72 * s,
        x + 0.95 * s, y - 0.05 * s);
    cr.arc(x, y - 0.05 * s, 0.95 * s, 0, Math.PI);
    cr.curveTo(x - 0.95 * s, y - 0.72 * s, x - 0.62 * s, y - 1.35 * s,
        x, y - 2.35 * s);
    cr.closePath();
}

/** Organic-but-safe scatter under the cloud for static poses. Golden-
 *  ratio steps land every drop at a fresh, never-repeating spot --
 *  naturally uneven, yet spread with no clumps and no ruler-straight
 *  columns -- and a hard distance check keeps neighbours from ever
 *  touching. Seeded per glyph, so each icon paints identically across
 *  repaints (no shimmer) while neighbouring icons differ. */
function seededSpots(count, seed, x0, x1, y0, y1, minDx, minDy) {
    const golden = 0.6180339887;
    let u = (seed % 977) * golden;
    const spots = [];
    for (let i = 0; i < count; i++) {
        let x = x0, y = y0, ok = false;
        for (let k = 0; k < 24 && !ok; k++) {
            u += golden;
            x = x0 + (u % 1) * (x1 - x0);
            u += golden;
            y = y0 + (u % 1) * (y1 - y0);
            ok = spots.every(([ox, oy]) =>
                Math.abs(ox - x) >= minDx || Math.abs(oy - y) >= minDy);
        }
        if (!ok) {
            x = x0 + (i % 3) * ((x1 - x0) / 2);
            y = y0 + Math.floor(i / 3) * minDy;
        }
        spots.push([x, y]);
    }
    return spots;
}

/** Mock-silhouette cloud (2026 icon set): the icon sheet's shared cloud
 *  as its three elliptical arcs — right bump, wide flat top, left bump
 *  wider than the base line — mapped from the sheet's 24-box path
 *  (bbox x 3.9..21.4, y 7.0..19) into this contract: base at
 *  centerY + 2.4, crown at centerY - 6.1, 12.4 wide. The arc joins are
 *  the shoulders; smoothing them (first attempt) read as a semicircle.
 *  squash < 1 flattens vertically about the base (overcast back bank). */
function cloud(cr, centerX, centerY, scale, topColor, bottomColor, alpha = 1, squash = 1) {
    const gradient = new Cairo.LinearGradient(
        0, centerY + (2.4 - 8.52 * squash) * scale, 0, centerY + 2.4 * scale);
    gradient.addColorStopRGBA(0, topColor[0], topColor[1], topColor[2], alpha);
    gradient.addColorStopRGBA(1, bottomColor[0], bottomColor[1], bottomColor[2], alpha);
    cr.setSource(gradient);
    cr.save();
    cr.translate(centerX, centerY + 2.4 * scale);
    cr.scale(scale, scale * squash);
    cr.translate(0, -2.4);
    const earc = (cx, cy, rx, ry, a1, a2) => {
        cr.save();
        cr.translate(cx, cy);
        cr.scale(1, ry / rx);
        cr.arcNegative(0, 0, rx, a1, a2);
        cr.restore();
    };
    cr.newPath();
    cr.moveTo(-4.01, 2.4);
    cr.lineTo(3.24, 2.4);
    earc(3.14, -0.20, 3.06, 2.60, 1.539, -1.351);
    earc(-0.67, -2.28, 4.51, 3.83, -0.119, -3.261);
    earc(-3.36, 0.05, 2.84, 2.42, -2.252, -4.481);
    cr.closePath();
    cr.restore();
    cr.fill();
}

const CLOUD_LIGHT = [[0.76, 0.82, 0.87], [0.60, 0.68, 0.75]];
const CLOUD_RAIN = [[0.58, 0.60, 0.64], [0.40, 0.43, 0.48]];
/* grounds at or above the 0.30 tile bar (WCAG luminance -- an overcast
   card foot at plain 0.66 / WCAG 0.39): the 0.58 rain-cloud top measured
   only 0.07 of separation there, so grounds this pale earn the deepest
   cloud ink. Unsampled surfaces never tier: _groundLum stays -1 */
const CLOUD_DEEP = [[0.51, 0.56, 0.63], [0.33, 0.37, 0.45]];
/* overcast on bright grounds: pale enough to stay 'plain cloud' but
   deep enough for tile-size legs against a milky sky -- the 0.66 top
   vanished on the card's own background tone */
const CLOUD_OVERCAST = [[0.58, 0.60, 0.65], [0.42, 0.45, 0.50]];
const CLOUD_DARK = [[0.48, 0.52, 0.59], [0.32, 0.36, 0.43]];
/* the precipitation clouds follow the referee too: rain keeps its deep
 * gray while the glyph stands on bright ground, and joins the glow
 * family over dark ones (night tiles, hover/selected slabs) instead of
 * sinking into them -- it was the last hardcoded pale-blind cloud */
const precipCloud = () => groundLight() ? (paleGround() ? CLOUD_DEEP : CLOUD_RAIN) : CLOUD_LIGHT;
const stormCloud = () => groundLight() ? CLOUD_DARK : CLOUD_LIGHT;
/* the overcast/cloud body shared by the cloud, partly and fog poses */
const overcastBody = () =>
    !groundLight() ? CLOUD_LIGHT : paleGround() ? CLOUD_DEEP : CLOUD_OVERCAST;

/* Palette variants for light and dark backgrounds */
let _light = false;
/* luminance of the composited ground under the glyph (-1 = unknown),
 * handed in by the strip referee and the tile icons */
let _groundLum = -1;
let _night = false;
let _pale = false;
/* palette referee: the icon's OWN day/night flag decides whenever the
 * surface is sampled (any surface that passes groundLum also passes the
 * per-hour night flag it paints under). Pixel forensics over three
 * full days proved luminance sampling useless here: the ground under
 * a glyph is sky + glass + blur + chart fill composited, and no gate
 * survived contact with it -- rain passed while clouds failed on the
 * SAME pixels at [0.23,0.25), storm day at [0.248] flipped one gate
 * per scene drift. What never lies is time of day: every day icon
 * measured a 0.40-0.90 mid-bright ground (even the storm card), so
 * day earns ink; night keeps the pale glow. One exception measured from
 * the shipped cards: a bright-enough ground cannot hold off the glow
 * family no matter what the clock says -- the milky foot of a clear-sky
 * card (WCAG ~0.66) put the pale strip moon at ~1.0 contrast (invisible
 * to its own user). Pixel grading then proved the night bar sits HIGHER
 * than the day one: mid-blue card gradients at WCAG 0.30-0.45 defeat
 * BOTH families' cores, so night keeps its glow veto until
 * NIGHT_GLOW_MAX and only unambiguous milk earns the ink twins. The
 * forensics mid-tones ([0.23,0.30)) and the unsampled surfaces (panel,
 * accent style, preview) keep the old chain: night's veto and the
 * caller's light/dark flag respectively.
 * `pale: true` is the caller's hand on the palette: the day-tile
 * selection scrim is a deliberate dark slab no sky model sees, so the
 * selected tile claims the night glow for its glyph (same for solid-
 * style dark cards). */
export const NIGHT_GLOW_MAX = 0.45;
const groundLight = () =>
    _pale ? false
        : _groundLum >= (_night ? NIGHT_GLOW_MAX : GLYPH_INK_BAR) ? true
        : _groundLum >= 0 ? !_night : _light;
/* same bar as the day-tile glyph legibility rule, mirrored: WCAG-space
 * grounds below it push the glyph to the pale glow (menu's setPale),
 * grounds at or above it can afford the deepest ink. lumOf is
 * gamma-corrected, so "0.30" here means an ordinary daylight ground.
 * Exported (chart.js re-exports as GLYPH_BAR) so the tile verdict, the
 * strip gate, this tier and the certification matrix share one number */
export const GLYPH_INK_BAR = 0.30;
const paleGround = () => _groundLum >= GLYPH_INK_BAR;
// water rides the SAME referee as the glyph palette (painter's dark
// flag, chosen from the live ground under the icon): over bright sky a
// deep navy that holds contrast against luminance ~0.55, over night a
// light aqua that glows off the dark
/* water keeps deep navy down through mid-tone skies -- pale aqua on a
 * 0.5-luminance overcast card is invisible, and such grounds are too
 * bright for the glow-at-night palette to earn its keep */
const INK_WATER = () => groundLight()
    ? (paleGround() ? [0.10, 0.38, 0.80] : [0.05, 0.33, 0.68])
    : [0.38, 0.82, 1.00];
const INK_FLAKE = () => groundLight() ? [0.45, 0.56, 0.72] : [0.92, 0.96, 1.00];
const INK_STONE = () => groundLight() ? [0.55, 0.64, 0.76] : [0.91, 0.94, 0.97];
const INK_STREAK = () => groundLight()
    ? (paleGround() ? [0.24, 0.50, 0.85] : [0.24, 0.50, 0.78])
    : [0.50, 0.83, 1.00];
const INK_FOG = () => groundLight() ? [0.36, 0.44, 0.54] : [0.72, 0.76, 0.80];
const INK_STAR = () => groundLight() ? [0.55, 0.62, 0.74] : [0.95, 0.97, 1.00];
const INK_SPIN = () => _light ? [0.28, 0.33, 0.40] : [0.85, 0.88, 0.92];
/* the porcelain face is the only moon tier that needs a drawn edge;
 * the bright-ground ink tier separates by depth, the glow tier by halo */
const INK_MOON_EDGE = () =>
    groundLight() && !paleGround() ? [0.24, 0.30, 0.40, 0.85] : null;

/** Flowing dash "wind streak" across the full width of the scene. */
function streak(cr, y, lineWidth, alpha, dashOn, dashOff, offset, color = null) {
    const chosenColor = color ?? INK_STREAK();
    cr.save();
    cr.setSourceRGBA(chosenColor[0], chosenColor[1], chosenColor[2], alpha);
    cr.setLineWidth(lineWidth);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setDash([dashOn, dashOff], offset);
    cr.moveTo(-2, y);
    cr.curveTo(6, y - 1.1, 14, y + 1.1, 26, y);
    cr.stroke();
    cr.restore();
}

/** A few wind streaks, used for the windy scene and as an overlay. */
function windStreaks(cr, time, alphaScale, count = 3) {
    for (let i = 0; i < count; i++) {
        const y = 5.5 + i * (13 / Math.max(count - 1, 1));
        const speed = 3.2 + i * 0.9;
        streak(cr, y + Math.sin(time * 0.8 + i * 2.1) * 0.5,
            0.9 + (i % 2) * 0.35,
            (0.45 + 0.25 * ((i + 1) % 3)) * alphaScale,
            5 + i, 4.5 + i * 0.7,
            -(time * speed) % 9.5);
    }
}

/** Raindrops. Animated falls ride the shared particle clock; static poses
 *  (strip glyphs, day tiles) sit in an even staggered grid. Either way the
 *  shape is a teardrop, and intensity decides the COUNT -- heavier rain,
 *  more drops. */
function rainDrops(cr, particles, time, count, slant, alpha, band = [18.8, 20.0], dropScale = 1, xBand = [6.0, 18.0]) {
    const lastTime = particles.lastTime ?? particles.lastT;
    const dt = lastTime === null ? 0 : Math.min(0.06, time - lastTime);
    const waterColor = INK_WATER();
    cr.setSourceRGBA(waterColor[0], waterColor[1], waterColor[2], alpha);
    const total = Math.min(count, particles.drops.length);
    const spots = particles.static
        ? seededSpots(total, particles.seed ?? 7, xBand[0], xBand[1], band[0], band[1], 2.6, 0.9)
        : null;
    const marks = [];
    for (let i = 0; i < total; i++) {
        let x, y, s;
        if (particles.static) {
            [x, y] = spots[i];
            s = (i % 2 ? 1.05 : 1.25) * dropScale;
        } else {
            const drop = particles.drops[i];
            drop.y += (drop.speed ?? drop.sp) * dt;
            if (drop.y > 23.5) {
                drop.y = rand(14.6, 16.2);
                drop.x = rand(2.5, 21.5);
            }
            x = drop.x;
            y = drop.y;
            s = Math.min(1.4, 0.75 + (drop.length ?? drop.len) * 0.22) * dropScale;
        }
        const drawX = x - slant * (y - 10) * 0.18;
        marks.push([drawX, y, s]);
        teardrop(cr, drawX, y, s);
    }
    cr.fill();
    // the mock drop's white catch-light, upper-left of the bulb
    cr.setSourceRGBA(1, 1, 1, 0.8 * alpha);
    for (const [x, y, s] of marks)
        circle(cr, x - 0.34 * s, y - 0.28 * s, 0.20 * s);
    cr.fill();
}

/** Snowflakes (six spokes), drifting side to side. */
function snowFlakes(cr, particles, time, count, flakeBand = [18.2, 19.6], xBand = [6.6, 17.2]) {
    const lastTime = particles.lastTime ?? particles.lastT;
    const dt = lastTime === null ? 0 : Math.min(0.06, time - lastTime);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(0.75);
    const total = Math.min(count, particles.flakes.length);
    const flakeSpots = particles.static
        ? seededSpots(total, (particles.seed ?? 7) + 37, xBand[0], xBand[1],
            flakeBand[0], flakeBand[1], 2.5, 1.2)
        : null;
    for (let i = 0; i < total; i++) {
        let x, y, rot, radius;
        if (particles.static) {
            [x, y] = flakeSpots[i];
            radius = 1.7;
            rot = i * 1.1;
        } else {
            const flake = particles.flakes[i];
            const phase = flake.phase ?? flake.ph;
            flake.y += (flake.speed ?? flake.sp) * dt;
            if (flake.y > 23.5) {
                flake.y = rand(14.0, 15.6);
                flake.x = rand(3, 21);
            }
            x = flake.x + Math.sin(time * 1.4 + phase) * 1.1;
            y = flake.y;
            rot = time * 1.2 + phase;
            radius = (flake.radius ?? flake.r) * 1.45;
        }
        cr.save();
        cr.translate(x, y);
        cr.rotate(rot);
        const flakeColor = INK_FLAKE();
        cr.setSourceRGBA(flakeColor[0], flakeColor[1], flakeColor[2], 0.95);
        for (let k = 0; k < 6; k++) {
            const angle = (k / 6) * TWO_PI;
            line(cr, 0, 0, Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        cr.stroke();
        cr.restore();
    }
}

/** Hailstones: fall under gravity, bounce & scatter on the floor, respawn. */
function hailStones(cr, particles, time, count, xBand = [6.6, 17.2]) {
    const lastTime = particles.lastTime ?? particles.lastT;
    const dt = lastTime === null ? 0 : Math.min(0.06, time - lastTime);
    // static poses get the mock's pellet row (seeded, highlights and
    // all) instead of wherever the bounce physics froze mid-flight
    const spots = particles.static
        ? seededSpots(count, (particles.seed ?? 7) + 71, xBand[0], xBand[1], 17.2, 19.6, 3.4, 1.6)
        : null;
    for (let i = 0; i < count; i++) {
        const stone = particles.hail[i];
        if (particles.static) {
            const radius = i % 2 ? 1.35 : 1.6;
            const [sx, sy] = spots[i];
            const stoneColor = INK_STONE();
            cr.setSourceRGBA(stoneColor[0], stoneColor[1], stoneColor[2], 0.95);
            circle(cr, sx, sy, radius);
            cr.fill();
            cr.setSourceRGBA(1, 1, 1, 0.55);
            circle(cr, sx - radius * 0.3, sy - radius * 0.35, radius * 0.35);
            cr.fill();
            continue;
        }
        const radius = (stone.radius ?? stone.r) * 1.5;
        stone.vy += 24 * dt;
        stone.x += stone.vx * dt;
        stone.y += stone.vy * dt;
        if (stone.y >= FLOOR && stone.vy > 0) {
            stone.y = FLOOR;
            stone.vy *= -0.42;
            stone.vx = rand(-3, 3);
            stone.bounces++;
        }
        if (stone.bounces > 2 || (Math.abs(stone.vy) < 0.6 && stone.bounces > 0) ||
            stone.x < -1 || stone.x > 25)
            Object.assign(stone, newHailStone());
        const stoneColor = INK_STONE();
        cr.setSourceRGBA(stoneColor[0], stoneColor[1], stoneColor[2], 0.95);
        circle(cr, stone.x, stone.y, radius);
        cr.fill();
        cr.setSourceRGBA(1, 1, 1, 0.55);
        circle(cr, stone.x - radius * 0.3, stone.y - radius * 0.35, radius * 0.35);
        cr.fill();
    }
}

/* 2026 icon set sun: flat amber disc (vertical gradient, pale top to
 * deep base) with eight equal round rays gapped off the rim. Rotation
 * is the only motion — no glow, no ray-length pulse: the pulsing halo
 * read as a fading circle behind the glyph and fought the sky. */
function sunBody(cr, centerX, centerY, radius, time, rayLength) {
    // mock ray proportions: gap and stroke both 0.38 of the disc radius
    const gap = radius * 0.38;
    cr.save();
    cr.translate(centerX, centerY);
    cr.rotate(time * 0.14);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setSourceRGBA(0.96, 0.65, 0.14, 0.95);
    cr.setLineWidth(radius * 0.38);
    for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * TWO_PI;
        const cosAngle = Math.cos(angle), sinAngle = Math.sin(angle);
        cr.newSubPath();
        cr.moveTo(cosAngle * (radius + gap), sinAngle * (radius + gap));
        cr.lineTo(cosAngle * (radius + gap + rayLength), sinAngle * (radius + gap + rayLength));
        cr.stroke();
    }
    cr.restore();

    const core = new Cairo.LinearGradient(0, centerY - radius, 0, centerY + radius);
    core.addColorStopRGB(0, 1.0, 0.91, 0.66);
    core.addColorStopRGB(1, 1.0, 0.71, 0.18);
    cr.setSource(core);
    circle(cr, centerX, centerY, radius);
    cr.fill();
}

/* the moon's three grounds: over dark sky it glows (halo, bare disc);
 * over an unsampled light surface it wears porcelain + a drawn edge;
 * over a BRIGHT sampled ground the porcelain is the ground -- an
 * [0.84,0.86,0.90] face on the card's [0.80,0.85,0.90] milky foot is
 * 1.0 contrast, and the night strip moons vanished there. Same
 * silhouette, slate twin deep enough for a dark core on any ground
 * the ink referee accepts. */
const MOON_PORCELAIN = [0.84, 0.86, 0.90];
const MOON_INK = [0.38, 0.44, 0.55];
/* new moon over a bright ground: the lit slice is gone entirely
 * (moon.js early-returns below 1.2% illum), so the earthshine ghost is
 * the whole glyph -- and the pale 0.16-alpha ghost tuned for night sky
 * evaporates on milk. Hand the ghost the ink twin instead: a subtle
 * slate disc that reads as exactly what it is, a dark moon.
 * The ghost follows the DAY bar (0.30), not the night bar: it is a
 * FULL DISC, so it carries mass a thin crescent lacks -- alpha-blend
 * math puts 0.85-ink above the 0.10 separation floor across the whole
 * 0.30-0.45 mid band, where the 0.16 pale whisper never exceeds 0.03.
 * At 0.62 the disc was still 'hard to see' at strip scale; 0.85 is a
 * dark moon, not a smudge. */
const MOON_GHOST_INK = [0.38, 0.44, 0.55, 0.85];

function moonBody(cr, centerX, centerY, radius, time, particles, phase) {
    const lunarPhase = Number.isFinite(phase) ? phase : moonPhase().phase;
    const brightHere = groundLight();
    if (!brightHere) {
        const glow = new Cairo.RadialGradient(centerX, centerY, radius * 0.5, centerX, centerY, radius * 2.2);
        glow.addColorStopRGBA(0, 0.86, 0.87, 0.97, 0.30 * (0.25 + 0.75 * illumOf(lunarPhase)));
        glow.addColorStopRGBA(1, 0.86, 0.87, 0.97, 0);
        cr.setSource(glow);
        cr.paint();
    }

    paintMoon(cr, centerX, centerY, radius, lunarPhase, 'icon',
        {
            outline: INK_MOON_EDGE(),
            face: brightHere ? (paleGround() ? MOON_INK : MOON_PORCELAIN) : null,
            // the ghost's ink twin follows the DAY bar: on any ground
            // the ink verdict claims (and on unsampled light cards),
            // the unlit disc reads deeper than the face; deliberate
            // dark slabs (pale:true) keep the pale whisper
            ghost: !_pale && (_groundLum >= GLYPH_INK_BAR ||
                (_groundLum < 0 && _light)) ? MOON_GHOST_INK : null
        });

    const starColor = INK_STAR();
    // stars orbiting the drawn disc would dot the moon itself (worst on
    // the dark side); those inside disc + star size stay hidden
    const keepOut = radius + 2.2;
    for (const star of particles.stars) {
        if (Math.hypot(star.x - centerX, star.y - centerY) < keepOut)
            continue;
        const starPhase = star.phase ?? star.ph;
        const alpha = 0.35 + 0.6 * Math.abs(Math.sin(time * 1.3 + starPhase));
        cr.setSourceRGBA(starColor[0], starColor[1], starColor[2], alpha);
        circle(cr, star.x, star.y, 0.55);
        cr.fill();
    }
}

// mainly-clear (code 1): the mock shrinks the sun/moon up-left and
// rests one small cloud low-right -- clear, but not cloudless
function mainlyCloud(cr, time) {
    const body = overcastBody();
    cloud(cr, 16.1 + Math.sin(time * 0.6) * 0.5, 18.6, 0.73, body[0], body[1]);
}

function sceneSun(cr, ctx) {
    const { time, windy, variant } = ctx;
    if (variant === 'mainly') {
        sunBody(cr, 9.5, 9.5, 3.4, time, 1.7);
        mainlyCloud(cr, time);
    } else {
        sunBody(cr, 12, 12, 4.7, time, 2.3);
    }
    if (windy)
        windStreaks(cr, time, 0.45, 2);
}

function sceneMoon(cr, ctx) {
    const { time, particles, windy, phase, variant } = ctx;
    if (variant === 'mainly') {
        moonBody(cr, 9.5, 9.5, 4.6, time, particles, phase);
        mainlyCloud(cr, time);
    } else {
        moonBody(cr, 12, 12, 6.6, time, particles, phase);
    }
    if (windy)
        windStreaks(cr, time, 0.45, 2);
}

function scenePartly(cr, ctx) {
    const { time, windy, night, particles, phase } = ctx;
    if (night)
        moonBody(cr, 8.5, 8, 3.4, time, particles, phase);
    else
        sunBody(cr, 8.5, 8, 2.9, time, 1.4);
    const dx = Math.sin(time * 0.7) * 0.7;
    // the partly-cloudy cloud follows the same ground rule: it was the
    // one cloud body still hardcoded to the always-pale palette
    const body = overcastBody();
    cloud(cr, 13.2 + dx, 16.0, 1.19, body[0], body[1]);
    if (windy)
        windStreaks(cr, time, 0.4, 2);
}

function sceneCloud(cr, ctx) {
    const { time, windy, variant } = ctx;
    // unlisted WMO code: the mock's unknown pose -- one cloud, a
    // question mark standing under it where precip would hang
    if (variant === 'unknown') {
        const body = overcastBody();
        cloud(cr, 12 + Math.sin(time * 0.6) * 0.6, 12.2, 1.41, body[0], body[1]);
        const ink = INK_FOG();
        cr.save();
        cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        cr.setFontSize(8);
        cr.setSourceRGBA(ink[0], ink[1], ink[2], 0.95);
        const ext = cr.textExtents('?');
        cr.moveTo(12 - ext.xAdvance / 2 - ext.xBearing, 19.5 - ext.yBearing - ext.height / 2);
        cr.showText('?');
        cr.restore();
        return;
    }
    // overcast earns its silhouette: mid-gray over bright skies (the pale
    // cloud vanished into overcast white), pale body over night skies --
    // same light/dark referee as the INK_* family
    const overcast = overcastBody();
    cloud(cr, 8.2 - Math.sin(time * 0.5) * 0.8, 10.7, 1.04, overcast[0], overcast[1], 0.65, 0.70);
    cloud(cr, 13.1 + Math.sin(time * 0.6) * 0.7, 15.3, 1.24, overcast[0], overcast[1]);
    if (windy)
        windStreaks(cr, time, 0.4, 2);
}

/** Four-point frost sparkle (rime fog garnish). */
function spark(cr, x, y, s, alpha) {
    cr.save();
    cr.translate(x, y);
    cr.setSourceRGBA(1, 1, 1, alpha);
    cr.newPath();
    cr.moveTo(0, -2 * s);
    cr.curveTo(0.3 * s, -0.3 * s, 0.3 * s, -0.3 * s, 2 * s, 0);
    cr.curveTo(0.3 * s, 0.3 * s, 0.3 * s, 0.3 * s, 0, 2 * s);
    cr.curveTo(-0.3 * s, 0.3 * s, -0.3 * s, 0.3 * s, -2 * s, 0);
    cr.curveTo(-0.3 * s, -0.3 * s, -0.3 * s, -0.3 * s, 0, -2 * s);
    cr.fill();
    cr.restore();
}

function sceneFog(cr, ctx) {
    const { time, variant } = ctx;
    // the fog cloud keeps a pale body on night grounds and deepens to
    // the overcast gray on bright ones. Below it, the mock's three
    // centered tapering lines (not full-width dashes), breathing
    // sideways against each other
    const body = overcastBody();
    cloud(cr, 12.3 + Math.sin(time * 0.5) * 0.5, 9.4, 1.30, body[0], body[1], 0.85);
    const fogColor = INK_FOG();
    const widths = [13, 10, 6.5];
    cr.save();
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(1.7);
    for (let i = 0; i < 3; i++) {
        const y = 15.4 + i * 2.8;
        const half = widths[i] / 2;
        const slide = Math.sin(time * 0.9 + i * 2.1) * 0.6;
        cr.setSourceRGBA(fogColor[0], fogColor[1], fogColor[2],
            (groundLight() ? 0.85 : 0.75) - i * 0.15);
        cr.newPath();
        cr.moveTo(12 - half + slide, y);
        cr.lineTo(12 + half + slide, y);
        cr.stroke();
    }
    cr.restore();
    // depositing rime (code 48): frost sparkles on the cloud's flanks
    if (variant === 'rime') {
        const twinkle = 0.55 + 0.35 * Math.sin(time * 2.2);
        spark(cr, 19.4, 6.4, 0.8, twinkle);
        spark(cr, 4.6, 10.6, 0.6, 1.1 - twinkle);
    }
}

// precip scenes carry the mock's SINGLE cloud (the pair belongs to
// overcast alone), drifting gently; mark counts follow the mock tiers.
// Mock geometry, measured: cloud path spans 17.4 of the 24 box with
// its base at y15.1, marks in one tight row under it -- cloud() traces
// the path at 0.711, so scale 1.40 lands the same silhouette
function precipSceneCloud(cr, time, palette) {
    cloud(cr, 12 + Math.sin(time * 0.6) * 0.6, 11.7, 1.40, palette[0], palette[1]);
}

// showers (codes 80-82, 85-86): the mock keeps a complete sun/moon
// peeking from behind the cloud's top-left -- broken sky, brief fall
function showersPeek(cr, ctx) {
    const { time, night, particles, phase } = ctx;
    if (night)
        moonBody(cr, 7.5, 6.8, 3.2, time, particles, phase);
    else
        sunBody(cr, 7, 7, 2.4, time, 1.2);
    const palette = precipCloud();
    cloud(cr, 14.0 + Math.sin(time * 0.6) * 0.6, 13.0, 1.10, palette[0], palette[1]);
}

function sceneRain(cr, ctx) {
    const { time, particles, intensity, windKmh, windy, variant } = ctx;
    if (variant === 'showers')
        showersPeek(cr, ctx);
    else
        precipSceneCloud(cr, time, precipCloud());
    const slant = Math.min(0.9, windKmh / 45);
    if (variant === 'drizzle') {
        // drizzle reads by SIZE, not count: mini drops, denser by tier
        const dropCount = intensity <= 1 ? 3 : intensity === 2 ? 5 : 7;
        rainDrops(cr, particles, time, dropCount, slant, 0.85, [17.9, 19.0], 0.55);
    } else {
        const dropCount = intensity <= 1 ? 2 : intensity === 2 ? 3 : 5;
        rainDrops(cr, particles, time, dropCount, slant, 0.9);
    }
    if (windy)
        windStreaks(cr, time, 0.35, 2);
}

/** Snow grains (code 77): opaque white pellets, not flakes. Rides the
 *  flake particles for motion; only the mark changes. */
function snowGrains(cr, particles, time, count) {
    const lastTime = particles.lastTime ?? particles.lastT;
    const dt = lastTime === null ? 0 : Math.min(0.06, time - lastTime);
    const total = Math.min(count, particles.flakes.length);
    const spots = particles.static
        ? seededSpots(total, (particles.seed ?? 7) + 37, 6.6, 17.2, 17.4, 19.6, 2.5, 1.2)
        : null;
    const grainColor = INK_FLAKE();
    cr.setSourceRGBA(grainColor[0], grainColor[1], grainColor[2], 0.95);
    for (let i = 0; i < total; i++) {
        let x, y;
        if (particles.static) {
            [x, y] = spots[i];
        } else {
            const flake = particles.flakes[i];
            flake.y += (flake.speed ?? flake.sp) * dt;
            if (flake.y > 23.5) {
                flake.y = rand(14.0, 15.6);
                flake.x = rand(3, 21);
            }
            x = flake.x + Math.sin(time * 1.4 + (flake.phase ?? flake.ph)) * 0.7;
            y = flake.y;
        }
        circle(cr, x, y, 0.8);
        cr.fill();
    }
}

function sceneSnow(cr, ctx) {
    const { time, particles, intensity, windy, variant } = ctx;
    if (variant === 'showers') {
        showersPeek(cr, ctx);
        snowFlakes(cr, particles, time, intensity >= 3 ? 4 : 2);
    } else if (variant === 'grains') {
        precipSceneCloud(cr, time, precipCloud());
        snowGrains(cr, particles, time, 5);
    } else {
        precipSceneCloud(cr, time, precipCloud());
        const flakeCount = intensity <= 1 ? 2 : intensity === 2 ? 3 : 4;
        snowFlakes(cr, particles, time, flakeCount);
    }
    if (windy)
        windStreaks(cr, time, 0.35, 2);
}

/** Sleet / freezing rain: half drops, half flakes, extra slant. */
function sceneSleet(cr, ctx) {
    const { time, particles, windKmh, windy, variant } = ctx;
    precipSceneCloud(cr, time, precipCloud());
    const heavy = variant === 'freezingheavy';
    // one shared baseline row, as the mock composes freezing marks:
    // drop(s) flank the flake, never on top of it
    rainDrops(cr, particles, time, heavy ? 2 : 1,
        Math.min(1.1, windKmh / 36 + 0.25), 0.8, [18.6, 19.6], 1,
        heavy ? [6.4, 17.6] : [6.8, 10.2]);
    snowFlakes(cr, particles, time, 1, [18.2, 19.4],
        heavy ? [11.2, 13.2] : [13.2, 16.8]);
    if (heavy) {
        // freezing rain lands as ice: the mock's underline glaze
        const iceColor = INK_FLAKE();
        cr.save();
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineWidth(1.3);
        cr.setSourceRGBA(iceColor[0], iceColor[1], iceColor[2], 0.9);
        cr.newPath();
        cr.moveTo(6, 21.8);
        cr.lineTo(18, 21.8);
        cr.stroke();
        cr.restore();
    }
    if (windy)
        windStreaks(cr, time, 0.35, 2);
}

/** Hail: dark storm cloud and bouncing ice stones. The stormhail
 *  variants (codes 96/99, CAPE-derived hail) add the bolt left of the
 *  stones, as the mock composes them. */
function sceneHail(cr, ctx) {
    const { time, particles, windy, variant } = ctx;
    precipSceneCloud(cr, time, stormCloud());
    if (variant === 'stormhail' || variant === 'stormhailheavy') {
        drawBolt(cr, time, particles, -2.8);
        const heavy = variant === 'stormhailheavy';
        hailStones(cr, particles, time,
            Math.min(heavy ? 4 : 2, particles.hail.length),
            heavy ? [11, 19] : [13.5, 18.5]);
    } else {
        hailStones(cr, particles, time, Math.min(3, particles.hail.length));
    }
    if (windy)
        windStreaks(cr, time, 0.35, 2);
}

const BOLTS = [
    [[13, 13.0], [10.8, 16.9], [12.7, 16.9], [10.2, 21.9]],
    [[10.6, 12.6], [13.2, 16.3], [11.4, 16.5], [13.8, 22.1]],
];

// double-flick lightning every ~2.8 s, alternating bolt shape;
// static poses (tiles, strip glyphs) can't wait for the flicker
// window -- the bolt IS the scene, so it burns at full brightness
function drawBolt(cr, time, particles, dx = 0) {
    const cycle = Math.floor(time / 2.8);
    const cycleFraction = time % 2.8;
    let flash = 0;
    if (particles.static) flash = 1;
    else if (cycleFraction < 0.07) flash = cycleFraction / 0.07;
    else if (cycleFraction < 0.14) flash = 1 - (cycleFraction - 0.07) / 0.07;
    else if (cycleFraction < 0.20) flash = 0.6 * (cycleFraction - 0.14) / 0.06;
    else if (cycleFraction < 0.28) flash = 0.6 * (1 - (cycleFraction - 0.20) / 0.08);
    if (flash <= 0)
        return;
    // soft sky glow behind the bolt
    const glow = new Cairo.RadialGradient(12 + dx, 12, 2, 12 + dx, 12, 15);
    glow.addColorStopRGBA(0, 1, 1, 0.94, 0.22 * flash);
    glow.addColorStopRGBA(1, 1, 1, 0.94, 0);
    cr.setSource(glow);
    cr.paint();

    cr.save();
    cr.translate(dx, 0);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.setLineCap(Cairo.LineCap.ROUND);
    const bolt = BOLTS[particles.static ? 0 : cycle % BOLTS.length];
    cr.setSourceRGBA(1, 0.92, 0.23, flash);
    cr.setLineWidth(2.4);
    cr.moveTo(bolt[0][0], bolt[0][1]);
    for (let i = 1; i < bolt.length; i++)
        cr.lineTo(bolt[i][0], bolt[i][1]);
    cr.stroke();
    cr.setSourceRGBA(1, 1, 1, flash);
    cr.setLineWidth(0.9);
    cr.stroke();
    cr.restore();
}

function sceneStorm(cr, ctx) {
    const { time, particles, windKmh, windy } = ctx;
    precipSceneCloud(cr, time, stormCloud());
    rainDrops(cr, particles, time, 2, Math.min(0.9, windKmh / 45), 0.85);
    drawBolt(cr, time, particles);
    if (windy)
        windStreaks(cr, time, 0.3, 2);
}


function sceneWind(cr, ctx) {
    const { time } = ctx;
    // the mock's three continuous swooshes with end curls, drifting as
    // one group; dashed streaks stay only as the windy overlay elsewhere
    const ink = INK_STREAK();
    const drift = Math.sin(time * 1.2) * 0.6;
    cr.save();
    cr.translate(drift, 0);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(1.9);
    cr.setSourceRGBA(ink[0], ink[1], ink[2], 0.95);
    cr.newPath();
    cr.moveTo(3, 8.6);
    cr.lineTo(12.2, 8.6);
    cr.arcNegative(12.2, 6.0, 2.6, Math.PI / 2, -2.87);
    cr.stroke();
    cr.newPath();
    cr.moveTo(2.6, 12.8);
    cr.lineTo(15.8, 12.8);
    cr.arc(15.8, 15.7, 2.9, -Math.PI / 2, 2.86);
    cr.stroke();
    cr.newPath();
    cr.moveTo(4.5, 17.2);
    cr.lineTo(10.5, 17.2);
    cr.stroke();
    cr.restore();
}

function sceneError(cr) {
    cr.setSourceRGBA(0.95, 0.45, 0.40, 0.95);
    cr.setLineWidth(1.6);
    circle(cr, 12, 12, 7.5);
    cr.stroke();
    cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
    cr.setFontSize(11);
    cr.setSourceRGBA(0.95, 0.45, 0.40, 0.95);
    const extents = cr.textExtents('!');
    cr.moveTo(12 - extents.xAdvance / 2 - extents.xBearing, 12 - extents.yBearing - extents.height / 2);
    cr.showText('!');
}

function sceneLoading(cr, ctx) {
    const { time } = ctx;
    cr.save();
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(2);
    cr.setSourceRGBA(0.40, 0.43, 0.47, 0.25);
    circle(cr, 12, 12, 6);
    cr.stroke();
    cr.newPath();
    const angle = time * 4;
    cr.arc(12, 12, 6, angle, angle + Math.PI * 1.1);
    const spinColor = INK_SPIN();
    cr.setSourceRGBA(spinColor[0], spinColor[1], spinColor[2], 0.95);
    cr.stroke();
    cr.restore();
}

const SCENES = {
    sun: sceneSun, moon: sceneMoon, partly: scenePartly, cloud: sceneCloud,
    fog: sceneFog, rain: sceneRain, snow: sceneSnow, sleet: sceneSleet,
    hail: sceneHail, storm: sceneStorm, wind: sceneWind,
    error: sceneError, loading: sceneLoading,
};

/**
 * Paint one frame. `opts` must already be in grid space -- the caller scales
 * the context. Fields:
 *   scene      one of SCENES
 *   time       seconds since the icon appeared (animation clock)
 *   particles  pool from createParticles()
 *   windy      bool -- add wind streaks to the scene
 *   night      bool -- render night variant (partly)
 *   intensity  0..10 precipitation mm, drives drop/flake count
 *   windKmh    wind speed in km/h, drives rain slant
 */
let staticPool = null;   // one seeded pool for every static painter

export function paintWeather(cr, opts) {
    let particles;
    if (opts.staticPose) {
        if (!staticPool)
            staticPool = Object.assign(createParticles(), { static: true });
        particles = staticPool;
        particles.seed = opts.seed ?? 7;   // per-glyph layout variety
    } else
        particles = opts.particles || createParticles();
    _light = opts.dark === false;
    _groundLum = opts.groundLum ?? -1;
    _night = !!opts.night;
    _pale = !!opts.pale;
    const currentTime = opts.time || 0;
    const ctx = {
        time: currentTime,
        t: currentTime,
        particles,
        p: particles,
        windy: !!opts.windy,
        night: !!opts.night,
        intensity: opts.intensity || 0,
        variant: opts.variant ?? null,
        windKmh: opts.windKmh || 0,
        phase: Number.isFinite(opts.phase) ? opts.phase : moonPhase().phase,
    };
    cr.save();
    // fade rain/storm drops out from under the cloud
    const sceneRenderer = SCENES[opts.scene] || sceneError;
    sceneRenderer(cr, ctx);
    cr.restore();
    particles.lastTime = currentTime;
    particles.lastT = currentTime;
}
