/* menu.js -- forecast dropdown panel */

import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

const N_ = s => s;
import { WeatherIcon } from './animation.js';
import { moonPhase } from './moon.js';
import { paintSky, createSky, sampleSky, bodyOf } from './sky.js';
import { chromeVerdicts, boxSampleFractions, compositeGround } from './ink-policy.js';
import {
    paintChart, ease, lerp, morphPair, contrastSafe, lumOf, pickInk,
    judgeInk, INK_DARK, tileGlyphPale, STRIP_PRECIP_INTENSITY, CODE_PRECIP_INTENSITY
} from './chart.js';
import { sceneFor, variantForCode, fmtTemp, dayName, daySlice, nowFracIn, sunGeometry } from './weather.js';

const SKY_FRAME_INTERVAL_MS = 50;         // sky: 20 fps is plenty
const STATIC_TIME = 1.1;                  // frame that makes static mini icons look lively
const CHART_MORPH_DURATION_MS = 420, CHART_MORPH_TICK_MS = 25;

const METRICS = {
    temp: { label: N_('Temperature'), accent: [0.96, 0.65, 0.14] },
    precip: { label: N_('Precipitation'), accent: [0.30, 0.64, 1.00] },
    wind: { label: N_('Wind'), accent: [0.24, 0.81, 0.56] },
};

/* Theme colors and washes. The animated sky carries its own contrast (the
 * ink judge reads the painted pixels), so it always presents the dark
 * treatment regardless of the system theme (see _paintDark); only the
 * solid style needs a per-theme wash. */
const THEME_CONFIG = {
    dark: {
        ink: [0.96, 0.97, 0.98], cls: 'aw-dark',
        scrimSolid: [0.03, 0.045, 0.08, 0.78]
    },
    light: {
        ink: [0.10, 0.13, 0.19], cls: 'aw-light',
        scrimSolid: [0.97, 0.975, 0.995, 0.80]
    },
};

const ACTOR_FILL = Clutter.ActorAlign.FILL;

const glassOver = (backgroundColor, tintRgb, alpha) =>
    backgroundColor.map((channelVal, idx) =>
        channelVal * (1 - alpha) + tintRgb[idx] * alpha);
const SLAB_DARK = [16 / 255, 20 / 255, 28 / 255];
const SLAB_LIGHT = [1, 1, 1];

const compGlass = (backgroundColor, isDark) =>
    glassOver(backgroundColor, isDark ? SLAB_DARK : SLAB_LIGHT, isDark ? 0.45 : 0.68);

/* .aw-day:hover: 28% dark glass in the dark card, 40% white in the
 * light one -- the ink judge must see the ground the cursor brings */
const hoverGlass = (backgroundColor, isDark) =>
    glassOver(backgroundColor, isDark ? SLAB_DARK : SLAB_LIGHT, isDark ? 0.28 : 0.4);

const inkCss = (inkRgb, alpha = 1) => {
    const toChannel255 = channelVal => Math.round(channelVal * 255);
    return alpha < 1
        ? `color: rgba(${toChannel255(inkRgb[0])}, ${toChannel255(inkRgb[1])}, ${toChannel255(inkRgb[2])}, ${alpha});`
        : `color: rgb(${toChannel255(inkRgb[0])}, ${toChannel255(inkRgb[1])}, ${toChannel255(inkRgb[2])});`;
};

const haloCss = inkJudgeResult => !inkJudgeResult.emboss ? ''
    : inkJudgeResult.ink === INK_DARK
        ? ' text-shadow: 0 0 3px rgba(255,255,255,0.9), 0 0 8px rgba(255,255,255,0.55);'
        : ' text-shadow: 0 0 3px rgba(0,0,12,0.9), 0 0 8px rgba(0,0,12,0.6), 0 1px 2px rgba(0,0,12,0.85);';

function label(text, styleClass) {
    return new St.Label({ text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER });
}

function row(styleClass) {
    return new St.BoxLayout({
        style_class: styleClass, x_expand: true,
        y_align: Clutter.ActorAlign.CENTER
    });
}

function column(styleClass) {
    return new St.BoxLayout({ vertical: true, style_class: styleClass, x_expand: true });
}

function spacer() {
    return new St.Widget({ x_expand: true, x_align: ACTOR_FILL });
}

/** '2026-09-25T15:00' -> '3PM' (or '15') for the chart axis. The next
 *  calendar day gets a one-letter flag (rolling windows run past midnight
 *  after 10 PM); the exact next date only, so stale data never mislabels. */
function hourLabel(isoString, is24Hour, nextDayKey = '') {
    const hour = +isoString.slice(11, 13);
    const dayFlag = nextDayKey && isoString.slice(0, 10) > nextDayKey ? '*' : '';
    if (is24Hour)
        return `${dayFlag}${hour}`;
    return `${dayFlag}${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? 'AM' : 'PM'}`;
}

const SkyArea = GObject.registerClass(
    class SkyArea extends St.DrawingArea {
        _init(panel, animate) {
            super._init({ x_align: ACTOR_FILL, y_align: ACTOR_FILL, x_expand: true, y_expand: true });
            this._panel = panel;
            this._animate = animate;
            this._time = animate ? Math.random() * 3 : STATIC_TIME;
            this._animTimerId = 0;
            this.connect('notify::mapped', () => {
                if (this.mapped)
                    this._start();
                else
                    this._stop();
            });
        }

        // EGO-L-004, and a battery win: the animation source is born
        // when Clutter maps the actor (menu actually open) and dies on
        // unmap -- enable()'s construction wires no source at all.
        // belt-and-braces: an actor destroyed while still mapped must
        // not outlive its source. The removal is inlined because the
        // review engine reads disposal literally -- a helper call is
        // invisible to it (proven when _stop() in destroy() stayed a
        // finding while the panel's inline removes passed).
        destroy() {
            if (this._animTimerId) {
                GLib.source_remove(this._animTimerId);
                this._animTimerId = 0;
            }
            super.destroy();
        }

        vfunc_repaint() {
            const [surfaceWidth, surfaceHeight] = this.get_surface_size();
            if (surfaceWidth <= 0 || surfaceHeight <= 0)
                return;
            const cr = this.get_context();
            const skyOptions = this._panel._skyOpts;
            if (this._panel._style !== 'accent') {
                const { glow, solar } = this._panel._sunShade();
                paintSky(cr, {
                    w: surfaceWidth, h: surfaceHeight, time: this._time,
                    scene: skyOptions.scene, night: skyOptions.night, scrim: skyOptions.scrim,
                    sky: skyOptions.sky, radius: skyOptions.radius ?? 0, phase: skyOptions.phase ?? null,
                    glow, solar
                });
            }
            // 'accent' style paints NOTHING: the surface stays transparent and
            // the shell theme's own popup background becomes the menu surface --
            // the theme's specified solid colour, any theme, auto-contrast.
            cr.$dispose();
        }

        _start() {
            if (this._animTimerId || !this._animate || !this.mapped ||
                this._panel._style === 'accent')
                return;
            this._lastTime = GLib.get_monotonic_time();
            this._animTimerId = GLib.timeout_add(GLib.PRIORITY_LOW, SKY_FRAME_INTERVAL_MS, () => {
                const now = GLib.get_monotonic_time();
                if (this.mapped ?? true) {
                    this._time += Math.min((now - this._lastTime) / 1000000, 0.1);
                    this.queue_repaint();
                }
                this._lastTime = now;
                return GLib.SOURCE_CONTINUE;
            });
        }

        _stop() {
            if (this._animTimerId) {
                GLib.source_remove(this._animTimerId);
                this._animTimerId = 0;
            }
        }
    });

