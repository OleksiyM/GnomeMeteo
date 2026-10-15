// weather.js — data layer for WeatherGlass.
// Ported from the WeatherGlass GNOME Shell extension: Open-Meteo forecasts +
// geocoding, WMO 4677 normalization, rolling-24h "today" windowing.
// Canonical units are always metric internally; only display code converts.

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import Gdk from 'gi://Gdk?version=4.0';
import Soup from 'gi://Soup?version=3.0';

export const OPEN_METEO_FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_GEOCODING_API = 'https://geocoding-api.open-meteo.com/v1/search';
export const USER_AGENT = 'dev.vijaybala.weatherglassapp/1.0 (standalone GJS app)';

// --- brand texture ------------------------------------------------------------
// Loads the generated app icon straight from the checkout's data/icons so
// the window icon and About logo ride a process-owned texture — immune to
// the shell session's icon-theme cache lagging a file install until logout.

const BRAND_ID = 'dev.vijaybala.weatherglassapp';

export function brandTexture(px = 128) {
    try {
        const env = GLib.getenv('WEATHERGLASS_DATADIR');
        const dir = env
            ? Gio.File.new_for_path(env).get_child('icons')
            : Gio.File.new_for_uri(import.meta.url).get_parent() // src/
                .get_parent().get_child('data').get_child('icons');
        const f = dir.get_child(`${BRAND_ID}-${px}.png`);
        return f.query_exists(null) ? Gdk.Texture.from_filename(f.get_path()) : null;
    } catch (e) {
        return null;
    }
}


export const FORECAST_DAYS = 8;
export const HTTP_TIMEOUT_SEC = 15;
export const NOW_BACKFILL_HOURS = 2;

// ---------------------------------------------------------------------------
// HTTP

let _session = null;
function session() {
    if (!_session) {
        _session = new Soup.Session();
        _session.timeout = HTTP_TIMEOUT_SEC;
        _session.user_agent = USER_AGENT;
    }
    return _session;
}

function httpGetJson(url) {
    return new Promise((resolve, reject) => {
        const msg = Soup.Message.new('GET', url);
        session().send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (_s, res) => {
            try {
                const bytes = session().send_and_read_finish(res);
                if (msg.get_status() !== 200 || bytes === null) {
                    reject(new Error(`HTTP ${msg.get_status()} for ${url.split('?')[0]}`));
                    return;
                }
                resolve(JSON.parse(new TextDecoder().decode(bytes.get_data())));
            } catch (e) {
                reject(e);
            }
        });
    });
}

// ---------------------------------------------------------------------------
// Forecast fetch + normalization (shape mirrors the extension's WeatherProvider)

export function forecastUrl(lat, lon, days = FORECAST_DAYS) {
    return [
        OPEN_METEO_FORECAST_API, '?latitude=', lat.toString(),
        '&longitude=', lon.toString(),
        '&current=', [
            'temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'is_day',
            'precipitation', 'weather_code', 'cloud_cover', 'pressure_msl',
            'wind_speed_10m', 'wind_direction_10m', 'uv_index', 'visibility', 'cape',
        ].join(','),
        '&hourly=', ['temperature_2m', 'precipitation_probability', 'wind_speed_10m',
            'weather_code', 'is_day'].join(','),
        '&daily=', [
            'weather_code', 'temperature_2m_max', 'temperature_2m_min',
            'precipitation_probability_max', 'sunrise', 'sunset', 'uv_index_max',
            'wind_speed_10m_max', 'precipitation_sum',
        ].join(','),
        '&timezone=auto&forecast_days=', days.toString(),
        '&temperature_unit=celsius&wind_speed_unit=kmh',
    ].join('');
}

export async function fetchForecast(lat, lon, days = FORECAST_DAYS) {
    const t0 = Date.now();
    const json = await httpGetJson(forecastUrl(lat, lon, days));
    if (!json.current || !json.hourly || !json.daily)
        throw new Error('malformed forecast payload');
    return normalize(json, t0);
}

function arr(a, i) {
    return Array.isArray(a) ? a[i] ?? null : null;
}

