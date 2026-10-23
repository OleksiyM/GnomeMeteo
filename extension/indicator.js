// Meteo Indicator (Clean GNOME Adwaita-inspired card layout, full i18n, accurate hourly clock times)

import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { WeatherClient, deriveScene, ensureDesktopEntry, removeDesktopEntry } from './weather.js';
import { moonPhase } from './moon.js';

const MESSAGES = {
    uk: {
        today: 'Сьогодні',
        days: ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
        hourlyTitle: 'ПОГОДИННИЙ ПРОГНОЗ',
        hourlyMetrics: {
            temp: 'ТЕМПЕРАТУРА',
            precip: 'ОПАДИ',
            wind: 'ВІТЕР',
        },
        metricTips: {
            temp: 'Температура',
            precip: 'Ймовірність опадів',
            wind: 'Швидкість вітру',
        },
        dailyTitle: '🗓️ ПРОГНОЗ НА {n} ДНІВ',
        windUnit: 'км/год',
        windUnitImperial: 'миль/год',
        now: 'Зараз',
        max: 'Макс.',
        min: 'Мін.',
        feelsLikeShort: 'Відчувається як',
        updatedAt: 'Оновлено о',
        recently: 'нещодавно',
        myLocation: 'Моє розташування',
        loading: 'Завантаження погоди…',
        error: 'Помилка',
        details: {
            sunriseSunset: 'СХІД І ЗАХІД',
            sunrise: 'Схід',
            sunset: 'Захід',
            moon: 'ФАЗА МІСЯЦЯ',
            moonIllum: '{n}% освітленості',
            humidity: 'ВОЛОГІСТЬ',
            dewPoint: 'Точка роси: {n}°',
            pressure: 'ТИСК',
            mm: 'мм рт. ст.',
            normal: 'Нормальний',
        },
        moonPhases: {
            'New Moon': 'Молодик',
            'Waxing Crescent': 'Молодий',
            'First Quarter': 'Перша чверть',
            'Waxing Gibbous': 'Зростаючий',
            'Full Moon': 'Повня',
            'Waning Gibbous': 'Спадаючий',
            'Last Quarter': 'Остання чверть',
            'Waning Crescent': 'Старий',
        },
        wmo: {
            0: 'Ясно',
            1: 'Переважно ясно',
            2: 'Мінлива хмарність',
            3: 'Суцільна хмарність',
            45: 'Туман',
            48: 'Паморозь',
            51: 'Невелика мряка',
            53: 'Помірна мряка',
            55: 'Густа мряка',
            56: 'Крижана мряка',
            57: 'Густа крижана мряка',
            61: 'Невеликий дощ',
            63: 'Помірний дощ',
            65: 'Сильний дощ',
            66: 'Крижаний дощ',
            67: 'Сильний крижаний дощ',
            71: 'Невеликий сніг',
            73: 'Помірний сніг',
            75: 'Сильний снігопад',
            77: 'Снігова крупа',
            80: 'Невелика злива',
            81: 'Помірна злива',
            82: 'Сильна злива',
            85: 'Невеликий снігопад',
            86: 'Сильний снігопад',
            95: 'Гроза',
            96: 'Гроза з градом',
            99: 'Сильна гроза з градом',
        },
    },
    ru: {
        today: 'Сегодня',
        days: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
        hourlyTitle: 'ПОЧАСОВОЙ ПРОГНОЗ',
        hourlyMetrics: {
            temp: 'ТЕМПЕРАТУРА',
            precip: 'ОСАДКИ',
            wind: 'ВЕТЕР',
        },
        metricTips: {
            temp: 'Температура',
            precip: 'Вероятность осадков',
            wind: 'Скорость ветра',
        },
        dailyTitle: '🗓️ ПРОГНОЗ НА {n} ДНЕЙ',
        windUnit: 'км/ч',
        windUnitImperial: 'миль/ч',
        now: 'Сейчас',
        max: 'Макс.',
        min: 'Мин.',
        feelsLikeShort: 'Ощущается как',
        updatedAt: 'Обновлено в',
        recently: 'недавно',
        myLocation: 'Моё местоположение',
        loading: 'Загрузка погоды…',
        error: 'Ошибка',
        details: {
            sunriseSunset: 'ВОСХОД И ЗАКАТ',
            sunrise: 'Восход',
            sunset: 'Закат',
            moon: 'ФАЗА ЛУНЫ',
            moonIllum: '{n}% освещенности',
            humidity: 'ВЛАЖНОСТЬ',
            dewPoint: 'Точка росы: {n}°',
            pressure: 'ДАВЛЕНИЕ',
            mm: 'мм рт. ст.',
            normal: 'Нормальное',
        },
        moonPhases: {
            'New Moon': 'Новолуние',
            'Waxing Crescent': 'Молодая',
            'First Quarter': 'Первая четверть',
            'Waxing Gibbous': 'Растущая',
            'Full Moon': 'Полнолуние',
            'Waning Gibbous': 'Убывающая',
            'Last Quarter': 'Третья четверть',
            'Waning Crescent': 'Старая',
        },
        wmo: {
            0: 'Ясно',
            1: 'Преимущественно ясно',
            2: 'Переменная облачность',
            3: 'Пасмурно',
            45: 'Туман',
            48: 'Изморозь',
            51: 'Лёгкая морось',
            53: 'Умеренная морось',
            55: 'Плотная морось',
            56: 'Ледяная морось',
            57: 'Плотная ледяная морось',
            61: 'Небольшой дождь',
            63: 'Умеренный дождь',
            65: 'Сильный дождь',
            66: 'Ледяной дождь',
            67: 'Сильный ледяной дождь',
            71: 'Небольшой снег',
            73: 'Умеренный снег',
            75: 'Сильный снегопад',
            77: 'Снежная крупа',
            80: 'Кратковременный дождь',
            81: 'Ливень',
            82: 'Сильный ливень',
            85: 'Небольшой снегопад',
            86: 'Сильный снегопад',
            95: 'Гроза',
            96: 'Гроза с градом',
            99: 'Сильная гроза с градом',
        },
    },
    en: {
        today: 'Today',
        days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        hourlyTitle: 'HOURLY FORECAST',
        hourlyMetrics: {
            temp: 'TEMPERATURE',
            precip: 'PRECIPITATION',
            wind: 'WIND',
        },
        metricTips: {
            temp: 'Temperature',
            precip: 'Precipitation chance',
            wind: 'Wind speed',
        },
        dailyTitle: '🗓️ {n}-DAY FORECAST',
        windUnit: 'km/h',
        windUnitImperial: 'mph',
        now: 'Now',
        max: 'Max.',
        min: 'Min.',
        feelsLikeShort: 'Feels like',
        updatedAt: 'Updated at',
        recently: 'recently',
        myLocation: 'My location',
        loading: 'Fetching weather…',
        error: 'Error',
        details: {
            sunriseSunset: 'SUNRISE & SUNSET',
            sunrise: 'Rise',
            sunset: 'Set',
            moon: 'MOON PHASE',
            moonIllum: '{n}% illumination',
            humidity: 'HUMIDITY',
            dewPoint: 'Dew point: {n}°',
            pressure: 'PRESSURE',
            mm: 'mmHg',
            normal: 'Normal',
        },
        moonPhases: {
            'New Moon': 'New Moon',
            'Waxing Crescent': 'Waxing Crescent',
            'First Quarter': 'First Quarter',
            'Waxing Gibbous': 'Waxing Gibbous',
            'Full Moon': 'Full Moon',
            'Waning Gibbous': 'Waning Gibbous',
            'Last Quarter': 'Last Quarter',
            'Waning Crescent': 'Waning Crescent',
        },
        wmo: {
            0: 'Clear sky',
            1: 'Mainly clear',
            2: 'Partly cloudy',
            3: 'Overcast',
            45: 'Fog',
            48: 'Rime fog',
            51: 'Light drizzle',
            53: 'Drizzle',
            55: 'Dense drizzle',
            56: 'Freezing drizzle',
            57: 'Dense freezing drizzle',
            61: 'Light rain',
            63: 'Rain',
            65: 'Heavy rain',
            66: 'Freezing rain',
            67: 'Heavy freezing rain',
            71: 'Light snow',
            73: 'Snow',
            75: 'Heavy snow',
            77: 'Snow grains',
            80: 'Light showers',
            81: 'Showers',
            82: 'Violent showers',
            85: 'Snow showers',
            86: 'Heavy snow showers',
            95: 'Thunderstorm',
            96: 'Thunderstorm, hail',
            99: 'Thunderstorm, heavy hail',
        },
    },
};

