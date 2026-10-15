// citypage.js — per-city view over the ANIMATED SKY BACKDROP (both ported
// from the extension): hero, stat tiles, metric picker, hourly chart, day
// tiles — all wearing ADAPTIVE INK, judged worst-of-five-samples against the
// composited ground (gradient + sun/moon disc + glass), so a passing disc
// flips whole label families exactly like the extension popup.
//
// Section order mirrors the extension popup (header → chart → days), and
// adds what it parsed but never displayed (feels-like, humidity, wind
// compass, UV, pressure, moon phase).

import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import Adw from 'gi://Adw?version=1';
import { makeWeatherIcon } from './painter.js';
import { makeSkyBackdrop, sampleSky, bodyOf } from './sky.js';
import { HourlyChart, CHART_SERIES } from './chart.js';
import {
    judgeBoxes, judgeInk, lineInk, compositeOver, applyInk,
    lumOf, boxSampleFractions, GLYPH_INK_BAR, INK_LIGHT,
} from './ink.js';
import {
    effectiveScene, precipIntensity, sceneFor, moonPhase, daySlice, cityWallMs,
    sunShade, dayName, fmtTemp, fmtWind, fmtPressure, fmtVisibility, fmtPrecipRate,
    fmtClock, fmtDayStamp, fmtLocalIso, compass, uvBand, relTime, locationLabel,
} from './weather.js';

const METRIC_KEYS = ['temp', 'precip', 'wind'];

// Translucent card glass over the sky. THESE ALPHA VALUES ARE MIRRORED IN
// data/style.css (.sky-on card) — the ink judge composites with exactly the
// tint the eye sees; drift here would decouple verdict from pixels.
const GLASS_LIGHT = [1, 1, 1, 0.55];
const GLASS_DARK = [0.05, 0.06, 0.09, 0.52];

// Day-tile slabs — the extension's exact recipes (menu.js compGlass/
// hoverGlass + stylesheet .aw-day-sel): a selected tile wears DARK glass
// in the dark card (white-on-white vanishes over bright skies). Mirrored
// by .sky-on button.day-tile rules in data/style.css.
const SLAB_LIGHT = [1, 1, 1, 0.68];
const SLAB_DARK = [16 / 255, 20 / 255, 28 / 255, 0.45];
const HOVER_LIGHT = [1, 1, 1, 0.40];
const HOVER_DARK = [16 / 255, 20 / 255, 28 / 255, 0.28];

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

