/* theme.js -- the system dark/light verdict, pure so the unit locks
 * can pin it without a shell. extension.js owns the Gio.Settings reads;
 * this module only decides what they mean.
 *
 * legacyPreferDark is the old gtk-application-prefer-dark-theme boolean,
 * or null when the resolved schema has no such key: gsettings-desktop-
 * schemas 50 removed it (issue #89), and GNOME's Light appearance writes
 * color-scheme 'default' rather than 'prefer-light', so 'default' with
 * no legacy key must read as LIGHT -- falling through to a get_boolean
 * on the absent key threw and dark-locked the card on light desktops. */

export function resolveIsDark(scheme, legacyPreferDark) {
    if (scheme === 'prefer-dark' || scheme === 'force-dark')
        return true;
    if (scheme === 'prefer-light' || scheme === 'force-light')
        return false;
    return legacyPreferDark === true;
}

/* The SHELL surface verdict, mirroring gnome-shell's getStyleVariant
 * (ui/main.js): the session mode's own colorScheme preference referees
 * the system scheme. The vanilla user mode prefers dark, so a plain
 * light desktop ('default') keeps a DARK shell -- which is why the
 * accent style, alone among the styles in borrowing the shell popup
 * surface instead of painting its own ground, must judge its ink by
 * this table and not by resolveIsDark. Returns null when the mode
 * declares no preference (shells predating theme variants); the caller
 * then falls back to the app verdict, the pre-variant behavior. */
export function resolveShellDark(scheme, modeScheme) {
    const systemLight = scheme === 'prefer-light' || scheme === 'force-light';
    const systemDark = scheme === 'prefer-dark' || scheme === 'force-dark';
    switch (modeScheme) {
    case 'force-dark':
        return true;
    case 'force-light':
        return false;
    case 'prefer-dark':
        return !systemLight;
    case 'prefer-light':
        return systemDark;
    default:
        return null;
    }
}