function resolveLang(settings) {
    const pref = settings.get_string('language');
    if (['uk', 'ru', 'en'].includes(pref)) return pref;
    const sys = GLib.get_language_names()[0] || '';
    if (sys.startsWith('uk')) return 'uk';
    if (sys.startsWith('ru')) return 'ru';
    return 'uk';
}

function is12HourFormat(settings) {
    const fmt = settings.get_string('hour-format');
    if (fmt === '12h') return true;
    if (fmt === '24h') return false;
    try {
        const iface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        const clockFmt = iface.get_string('clock-format');
        if (clockFmt) return clockFmt.includes('12');
    } catch { }
    try {
        return new Intl.DateTimeFormat().resolvedOptions().hour12 === true;
    } catch {
        return false;
    }
}

function formatHour(timeStr, is12h) {
    try {
        const d = new Date(timeStr);
        const hours = d.getHours();
        if (is12h) {
            const period = hours >= 12 ? 'PM' : 'AM';
            const h12 = hours % 12 || 12;
            return `${h12} ${period}`;
        }
        return `${String(hours).padStart(2, '0')}:00`;
    } catch {
        return timeStr;
    }
}

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

function formatDayName(dateStr, index, lang) {
    const t = MESSAGES[lang] || MESSAGES.uk;
    if (index === 0) return t.today;
    try {
        const d = new Date(dateStr);
        return t.days[d.getDay()];
    } catch {
        return dateStr;
    }
}

function getMoonInfo(lang) {
    const t = MESSAGES[lang] || MESSAGES.uk;
    const info = moonPhase();
    return {
        ...info,
        nameTrans: t.moonPhases[info.name] || info.name,
    };
}

