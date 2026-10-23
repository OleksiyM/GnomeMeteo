// GnomeMeteo Extension for GNOME Shell 45+
// Clean dynamic loader: enables hot-reload of indicator.js on disable/enable without restarting GNOME Shell.

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class GnomeMeteoExtension extends Extension {
    async enable() {
        console.log(`[GnomeMeteo] Dynamic loading implementation from ${this.dir.get_uri()}`);
        try {
            const moduleUrl = `${this.dir.get_uri()}/indicator.js?t=${Date.now()}`;
            const { MeteoIndicator } = await import(moduleUrl);
            this._indicator = new MeteoIndicator(this);
            const Main = await import('resource:///org/gnome/shell/ui/main.js');
            Main.panel.addToStatusArea(this.uuid, this._indicator, 1, 'right');
            console.log('[GnomeMeteo] Clean indicator successfully added to status area!');
        } catch (err) {
            console.error(`[GnomeMeteo] Failed to load indicator: ${err.message}`, err.stack);
        }
    }

    disable() {
        console.log('[GnomeMeteo] Disabling extension');
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
