// design-tokens.js — mechanical lock on the _paintDark furniture doctrine.
//
// WHY THIS EXISTS: hover/highlight colors on day tiles regressed twice with
// nobody catching it until a human glanced at the window. Colors that live
// only in prose ("use the dark glass") rot; these tokens are LOCKED here to
// the values the extension proves (menu.js hoverGlass/compGlass), and every
// rule the doctrine forbids is BANNED here, not merely discouraged.
// Fast and hermetic: parses data/style.css textually, no app boot.
import GLib from 'gi://GLib?version=2.0';
const HERE = GLib.filename_from_uri(import.meta.url)[0]
    .replace(/[^/]+$/, '');

let failures = 0;
function check(name, cond, extra = '') {
    if (cond) {
        print(`PASS ${name}`);
    } else {
        failures++;
        print(`FAIL ${name} ${extra}`);
    }
}

// tuple is [success, bytes] — mind the indices
const bytes = GLib.file_get_contents(
    `${HERE}/../data/style.css`)[1];
const css = new TextDecoder().decode(bytes);

// --- helper: declarations of every rule whose selector matches -----------
/** Declarations of every rule with a selector (or comma-part) matching the
 * pattern. Comments between blocks are stripped first — leaving them in
 * poisons the selector chunk with the previous rule's prose. */
function declsFor(selectorPattern) {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(bare)) !== null) {
        const sel = m[1].trim();
        if (sel.split(',').map(x => x.trim()).filter(Boolean)
            .some(part => selectorPattern.test(part)))
            out.push(m[2].replace(/\s+/g, ' ').trim());
    }
    return out;
}

// --- doctrine: animated-sky furniture is ALWAYS dark glass ----------------
/* .aw-day:hover / :checked — the EXACT extension-grounded values
 * (menu.js: hoverGlass 0.28 dark slab; compGlass 0.45 slab). If the
 * extension retunes these, update BOTH sides together, never one. */
check('day-tile hover takes the 0.28 dark glass',
    declsFor(/\.sky-on button\.day-tile:hover/).some(d =>
        /background: ?rgba\(16, 20, 28, 0\.28\)/.test(d)));

check('day-tile selected takes the 0.45 dark slab + white ink',
    declsFor(/\.sky-on button\.day-tile:checked/).some(d =>
        /background: ?rgba\(16, 20, 28, 0\.45\)/.test(d)
        && /border-color: ?rgba\(255, 255, 255, 0\.18\)/.test(d)
        && /color: ?#ffffff/.test(d)));

check('day-tile ink is white-on-sky with emboss shadow',
    declsFor(/^\.sky-on button\.day-tile$/).some(d =>
        /color: ?rgba\(255, 255, 255, 0\.95\)/.test(d)
        && /text-shadow/.test(d)));

check('lo label rides at 0.85 white',
    declsFor(/\.sky-on button\.day-tile \.day-lo/).some(d =>
        /color: ?rgba\(255, 255, 255, 0\.85\)/.test(d)));

// Window close: same glass family (0.34 / 0.52 hover / 0.65 pressed),
// always-dark by doctrine — it has NO .sky-on variant BY DESIGN.
check('win-close is a dark-glass circle with the tile token family',
    declsFor(/^button\.win-close$/).some(d =>
        /background: ?rgba\(16, 20, 28, 0\.34\)/.test(d)
        && /border-radius: ?999px/.test(d)
        && /color: ?#ffffff/.test(d))
    && declsFor(/^button\.win-close:hover$/).some(d =>
        /rgba\(16, 20, 28, 0\.52\)/.test(d))
    && declsFor(/^button\.win-close:active$/).some(d =>
        /rgba\(16, 20, 28, 0\.65\)/.test(d)));

// --- hover/press must be INSTANT: no transition games on furniture -------
for (const [label, pattern] of [
    ['day tiles', /(^|\s|,)button\.day-tile/],
    ['win-close', /^button\.win-close/],
]) {
    const leaks = declsFor(pattern).filter(d => /\btransition\b/.test(d));
    check(`no CSS transition on ${label} hover feedback`,
        leaks.length === 0, leaks.join(' | '));
}

// --- banned patterns (the regressions we actually lived through) ----------
check('NO verdict-keyed accent wash under an animated sky',
    !declsFor(/\.sky-on[^{}]*/).some(d => /@accent_bg_color/.test(d)));

check('NO light/white hover glass on sky furniture (dark is doctrine)',
    !declsFor(/\.sky-on[^{]*:hover/).some(d =>
        /background: ?rgba\(255, 255, 255/.test(d)
        || /background: ?white/.test(d)));

check('sky-on day-tile resting state stays transparent (backdrop shows)',
    declsFor(/^\.sky-on button\.day-tile$/).some(d =>
        /background: ?transparent/.test(d)));

if (failures) {
    print(`${failures} TOKEN FAILURE(S)`);
    throw new Error('design token drift — reconcile with extension/menu.js tokens');
}
print('DESIGN TOKENS PASSED');