const ChartArea = GObject.registerClass(
    class ChartArea extends St.DrawingArea {
        _init(panel) {
            super._init({ x_align: ACTOR_FILL, y_expand: true, x_expand: true, height: 150 });
            this._panel = panel;
        }

        vfunc_repaint() {
            const [surfaceWidth, surfaceHeight] = this.get_surface_size();
            if (surfaceWidth <= 0 || surfaceHeight <= 0)
                return;
            const panel = this._panel, metricConfig = METRICS[panel._metric];
            // 'accent' style unifies the data in the OS accent colour; sky
            // modes keep the per-metric palette
            const accent = panel._style === 'accent' ? panel._accent : metricConfig.accent;
            // full card width: .aw-content has no horizontal padding (rows pad
            // themselves), so the fill bleeds to the card edges; the narrow
            // chart labels every 3rd hour, ink-dim, 8pt
            const cr = this.get_context();
            const strip = panel._conditions !== 'off' ? panel._strip : null;
            paintChart(cr, {
                w: surfaceWidth, h: surfaceHeight,
                values: panel._shown,
                fmtValue: panel._fmtValue ?? (() => ''),
                fmtValueUnit: panel._fmtValueUnit ?? null,
                fmtHour: panel._fmtHour ?? (() => ''),
                valueSamples: panel._valueSamples.length ? panel._valueSamples : null,
                accent,
                ink: panel._theme().ink,
                nowFrac: panel._day === 0 ? (panel._nowFrac ?? 0) : null,
                scenes: strip ? strip.scenes : null,
                nights: strip ? strip.nights : null,
                iconIntensities: strip ? strip.intensities : null,
                iconVariants: strip ? strip.variants : null,
                pills: panel._conditions === 'pills',
                dark: panel._paintDark(),
                // Arabic/Hebrew sessions: the chart mirrors (earliest hour at
                // the right, now-fade covering the RIGHT half). St widgets
                // around this canvas already flip via the toolkit; the painted
                // surface has to be told explicitly.
                rtl: Clutter.get_default_text_direction() === Clutter.TextDirection.RTL,
                stripBottom: panel._condPos === 'bottom',
                // over the sky (animated/solid): pills take the day-tile hover
                // glass; the accent style keeps the accent tint on its calm
                // backdrop
                pillGlass: panel._style !== 'accent',
                // the "now" value label rides the sky, not the ink theme: hand
                // it a contrast-safe variant of the accent (no-op when the
                // accent already clears ~3:1 against the composited backdrop)
                nowLabel: contrastSafe(accent, panel._bgUnderChart()),
                // smart text ink: labels sample the composited sky at their OWN
                // y -- hour text over a bright day-sky foot goes dark, night text
                // stays white. accent style's flat card needs none of this.
                bgFn: panel._style === 'accent' ? null : (yPx, xPx) => {
                    const [chartX, top] = this.get_transformed_position();
                    const [cardX, cardY] = panel._content.get_transformed_position();
                    const [cardW, cardH] = panel._content.get_size();
                    const fy = Math.min(1, Math.max(0, (top + yPx - cardY) / (cardH || 1)));
                    if (xPx === undefined)
                        return panel._bgAt(fy);
                    const fx = Math.min(1, Math.max(0, (chartX + xPx - cardX) / (cardW || 1)));
                    return panel._bgAt(fy, { f: fy, x: fx });
                },
                fontSize: surfaceWidth < 480 ? 8 : 8.5,
                // 'Data text' emphasis: values + hours bigger and/or heavier
                textScale: panel._textScale,
                textBold: panel._textBold,
            });
            cr.$dispose();
            // the card's free-standing labels (header, tabs) sample the same way
            // -- run here so it happens whenever the menu is actually visible
            panel._applyTextInk();
        }
    });

export const RangeBar = GObject.registerClass(
class RangeBar extends St.Widget {
    _init(params) {
        super._init({
            style_class: 'meteo-range-bar',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            height: 6,
        });
        this._min = params.min ?? 0;
        this._max = params.max ?? 0;
        this._gMin = params.gMin ?? 0;
        this._gMax = params.gMax ?? 0;
        this._current = params.current ?? null;

        this._fill = new St.Widget({ style_class: 'meteo-range-fill' });
        this.add_child(this._fill);

        if (this._current !== null && this._current !== undefined) {
            this._dot = new St.Widget({ style_class: 'meteo-range-dot' });
            this.add_child(this._dot);
        } else {
            this._dot = null;
        }
    }

    vfunc_get_preferred_width(_forHeight) {
        return [60, 100];
    }

    vfunc_get_preferred_height(_forWidth) {
        return [6, 6];
    }

    vfunc_allocate(box) {
        this.set_allocation(box);
        const w = box.get_width();
        const h = box.get_height();
        if (w <= 0 || h <= 0)
            return;

        const total = (this._gMax - this._gMin) || 1;

        if (this._fill) {
            const x1 = Math.max(0, Math.min(w - 6, Math.round(((this._min - this._gMin) / total) * w)));
            const x2 = Math.min(w, Math.max(x1 + 6, Math.round(((this._max - this._gMin) / total) * w)));
            const fillBox = new Clutter.ActorBox();
            fillBox.x1 = x1;
            fillBox.x2 = x2;
            fillBox.y1 = 0;
            fillBox.y2 = h;
            this._fill.allocate(fillBox);
        }

        if (this._dot) {
            const dotSize = 8;
            const dotX = Math.max(0, Math.min(w - dotSize, Math.round(((this._current - this._gMin) / total) * w - dotSize / 2)));
            const dotBox = new Clutter.ActorBox();
            dotBox.x1 = dotX;
            dotBox.x2 = dotX + dotSize;
            dotBox.y1 = Math.round((h - dotSize) / 2);
            dotBox.y2 = dotBox.y1 + dotSize;
            this._dot.allocate(dotBox);
        }
    }
});

export const FillBar = GObject.registerClass(
class FillBar extends St.Widget {
    _init(fraction, colorCss = '#4ca3ff') {
        super._init({
            style_class: 'meteo-fill-bar',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            height: 6,
        });
        this._fraction = Math.min(1, Math.max(0, fraction));
        this._fill = new St.Widget({
            style_class: 'meteo-fill-progress',
            style: `background-color: ${colorCss};`,
        });
        this.add_child(this._fill);
    }

    vfunc_get_preferred_width(_forHeight) {
        return [60, 100];
    }

    vfunc_get_preferred_height(_forWidth) {
        return [6, 6];
    }

    vfunc_allocate(box) {
        this.set_allocation(box);
        const w = box.get_width();
        const h = box.get_height();
        if (w <= 0 || h <= 0)
            return;

        const fillW = Math.max(0, Math.min(w, Math.round(w * this._fraction)));
        const fillBox = new Clutter.ActorBox();
        fillBox.x1 = 0;
        fillBox.x2 = fillW;
        fillBox.y1 = 0;
        fillBox.y2 = h;
        this._fill.allocate(fillBox);
    }
});

