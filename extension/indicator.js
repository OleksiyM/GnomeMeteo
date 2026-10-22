// Meteo Indicator (clean architecture, hot-reloadable, backed by weather.js)

import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
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
        case 'wind': return 'weather-wind-symbolic';
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

            // 1. Panel button layout: clean icon + number + degree
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

            // 2. Minimum menu width
            this.menu.box.style = 'min-width: 260px;';

            // 3. Connect weather coordinator
            this._coordinator = new WeatherCoordinator(this._settings);
            this._coordinator.onData((data, isAuto) => this._onWeatherReceived(data, isAuto));
            this._coordinator.onError(err => this._onWeatherError(err));

            // 4. Initial placeholder
            this._buildPlaceholder('Завантаження погоди…');

            // 5. Settings change listener
            this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
                if (key === 'auto-location') {
                    if (settings.get_boolean('auto-location')) ensureDesktopEntry();
                    else removeDesktopEntry();
                    this._coordinator.fetch(true);
                } else if (['location-latitude', 'location-longitude', 'units', 'provider', 'om-model'].includes(key)) {
                    this._coordinator.fetch(true);
                }
            });

            // 6. Refresh on menu open if data is stale
            this._menuOpenId = this.menu.connect('open-state-changed', (menu, open) => {
                if (open && this._coordinator.isStale()) {
                    this._coordinator.fetch(false);
                }
            });

            // 7. Initial fetch
            this._coordinator.fetch(true);
            this._coordinator.startTimer();
        }

        _onWeatherReceived(data, isAuto) {
            const { current, daily, hourly, detectedName } = data;
            const sceneInfo = deriveScene(current);
            const iconName = getSymbolicIcon(sceneInfo.scene, current.isDay);

            // Update panel indicator
            const roundedTemp = Math.round(current.temp);
            this._icon.icon_name = iconName;
            this._label.text = `${roundedTemp}°`;

            // Resolve city name
            const cityName = (isAuto && detectedName)
                ? detectedName
                : (this._settings.get_string('location-name') || 'Моє розташування');

            console.log(`[Meteo] Weather updated: city=${cityName}, temp=${roundedTemp}°, icon=${iconName}`);

            // Build menu
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

            // 1. Header: City & Large Temp
            const titleItem = new PopupMenu.PopupMenuItem(cityName, { reactive: false });
            titleItem.label.style = 'font-size: 16px; font-weight: bold; text-align: center;';
            titleItem.label.x_align = Clutter.ActorAlign.CENTER;
            this.menu.addMenuItem(titleItem);

            const tempItem = new PopupMenu.PopupMenuItem(`${Math.round(current.temp)}°`, { reactive: false });
            tempItem.label.style = 'font-size: 38px; font-weight: 300; text-align: center;';
            tempItem.label.x_align = Clutter.ActorAlign.CENTER;
            this.menu.addMenuItem(tempItem);

            // Condition & Range
            const condText = sceneInfo.desc || 'Ясно';
            let rangeText = condText;
            if (daily && daily.tempMax && daily.tempMax[0] !== undefined) {
                const h = Math.round(daily.tempMax[0]);
                const l = Math.round(daily.tempMin[0]);
                rangeText = `${condText}  ·  Макс.: ${h}°, мін.: ${l}°`;
            }
            const descItem = new PopupMenu.PopupMenuItem(rangeText, { reactive: false });
            descItem.label.style = 'font-size: 12px; opacity: 0.8; text-align: center;';
            descItem.label.x_align = Clutter.ActorAlign.CENTER;
            this.menu.addMenuItem(descItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // 2. Next 5 Hours (clean row)
            if (hourly && hourly.temp && hourly.temp.length > 0) {
                const hourlyHeader = new PopupMenu.PopupMenuItem('ПОГОДИННИЙ ПРОГНОЗ', { reactive: false });
                hourlyHeader.label.style = 'font-size: 11px; font-weight: bold; opacity: 0.6;';
                this.menu.addMenuItem(hourlyHeader);

                const hourlyItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
                const hourlyRow = new St.BoxLayout({
                    x_expand: true,
                    style: 'spacing: 12px; padding: 4px 6px;',
                });

                const count = Math.min(5, hourly.temp.length);
                for (let i = 0; i < count; i++) {
                    const col = new St.BoxLayout({
                        vertical: true,
                        x_expand: true,
                        style: 'spacing: 4px;',
                        x_align: Clutter.ActorAlign.CENTER,
                    });

                    let timeLabel = 'Зараз';
                    if (i > 0 && hourly.time && hourly.time[i]) {
                        try {
                            const d = new Date(hourly.time[i]);
                            timeLabel = `${String(d.getHours()).padStart(2, '0')}:00`;
                        } catch {
                            timeLabel = `+${i}г`;
                        }
                    }

                    const tLab = new St.Label({
                        text: timeLabel,
                        style: 'font-size: 11px; opacity: 0.7;',
                        x_align: Clutter.ActorAlign.CENTER,
                    });

                    const hScene = deriveScene({
                        code: hourly.code ? hourly.code[i] : current.code,
                        visibility: null,
                        cape: 0,
                        isDay: hourly.isDay ? hourly.isDay[i] : current.isDay,
                    });
                    const hIcon = new St.Icon({
                        icon_name: getSymbolicIcon(hScene.scene, hourly.isDay ? hourly.isDay[i] : current.isDay),
                        icon_size: 16,
                        style_class: 'system-status-icon',
                        x_align: Clutter.ActorAlign.CENTER,
                    });

                    const degLab = new St.Label({
                        text: `${Math.round(hourly.temp[i])}°`,
                        style: 'font-size: 12px; font-weight: bold;',
                        x_align: Clutter.ActorAlign.CENTER,
                    });

                    col.add_child(tLab);
                    col.add_child(hIcon);
                    col.add_child(degLab);
                    hourlyRow.add_child(col);
                }

                hourlyItem.add_child(hourlyRow);
                this.menu.addMenuItem(hourlyItem);
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }

            // 3. 7-Day Forecast (clean slot items like svitlo-indicator)
            if (daily && daily.tempMax && daily.tempMax.length > 0) {
                const dailyHeader = new PopupMenu.PopupMenuItem('ПРОГНОЗ НА 7 ДНІВ', { reactive: false });
                dailyHeader.label.style = 'font-size: 11px; font-weight: bold; opacity: 0.6;';
                this.menu.addMenuItem(dailyHeader);

                const daysCount = Math.min(7, daily.tempMax.length);
                for (let i = 0; i < daysCount; i++) {
                    const dayItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
                    const dayBox = new St.BoxLayout({
                        x_expand: true,
                        style: 'spacing: 8px; padding: 2px 4px;',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    const nameLab = new St.Label({
                        text: formatDayName(daily.time ? daily.time[i] : '', i),
                        style: 'font-size: 13px; font-weight: 500; min-width: 65px;',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    const dScene = deriveScene({
                        code: daily.code ? daily.code[i] : 0,
                        visibility: null,
                        cape: 0,
                        isDay: true,
                    });
                    const dIcon = new St.Icon({
                        icon_name: getSymbolicIcon(dScene.scene, true),
                        icon_size: 16,
                        style_class: 'system-status-icon',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    const spacer = new St.Widget({ x_expand: true });

                    const rangeLab = new St.Label({
                        text: `${Math.round(daily.tempMin[i])}° … ${Math.round(daily.tempMax[i])}°`,
                        style: 'font-size: 13px; opacity: 0.85;',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    dayBox.add_child(nameLab);
                    dayBox.add_child(dIcon);
                    dayBox.add_child(spacer);
                    dayBox.add_child(rangeLab);
                    dayItem.add_child(dayBox);
                    this.menu.addMenuItem(dayItem);
                }

                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }

            // 4. Footer actions: Refresh & Preferences
            const actionsItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
            const actionsBox = new St.BoxLayout({
                x_expand: true,
                style: 'spacing: 8px; padding: 2px 4px;',
                y_align: Clutter.ActorAlign.CENTER,
            });

            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const timeLab = new St.Label({
                text: `Оновлено: ${timeStr}`,
                style: 'font-size: 11px; opacity: 0.5;',
                y_align: Clutter.ActorAlign.CENTER,
            });

            const footerSpacer = new St.Widget({ x_expand: true });

            const refreshBtn = new St.Button({
                child: new St.Icon({
                    icon_name: 'view-refresh-symbolic',
                    icon_size: 16,
                    style_class: 'system-status-icon',
                }),
                style_class: 'button',
                can_focus: true,
            });
            refreshBtn.connect('clicked', () => this._coordinator.fetch(true));

            const prefsBtn = new St.Button({
                child: new St.Icon({
                    icon_name: 'preferences-system-symbolic',
                    icon_size: 16,
                    style_class: 'system-status-icon',
                }),
                style_class: 'button',
                can_focus: true,
            });
            prefsBtn.connect('clicked', () => {
                this.menu.close();
                this._ext.openPreferences();
            });

            actionsBox.add_child(timeLab);
            actionsBox.add_child(footerSpacer);
            actionsBox.add_child(refreshBtn);
            actionsBox.add_child(prefsBtn);
            actionsItem.add_child(actionsBox);
            this.menu.addMenuItem(actionsItem);
        }

        destroy() {
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
