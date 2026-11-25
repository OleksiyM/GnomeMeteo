// GnomeMeteo Preferences Loader for GNOME Shell 45+
// Clean dynamic loader: enables hot-reload of prefs-ui.js on every Preferences open
// without restarting the org.gnome.Shell.Extensions D-Bus service.

import GLib from 'gi://GLib';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

if (!('_meteoInitialLanguageEnv' in globalThis))
    globalThis._meteoInitialLanguageEnv = GLib.getenv('LANGUAGE');

export default class GnomeMeteoPrefs extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const moduleUrl = `${this.dir.get_uri()}/prefs-ui.js?t=${Date.now()}`;
        const { fillPreferencesWindow } = await import(moduleUrl);
        fillPreferencesWindow(this, window);
    }
}