// GJS freezes vfuncs at registration — the registerClass wrapper is mandatory.
export const CityPage = GObject.registerClass({ gTypeName: 'WCityPage' },
class CityPage extends Gtk.Box {
    city;

    #bus;
    #data = null;
    #dayIndex = 0;
    #h12 = false;
    #ticker = 0;
    #rejudgePending = false;
    #rejudgeDebounce = 0;

    #glyphState = { scene: 'partly', night: false, phase: 0.62 };
    #moonIconState = { scene: 'moon', phase: 0.62, night: true };
    #skyScene = 'loading';
    #skyNight = false;
    #moonPhase = 0.62;

    #stack; #overlay; #backdrop; #vadj; #heroGlyphWrap;
    #errorBanner; #errorBannerLabel; #coldErrorLabel;
    #tempLabel; #condLabel; #feelsLabel; #clockLabel; #dateLabel; #updatedLabel;
    #heroSpinner; #updRow;
    #chart; #daySummary; #segBox; #moonGlyph; #moonLabel; #sunLabel;
    #tilesFlow; #dayTiles = []; #hoverTile = -1; #metricBtns = [];
    #tiles = {};
    #heroLeft; #heroRight; #statFlow; #astroBox;

    constructor(bus, city) {
        super({ orientation: Gtk.Orientation.VERTICAL });
        this.city = city;
        this.#bus = bus;

        // ---- sky backdrop under everything -----------------------------------
        this.#backdrop = makeSkyBackdrop(
            () => this.#skyView(),
            () => bus.config.animate);

        this.#stack = new Gtk.Stack({ vexpand: true, hexpand: true });
        const scroll = new Gtk.ScrolledWindow();
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        this.#vadj = scroll.get_vadjustment();
        scroll.set_child(this.#buildReady());
        this.#stack.add_named(scroll, 'ready');
        this.#stack.add_named(this.#buildBusy(), 'loading');
        this.#stack.add_named(this.#buildColdError(), 'error');

        // floating update row (extension's ghost refresh corner)
        this.#updRow = new Gtk.Box({
            spacing: 6,
            halign: Gtk.Align.END,
            valign: Gtk.Align.START,
            hexpand: true,
            margin_top: 6, margin_end: 10,
        });
        this.#heroSpinner = new Gtk.Spinner({ visible: false });
        this.#updatedLabel = new Gtk.Label({ label: '', css_classes: ['dim-label', 'caption'] });
        this.#updRow.append(this.#heroSpinner);
        this.#updRow.append(this.#updatedLabel);

        // Base layer = the sky; content floats above it as overlay children.
        // measure_overlay keeps the scrollable content in the size negotiation
        // (the DrawingArea's own natural size is zero).
        this.#overlay = new Gtk.Overlay();
        this.#overlay.set_child(this.#backdrop);
        this.#overlay.add_overlay(this.#stack);
        this.#overlay.set_measure_overlay(this.#stack, true);
        this.#overlay.add_overlay(this.#updRow);

        this.append(this.#overlay);

        // ---- subscriptions ----------------------------------------------------
        bus.on('forecast-updated', (id, data) => { if (id === city.id) this.apply(data); });
        bus.on('forecast-failed', (id, err) => { if (id === city.id) this.#showFailure(err); });
        bus.on('forecast-status', (id, fetching) => {
            if (id === city.id) {
                this.#heroSpinner.visible = fetching;
                if (fetching) this.#heroSpinner.start();
                else this.#heroSpinner.stop();
            }
        });
        bus.on('units-changed', () => { if (this.#data) this.apply(this.#data, true); });
        bus.on('locale-props', p => this.setLocale(p));
        bus.on('config-changed', kind => {
            if (kind === 'sky' || kind === 'animate') {
                this.#applySkyMode();
                this.#invalidateSky();
            }
        });

        // re-judge ink on scroll / growth (debounced 80 ms, one pass)
        this.#vadj.connect('value-changed', () => this.#scheduleRejudge());
        this.#overlay.connect('notify::default-width', () => this.#scheduleRejudge());

        this.connect('map', () => {
            if (!this.#ticker) {
                this.#ticker = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 20, () => {
                    this.#tickClock();
                    this.#invalidateSky();
                    return GLib.SOURCE_CONTINUE;
                });
                this.#tickClock();
            }
            this.#scheduleRejudge();
        });
        this.connect('unmap', () => {
            if (this.#ticker) {
                GLib.Source.remove(this.#ticker);
                this.#ticker = 0;
            }
        });

        this.#applySkyMode();

        const cached = bus.forecasts?.getState(city.id);
        if (cached?.data)
            this.apply(cached.data);
        else
            this.#goLoading();
    }

    // ---- sky state ---------------------------------------------------------------

    get #skyOn() { return this.#bus.config.sky; }

    #skyView() {
        const wall = this.#data ? cityWallMs(this.#data) : Date.now();
        const { glow, solar } = sunShade(this.city.id, this.city.latitude,
            this.city.longitude, wall);
        return {
            scene: this.#skyScene,
            night: this.#skyNight,
            phase: this.#moonPhase,
            glow, solar,
        };
    }

    #invalidateSky() {
        if (this.#skyOn) this.#backdrop.invalidateState?.();
    }

    #glassTint() {
        return Adw.StyleManager.get_default().dark ? GLASS_DARK : GLASS_LIGHT;
    }

    /** Composited ground rgb at page-space px (sky + celestial disc). */
    #groundAtPx(x, y, W, H) {
        const v = this.#skyView();
        let rgb = sampleSky(v.scene, v.night, y / Math.max(1, H), v.glow, v.solar);
        const body = bodyOf(v.scene, v.night, W, H, v.glow, v.solar, v.phase);
        if (body) {
            const d = Math.hypot(x - body.x, y - body.y);
            if (d < body.r + body.soft) {
                const fall = 1 - Math.max(0, d - body.r) / body.soft;
                rgb = rgb.map((c, i) => c + (body.col[i] - c) * fall * body.max);
            }
        }
        return rgb;
    }

    /** Card-space box [x,y,w,h] of a widget, accumulated up to the overlay. */
    #boxOf(widget) {
        let x = 0, y = 0;
        let w = widget;
        while (w && w !== this.#overlay) {
            const a = w.get_allocation();
            x += a.x; y += a.y;
            w = w.get_parent();
        }
        if (w !== this.#overlay) return null; // unmapped / not in page
        const a = widget.get_allocation();
        if (a.width <= 1 || a.height <= 1) return null;
        return [x, y, a.width, a.height];
    }

    #scheduleRejudge(debounceMs = 80) {
        if (this.#rejudgeDebounce) return;
        this.#rejudgeDebounce = GLib.timeout_add(GLib.PRIORITY_LOW, debounceMs, () => {
            this.#rejudgeDebounce = 0;
            this.#rejudge();
            return GLib.SOURCE_REMOVE;
        });
    }

    #rejudge() {
        if (!this.#skyOn || !this.get_mapped()) return;
        const W = this.#overlay.get_width(), H = this.#overlay.get_height();
        if (W < 50 || H < 50) return;
        const glass = this.#glassTint();
        const bgPoint = (fx, fy) => this.#groundAtPx(fx * W, fy * H, W, H);
        const judge = (widgets, comp) => {
            const boxes = widgets.map(w => this.#boxOf(w)).filter(Boolean);
            if (!boxes.length) return null;
            return judgeBoxes(boxes, W, H, bgPoint, comp);
        };
        const raw = rgb => rgb, compGlass = rgb => compositeOver(glass, rgb);
        const on = true;

        applyInk(this.#heroLeft, judge([this.#heroLeft], raw), on);
        applyInk(this.#heroRight, judge([this.#heroRight], raw), on);
        applyInk(this.#updRow, judge([this.#updRow], raw), on);
        const cardsVerdict = judge([this.#statFlow, this.#astroBox], compGlass);
        applyInk(this.#statFlow, cardsVerdict, on);
        applyInk(this.#astroBox, cardsVerdict, on);

        // day tiles sit straight on the sky (extension layout): judge EACH
        // tile against ITS OWN ground — selected tiles add the glass slab,
        // hovered tiles the thinner one; the glyph pales with its labels
        // ("one verdict, drawn twice, never apart").
        const darkTheme = Adw.StyleManager.get_default().dark;
        const slab = darkTheme ? SLAB_DARK : SLAB_LIGHT;
        const hoverSlab = darkTheme ? HOVER_DARK : HOVER_LIGHT;
        this.#dayTiles.forEach((t, i) => {
            const box = this.#boxOf(t.btn);
            if (!box) return;
            const selected = i === this.#dayIndex;
            const hovered = !selected && i === this.#hoverTile;
            const comp = selected ? rgb => compositeOver(slab, rgb)
                : hovered ? rgb => compositeOver(hoverSlab, rgb) : raw;
            const bgs = boxSampleFractions(box, W, H)
                .map(([fx, fy]) => comp(bgPoint(fx, fy)));
            const verdict = judgeInk(bgs);
            applyInk(t.btn, verdict, on);
            const center = comp(this.#groundAtPx(
                box[0] + box[2] / 2, box[1] + box[3] / 2, W, H));
            const pale = selected || verdict.ink === INK_LIGHT
                || lumOf(center) < GLYPH_INK_BAR;
            if (t.glyphState.pale !== pale) {
                t.glyphState.pale = pale;
                t.icon.queue_draw();
            }
        });

        // full-bleed chart zone sits on the OPEN sky — no glass comp
        applyInk(this.#daySummary, judge([this.#daySummary], raw), on);
        applyInk(this.#segBox, judge([this.#segBox], raw), on);

        // chart internals: the plot crosses many grounds — one ink family
        // survives the WORST sample of the grid; series lines get walked
        // away from the average ground until they clear 3.1:1.
        const chartBox = this.#boxOf(this.#chart);
        if (chartBox) {
            const [bx, by, bw, bh] = chartBox;
            const bgs = [];
            for (let fy = 0.08; fy <= 0.95; fy += 0.145)
                for (let fx = 0.08; fx <= 0.95; fx += 0.145)
                    bgs.push(raw(this.#groundAtPx(bx + fx * bw, by + fy * bh, W, H)));
            const series = {};
            for (const k of Object.keys(CHART_SERIES))
                series[k] = lineInk(CHART_SERIES[k].rgb, bgs);
            this.#chart.setJudgedInk(judgeInk(bgs).ink, series);
        }
    }

    /** (chart-local px,py) -> composited sky luminance, for the strip's
     * per-glyph pale verdict. Null when the sky is off (fallback palettes). */
    #chartGroundLum(px, py) {
        if (!this.#skyOn) return null;
        const box = this.#boxOf(this.#chart);
        const W = this.#overlay.get_width(), H = this.#overlay.get_height();
        if (!box || W < 50 || H < 50) return null;
        return lumOf(this.#groundAtPx(box[0] + px, box[1] + py, W, H));
    }

    // ---- construction -------------------------------------------------------------

    #buildReady() {
        const clamp = new Adw.Clamp({ maximum_size: 780, tightening_threshold: 620 });
        // THREE bands: a padded top column, the FULL-BLEED chart zone (GTK
        // forbids negative margins, so the bleed is structural — the middle
        // band simply carries no side gutters), and a padded bottom column.
        const outer = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });
        const top = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 14,
            margin_top: 18, margin_start: 14, margin_end: 14,
        });
        const bottom = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            margin_top: 4, margin_bottom: 20,
            margin_start: 14, margin_end: 14,
        });
        outer.append(top);
        clamp.set_child(outer);

        // hero --------------------------------------------------------------------
        const hero = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 18 });
        this.#heroGlyphWrap = new Gtk.Box();
        this.#heroGlyphWrap.append(makeWeatherIcon(92, () => this.#glyphState,
            () => this.#bus.config.animate));
        hero.append(this.#heroGlyphWrap);

        this.#heroLeft = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            valign: Gtk.Align.CENTER,
        });
        this.#tempLabel = new Gtk.Label({ label: '—', css_classes: ['hero-temp'] });
        this.#condLabel = new Gtk.Label({ xalign: 0, css_classes: ['hero-cond'] });
        this.#feelsLabel = new Gtk.Label({ xalign: 0, css_classes: ['hero-feels'] });
        this.#heroLeft.append(this.#tempLabel);
        this.#heroLeft.append(this.#condLabel);
        this.#heroLeft.append(this.#feelsLabel);
        hero.append(this.#heroLeft);

        hero.append(new Gtk.Box({ hexpand: true }));

        this.#heroRight = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.END,
            spacing: 2,
        });
        this.#clockLabel = new Gtk.Label({ label: '--:--', css_classes: ['hero-clock'] });
        this.#dateLabel = new Gtk.Label({ label: '', css_classes: ['dim-label'] });
        this.#heroRight.append(this.#clockLabel);
        this.#heroRight.append(this.#dateLabel);
        hero.append(this.#heroRight);
        top.append(hero);

        // error banner (refresh failed, stale data shown) ---------------------------
        this.#errorBanner = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            css_classes: ['card', 'warning-banner'],
            visible: false,
        });
        this.#errorBanner.append(new Gtk.Image({ icon_name: 'dialog-warning-symbolic' }));
        this.#errorBannerLabel = new Gtk.Label({ label: '', xalign: 0, wrap: true });
        this.#errorBanner.append(this.#errorBannerLabel);
        top.append(this.#errorBanner);

        // stat tiles ------------------------------------------------------------------
        this.#statFlow = new Gtk.FlowBox();
        this.#statFlow.set_selection_mode(Gtk.SelectionMode.NONE);
        this.#statFlow.set_homogeneous(true);
        this.#statFlow.set_max_children_per_line(3);
        this.#statFlow.set_row_spacing(10);
        this.#statFlow.set_column_spacing(10);
        for (const [key, title] of [['wind', 'Wind'], ['humidity', 'Humidity'],
            ['pressure', 'Pressure'], ['uv', 'UV index'], ['visibility', 'Visibility'],
            ['precip', 'Precipitation']]) {
            const t = statTile(title);
            this.#statFlow.insert(t.box, -1);
            this.#tiles[key] = t.valueLbl;
        }
        top.append(this.#statFlow);

        // sun & moon -----------------------------------------------------------------
        this.#astroBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 14,
            css_classes: ['card'],
            margin_top: 2, margin_bottom: 2,
            margin_start: 6, margin_end: 6,
        });
        this.#moonGlyph = makeWeatherIcon(30, () => this.#moonIconState, () => false);
        this.#astroBox.append(this.#moonGlyph);
        const sunCol = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL, spacing: 2, hexpand: true,
        });
        this.#sunLabel = new Gtk.Label({ label: 'Sunrise — · Sunset —', xalign: 0 });
        sunCol.append(this.#sunLabel);
        sunCol.append(caption('Sunrise and sunset (city-local)'));
        this.#astroBox.append(sunCol);
        this.#moonLabel = new Gtk.Label({ label: 'Moon', css_classes: ['dim-label'] });
        this.#astroBox.append(this.#moonLabel);
        top.append(this.#astroBox);

        // FULL-BLEED chart zone, like the extension popup: the curve, the
        // condition strip and the hour rail lie straight on the sky with no
        // card behind them, bleeding to the page edges.
        const chartCard = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            css_classes: ['chart-zone'],
        });
        this.#segBox = new Gtk.Box({
            css_classes: ['linked'],
            halign: Gtk.Align.CENTER,
        });
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
                    this.#scheduleRejudge(0);
                });
                btns.push(btn);
            }
            this.#metricBtns = btns;
            for (const b of this.#metricBtns) this.#segBox.append(b);
        }
        chartCard.append(this.#segBox);
        this.#daySummary = new Gtk.Label({ label: '', css_classes: ['day-summary'] });
        chartCard.append(this.#daySummary);
        this.#chart = new HourlyChart();
        chartCard.append(this.#chart);
        outer.append(chartCard);
        outer.append(bottom);

        // day tiles ---------------------------------------------------------------------
        this.#tilesFlow = new Gtk.FlowBox();
        this.#tilesFlow.set_selection_mode(Gtk.SelectionMode.NONE);
        this.#tilesFlow.set_homogeneous(true);
        this.#tilesFlow.set_max_children_per_line(4);
        this.#tilesFlow.set_row_spacing(8);
        this.#tilesFlow.set_column_spacing(8);
        bottom.append(this.#tilesFlow);

        bottom.append(new Gtk.LinkButton({
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
        box.set_name('busy-page');
        const sp = new Gtk.Spinner();
        sp.start();
        box.append(sp);
        box.append(new Gtk.Label({ label: 'Fetching the forecast…', css_classes: ['ink-light', 'emboss-light'] }));
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
            css_classes: ['ink-light', 'emboss-light'],
            justify: Gtk.Justification.CENTER,
        });
        box.append(this.#coldErrorLabel);
        const retry = new Gtk.Button({ label: 'Try Again', halign: Gtk.Align.CENTER });
        retry.add_css_class('suggested-action');
        retry.connect('clicked', () => this.#bus.emit('request-refresh', this.city.id));
        box.append(retry);
        return box;
    }

    // ---- sky mode on/off -----------------------------------------------------------

    #applySkyMode() {
        const on = this.#skyOn;
        if (on) {
            this.add_css_class('sky-on');
            this.#backdrop.set_visible(true);
            this.#chart.setGroundSampler((x, y) => this.#chartGroundLum(x, y));
        } else {
            this.remove_css_class('sky-on');
            this.#backdrop.set_visible(false);
            for (const w of [this.#heroLeft, this.#heroRight, this.#updRow,
                this.#statFlow, this.#astroBox, this.#daySummary,
                this.#segBox])
                applyInk(w, null, false);
            for (const t of this.#dayTiles) {
                applyInk(t.btn, null, false);
                if (t.glyphState.pale) {
                    t.glyphState.pale = false;
                    t.icon.queue_draw();
                }
            }
            this.#chart.setJudgedInk(null, null);
            this.#chart.setGroundSampler(null);
        }
    }

    // ---- state updates ----------------------------------------------------------------

    setLocale({ h12 }) {
        this.#h12 = !!h12;
        this.#chart.h12 = this.#h12;
        this.#tickClock();
    }

    set dark(v) {
        this.#chart.dark = v;
        this.#scheduleRejudge(0);
    }

    /** The backdrop WEARS the selected day: picking Wednesday's storm puts
     * Wednesday's clouds and drops behind everything (day-of-week scenes
     * are daytime codes, so the sun and its glow stay truthful). Today
     * rides live conditions. */
    #syncSkyScene() {
        if (!this.#data) return;
        if (this.#dayIndex > 0 && this.#data.daily[this.#dayIndex]) {
            const info = sceneFor(this.#data.daily[this.#dayIndex].code, true);
            this.#skyScene = info.scene;
            this.#skyNight = false;
        } else {
            const eff = effectiveScene(this.#data.current);
            this.#skyScene = eff.scene;
            this.#skyNight = eff.night;
        }
    }

    #goLoading() {
        this.#skyScene = 'loading';
        this.#skyNight = false;
        this.#stack.visible_child_name = 'loading';
        this.#invalidateSky();
    }

    apply(data, silent = false) {
        this.#data = data;
        const c = data.current;
        const units = this.#bus.config.units;
        const scene = effectiveScene(c);
        const mp = moonPhase();
        this.#moonPhase = mp.phase;
        this.#glyphState = {
            scene: scene.scene,
            night: scene.night,
            intensity: precipIntensity(c.code),
            phase: mp.phase,
        };
        this.#syncSkyScene();

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
        this.#invalidateSky();
        this.#scheduleRejudge(0);
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
            this.#skyScene = 'error';
            this.#invalidateSky();
        }
    }

    #buildDayTiles() {
        // extension tile anatomy: name · 26px code-pose glyph · hi/lo pair,
        // hierarchy by WEIGHT (lo is never faded away, only lighter)
        this.#tilesFlow.remove_all();
        this.#dayTiles = [];
        const units = this.#bus.config.units;
        this.#data.daily.forEach((day, i) => {
            const info = sceneFor(day.code, true);
            const btn = new Gtk.ToggleButton({ css_classes: ['day-tile'] });
            if (i === this.#dayIndex) btn.set_active(true);
            if (i > 0) btn.set_group(this.#dayTiles[i - 1].btn);

            const col = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 2,
                margin_top: 5, margin_bottom: 4,
            });
            col.append(new Gtk.Label({
                label: i === 0 ? 'Today' : dayName(day.date),
                css_classes: ['day-name'],
            }));
            const glyphState = {
                scene: info.scene,
                night: false,
                intensity: precipIntensity(day.code),
                seed: i * 13 + 5,
                pale: false,
            };
            const icon = makeWeatherIcon(26, () => glyphState, () => false);
            col.append(icon);
            const hl = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 5,
                halign: Gtk.Align.CENTER,
            });
            hl.append(new Gtk.Label({
                label: fmtTemp(day.tmax, units), css_classes: ['day-hi'],
            }));
            hl.append(new Gtk.Label({
                label: fmtTemp(day.tmin, units), css_classes: ['day-lo'],
            }));
            col.append(hl);
            btn.set_child(col);
            btn.connect('toggled', () => {
                if (!btn.active) return;
                this.#dayIndex = i;
                this.#rerender();
            });
            // the ink judge must see the glass the cursor brings
            const motion = new Gtk.EventControllerMotion();
            motion.connect('enter', () => {
                this.#hoverTile = i;
                this.#scheduleRejudge(0);
            });
            motion.connect('leave', () => {
                if (this.#hoverTile === i) this.#hoverTile = -1;
                this.#scheduleRejudge(0);
            });
            btn.add_controller(motion);
            this.#tilesFlow.insert(btn, -1);
            this.#dayTiles.push({ btn, glyphState, icon });
        });
        this.#rerender();
    }

    #rerender() {
        if (!this.#data) return;
        this.#syncSkyScene();
        this.#invalidateSky();
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
        this.#scheduleRejudge(0);
    }

    #tickClock() {
        if (!this.#data) return;
        const wall = cityWallMs(this.#data);
        this.#clockLabel.label = fmtClock(wall, this.#h12);
        this.#dateLabel.label = fmtDayStamp(wall);
        this.#updatedLabel.label = relTime(this.#data.fetchedAtWallMs);
    }

});
