/* thermal.js -- Physical color scales for temperature, precipitation & wind */

export const SCALE_MIN_C = -20;
export const SCALE_MAX_C = 35;
export const TEMP_BAR_STYLES = ['spectrum', 'minimal'];

const SPECTRUM_STOPS = [
    [-20, [99, 60, 245]],   // #633cf5 - arctic violet-indigo
    [-12, [37, 99, 235]],   // #2563eb - cobalt blue
    [-5, [14, 165, 233]],   // #0ea5e9 - cerulean blue
    [0, [103, 232, 249]],   // #67e8f9 - glacier cyan at 0°C
    [5, [45, 212, 191]],    // #2dd4bf - vivid turquoise thaw
    [12, [190, 242, 100]],  // #bef264 - fresh spring lime
    [19, [250, 204, 21]],   // #facc15 - sunny gold
    [27, [249, 115, 22]],   // #f97316 - summer orange
    [35, [239, 68, 68]],    // #ef4444 - hot crimson red
];

const MINIMAL_STOPS = [
    [-20, [100, 116, 139]], // #64748b - cool graphite slate
    [-8, [136, 150, 171]],  // #8896ab - brushed steel
    [0, [176, 190, 207]],   // #b0becf - calm silver
    [15, [214, 223, 234]],  // #d6dfea - soft pearl
    [35, [248, 250, 252]],  // #f8fafc - crisp pearl white
];

const PRECIP_SPECTRUM_STOPS = [
    [0, [125, 211, 252]],   // #7dd3fc
    [35, [56, 189, 248]],   // #38bdf8
    [70, [59, 130, 246]],   // #3b82f6
    [100, [99, 102, 241]],  // #6366f1
];

const WIND_SPECTRUM_STOPS = [
    [0, [103, 232, 249]],   // #67e8f9
    [14, [45, 212, 191]],   // #2dd4bf
    [24, [163, 230, 53]],   // #a3e635
    [34, [250, 204, 21]],   // #facc15
    [45, [249, 115, 22]],   // #f97316
    [60, [239, 68, 68]],    // #ef4444
];

function interpolateStops(value, stops) {
    const minVal = stops[0][0];
    const maxVal = stops[stops.length - 1][0];
    const v = Math.max(minVal, Math.min(maxVal, value));

    for (let i = 0; i < stops.length - 1; i++) {
        const [v0, c0] = stops[i];
        const [v1, c1] = stops[i + 1];
        if (v <= v1) {
            const ratio = v1 === v0 ? 0 : (v - v0) / (v1 - v0);
            return [
                Math.round(c0[0] + (c1[0] - c0[0]) * ratio),
                Math.round(c0[1] + (c1[1] - c0[1]) * ratio),
                Math.round(c0[2] + (c1[2] - c0[2]) * ratio),
            ];
        }
    }

    return [...stops[stops.length - 1][1]];
}

export function getScaleStops(style = 'spectrum') {
    return style === 'minimal' ? MINIMAL_STOPS : SPECTRUM_STOPS;
}

export function tempToRgb(celsius, style = 'spectrum') {
    if (!Number.isFinite(celsius))
        return [125, 211, 252];

    return interpolateStops(celsius, getScaleStops(style));
}

export function rgbToHex([r, g, b]) {
    const toHex = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function tempToHex(celsius, style = 'spectrum') {
    return rgbToHex(tempToRgb(celsius, style));
}

export function precipBarColors(prob, style = 'spectrum') {
    const p = Math.max(0, Math.min(100, Number.isFinite(prob) ? prob : 0));
    if (style === 'minimal') {
        return {
            start: '#78889e',
            end: rgbToHex(interpolateStops(p, [[0, [148, 163, 184]], [100, [226, 232, 240]]])),
        };
    }
    return {
        start: rgbToHex(interpolateStops(p * 0.25, PRECIP_SPECTRUM_STOPS)),
        end: rgbToHex(interpolateStops(p, PRECIP_SPECTRUM_STOPS)),
    };
}

export function windBarColors(kmh, style = 'spectrum') {
    const w = Math.max(0, Math.min(60, Number.isFinite(kmh) ? kmh : 0));
    if (style === 'minimal') {
        return {
            start: '#78889e',
            end: rgbToHex(interpolateStops(w, [[0, [148, 163, 184]], [50, [241, 245, 249]]])),
        };
    }
    return {
        start: rgbToHex(interpolateStops(w * 0.3, WIND_SPECTRUM_STOPS)),
        end: rgbToHex(interpolateStops(w, WIND_SPECTRUM_STOPS)),
    };
}
