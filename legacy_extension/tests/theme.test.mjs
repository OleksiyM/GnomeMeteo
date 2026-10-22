/* tests/theme.test.mjs -- the system dark/light verdict. Issue #89:
 * gsettings-desktop-schemas 50 removed the legacy
 * gtk-application-prefer-dark-theme key, so a light session (color-scheme
 * 'default', which is what GNOME's Light appearance writes) fell through
 * to reading a key that no longer exists and threw -- the watcher died
 * dark-locked, or, when switched live, every update threw. The verdict
 * is pure (scheme + legacy value-or-null) so it locks here without a
 * shell; null means "the schema has no legacy key" (GNOME 50+).
 */
import { resolveIsDark, resolveShellDark } from '../theme.js';
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

// -- the SHELL surface verdict (accent style, #89 follow-up) ----------
// The accent style borrows the shell's own popup surface, whose variant
// is NOT the app scheme: gnome-shell (ui/main.js getStyleVariant) runs
// the session mode's colorScheme preference against the system scheme.
// Vanilla user mode is 'prefer-dark', so 'default' (light apps) leaves
// the shell DARK -- accent ink judged by resolveIsDark alone stranded
// dark text on that dark popup. resolveShellDark mirrors the shell's
// table; null = mode declares no preference (pre-variant shells), and
// the caller falls back to the app verdict.

test("prefer-dark session mode: 'default' keeps the shell DARK (#89fu)", () => {
    eq(resolveShellDark('default', 'prefer-dark'), true);
    eq(resolveShellDark('', 'prefer-dark'), true);
    eq(resolveShellDark('prefer-dark', 'prefer-dark'), true);
    eq(resolveShellDark('prefer-light', 'prefer-dark'), false);
    eq(resolveShellDark('force-light', 'prefer-dark'), false);
});

test('prefer-light session mode: only explicit dark darkens the shell', () => {
    eq(resolveShellDark('default', 'prefer-light'), false);
    eq(resolveShellDark('prefer-light', 'prefer-light'), false);
    eq(resolveShellDark('prefer-dark', 'prefer-light'), true);
    eq(resolveShellDark('force-dark', 'prefer-light'), true);
});

test('forced session modes win over the system scheme', () => {
    eq(resolveShellDark('prefer-light', 'force-dark'), true);
    eq(resolveShellDark('prefer-dark', 'force-light'), false);
    eq(resolveShellDark('default', 'force-light'), false);
});

test('no mode preference: null, caller falls back to the app verdict', () => {
    eq(resolveShellDark('default', ''), null);
    eq(resolveShellDark('prefer-dark', undefined), null);
    eq(resolveShellDark('prefer-light', null), null);
});

report('theme');
