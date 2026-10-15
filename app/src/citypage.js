// citypage.js — per-city view: hero, stat tiles, metric segments, hourly
// chart, day tiles. Follows the extension popup's section order
// (header → chart → days), expanded with the details it parsed but never
// displayed (feels-like, humidity, wind compass, UV, pressure, moon phase).

import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import { makeWeatherIcon } from './painter.js';
import { HourlyChart, CHART_SERIES } from './chart.js';
import {
    effectiveScene, precipIntensity, sceneFor, moonPhase, daySlice, cityWallMs,
    dayName, fmtTemp, fmtWind, fmtPressure, fmtVisibility, fmtPrecipRate,
    fmtClock, fmtDayStamp, fmtLocalIso, compass, uvBand, relTime, locationLabel,
} from './weather.js';

const METRIC_KEYS = ['temp', 'precip', 'wind'];

function statTile(title) {
    const titleLbl = new Gtk.Label({ label: title, css_classes: ['stat-title'] });
    const valueLbl = new Gtk.Label({ label: '—', css_classes: ['stat-value'] });
    valueLbl.set_wrap(true);
    valueLbl.set_xalign(0);
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        margin_top: 10, margin_bottom: 10,
        margin_start: 14, margin_end: 14,
        css_classes: ['card', 'stat-tile'],
    });
    box.append(titleLbl);
    box.append(valueLbl);
    return { box, valueLbl };
}

function caption(text) {
    return new Gtk.Label({ label: text, xalign: 0, css_classes: ['dim-label', 'caption'] });
}

