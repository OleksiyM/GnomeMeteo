// store.js — JSON-backed settings + city list for WeatherGlass.
// The extension used GSettings with a single location; a standalone app gets
// a real multi-city store at $XDG_CONFIG_HOME/weatherglass/config.json.

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import { logw, logerr } from './weather.js';

const APP_DIR = 'weatherglass';
const FILE_NAME = 'config.json';
const VERSION = 1;

const VALID_UNITS = ['metric', 'imperial'];
const REFRESH_CHOICES = [5, 10, 15, 30, 60];
export const DEFAULT_CITIES = [
    { name: 'Bengaluru', admin1: 'Karnataka', country: 'India', countryCode: 'IN', latitude: 12.9716, longitude: 77.5946 },
    { name: 'San Francisco', admin1: 'California', country: 'United States', countryCode: 'US', latitude: 37.7749, longitude: -122.4194 },
    { name: 'London', admin1: 'England', country: 'United Kingdom', countryCode: 'GB', latitude: 51.5072, longitude: -0.1276 },
    { name: 'Tokyo', admin1: 'Tokyo', country: 'Japan', countryCode: 'JP', latitude: 35.6895, longitude: 139.6917 },
];

function defaultConfig() {
    const cities = DEFAULT_CITIES.map(c => ({ id: GLib.uuid_string_random(), ...c }));
    return {
        version: VERSION,
        cities,
        activeCityId: cities[0].id,
        units: 'metric',
        refreshMinutes: 15,
    };
}

function sanitize(raw) {
    if (!raw || typeof raw !== 'object') return defaultConfig();
    const cfg = defaultConfig();
    if (Array.isArray(raw.cities)) {
        const cities = raw.cities.filter(c =>
            c && typeof c.name === 'string' &&
            Number.isFinite(+c.latitude) && +c.latitude >= -90 && +c.latitude <= 90 &&
            Number.isFinite(+c.longitude) && +c.longitude >= -180 && +c.longitude <= 180)
            .map(c => ({
                id: typeof c.id === 'string' && c.id ? c.id : GLib.uuid_string_random(),
                name: c.name,
                admin1: c.admin1 ?? '',
                country: c.country ?? '',
                countryCode: c.countryCode ?? '',
                latitude: +c.latitude,
                longitude: +c.longitude,
            }));
        cfg.cities = cities;
        cfg.activeCityId = cities.some(c => c.id === raw.activeCityId)
            ? raw.activeCityId
            : (cities[0]?.id ?? '');
    }
    cfg.units = VALID_UNITS.includes(raw.units) ? raw.units : cfg.units;
    cfg.refreshMinutes = REFRESH_CHOICES.includes(+raw.refreshMinutes)
        ? +raw.refreshMinutes
        : cfg.refreshMinutes;
    return cfg;
}

export class Config {
    #file;
    #bus;
    #cfg;
    #dirtyTimer = 0;

