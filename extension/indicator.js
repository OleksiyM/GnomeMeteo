// Meteo Indicator (Clean GNOME Adwaita-inspired card layout, full i18n, accurate hourly clock times)

import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Sibling modules are imported with the same cache-busting query as this file
// (`indicator.js?t=...`), so disable/enable reloads them too (GJS caches by full URL).
const reloadStamp = import.meta.url.includes('?') ? `?${import.meta.url.split('?')[1]}` : '';
const { WeatherClient, deriveScene, ensureDesktopEntry, removeDesktopEntry } =
    await import(`./weather.js${reloadStamp}`);
const { moonPhase } = await import(`./moon.js${reloadStamp}`);
const { tempToHex, precipBarColors, windBarColors } = await import(`./thermal.js${reloadStamp}`);

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
        dailyTitle: 'ПРОГНОЗ НА {n} ДНІВ',
        windUnit: 'км/год',
        windUnitImperial: 'миль/год',
        precipUnit: 'мм',
        precipUnitImperial: 'in',
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
            daylight: 'День: {h} год {m} хв',
            moon: 'ФАЗА МІСЯЦЯ',
            moonIllum: '{n}% освітленості',
            humidity: 'ВОЛОГІСТЬ',
            dewPoint: 'Точка роси: {n}°',
            pressure: 'ТИСК',
            mm: 'мм рт. ст.',
            inHg: 'inHg',
            wind: 'ВІТЕР',
            uv: 'УФ-ІНДЕКС',
            uvClearSky: 'ясне небо',
            uvLevels: ['Низький', 'Помірний', 'Високий', 'Дуже високий', 'Екстремальний'],
            visibility: 'ВИДИМІСТЬ',
            km: 'км',
            mi: 'миль',
            compass: ['Пн', 'ПнСх', 'Сх', 'ПдСх', 'Пд', 'ПдЗх', 'Зх', 'ПнЗх'],
            low: 'Низький',
            normal: 'Нормальний',
            high: 'Високий',
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
        dailyTitle: 'ПРОГНОЗ НА {n} ДНЕЙ',
        windUnit: 'км/ч',
        windUnitImperial: 'миль/ч',
        precipUnit: 'мм',
        precipUnitImperial: 'in',
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
            daylight: 'День: {h} ч {m} мин',
            moon: 'ФАЗА ЛУНЫ',
            moonIllum: '{n}% освещённости',
            humidity: 'ВЛАЖНОСТЬ',
            dewPoint: 'Точка росы: {n}°',
            pressure: 'ДАВЛЕНИЕ',
            mm: 'мм рт. ст.',
            inHg: 'inHg',
            wind: 'ВЕТЕР',
            uv: 'УФ-ИНДЕКС',
            uvClearSky: 'ясное небо',
            uvLevels: ['Низкий', 'Умеренный', 'Высокий', 'Очень высокий', 'Экстремальный'],
            visibility: 'ВИДИМОСТЬ',
            km: 'км',
            mi: 'миль',
            compass: ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'],
            low: 'Низкое',
            normal: 'Нормальное',
            high: 'Высокое',
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
        dailyTitle: '{n}-DAY FORECAST',
        windUnit: 'km/h',
        windUnitImperial: 'mph',
        precipUnit: 'mm',
        precipUnitImperial: 'in',
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
            daylight: 'Daylight: {h}h {m}m',
            moon: 'MOON PHASE',
            moonIllum: '{n}% illumination',
            humidity: 'HUMIDITY',
            dewPoint: 'Dew point: {n}°',
            pressure: 'PRESSURE',
            mm: 'mmHg',
            inHg: 'inHg',
            wind: 'WIND',
            uv: 'UV INDEX',
            uvClearSky: 'clear sky',
            uvLevels: ['Low', 'Moderate', 'High', 'Very high', 'Extreme'],
            visibility: 'VISIBILITY',
            km: 'km',
            mi: 'mi',
            compass: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
            low: 'Low',
            normal: 'Normal',
            high: 'High',
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
    return 'en';
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