export function normalize(j, receivedWallMs = Date.now()) {
    const c = j.current;
    const h = j.hourly;
    const d = j.daily;
    const nDays = Math.min(d.time?.length ?? 0, FORECAST_DAYS);
    return {
        fetchedAtWallMs: receivedWallMs,
        // city clock offset: naive city wall time at fetch minus our wall clock
        cityClockOffsetMs: naiveMs(c.time) - receivedWallMs,
        current: {
            temp: c.temperature_2m,
            feels: c.apparent_temperature,
            code: c.weather_code | 0,
            isDay: !!c.is_day,
            humidity: c.relative_humidity_2m,
            precip: c.precipitation ?? 0,
            wind: c.wind_speed_10m,
            windDeg: c.wind_direction_10m,
            pressure: c.pressure_msl ?? null,
            uv: c.uv_index ?? null,
            visibility: c.visibility ?? null,
            cape: c.cape ?? null,
            timeIso: String(c.time ?? ''),
        },
        daily: Array.from({ length: nDays }, (_, i) => ({
            date: String(arr(d.time, i)),
            code: arr(d.weather_code, i) ?? 0,
            tmax: arr(d.temperature_2m_max, i),
            tmin: arr(d.temperature_2m_min, i),
            precipProb: arr(d.precipitation_probability_max, i),
            sunrise: String(arr(d.sunrise, i) ?? ''),
            sunset: String(arr(d.sunset, i) ?? ''),
            uv: arr(d.uv_index_max, i),
            windMax: arr(d.wind_speed_10m_max, i),
            precipSum: arr(d.precipitation_sum, i),
        })),
        hourly: {
            time: (h.time ?? []).map(String),
            temp: h.temperature_2m ?? [],
            precipProb: h.precipitation_probability ?? [],
            wind: h.wind_speed_10m ?? [],
            code: h.weather_code ?? [],
            isDay: h.is_day ?? [],
        },
    };
}

// ---------------------------------------------------------------------------
// Geocoding

export async function geocode(query) {
    const url = `${OPEN_METEO_GEOCODING_API}?name=${encodeURIComponent(query)}`
        + '&count=6&language=en&format=json';
    const json = await httpGetJson(url);
    return (json.results ?? []).map(r => ({
        name: r.name,
        admin1: r.admin1 ?? '',
        country: r.country ?? '',
        countryCode: r.country_code ?? '',
        latitude: r.latitude,
        longitude: r.longitude,
    }));
}

export function locationLabel(loc) {
    const bits = [];
    if (loc.admin1 && loc.admin1 !== loc.name) bits.push(loc.admin1);
    if (loc.country) bits.push(loc.country);
    return bits.join(', ');
}

// ---------------------------------------------------------------------------
// WMO 4677 → description + scene vocabulary
// scene ∈ sun moon partly cloud fog wind rain sleet snow hail storm

const W = (desc, scene) => ({ desc, scene });

export const WMO = {
    0: W('Clear sky', 'sun'),
    1: W('Mainly clear', 'sun'),
    2: W('Partly cloudy', 'partly'),
    3: W('Overcast', 'cloud'),
    45: W('Fog', 'fog'),
    48: W('Depositing rime fog', 'fog'),
    51: W('Light drizzle', 'rain'),
    53: W('Drizzle', 'rain'),
    55: W('Dense drizzle', 'rain'),
    56: W('Light freezing drizzle', 'sleet'),
    57: W('Dense freezing drizzle', 'sleet'),
    61: W('Light rain', 'rain'),
    63: W('Rain', 'rain'),
    65: W('Heavy rain', 'rain'),
    66: W('Light freezing rain', 'sleet'),
    67: W('Heavy freezing rain', 'sleet'),
    71: W('Light snow', 'snow'),
    73: W('Snow', 'snow'),
    75: W('Heavy snow', 'snow'),
    77: W('Snow grains', 'snow'),
    80: W('Light showers', 'rain'),
    81: W('Showers', 'rain'),
    82: W('Violent showers', 'rain'),
    85: W('Snow showers', 'snow'),
    86: W('Heavy snow showers', 'snow'),
    95: W('Thunderstorm', 'storm'),
    96: W('Thunderstorm with hail', 'hail'),
    99: W('Thunderstorm with heavy hail', 'hail'),
};

// Precipitation severity tiers (particle density for the painter).
const CODE_PRECIP_INTENSITY = {
    51: 1, 53: 2, 55: 3, 56: 3, 57: 4, 61: 1, 63: 2, 65: 3, 66: 3, 67: 4,
    71: 1, 73: 2, 75: 3, 77: 1, 80: 1, 81: 2, 82: 3, 85: 2, 86: 3, 95: 5, 96: 6, 99: 6,
};

export function wmoInfo(code) {
    return WMO[code] ?? { desc: 'Unknown', scene: 'cloud' };
}

