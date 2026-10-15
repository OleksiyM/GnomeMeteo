// application.js — Adw.Application: single instance, config + forecast
// coordinator ownership, CSS load, GNOME clock-format tracking.

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import Gdk from 'gi://Gdk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import { Bus, logw, brandTexture } from './weather.js';
import { Config } from './store.js';
import { Forecasts } from './coordinator.js';
import { MainWindow } from './window.js';

export const APP_ID = 'dev.vijaybala.weatherglass';

function datadir() {
    const fromEnv = GLib.getenv('WEATHERGLASS_DATADIR');
    if (fromEnv) return Gio.File.new_for_path(fromEnv);
    // src/application.js -> ../data
    const here = Gio.File.new_for_uri(import.meta.url).get_parent();
    return here.get_parent().get_child('data');
}

export const WeatherGlassApp = GObject.registerClass({ gTypeName: 'WeatherGlassApp' },
class WeatherGlassApp extends Adw.Application {
    bus;
    #window = null;
    #interfaceSettings = null;
    #cssProvider = null;

    constructor() {
        super({
            application_id: APP_ID,
            flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
        });
        this.set_option_context_summary(
            'WeatherGlass — multi-city weather for GNOME, powered by Open-Meteo.');
    }

    vfunc_startup() {
        super.vfunc_startup();

        // --- shared bus ---------------------------------------------------------
        this.bus = new Bus();
        this.bus.config = new Config(this.bus);
        this.bus.locale = { h12: this.#readClockFormat() };
        this.bus.forecasts = new Forecasts(this.bus);

        // --- styles ----------------------------------------------------------------
        const css = datadir().get_child('style.css');
        this.#cssProvider = new Gtk.CssProvider();
        this.#cssProvider.load_from_path(css.get_path());
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            this.#cssProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

        // --- preferences plumbing ---------------------------------------------------
        this.bus.on('config-changed', kind => {
            if (kind === 'refresh') this.bus.forecasts.startPeriodic();
        });
        this.bus.on('cities-changed', ({ added }) => {
            if (added) this.bus.forecasts.kick(added, true);
        });

        // --- GNOME clock format (12 h vs 24 h) ---------------------------------------
        try {
            this.#interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            this.#interfaceSettings.connect('changed::clock-format', () => {
                this.bus.locale.h12 = this.#readClockFormat();
                this.bus.emit('locale-props', this.bus.locale);
            });
        } catch (e) {
            logw(`interface settings unavailable (${e.message}); using 24h clock`);
        }

        this._startUi();
    }

    _startUi() {
        this.#window = new MainWindow(this);
        this.window = this.#window; // public handle for debugging/tests
        const tex = brandTexture(128);
        if (tex) {
            try {
                this.#window.set_icon_list([tex]);
            } catch (e) {
                logw(`window icon unavailable (${e.message})`);
            }
        }
        this.#window.present();

        // Warm every configured city once, serially, then keep them fresh.
        this.bus.forecasts.kick(this.bus.config.activeCityId);
        this.bus.forecasts.startPeriodic();
    }

    vfunc_activate() {
        if (this.#window)
            this.#window.present();
        else
            this._startUi();
    }

    vfunc_shutdown() {
        this.bus.forecasts.stopPeriodic();
        super.vfunc_shutdown();
    }

    #readClockFormat() {
        try {
            const s = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
            return s.get_string('clock-format') === '12h';
        } catch {
            return false;
        }
    }
});