class TooltipHelper {
    constructor() {
        this._tooltip = null;
    }

    show(actor, text) {
        this.hide();
        if (!actor || !actor.get_stage() || !actor.is_mapped()) return;

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
            const tip = this._tooltip;
            this._tooltip = null;
            tip.destroy();
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
            this._hourlyMetric = 'temp';
            this._hourlyStartIndex = 0;

            this._hourlyTitleLabel = null;
            this._dailyTitleLabel = null;
            this._hourlySlots = [];
            this._dailySlots = [];
            this._metricButtons = {};

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

            this._updatePanelIndicator();

            this.menu.box.style = 'width: 348px; min-width: 348px; max-width: 348px; padding: 10px 12px;';

            this._coordinator = new WeatherCoordinator(this._settings);
            this._coordinator.onData((data, isAuto) => this._onWeatherReceived(data, isAuto));
            this._coordinator.onError(err => this._onWeatherError(err));

            const lang = resolveLang(this._settings);
            const t = MESSAGES[lang] || MESSAGES.uk;
            this._buildPlaceholder(t.loading);

            this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
                if (key === 'show-icon' || key === 'show-temperature') {
                    this._updatePanelIndicator();
                } else if (key === 'language' || key === 'hour-format') {
                    if (this._weatherData) {
                        const isAuto = settings.get_boolean('auto-location');
                        this._onWeatherReceived(this._weatherData, isAuto);
                    }
                } else if (key === 'auto-location') {
                    if (settings.get_boolean('auto-location')) ensureDesktopEntry();
                    else removeDesktopEntry();
                    this._coordinator.fetch(true);
                } else if (['location-latitude', 'location-longitude', 'units', 'provider', 'om-model'].includes(key)) {
                    this._coordinator.fetch(true);
                }
            });

            this._menuOpenId = this.menu.connect('open-state-changed', (menu, open) => {
                if (!open) {
                    this._tooltipHelper.hide();
                } else if (this._coordinator.isStale()) {
                    this._coordinator.fetch(false);
                }
            });

            this._coordinator.fetch(true);
            this._coordinator.startTimer();
        }

        _updatePanelIndicator() {
            let showIcon = this._settings.get_boolean('show-icon');
            let showTemp = this._settings.get_boolean('show-temperature');
            if (!showIcon && !showTemp) {
                showIcon = true;
            }
            this._icon.visible = showIcon;
            this._label.visible = showTemp;
        }

        _onWeatherReceived(data, isAuto) {
            this._weatherData = data;
            const { current, daily, hourly, detectedName } = data;
            const sceneInfo = deriveScene(current);
            const iconName = getSymbolicIcon(sceneInfo.scene, current.isDay);

            let startIdx = 0;
            if (hourly && Array.isArray(hourly.time)) {
                const nowIso = current?.timeIso || '';
                const hourPrefix = nowIso.slice(0, 13);
                const found = hourly.time.findIndex(t => t.startsWith(hourPrefix));
                if (found >= 0) {
                    startIdx = found;
                } else {
                    const localHour = new Date().getHours();
                    const datePrefix = new Date().toISOString().slice(0, 10);
                    const fb = hourly.time.findIndex(t => t.startsWith(datePrefix) && t.includes(`T${String(localHour).padStart(2, '0')}`));
                    startIdx = Math.max(0, fb);
                }
            }
            this._hourlyStartIndex = startIdx;

            const roundedTemp = Math.round(current.temp);
            this._icon.icon_name = iconName;
            this._label.text = `${roundedTemp}°`;

            this._lastUpdateStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const lang = resolveLang(this._settings);
            const t = MESSAGES[lang] || MESSAGES.uk;

            const cityName = (isAuto && detectedName)
                ? detectedName
                : (this._settings.get_string('location-name') || t.myLocation);

            this._buildFullMenu(cityName, current, daily, hourly, sceneInfo, lang);
        }

        _onWeatherError(err) {
            if (!this._coordinator.data) {
                const lang = resolveLang(this._settings);
                const t = MESSAGES[lang] || MESSAGES.uk;
                this._label.text = '—';
                this._buildPlaceholder(`${t.error}: ${err.message}`);
            }
        }

        _buildPlaceholder(text) {
            this.menu.removeAll();
            const item = new PopupMenu.PopupMenuItem(text, { reactive: false });
            this.menu.addMenuItem(item);
        }

        _buildFullMenu(cityName, current, daily, hourly, sceneInfo, lang) {
            this.menu.removeAll();
            this._hourlySlots = [];
            this._dailySlots = [];
            this._metricButtons = {};

            const t = MESSAGES[lang] || MESSAGES.uk;
            const is12h = is12HourFormat(this._settings);
            const dailyArr = Array.isArray(daily) ? daily : [];

            // ══════════════════════════════════════════════════════════════════
            // 1. PINNED HEADER
            // ══════════════════════════════════════════════════════════════════
            const headerItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
            const headerContainer = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: 'padding: 4px 4px 10px 4px;',
            });

            const topRow = new St.BoxLayout({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const iconBtnStyle = 'width: 30px; height: 30px; border-radius: 15px; background-color: rgba(255, 255, 255, 0.08); padding: 0;';
            const iconBtnHoverStyle = 'width: 30px; height: 30px; border-radius: 15px; background-color: rgba(255, 255, 255, 0.18); padding: 0;';

            const refreshBtn = new St.Button({
                child: new St.Icon({
                    icon_name: 'view-refresh-symbolic',
                    icon_size: 15,
                    style_class: 'system-status-icon',
                }),
                style: iconBtnStyle,
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            refreshBtn.connect('notify::hover', () => {
                refreshBtn.style = refreshBtn.hover ? iconBtnHoverStyle : iconBtnStyle;
                if (refreshBtn.hover) {
                    this._tooltipHelper.show(refreshBtn, `${t.updatedAt} ${this._lastUpdateStr || t.recently}`);
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
                style: 'font-size: 18px; font-weight: 600; color: #ffffff; text-align: center;',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const prefsBtn = new St.Button({
                child: new St.Icon({
                    icon_name: 'preferences-system-symbolic',
                    icon_size: 15,
                    style_class: 'system-status-icon',
                }),
                style: iconBtnStyle,
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            prefsBtn.connect('notify::hover', () => {
                prefsBtn.style = prefsBtn.hover ? iconBtnHoverStyle : iconBtnStyle;
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

            const tempLabel = new St.Label({
                text: `${Math.round(current.temp)}°`,
                style: 'font-size: 56px; font-weight: 300; color: #ffffff; text-align: center; margin-top: 1px; margin-bottom: 1px;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            headerContainer.add_child(tempLabel);

            const condText = t.wmo[current.code] || sceneInfo.desc || 'Ясно';
            const condLabel = new St.Label({
                text: condText,
                style: 'font-size: 14.5px; font-weight: 500; color: #ffffff; text-align: center;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            headerContainer.add_child(condLabel);

            if (dailyArr.length > 0 && dailyArr[0].tmax !== undefined) {
                const todayMax = Math.round(dailyArr[0].tmax);
                const todayMin = Math.round(dailyArr[0].tmin);
                const rangeLabel = new St.Label({
                    text: `${t.max} ${todayMax}° · ${t.min} ${todayMin}°`,
                    style: 'font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.82); text-align: center; margin-top: 3px;',
                    x_align: Clutter.ActorAlign.CENTER,
                });
                headerContainer.add_child(rangeLabel);
            }

            const feelsVal = current.feels !== undefined ? `${Math.round(current.feels)}°` : `${Math.round(current.temp)}°`;
            const feelsLabel = new St.Label({
                text: `${t.feelsLikeShort} ${feelsVal}`,
                style: 'font-size: 12px; font-weight: 400; color: rgba(255, 255, 255, 0.72); text-align: center; margin-top: 2px;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            headerContainer.add_child(feelsLabel);

            headerItem.add_child(headerContainer);
            this.menu.addMenuItem(headerItem);

            // ══════════════════════════════════════════════════════════════════
            // SCROLLABLE CONTAINER
            // ══════════════════════════════════════════════════════════════════
            const scrollItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
            const vScroll = new St.ScrollView({
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.EXTERNAL,
                enable_mouse_scrolling: true,
                style: 'max-height: 560px; x-expand: true;',
            });

            const contentBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: 'spacing: 10px;',
            });

            // ──────────────────────────────────────────────────────────────────
            // 2. CARD: HOURLY FORECAST (Clean header controls, full-width strip)
            // ──────────────────────────────────────────────────────────────────
            if (hourly && Array.isArray(hourly.temp) && hourly.temp.length > 0) {
                const hourlyCardBox = new St.BoxLayout({
                    vertical: true,
                    x_expand: true,
                    style: 'background-color: rgba(255, 255, 255, 0.07); border-radius: 14px; padding: 10px 12px;',
                });

                const hourlyHeaderRow = new St.BoxLayout({
                    x_expand: true,
                    style: 'margin-bottom: 14px; spacing: 6px;',
                    y_align: Clutter.ActorAlign.CENTER,
                });

                const isImperial = this._settings.get_string('units') === 'imperial';
                const windUnit = isImperial ? t.windUnitImperial : t.windUnit;
                const initialMetricTitle = (this._hourlyMetric === 'wind')
                    ? `${t.hourlyMetrics.wind} (${windUnit})`
                    : t.hourlyMetrics[this._hourlyMetric];

                this._hourlyTitleLabel = new St.Label({
                    text: initialMetricTitle,
                    style: 'font-size: 11px; font-weight: 700; color: rgba(255, 255, 255, 0.55); letter-spacing: 0.05em;',
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                hourlyHeaderRow.add_child(this._hourlyTitleLabel);

                // Segmented Metric Switcher
                const switcherBox = new St.BoxLayout({
                    style: 'background-color: rgba(0, 0, 0, 0.24); border-radius: 8px; padding: 2px; spacing: 2px;',
                    y_align: Clutter.ActorAlign.CENTER,
                });

                const METRICS = [
                    { id: 'temp', icon: 'temperature-symbolic', tip: t.metricTips.temp },
                    { id: 'precip', icon: 'weather-showers-symbolic', tip: t.metricTips.precip },
                    { id: 'wind', icon: 'weather-windy-symbolic', tip: t.metricTips.wind },
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
                        if (btn.hover) {
                            this._tooltipHelper.show(btn, m.tip);
                            if (m.id !== this._hourlyMetric) btn.opacity = 210;
                        } else {
                            this._tooltipHelper.hide();
                            if (m.id !== this._hourlyMetric) btn.opacity = 135;
                        }
                    });

                    btn.connect('clicked', () => {
                        this._tooltipHelper.hide();
                        this._setMetric(m.id);
                    });

                    switcherBox.add_child(btn);
                    this._metricButtons[m.id] = btn;
                }
                hourlyHeaderRow.add_child(switcherBox);

                // Compact Header Pager [< | >] — never overlaps forecast items!
                const navBox = new St.BoxLayout({
                    style: 'background-color: rgba(0, 0, 0, 0.24); border-radius: 8px; padding: 2px; spacing: 2px;',
                    y_align: Clutter.ActorAlign.CENTER,
                });

                const navBtnBase = 'padding: 3px 6px; border-radius: 6px; background-color: transparent;';
                const navBtnHover = 'padding: 3px 6px; border-radius: 6px; background-color: rgba(255, 255, 255, 0.16);';

                const prevBtn = new St.Button({
                    child: new St.Icon({
                        icon_name: 'go-previous-symbolic',
                        icon_size: 12,
                        style_class: 'system-status-icon',
                    }),
                    style: navBtnBase,
                    can_focus: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });

                const nextBtn = new St.Button({
                    child: new St.Icon({
                        icon_name: 'go-next-symbolic',
                        icon_size: 12,
                        style_class: 'system-status-icon',
                    }),
                    style: navBtnBase,
                    can_focus: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });

                prevBtn.connect('notify::hover', () => {
                    prevBtn.style = (prevBtn.reactive && prevBtn.hover) ? navBtnHover : navBtnBase;
                });
                nextBtn.connect('notify::hover', () => {
                    nextBtn.style = (nextBtn.reactive && nextBtn.hover) ? navBtnHover : navBtnBase;
                });

                navBox.add_child(prevBtn);
                navBox.add_child(nextBtn);
                hourlyHeaderRow.add_child(navBox);
                hourlyCardBox.add_child(hourlyHeaderRow);

                // Full-width Horizontal Scroll for 24 Hours (no overlay clutter!)
                const hScroll = new St.ScrollView({
                    hscrollbar_policy: St.PolicyType.EXTERNAL,
                    vscrollbar_policy: St.PolicyType.NEVER,
                    enable_mouse_scrolling: true,
                    x_expand: true,
                    style: 'height: 66px;',
                });

                const hadj = hScroll.get_hadjustment();

                const updateNavState = () => {
                    const currentVal = hadj.value;
                    const maxVal = Math.max(0, hadj.upper - hadj.page_size);

                    const canGoLeft = currentVal > 4;
                    const canGoRight = maxVal <= 4 ? true : currentVal < maxVal - 4;

                    prevBtn.reactive = canGoLeft;
                    prevBtn.opacity = canGoLeft ? 230 : 75;
                    if (!canGoLeft) prevBtn.style = navBtnBase;

                    nextBtn.reactive = canGoRight;
                    nextBtn.opacity = canGoRight ? 230 : 75;
                    if (!canGoRight) nextBtn.style = navBtnBase;
                };

                hadj.connect('notify::value', updateNavState);
                hadj.connect('changed', updateNavState);
                this._updateHourlyNavVisibility = updateNavState;

                // 5 columns visible at once (~60px stride) -> scroll by 4 hours (240px)
                const SCROLL_STEP = 232;

                const smoothScrollTo = (target) => {
                    if (typeof hadj.ease === 'function') {
                        hadj.ease(target, {
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                            duration: 240,
                        });
                    } else {
                        hadj.value = target;
                    }
                };

                prevBtn.connect('clicked', () => {
                    this._tooltipHelper.hide();
                    const target = Math.max(hadj.lower, hadj.value - SCROLL_STEP);
                    smoothScrollTo(target);
                });

                nextBtn.connect('clicked', () => {
                    this._tooltipHelper.hide();
                    const maxVal = Math.max(hadj.lower, hadj.upper - hadj.page_size);
                    const target = Math.min(maxVal, hadj.value + SCROLL_STEP);
                    smoothScrollTo(target);
                });

                const hourlyRow = new St.BoxLayout({
                    style: 'spacing: 10px; padding: 2px 2px;',
                });

                const availableSlots = Math.min(24, hourly.temp.length - this._hourlyStartIndex);
                for (let i = 0; i < availableSlots; i++) {
                    const dataIdx = this._hourlyStartIndex + i;
                    const col = new St.BoxLayout({
                        vertical: true,
                        style: 'spacing: 6px; min-width: 48px;',
                        x_align: Clutter.ActorAlign.CENTER,
                    });

                    const timeStr = (i === 0)
                        ? t.now
                        : formatHour(hourly.time[dataIdx], is12h);

                    const tLab = new St.Label({
                        text: timeStr,
                        style: `font-size: 11.5px; color: ${i === 0 ? '#ffffff' : 'rgba(255, 255, 255, 0.75)'}; font-weight: ${i === 0 ? '700' : '500'};`,
                        x_align: Clutter.ActorAlign.CENTER,
                    });

                    const hIcon = new St.Icon({
                        icon_name: 'weather-clear-symbolic',
                        icon_size: 18,
                        style_class: 'system-status-icon',
                        x_align: Clutter.ActorAlign.CENTER,
                    });

                    const valLab = new St.Label({
                        text: '',
                        style: 'font-size: 13px; font-weight: 600; color: #ffffff;',
                        x_align: Clutter.ActorAlign.CENTER,
                    });

                    col.add_child(tLab);
                    col.add_child(hIcon);
                    col.add_child(valLab);
                    hourlyRow.add_child(col);

                    this._hourlySlots.push({ dataIdx, icon: hIcon, val: valLab });
                }

                hScroll.set_child(hourlyRow);
                hourlyCardBox.add_child(hScroll);
                contentBox.add_child(hourlyCardBox);
            }

            // ──────────────────────────────────────────────────────────────────
            // 3. CARD: 7-DAY FORECAST
            // ──────────────────────────────────────────────────────────────────
            if (dailyArr.length > 0) {
                const dailyCardBox = new St.BoxLayout({
                    vertical: true,
                    x_expand: true,
                    style: 'background-color: rgba(255, 255, 255, 0.07); border-radius: 14px; padding: 10px 12px; spacing: 4px;',
                });

                const daysCount = Math.min(7, dailyArr.length);
                const BAR_WIDTH = 104;

                for (let i = 0; i < daysCount; i++) {
                    const dayData = dailyArr[i];
                    const dayRow = new St.BoxLayout({
                        x_expand: true,
                        style: 'spacing: 8px; padding: 2px 0;',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    const nameLab = new St.Label({
                        text: formatDayName(dayData.date, i, lang),
                        style: `font-size: 13px; font-weight: ${i === 0 ? '600' : '500'}; min-width: 68px; color: #ffffff;`,
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    const dIcon = new St.Icon({
                        icon_name: 'weather-clear-symbolic',
                        icon_size: 16,
                        style_class: 'system-status-icon',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    const spacer = new St.Widget({
                        x_expand: true,
                    });

                    const leftLab = new St.Label({
                        text: '',
                        style: 'font-size: 13px; color: rgba(255, 255, 255, 0.55); min-width: 28px; text-align: right;',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    const barBox = new St.Widget({
                        style: `width: ${BAR_WIDTH}px; height: 5px; background-color: rgba(255, 255, 255, 0.14); border-radius: 3px;`,
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    const barFill = new St.Widget({
                        style_class: 'meteo-range-fill',
                        style: 'height: 5px; border-radius: 3px;',
                    });
                    barBox.add_child(barFill);

                    const rightLab = new St.Label({
                        text: '',
                        style: 'font-size: 13px; font-weight: 600; color: #ffffff; min-width: 30px; text-align: right;',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    dayRow.add_child(nameLab);
                    dayRow.add_child(dIcon);
                    dayRow.add_child(spacer);
                    dayRow.add_child(leftLab);
                    dayRow.add_child(barBox);
                    dayRow.add_child(rightLab);
                    dailyCardBox.add_child(dayRow);

                    this._dailySlots.push({
                        isToday: (i === 0),
                        data: dayData,
                        icon: dIcon,
                        leftLab,
                        barBox,
                        barFill,
                        rightLab,
                    });
                }

                contentBox.add_child(dailyCardBox);
            }

            // ──────────────────────────────────────────────────────────────────
            // 4. CARD: 2×2 WEATHER DETAILS GRID
            // ──────────────────────────────────────────────────────────────────
            const dt = t.details;
            const detailsContainer = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: 'spacing: 8px;',
            });

            const makeTile = (iconName, title, value, subtext, tooltipText = null) => {
                const tile = new St.BoxLayout({
                    vertical: true,
                    x_expand: true,
                    reactive: !!tooltipText,
                    can_focus: false,
                    style: 'background-color: rgba(255, 255, 255, 0.07); border-radius: 14px; padding: 9px 10px; min-height: 64px;',
                });

                const headRow = new St.BoxLayout({
                    vertical: false,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'spacing: 5px; margin-bottom: 6px;',
                });
                if (iconName) {
                    headRow.add_child(new St.Icon({
                        icon_name: iconName,
                        icon_size: 11,
                        style_class: 'system-status-icon',
                        style: 'opacity: 0.6;',
                    }));
                }
                const tLab = new St.Label({
                    text: title,
                    style: 'font-size: 10px; font-weight: 700; color: rgba(255, 255, 255, 0.55); letter-spacing: 0.04em;',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                headRow.add_child(tLab);
                tile.add_child(headRow);

                const vLab = new St.Label({
                    text: value,
                    style: 'font-size: 15px; font-weight: 600; color: #ffffff; margin: 1px 0;',
                });
                tile.add_child(vLab);

                if (subtext) {
                    const sLab = new St.Label({
                        text: subtext,
                        style: 'font-size: 11.5px; color: rgba(255, 255, 255, 0.72); margin-top: 2px;',
                    });
                    tile.add_child(sLab);
                }

                if (tooltipText) {
                    tile.connect('notify::hover', () => {
                        if (tile.hover) {
                            this._tooltipHelper.show(tile, tooltipText);
                        } else {
                            this._tooltipHelper.hide();
                        }
                    });
                }

                return tile;
            };

            const row1 = new St.Widget({
                layout_manager: new Clutter.BoxLayout({
                    orientation: Clutter.Orientation.HORIZONTAL,
                    homogeneous: true,
                    spacing: 8,
                }),
                x_expand: true,
            });
            let sunriseStr = '07:15';
            let sunsetStr = '17:45';
            if (dailyArr[0] && dailyArr[0].sunrise) {
                try {
                    const sr = new Date(dailyArr[0].sunrise);
                    const ss = new Date(dailyArr[0].sunset);
                    sunriseStr = `${String(sr.getHours()).padStart(2, '0')}:${String(sr.getMinutes()).padStart(2, '0')}`;
                    sunsetStr = `${String(ss.getHours()).padStart(2, '0')}:${String(ss.getMinutes()).padStart(2, '0')}`;
                } catch { }
            }
            const moon = getMoonInfo(lang);

            row1.add_child(makeTile('daytime-sunrise-symbolic', dt.sunriseSunset, `${dt.sunrise}: ${sunriseStr}`, `${dt.sunset}: ${sunsetStr}`));
            row1.add_child(makeTile('weather-clear-night-symbolic', dt.moon, moon.nameTrans, dt.moonIllum.replace('{n}', Math.round(moon.illum * 100)), moon.nameTrans));
            detailsContainer.add_child(row1);

            const row2 = new St.Widget({
                layout_manager: new Clutter.BoxLayout({
                    orientation: Clutter.Orientation.HORIZONTAL,
                    homogeneous: true,
                    spacing: 8,
                }),
                x_expand: true,
            });
            const humVal = current.humidity !== undefined ? `${Math.round(current.humidity)}%` : '—';
            const dewPoint = current.humidity !== undefined ? Math.round(current.temp - ((100 - current.humidity) / 5)) : Math.round(current.temp - 4);
            const pressMm = current.pressure ? Math.round(current.pressure * 0.750062) : 750;

            row2.add_child(makeTile('weather-showers-symbolic', dt.humidity, humVal, dt.dewPoint.replace('{n}', dewPoint)));
            row2.add_child(makeTile('find-location-symbolic', dt.pressure, `${pressMm}`, `${dt.mm} · ${dt.normal}`));
            detailsContainer.add_child(row2);

            contentBox.add_child(detailsContainer);

            vScroll.set_child(contentBox);
            scrollItem.add_child(vScroll);
            this.menu.addMenuItem(scrollItem);

            this._applyMetricUpdates();
        }

        _setMetric(metricId) {
            this._hourlyMetric = metricId;
            this._applyMetricUpdates();
        }

        _applyMetricUpdates() {
            const lang = resolveLang(this._settings);
            const t = MESSAGES[lang] || MESSAGES.uk;

            for (const [key, btn] of Object.entries(this._metricButtons)) {
                if (key === this._hourlyMetric) {
                    btn.style = 'padding: 3px 8px; border-radius: 6px; background-color: rgba(255, 255, 255, 0.24); color: #ffffff;';
                    btn.opacity = 255;
                } else {
                    btn.style = 'padding: 3px 8px; border-radius: 6px; background-color: transparent;';
                    btn.opacity = 135;
                }
            }

            if (this._hourlyTitleLabel) {
                const isImperial = this._settings.get_string('units') === 'imperial';
                const windUnit = isImperial ? t.windUnitImperial : t.windUnit;
                const metricTitle = (this._hourlyMetric === 'wind')
                    ? `${t.hourlyMetrics.wind} (${windUnit})`
                    : t.hourlyMetrics[this._hourlyMetric];
                this._hourlyTitleLabel.text = metricTitle;
            }

            this._updateHourlyRow();
            this._updateDailyRows();
            this._updateHourlyNavVisibility?.();
        }

        _updateHourlyRow() {
            if (!this._weatherData || !this._weatherData.hourly) return;
            const { hourly, current } = this._weatherData;
            if (!Array.isArray(hourly.temp)) return;

            for (const slot of this._hourlySlots) {
                const dataIdx = slot.dataIdx;
                if (dataIdx === undefined || dataIdx >= hourly.temp.length) continue;

                if (this._hourlyMetric === 'precip') {
                    slot.icon.icon_name = 'weather-showers-symbolic';
                    const prob = (hourly.precipProb && hourly.precipProb[dataIdx] !== undefined)
                        ? Math.round(hourly.precipProb[dataIdx])
                        : 0;
                    slot.val.text = `${prob}%`;
                    slot.val.style = prob === 0
                        ? 'font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.4);'
                        : 'font-size: 13px; font-weight: 600; color: #ffffff;';
                    slot.icon.opacity = prob === 0 ? 130 : 255;
                } else if (this._hourlyMetric === 'wind') {
                    slot.icon.icon_name = 'weather-windy-symbolic';
                    slot.icon.opacity = 255;
                    const windSpeed = (hourly.wind && hourly.wind[dataIdx] !== undefined)
                        ? Math.round(hourly.wind[dataIdx])
                        : 0;
                    slot.val.text = `${windSpeed}`;
                    slot.val.style = 'font-size: 13px; font-weight: 600; color: #ffffff;';
                } else {
                    const isDay = hourly.isDay ? hourly.isDay[dataIdx] : current.isDay;
                    const hScene = deriveScene({
                        code: hourly.code ? hourly.code[dataIdx] : current.code,
                        visibility: null,
                        cape: 0,
                        isDay,
                    });
                    slot.icon.opacity = 255;
                    slot.icon.icon_name = getSymbolicIcon(hScene.scene, isDay);
                    slot.val.text = `${Math.round(hourly.temp[dataIdx])}°`;
                    slot.val.style = 'font-size: 13px; font-weight: 600; color: #ffffff;';
                }
            }
        }

        _updateDailyRows() {
            if (!this._dailySlots || this._dailySlots.length === 0) return;
            const currentTemp = this._weatherData?.current?.temp ?? 0;
            const isImperial = this._settings.get_string('units') === 'imperial';
            const lang = resolveLang(this._settings);
            const t = MESSAGES[lang] || MESSAGES.uk;
            const windUnit = isImperial ? t.windUnitImperial : t.windUnit;

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
                const dScene = deriveScene({
                    code: d.code ?? 0,
                    visibility: null,
                    cape: 0,
                    isDay: true,
                });
                slot.icon.show();
                slot.icon.icon_name = getSymbolicIcon(dScene.scene, true);

                const BAR_WIDTH = 104;

                if (this._hourlyMetric === 'precip') {
                    const prob = Math.round(d.precipProb ?? 0);
                    slot.leftLab.show();
                    slot.leftLab.text = '💧';
                    slot.leftLab.style = `font-size: 11px; min-width: 28px; text-align: right; opacity: ${prob >= 20 ? '0.95' : (prob > 0 ? '0.6' : '0.25')};`;

                    slot.barBox.style = `width: ${BAR_WIDTH}px; height: 5px; background-color: rgba(255, 255, 255, 0.14); border-radius: 3px;`;
                    const fillW = Math.max(0, Math.min(BAR_WIDTH, Math.round((prob / 100) * BAR_WIDTH)));
                    slot.barFill.style = `margin-left: 0px; width: ${fillW}px; height: 5px; background-gradient-direction: none; background-color: #3898ec; border-radius: 3px;`;

                    slot.rightLab.text = `${prob}%`;
                    slot.rightLab.style = prob === 0
                        ? 'font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.4); min-width: 38px; text-align: right;'
                        : 'font-size: 13px; font-weight: 600; color: #ffffff; min-width: 38px; text-align: right;';
                } else if (this._hourlyMetric === 'wind') {
                    const rawSpeed = d.windMax ?? 0;
                    const windVal = Math.round(isImperial ? rawSpeed * 0.621371 : rawSpeed);
                    const maxDisplayWind = Math.round(isImperial ? maxWind * 0.621371 : maxWind);
                    const fillW = Math.max(0, Math.min(BAR_WIDTH, Math.round((windVal / Math.max(1, maxDisplayWind)) * BAR_WIDTH)));

                    slot.leftLab.show();
                    slot.leftLab.text = '💨';
                    slot.leftLab.style = 'font-size: 11px; min-width: 28px; text-align: right; opacity: 0.75;';

                    slot.barBox.style = `width: ${BAR_WIDTH}px; height: 5px; background-color: rgba(255, 255, 255, 0.14); border-radius: 3px;`;
                    slot.barFill.style = `margin-left: 0px; width: ${fillW}px; height: 5px; background-gradient-direction: none; background-color: #30b0c7; border-radius: 3px;`;

                    slot.rightLab.text = `${windVal}`;
                    slot.rightLab.style = 'font-size: 13px; font-weight: 600; color: #ffffff; min-width: 30px; text-align: right;';
                } else {
                    slot.barBox.style = `width: ${BAR_WIDTH}px; height: 5px; background-color: rgba(255, 255, 255, 0.14); border-radius: 3px;`;

                    slot.leftLab.show();
                    slot.leftLab.text = `${Math.round(d.tmin)}°`;
                    slot.leftLab.style = 'font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.6); min-width: 28px; text-align: right; opacity: 1;';

                    const fillLeft = Math.max(0, Math.min(BAR_WIDTH - 8, Math.round(((d.tmin - globalMin) / rangeSpan) * BAR_WIDTH)));
                    const fillRight = Math.max(fillLeft + 8, Math.min(BAR_WIDTH, Math.round(((d.tmax - globalMin) / rangeSpan) * BAR_WIDTH)));
                    const fillWidth = Math.max(8, fillRight - fillLeft);

                    // St native gradient syntax (background-gradient-direction / start / end)
                    slot.barFill.style = `margin-left: ${fillLeft}px; width: ${fillWidth}px; height: 5px; background-gradient-direction: horizontal; background-gradient-start: #59c0fa; background-gradient-end: #f59e0b; border-radius: 3px;`;

                    slot.rightLab.text = `${Math.round(d.tmax)}°`;
                    slot.rightLab.style = 'font-size: 13px; font-weight: 600; color: #ffffff; min-width: 30px; text-align: right;';
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