export function sceneFor(code, isDay) {
    const { desc, scene } = wmoInfo(code);
    const night = !isDay;
    if (scene === 'sun' && night) return { desc, scene: 'moon', night: true };
    return { desc, scene, night };
}

// Open-Meteo rarely emits 45/48/95/96/99 — raw physics wins, as in the
// extension's deriveScene: CAPE + liquid precip imply storms/hail; poor
// visibility implies fog.
export function deriveScene(current) {
    const { code, cape, visibility, precip } = current;
    const liquid = code >= 51 && code <= 82 && ![56, 57, 66, 67].includes(code);
    if (code === 96 || code === 99 || ((cape ?? 0) >= 2500 && liquid))
        return { desc: 'Thunderstorm with hail', scene: 'hail', night: !current.isDay };
    if (code === 95 || ((cape ?? 0) >= 1200 && liquid))
        return { desc: 'Thunderstorm', scene: 'storm', night: !current.isDay };
    if ((visibility ?? Infinity) < 1000 && !(precip > 0))
        return { desc: 'Fog', scene: 'fog', night: !current.isDay };
    return sceneFor(code, current.isDay);
}

export function precipIntensity(code) {
    return CODE_PRECIP_INTENSITY[code] ?? 0;
}

// Calm scenes give way to the windy scene above this wind speed.
export const WINDY_THRESHOLD_KMH = 30;
const CALM_SCENES = new Set(['sun', 'moon', 'partly', 'cloud', 'fog']);

export function effectiveScene(current, windyKmh = WINDY_THRESHOLD_KMH) {
    const s = deriveScene(current);
    if (windyKmh > 0 && (current.wind ?? 0) >= windyKmh && CALM_SCENES.has(s.scene))
        return { ...s, scene: 'wind' };
    return s;
}

// ---------------------------------------------------------------------------
// Hourly windowing (daySlice): today = rolling 24 h from now with backfill,
// future days = exact calendar slices. All math uses the provider's own
// local date stamps so the viewer's timezone never tips a boundary.

function naiveMs(iso) {
    // 'YYYY-MM-DDTHH(:mm:ss)' → ms treating it as UTC, purely for comparisons.
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso || '');
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
}

export function cityWallMs(data, realNowMs = Date.now()) {
    return realNowMs + (data?.cityClockOffsetMs ?? 0);
}

function sliceFrom(hourly, idxs) {
    const pick = a => idxs.map(i => a[i] ?? null);
    return {
        time: pick(hourly.time),
        temp: pick(hourly.temp),
        precipProb: pick(hourly.precipProb),
        wind: pick(hourly.wind),
        code: pick(hourly.code),
        isDay: pick(hourly.isDay),
    };
}

// dayIndex 0 = today (rolling), 1..n = upcoming calendar days.
// `cityWallMs` must be city wall time (see cityWallMs()): reading it through
// the UTC getters below yields the city's naive clock stamp in any viewer TZ.
export function daySlice(hourly, daily, dayIndex, cityWall) {
    const times = hourly.time;
    let idxs = [];
    if (dayIndex === 0) {
        const nowNaive = naiveMs(wallNaiveStamp(cityWall));
        const back = nowNaive - NOW_BACKFILL_HOURS * 3600e3;
        const end = nowNaive + 23.5 * 3600e3;
        for (let i = 0; i < times.length; i++) {
            const t = naiveMs(times[i]);
            if (t >= back && t <= end) idxs.push(i);
        }
        if (idxs.length < 3 && times.length) idxs = [...Array(Math.min(times.length, 24))].map((_, i) => i);
    } else {
        const day = daily[Math.min(dayIndex, daily.length - 1)];
        for (let i = 0; i < times.length; i++)
            if (times[i].startsWith(day.date)) idxs.push(i);
    }
    const slice = sliceFrom(hourly, idxs);
    slice.dayIndex = dayIndex;
    slice.nowFrac = 0;
    if (dayIndex === 0 && idxs.length > 1) {
        const first = naiveMs(slice.time[0]);
        const last = naiveMs(slice.time[idxs.length - 1]);
        const now = naiveMs(wallNaiveStamp(cityWall));
        slice.nowFrac = last > first ? Math.min(1, Math.max(0, (now - first) / (last - first))) : 0;
    }
    return slice;
}

