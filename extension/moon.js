/* moon.js -- Astronomical lunar phase and illumination calculator for GnomeMeteo */

const TWO_PI = Math.PI * 2;

// Mean synodic month (days) and reference new moon: 2000-01-06 18:14 UTC.
const SYNODIC_MONTH_DAYS = 29.530588853;
const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14, 0);
const MILLISECONDS_PER_DAY = 86400000;

const PHASE_NAMES = [
    [0.03, 'New Moon'],
    [0.22, 'Waxing Crescent'],
    [0.28, 'First Quarter'],
    [0.47, 'Waxing Gibbous'],
    [0.53, 'Full Moon'],
    [0.72, 'Waning Gibbous'],
    [0.78, 'Last Quarter'],
    [0.97, 'Waning Crescent'],
    [1.00, 'New Moon'],
];

/**
 * Returns { phase (0..1), illum (0..1), waxing (bool), name (string) }
 * for the given Date (defaults to current time).
 */
export function moonPhase(date = new Date()) {
    const daysSinceEpoch = (date.getTime() - NEW_MOON_EPOCH) / MILLISECONDS_PER_DAY;
    let phase = (daysSinceEpoch % SYNODIC_MONTH_DAYS) / SYNODIC_MONTH_DAYS;
    if (phase < 0)
        phase += 1;
    const illum = (1 - Math.cos(TWO_PI * phase)) / 2;
    const name = PHASE_NAMES.find(([threshold]) => phase < threshold)[1];
    return { phase, illum, waxing: phase < 0.5, name };
}