function formatClockTime(dateObj, is12h, compact12h = false) {
    const hours = dateObj.getHours();
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    if (is12h) {
        const period = hours >= 12 ? 'PM' : 'AM';
        const h12 = hours % 12 || 12;
        return compact12h ? `${h12}:${minutes}${period}` : `${h12}:${minutes} ${period}`;
    }
    return `${String(hours).padStart(2, '0')}:${minutes}`;
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
        const parts = String(dateStr).split('-').map(Number);
        if (parts.length === 3 && parts.every(Number.isFinite)) {
            const d = new Date(parts[0], parts[1] - 1, parts[2]);
            return t.days[d.getDay()];
        }
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

const isMissing = val => val === null || val === undefined || Number.isNaN(val);

function toDisplayTemp(celsius, isImperial) {
    if (isMissing(celsius)) return null;
    return Math.round(isImperial ? (celsius * 9 / 5 + 32) : celsius);
}

/** Temperature with degree sign, or an em dash when the provider gave no value. */
function fmtTemp(celsius, isImperial) {
    const val = toDisplayTemp(celsius, isImperial);
    return val === null ? '—' : `${val}°`;
}

function toDisplayWind(kmh, isImperial) {
    if (isMissing(kmh)) return null;
    return Math.round(isImperial ? (kmh * 0.621371) : kmh);
}

function toDisplayPressure(hPa, isImperial) {
    if (!hPa || Number.isNaN(hPa)) return '—';
    return isImperial
        ? (hPa * 0.029530).toFixed(1)
        : String(Math.round(hPa * 0.750062));
}

function getPressureLevel(hPa, dt) {
    if (!hPa || Number.isNaN(hPa)) return dt.normal;
    if (hPa < 1009) return dt.low;
    if (hPa > 1022) return dt.high;
    return dt.normal;
}

/** UV index -> index into `uvLevels` (WHO bands: <3, <6, <8, <11, 11+). */
function uvLevelIndex(uv) {
    return uv < 3 ? 0 : uv < 6 ? 1 : uv < 8 ? 2 : uv < 11 ? 3 : 4;
}

const WIND_ARROWS = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'];

/** Wind direction in degrees -> 8-point compass label. */
function compassLabel(deg, dt) {
    return dt.compass[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function compassArrowLabel(deg, dt) {
    const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
    return `${WIND_ARROWS[idx]} ${dt.compass[idx]}`;
}

function fmtPrecipSum(mm, isImperial, t) {
    if (isMissing(mm)) return null;
    if (isImperial) {
        const inches = mm / 25.4;
        if (inches < 0.01) return null;
        return `${inches >= 1 ? inches.toFixed(1) : inches.toFixed(2)} ${t.precipUnitImperial}`;
    }
    if (mm < 0.05) return null;
    const text = mm >= 10 ? String(Math.round(mm)) : mm.toFixed(1);
    return `${text} ${t.precipUnit}`;
}

function toDisplayVisibility(meters, isImperial, dt) {
    const val = isImperial ? meters / 1609.344 : meters / 1000;
    const text = val >= 10 ? String(Math.round(val)) : val.toFixed(1);
    return `${text} ${isImperial ? dt.mi : dt.km}`;
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

    async fetch() {
        if (this._busy) return;
        this._busy = true;
        if (this._onLoading) this._onLoading();

        try {
            this._client.providerId = this._settings.get_string('provider');
            this._client.model = this._settings.get_string('om-model');
            const isAuto = this._settings.get_boolean('auto-location');
            const lang = resolveLang(this._settings);
            const data = await this._client.fetch({
                auto: isAuto,
                latitude: this._settings.get_double('location-latitude'),
                longitude: this._settings.get_double('location-longitude'),
                days: 10,
                lang,
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
            this.fetch();
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
            super._init(0.0, 'GnomeMeteo');
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
                icon_name: 'weather-overcast-symbolic',
                style_class: 'system-status-icon',
                opacity: 170,
            });

            this._label = new St.Label({
                text: '…',
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

            if (this._settings.get_boolean('auto-location'))
                ensureDesktopEntry();

            this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
                if (key === 'show-icon' || key === 'show-temperature') {
                    this._updatePanelIndicator();
                } else if (key === 'hour-format' || key === 'units' || key === 'location-name') {
                    if (this._weatherData) {
                        const isAuto = settings.get_boolean('auto-location');
                        this._onWeatherReceived(this._weatherData, isAuto);
                    }
                } else if (key === 'language') {
                    if (settings.get_boolean('auto-location')) {
                        this._coordinator.fetch();
                    } else if (this._weatherData) {
                        this._onWeatherReceived(this._weatherData, false);
                    }
                } else if (key === 'refresh-minutes') {
                    this._coordinator.startTimer();
                } else if (key === 'auto-location') {
                    if (settings.get_boolean('auto-location')) ensureDesktopEntry();
                    else removeDesktopEntry();
                    this._coordinator.fetch();
                } else if (['temp-bar-style', 'show-current-temp-dot', 'show-zero-mark'].includes(key)) {
                    if (this._dailySlots.length > 0) {
                        this._updateDailyRows();
                    } else if (this._weatherData) {
                        const isAuto = settings.get_boolean('auto-location');
                        this._onWeatherReceived(this._weatherData, isAuto);
                    }
                } else if (['location-latitude', 'location-longitude', 'provider', 'om-model'].includes(key)) {
                    this._coordinator.fetch();
                }
            });

            this._menuOpenId = this.menu.connect('open-state-changed', (menu, open) => {
                if (!open) {
                    this._tooltipHelper.hide();
                } else if (this._coordinator.isStale()) {
                    this._coordinator.fetch();
                }
            });

            this._coordinator.fetch();
            this._coordinator.startTimer();
        }

        _assetGIcon(filename) {
            return Gio.FileIcon.new(this._ext.dir.get_child('assets').get_child(filename));
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

            const isImperial = this._settings.get_string('units') === 'imperial';
            this._icon.icon_name = iconName;
            this._icon.opacity = 255;
            this._label.text = fmtTemp(current.temp, isImperial);

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
            const isImperial = this._settings.get_string('units') === 'imperial';
            const dailyArr = Array.isArray(daily) ? daily : [];

            // ══════════════════════════════════════════════════════════════════
            // 1. PINNED HEADER
            // ══════════════════════════════════════════════════════════════════
            const headerItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
            const headerContainer = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
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
                this._coordinator.fetch();
            });

            const cityLabel = new St.Label({
                text: cityName,
                style: 'font-size: 18px; font-weight: 600; color: #ffffff; text-align: center;',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            cityLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

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
                Promise.resolve(this._ext.openPreferences()).catch(() => {});
            });

            topRow.add_child(refreshBtn);
            topRow.add_child(cityLabel);
            topRow.add_child(prefsBtn);
            headerContainer.add_child(topRow);

            const dispCurrentTemp = toDisplayTemp(current.temp, isImperial);
            const opticalPad = dispCurrentTemp === null
                ? ''
                : (dispCurrentTemp >= 0 ? 'padding-left: 14px;' : 'padding-right: 4px;');

            const tempLabel = new St.Label({
                text: fmtTemp(current.temp, isImperial),
                style: `font-size: 56px; font-weight: 300; color: #ffffff; text-align: center; margin-top: 0px; margin-bottom: 0px; ${opticalPad}`,
                x_align: Clutter.ActorAlign.CENTER,
            });
            headerContainer.add_child(tempLabel);

            const condRow = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 6px; margin-top: 1px;',
            });
            const condIcon = new St.Icon({
                icon_name: getSymbolicIcon(sceneInfo.scene, current.isDay),
                icon_size: 16,
                style_class: 'system-status-icon',
                style: 'color: rgba(255, 255, 255, 0.92);',
                y_align: Clutter.ActorAlign.CENTER,
            });
            const condText = t.wmo[current.code] || sceneInfo.desc || t.wmo[0];
            const condLabel = new St.Label({
                text: condText,
                style: 'font-size: 15px; font-weight: 600; color: #ffffff;',
                y_align: Clutter.ActorAlign.CENTER,
            });
            condLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            condRow.add_child(condIcon);
            condRow.add_child(condLabel);
            headerContainer.add_child(condRow);

            const metaParts = [];
            if (!isMissing(current.feels))
                metaParts.push(`${t.feelsLikeShort} ${fmtTemp(current.feels, isImperial)}`);
            if (dailyArr.length > 0 && !isMissing(dailyArr[0].tmax) && !isMissing(dailyArr[0].tmin)) {
                const todayMax = toDisplayTemp(dailyArr[0].tmax, isImperial);
                const todayMin = toDisplayTemp(dailyArr[0].tmin, isImperial);
                metaParts.push(`↑ ${todayMax}°  ↓ ${todayMin}°`);
            }
            if (metaParts.length > 0) {
                const metaLabel = new St.Label({
                    text: metaParts.join('  ·  '),
                    style: 'font-size: 12.5px; font-weight: 500; color: rgba(255, 255, 255, 0.68); text-align: center; margin-top: 5px;',
                    x_align: Clutter.ActorAlign.CENTER,
                });
                metaLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                headerContainer.add_child(metaLabel);
            }

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
                style: 'max-height: 580px; x-expand: true;',
            });

            const contentBox = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                style: 'spacing: 10px;',
            });

            // ──────────────────────────────────────────────────────────────────
            // 2. CARD: HOURLY FORECAST
            // ──────────────────────────────────────────────────────────────────
            if (hourly && Array.isArray(hourly.temp) && hourly.temp.length > 0) {
                const hourlyCardBox = new St.BoxLayout({
                    orientation: Clutter.Orientation.VERTICAL,
                    x_expand: true,
                    style: 'background-color: rgba(255, 255, 255, 0.07); border-radius: 14px; padding: 10px 12px;',
                });

                const hourlyHeaderRow = new St.BoxLayout({
                    x_expand: true,
                    style: 'margin-bottom: 12px; spacing: 6px;',
                    y_align: Clutter.ActorAlign.CENTER,
                });

                const windUnit = isImperial ? t.windUnitImperial : t.windUnit;
                const initialMetricTitle = (this._hourlyMetric === 'wind')
                    ? `${t.hourlyMetrics.wind} (${windUnit})`
                    : t.hourlyMetrics[this._hourlyMetric];

                this._hourlyTitleLabel = new St.Label({
                    text: initialMetricTitle,
                    style: 'font-size: 10.5px; font-weight: 700; color: rgba(255, 255, 255, 0.55); letter-spacing: 0.05em;',
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._hourlyTitleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                hourlyHeaderRow.add_child(this._hourlyTitleLabel);

                // Segmented Metric Switcher
                const switcherBox = new St.BoxLayout({
                    style: 'background-color: rgba(0, 0, 0, 0.24); border-radius: 8px; padding: 2px; spacing: 2px;',
                    y_align: Clutter.ActorAlign.CENTER,
                });

                const METRICS = [
                    { id: 'temp', gicon: this._assetGIcon('meteo-temperature-symbolic.svg'), tip: t.metricTips.temp },
                    { id: 'precip', icon: 'weather-showers-symbolic', tip: t.metricTips.precip },
                    { id: 'wind', icon: 'weather-windy-symbolic', tip: t.metricTips.wind },
                ];

                for (const m of METRICS) {
                    const iconProps = {
                        icon_size: 13,
                        style_class: 'system-status-icon',
                    };
                    if (m.gicon) iconProps.gicon = m.gicon;
                    else iconProps.icon_name = m.icon;

                    const btn = new St.Button({
                        child: new St.Icon(iconProps),
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

                // Compact Header Pager [< | >]
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
                        orientation: Clutter.Orientation.VERTICAL,
                        style: 'spacing: 6px; min-width: 50px;',
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

                    const dirLab = new St.Label({
                        text: '',
                        style: 'font-size: 11px; font-weight: 600; color: rgba(255, 255, 255, 0.75); height: 18px;',
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER,
                        visible: false,
                    });

                    const valLab = new St.Label({
                        text: '',
                        style: 'font-size: 13px; font-weight: 600; color: #ffffff;',
                        x_align: Clutter.ActorAlign.CENTER,
                    });

                    col.add_child(tLab);
                    col.add_child(hIcon);
                    col.add_child(dirLab);
                    col.add_child(valLab);
                    hourlyRow.add_child(col);

                    this._hourlySlots.push({ isNow: (i === 0), dataIdx, icon: hIcon, dirLab, val: valLab });
                }

                hScroll.set_child(hourlyRow);
                hourlyCardBox.add_child(hScroll);
                contentBox.add_child(hourlyCardBox);
            }

            // ──────────────────────────────────────────────────────────────────
            // 3. CARD: 7-DAY FORECAST (With unified section header & Today dot)
            // ──────────────────────────────────────────────────────────────────
            if (dailyArr.length > 0) {
                const dailyCardBox = new St.BoxLayout({
                    orientation: Clutter.Orientation.VERTICAL,
                    x_expand: true,
                    style: 'background-color: rgba(255, 255, 255, 0.07); border-radius: 14px; padding: 10px 12px; spacing: 4px;',
                });

                const daysCount = Math.min(7, dailyArr.length);

                const dailyHeaderRow = new St.BoxLayout({
                    orientation: Clutter.Orientation.HORIZONTAL,
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'spacing: 5px; margin-bottom: 4px;',
                });
                dailyHeaderRow.add_child(new St.Icon({
                    icon_name: 'x-office-calendar-symbolic',
                    icon_size: 11,
                    style_class: 'system-status-icon',
                    style: 'opacity: 0.6;',
                }));
                this._dailyTitleLabel = new St.Label({
                    text: t.dailyTitle.replace('{n}', String(daysCount)),
                    style: 'font-size: 10.5px; font-weight: 700; color: rgba(255, 255, 255, 0.55); letter-spacing: 0.05em;',
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                dailyHeaderRow.add_child(this._dailyTitleLabel);
                dailyCardBox.add_child(dailyHeaderRow);

                const BAR_WIDTH = 104;

                for (let i = 0; i < daysCount; i++) {
                    const dayData = dailyArr[i];
                    const dayRow = new St.BoxLayout({
                        x_expand: true,
                        style: 'spacing: 7px; padding: 2px 0;',
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

                    const leftLab = new St.Label({
                        text: '',
                        style: 'font-size: 13px; color: rgba(255, 255, 255, 0.55); text-align: right;',
                        x_expand: true,
                        x_align: Clutter.ActorAlign.END,
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    const barBox = new St.Widget({
                        style: `width: ${BAR_WIDTH}px; height: 11px;`,
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    const barTrack = new St.Widget({
                        style_class: 'meteo-range-track',
                        style: `margin-left: 0px; margin-top: 3px; width: ${BAR_WIDTH}px; height: 5px;`,
                    });
                    barBox.add_child(barTrack);

                    const barFill = new St.Widget({
                        style_class: 'meteo-range-fill',
                        style: 'margin-top: 3px; height: 5px;',
                    });
                    barBox.add_child(barFill);

                    let zeroHalo = null;
                    let zeroTick = null;
                    let dotHalo = null;
                    let dotCore = null;
                    if (i === 0) {
                        zeroHalo = new St.Widget({
                            style_class: 'meteo-zero-halo',
                            visible: false,
                        });
                        barBox.add_child(zeroHalo);

                        zeroTick = new St.Widget({
                            style_class: 'meteo-zero-tick',
                            visible: false,
                        });
                        barBox.add_child(zeroTick);

                        dotHalo = new St.Widget({
                            style_class: 'meteo-range-dot-halo',
                            visible: false,
                        });
                        barBox.add_child(dotHalo);

                        dotCore = new St.Widget({
                            style_class: 'meteo-range-dot',
                            visible: false,
                        });
                        barBox.add_child(dotCore);
                    }

                    const rightLab = new St.Label({
                        text: '',
                        style: 'font-size: 13px; font-weight: 600; color: #ffffff; min-width: 36px; text-align: right;',
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
                        barBox,
                        barTrack,
                        barFill,
                        zeroHalo,
                        zeroTick,
                        dotHalo,
                        dotCore,
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
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                style: 'spacing: 8px;',
            });

            const makeTile = (iconSpec, title, value, subtext, tooltipText = null, valFontSize = '15.5px') => {
                const minContentH = subtext ? 54 : 42;
                const tile = new St.BoxLayout({
                    orientation: Clutter.Orientation.VERTICAL,
                    x_expand: true,
                    y_expand: true,
                    reactive: !!tooltipText,
                    can_focus: false,
                    style: `background-color: rgba(255, 255, 255, 0.07); border-radius: 14px; padding: 11px 12px; min-height: ${minContentH}px;`,
                });

                const headRow = new St.BoxLayout({
                    orientation: Clutter.Orientation.HORIZONTAL,
                    x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'spacing: 5px;',
                });
                if (iconSpec) {
                    const iconProps = {
                        icon_size: 11,
                        style_class: 'system-status-icon',
                        style: 'opacity: 0.6;',
                    };
                    if (typeof iconSpec === 'string') iconProps.icon_name = iconSpec;
                    else iconProps.gicon = iconSpec;
                    headRow.add_child(new St.Icon(iconProps));
                }
                const tLab = new St.Label({
                    text: title,
                    style: 'font-size: 10px; font-weight: 700; color: rgba(255, 255, 255, 0.55); letter-spacing: 0.04em;',
                    y_align: Clutter.ActorAlign.CENTER,
                    x_expand: true,
                });
                tLab.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                headRow.add_child(tLab);
                tile.add_child(headRow);

                const vLab = new St.Label({
                    text: value,
                    style: `font-size: ${valFontSize}; font-weight: 600; color: #ffffff; margin: ${subtext ? '4px 0' : '4px 0 0 0'};`,
                    x_expand: true,
                    y_expand: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                vLab.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                tile.add_child(vLab);

                if (subtext) {
                    const sLab = new St.Label({
                        text: subtext,
                        style: 'font-size: 11.5px; color: rgba(255, 255, 255, 0.68);',
                        x_expand: true,
                    });
                    sLab.clutter_text.ellipsize = Pango.EllipsizeMode.END;
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

            let sunriseStr = '—';
            let sunsetStr = '—';
            let sunriseFullStr = '—';
            let sunsetFullStr = '—';
            let daylightSub = '';
            if (dailyArr[0] && dailyArr[0].sunrise && dailyArr[0].sunset) {
                try {
                    const sr = new Date(dailyArr[0].sunrise);
                    const ss = new Date(dailyArr[0].sunset);
                    sunriseStr = formatClockTime(sr, is12h, true);
                    sunsetStr = formatClockTime(ss, is12h, true);
                    sunriseFullStr = formatClockTime(sr, is12h, false);
                    sunsetFullStr = formatClockTime(ss, is12h, false);
                    const diffMin = Math.round((ss.getTime() - sr.getTime()) / 60000);
                    if (diffMin > 0 && diffMin < 1440) {
                        const dh = Math.floor(diffMin / 60);
                        const dm = diffMin % 60;
                        daylightSub = dt.daylight.replace('{h}', String(dh)).replace('{m}', String(dm).padStart(2, '0'));
                    }
                } catch { }
            }
            const sunValStr = is12h
                ? `↑${sunriseStr} · ↓${sunsetStr}`
                : `↑ ${sunriseStr}  ↓ ${sunsetStr}`;
            const sunTipStr = `↑ ${sunriseFullStr}  ↓ ${sunsetFullStr}${daylightSub ? ` · ${daylightSub}` : ''}`;
            const sunFontSize = is12h ? '12.5px' : '15px';
            const moon = getMoonInfo(lang);

            row1.add_child(makeTile('daytime-sunrise-symbolic', dt.sunriseSunset, sunValStr, daylightSub, sunTipStr, sunFontSize));
            row1.add_child(makeTile('weather-clear-night-symbolic', dt.moon, moon.nameTrans, dt.moonIllum.replace('{n}', Math.round(moon.illum * 100)), moon.nameTrans));
            detailsContainer.add_child(row1);

            // Optional tiles: a tile is added only when the provider supplied its data,
            // then all available tiles are laid out two per row (an odd one spans the full width).
            const windUnit = isImperial ? t.windUnitImperial : t.windUnit;
            const optionalTiles = [];
            if (!isMissing(current.humidity)) {
                const dewPointSub = !isMissing(current.temp)
                    ? dt.dewPoint.replace('{n}', toDisplayTemp(current.temp - ((100 - current.humidity) / 5), isImperial))
                    : '';
                optionalTiles.push(() => makeTile(this._assetGIcon('meteo-humidity-symbolic.svg'),
                    dt.humidity, `${Math.round(current.humidity)}%`, dewPointSub));
            }
            if (!isMissing(current.pressure) && current.pressure > 0) {
                const pressUnit = isImperial ? dt.inHg : dt.mm;
                optionalTiles.push(() => makeTile(this._assetGIcon('meteo-pressure-symbolic.svg'),
                    dt.pressure, toDisplayPressure(current.pressure, isImperial),
                    `${pressUnit} · ${getPressureLevel(current.pressure, dt)}`));
            }
            if (!isMissing(current.wind)) {
                const windSub = isMissing(current.windDeg) ? '' : compassLabel(current.windDeg, dt);
                optionalTiles.push(() => makeTile('weather-windy-symbolic',
                    dt.wind, `${toDisplayWind(current.wind, isImperial)} ${windUnit}`, windSub));
            }
            if (!isMissing(current.uv)) {
                const uvSub = dt.uvLevels[uvLevelIndex(current.uv)] +
                    (current.uvClearSky ? ` · ${dt.uvClearSky}` : '');
                optionalTiles.push(() => makeTile(this._assetGIcon('meteo-uv-symbolic.svg'),
                    dt.uv, current.uv.toFixed(1), uvSub));
            }
            if (!isMissing(current.visibility)) {
                optionalTiles.push(() => makeTile(this._assetGIcon('meteo-visibility-symbolic.svg'),
                    dt.visibility, toDisplayVisibility(current.visibility, isImperial, dt), ''));
            }
            for (let i = 0; i < optionalTiles.length; i += 2) {
                const row = new St.Widget({
                    layout_manager: new Clutter.BoxLayout({
                        orientation: Clutter.Orientation.HORIZONTAL,
                        homogeneous: true,
                        spacing: 8,
                    }),
                    x_expand: true,
                });
                for (const build of optionalTiles.slice(i, i + 2))
                    row.add_child(build());
                detailsContainer.add_child(row);
            }

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
            const isImperial = this._settings.get_string('units') === 'imperial';
            const lang = resolveLang(this._settings);
            const t = MESSAGES[lang] || MESSAGES.uk;
            const dt = t.details;

            for (const slot of this._hourlySlots) {
                const dataIdx = slot.dataIdx;
                if (dataIdx === undefined || dataIdx >= hourly.temp.length) continue;

                if (this._hourlyMetric === 'precip') {
                    const rawProb = hourly.precipProb ? hourly.precipProb[dataIdx] : null;
                    const prob = isMissing(rawProb) ? null : Math.round(rawProb);
                    const rawMm = hourly.precip ? hourly.precip[dataIdx] : null;
                    const hCode = slot.isNow
                        ? current.code
                        : (hourly.code ? hourly.code[dataIdx] : current.code);
                    const hScene = deriveScene({
                        code: hCode,
                        visibility: null,
                        cape: 0,
                        isDay: true,
                    });
                    const isDry = (prob === null || prob < 15) && (isMissing(rawMm) || rawMm < 0.1);

                    slot.dirLab?.hide();
                    slot.icon.show();
                    if (isDry) {
                        slot.icon.icon_name = null;
                        slot.icon.gicon = this._assetGIcon('meteo-humidity-symbolic.svg');
                        slot.icon.opacity = 95;
                    } else {
                        slot.icon.gicon = null;
                        if (hScene.scene === 'snow')
                            slot.icon.icon_name = 'weather-snow-symbolic';
                        else if (hScene.scene === 'storm' || hScene.scene === 'hail')
                            slot.icon.icon_name = 'weather-severe-alert-symbolic';
                        else
                            slot.icon.icon_name = 'weather-showers-symbolic';
                        slot.icon.opacity = 255;
                    }

                    slot.val.text = prob === null ? '—' : `${prob}%`;
                    slot.val.style = (prob === null || prob < 10)
                        ? 'font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.42);'
                        : 'font-size: 13px; font-weight: 600; color: #ffffff;';
                } else if (this._hourlyMetric === 'wind') {
                    const rawWindDeg = slot.isNow && !isMissing(current.windDeg)
                        ? current.windDeg
                        : (hourly.windDeg ? hourly.windDeg[dataIdx] : null);
                    if (!isMissing(rawWindDeg) && slot.dirLab) {
                        slot.icon.hide();
                        slot.dirLab.text = compassArrowLabel(rawWindDeg, dt);
                        slot.dirLab.show();
                    } else {
                        slot.dirLab?.hide();
                        slot.icon.gicon = null;
                        slot.icon.icon_name = 'weather-windy-symbolic';
                        slot.icon.opacity = 255;
                        slot.icon.show();
                    }

                    const rawWind = slot.isNow && !isMissing(current.wind)
                        ? current.wind
                        : (hourly.wind ? hourly.wind[dataIdx] : null);
                    const windSpeed = toDisplayWind(rawWind, isImperial);
                    slot.val.text = windSpeed === null ? '—' : `${windSpeed}`;
                    slot.val.style = 'font-size: 13px; font-weight: 600; color: #ffffff;';
                } else {
                    const isDay = slot.isNow
                        ? Boolean(current.isDay)
                        : (hourly.isDay ? hourly.isDay[dataIdx] : current.isDay);
                    const hScene = slot.isNow
                        ? deriveScene(current)
                        : deriveScene({
                            code: hourly.code ? hourly.code[dataIdx] : current.code,
                            visibility: null,
                            cape: 0,
                            isDay,
                        });
                    const rawTemp = slot.isNow && !isMissing(current.temp)
                        ? current.temp
                        : hourly.temp[dataIdx];
                    slot.dirLab?.hide();
                    slot.icon.gicon = null;
                    slot.icon.opacity = 255;
                    slot.icon.icon_name = getSymbolicIcon(hScene.scene, isDay);
                    slot.icon.show();
                    slot.val.text = fmtTemp(rawTemp, isImperial);
                    slot.val.style = 'font-size: 13px; font-weight: 600; color: #ffffff;';
                }
            }
        }

        _updateDailyRows() {
            if (!this._dailySlots || this._dailySlots.length === 0) return;
            const isImperial = this._settings.get_string('units') === 'imperial';
            const barStyle = this._settings.get_string('temp-bar-style');
            const showDot = this._settings.get_boolean('show-current-temp-dot');
            const showZero = this._settings.get_boolean('show-zero-mark');
            const currentTemp = this._weatherData?.current?.temp;
            const lang = resolveLang(this._settings);
            const t = MESSAGES[lang] || MESSAGES.uk;
            const dt = t.details;

            let globalMin = Infinity;
            let globalMax = -Infinity;
            let maxWind = 1;
            let maxPrecipSum = 1;
            for (const slot of this._dailySlots) {
                const d = slot.data;
                const dMin = toDisplayTemp(d.tmin, isImperial);
                const dMax = toDisplayTemp(d.tmax, isImperial);
                if (dMin !== null) {
                    if (dMin < globalMin) globalMin = dMin;
                    if (dMin > globalMax) globalMax = dMin;
                }
                if (dMax !== null) {
                    if (dMax < globalMin) globalMin = dMax;
                    if (dMax > globalMax) globalMax = dMax;
                }
                if ((d.windMax ?? 0) > maxWind) maxWind = d.windMax;
                if (!isMissing(d.precipSum) && d.precipSum > maxPrecipSum) maxPrecipSum = d.precipSum;
            }
            const rawSpan = globalMax - globalMin;
            const rangeSpan = Number.isFinite(rawSpan) ? Math.max(1, rawSpan) : 1;
            const BAR_WIDTH = 104;

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

                if (this._hourlyMetric === 'precip') {
                    const hasProb = !isMissing(d.precipProb);
                    const prob = hasProb ? Math.round(d.precipProb) : 0;
                    const sumStr = fmtPrecipSum(d.precipSum, isImperial, t);
                    slot.leftLab.show();
                    slot.leftLab.text = sumStr ?? '—';
                    slot.leftLab.style = sumStr
                        ? 'font-size: 12px; font-weight: 500; color: rgba(255, 255, 255, 0.62); text-align: right;'
                        : 'font-size: 12px; font-weight: 500; color: rgba(255, 255, 255, 0.28); text-align: right;';

                    const precipRatio = hasProb
                        ? (prob < 5 ? 0 : prob / 100)
                        : (!isMissing(d.precipSum) && d.precipSum >= 0.05 ? d.precipSum / maxPrecipSum : 0);
                    const fillW = precipRatio <= 0
                        ? 0
                        : Math.max(4, Math.min(BAR_WIDTH, Math.round(precipRatio * BAR_WIDTH)));
                    if (fillW > 0) {
                        const colors = precipBarColors(hasProb ? prob : Math.round(precipRatio * 100), barStyle);
                        slot.barFill.show();
                        slot.barFill.style = `margin-left: 0px; margin-top: 3px; width: ${fillW}px; height: 5px; background-gradient-direction: horizontal; background-gradient-start: ${colors.start}; background-gradient-end: ${colors.end}; border-radius: 3px;`;
                    } else {
                        slot.barFill.hide();
                    }
                    slot.zeroHalo?.hide();
                    slot.zeroTick?.hide();
                    slot.dotHalo?.hide();
                    slot.dotCore?.hide();

                    if (hasProb) {
                        slot.rightLab.text = `${prob}%`;
                        slot.rightLab.style = prob < 10
                            ? 'font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.42); min-width: 36px; text-align: right;'
                            : 'font-size: 13px; font-weight: 600; color: #ffffff; min-width: 36px; text-align: right;';
                    } else {
                        slot.rightLab.text = '—';
                        slot.rightLab.style = 'font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.42); min-width: 36px; text-align: right;';
                    }
                } else if (this._hourlyMetric === 'wind') {
                    const windVal = toDisplayWind(d.windMax, isImperial);
                    const maxDisplayWind = toDisplayWind(maxWind, isImperial);
                    const fillW = windVal === null ? 0
                        : Math.max(4, Math.min(BAR_WIDTH, Math.round((windVal / Math.max(1, maxDisplayWind)) * BAR_WIDTH)));
                    const dirText = isMissing(d.windDeg) ? '—' : compassLabel(d.windDeg, dt);

                    slot.leftLab.show();
                    slot.leftLab.text = dirText;
                    slot.leftLab.style = isMissing(d.windDeg)
                        ? 'font-size: 12px; font-weight: 500; color: rgba(255, 255, 255, 0.35); text-align: right;'
                        : 'font-size: 12px; font-weight: 500; color: rgba(255, 255, 255, 0.62); text-align: right;';

                    if (fillW > 0) {
                        const colors = windBarColors(d.windMax ?? 0, barStyle);
                        slot.barFill.show();
                        slot.barFill.style = `margin-left: 0px; margin-top: 3px; width: ${fillW}px; height: 5px; background-gradient-direction: horizontal; background-gradient-start: ${colors.start}; background-gradient-end: ${colors.end}; border-radius: 3px;`;
                    } else {
                        slot.barFill.hide();
                    }
                    slot.zeroHalo?.hide();
                    slot.zeroTick?.hide();
                    slot.dotHalo?.hide();
                    slot.dotCore?.hide();

                    slot.rightLab.text = windVal === null ? '—' : `${windVal}`;
                    slot.rightLab.style = 'font-size: 13px; font-weight: 600; color: #ffffff; min-width: 36px; text-align: right;';
                } else {
                    const dispMin = toDisplayTemp(d.tmin, isImperial);
                    const dispMax = toDisplayTemp(d.tmax, isImperial);
                    slot.leftLab.show();
                    slot.leftLab.text = dispMin === null ? '—' : `${dispMin}°`;
                    slot.leftLab.style = 'font-size: 13px; font-weight: 500; color: rgba(255, 255, 255, 0.6); text-align: right; opacity: 1;';

                    const hasRange = dispMin !== null && dispMax !== null;
                    const low = hasRange ? Math.min(dispMin, dispMax) : 0;
                    const high = hasRange ? Math.max(dispMin, dispMax) : 0;
                    const fillLeft = hasRange ? Math.max(0, Math.min(BAR_WIDTH - 8, Math.round(((low - globalMin) / rangeSpan) * BAR_WIDTH))) : 0;
                    const fillRight = hasRange ? Math.max(fillLeft + 8, Math.min(BAR_WIDTH, Math.round(((high - globalMin) / rangeSpan) * BAR_WIDTH))) : 0;
                    const fillWidth = Math.max(8, fillRight - fillLeft);

                    if (hasRange) {
                        const startC = isImperial ? (low - 32) * 5 / 9 : low;
                        const endC = isImperial ? (high - 32) * 5 / 9 : high;
                        const startHex = tempToHex(startC, barStyle);
                        const endHex = tempToHex(endC, barStyle);
                        slot.barFill.style = `margin-left: ${fillLeft}px; margin-top: 3px; width: ${fillWidth}px; height: 5px; background-gradient-direction: horizontal; background-gradient-start: ${startHex}; background-gradient-end: ${endHex}; border-radius: 3px;`;
                        slot.barFill.show();
                    } else {
                        slot.barFill.hide();
                    }

                    const freezeTemp = isImperial ? 32 : 0;
                    let todayZeroX = null;
                    if (slot.isToday && slot.zeroHalo && slot.zeroTick) {
                        const todayIncludesZero = hasRange && low <= freezeTemp && high >= freezeTemp;
                        if (showZero && todayIncludesZero) {
                            const daySpan = high - low;
                            const zeroRatio = daySpan > 0
                                ? Math.max(0, Math.min(1, (freezeTemp - low) / daySpan))
                                : 0.5;
                            todayZeroX = Math.max(1, Math.min(BAR_WIDTH - 2,
                                Math.round(fillLeft + zeroRatio * (fillWidth - 1))));
                            slot.zeroHalo.style = `margin-left: ${todayZeroX - 1}px; margin-top: 0px; width: 3px; height: 11px;`;
                            slot.zeroTick.style = `margin-left: ${todayZeroX}px; margin-top: 0px; width: 1px; height: 11px;`;
                            slot.zeroHalo.show();
                            slot.zeroTick.show();
                        } else {
                            slot.zeroHalo.hide();
                            slot.zeroTick.hide();
                        }
                    }

                    if (slot.isToday && slot.dotHalo && slot.dotCore) {
                        const dispCurrent = toDisplayTemp(currentTemp, isImperial);
                        if (showDot && hasRange && dispCurrent !== null) {
                            const daySpan = high - low;
                            const ratio = daySpan > 0
                                ? Math.max(0, Math.min(1, (dispCurrent - low) / daySpan))
                                : 0.5;
                            const minCenter = Math.max(4, fillLeft + 2);
                            const maxCenter = Math.min(BAR_WIDTH - 5, fillLeft + fillWidth - 3);
                            let dotCenterX = maxCenter >= minCenter
                                ? Math.round(minCenter + ratio * (maxCenter - minCenter))
                                : Math.round(fillLeft + fillWidth / 2);

                            if (todayZeroX !== null && Math.abs(dotCenterX - todayZeroX) < 4) {
                                const nudged = currentTemp >= 0
                                    ? Math.max(dotCenterX, todayZeroX + 4)
                                    : Math.min(dotCenterX, todayZeroX - 4);
                                const safeMin = Math.max(4, fillLeft);
                                const safeMax = Math.min(BAR_WIDTH - 5, fillLeft + fillWidth);
                                dotCenterX = Math.max(safeMin, Math.min(safeMax, nudged));
                            }

                            slot.dotHalo.style = `margin-left: ${dotCenterX - 4}px; margin-top: 1px; width: 9px; height: 9px;`;
                            slot.dotCore.style = `margin-left: ${dotCenterX - 2}px; margin-top: 3px; width: 5px; height: 5px;`;
                            slot.dotHalo.show();
                            slot.dotCore.show();
                        } else {
                            slot.dotHalo.hide();
                            slot.dotCore.hide();
                        }
                    }

                    slot.rightLab.text = dispMax === null ? '—' : `${dispMax}°`;
                    slot.rightLab.style = 'font-size: 13px; font-weight: 600; color: #ffffff; min-width: 36px; text-align: right;';
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
