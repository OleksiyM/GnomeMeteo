// ink.js — adaptive ink verdicts, ported from the WeatherGlass extension
// (chart.js judges + ink-policy.js sampling grid). Boxes in, verdicts out:
// no Cairo, no clock — deterministic for a given bgPoint, so a label over a
// passing sun disc flips the SAME way the extension's popup does.

// Canonical inks from the extension.
export const INK_DARK = [0.063, 0.094, 0.137];
export const INK_LIGHT = [1, 1, 1];

// Glyph-only legibility bar in WCAG space (painter.js GLYPH_INK_BAR).
export const GLYPH_INK_BAR = 0.30;

export const lumOf = rgb => {
    const channelLum = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channelLum(rgb[0]) + 0.7152 * channelLum(rgb[1])
        + 0.0722 * channelLum(rgb[2]);
};

export function ratio(colorA, colorB) {
    const lumA = lumOf(colorA), lumB = lumOf(colorB);
    return (Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05);
}

/** Family pick for a single ground: dark ink only wins on a 1.35x margin. */
export const pickInk = bg =>
    ratio(INK_DARK, bg) >= ratio(INK_LIGHT, bg) * 1.35 ? INK_DARK : INK_LIGHT;

/** Worst-of-samples verdict for a group: whichever family survives the
 * WORST sample of every box wins for the whole group — labels sharing a
 * row must never split their verdict. `emboss` marks grounds where even
 * the winning family dips below 3:1 and earns a shadow. */
export function judgeInk(bgs) {
    const clean = bgs.filter(b => Number.isFinite(b[0] + b[1] + b[2]));
    if (!clean.length) return { ink: INK_LIGHT, emboss: false };
    const worstWhite = Math.min(...clean.map(bg => ratio(INK_LIGHT, bg)));
    const worstDark = Math.min(...clean.map(bg => ratio(INK_DARK, bg)));
    const ink = worstDark >= worstWhite * 1.35 ? INK_DARK : INK_LIGHT;
    return {
        ink,
        emboss: (ink === INK_DARK ? worstDark : worstWhite) < 3,
    };
}

/** Walk an accent toward the better ink until it clears 3.1:1 (series
 * lines, chart strokes). */
export function contrastSafe(accent, bg) {
    if (ratio(accent, bg) >= 3.1) return accent;
    const darkTarget = [0.09, 0.11, 0.15], lightTarget = [1, 1, 1];
    const target = ratio(darkTarget, bg) >= ratio(lightTarget, bg) ? darkTarget : lightTarget;
    let best = accent;
    for (let t = 0.1; t <= 1.001; t += 0.1) {
        best = accent.map((v, i) => v + (target[i] - v) * t);
        if (ratio(best, bg) >= 3.1) return best;
    }
    return best;
}

/* HSV deepening from the extension's lineInk: keep hue, boost saturation,
 * lower value until the worst-ground contrast clears. */
function deepen(baseRgb) {
    const maxVal = Math.max(...baseRgb), minVal = Math.min(...baseRgb), delta = maxVal - minVal;
    let hue = delta === 0 ? 0
        : maxVal === baseRgb[0] ? (60 * ((baseRgb[1] - baseRgb[2]) / delta) + 360) % 360
            : maxVal === baseRgb[1] ? 60 * ((baseRgb[2] - baseRgb[0]) / delta + 2)
                : 60 * ((baseRgb[0] - baseRgb[1]) / delta + 4);
    const sat = Math.min(1, (maxVal === 0 ? 0 : delta / maxVal) * 1.3 + 0.12);
    const toRgb = val => {
        const chroma = val * sat, x = chroma * (1 - Math.abs((hue / 60) % 2 - 1)), m = val - chroma;
        return [[chroma, x, 0], [x, chroma, 0], [0, chroma, x],
            [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][Math.floor(hue / 60) % 6]
            .map(k => k + m);
    };
    return toRgb;
}

/** Chart-series line color judged against every ground it will cross.
 * Warm ambers are exempt (the extension keeps "temperature amber always"). */
export function lineInk(baseColor, bgColors) {
    if (!bgColors.length) return baseColor;
    const worstRatio = c => Math.min(...bgColors.map(bg => ratio(c, bg)));
    if (baseColor[0] - baseColor[2] > 0.2)
        return baseColor;
    if (worstRatio(baseColor) >= 3)
        return baseColor;
    const toRgb = deepen(baseColor);
    let val = Math.max(...baseColor);
    while (val > 0.08 && worstRatio(toRgb(val)) < 3.05)
        val *= 0.97;
    return toRgb(val);
}

// --- box sampling (ink-policy.js) ------------------------------------------

// Five samples per label box: centre, left/right flanks, above and below —
// a disc grazing ANY of them counts against the text.
export const SAMPLE_GRID = [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5],
    [0.5, 0.25], [0.5, 0.75]];

/** On-screen box [x, y, w, h] -> sample fractions over a card of
 * cardWidth x cardHeight. y clamps; x stays raw (an ellipsized label may
 * overhang its allocation and that ground still sits under the text). */
export function boxSampleFractions(box, cardWidth, cardHeight) {
    const [x0, y0, bw, bh] = box;
    const out = [];
    for (const [rx, ry] of SAMPLE_GRID) {
        const fy = Math.min(1, Math.max(0, (y0 + bh * ry) / cardHeight));
        const fx = (x0 + bw * rx) / cardWidth;
        if (Number.isFinite(fx + fy)) out.push([fx, fy]);
    }
    return out;
}

/** Judge a group of boxes as ONE ground. */
export function judgeBoxes(boxes, cardWidth, cardHeight, bgPoint, comp = rgb => rgb) {
    const bgs = [];
    for (const box of boxes) {
        if (!box) continue;
        for (const [fx, fy] of boxSampleFractions(box, cardWidth, cardHeight))
            bgs.push(comp(bgPoint(fx, fy)));
    }
    return judgeInk(bgs);
}

// --- compositing ------------------------------------------------------------

export function compositeOver(src, dst) {
    // src may be [r,g,b] or [r,g,b,a]; over-blend onto opaque dst
    const a = src.length > 3 ? src[3] : 1;
    return [0, 1, 2].map(i => src[i] * a + dst[i] * (1 - a));
}

// --- applying verdicts to GTK widgets ----------------------------------------

/** Apply a judgeInk() verdict to a widget via CSS classes. Without `skyOn`
 * the classes are stripped and the theme's own ink rules apply. */
export function applyInk(widget, verdict, skyOn) {
    const light = verdict && verdict.ink === INK_LIGHT;
    widget.add_css_class(light ? 'ink-light' : 'ink-dark');
    widget.remove_css_class(light ? 'ink-dark' : 'ink-light');
    const emb = verdict && verdict.emboss;
    widget.add_css_class(emb ? (light ? 'emboss-light' : 'emboss-dark') : 'emboss-none');
    widget.remove_css_class(!emb ? (light ? 'emboss-dark' : 'emboss-light') : 'emboss-none');
    if (!skyOn) {
        for (const c of ['ink-light', 'ink-dark', 'emboss-light', 'emboss-dark', 'emboss-none'])
            widget.remove_css_class(c);
    }
}
