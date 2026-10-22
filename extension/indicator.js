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
            text: '...',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._box.add_child(this._icon);
        this._box.add_child(this._label);
        this.add_child(this._box);

        // 2. Set min width for popup
        this.menu.box.style = 'min-width: 320px; padding: 4px;';

        // 3. Connect weather coordinator
        this._coordinator = new WeatherCoordinator(this._settings);
        this._coordinator.onData((data, isAuto) => this._onWeatherReceived(data, isAuto));
        this._coordinator.onError(err => this._onWeatherError(err));

        // 4. Initial placeholder menu
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

        // 1. Update panel indicator: strictly clean number without '+' or emojis
        const roundedTemp = Math.round(current.temp);
        this._icon.icon_name = iconName;
        this._label.text = `${roundedTemp}°`;

        // 2. Resolve city name
        const cityName = (isAuto && detectedName)
            ? detectedName
            : (this._settings.get_string('location-name') || 'Моє розташування');

        console.log(`[Meteo] Weather updated successfully! city=${cityName}, temp=${roundedTemp}°, icon=${iconName}`);

        // 3. Build rich menu
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

        // --- Card 1: Main Header (City, Big Temp, Condition, Range) ---
        const headerItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        const headerBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 10px 14px 6px 14px;',
        });

        // City Name
        const cityLabel = new St.Label({
            text: cityName,
            style: 'font-size: 19px; font-weight: 600; text-align: center;',
            x_align: Clutter.ActorAlign.CENTER,
        });

        // Large Temperature
        const tempLabel = new St.Label({
            text: `${Math.round(current.temp)}°`,
            style: 'font-size: 48px; font-weight: 200; text-align: center; margin: -2px 0 2px 0;',
            x_align: Clutter.ActorAlign.CENTER,
        });

        // Condition text
        const conditionText = sceneInfo.desc || 'Ясно';
        const condLabel = new St.Label({
            text: conditionText,
            style: 'font-size: 14px; font-weight: 500; opacity: 0.85; text-align: center;',
            x_align: Clutter.ActorAlign.CENTER,
        });

        // Daily High / Low
        let highLowStr = '';
        if (daily && daily.tempMax && daily.tempMax[0] !== undefined) {
            const h = Math.round(daily.tempMax[0]);
            const l = Math.round(daily.tempMin[0]);
            highLowStr = `Макс.: ${h}°, мін.: ${l}°`;
        }
        const highLowLabel = new St.Label({
            text: highLowStr,
            style: 'font-size: 13px; opacity: 0.7; text-align: center; margin-top: 2px;',
            x_align: Clutter.ActorAlign.CENTER,
        });

        headerBox.add_child(cityLabel);
        headerBox.add_child(tempLabel);
        headerBox.add_child(condLabel);
        if (highLowStr) headerBox.add_child(highLowLabel);
        headerItem.add_child(headerBox);
        this.menu.addMenuItem(headerItem);

        // --- Card 2: Hourly Forecast (Horizontal strip) ---
        if (hourly && hourly.temp && hourly.temp.length > 0) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const hourlySection = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
            const hourlyContainer = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: 'padding: 4px 10px;',
            });

            const hourlyTitle = new St.Label({
                text: 'ПОГОДИННИЙ ПРОГНОЗ',
                style: 'font-size: 11px; font-weight: 700; opacity: 0.55; margin-bottom: 8px;',
            });
            hourlyContainer.add_child(hourlyTitle);

            const hourlyScroll = new St.ScrollView({
                hscrollbar_policy: St.PolicyType.AUTOMATIC,
                vscrollbar_policy: St.PolicyType.NEVER,
                style: 'padding-bottom: 4px;',
            });

            const hourlyRow = new St.BoxLayout({ style: 'spacing: 16px;' });

            // Next 12 hourly slots
            const maxHours = Math.min(12, hourly.temp.length);
            for (let i = 0; i < maxHours; i++) {
                const hourBox = new St.BoxLayout({
                    vertical: true,
                    style: 'spacing: 4px; min-width: 42px;',
                    x_align: Clutter.ActorAlign.CENTER,
                });

                let hourStr = 'Зараз';
                if (i > 0 && hourly.time && hourly.time[i]) {
                    try {
                        const date = new Date(hourly.time[i]);
                        hourStr = `${String(date.getHours()).padStart(2, '0')}:00`;
                    } catch {
                        hourStr = `+${i}г`;
                    }
                }

                const hLabel = new St.Label({
                    text: hourStr,
                    style: 'font-size: 11px; opacity: 0.75;',
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
                    icon_size: 18,
                    style_class: 'system-status-icon',
                    x_align: Clutter.ActorAlign.CENTER,
                });

                const hTemp = new St.Label({
                    text: `${Math.round(hourly.temp[i])}°`,
                    style: 'font-size: 13px; font-weight: 600;',
                    x_align: Clutter.ActorAlign.CENTER,
                });

                hourBox.add_child(hLabel);
                hourBox.add_child(hIcon);
                hourBox.add_child(hTemp);
                hourlyRow.add_child(hourBox);
            }

            hourlyScroll.add_child(hourlyRow);
            hourlyContainer.add_child(hourlyScroll);
            hourlySection.add_child(hourlyContainer);
            this.menu.addMenuItem(hourlySection);
        }

        // --- Card 3: 7-Day Forecast ---
        if (daily && daily.tempMax && daily.tempMax.length > 0) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            const dailySection = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
            const dailyContainer = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: 'padding: 4px 10px;',
            });

            const dailyTitle = new St.Label({
                text: 'ПРОГНОЗ НА 7 ДНІВ',
                style: 'font-size: 11px; font-weight: 700; opacity: 0.55; margin-bottom: 6px;',
            });
            dailyContainer.add_child(dailyTitle);

            // Compute global min & max across 7 days for range calculation
            const daysCount = Math.min(7, daily.tempMax.length);
            let globalMin = Infinity;
            let globalMax = -Infinity;
            for (let i = 0; i < daysCount; i++) {
                if (daily.tempMin[i] < globalMin) globalMin = daily.tempMin[i];
                if (daily.tempMax[i] > globalMax) globalMax = daily.tempMax[i];
            }
            const rangeSpan = Math.max(1, globalMax - globalMin);

            for (let i = 0; i < daysCount; i++) {
                const dayRow = new St.BoxLayout({
                    x_expand: true,
                    style: 'spacing: 10px; padding: 3px 0;',
                    y_align: Clutter.ActorAlign.CENTER,
                });

                // Day name
                const dayNameStr = formatDayName(daily.time ? daily.time[i] : '', i);
                const dayNameLabel = new St.Label({
                    text: dayNameStr,
                    style: 'font-size: 13px; font-weight: 500; min-width: 65px;',
                    y_align: Clutter.ActorAlign.CENTER,
                });

                // Weather Icon
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

                // Min temp
                const minLabel = new St.Label({
                    text: `${Math.round(daily.tempMin[i])}°`,
                    style: 'font-size: 13px; opacity: 0.7; min-width: 28px; text-align: right;',
                    y_align: Clutter.ActorAlign.CENTER,
                });

                // Visual Range Bar
                const barContainer = new St.Bin({
                    x_expand: true,
                    style: 'height: 4px; background-color: rgba(255, 255, 255, 0.15); border-radius: 2px; margin: 0 4px;',
                    y_align: Clutter.ActorAlign.CENTER,
                });

                const fillLeftPercent = Math.max(0, Math.min(100, ((daily.tempMin[i] - globalMin) / rangeSpan) * 100));
                const fillWidthPercent = Math.max(10, Math.min(100 - fillLeftPercent, ((daily.tempMax[i] - daily.tempMin[i]) / rangeSpan) * 100));

                const barFill = new St.Widget({
                    style: `margin-left: ${Math.round(fillLeftPercent)}%; width: ${Math.round(fillWidthPercent)}%; height: 4px; background: linear-gradient(to right, #59c0fa, #fba626); border-radius: 2px;`,
                });
                barContainer.set_child(barFill);

                // Max temp
                const maxLabel = new St.Label({
                    text: `${Math.round(daily.tempMax[i])}°`,
                    style: 'font-size: 13px; font-weight: 600; min-width: 28px; text-align: right;',
                    y_align: Clutter.ActorAlign.CENTER,
                });

                dayRow.add_child(dayNameLabel);
                dayRow.add_child(dIcon);
                dayRow.add_child(minLabel);
                dayRow.add_child(barContainer);
                dayRow.add_child(maxLabel);
                dailyContainer.add_child(dayRow);
            }

            dailySection.add_child(dailyContainer);
            this.menu.addMenuItem(dailySection);
        }

        // --- Bottom Actions: Refresh & Preferences ---
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const actionsItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        const actionsBox = new St.BoxLayout({
            x_expand: true,
            style: 'spacing: 12px; padding: 2px 4px;',
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
        });
        refreshBtn.connect('clicked', () => {
            this._coordinator.fetch(true);
        });

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

        const spacer = new St.Widget({ x_expand: true });

        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const updatedLabel = new St.Label({
            text: `Оновлено: ${timeStr}`,
            style: 'font-size: 11px; opacity: 0.5;',
            y_align: Clutter.ActorAlign.CENTER,
        });

        actionsBox.add_child(updatedLabel);
        actionsBox.add_child(spacer);
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
});
