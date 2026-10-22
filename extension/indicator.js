// Meteo Indicator (Apple-inspired smartphone card layout, synchronized metric switcher)

import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { WeatherClient, deriveScene, ensureDesktopEntry, removeDesktopEntry } from './weather.js';

function getSymbolicIcon(scene, isDay = true) {
    switch (scene) {
        case 'sun': return 'weather-clear-symbolic';
        case 'moon': return 'weather-clear-night-symbolic';
        case 'partly': return isDay ? 'weather-few-clouds-symbolic' : 'weather-few-clouds-night-symbolic';
        case 'cloud': return 'weather-overcast-symbolic';
        case 'fog': return 'weather-fog-symbolic';
        case 'rain': return 'weather-showers-symbolic';
        case 'sleet': return 'weather-showers-symbolic';
        case 'snow': return 'weather-snow-symbolic';
        case 'storm':
        case 'hail': return 'weather-severe-alert-symbolic';
        case 'wind': return 'weather-windy-symbolic';
        default: return isDay ? 'weather-clear-symbolic' : 'weather-clear-night-symbolic';
    }
}

function formatDayName(dateStr, index) {
    if (index === 0) return 'Сьогодні';
    try {
        const d = new Date(dateStr);
        const days = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        return days[d.getDay()];
    } catch {
        return dateStr;
    }
}

class TooltipHelper {
    constructor() {
        this._tooltip = null;
    }

    show(actor, text) {
        this.hide();
        this._tooltip = new St.Label({
            text,
            style_class: 'dash-label',
            reactive: false,
        });
        Main.uiGroup.add_child(this._tooltip);

        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        const [, naturalWidth] = this._tooltip.get_preferred_width(-1);
        const tipWidth = naturalWidth || 120;

        this._tooltip.set_position(
            Math.round(x + w / 2 - tipWidth / 2),
            Math.round(y + h + 6)
        );
    }

    hide() {
        if (this._tooltip) {
            Main.uiGroup.remove_child(this._tooltip);
            this._tooltip.destroy();
            this._tooltip = null;
        }
    }
}

class WeatherCoordinator {
    constructor(settings) {
        this._settings = settings;
        this._client = new WeatherClient(
            this._settings.get_string('provider'),
            this._settings.get_string('om-model')
        );

        this._refreshTimerId = 0;
        this._lastFetch = 0;
        this._data = null;
        this._busy = false;

        this._onLoading = null;
        this._onData = null;
        this._onError = null;
    }

    get data() { return this._data; }
    onLoading(cb) { this._onLoading = cb; }
    onData(cb) { this._onData = cb; }
    onError(cb) { this._onError = cb; }

    isStale() {
        const intervalSec = this._settings.get_int('refresh-minutes') * 60;
        const nowSec = GLib.get_monotonic_time() / 1000000;
        return this._lastFetch === 0 || (nowSec - this._lastFetch) > intervalSec;
    }

    async fetch(force = false) {
        if (this._busy) return;
        this._busy = true;
        if (this._onLoading) this._onLoading();

        try {
            const isAuto = this._settings.get_boolean('auto-location');
            const data = await this._client.fetch({
                auto: isAuto,
                latitude: this._settings.get_double('location-latitude'),
                longitude: this._settings.get_double('location-longitude'),
                days: 10,
            });
            this._data = data;
            this._lastFetch = GLib.get_monotonic_time() / 1000000;
            if (this._onData) this._onData(data, isAuto);
        } catch (err) {
            console.error(`[Meteo] Weather fetch error: ${err.message}`);
            if (this._onError) this._onError(err);
        } finally {
            this._busy = false;
        }
    }

    startTimer() {
        if (this._refreshTimerId) {
            GLib.source_remove(this._refreshTimerId);
        }
        const intervalSec = Math.max(60, this._settings.get_int('refresh-minutes') * 60);
        this._refreshTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, intervalSec, () => {
            this.fetch(false);
            return GLib.SOURCE_CONTINUE;
        });
    }

    destroy() {
        if (this._refreshTimerId) {
            GLib.source_remove(this._refreshTimerId);
            this._refreshTimerId = 0;
        }
        this._client.destroy();
    }
}

