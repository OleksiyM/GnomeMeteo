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