// hour stamp (naive, 'YYYY-MM-DDTHH:mm') for city-wall milliseconds —
// reading the number through UTC getters yields the city's local reading.
function wallNaiveStamp(cityWall) {
    const d = new Date(cityWall);
    const p = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// ---------------------------------------------------------------------------
// Formatting — display converts from canonical metric

export function fmtTemp(c, units) {
    if (c == null || Number.isNaN(c)) return '—';
    return `${Math.round(units === 'imperial' ? c * 9 / 5 + 32 : c)}°`;
}

export function fmtWind(kmh, units) {
    if (kmh == null) return '—';
    const v = units === 'imperial' ? kmh * 0.621371 : kmh;
    return `${Math.round(v)} ${units === 'imperial' ? 'mph' : 'km/h'}`;
}

export function fmtPressure(hpa, units) {
    if (hpa == null) return '—';
    return units === 'imperial'
        ? `${(hpa * 0.02953).toFixed(2)} inHg`
        : `${Math.round(hpa)} hPa`;
}

export function fmtVisibility(meters, units) {
    if (meters == null) return '—';
    return units === 'imperial'
        ? `${(meters / 1609.34).toFixed(1)} mi`
        : `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
}

export function fmtPrecipRate(mmPerH, units) {
    if (mmPerH == null) return '—';
    return units === 'imperial'
        ? `${(mmPerH / 25.4).toFixed(2)} in/h`
        : `${mmPerH.toFixed(1)} mm/h`;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

// Bearing the wind is blowing FROM, as a compass label.
export function compass(deg) {
    if (deg == null) return '';
    return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

export function uvBand(uv) {
    if (uv == null) return { label: '', key: 'muted' };
    if (uv < 3) return { label: 'Low', key: 'good' };
    if (uv < 6) return { label: 'Moderate', key: 'warn' };
    if (uv < 8) return { label: 'High', key: 'hot' };
    return { label: 'Very high', key: 'hot' };
}

export function fmtClock(naiveWallMs, h12) {
    const d = new Date(naiveWallMs);
    let h = d.getUTCHours();
    const mi = String(d.getUTCMinutes()).padStart(2, '0');
    if (!h12) return `${String(h).padStart(2, '0')}:${mi}`;
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${String(h).padStart(2, '0')}:${mi} ${ap}`;
}

export function fmtDayStamp(naiveWallMs) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = new Date(naiveWallMs);
    return `${days[d.getUTCDay()]}, ${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// ISO 'YYYY-MM-DDTHH:mm' → display per 12/24 h preference (naive, city-local)
export function fmtLocalIso(iso, h12) {
    if (!iso) return '—';
    return fmtClock(naiveMs(iso), h12);
}

export function shortHourLabel(iso, h12) {
    // 'HH:00' or '3a' style, compact enough for chart axes.
    const m = /[T ](\d{2}):/.exec(iso || '');
    if (!m) return '';
    let h = +m[1];
    if (!h12) return `${String(h).padStart(2, '0')}`;
    const ap = h >= 12 ? 'p' : 'a';
    h = h % 12 || 12;
    return `${h}${ap}`;
}

export function dayName(dateIso) {
    const t = naiveMs(dateIso);
    if (Number.isNaN(t)) return '';
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(t).getUTCDay()];
}

// ---------------------------------------------------------------------------
// Sun almanac (ported from the extension's weather.js): low-precision NOAA
// — Julian century → equation of time → declination → hour angle at zenith
// 90.833°. Gives every provider one continuous solar path. Feed it CITY WALL
// time so the "civil timeline" lines up with the city's clock.

export function sunGeometry(lat, lon, ms) {
    const rad = Math.PI / 180;
    const jd = ms / 86400000 + 2440587.5;
    const T = (jd - 2451545.0) / 36525.0;
    const L0 = 280.46646 + T * (36000.76983 + 0.0003032 * T);
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001250 * T);
    const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.00000014 * T)) +
        Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) +
        Math.sin(3 * M * rad) * 0.000289;
    const omega = 125.04 - 1934.136 * T;
    const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad);
    const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 +
        0.00256 * Math.cos(omega * rad);
    const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
    const varY = Math.tan((eps * rad) / 2) ** 2;
    const eqTime = 4 * (180 / Math.PI) * (
        varY * Math.sin(2 * L0 * rad) -
        2 * e * Math.sin(M * rad) +
        4 * e * varY * Math.sin(M * rad) * Math.cos(2 * L0 * rad) -
        0.5 * varY * varY * Math.sin(4 * L0 * rad) -
        1.25 * e * e * Math.sin(2 * M * rad));                 // minutes
    const dayStart = Math.floor(ms / 86400000) * 86400000;
    const solarNoonMin = 720 - 4 * lon - eqTime;               // UTC minutes
    const cosH = Math.cos(90.833 * rad) / Math.cos(lat * rad) -
        Math.tan(lat * rad) * Math.tan(decl);
    let sunrise = null;
    let sunset = null;
    if (Math.abs(cosH) <= 1) {
        const ha = Math.acos(cosH) / rad;                      // degrees
        sunrise = dayStart + (solarNoonMin - 4 * ha) * 60000;
        sunset = dayStart + (solarNoonMin + 4 * ha) * 60000;
    }
    const solarTimeMin = (ms - dayStart) / 60000 + eqTime + 4 * lon;
    const hourAngle = (solarTimeMin / 4 - 180) * rad;          // cos is 360-deg periodic
    const altitude = Math.asin(Math.sin(lat * rad) * Math.sin(decl) +
        Math.cos(lat * rad) * Math.cos(decl) * Math.cos(hourAngle)) / rad;
    return {altitude, sunrise, sunset};
}

/** Live sun shading (menu.js `_sunShade` port): altitude from the almanac →
 * glow peaks at the horizon crossing (±12° smoothstep), solar is the 0..1
 * climb from sunrise through noon. Computed at paint time, cached per
 * minute. `wallMs` must be CITY WALL time. */
const _shadeCache = new Map(); // key -> {minute, glow, solar}
export function sunShade(key, lat, lon, wallMs) {
    const minute = Math.floor(wallMs / 60000);
    const hit = _shadeCache.get(key);
    if (hit && hit.minute === minute)
        return { glow: hit.glow, solar: hit.solar };
    const sun = sunGeometry(lat, lon, minute * 60000);
    let glow = 0;
    let solar = null;
    if (sun.altitude > -12 && sun.altitude < 12) {
        const near = 1 - Math.abs(sun.altitude) / 12; // ±12 deg golden band
        glow = near * near * (3 - 2 * near);
    }
    if (sun.sunrise !== null && sun.altitude > 0) {
        const f = (minute * 60000 - sun.sunrise) / (sun.sunset - sun.sunrise);
        solar = Math.sin(Math.PI * Math.min(1, Math.max(0, f)));
    }
    _shadeCache.set(key, { minute, glow, solar });
    return { glow, solar };
}

// ---------------------------------------------------------------------------
// Moon phase (synodic model, as in the extension's moon.js)

export const SYNODIC_MONTH_DAYS = 29.530588853;
export const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14);

export function moonPhase(dateMs = Date.now()) {
    let f = (((dateMs - NEW_MOON_EPOCH) / 86400000) % SYNODIC_MONTH_DAYS) / SYNODIC_MONTH_DAYS;
    if (f < 0) f += 1;
    const illum = (1 - Math.cos(2 * Math.PI * f)) / 2;
    let name;
    if (f < 0.03 || f > 0.97) name = 'New moon';
    else if (f < 0.22) name = 'Waxing crescent';
    else if (f < 0.28) name = 'First quarter';
    else if (f < 0.47) name = 'Waxing gibbous';
    else if (f < 0.53) name = 'Full moon';
    else if (f < 0.72) name = 'Waning gibbous';
    else if (f < 0.78) name = 'Last quarter';
    else name = 'Waning crescent';
    return { phase: f, illum, name };
}

// ---------------------------------------------------------------------------
// Misc helpers shared across UI

export function relTime(fromWallMs, nowMs = Date.now()) {
    const mins = Math.max(0, Math.round((nowMs - fromWallMs) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const h = Math.floor(mins / 60);
    return h === 1 ? '1 hour ago' : `${h} hours ago`;
}

export function sleepSeconds(sec) {
    return new Promise(resolve => {
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, Math.max(1, Math.round(sec)), () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

// Module-mode replacements for the legacy script globals log/print/logError.
export function logw(msg) {
    printerr(`WeatherGlass: ${msg}`);
}

export function logerr(e, label = 'error') {
    const msg = e?.message ?? e;
    printerr(`WeatherGlass: ${label}: ${e?.name}: ${msg}\n${e?.stack ?? ''}`);
}

// Minimal event bus (pages subscribe filtered by city id).
export class Bus {
    #handlers = new Map();

    on(event, fn) {
        if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
        this.#handlers.get(event).add(fn);
        return () => this.off(event, fn);
    }

    off(event, fn) {
        this.#handlers.get(event)?.delete(fn);
    }

    emit(event, ...args) {
        for (const fn of this.#handlers.get(event) ?? []) {
            try {
                fn(...args);
            } catch (e) {
                logerr(e, `bus handler for "${event}"`);
            }
        }
    }
}