export class ForecastPanel {
    constructor({ animate }) {
        this._animate = animate;
        this._onRefresh = this._onSettings = this._onSky = null;

        this._day = 0;
        this._metric = 'temp';
        this._dark = true;
        this._shellDark = null;     // shell surface variant; null follows _dark
        this._state = null;
        this._shown = [];          // currently displayed chart values (morphs)
        this._morphId = 0;
        this._cityClockTimerId = 0;
        this._cityEpochMs = 0;          // wall time in the city's timezone
        this._cityBaseTime = 0;
        this._desc = '';
        this._fmtValue = null;
        this._fmtValueUnit = null;
        this._fmtHour = null;
        this._valueSamples = [];           // width-stable label samples
        this._shadeCache = { minute: -1, glow: 0, solar: null };
        this._dayButtons = [];             // day-tile rows, rebuilt by
        this._dayLowLabels = [];           // _buildDayTiles in lockstep
        this._dayHiLabels = [];
        this._tileIcons = [];
        this._ghostIcons = [];
        this._tabButtons = {};
        this._is24Hour = false;          // chart hours + city clock (setter drives)
        this._textScale = 1;           // 'data-text' emphasis (setter drives)
        this._textBold = false;

        this._sky = createSky();
        // radius 18 matches the shell's polished-popup corner radius
        this._skyOpts = {
            scene: 'loading', night: false, scrim: null,
            sky: this._sky, radius: 18
        };
        this._nowFrac = null;
        this._style = 'animated';                 // animated | solid | accent
        this._conditions = 'icons';               // chart strip: off | icons | pills
        this._condPos = 'top';                    // strip band: top | bottom
        this._strip = null;                       // {scenes[], nights[]} for the chart
        this._accent = [0.21, 0.52, 0.89];        // GNOME blue fallback
        this._emboss = true;                      // CSS text/icon shadows

        // St.Widget with BinLayout = overlay: sky fills, content rides on top
        this.actor = new St.Widget({ layout_manager: new Clutter.BinLayout() });
        this._skyArea = new SkyArea(this, animate);
        this.actor.add_child(this._skyArea);

        this._content = new St.BoxLayout({
            vertical: true,
            style_class: 'aw-content',
            x_align: ACTOR_FILL, y_align: ACTOR_FILL,
        });
        this.actor.add_child(this._content);

        this._content.add_child(this._buildPlaceholder());
        this._content.add_child(this._buildMain());
        this._showBody(false);
    }

    _buildPlaceholder() {
        this._placeholderBox = new St.BoxLayout({
            style_class: 'aw-placeholder',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true, y_expand: true,
        });
        this._placeholderIcon = new WeatherIcon({ size: 34, animate: this._animate });
        this._placeholderIcon.setScene('loading');
        this._placeholderText = label(_('Fetching weather…'), 'aw-placeholder-text');
        this._placeholderBox.add_child(this._placeholderIcon);
        this._placeholderBox.add_child(this._placeholderText);
        return this._placeholderBox;
    }