export const CityPage = GObject.registerClass({ gTypeName: 'WCityPage' },
class CityPage extends Gtk.Box {
    city;

    #bus;
    #data = null;
    #dayIndex = 0;
    #h12 = false;
    #ticker = 0;

    #glyphState = { scene: 'partly', night: false, phase: 0.62 };
    #moonIconState = { scene: 'moon', phase: 0.62, night: true };

    #stack; #spinnerRow; #errorBanner; #errorBannerLabel; #coldErrorLabel;
    #tempLabel; #condLabel; #feelsLabel; #clockLabel; #dateLabel; #updatedLabel;
    #heroSpinner; #chart; #daySummary; #moonGlyph; #moonLabel; #sunLabel;
    #tilesFlow; #dayBtns = []; #metricBtns = [];
    #tiles = {};

    constructor(bus, city) {
        super({ orientation: Gtk.Orientation.VERTICAL });
        this.city = city;
        this.#bus = bus;

        this.#stack = new Gtk.Stack();
        this.#stack.set_vexpand(true);
        this.#stack.set_hexpand(true);

        const scroll = new Gtk.ScrolledWindow();
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        scroll.set_child(this.#buildReady());
        this.#stack.add_named(scroll, 'ready');
        this.#stack.add_named(this.#buildBusy(), 'loading');
        this.#stack.add_named(this.#buildColdError(), 'error');

        // slim top bar: refresh indicator + metric picker stay reachable
        const toolbar = new Gtk.CenterBox();
        const leftSlot = new Gtk.Box({ spacing: 6 });
        this.#heroSpinner = new Gtk.Spinner({ visible: false, margin_start: 8 });
        this.#updatedLabel = new Gtk.Label({ label: '', css_classes: ['dim-label', 'caption'] });
        leftSlot.append(this.#heroSpinner);
        leftSlot.append(this.#updatedLabel);
        {
            const btns = [];
            for (let i = 0; i < METRIC_KEYS.length; i++) {
                const key = METRIC_KEYS[i];
                const btn = new Gtk.ToggleButton({
                    label: CHART_SERIES[key].label.split(' ')[0],
                    tooltip_text: CHART_SERIES[key].label,
                });
                if (i === 0) btn.set_active(true);
                else btn.set_group(btns[i - 1]);
                btn.connect('toggled', () => {
                    if (!btn.active) return;
                    this.#chart.metric = key;
                });
                btns.push(btn);
            }
            this.#metricBtns = btns;
        }
        const seg = new Gtk.Box({ css_classes: ['linked'] });
        for (const b of this.#metricBtns) seg.append(b);

        this.spinnerRow = this.#heroSpinner;
        toolbar.set_start_widget(leftSlot);
        toolbar.set_center_widget(seg);

        this.append(toolbar);
        this.append(this.#stack);

        // subscriptions
        bus.on('forecast-updated', (id, data) => { if (id === city.id) this.apply(data); });
        bus.on('forecast-failed', (id, err) => { if (id === city.id) this.#showFailure(err); });
        bus.on('forecast-status', (id, fetching) => {
            if (id === city.id) {
                this.#heroSpinner.visible = fetching;
                if (fetching) this.#heroSpinner.start();
                else this.#heroSpinner.stop();
            }
        });
        bus.on('units-changed', u => { if (this.#data) this.apply(this.#data, true); });
        bus.on('locale-props', p => this.setLocale(p));

        this.connect('map', () => {
            if (!this.#ticker) {
                this.#ticker = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 20, () => {
                    this.#tickClock();
                    return GLib.SOURCE_CONTINUE;
                });
                this.#tickClock();
            }
        });
        this.connect('unmap', () => {
            if (this.#ticker) {
                GLib.Source.remove(this.#ticker);
                this.#ticker = 0;
            }
        });

        const cached = bus.forecasts?.getState(city.id);
        if (cached?.data) this.apply(cached.data);
    }

    // ---- construction -----------------------------------------------------------

    #buildReady() {
        const clamp = new Adw.Clamp({ maximum_size: 780, tightening_threshold: 620 });
        const root = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 14,
            margin_top: 12, margin_bottom: 20,
            margin_start: 14, margin_end: 14,
        });
        clamp.set_child(root);

        // hero ------------------------------------------------------------------
        const hero = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 18 });
        hero.append(makeWeatherIcon(92, () => this.#glyphState,
            () => this.#bus.config.animate));

        const heroLeft = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            valign: Gtk.Align.CENTER,
        });
        this.#tempLabel = new Gtk.Label({ label: '—', css_classes: ['hero-temp'] });
        this.#condLabel = new Gtk.Label({ xalign: 0, css_classes: ['hero-cond'] });
        this.#feelsLabel = new Gtk.Label({ xalign: 0, css_classes: ['dim-label'] });
        heroLeft.append(this.#tempLabel);
        heroLeft.append(this.#condLabel);
        heroLeft.append(this.#feelsLabel);
        hero.append(heroLeft);

        const sp = new Gtk.Box({ hexpand: true });
        hero.append(sp);

        const heroRight = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.END,
            spacing: 2,
        });
        this.#clockLabel = new Gtk.Label({ label: '--:--', css_classes: ['hero-clock'] });
        this.#dateLabel = new Gtk.Label({ label: '' });
        this.#dateLabel.add_css_class('dim-label');
        heroRight.append(this.#clockLabel);
        heroRight.append(this.#dateLabel);
        heroRight.append(caption('')); // placeholder line for "updated" alignment
        hero.append(heroRight);
        root.append(hero);

        // error banner ------------------------------------------------------------
        this.#errorBanner = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            css_classes: ['card', 'warning-banner'],
            visible: false,
        });
        this.#errorBanner.append(new Gtk.Image({ icon_name: 'dialog-warning-symbolic' }));
        this.#errorBannerLabel = new Gtk.Label({ label: '', xalign: 0, wrap: true });
        this.#errorBanner.append(this.#errorBannerLabel);
        root.append(this.#errorBanner);

        // stat tiles ----------------------------------------------------------------
        const tiles = new Gtk.FlowBox();
        tiles.set_selection_mode(Gtk.SelectionMode.NONE);
        tiles.set_homogeneous(true);
        tiles.set_max_children_per_line(3);
        tiles.set_row_spacing(10);
        tiles.set_column_spacing(10);
        for (const [key, title] of [['wind', 'Wind'], ['humidity', 'Humidity'],
            ['pressure', 'Pressure'], ['uv', 'UV index'], ['visibility', 'Visibility'],
            ['precip', 'Precipitation']]) {
            const t = statTile(title);
            tiles.insert(t.box, -1);
            this.#tiles[key] = t.valueLbl;
        }
        root.append(tiles);

        // sun & moon ------------------------------------------------------------
        const astro = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 14,
            css_classes: ['card'],
            margin_top: 2, margin_bottom: 2,
            margin_start: 6, margin_end: 6,
        });
        this.#moonGlyph = makeWeatherIcon(30, () => this.#moonIconState, () => false);
        astro.append(this.#moonGlyph);
        const sunCol = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2, hexpand: true });
        this.#sunLabel = new Gtk.Label({ label: 'Sunrise — · Sunset —', xalign: 0 });
        sunCol.append(this.#sunLabel);
        sunCol.append(caption('Sunrise and sunset (city-local)'));
        astro.append(sunCol);
        this.#moonLabel = new Gtk.Label({ label: 'Moon', css_classes: ['dim-label'] });
        astro.append(this.#moonLabel);
        root.append(astro);

        // chart -----------------------------------------------------------------
        const chartCard = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 6,
            css_classes: ['card', 'chart-card'],
            margin_start: 6, margin_end: 6,
            margin_top: 2, margin_bottom: 2,
        });
        this.#daySummary = new Gtk.Label({ label: '', css_classes: ['day-summary'] });
        chartCard.append(this.#daySummary);
        this.#chart = new HourlyChart();
        chartCard.append(this.#chart);
        root.append(chartCard);

        // day tiles ---------------------------------------------------------------
        this.#tilesFlow = new Gtk.FlowBox();
        this.#tilesFlow.set_selection_mode(Gtk.SelectionMode.NONE);
        this.#tilesFlow.set_homogeneous(true);
        this.#tilesFlow.set_max_children_per_line(4);
        this.#tilesFlow.set_row_spacing(8);
        this.#tilesFlow.set_column_spacing(8);
        root.append(this.#tilesFlow);

        root.append(new Gtk.LinkButton({
            uri: 'https://open-meteo.com/',
            label: 'Weather data by Open-Meteo.com',
            css_classes: ['flat', 'caption'],
            halign: Gtk.Align.CENTER,
        }));
        return clamp;
    }

    #buildBusy() {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });
        const sp = new Gtk.Spinner();
        sp.start();
        box.append(sp);
        box.append(new Gtk.Label({ label: 'Fetching the forecast…', css_classes: ['dim-label'] }));
        return box;
    }

    #buildColdError() {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });
        box.append(makeWeatherIcon(64, () => ({ scene: 'error' }), () => false));
        this.#coldErrorLabel = new Gtk.Label({
            label: 'Could not reach the weather service.',
            css_classes: ['dim-label'],
            justify: Gtk.Justification.CENTER,
        });
        box.append(this.#coldErrorLabel);
        const retry = new Gtk.Button({ label: 'Try Again', halign: Gtk.Align.CENTER });
        retry.add_css_class('suggested-action');
        retry.connect('clicked', () => this.#bus.emit('request-refresh', this.city.id));
        box.append(retry);
        return box;
    }

    // ---- state updates ------------------------------------------------------------

    setLocale({ h12 }) {
        this.#h12 = !!h12;
        this.#chart.h12 = this.#h12;
        this.#tickClock();
    }

    set dark(v) { this.#chart.dark = v; }

    apply(data, silent = false) {
        this.#data = data;
        const c = data.current;
        const units = this.#bus.config.units;
        const scene = effectiveScene(c);
        const mp = moonPhase();
        this.#glyphState = {
            scene: scene.scene,
            night: scene.night,
            intensity: precipIntensity(c.code),
            phase: mp.phase,
        };

        this.#tempLabel.label = fmtTemp(c.temp, units);
        this.#condLabel.label = scene.desc;
        const region = locationLabel(this.city);
        this.#feelsLabel.label = `Feels like ${fmtTemp(c.feels, units)}${region ? ` · ${region}` : ''}`;

        this.#tiles.wind.label = `${fmtWind(c.wind, units)} ${compass(c.windDeg)}`.trim();
        this.#tiles.humidity.label = c.humidity != null ? `${Math.round(c.humidity)}%` : '—';
        this.#tiles.pressure.label = fmtPressure(c.pressure, units);
        this.#tiles.visibility.label = fmtVisibility(c.visibility, units);
        this.#tiles.precip.label = fmtPrecipRate(c.precip, units);
        this.#tiles.uv.label = c.uv != null
            ? `${Math.round(c.uv)} · ${uvBand(c.uv).label}`
            : '—';

        const today = data.daily[0];
        if (today?.sunrise) {
            this.#sunLabel.label =
                `Sunrise ${fmtLocalIso(today.sunrise, this.#h12)} · Sunset ${fmtLocalIso(today.sunset, this.#h12)}`;
        }
        this.#moonIconState = { scene: 'moon', phase: mp.phase, night: true };
        this.#moonLabel.label = `${mp.name}\n${Math.round(mp.illum * 100)}% lit`;
        this.#moonGlyph.queue_draw();

        this.#errorBanner.visible = false;
        this.#buildDayTiles();
        this.#stack.visible_child_name = 'ready';
        this.#updatedLabel.label = relTime(data.fetchedAtWallMs);
        if (!silent) this.#tickClock();
    }

    #showFailure(error) {
        const state = this.#bus.forecasts?.getState(this.city.id);
        if (state?.data) {
            this.#errorBannerLabel.label =
                `Refresh failed — showing data from ${relTime(state.at)}. (${error.message})`;
            this.#errorBanner.visible = true;
        } else {
            this.#coldErrorLabel.label =
                `Could not reach the weather service.\n${error.message}`;
            this.#stack.visible_child_name = 'error';
        }
    }

    #buildDayTiles() {
        this.#tilesFlow.remove_all();
        this.#dayBtns = [];
        const units = this.#bus.config.units;
        this.#data.daily.forEach((day, i) => {
            const info = sceneFor(day.code, true);
            const btn = new Gtk.ToggleButton({ css_classes: ['day-tile'] });
            if (i === this.#dayIndex) btn.set_active(true);
            if (i > 0) btn.set_group(this.#dayBtns[i - 1]);

            const box = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 3,
                margin_top: 8, margin_bottom: 8,
            });
            box.append(new Gtk.Label({
                label: i === 0 ? 'Today' : dayName(day.date),
                css_classes: ['day-name'],
            }));
            box.append(makeWeatherIcon(30,
                () => ({ scene: info.scene, night: false, intensity: 2, seed: i * 13 + 5 }),
                () => false));
            box.append(new Gtk.Label({
                label: `${fmtTemp(day.tmax, units)} / ${fmtTemp(day.tmin, units)}`,
                css_classes: ['day-hilo'],
            }));
            btn.set_child(box);
            btn.connect('toggled', () => {
                if (!btn.active) return;
                this.#dayIndex = i;
                this.#rerender();
            });
            this.#tilesFlow.insert(btn, -1);
            this.#dayBtns.push(btn);
        });
        this.#rerender();
    }

    #rerender() {
        if (!this.#data) return;
        const units = this.#bus.config.units;
        const slice = daySlice(this.#data.hourly, this.#data.daily, this.#dayIndex,
            cityWallMs(this.#data));
        this.#chart.setData(slice);

        const day = this.#data.daily[Math.min(this.#dayIndex, this.#data.daily.length - 1)];
        if (day) {
            const info = sceneFor(day.code, true);
            const extras = [];
            if (day.precipProb != null) extras.push(`${Math.round(day.precipProb)}% precip chance`);
            if (day.windMax != null) extras.push(`up to ${fmtWind(day.windMax, units)}`);
            this.#daySummary.label =
                `${this.#dayIndex === 0 ? 'Today' : dayName(day.date)} · ${info.desc} · `
                + `H ${fmtTemp(day.tmax, units)} L ${fmtTemp(day.tmin, units)}`
                + (extras.length ? ` · ${extras.join(' · ')}` : '');
        }
    }

    #tickClock() {
        if (!this.#data) return;
        const wall = cityWallMs(this.#data);
        this.#clockLabel.label = fmtClock(wall, this.#h12);
        this.#dateLabel.label = fmtDayStamp(wall);
        this.#updatedLabel.label = relTime(this.#data.fetchedAtWallMs);
    }
});
