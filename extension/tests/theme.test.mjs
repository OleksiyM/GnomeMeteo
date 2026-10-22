/* tests/theme.test.mjs -- the system dark/light verdict. Issue #89:
 * gsettings-desktop-schemas 50 removed the legacy
 * gtk-application-prefer-dark-theme key, so a light session (color-scheme
 * 'default', which is what GNOME's Light appearance writes) fell through
 * to reading a key that no longer exists and threw -- the watcher died
 * dark-locked, or, when switched live, every update threw. The verdict
 * is pure (scheme + legacy value-or-null) so it locks here without a
 * shell; null means "the schema has no legacy key" (GNOME 50+).
 */
import { resolveIsDark } from '../theme.js';
import { file, test, eq, report } from './harness.mjs';

file('theme');

test('explicit dark schemes are dark regardless of the legacy key', () => {
    eq(resolveIsDark('prefer-dark', null), true);
    eq(resolveIsDark('prefer-dark', false), true);
    eq(resolveIsDark('force-dark', null), true);
});

test('explicit light schemes are light regardless of the legacy key', () => {
    eq(resolveIsDark('prefer-light', null), false);
    eq(resolveIsDark('prefer-light', true), false);
    eq(resolveIsDark('force-light', null), false);
});

test("the 'default' scheme follows the legacy key where it exists", () => {
    eq(resolveIsDark('default', true), true);
    eq(resolveIsDark('default', false), false);
});

test("GNOME 50 light: 'default' with no legacy key reads LIGHT (#89)", () => {
    // schemas 50 dropped gtk-application-prefer-dark-theme; the caller
    // passes null instead of reading it. This is the case that used to
    // throw and leave the card dark-locked on a light desktop.
    eq(resolveIsDark('default', null), false);
    eq(resolveIsDark('', null), false);
});

report('theme');