    constructor(bus) {
        this.#bus = bus;
        const confRoot = GLib.getenv('XDG_CONFIG_HOME') || GLib.build_filenamev([GLib.get_home_dir(), '.config']);
        const dirPath = GLib.build_filenamev([confRoot, APP_DIR]);
        GLib.mkdir_with_parents(dirPath, 0o700);
        const dir = Gio.File.new_for_path(dirPath);
        this.#file = dir.get_child(FILE_NAME);
        this.#cfg = this.#loadOrSeed();

        // Coalesce rapid mutations into one disk write.
        bus.on('config-changed', () => this.#scheduleSave());
    }

    #loadOrSeed() {
        const path = this.#file.get_path();
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
            try {
                const [ok, contents] = GLib.file_get_contents(path);
                if (ok) return sanitize(JSON.parse(new TextDecoder().decode(contents)));
            } catch (e) {
                logw(`config unreadable (${e.message}); seeding defaults`);
            }
        }
        const seeded = defaultConfig();
        this.#writeNow(seeded);
        return seeded;
    }

    get cities() { return [...this.#cfg.cities]; }
    get activeCityId() { return this.#cfg.activeCityId; }
    get units() { return this.#cfg.units; }
    get refreshMinutes() { return this.#cfg.refreshMinutes; }
    get refreshChoices() { return [...REFRESH_CHOICES]; }
    get animate() { return this.#cfg.animate !== false; }

    setAnimate(on) {
        on = !!on;
        if (this.#cfg.animate === on) return;
        this.#cfg.animate = on;
        this.#bus.emit('config-changed', 'animate');
    }

    cityById(id) { return this.#cfg.cities.find(c => c.id === id) ?? null; }

    activeCity() { return this.cityById(this.#cfg.activeCityId); }

    setActiveCity(id) {
        if (this.#cfg.activeCityId === id || !this.cityById(id)) return;
        this.#cfg.activeCityId = id;
        this.#bus.emit('config-changed', 'active-city');
    }

    setUnits(units) {
        if (!VALID_UNITS.includes(units) || this.#cfg.units === units) return;
        this.#cfg.units = units;
        this.#bus.emit('units-changed', units);
        this.#bus.emit('config-changed', 'units');
    }

    setRefreshMinutes(mins) {
        mins = +mins;
        if (!REFRESH_CHOICES.includes(mins) || this.#cfg.refreshMinutes === mins) return;
        this.#cfg.refreshMinutes = mins;
        this.#bus.emit('config-changed', 'refresh');
    }

    // Accepts a geocoder result or {name, latitude, longitude, ...}.
    addCity(loc) {
        const city = {
            id: GLib.uuid_string_random(),
            name: loc.name || 'Untitled',
            admin1: loc.admin1 ?? '',
            country: loc.country ?? '',
            countryCode: loc.countryCode ?? '',
            latitude: +loc.latitude,
            longitude: +loc.longitude,
        };
        this.#cfg.cities.push(city);
        this.#cfg.activeCityId = city.id;
        this.#bus.emit('cities-changed', { added: city.id });
        this.#bus.emit('config-changed', 'active-city');
        return city;
    }

    removeCity(id) {
        const idx = this.#cfg.cities.findIndex(c => c.id === id);
        if (idx < 0) return;
        this.#cfg.cities.splice(idx, 1);
        if (this.#cfg.activeCityId === id)
            this.#cfg.activeCityId = this.#cfg.cities[Math.max(0, idx - 1)]?.id ?? '';
        this.#bus.emit('cities-changed', { removed: id });
        this.#bus.emit('config-changed', 'active-city');
    }

    moveCity(id, delta) {
        const from = this.#cfg.cities.findIndex(c => c.id === id);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= this.#cfg.cities.length) return;
        const [city] = this.#cfg.cities.splice(from, 1);
        this.#cfg.cities.splice(to, 0, city);
        this.#bus.emit('cities-changed', { moved: id });
    }

    #scheduleSave() {
        // 400 ms debounce via a one-shot timer.
        if (this.#dirtyTimer) return;
        this.#dirtyTimer = GLib.timeout_add(GLib.PRIORITY_LOW, 400, () => {
            this.#dirtyTimer = 0;
            this.#writeNow(JSON.parse(JSON.stringify(this.#cfg)));
            return GLib.SOURCE_REMOVE;
        });
    }

    // Atomic: write alongside, rename over.
    #writeNow(cfg) {
        try {
            const tmpPath = this.#file.get_parent().get_path() + `/.${FILE_NAME}.tmp`;
            const tmpFile = Gio.File.new_for_path(tmpPath);
            tmpFile.replace_contents(JSON.stringify(cfg, null, 2) + '\n',
                null, false, Gio.FileCreateFlags.NONE, null);
            tmpFile.move(this.#file, Gio.FileCopyFlags.OVERWRITE, null, null);
        } catch (e) {
            logerr(e, 'saving config');
        }
    }
}
