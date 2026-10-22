// Meteo Indicator (Apple-inspired smartphone card layout, full i18n, accurate hourly clock times)

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
            temp: 'Температура (°C)',
            precip: 'Ймовірність опадів (%)',
            wind: 'Швидкість вітру (км/год)',
        },
        dailyTitle: 'ПРОГНОЗ НА {n} ДНІВ',
        now: 'Зараз',
        max: 'Макс.',
        min: 'мін.',
        updatedAt: 'Оновлено о',
        recently: 'нещодавно',
        myLocation: 'Моє розташування',
        loading: 'Завантаження погоди…',
        error: 'Помилка',
        summaryNoPrecip: '💬 В найближчі години опадів не очікується.',
        summaryPrecip: '💬 Очікуються опади в найближчі години.',
        summaryLightRain: '💬 Можливий невеликий дощ.',
        details: {
            sunriseSunset: '🌅 СХІД І ЗАХІД',
            sunrise: 'Схід',
            sunset: 'Захід',
            moon: '🌖 ФАЗА МІСЯЦЯ',
            moonIllum: '{n}% освіченості',
            feelsLike: '🌡️ ВІДЧУВАЄТЬСЯ',
            feelsCooler: 'Через вітер прохолодніше',
            feelsWarmer: 'Через вологість тепліше',
            feelsSimilar: 'Схоже на реальну',
            visibility: '👁️ ВИДИМІСТЬ',
            km: 'км',
            cleanAir: 'Чисте повітря',
            haze: 'Легкий серпанок',
            humidity: '💧 ВОЛОГІСТЬ',
            dewPoint: 'Точка роси: {n}°',
            pressure: '🧭 ТИСК',
            mm: 'мм',
            normal: 'Нормальний',
        },
        moonPhases: {
            'New Moon': 'Молодик',
            'Waxing Crescent': 'Молодий місяць',
            'First Quarter': 'Перша чверть',
            'Waxing Gibbous': 'Зростаючий місяць',
            'Full Moon': 'Повня',
            'Waning Gibbous': 'Спадаючий місяць',
            'Last Quarter': 'Остання чверть',
            'Waning Crescent': 'Старий місяць',
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
            temp: 'Температура (°C)',
            precip: 'Вероятность осадков (%)',
            wind: 'Скорость ветра (км/ч)',
        },
        dailyTitle: 'ПРОГНОЗ НА {n} ДНЕЙ',
        now: 'Сейчас',
        max: 'Макс.',
        min: 'мин.',
        updatedAt: 'Обновлено в',
        recently: 'недавно',
        myLocation: 'Моё местоположение',
        loading: 'Загрузка погоды…',
        error: 'Ошибка',
        summaryNoPrecip: '💬 В ближайшие часы осадков не ожидается.',
        summaryPrecip: '💬 Ожидаются осадки в ближайшие часы.',
        summaryLightRain: '💬 Возможен небольшой дождь.',
        details: {
            sunriseSunset: '🌅 ВОСХОД И ЗАКАТ',
            sunrise: 'Восход',
            sunset: 'Закат',
            moon: '🌖 ФАЗА ЛУНЫ',
            moonIllum: '{n}% освещенности',
            feelsLike: '🌡️ ОЩУЩАЕТСЯ',
            feelsCooler: 'Из-за ветра холоднее',
            feelsWarmer: 'Из-за влажности теплее',
            feelsSimilar: 'Похоже на реальную',
            visibility: '👁️ ВИДИМОСТЬ',
            km: 'км',
            cleanAir: 'Чистый воздух',
            haze: 'Лёгкая дымка',
            humidity: '💧 ВЛАЖНОСТЬ',
            dewPoint: 'Точка росы: {n}°',
            pressure: '🧭 ДАВЛЕНИЕ',
            mm: 'мм',
            normal: 'Нормальное',
        },
        moonPhases: {
            'New Moon': 'Новолуние',
            'Waxing Crescent': 'Молодая луна',
            'First Quarter': 'Первая четверть',
            'Waxing Gibbous': 'Растущая луна',
            'Full Moon': 'Полнолуние',
            'Waning Gibbous': 'Убывающая луна',
            'Last Quarter': 'Последняя четверть',
            'Waning Crescent': 'Старая луна',
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
            temp: 'Temperature (°C)',
            precip: 'Precipitation chance (%)',
            wind: 'Wind speed (km/h)',
        },
        dailyTitle: '{n}-DAY FORECAST',
        now: 'Now',
        max: 'H:',
        min: 'L:',
        updatedAt: 'Updated at',
        recently: 'recently',
        myLocation: 'My location',
        loading: 'Fetching weather…',
        error: 'Error',
        summaryNoPrecip: '💬 No precipitation expected in the coming hours.',
        summaryPrecip: '💬 Precipitation expected in the coming hours.',
        summaryLightRain: '💬 Light rain possible.',
        details: {
            sunriseSunset: '🌅 SUNRISE & SUNSET',
            sunrise: 'Rise',
            sunset: 'Set',
            moon: '🌖 MOON PHASE',
            moonIllum: '{n}% illumination',
            feelsLike: '🌡️ FEELS LIKE',
            feelsCooler: 'Wind makes it cooler',
            feelsWarmer: 'Humidity makes it warmer',
            feelsSimilar: 'Similar to actual',
            visibility: '👁️ VISIBILITY',
            km: 'km',
            cleanAir: 'Clear air',
            haze: 'Light haze',
            humidity: '💧 HUMIDITY',
            dewPoint: 'Dew point: {n}°',
            pressure: '🧭 PRESSURE',
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

            const lang = resolveLang(this._settings);
            const t = MESSAGES[lang] || MESSAGES.uk;
            this._buildPlaceholder(t.loading);

            // 4. Settings listener
            this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
                if (key === 'language' || key === 'hour-format') {
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

            // Find accurate start hour index
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

            // Update panel indicator
            const roundedTemp = Math.round(current.temp);
            this._icon.icon_name = iconName;
            this._label.text = `${roundedTemp}°`;

            this._lastUpdateStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const lang = resolveLang(this._settings);
            const t = MESSAGES[lang] || MESSAGES.uk;

            const cityName = (isAuto && detectedName)
                ? detectedName
                : (this._settings.get_string('location-name') || t.myLocation);

            console.log(`[Meteo] Weather updated: city=${cityName}, temp=${roundedTemp}°, hourIdx=${startIdx}, lang=${lang}`);

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
            // 1. PINNED HEADER (Top controls + City, Big Temp, Condition, Summary)
            // ══════════════════════════════════════════════════════════════════
            const headerItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
            const headerContainer = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: 'padding: 4px 6px 6px 6px;',
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
                style: 'font-size: 48px; font-weight: 200; text-align: center; margin-top: 2px;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            headerContainer.add_child(tempLabel);

            // Translated Condition Description
            const condText = t.wmo[current.code] || sceneInfo.desc || 'Ясно';
            const condLabel = new St.Label({
                text: condText,
                style: 'font-size: 14px; font-weight: 500; opacity: 0.85; text-align: center;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            headerContainer.add_child(condLabel);

            // Daily Range (High / Low for today)
            if (dailyArr.length > 0 && dailyArr[0].tmax !== undefined) {
                const todayMax = Math.round(dailyArr[0].tmax);
                const todayMin = Math.round(dailyArr[0].tmin);
                const rangeLabel = new St.Label({
                    text: `${t.max}: ${todayMax}° · ${t.min}: ${todayMin}°`,
                    style: 'font-size: 13px; opacity: 0.7; text-align: center; margin-top: 2px;',
                    x_align: Clutter.ActorAlign.CENTER,
                });
                headerContainer.add_child(rangeLabel);
            }

            // Summary text
            let summaryText = t.summaryNoPrecip;
            if (hourly && Array.isArray(hourly.precipProb)) {
                const nextHoursPrecip = hourly.precipProb.slice(this._hourlyStartIndex, this._hourlyStartIndex + 6);
                const maxPrecip = Math.max(...nextHoursPrecip, 0);
                if (maxPrecip >= 45) {
                    summaryText = t.summaryPrecip;
                } else if (maxPrecip >= 20) {
                    summaryText = t.summaryLightRain;
                }
            }
            const summaryLabel = new St.Label({
                text: summaryText,
                style: 'font-size: 11px; opacity: 0.65; text-align: center; margin-top: 4px;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            headerContainer.add_child(summaryLabel);

            headerItem.add_child(headerContainer);
            this.menu.addMenuItem(headerItem);

            // ══════════════════════════════════════════════════════════════════
            // SCROLLABLE CONTAINER (Hourly 24h, 10 Days, 2x3 Details Grid)
            // ══════════════════════════════════════════════════════════════════
            const scrollItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
            const vScroll = new St.ScrollView({
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                enable_mouse_scrolling: true,
                style: 'max-height: 520px; x-expand: true;',
            });

            const contentBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: 'padding-right: 4px;',
            });

            // ──────────────────────────────────────────────────────────────────
            // 2. CARD: HOURLY FORECAST (Accurate future clock hours, 24h scroll)
            // ──────────────────────────────────────────────────────────────────
            if (hourly && Array.isArray(hourly.temp) && hourly.temp.length > 0) {
                const hourlyCardBox = new St.BoxLayout({
                    vertical: true,
                    x_expand: true,
                    style: 'background-color: rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 10px 12px; margin: 4px 0;',
                });

                const hourlyHeaderRow = new St.BoxLayout({
                    x_expand: true,
                    style: 'margin-bottom: 8px;',
                    y_align: Clutter.ActorAlign.CENTER,
                });

                this._hourlyTitleLabel = new St.Label({
                    text: `${t.hourlyTitle}: ${t.hourlyMetrics[this._hourlyMetric]}`,
                    style: 'font-size: 11px; font-weight: 700; opacity: 0.6;',
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                hourlyHeaderRow.add_child(this._hourlyTitleLabel);

                const switcherBox = new St.BoxLayout({
                    style: 'spacing: 4px;',
                    y_align: Clutter.ActorAlign.CENTER,
                });

                const METRICS = [
                    { id: 'temp', icon: 'weather-clear-symbolic', tip: t.metricTips.temp },
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

                // Horizontal Scroll for 24 Hours
                const hScroll = new St.ScrollView({
                    hscrollbar_policy: St.PolicyType.AUTOMATIC,
                    vscrollbar_policy: St.PolicyType.NEVER,
                    enable_mouse_scrolling: true,
                    style: 'height: 72px;',
                });

                const hourlyRow = new St.BoxLayout({
                    style: 'spacing: 14px; padding: 2px 0;',
                });

                const availableSlots = Math.min(24, hourly.temp.length - this._hourlyStartIndex);
                for (let i = 0; i < availableSlots; i++) {
                    const dataIdx = this._hourlyStartIndex + i;
                    const col = new St.BoxLayout({
                        vertical: true,
                        style: 'spacing: 4px; min-width: 44px;',
                        x_align: Clutter.ActorAlign.CENTER,
                    });

                    // Slot 0 is "Now" / "Зараз" / "Сейчас"; subsequent slots are actual clock times (e.g. 23:00, 00:00)
                    let timeStr = (i === 0)
                        ? t.now
                        : formatHour(hourly.time[dataIdx], is12h);

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

                    this._hourlySlots.push({ dataIdx, icon: hIcon, val: valLab });
                }

                hScroll.add_child(hourlyRow);
                hourlyCardBox.add_child(hScroll);
                contentBox.add_child(hourlyCardBox);
            }

            // ──────────────────────────────────────────────────────────────────
            // 3. CARD: 10-DAY FORECAST
            // ──────────────────────────────────────────────────────────────────
            if (dailyArr.length > 0) {
                const dailyCardBox = new St.BoxLayout({
                    vertical: true,
                    x_expand: true,
                    style: 'background-color: rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 10px 12px; margin: 4px 0;',
                });

                const daysCount = Math.min(10, dailyArr.length);
                const titleTemplate = t.dailyTitle.replace('{n}', daysCount);
                this._dailyTitleLabel = new St.Label({
                    text: `${titleTemplate}: ${t.hourlyMetrics[this._hourlyMetric]}`,
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

                    const nameLab = new St.Label({
                        text: formatDayName(dayData.date, i, lang),
                        style: 'font-size: 13px; font-weight: 500; min-width: 65px;',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    const dIcon = new St.Icon({
                        icon_name: 'weather-clear-symbolic',
                        icon_size: 16,
                        style_class: 'system-status-icon',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    const leftLab = new St.Label({
                        text: '',
                        style: 'font-size: 13px; opacity: 0.7; min-width: 26px; text-align: right;',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    const barBox = new St.Widget({
                        style: `width: ${BAR_WIDTH}px; height: 4px; background-color: rgba(255, 255, 255, 0.15); border-radius: 2px;`,
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    const barFill = new St.Widget({
                        style: 'height: 4px; border-radius: 2px;',
                    });
                    barBox.add_child(barFill);

                    let dotWidget = null;
                    if (i === 0) {
                        dotWidget = new St.Widget({
                            style: 'width: 6px; height: 6px; border-radius: 3px; background-color: #ffffff; border: 1px solid rgba(0,0,0,0.5); margin-top: -1px;',
                        });
                        barBox.add_child(dotWidget);
                    }

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
                        isToday: (i === 0),
                        data: dayData,
                        icon: dIcon,
                        leftLab,
                        barFill,
                        dotWidget,
                        rightLab,
                    });
                }

                contentBox.add_child(dailyCardBox);
            }

            // ──────────────────────────────────────────────────────────────────
            // 4. CARD: 2×3 WEATHER DETAILS GRID
            // ──────────────────────────────────────────────────────────────────
            const dt = t.details;
            const detailsContainer = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: 'spacing: 8px; margin: 4px 0;',
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
                    style: 'font-size: 17px; font-weight: 500;',
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

            // Row 1: Sunrise & Sunset | Moon Phase
            const row1 = new St.BoxLayout({ x_expand: true, style: 'spacing: 8px;' });
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

            row1.add_child(makeTile(dt.sunriseSunset, `${dt.sunrise}: ${sunriseStr}`, `${dt.sunset}: ${sunsetStr}`));
            row1.add_child(makeTile(dt.moon, moon.nameTrans, dt.moonIllum.replace('{n}', Math.round(moon.illum * 100))));
            detailsContainer.add_child(row1);

            // Row 2: Feels Like | Visibility
            const row2 = new St.BoxLayout({ x_expand: true, style: 'spacing: 8px;' });
            const feelsVal = current.feels !== undefined ? `${Math.round(current.feels)}°` : `${Math.round(current.temp)}°`;
            const feelsDiff = Math.round(current.feels - current.temp);
            const feelsSub = feelsDiff < -1 ? dt.feelsCooler : feelsDiff > 1 ? dt.feelsWarmer : dt.feelsSimilar;

            const visKm = current.visibility !== null ? Math.round(current.visibility / 1000) : 10;
            const visSub = visKm >= 10 ? dt.cleanAir : dt.haze;

            row2.add_child(makeTile(dt.feelsLike, feelsVal, feelsSub));
            row2.add_child(makeTile(dt.visibility, `${visKm} ${dt.km}`, visSub));
            detailsContainer.add_child(row2);

            // Row 3: Humidity | Pressure
            const row3 = new St.BoxLayout({ x_expand: true, style: 'spacing: 8px;' });
            const humVal = current.humidity !== undefined ? `${Math.round(current.humidity)}%` : '—';
            const dewPoint = current.humidity !== undefined ? Math.round(current.temp - ((100 - current.humidity) / 5)) : Math.round(current.temp - 4);
            const pressMm = current.pressure ? Math.round(current.pressure * 0.750062) : 750;

            row3.add_child(makeTile(dt.humidity, humVal, dt.dewPoint.replace('{n}', dewPoint)));
            row3.add_child(makeTile(dt.pressure, `${pressMm} ${dt.mm}`, dt.normal));
            detailsContainer.add_child(row3);

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
                    btn.style = 'padding: 3px 8px; border-radius: 6px; background-color: rgba(255, 255, 255, 0.25);';
                    btn.opacity = 255;
                } else {
                    btn.style = 'padding: 3px 8px; border-radius: 6px; background-color: rgba(255, 255, 255, 0.05);';
                    btn.opacity = 140;
                }
            }

            const daysCount = this._dailySlots.length;
            const titleTemplate = t.dailyTitle.replace('{n}', daysCount);
            const metricName = t.hourlyMetrics[this._hourlyMetric];

            if (this._hourlyTitleLabel) {
                this._hourlyTitleLabel.text = `${t.hourlyTitle}: ${metricName}`;
            }
            if (this._dailyTitleLabel) {
                this._dailyTitleLabel.text = `${titleTemplate}: ${metricName}`;
            }

            this._updateHourlyRow();
            this._updateDailyRows();
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
                } else if (this._hourlyMetric === 'wind') {
                    slot.icon.icon_name = 'weather-windy-symbolic';
                    const windSpeed = (hourly.wind && hourly.wind[dataIdx] !== undefined)
                        ? Math.round(hourly.wind[dataIdx])
                        : 0;
                    slot.val.text = `${windSpeed}`;
                } else {
                    const isDay = hourly.isDay ? hourly.isDay[dataIdx] : current.isDay;
                    const hScene = deriveScene({
                        code: hourly.code ? hourly.code[dataIdx] : current.code,
                        visibility: null,
                        cape: 0,
                        isDay,
                    });
                    slot.icon.icon_name = getSymbolicIcon(hScene.scene, isDay);
                    slot.val.text = `${Math.round(hourly.temp[dataIdx])}°`;
                }
            }
        }

        _updateDailyRows() {
            if (!this._dailySlots || this._dailySlots.length === 0) return;
            const BAR_WIDTH = 75;
            const currentTemp = this._weatherData?.current?.temp ?? 0;

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
                    slot.icon.icon_name = 'weather-showers-symbolic';
                    const prob = Math.round(d.precipProb ?? 0);
                    slot.leftLab.text = '';
                    const fillW = Math.max(0, Math.min(BAR_WIDTH, Math.round((prob / 100) * BAR_WIDTH)));
                    slot.barFill.style = `margin-left: 0px; width: ${fillW}px; height: 4px; background-color: #3898ec; border-radius: 2px;`;
                    if (slot.dotWidget) slot.dotWidget.hide();
                    slot.rightLab.text = `${prob}%`;
                } else if (this._hourlyMetric === 'wind') {
                    slot.icon.icon_name = 'weather-windy-symbolic';
                    const windVal = Math.round(d.windMax ?? 0);
                    slot.leftLab.text = '';
                    const fillW = Math.max(0, Math.min(BAR_WIDTH, Math.round((windVal / Math.max(1, maxWind)) * BAR_WIDTH)));
                    slot.barFill.style = `margin-left: 0px; width: ${fillW}px; height: 4px; background-color: #30b0c7; border-radius: 2px;`;
                    if (slot.dotWidget) slot.dotWidget.hide();
                    slot.rightLab.text = `${windVal}`;
                } else {
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

                    if (slot.dotWidget) {
                        const dotPos = Math.max(fillLeft, Math.min(fillRight - 4, Math.round(((currentTemp - globalMin) / rangeSpan) * BAR_WIDTH)));
                        slot.dotWidget.style = `margin-left: ${dotPos}px; width: 6px; height: 6px; border-radius: 3px; background-color: #ffffff; border: 1px solid rgba(0,0,0,0.6); margin-top: -1px;`;
                        slot.dotWidget.show();
                    }

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