    _buildMain() {
        const main = column('aw-main');
        this._main = main;

        const header = column('meteo-header');

        // 1. Top action bar with Refresh on Left and Settings on Right
        const topBar = row('meteo-top-bar');
        this._refreshButton = this._iconButton('view-refresh-symbolic', _('Refresh now'),
            () => {
                if (this._onRefresh)
                    this._onRefresh();
            });
        this._refreshButton.track_hover = true;
        this._refreshButton.connect('notify::hover', () => {
            if (this._refreshButton.hover && this._lastUpdatedTime) {
                this._summaryLabel.set_text(`${_('Updated')}: ${this._lastUpdatedTime}`);
            } else {
                this._syncSummary();
            }
        });
        topBar.add_child(this._refreshButton);

        topBar.add_child(spacer());

        this._settingsButton = this._iconButton('emblem-system-symbolic', _('Preferences'),
            () => {
                if (this._onSettings)
                    this._onSettings();
            }, 18);
        topBar.add_child(this._settingsButton);
        header.add_child(topBar);

        // 2. Centered hero info
        this._cityLabel = label(_('Weather'), 'meteo-city');
        this._cityLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._cityLabel.x_align = Clutter.ActorAlign.CENTER;
        header.add_child(this._cityLabel);

        this._temperatureLabel = label('', 'meteo-temp');
        this._temperatureLabel.x_align = Clutter.ActorAlign.CENTER;
        header.add_child(this._temperatureLabel);

        this._descriptionLabel = label('', 'meteo-desc');
        this._descriptionLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._descriptionLabel.x_align = Clutter.ActorAlign.CENTER;
        header.add_child(this._descriptionLabel);

        this._hiLoLabel = label('', 'meteo-hilo');
        this._hiLoLabel.x_align = Clutter.ActorAlign.CENTER;
        header.add_child(this._hiLoLabel);

        this._summaryLabel = label('', 'meteo-summary');
        this._summaryLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._summaryLabel.x_align = Clutter.ActorAlign.CENTER;
        header.add_child(this._summaryLabel);

        // Hidden clock helper for ink / theme compatibility
        this._clockRow = row('aw-hidden-clock');
        this._clockRow.hide();
        this._clockLabel = label('', 'aw-clockline');
        this._clockRow.add_child(this._clockLabel);
        header.add_child(this._clockRow);

        main.add_child(header);

        // Cards container (Apple Weather cards)
        const cardsBox = column('meteo-scroll-box');

        // 1. Hourly Forecast Card
        const hourlyCard = column('meteo-card meteo-hourly-card');
        const hourlyHeader = row('meteo-card-header');
        hourlyHeader.add_child(label(_('HOURLY FORECAST'), 'meteo-card-title'));
        hourlyHeader.add_child(spacer());

        const metricRow = row('meteo-metric-toggle-row');
        this._metricButtons = {};
        const METRIC_ICONS = {
            temp: 'weather-temperature-symbolic',
            precip: 'weather-showers-symbolic',
            wind: 'weather-windy-symbolic',
        };
        for (const [key, iconName] of Object.entries(METRIC_ICONS)) {
            const icon = new St.Icon({
                icon_name: iconName,
                icon_size: 14,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const btn = new St.Button({
                style_class: 'meteo-metric-btn',
                can_focus: true,
                child: icon,
            });
            if (key === this._metric)
                btn.add_style_class_name('meteo-metric-btn-active');
            btn.connect('clicked', () => this._selectMetric(key));
            metricRow.add_child(btn);
            this._metricButtons[key] = btn;
        }
        hourlyHeader.add_child(metricRow);
        hourlyCard.add_child(hourlyHeader);

        this._hourlyColumnsBox = row('meteo-hourly-columns');
        hourlyCard.add_child(this._hourlyColumnsBox);
        cardsBox.add_child(hourlyCard);

        // 2. 8-Day Forecast Card
        const dailyCard = column('meteo-card meteo-daily-card');
        const dailyHeader = row('meteo-card-header');
        dailyHeader.add_child(label(_('8-DAY FORECAST'), 'meteo-card-title'));
        dailyCard.add_child(dailyHeader);

        this._dailyRowsBox = column('meteo-daily-rows');
        dailyCard.add_child(this._dailyRowsBox);
        cardsBox.add_child(dailyCard);

        // 3. Details 2x3 Grid
        this._detailsBox = column('meteo-details-container');
        cardsBox.add_child(this._detailsBox);

        main.add_child(cardsBox);

        // Retain compatibility objects for legacy listeners
        this._chart = { queue_repaint() {}, destroy() {} };
        this._daysGrid = column('aw-days-grid');
        this._dayButtons = [];
        this._tabButtons = {};

        return main;
    }

    _iconButton(iconName, name, callback, size = 16) {
        const icon = new St.Icon({
            icon_name: iconName, icon_size: size,
            y_align: Clutter.ActorAlign.CENTER
        });
        const btn = new St.Button({
            style_class: 'aw-icon-btn',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: icon,
        });
        this._ghostIcons.push(icon);   // _applyTextInk samples these
        btn.set_accessible_name(name);   // no tooltips in GNOME 50; name for AT
        btn.connect('clicked', () => callback());
        return btn;
    }

    onRefresh(callback) { this._onRefresh = callback; }
    onSettings(callback) { this._onSettings = callback; }
    /** reports the sky the menu just started painting: (scene, night) */
    onSky(callback) { this._onSky = callback; }

    setPlaceName(name) {
        this._cityLabel.set_text(name || _('Weather'));
    }

    setError(message) {
        this._cityLabel.set_text(_('Weather'));
        this.showPlaceholder(message || _('Could not load the forecast'));
    }

    showPlaceholder(text) {
        this._placeholderText.set_text(text);
        this._showBody(false);
    }

    setDark(enabled) {
        this._dark = enabled;
        this._applyTheme();
    }

    /** Whether the SHELL's own popup surface is dark. Only the accent
     * style borrows that surface, so only it re-judges on a flip. */
    setShellDark(enabled) {
        if (this._shellDark === enabled)
            return;
        this._shellDark = enabled;
        if (this._style === 'accent')
            this._applyTheme();
    }

    /** Menu background treatment: 'animated' | 'solid' | 'accent'. */
    setStyle(style) {
        this._style = style;
        // 'accent' (theme-background) style hands interaction/selection
        // painting to stylesheet.css (the .aw-theme gate): no sky there
        // means no painted glass pills, so the CSS accent washes must
        if (style === 'accent')
            this._content.add_style_class_name('aw-theme');
        else
            this._content.remove_style_class_name('aw-theme');
        // crossing into/out of animated swaps the whole presentation theme
        this._applyTheme();
        if (style === 'accent')
            this._skyArea._stop();     // no sky to tick: park the clock
        else
            this._skyArea._start();
        this._skyArea.queue_repaint();
        this._chart.queue_repaint();   // pill tint follows the style
        this._chart.queue_repaint();   // chart accent follows the style
        this._applyTileInk();          // accent style hands the tiles back
    }                                       // to plain theme ink

    /** [r, g, b] in 0..1 -- OS accent colour: charts in the 'accent' style. */
    setAccent(rgb) {
        this._accent = rgb;
        this._skyArea.queue_repaint();
        this._chart.queue_repaint();
    }

    /** chart condition strip: 'off' | 'icons' | 'pills' */
    setConditions(mode) {
        this._conditions = ['off', 'icons', 'pills'].includes(mode) ? mode : 'icons';
        this._chart.queue_repaint();
    }

    /** where the strip rides: 'top' of chart | 'bottom' above the hours */
    setCondPos(pos) {
        this._condPos = pos === 'bottom' ? 'bottom' : 'top';
        this._chart.queue_repaint();
    }

    /** 12-hour AM/PM or 24-hour labels on the chart axis + city clock */
    setHourFormat(is24Hour) {
        if (this._is24Hour === !!is24Hour)
            return;
        this._is24Hour = !!is24Hour;
        this._chart.queue_repaint();
        this._tickClock();
    }

    /** 'Data text' emphasis: normal | bold | large | both -- the metric
     *  values, hour labels and the now label on the chart all at once */
    setTextEmph(mode) {
        const scale = mode === 'large' || mode === 'both' ? 1.18 : 1;
        const bold = mode === 'bold' || mode === 'both';
        if (this._textScale === scale && this._textBold === bold)
            return;
        this._textScale = scale;
        this._textBold = bold;
        this._chart.queue_repaint();
    }

    /** flat ink: drops the CSS emboss shadows (text + ghost buttons) */
    setEmboss(enabled) {
        this._emboss = enabled !== false;
        if (this._emboss)
            this._content.remove_style_class_name('aw-flat');
        else
            this._content.add_style_class_name('aw-flat');
    }

    /** Live sun shading for the current instant: altitude from the almanac
     *  (minute-accurate, every provider) -> glow peaks at the horizon
     *  crossing, solar is the 0..1 climb from sunrise through noon.
     *  Computed at PAINT time, not at fetch time: a menu opened a half-hour
     *  after the last refresh must still show where the sun actually is.
     *  Cached per minute -- the almanac's trig is cheap but per-frame
     *  re-solving is pointless when the sun moves 0.25 degrees a minute. */
    _sunShade() {
        if (this._day !== 0 || !this._sunCoords)
            return { glow: 0, solar: null };
        const minute = Math.floor(Date.now() / 60000);
        if (this._shadeCache.minute !== minute) {
            const [lat, lon] = this._sunCoords;
            const sun = sunGeometry(lat, lon, minute * 60000);
            let glow = 0;
            let solar = null;
            if (sun.altitude > -12 && sun.altitude < 12) {
                const near = 1 - Math.abs(sun.altitude) / 12;   // ±12 deg: nautical-ish band,
                glow = near * near * (3 - 2 * near);            // golden hues ~1 h each side
            }
            if (sun.sunrise !== null && sun.altitude > 0) {
                const f = (minute * 60000 - sun.sunrise) / (sun.sunset - sun.sunrise);
                solar = Math.sin(Math.PI * Math.min(1, Math.max(0, f)));
            }
            this._shadeCache = { minute, glow, solar };
        }
        return { glow: this._shadeCache.glow, solar: this._shadeCache.solar };
    }

    _bgAt(heightFraction, samplePoint) {
        if (this._style === 'accent')
            return this._paintDark() ? [0.185, 0.185, 0.19] : [0.96, 0.96, 0.97];
        const { glow, solar } = this._sunShade();
        const skyRgb = sampleSky(this._skyOpts.scene, this._skyOpts.night, heightFraction,
            glow, solar);
        let celestialBody = null;
        let distance = 0;
        if (samplePoint) {
            const [cardWidth, cardHeight] = this._content.get_size();
            celestialBody = bodyOf(this._skyOpts.scene, this._skyOpts.night,
                cardWidth || 330, cardHeight || 430, glow, solar);
            if (celestialBody)
                distance = Math.hypot(samplePoint.x * (cardWidth || 330) - celestialBody.x,
                    samplePoint.f * (cardHeight || 430) - celestialBody.y);
        }
        // disc over sky, scrim over both -- the paint order (ink-policy)
        return compositeGround(skyRgb, this._skyOpts.scrim, celestialBody, distance);
    }

    _bgUnderChart() {
        return this._bgAt(0.62);
    }

    /** state = {current, daily, hourly, currentIso, units, windy, effective,
     *           windKmh, updated, dark, shellDark, latitude, longitude} */
    render(state) {
        console.log(`[METEO-DEBUG] ForecastPanel.render() called! city=${this._cityLabel?.text}, temp=${state.current?.temp}`);
        this._state = state;
        if (state.dark !== undefined)
            this._dark = state.dark;
        if (state.shellDark !== undefined)
            this._shellDark = state.shellDark;
        this._applyTheme();
        this._showBody(true);

        const { current, daily } = state;
        const { desc } = state.effective ?? sceneFor(current.code, current.isDay);
        // the big temp + condition line are (re)written by _syncHeader at the
        // end of render, so a selected future day survives refreshes
        this._desc = _(desc);

        // city clock ticks from the API timestamp (city timezone, not ours)
        this._cityEpochMs = state.currentIso ? Date.parse(state.currentIso) : 0;
        this._cityBaseTime = GLib.get_monotonic_time();
        this._tickClock();
        if (!this._cityClockTimerId) {
            this._cityClockTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 20, () => {
                this._tickClock();
                return GLib.SOURCE_CONTINUE;
            });
        }

        // no visible "updated" row -- keep it as the refresh button's
        // accessible name instead of visible clutter
        if (state.updated) {
            this._lastUpdatedTime = state.updated.format('%H:%M');
            this._refreshButton.set_accessible_name(
                `${_('Refresh forecast — updated')} ${this._lastUpdatedTime}`);
        }

        this._buildDayTiles();
        if (this._day >= daily.length)
            this._day = 0;
        this._applySelection();
        this._markTiles();
        this._renderHourlyColumns();
        this._renderDailyRows();
        this._renderDetailsGrid();
    }

    destroy() {
        if (this._morphId) {
            GLib.source_remove(this._morphId);
            this._morphId = 0;
        }
        if (this._cityClockTimerId) {
            GLib.source_remove(this._cityClockTimerId);
            this._cityClockTimerId = 0;
        }
        this._skyArea.destroy();
        this.actor.destroy();
    }

    _selectDay(dayIndex) {
        if (dayIndex === this._day)
            return;
        this._day = dayIndex;
        this._markTiles();
        this._applySelection();
    }

    _selectMetric(key) {
        if (!METRICS[key])
            return;
        this._metric = key;
        for (const [k, btn] of Object.entries(this._tabButtons || {})) {
            if (k === key)
                btn.add_style_class_name('aw-tab-active');
            else
                btn.remove_style_class_name('aw-tab-active');
        }
        for (const [k, btn] of Object.entries(this._metricButtons || {})) {
            if (k === key)
                btn.add_style_class_name('meteo-metric-btn-active');
            else
                btn.remove_style_class_name('meteo-metric-btn-active');
        }
        this._applySelection();
        this._renderHourlyColumns();
        this._renderDailyRows();
    }

    _renderHourlyColumns() {
        if (!this._hourlyColumnsBox)
            return;
        this._hourlyColumnsBox.destroy_all_children();
        const state = this._state;
        if (!state || !state.hourly || !state.hourly.time || state.hourly.time.length === 0)
            return;

        const indices = daySlice(state.hourly, state.daily, 0, state.currentIso);
        if (!indices || indices.length === 0)
            return;

        const count = Math.min(6, indices.length);
        for (let i = 0; i < count; i++) {
            const idx = indices[i];
            const col = new St.BoxLayout({
                vertical: true,
                style_class: 'meteo-hourly-col',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            // 1. Time label
            let timeText = '';
            if (i === 0) {
                timeText = _('Now');
            } else {
                const iso = state.hourly.time[idx] || '';
                timeText = hourLabel(iso, this._is24Hour);
            }
            const timeLbl = label(timeText, 'meteo-hourly-time');
            col.add_child(timeLbl);

            // 2. Weather Icon
            const code = state.hourly.code ? state.hourly.code[idx] : 0;
            const isDay = state.hourly.isDay ? !!state.hourly.isDay[idx] : true;
            const icon = new WeatherIcon({ size: 22, animate: this._animate });
            icon.setScene(sceneFor(code, isDay).scene);
            col.add_child(icon);

            // 3. Metric Value
            let valText = '';
            if (this._metric === 'temp') {
                const t = state.hourly.temp ? state.hourly.temp[idx] : 0;
                valText = fmtTemp(t, state.units);
            } else if (this._metric === 'precip') {
                const p = state.hourly.precipProb ? state.hourly.precipProb[idx] : 0;
                valText = `${Math.round(p)}%`;
            } else if (this._metric === 'wind') {
                const wKmh = state.hourly.wind ? state.hourly.wind[idx] : 0;
                valText = `${Math.round(wKmh / 3.6)} ${_('m/s')}`;
            }
            const valLbl = label(valText, 'meteo-hourly-val');
            col.add_child(valLbl);

            this._hourlyColumnsBox.add_child(col);
        }
    }

    _renderDailyRows() {
        if (!this._dailyRowsBox)
            return;
        this._dailyRowsBox.destroy_all_children();
        const state = this._state;
        if (!state || !state.daily || state.daily.length === 0)
            return;

        let gMin = 999, gMax = -999;
        let maxWind = 1;
        for (const day of state.daily) {
            if (day.tmin < gMin) gMin = day.tmin;
            if (day.tmax > gMax) gMax = day.tmax;
            if (day.windMax > maxWind) maxWind = day.windMax;
        }

        const count = Math.min(8, state.daily.length);
        for (let i = 0; i < count; i++) {
            const day = state.daily[i];
            const rowItem = row('meteo-daily-row');

            // 1. Day Name
            const dayText = i === 0 ? _('Today') : _(dayName(day.date));
            const dayLbl = label(dayText, 'meteo-daily-day');
            dayLbl.width = 54;
            rowItem.add_child(dayLbl);

            // 2. Weather Icon
            const icon = new WeatherIcon({ size: 20, animate: false, time: STATIC_TIME });
            icon.setScene(sceneFor(day.code, true).scene);
            const iconBox = new St.BoxLayout({ width: 30, x_align: Clutter.ActorAlign.CENTER });
            iconBox.add_child(icon);
            rowItem.add_child(iconBox);

            // 3. Metric specifics
            if (this._metric === 'temp') {
                const lowLbl = label(fmtTemp(day.tmin, state.units), 'meteo-daily-temp-low');
                lowLbl.width = 28;
                rowItem.add_child(lowLbl);

                const currentTemp = (i === 0 && state.current) ? state.current.temp : null;
                const bar = new RangeBar({
                    min: day.tmin,
                    max: day.tmax,
                    gMin,
                    gMax,
                    current: currentTemp,
                });
                rowItem.add_child(bar);

                const hiLbl = label(fmtTemp(day.tmax, state.units), 'meteo-daily-temp-hi');
                hiLbl.width = 28;
                rowItem.add_child(hiLbl);
            } else if (this._metric === 'precip') {
                const pProb = Math.round(day.precipProb ?? 0);
                const bar = new FillBar(pProb / 100, '#4ca3ff');
                rowItem.add_child(bar);

                const probLbl = label(`${pProb}%`, 'meteo-daily-metric-val');
                probLbl.width = 38;
                rowItem.add_child(probLbl);
            } else if (this._metric === 'wind') {
                const wMs = Math.round((day.windMax ?? 0) / 3.6);
                const bar = new FillBar(wMs / Math.max(1, maxWind / 3.6), '#3dcf8e');
                rowItem.add_child(bar);

                const windLbl = label(`${wMs} ${_('m/s')}`, 'meteo-daily-metric-val');
                windLbl.width = 46;
                rowItem.add_child(windLbl);
            }

            this._dailyRowsBox.add_child(rowItem);
        }
    }

    _renderDetailsGrid() {
        if (!this._detailsBox)
            return;
        this._detailsBox.destroy_all_children();
        const state = this._state;
        if (!state || !state.current)
            return;

        const makeCard = (iconText, titleText, mainVal, subText) => {
            const card = column('meteo-card meteo-detail-card');
            const top = row('meteo-detail-top');
            top.add_child(label(iconText, 'meteo-detail-icon'));
            top.add_child(label(titleText, 'meteo-detail-title'));
            card.add_child(top);

            const valLbl = label(mainVal, 'meteo-detail-val');
            card.add_child(valLbl);

            if (subText) {
                const subLbl = label(subText, 'meteo-detail-sub');
                card.add_child(subLbl);
            }
            return card;
        };

        // Row 1: Sunrise/Sunset + Moon
        const row1 = row('meteo-detail-row');
        let sunMain = '—', sunSub = '';
        if (state.daily && state.daily[0] && state.daily[0].sunrise) {
            const sr = state.daily[0].sunrise.slice(11, 16);
            const ss = state.daily[0].sunset.slice(11, 16);
            sunMain = `${_('Sunset')}: ${ss}`;
            sunSub = `${_('Sunrise')}: ${sr}`;
        }
        row1.add_child(makeCard('🌅', _('SUN'), sunMain, sunSub));

        const moon = moonPhase(new Date());
        const moonPct = Math.round((moon.illum ?? 0) * 100);
        row1.add_child(makeCard('🌖', _('MOON'), `${_(moon.name)}`, `${_('Illumination')}: ${moonPct}%`));
        this._detailsBox.add_child(row1);

        // Row 2: Feels like + Visibility
        const row2 = row('meteo-detail-row');
        const feelsVal = fmtTemp(state.current.feels ?? state.current.temp, state.units);
        row2.add_child(makeCard('🌡️', _('FEELS LIKE'), feelsVal, `${_('Humidity')}: ${Math.round(state.current.humidity ?? 0)}%`));

        const visKm = state.current.visibility !== null ? Math.round(state.current.visibility / 1000) : 10;
        const visSub = visKm >= 10 ? _('Clear view') : _('Haze');
        row2.add_child(makeCard('👁️', _('VISIBILITY'), `${visKm} ${_('km')}`, visSub));
        this._detailsBox.add_child(row2);

        // Row 3: Humidity + Pressure
        const row3 = row('meteo-detail-row');
        const humVal = `${Math.round(state.current.humidity ?? 0)}%`;
        const dewPoint = fmtTemp((state.current.temp ?? 0) - ((100 - (state.current.humidity ?? 0)) / 5), state.units);
        row3.add_child(makeCard('💧', _('HUMIDITY'), humVal, `${_('Dew point')}: ${dewPoint}`));

        const pMmhg = state.current.pressure ? Math.round(state.current.pressure * 0.750062) : 752;
        const pSub = pMmhg > 760 ? _('High pressure') : (pMmhg < 745 ? _('Low pressure') : _('Normal'));
        row3.add_child(makeCard('🧭', _('PRESSURE'), `${pMmhg} ${_('mm')}`, pSub));
        this._detailsBox.add_child(row3);
    }

    /** Recompute chart series + sky for the current day/metric. */
    _applySelection() {
        const state = this._state;
        if (!state)
            return;
        this._syncHeader();
        this._updateSky();
    }

    /** Big temp + condition text follow the selected day tile: Today shows
     *  the live observation ("Now: Sunny"), a future day shows that day's
     *  high and its general condition phrase ("Sun: Cloudy"). */
    _syncHeader() {
        const state = this._state;
        if (!state)
            return;
        if (this._day === 0) {
            this._temperatureLabel.set_text(fmtTemp(state.current.temp, state.units));
            this._descriptionLabel.set_text(this._desc);
            if (state.daily && state.daily.length > 0) {
                const today = state.daily[0];
                this._hiLoLabel.set_text(
                    `${_('H')}: ${fmtTemp(today.tmax, state.units)}   ·   ${_('L')}: ${fmtTemp(today.tmin, state.units)}`
                );
            }
        } else {
            const dayData = state.daily[Math.min(this._day, state.daily.length - 1)];
            this._temperatureLabel.set_text(fmtTemp(dayData.tmax, state.units));
            this._descriptionLabel.set_text(
                `${_(dayName(dayData.date))}: ${_(sceneFor(dayData.code, true).desc)}`);
            this._hiLoLabel.set_text(
                `${_('H')}: ${fmtTemp(dayData.tmax, state.units)}   ·   ${_('L')}: ${fmtTemp(dayData.tmin, state.units)}`
            );
        }
        this._syncSummary();
    }

    _syncSummary() {
        if (this._state?.effective?.summary) {
            this._summaryLabel.set_text(this._state.effective.summary);
            this._summaryLabel.show();
        } else {
            this._summaryLabel.set_text('');
            this._summaryLabel.hide();
        }
    }

    _chartValues() {
        const state = this._state;
        const field = { temp: 'temp', precip: 'precipProb', wind: 'wind' }[this._metric];
        const hourlyIndices = state.hourly
            ? daySlice(state.hourly, state.daily, this._day, state.currentIso)
            : [];
        const units = state.units;
        this._fmtValue = this._metric === 'temp'
            ? (i, v) => fmtTemp(v, units)
            : this._metric === 'precip'
                ? (i, v) => `${Math.round(v)}%`
                : (i, v) => `${Math.round(units === 'imperial' ? v * 0.621371 : v)}`;
        // wind stacks its unit under the digit (see chart.js two-line
        // values); temp/precip keep inline units -- '°'/'%' barely widen
        // a label and would only add vertical noise stacked
        this._fmtValueUnit = this._metric === 'wind'
            ? () => (units === 'imperial' ? 'mph' : 'km/h')
            : null;
        // day-stable label stride: every day's window spans all 24 hours,
        // so only the VALUE widths drift between days (a calm day of
        // single-digit mph vs a gusty double-digit one). Handing the chart
        // the whole forecast's formatted values keeps one rhythm per
        // metric -- the columns stop re-flowing as the user tabs days.
        const metricSeries = state.hourly ? state.hourly[field] : null;
        this._valueSamples = metricSeries
            ? [...new Set(metricSeries.filter(Number.isFinite)
                .map(v => this._fmtValue(0, v)))]
            : [];
        const times = state.hourly ? hourlyIndices.map(i => state.hourly.time[i]) : [];
        // rolling windows run past midnight after 10 PM: flag tomorrow's
        // labels with '*' so '5' can never be misread as 5 this morning
        const nextDayKey = times.length &&
            times[0].slice(0, 10) !== times[times.length - 1].slice(0, 10)
            ? times[times.length - 1].slice(0, 10) : '';
        this._fmtHour = i => hourLabel(times[i] ?? 'T00', this._is24Hour, nextDayKey);
        this._strip = null;
        if (state.hourly && hourlyIndices.length) {
            // isDay arrives with every real provider but may be absent
            // outright (fixtures, bare series): the sun-window fallback
            // answers a MISSING flag, never a hole in a present series
            const isDayFlags = state.hourly.isDay;
            const days = times.map((t, k) => {
                const flag = isDayFlags ? isDayFlags[hourlyIndices[k]] : undefined;
                if (flag !== undefined)
                    return flag;
                const h = Number(t.slice(11, 13)) || 0;
                return h >= 6 && h < 21;
            });
            this._strip = {
                scenes: hourlyIndices.map((i, k) => sceneFor(state.hourly.code[i], days[k]).scene),
                nights: days.map(d => !d),
                intensities: hourlyIndices.map(i => CODE_PRECIP_INTENSITY[state.hourly.code[i]] ?? null),
                variants: hourlyIndices.map(i => variantForCode(state.hourly.code[i])),
            };
        }
        // today's window starts 2 h early: the now marker sits that far in
        this._nowFrac = this._day === 0
            ? nowFracIn(state.hourly, hourlyIndices, state.currentIso) : null;
        // each tile quotes the same hours its chart draw shows: today is
        // the rolling 24 h (recomputed here, window crosses midnight after
        // 10 PM), other days the exact calendar slice -- providers bucket
        // their daily max/min over that same midnight-to-midnight window,
        // so those tiles agree with their curves by construction
        const hiLabel = this._dayHiLabels[this._day];
        if (hiLabel && hourlyIndices.length) {
            const temps = hourlyIndices
                .map(i => state.hourly.temp[i])
                .filter(Number.isFinite);
            if (temps.length) {
                hiLabel.set_text(fmtTemp(Math.max(...temps), units));
                this._dayLowLabels[this._day].set_text(fmtTemp(Math.min(...temps), units));
            }
        }
        return hourlyIndices.map(i => state.hourly[field][i] ?? 0);
    }

    _updateSky() {
        const state = this._state;
        if (!state)
            return;
        let scene, night;
        if (this._day === 0) {
            scene = (state.effective ?? sceneFor(state.current.code, state.current.isDay)).scene;
            night = !state.current.isDay;
        } else {
            scene = sceneFor(state.daily[this._day].code, true).scene;
            night = false;
        }
        this._skyOpts.scene = scene;
        this._skyOpts.night = night;
        this._skyOpts.phase = Number.isFinite(state.phase) ? state.phase : null;
        this._sunCoords = Number.isFinite(state.latitude) && Number.isFinite(state.longitude)
            ? [state.latitude, state.longitude] : null;
        if (this._day === 0 && this._onSky)
            this._onSky(scene, night);
        this._skyArea.queue_repaint();
    }

    _morphTo(targetValues) {
        if (this._morphId) {
            GLib.source_remove(this._morphId);
            this._morphId = 0;
        }
        // today's chart is the rolling 24 h window (2 h backfill, so up to
        // 26 points); every other day is the exact calendar slice (24).
        // morphPair resamples the old series onto the new grid so Today
        // morphs like its neighbours instead of snapping (the old
        // equal-length guard was the whole difference the users saw).
        const pair = this._animate ? morphPair(this._shown, targetValues) : null;
        if (!pair) {
            this._shown = targetValues.slice();
            return;
        }
        const [from, to] = pair;
        // start on the resampled grid RIGHT NOW: a repaint landing
        // before the first morph tick would otherwise draw the old
        // series' length against the new strip (26-pt Today vs 24)
        this._shown = from.slice();
        const startTime = GLib.get_monotonic_time();
        this._morphId = GLib.timeout_add(GLib.PRIORITY_LOW, CHART_MORPH_TICK_MS, () => {
            const progress = Math.min(1, (GLib.get_monotonic_time() - startTime) / (CHART_MORPH_DURATION_MS * 1000));
            this._shown = lerp(from, to, ease(progress));
            this._chart.queue_repaint();
            if (progress >= 1) {
                this._morphId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _buildDayTiles() {
        this._dayButtons = [];
        this._dayLowLabels = [];
        this._dayHiLabels = [];
        this._tileIcons = [];
    }

    _markTiles() {
    }

    _applyTileInk() {
        const solidDark = this._style === 'solid' && this._dark;
        for (const icon of this._tileIcons)
            icon.setDark(this._iconDark());
        this._placeholderIcon.setDark(this._iconDark());
        for (const [i, btn] of this._dayButtons.entries()) {
            const lowLabel = this._dayLowLabels[i];
            const icon = this._tileIcons[i];
            if (this._style === 'accent' || !this._state) {
                btn.set_style('');
                lowLabel.set_style('');
                icon.setPale(i === this._day || solidDark);
                // plain/accent card: no sampled sky, hand the referee back
                // its unsampled fallback (the light/dark chain setDark drives)
                icon.setGroundLum(-1);
                continue;
            }
            let bg = this._bgAt(0.9);              // tiles live at card foot
            const selected = i === this._day;      // selected: + tile glass
            const hovered = i === this._hoverDay;  // hovered: + hover glass
            if (selected)
                bg = compGlass(bg, this._paintDark());
            else if (hovered)
                bg = hoverGlass(bg, this._paintDark());
            const ink = pickInk(bg);
            btn.set_style(inkCss(ink));
            lowLabel.set_style(inkCss(ink, 0.82));
            // the glyph mirrors its label: wherever the tile's text
            // went light because the composited ground under this tile
            // is dark (night, rain paint, glass), the whole glyph joins
            // the glow family -- one verdict, drawn twice, never apart.
            // One glyph-only bar on top, hover or not: a soft glyph needs
            // more room than a hairline -- the glow body (WCAG ~0.62) and
            // the deep ink body (WCAG ~0.20) cross over around the
            // geometric middle of the grounds measured live: approved
            // pale scenes (hover slabs, dusk cards) sit at 0.18-0.23,
            // daytime overcast grounds at 0.39+. The bar is their
            // geometric mean, 0.30 -- NOTE lumOf is WCAG (gamma-corrected)
            // luminance, NOT a plain channel mean: an overcast foot at
            // rgb(155,170,186) reads 0.66 plain but only 0.39 here, and
            // a 0.62 threshold in this space silently kept every day
            // tile on the pale family (shipped v6 regression). Labels
            // keep their own verdict via pickInk. At or above the bar
            // the painter deepens clouds/water a tier (CLOUD_DEEP).
            icon.setPale(tileGlyphPale(bg, { selected, solidDark }));
            icon.setGroundLum(lumOf(bg));
        }
    }

    _applyTextInk() {
        const plain = this._style === 'accent' || !this._state;
        const setActorStyle = (actor, css) => {
            if (actor && actor._awInk !== css) {
                actor._awInk = css;
                actor.set_style(css);
            }
        };
        if (plain) {
            for (const actor of [this._temperatureLabel, this._descriptionLabel, this._cityLabel,
            this._clockLabel, this._hiLoLabel, this._summaryLabel])
                setActorStyle(actor, '');
            for (const icon of this._ghostIcons)
                setActorStyle(icon, '');
            for (const btn of Object.values(this._tabButtons))
                setActorStyle(btn, '');
            return;
        }
        const halo = inkJudgeResult => this._emboss ? haloCss(inkJudgeResult) : '';
        const actorBox = actor => {
            try {
                const [cardX, cardY] = this._content.get_transformed_position();
                const [cardWidth, cardHeight] = this._content.get_size();
                const [actorX, actorY] = actor.get_transformed_position();
                const [actorWidth, actorHeight] = actor.get_size();
                if (!cardWidth || !cardHeight || !actorWidth || !actorHeight ||
                    !Number.isFinite(actorX + actorY + cardX + cardY))
                    return null;
                return [actorX - cardX, actorY - cardY, actorWidth, actorHeight];
            } catch {
                return null;   // stale allocation between relayouts
            }
        };
        const [cardWidth, cardHeight] = this._content.get_size();
        const idleTabs = Object.entries(this._tabButtons)
            .filter(([key]) => key !== this._metric);
        /* the grouping lives in ink-policy -- card-demo renders the SAME
         * verdicts into the goldens */
        const verdicts = chromeVerdicts({
            headerLeft: [this._temperatureLabel, this._descriptionLabel].map(actorBox),
            headerRight: [this._cityLabel, this._clockLabel].map(actorBox),
            tabActive: actorBox(this._tabButtons[this._metric]),
            tabsIdle: idleTabs.map(([, btn]) => actorBox(btn)),
        }, cardWidth, cardHeight,
            (fx, fy) => this._bgAt(fy, { f: fy, x: fx }),
            bg => compGlass(bg, this._paintDark()));
        const applyGroup = (result, actors) => {
            if (!result)
                return;
            const css = inkCss(result.ink) + halo(result);
            for (const actor of actors)
                setActorStyle(actor, css);
        };
        applyGroup(verdicts.headerLeft,
            [this._temperatureLabel, this._descriptionLabel]);
        applyGroup(verdicts.headerRight, [this._cityLabel, this._clockLabel]);
        const ghostJudgeResult = judgeInk(
            [].concat(...this._ghostIcons.map(icon => this._bgsOf(icon))));
        const glow = !this._emboss ? ''
            : ghostJudgeResult.ink === INK_DARK
                ? ' icon-shadow: 0 1px 3px rgba(255,255,255,0.7);'
                : ' icon-shadow: 0 1px 4px rgba(0,0,10,0.7);';
        for (const icon of this._ghostIcons)
            setActorStyle(icon, inkCss(ghostJudgeResult.ink) + glow);
        if (this._tabButtons)
            applyGroup(verdicts.tabActive, [this._tabButtons[this._metric]]);
        applyGroup(verdicts.tabsIdle, idleTabs.map(([, btn]) => btn));
    }

    _groupInk(bgs) {
        if (!bgs.length)
            return { ink: pickInk(this._bgUnderChart()), emboss: false };
        return judgeInk(bgs);
    }

    _bgsOf(actor) {
        const out = [];
        try {
            const [cardX, cardY] = this._content.get_transformed_position();
            const [cardWidth, cardHeight] = this._content.get_size();
            const [actorX, actorY] = actor.get_transformed_position();
            const [actorWidth, actorHeight] = actor.get_size();
            if (!cardWidth || !cardHeight || !actorWidth || !actorHeight ||
                !Number.isFinite(actorX + actorY + cardX + cardY))
                return out;   // unmapped/NaN allocation: nothing to judge
            for (const [fx, fy] of boxSampleFractions(
                [actorX - cardX, actorY - cardY, actorWidth, actorHeight],
                cardWidth, cardHeight))
                out.push(this._bgAt(fy, { f: fy, x: fx }));
        } catch {
            // stale allocation between relayouts: judge with what we have
        }
        return out;
    }

    /* what the CARD shows is not always what the system is: animated sky
     * is a self-contrasting painting, so it keeps the dark presentation in
     * light sessions too (no wash, white-biased ink, dark pills). The ink
     * judge still flips individual labels over bright sun/clouds. The
     * accent style paints no ground of its own -- it borrows the shell
     * popup surface, whose variant the session mode referees (a plain
     * light desktop keeps a dark shell), so it judges by _shellDark;
     * null (probe/demo drive, pre-variant shells) follows _dark. */
    _paintDark() {
        if (this._style === 'accent')
            return this._shellDark === null ? this._dark : this._shellDark;
        return this._style === 'animated' || this._dark;
    }

    /* day-tile + placeholder icons paint over the live sky but have no
     * backdrop sampler of their own -- _paintDark() is the THEME's mood,
     * which in animated style always says 'dark' and parks pale water
     * on a noon sky. Judge their palette from the composited ground
     * where they actually sit (sky + scrim + tile glass), with the very
     * verdict the labels get: lumOf is WCAG, and a plain-mean threshold
     * like 0.55 can never be reached by ordinary daylight, so every day
     * card counted as night and the glyphs stayed pale all afternoon.
     * Bright ground earns the dark-twin glyphs */
    _iconDark() {
        if (this._style === 'accent')
            return this._paintDark();
        return pickInk(this._bgAt(0.8)) !== INK_DARK;
    }

    _theme() {
        return this._paintDark() ? THEME_CONFIG.dark : THEME_CONFIG.light;
    }

    _applyTheme() {
        this._content.remove_style_class_name(THEME_CONFIG.dark.cls);
        this._content.remove_style_class_name(THEME_CONFIG.light.cls);
        this._content.add_style_class_name(this._theme().cls);
        this._syncScrim();
        // day-tile + placeholder icons paint their own weather scenes; tell
        // them the new background so pale glyphs (moon/snow/fog) stay visible
        for (const icon of this._tileIcons)
            icon.setDark(this._iconDark());
        this._placeholderIcon.setDark(this._iconDark());
        this._applyTileInk();          // selected-tile glass differs per theme
        this._skyArea.queue_repaint();
        this._chart.queue_repaint();
    }

    /* which wash rides over the background for the current menu style */
    _syncScrim() {
        this._skyOpts.scrim = this._style === 'solid' ? this._theme().scrimSolid : null;
    }

    _showBody(haveData) {
        this._main.visible = haveData;
        this._placeholderBox.visible = !haveData;
    }

    _tickClock() {
        if (!this._cityEpochMs) {
            this._clockLabel.set_text('');
            return;
        }
        const currentMs = this._cityEpochMs +
            Math.round((GLib.get_monotonic_time() - this._cityBaseTime) / 1000);
        const cityDate = new Date(currentMs);   // parsed+rendered in machine TZ: cancels out
        const minutesStr = String(cityDate.getMinutes()).padStart(2, '0');
        this._clockLabel.set_text(this._is24Hour
            ? `${cityDate.getHours()}:${minutesStr}`
            : `${cityDate.getHours() % 12 || 12}:${minutesStr} ${cityDate.getHours() < 12 ? 'AM' : 'PM'}`);
    }
}