export const MeteoIndicator = GObject.registerClass(
    { GTypeName: `MeteoIndicator_${Date.now()}` },
    class extends PanelMenu.Button {
        _init(extension) {
            super._init(0.0, 'Meteo');
            this._ext = extension;
            this._settings = extension.getSettings();
            this._tooltipHelper = new TooltipHelper();
            this._lastUpdateStr = '';
            this._weatherData = null;
            this._hourlyMetric = 'temp'; // 'temp' | 'precip' | 'wind'

            this._hourlyTitleLabel = null;
            this._dailyTitleLabel = null;
            this._hourlySlots = [];
            this._dailySlots = [];
            this._metricButtons = {};

            // 1. Panel button: clean symbolic icon + temperature (e.g. 13°)
            this._box = new St.BoxLayout({
                style_class: 'panel-status-indicators-box',
                y_align: Clutter.ActorAlign.CENTER,
            });

            this._icon = new St.Icon({
                icon_name: 'weather-clear-symbolic',
                style_class: 'system-status-icon',
            });

            this._label = new St.Label({
                text: '13°',
                y_align: Clutter.ActorAlign.CENTER,
            });

            this._box.add_child(this._icon);
            this._box.add_child(this._label);
            this.add_child(this._box);

            // 2. Vertical smartphone-card dimensions
            this.menu.box.style = 'min-width: 330px; max-width: 350px; padding: 10px 12px;';

            // 3. Connect weather coordinator
            this._coordinator = new WeatherCoordinator(this._settings);
            this._coordinator.onData((data, isAuto) => this._onWeatherReceived(data, isAuto));
            this._coordinator.onError(err => this._onWeatherError(err));

            this._buildPlaceholder('Завантаження погоди…');

            // 4. Settings listener
            this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
                if (key === 'auto-location') {
                    if (settings.get_boolean('auto-location')) ensureDesktopEntry();
                    else removeDesktopEntry();
                    this._coordinator.fetch(true);
                } else if (['location-latitude', 'location-longitude', 'units', 'provider', 'om-model'].includes(key)) {
                    this._coordinator.fetch(true);
                }
            });

            // 5. Hide tooltip on menu close, refresh if stale
            this._menuOpenId = this.menu.connect('open-state-changed', (menu, open) => {
                if (!open) {
                    this._tooltipHelper.hide();
                } else if (this._coordinator.isStale()) {
                    this._coordinator.fetch(false);
                }
            });

            // 6. Initial fetch
            this._coordinator.fetch(true);
            this._coordinator.startTimer();
        }

        _onWeatherReceived(data, isAuto) {
            this._weatherData = data;
            const { current, daily, hourly, detectedName } = data;
            const sceneInfo = deriveScene(current);
            const iconName = getSymbolicIcon(sceneInfo.scene, current.isDay);

            // Update panel indicator
            const roundedTemp = Math.round(current.temp);
            this._icon.icon_name = iconName;
            this._label.text = `${roundedTemp}°`;

            this._lastUpdateStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const cityName = (isAuto && detectedName)
                ? detectedName
                : (this._settings.get_string('location-name') || 'Моє розташування');

            console.log(`[Meteo] Weather updated: city=${cityName}, temp=${roundedTemp}°, days=${Array.isArray(daily) ? daily.length : 0}`);

            this._buildFullMenu(cityName, current, daily, hourly, sceneInfo);
        }

        _onWeatherError(err) {
            if (!this._coordinator.data) {
                this._label.text = '—';
                this._buildPlaceholder(`Помилка: ${err.message}`);
            }
        }

        _buildPlaceholder(text) {
            this.menu.removeAll();
            const item = new PopupMenu.PopupMenuItem(text, { reactive: false });
            this.menu.addMenuItem(item);
        }

        _buildFullMenu(cityName, current, daily, hourly, sceneInfo) {
            this.menu.removeAll();
            this._hourlySlots = [];
            this._dailySlots = [];
            this._metricButtons = {};

            // ══════════════════════════════════════════════════════════════════
            // 1. HEADER (Top controls + Centered City, Big Temp, Condition)
            // ══════════════════════════════════════════════════════════════════
            const headerItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
            const headerContainer = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: 'padding: 4px 6px 8px 6px;',
            });

            // Top control row: [🔄 Refresh] on left, [⚙️ Settings] on right, City in center
            const topRow = new St.BoxLayout({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const refreshBtn = new St.Button({
                child: new St.Icon({
                    icon_name: 'view-refresh-symbolic',
                    icon_size: 16,
                    style_class: 'system-status-icon',
                }),
                style_class: 'button',
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            refreshBtn.connect('notify::hover', () => {
                if (refreshBtn.hover) {
                    this._tooltipHelper.show(refreshBtn, `Оновлено о ${this._lastUpdateStr}`);
                } else {
                    this._tooltipHelper.hide();
                }
            });
            refreshBtn.connect('clicked', () => {
                this._tooltipHelper.hide();
                this._coordinator.fetch(true);
            });

            const cityLabel = new St.Label({
                text: cityName,
                style: 'font-size: 18px; font-weight: 600; text-align: center;',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const prefsBtn = new St.Button({
                child: new St.Icon({
                    icon_name: 'preferences-system-symbolic',
                    icon_size: 16,
                    style_class: 'system-status-icon',
                }),
                style_class: 'button',
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            prefsBtn.connect('clicked', () => {
                this._tooltipHelper.hide();
                this.menu.close();
                this._ext.openPreferences();
            });

            topRow.add_child(refreshBtn);
            topRow.add_child(cityLabel);
            topRow.add_child(prefsBtn);
            headerContainer.add_child(topRow);

            // Centered Big Temperature
            const tempLabel = new St.Label({
                text: `${Math.round(current.temp)}°`,
                style: 'font-size: 48px; font-weight: 200; text-align: center; margin-top: 4px;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            headerContainer.add_child(tempLabel);

            // Condition Description
            const condLabel = new St.Label({
                text: sceneInfo.desc || 'Ясно',
                style: 'font-size: 14px; font-weight: 500; opacity: 0.85; text-align: center;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            headerContainer.add_child(condLabel);

            // Daily Range (High / Low for today)
            const dailyArr = Array.isArray(daily) ? daily : [];
            if (dailyArr.length > 0 && dailyArr[0].tmax !== undefined) {
                const todayMax = Math.round(dailyArr[0].tmax);
                const todayMin = Math.round(dailyArr[0].tmin);
                const rangeLabel = new St.Label({
                    text: `Макс.: ${todayMax}° · Мін.: ${todayMin}°`,
                    style: 'font-size: 13px; opacity: 0.7; text-align: center; margin-top: 2px;',
                    x_align: Clutter.ActorAlign.CENTER,
                });
                headerContainer.add_child(rangeLabel);
            }

            headerItem.add_child(headerContainer);
            this.menu.addMenuItem(headerItem);

            // ══════════════════════════════════════════════════════════════════
            // 2. CARD: HOURLY FORECAST (with Switcher)
            // ══════════════════════════════════════════════════════════════════
            if (hourly && Array.isArray(hourly.temp) && hourly.temp.length > 0) {
                const hourlyCardItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
                const hourlyCardBox = new St.BoxLayout({
                    vertical: true,
                    x_expand: true,
                    style: 'background-color: rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 10px 12px; margin: 4px 0;',
                });

                // Header with Title + Metric Switcher Row
                const hourlyHeaderRow = new St.BoxLayout({
                    x_expand: true,
                    style: 'margin-bottom: 8px;',
                    y_align: Clutter.ActorAlign.CENTER,
                });

                this._hourlyTitleLabel = new St.Label({
                    text: 'ПОГОДИННИЙ ПРОГНОЗ',
                    style: 'font-size: 11px; font-weight: 700; opacity: 0.6;',
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                hourlyHeaderRow.add_child(this._hourlyTitleLabel);

                // Metric Switcher buttons: Temp, Precip (Опади), Wind (Вітер)
                const switcherBox = new St.BoxLayout({
                    style: 'spacing: 4px;',
                    y_align: Clutter.ActorAlign.CENTER,
                });

                const METRICS = [
                    { id: 'temp', icon: 'weather-clear-symbolic', tip: 'Температура (°C)' },
                    { id: 'precip', icon: 'weather-showers-symbolic', tip: 'Ймовірність опадів (%)' },
                    { id: 'wind', icon: 'weather-windy-symbolic', tip: 'Швидкість вітру (км/год)' },
                ];

                for (const m of METRICS) {
                    const btn = new St.Button({
                        child: new St.Icon({
                            icon_name: m.icon,
                            icon_size: 13,
                            style_class: 'system-status-icon',
                        }),
                        can_focus: true,
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    btn.connect('notify::hover', () => {
                        if (btn.hover) this._tooltipHelper.show(btn, m.tip);
                        else this._tooltipHelper.hide();
                    });

                    btn.connect('clicked', () => {
                        this._tooltipHelper.hide();
                        this._setMetric(m.id);
                    });

                    switcherBox.add_child(btn);
                    this._metricButtons[m.id] = btn;
                }

                hourlyHeaderRow.add_child(switcherBox);
                hourlyCardBox.add_child(hourlyHeaderRow);

                // Hourly Columns Row
                const hourlyRow = new St.BoxLayout({
                    x_expand: true,
                    style: 'spacing: 12px;',
                });

                const count = Math.min(6, hourly.temp.length);
                for (let i = 0; i < count; i++) {
                    const col = new St.BoxLayout({
                        vertical: true,
                        x_expand: true,
                        style: 'spacing: 4px;',
                        x_align: Clutter.ActorAlign.CENTER,
                    });

                    let timeStr = 'Зараз';
                    if (i > 0 && hourly.time && hourly.time[i]) {
                        try {
                            const d = new Date(hourly.time[i]);
                            timeStr = `${String(d.getHours()).padStart(2, '0')}:00`;
                        } catch {
                            timeStr = `+${i}г`;
                        }
                    }

                    const tLab = new St.Label({
                        text: timeStr,
                        style: 'font-size: 11px; opacity: 0.7;',
                        x_align: Clutter.ActorAlign.CENTER,
                    });

                    const hIcon = new St.Icon({
                        icon_name: 'weather-clear-symbolic',
                        icon_size: 16,
                        style_class: 'system-status-icon',
                        x_align: Clutter.ActorAlign.CENTER,
                    });

                    const valLab = new St.Label({
                        text: '',
                        style: 'font-size: 12px; font-weight: 600;',
                        x_align: Clutter.ActorAlign.CENTER,
                    });

                    col.add_child(tLab);
                    col.add_child(hIcon);
                    col.add_child(valLab);
                    hourlyRow.add_child(col);

                    this._hourlySlots.push({ icon: hIcon, val: valLab });
                }

                hourlyCardBox.add_child(hourlyRow);
                hourlyCardItem.add_child(hourlyCardBox);
                this.menu.addMenuItem(hourlyCardItem);
            }

            // ══════════════════════════════════════════════════════════════════
            // 3. CARD: 10-DAY FORECAST (Dynamic according to selected metric)
            // ══════════════════════════════════════════════════════════════════
            if (dailyArr.length > 0) {
                const dailyCardItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
                const dailyCardBox = new St.BoxLayout({
                    vertical: true,
                    x_expand: true,
                    style: 'background-color: rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 10px 12px; margin: 4px 0;',
                });

                const daysCount = Math.min(10, dailyArr.length);
                this._dailyTitleLabel = new St.Label({
                    text: `ПРОГНОЗ НА ${daysCount} ДНІВ`,
                    style: 'font-size: 11px; font-weight: 700; opacity: 0.6; margin-bottom: 6px;',
                });
                dailyCardBox.add_child(this._dailyTitleLabel);

                const BAR_WIDTH = 75;

                for (let i = 0; i < daysCount; i++) {
                    const dayData = dailyArr[i];
                    const dayRow = new St.BoxLayout({
                        x_expand: true,
                        style: 'spacing: 8px; padding: 3px 0;',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    // Day name
                    const nameLab = new St.Label({
                        text: formatDayName(dayData.date, i),
                        style: 'font-size: 13px; font-weight: 500; min-width: 65px;',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    // Weather icon
                    const dIcon = new St.Icon({
                        icon_name: 'weather-clear-symbolic',
                        icon_size: 16,
                        style_class: 'system-status-icon',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    // Left value / min temp
                    const leftLab = new St.Label({
                        text: '',
                        style: 'font-size: 13px; opacity: 0.7; min-width: 26px; text-align: right;',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    // Range Bar container (fixed width 75px)
                    const barBox = new St.Widget({
                        style: `width: ${BAR_WIDTH}px; height: 4px; background-color: rgba(255, 255, 255, 0.15); border-radius: 2px;`,
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    const barFill = new St.Widget({
                        style: 'height: 4px; border-radius: 2px;',
                    });
                    barBox.add_child(barFill);

                    // Right value / max temp
                    const rightLab = new St.Label({
                        text: '',
                        style: 'font-size: 13px; font-weight: 600; min-width: 32px; text-align: right;',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    dayRow.add_child(nameLab);
                    dayRow.add_child(dIcon);
                    dayRow.add_child(leftLab);
                    dayRow.add_child(barBox);
                    dayRow.add_child(rightLab);
                    dailyCardBox.add_child(dayRow);

                    this._dailySlots.push({
                        data: dayData,
                        icon: dIcon,
                        leftLab,
                        barFill,
                        rightLab,
                    });
                }

                dailyCardItem.add_child(dailyCardBox);
                this.menu.addMenuItem(dailyCardItem);
            }

            // ══════════════════════════════════════════════════════════════════
            // 4. CARD: 2×2 WEATHER DETAILS GRID
            // ══════════════════════════════════════════════════════════════════
            const detailsItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
            const detailsContainer = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: 'spacing: 8px; margin-top: 4px;',
            });

            const makeTile = (title, value, subtext) => {
                const tile = new St.BoxLayout({
                    vertical: true,
                    x_expand: true,
                    style: 'background-color: rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 8px 10px;',
                });
                const tLab = new St.Label({
                    text: title,
                    style: 'font-size: 10px; font-weight: 700; opacity: 0.5; margin-bottom: 2px;',
                });
                const vLab = new St.Label({
                    text: value,
                    style: 'font-size: 18px; font-weight: 500;',
                });
                const sLab = new St.Label({
                    text: subtext,
                    style: 'font-size: 10px; opacity: 0.6; margin-top: 2px;',
                });
                tile.add_child(tLab);
                tile.add_child(vLab);
                if (subtext) tile.add_child(sLab);
                return tile;
            };

            const row1 = new St.BoxLayout({ x_expand: true, style: 'spacing: 8px;' });
            const feelsVal = current.feels !== undefined ? `${Math.round(current.feels)}°` : `${Math.round(current.temp)}°`;
            const uvVal = current.uv !== null && current.uv !== undefined ? `${Math.round(current.uv)}` : '0';
            const uvDesc = Number(uvVal) <= 2 ? 'Низький' : Number(uvVal) <= 5 ? 'Помірний' : 'Високий';

            row1.add_child(makeTile('ВІДЧУВАЄТЬСЯ', feelsVal, 'Схоже на реальну'));
            row1.add_child(makeTile('УФ-ІНДЕКС', uvVal, uvDesc));
            detailsContainer.add_child(row1);

            const row2 = new St.BoxLayout({ x_expand: true, style: 'spacing: 8px;' });
            const humVal = current.humidity !== undefined ? `${Math.round(current.humidity)}%` : '—';
            const pressMm = current.pressure ? Math.round(current.pressure * 0.750062) : 750;

            row2.add_child(makeTile('ВОЛОГІСТЬ', humVal, 'Точка роси в нормі'));
            row2.add_child(makeTile('ТИСК', `${pressMm} мм`, 'Нормальний'));
            detailsContainer.add_child(row2);

            detailsItem.add_child(detailsContainer);
            this.menu.addMenuItem(detailsItem);

            // Initial sync for titles, buttons, and rows
            this._applyMetricUpdates();
        }

        _setMetric(metricId) {
            this._hourlyMetric = metricId;
            this._applyMetricUpdates();
        }

        _applyMetricUpdates() {
            // 1. Sync switcher buttons
            for (const [key, btn] of Object.entries(this._metricButtons)) {
                if (key === this._hourlyMetric) {
                    btn.style = 'padding: 3px 8px; border-radius: 6px; background-color: rgba(255, 255, 255, 0.25);';
                    btn.opacity = 255;
                } else {
                    btn.style = 'padding: 3px 8px; border-radius: 6px; background-color: rgba(255, 255, 255, 0.05);';
                    btn.opacity = 140;
                }
            }

            // 2. Sync Titles according to selected metric
            const daysCount = this._dailySlots.length;
            if (this._hourlyMetric === 'precip') {
                if (this._hourlyTitleLabel) this._hourlyTitleLabel.text = 'ПОГОДИННИЙ ПРОГНОЗ: ОПАДИ';
                if (this._dailyTitleLabel) this._dailyTitleLabel.text = `ПРОГНОЗ НА ${daysCount} ДНІВ: ОПАДИ`;
            } else if (this._hourlyMetric === 'wind') {
                if (this._hourlyTitleLabel) this._hourlyTitleLabel.text = 'ПОГОДИННИЙ ПРОГНОЗ: ВІТЕР';
                if (this._dailyTitleLabel) this._dailyTitleLabel.text = `ПРОГНОЗ НА ${daysCount} ДНІВ: ВІТЕР`;
            } else {
                if (this._hourlyTitleLabel) this._hourlyTitleLabel.text = 'ПОГОДИННИЙ ПРОГНОЗ: ТЕМПЕРАТУРА';
                if (this._dailyTitleLabel) this._dailyTitleLabel.text = `ПРОГНОЗ НА ${daysCount} ДНІВ: ТЕМПЕРАТУРА`;
            }

            // 3. Update Hourly Row
            this._updateHourlyRow();

            // 4. Update Daily Rows
            this._updateDailyRows();
        }

        _updateHourlyRow() {
            if (!this._weatherData || !this._weatherData.hourly) return;
            const { hourly, current } = this._weatherData;
            if (!Array.isArray(hourly.temp)) return;

            const count = Math.min(this._hourlySlots.length, hourly.temp.length);
            for (let i = 0; i < count; i++) {
                const slot = this._hourlySlots[i];
                if (!slot) continue;

                if (this._hourlyMetric === 'precip') {
                    slot.icon.icon_name = 'weather-showers-symbolic';
                    const prob = (hourly.precipProb && hourly.precipProb[i] !== undefined)
                        ? Math.round(hourly.precipProb[i])
                        : 0;
                    slot.val.text = `${prob}%`;
                } else if (this._hourlyMetric === 'wind') {
                    slot.icon.icon_name = 'weather-windy-symbolic';
                    const windSpeed = (hourly.wind && hourly.wind[i] !== undefined)
                        ? Math.round(hourly.wind[i])
                        : 0;
                    slot.val.text = `${windSpeed}`;
                } else {
                    // 'temp'
                    const hScene = deriveScene({
                        code: hourly.code ? hourly.code[i] : current.code,
                        visibility: null,
                        cape: 0,
                        isDay: hourly.isDay ? hourly.isDay[i] : current.isDay,
                    });
                    slot.icon.icon_name = getSymbolicIcon(hScene.scene, hourly.isDay ? hourly.isDay[i] : current.isDay);
                    slot.val.text = `${Math.round(hourly.temp[i])}°`;
                }
            }
        }

        _updateDailyRows() {
            if (!this._dailySlots || this._dailySlots.length === 0) return;
            const BAR_WIDTH = 75;

            // Global min/max for temperature
            let globalMin = Infinity;
            let globalMax = -Infinity;
            let maxWind = 1;
            for (const slot of this._dailySlots) {
                const d = slot.data;
                if (d.tmin < globalMin) globalMin = d.tmin;
                if (d.tmax > globalMax) globalMax = d.tmax;
                if ((d.windMax ?? 0) > maxWind) maxWind = d.windMax;
            }
            const rangeSpan = Math.max(1, globalMax - globalMin);

            for (const slot of this._dailySlots) {
                const d = slot.data;

                if (this._hourlyMetric === 'precip') {
                    // Precipitation mode: blue progress bar for rain probability
                    slot.icon.icon_name = 'weather-showers-symbolic';
                    const prob = Math.round(d.precipProb ?? 0);
                    slot.leftLab.text = '';
                    const fillW = Math.max(0, Math.min(BAR_WIDTH, Math.round((prob / 100) * BAR_WIDTH)));
                    slot.barFill.style = `margin-left: 0px; width: ${fillW}px; height: 4px; background-color: #3898ec; border-radius: 2px;`;
                    slot.rightLab.text = `${prob}%`;
                } else if (this._hourlyMetric === 'wind') {
                    // Wind mode: teal progress bar for max wind speed
                    slot.icon.icon_name = 'weather-windy-symbolic';
                    const windVal = Math.round(d.windMax ?? 0);
                    slot.leftLab.text = '';
                    const fillW = Math.max(0, Math.min(BAR_WIDTH, Math.round((windVal / Math.max(1, maxWind)) * BAR_WIDTH)));
                    slot.barFill.style = `margin-left: 0px; width: ${fillW}px; height: 4px; background-color: #30b0c7; border-radius: 2px;`;
                    slot.rightLab.text = `${windVal}`;
                } else {
                    // Temperature mode: gradient bar from min to max
                    const dScene = deriveScene({
                        code: d.code ?? 0,
                        visibility: null,
                        cape: 0,
                        isDay: true,
                    });
                    slot.icon.icon_name = getSymbolicIcon(dScene.scene, true);
                    slot.leftLab.text = `${Math.round(d.tmin)}°`;

                    const fillLeft = Math.max(0, Math.min(BAR_WIDTH - 10, Math.round(((d.tmin - globalMin) / rangeSpan) * BAR_WIDTH)));
                    const fillRight = Math.max(fillLeft + 8, Math.min(BAR_WIDTH, Math.round(((d.tmax - globalMin) / rangeSpan) * BAR_WIDTH)));
                    const fillWidth = Math.max(8, fillRight - fillLeft);

                    slot.barFill.style = `margin-left: ${fillLeft}px; width: ${fillWidth}px; height: 4px; background: linear-gradient(to right, #59c0fa, #fba626); border-radius: 2px;`;
                    slot.rightLab.text = `${Math.round(d.tmax)}°`;
                }
            }
        }

        destroy() {
            if (this._tooltipHelper) {
                this._tooltipHelper.hide();
                this._tooltipHelper = null;
            }
            if (this._settingsChangedId) {
                this._settings.disconnect(this._settingsChangedId);
                this._settingsChangedId = 0;
            }
            if (this._menuOpenId) {
                this.menu.disconnect(this._menuOpenId);
                this._menuOpenId = 0;
            }
            if (this._coordinator) {
                this._coordinator.destroy();
                this._coordinator = null;
            }
            super.destroy();
        }
    }
);
