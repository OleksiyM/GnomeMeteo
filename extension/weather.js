/* weather.js -- Multi-provider weather client (Open-Meteo, MET Norway, NOAA NWS) + WMO code mapping */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

const OPEN_METEO_FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODING_API = 'https://geocoding-api.open-meteo.com/v1/search';
const IPINFO_API = 'https://ipinfo.io/json';
const IPAPI_API = 'https://ipapi.co/json/';
const REVERSE_GEOCODE_API = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const MET_NORWAY_API = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';
const NOAA_NWS_API = 'https://api.weather.gov';

/* -- WMO 4677 weather codes -> description + scene ------------------------- */

export const WMO = {
    0:  {desc: 'Clear sky',            day: 'sun',    night: 'moon'},
    1:  {desc: 'Mainly clear',         day: 'sun',    night: 'moon'},
    2:  {desc: 'Partly cloudy',        day: 'partly', night: 'partly'},
    3:  {desc: 'Overcast',             day: 'cloud',  night: 'cloud'},
    45: {desc: 'Fog',                  day: 'fog',    night: 'fog'},
    48: {desc: 'Rime fog',             day: 'fog',    night: 'fog'},
    51: {desc: 'Light drizzle',        day: 'rain',   night: 'rain'},
    53: {desc: 'Drizzle',              day: 'rain',   night: 'rain'},
    55: {desc: 'Dense drizzle',        day: 'rain',   night: 'rain'},
    56: {desc: 'Freezing drizzle',     day: 'sleet',  night: 'sleet'},
    57: {desc: 'Freezing drizzle',     day: 'sleet',  night: 'sleet'},
    61: {desc: 'Light rain',           day: 'rain',   night: 'rain'},
    63: {desc: 'Rain',                 day: 'rain',   night: 'rain'},
    65: {desc: 'Heavy rain',           day: 'rain',   night: 'rain'},
    66: {desc: 'Freezing rain',        day: 'sleet',  night: 'sleet'},
    67: {desc: 'Freezing rain',        day: 'sleet',  night: 'sleet'},
    71: {desc: 'Light snow',           day: 'snow',   night: 'snow'},
    73: {desc: 'Snow',                 day: 'snow',   night: 'snow'},
    75: {desc: 'Heavy snow',           day: 'snow',   night: 'snow'},
    77: {desc: 'Snow grains',          day: 'snow',   night: 'snow'},
    80: {desc: 'Light showers',        day: 'rain',   night: 'rain'},
    81: {desc: 'Showers',              day: 'rain',   night: 'rain'},
    82: {desc: 'Violent showers',      day: 'rain',   night: 'rain'},
    85: {desc: 'Snow showers',         day: 'snow',   night: 'snow'},
    86: {desc: 'Heavy snow showers',   day: 'snow',   night: 'snow'},
    95: {desc: 'Thunderstorm',         day: 'storm',  night: 'storm'},
    96: {desc: 'Thunderstorm, hail',   day: 'hail',   night: 'hail'},
    99: {desc: 'Thunderstorm, hail',   day: 'hail',   night: 'hail'},
};

function sceneFor(code, isDay = true) {
    const entry = WMO[code] ?? {desc: 'Unknown', day: 'cloud', night: 'cloud'};
    return {
        scene: isDay ? entry.day : entry.night,
        desc: entry.desc,
    };
}

/**
 * Pick the weather scene from WMO code plus physical variables (visibility, CAPE).
 */
export function deriveScene(current) {
    const {code, visibility, cape, isDay} = current;
    const isLiquidPrecip = code >= 51 && code <= 82;
    if (code === 96 || code === 99 || (cape >= 2500 && isLiquidPrecip))
        return {scene: 'hail', desc: 'Thunderstorm, hail'};
    if (code === 95 || (cape >= 1200 && isLiquidPrecip))
        return {scene: 'storm', desc: 'Thunderstorm'};
    if (code === 45 || code === 48)
        return sceneFor(code, isDay);
    if (visibility !== null && visibility !== undefined && visibility < 1000 && !isLiquidPrecip)
        return {scene: 'fog', desc: 'Fog'};
    return sceneFor(code, isDay);
}

/**
 * NOAA solar almanac: computes sun altitude (deg) and sunrise/sunset epochs (ms)
 * for any coordinates and timestamp. Used as fallback when a provider (MET Norway,
 * NOAA NWS) does not include sunrise/sunset timestamps in its forecast payload.
 */
export function sunGeometry(lat, lon, ms = Date.now()) {
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
    const varY = Math.tan(eps * rad / 2) ** 2;
    const eqTime = 4 * (180 / Math.PI) * (
        varY * Math.sin(2 * L0 * rad) -
        2 * e * Math.sin(M * rad) +
        4 * e * varY * Math.sin(M * rad) * Math.cos(2 * L0 * rad) -
        0.5 * varY * varY * Math.sin(4 * L0 * rad) -
        1.25 * e * e * Math.sin(2 * M * rad));
    const dayStart = Math.floor(ms / 86400000) * 86400000;
    const solarNoonMin = 720 - 4 * lon - eqTime;
    const cosH = Math.cos(90.833 * rad) / Math.cos(lat * rad) -
        Math.tan(lat * rad) * Math.tan(decl);
    let sunrise = null;
    let sunset = null;
    if (Math.abs(cosH) <= 1) {
        const ha = Math.acos(cosH) / rad;
        sunrise = dayStart + (solarNoonMin - 4 * ha) * 60000;
        sunset = dayStart + (solarNoonMin + 4 * ha) * 60000;
    }
    const solarTimeMin = (ms - dayStart) / 60000 + eqTime + 4 * lon;
    const hourAngle = (solarTimeMin / 4 - 180) * rad;
    const altitude = Math.asin(Math.sin(lat * rad) * Math.sin(decl) +
        Math.cos(lat * rad) * Math.cos(decl) * Math.cos(hourAngle)) / rad;
    return {altitude, sunrise, sunset};
}

/* -- HTTP ------------------------------------------------------------------ */

function buildQueryString(params) {
    return Object.entries(params)
        .map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`)
        .join('&');
}

function get(url) {
    return new Promise((resolve, reject) => {
        const session = new Soup.Session({
            user_agent: 'GnomeMeteo/1.2 (GNOME Shell extension; contact: https://github.com/OleksiyM/GnomeMeteo/issues)',
            timeout: 15,
        });
        const msg = Soup.Message.new('GET', url);
        if (!msg) {
            reject(new Error(`bad url: ${url}`));
            return;
        }
        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
            try {
                const bytes = sess.send_and_read_finish(res);
                if (msg.get_status() !== 200) {
                    reject(new Error(`HTTP ${msg.get_status()}`));
                    return;
                }
                resolve(JSON.parse(new TextDecoder().decode(bytes.get_data())));
            } catch (err) {
                reject(err);
            } finally {
                session.abort();
            }
        });
    });
}

/* -- Provider Adapters ----------------------------------------------------- */

class WeatherProvider {
    constructor(id, name, attribution = '') {
        this.id = id;
        this.name = name;
        this.attribution = attribution;
    }

    async forecast({latitude, longitude, days}) { // eslint-disable-line no-unused-vars
        throw new Error(`${this.id}: forecast() not implemented`);
    }

    parse(raw, {days} = {}) { // eslint-disable-line no-unused-vars
        throw new Error(`${this.id}: parse() not implemented`);
    }
}

/* -- Open-Meteo (default) -------------------------------------------------- */

class OpenMeteoProvider extends WeatherProvider {
    constructor() {
        super('open-meteo', 'Open-Meteo', 'Forecast by Open-Meteo.com (CC BY 4.0)');
    }

    async forecast({latitude, longitude, days = 8, model}) {
        const params = {
            latitude,
            longitude,
            current: [
                'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
                'is_day', 'precipitation', 'weather_code', 'cloud_cover',
                'wind_speed_10m', 'wind_direction_10m', 'uv_index',
                'visibility', 'cape', 'surface_pressure',
            ].join(','),
            hourly: [
                'temperature_2m', 'precipitation_probability',
                'precipitation', 'cloud_cover',
                'wind_speed_10m', 'weather_code', 'is_day',
            ].join(','),
            daily: [
                'weather_code', 'temperature_2m_max', 'temperature_2m_min',
                'precipitation_probability_max', 'sunrise', 'sunset',
                'uv_index_max', 'wind_speed_10m_max',
            ].join(','),
            timezone: 'auto',
            forecast_days: days,
            temperature_unit: 'celsius',
            wind_speed_unit: 'kmh',
        };
        if (model && model !== 'best_match')
            params.models = model;
        const raw = await get(`${OPEN_METEO_FORECAST_API}?${buildQueryString(params)}`);
        return this.parse(raw);
    }

    parse(raw) {
        const rawCurrent = raw.current;
        const rawDaily = raw.daily;
        const current = {
            temp: rawCurrent.temperature_2m,
            feels: rawCurrent.apparent_temperature,
            code: rawCurrent.weather_code,
            isDay: !!rawCurrent.is_day,
            humidity: rawCurrent.relative_humidity_2m,
            precip: rawCurrent.precipitation ?? null,
            wind: rawCurrent.wind_speed_10m,
            windDeg: rawCurrent.wind_direction_10m,
            uv: rawCurrent.uv_index ?? null,
            visibility: rawCurrent.visibility ?? null,
            cape: rawCurrent.cape ?? null,
            pressure: rawCurrent.surface_pressure ?? null,
            intensity: rawCurrent.precipitation ?? null,
            timeIso: rawCurrent.time ?? '',
        };

        const rawDailyDays = (rawDaily.time ?? []).map((date, i) => ({
            date,
            code: rawDaily.weather_code[i],
            tmax: rawDaily.temperature_2m_max[i],
            tmin: rawDaily.temperature_2m_min[i],
            precipProb: rawDaily.precipitation_probability_max?.[i] ?? null,
            sunrise: rawDaily.sunrise[i],
            sunset: rawDaily.sunset[i],
            uv: rawDaily.uv_index_max?.[i] ?? null,
            windMax: rawDaily.wind_speed_10m_max?.[i] ?? null,
        }));

        const rawProb = raw.hourly?.precipitation_probability ?? [];
        const preTrim = {
            time: raw.hourly?.time ?? [],
            temp: raw.hourly?.temperature_2m ?? [],
            precipProb: (raw.hourly?.time ?? []).map((_, i) => rawProb[i] ?? null),
            wind: raw.hourly?.wind_speed_10m ?? [],
            code: raw.hourly?.weather_code ?? [],
            isDay: (raw.hourly?.is_day ?? []).map(val => !!val),
        };

        let horizon = preTrim.time.length;
        for (const arr of [preTrim.temp, preTrim.wind, preTrim.code]) {
            const first = arr.findIndex(val => val === null || val === undefined);
            if (first !== -1)
                horizon = Math.min(horizon, first);
        }
        const hourly = {};
        for (const key of Object.keys(preTrim))
            hourly[key] = preTrim[key].slice(0, horizon);

        const dayEnd = rawDailyDays.findIndex(d =>
            d.code === null || d.code === undefined ||
            d.tmax === null || d.tmax === undefined ||
            d.tmin === null || d.tmin === undefined);
        const daily = dayEnd === -1 ? rawDailyDays : rawDailyDays.slice(0, dayEnd);

        return {current, daily, hourly};
    }
}

/* -- MET Norway (api.met.no locationforecast 2.0, complete mode) ----------- */

function agnosToWmo(symbol) {
    const cleanSymbol = (symbol || '').replace(/_(?:day|night|polartwilight)$/, '');
    if (!cleanSymbol)
        return 3;
    const heavy = cleanSymbol.includes('heavy');
    const light = cleanSymbol.includes('light') || cleanSymbol.includes('lght');
    const shower = cleanSymbol.includes('shower') || cleanSymbol.includes('periods');
    if (cleanSymbol.includes('hail'))
        return cleanSymbol.includes('thunder') || heavy ? 99 : 96;
    if (cleanSymbol.includes('thunder'))
        return 95;
    if (cleanSymbol.includes('clearsky')) return 0;
    if (cleanSymbol.includes('fair')) return 1;
    if (cleanSymbol.includes('partlycloudy')) return 2;
    if (cleanSymbol.includes('fog')) return 45;
    if (cleanSymbol.includes('cloudy')) return 3;
    if (cleanSymbol.includes('sleet') || cleanSymbol.includes('ice')
        || (cleanSymbol.includes('rain') && cleanSymbol.includes('snow')))
        return light ? 66 : 67;
    if (cleanSymbol.includes('drizzle')) return light ? 51 : heavy ? 55 : 53;
    if (cleanSymbol.includes('snow'))
        return shower ? (heavy ? 86 : 85) : (light ? 71 : heavy ? 75 : 73);
    if (cleanSymbol.includes('rain'))
        return shower ? (light ? 80 : heavy ? 82 : 81) : (light ? 61 : heavy ? 65 : 63);
    return 3;
}

function localFromUtc(iso) {
    let dateTime = null;
    try {
        dateTime = GLib.DateTime.new_from_iso8601(iso, null);
    } catch {
        dateTime = null;
    }
    if (!dateTime)
        return (iso || '').slice(0, 16).replace(' ', 'T');
    return dateTime.to_local().format('%Y-%m-%dT%H:%M');
}

function isDayFromSymbol(symbol, hourLocal) {
    if (/_day$/.test(symbol || '')) return true;
    if (/_night$/.test(symbol || '')) return false;
    return hourLocal >= 6 && hourLocal < 21;
}

class MetNorwayProvider extends WeatherProvider {
    constructor() {
        super('met-norway', 'MET Norway', 'Forecast: MET Norway (CC BY-SA 4.0)');
    }

    async forecast({latitude, longitude, days = 8}) {
        const url = `${MET_NORWAY_API}?lat=${Number(latitude).toFixed(4)}&lon=${Number(longitude).toFixed(4)}`;
        const raw = await get(url);
        return this.parse(raw, {days, latitude, longitude});
    }

    parse(raw, {days = 8, latitude = 0, longitude = 0} = {}) {
        const timeseries = raw?.properties?.timeseries ?? [];
        const hourly = {time: [], temp: [], precipProb: [], wind: [], code: [], isDay: []};
        const byDate = new Map();

        for (const entry of timeseries) {
            const iso = localFromUtc(entry.time);
            const inst = entry.data?.instant?.details ?? {};
            const next1Hours = entry.data?.next_1_hours ?? {};
            const sym = next1Hours?.summary?.symbol_code
                ?? entry.data?.next_6_hours?.summary?.symbol_code
                ?? entry.data?.next_12_hours?.summary?.symbol_code ?? '';
            const temp = inst.air_temperature ?? null;
            // MET Norway publishes no precipitation probability: keep it unknown (null)
            const prob = null;
            const wind = inst.wind_speed !== undefined ? inst.wind_speed * 3.6 : null;
            hourly.time.push(`${iso.slice(0, 13)}:00`);
            hourly.temp.push(temp);
            hourly.precipProb.push(prob);
            hourly.wind.push(wind);
            hourly.code.push(agnosToWmo(sym));
            hourly.isDay.push(isDayFromSymbol(sym, Number(iso.slice(11, 13))));

            const date = iso.slice(0, 10);
            let day = byDate.get(date);
            if (!day)
                byDate.set(date, day = {date, temps: [], probMax: null, windMax: null, uvMax: null, syms: []});
            if (temp !== null)
                day.temps.push(temp);
            if (wind !== null)
                day.windMax = Math.max(day.windMax ?? 0, wind);
            if (inst.ultraviolet_index_clear_sky !== undefined)
                day.uvMax = Math.max(day.uvMax ?? 0, inst.ultraviolet_index_clear_sky);
            day.syms.push({hour: Number(iso.slice(11, 13)), sym});
        }

        const sun = sunGeometry(latitude, longitude);
        const defaultSunriseIso = sun.sunrise ? new Date(sun.sunrise).toISOString() : null;
        const defaultSunsetIso = sun.sunset ? new Date(sun.sunset).toISOString() : null;

        const daily = [...byDate.values()].slice(0, days).map((day, idx) => {
            let best = null;
            for (const s of day.syms) {
                if (!s.sym) continue;
                const near = Math.abs(s.hour - 13);
                if (!best || near < best.near)
                    best = {near, sym: s.sym};
            }
            return {
                date: day.date,
                code: agnosToWmo(best?.sym ?? ''),
                tmax: day.temps.length ? Math.max(...day.temps) : null,
                tmin: day.temps.length ? Math.min(...day.temps) : null,
                precipProb: null,
                sunrise: idx === 0 ? defaultSunriseIso : null,
                sunset: idx === 0 ? defaultSunsetIso : null,
                uv: day.uvMax,
                windMax: day.windMax,
            };
        });

        const firstDetails = timeseries[0]?.data?.instant?.details ?? {};
        const next1Hours = timeseries[0]?.data?.next_1_hours ?? {};
        const sym = next1Hours?.summary?.symbol_code ?? '';
        const current = {
            temp: firstDetails.air_temperature ?? null,
            feels: firstDetails.apparent_air_temperature ?? null,
            code: agnosToWmo(sym),
            isDay: isDayFromSymbol(sym, Number(hourly.time[0]?.slice(11, 13))),
            humidity: firstDetails.relative_humidity ?? null,
            precip: next1Hours?.details?.precipitation_amount ?? null,
            wind: firstDetails.wind_speed !== undefined ? firstDetails.wind_speed * 3.6 : null,
            windDeg: firstDetails.wind_from_direction ?? null,
            uv: firstDetails.ultraviolet_index_clear_sky ?? null,
            uvClearSky: true, // MET Norway reports UV for a cloudless sky only
            visibility: null,
            cape: null,
            pressure: firstDetails.air_pressure_at_sea_level ?? null,
            intensity: next1Hours?.details?.precipitation_amount ?? null,
            timeIso: hourly.time[0] ?? '',
        };

        return {current, daily, hourly};
    }
}

/* -- NOAA National Weather Service (api.weather.gov, US only, keyless) ----- */

function nwsTextToWmo(text) {
    const lowerText = (text || '').toLowerCase();
    if (!lowerText)
        return null;
    if (lowerText.includes('thunder') || lowerText.includes('storm'))
        return lowerText.includes('hail') ? 99 : 95;
    if (lowerText.includes('sleet') || lowerText.includes('freezing rain')
        || lowerText.includes('freezing drizzle') || lowerText.includes('wintry mix')
        || (lowerText.includes('snow') && lowerText.includes('rain')))
        return 67;
    if (lowerText.includes('fog') || lowerText.includes('mist') || lowerText.includes('haze'))
        return 45;
    if (lowerText.includes('snow') || lowerText.includes('blizzard')) {
        if (lowerText.includes('shower'))
            return lowerText.includes('heavy') ? 86 : 85;
        return lowerText.includes('blizzard') || lowerText.includes('heavy') ? 75
            : lowerText.includes('light') ? 71 : 73;
    }
    if (lowerText.includes('drizzle'))
        return lowerText.includes('heavy') ? 55 : 51;
    if (lowerText.includes('rain') || lowerText.includes('shower')) {
        if (lowerText.includes('shower'))
            return lowerText.includes('heavy') ? 82 : lowerText.includes('light') ? 80 : 81;
        return lowerText.includes('heavy') ? 65 : lowerText.includes('light') ? 61 : 63;
    }
    if (lowerText.includes('overcast') || lowerText.includes('mostly cloudy')
        || lowerText.includes('scattered') || lowerText.includes('widespread'))
        return 3;
    if (lowerText.includes('partly') || lowerText.includes('mostly clear')
        || lowerText.includes('mostly sunny'))
        return 2;
    if (lowerText.includes('cloud'))
        return 3;
    return 0;
}

function nwsNum(text) {
    const matches = String(text ?? '').match(/-?\d+(?:\.\d+)?/g);
    return matches ? Math.max(...matches.map(Number)) : null;
}

function nwsWindKmh(text) {
    const num = nwsNum(text);
    if (num === null)
        return 0;
    const lower = String(text).toLowerCase();
    if (lower.includes('kt') || lower.includes('knot')) return num * 1.852;
    if (lower.includes('km')) return num;
    if (lower.includes('m/s')) return num * 3.6;
    return num * 1.60934;
}

const nwsTempC = (val, unit) =>
    val === null ? null : (String(unit).toUpperCase() === 'F' ? (val - 32) * 5 / 9 : val);

class NoaaNwsProvider extends WeatherProvider {
    constructor() {
        super('noaa-nws', 'NOAA NWS', 'Forecast: National Weather Service (US public data)');
    }

    async forecast({latitude, longitude, days = 8}) {
        let pointsData;
        try {
            pointsData = await get(`${NOAA_NWS_API}/points/${Number(latitude).toFixed(4)},${Number(longitude).toFixed(4)}`);
        } catch (err) {
            throw new Error(/HTTP 4\d\d/.test(err.message)
                ? 'NOAA NWS covers US locations only — pick another provider'
                : err.message);
        }
        const props = pointsData?.properties ?? {};
        if (!props.forecastHourly || !props.forecast)
            throw new Error('NOAA NWS returned no forecast for this location');

        const [hourly, daily] = await Promise.all([
            get(props.forecastHourly),
            get(props.forecast),
        ]);

        let observationData = null;
        try {
            const stationsData = await get(props.observationStations);
            const stationFeatures = (stationsData?.features ?? []).map(feature => ({
                id: feature?.properties?.stationIdentifier ?? feature?.properties?.stationId,
                distance: feature?.properties?.distance?.value ?? Infinity,
            })).filter(feature => feature.id);
            if (stationFeatures.length) {
                const nearestStation = stationFeatures.reduce((closest, curr) => (curr.distance < closest.distance ? curr : closest));
                observationData = await get(`${NOAA_NWS_API}/stations/${nearestStation.id}/observations/latest`);
            }
        } catch {
            observationData = null;
        }
        return this.parse({hourly, daily, obs: observationData, days, latitude, longitude});
    }

    parse({hourly, daily, obs, days = 8, latitude = 0, longitude = 0} = {}) {
        const hourlyData = {time: [], temp: [], precipProb: [], wind: [], code: [], isDay: []};
        for (const period of hourly?.properties?.periods ?? []) {
            const iso = String(period.startTime ?? period.time ?? '').slice(0, 16);
            if (!iso)
                continue;
            hourlyData.time.push(`${iso.slice(0, 13)}:00`);
            hourlyData.temp.push(nwsTempC(nwsNum(period.temperature), period.temperatureUnit));
            hourlyData.precipProb.push(period.probabilityOfPrecipitation?.value ?? 0);
            hourlyData.wind.push(nwsWindKmh(period.windSpeed));
            hourlyData.code.push(nwsTextToWmo(period.shortForecast) ?? 3);
            hourlyData.isDay.push(!!(period.isDaytime ?? period.isDayTime));
        }

        const byDate = new Map();
        for (const period of daily?.properties?.periods ?? []) {
            const date = String(period.startTime ?? period.time ?? '').slice(0, 10);
            if (!date)
                continue;
            let row = byDate.get(date);
            if (!row)
                byDate.set(date, row = {date, code: 3, tmax: null, tmin: null, precipProb: 0, windMax: 0});
            const temp = nwsTempC(nwsNum(period.temperature), period.temperatureUnit);
            if (period.isDaytime ?? period.isDayTime) {
                row.code = nwsTextToWmo(period.shortForecast) ?? row.code;
                row.tmax = temp ?? row.tmax;
                row.precipProb = Math.max(row.precipProb, period.probabilityOfPrecipitation?.value ?? 0);
                row.windMax = Math.max(row.windMax, nwsWindKmh(period.windSpeed));
            } else {
                row.tmin = temp ?? row.tmin;
                row.precipProb = Math.max(row.precipProb, period.probabilityOfPrecipitation?.value ?? 0);
            }
        }

        const sun = sunGeometry(latitude, longitude);
        const defaultSunriseIso = sun.sunrise ? new Date(sun.sunrise).toISOString() : null;
        const defaultSunsetIso = sun.sunset ? new Date(sun.sunset).toISOString() : null;

        const rows = [...byDate.values()].slice(0, days);
        const day = {
            current: null,
            daily: rows.map((r, idx) => ({
                ...r,
                sunrise: idx === 0 ? defaultSunriseIso : null,
                sunset: idx === 0 ? defaultSunsetIso : null,
                uv: null,
            })),
            hourly: hourlyData,
        };

        const observationProps = obs?.properties;
        const hourRh = hourly?.properties?.periods?.[0]?.relativeHumidity?.value ?? null;
        const obsPressurePa = observationProps?.barometricPressure?.value ?? observationProps?.seaLevelPressure?.value ?? null;
        const obsPressureHpa = (obsPressurePa !== null && Number.isFinite(obsPressurePa)) ? (obsPressurePa / 100) : null;

        if (observationProps?.temperature?.value !== undefined && observationProps?.temperature?.value !== null) {
            const code = nwsTextToWmo(observationProps.textDescription)
                ?? (observationProps.skyCover?.value >= 87 ? 3 : observationProps.skyCover?.value >= 25 ? 2 : 0);
            day.current = {
                temp: observationProps.temperature.value,
                feels: observationProps.apparentTemperature?.value ?? null,
                code,
                isDay: (() => {
                    const hr = Number(String(observationProps.timestamp ?? '').slice(11, 13));
                    return hr >= 6 && hr < 21;
                })(),
                humidity: observationProps.relativeHumidity?.value ?? hourRh,
                precip: observationProps.precipitationLastHour?.value ?? null,
                wind: observationProps.windSpeed?.value ?? null,
                windDeg: observationProps.windDirection?.value ?? null,
                uv: null,
                visibility: observationProps.visibility?.value ?? null,
                cape: null,
                pressure: obsPressureHpa,
                intensity: observationProps.precipitationLastHour?.value ?? null,
                timeIso: String(observationProps.timestamp ?? '').slice(0, 16),
            };
        } else {
            const i = 0;
            day.current = {
                temp: hourlyData.temp[i] ?? null,
                feels: null,
                code: hourlyData.code[i] ?? 3,
                isDay: !!hourlyData.isDay[i],
                humidity: hourRh,
                precip: null,
                wind: hourlyData.wind[i] ?? null,
                windDeg: null,
                uv: null,
                visibility: null,
                cape: null,
                pressure: obsPressureHpa,
                intensity: null,
                timeIso: hourlyData.time[i] ?? '',
            };
        }
        return day;
    }
}

const PROVIDERS = {
    'open-meteo': OpenMeteoProvider,
    'met-norway': MetNorwayProvider,
    'noaa-nws': NoaaNwsProvider,
};
const _liveProviders = new Map();

function providerFor(id) {
    const key = PROVIDERS[id] ? id : 'open-meteo';
    let provider = _liveProviders.get(key);
    if (!provider) {
        provider = new PROVIDERS[key]();
        _liveProviders.set(key, provider);
    }
    return provider;
}

/* -- Auto-location (GeoClue + IP fallback + localized reverse geocode) ----- */

const GEOCLUE_DESKTOP_ID = 'io.github.oleksiym.meteo';
const GEOCLUE_TIMEOUT_SEC = 5;
const GEOCLUE_RETRY_SEC = 1800;
const GEOCLUE_RETRY_MAX_SEC = 86400;
const DETECT_TTL_SEC = 1800;

async function detectViaGeoClue(client) {
    const {default: Geoclue} = await import('gi://Geoclue');
    const simple = new Geoclue.Simple({
        desktopId: GEOCLUE_DESKTOP_ID,
        accuracyLevel: Geoclue.AccuracyLevel.EXACT,
    });
    return new Promise((resolve, reject) => {
        let timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, GEOCLUE_TIMEOUT_SEC, () => {
            client._detectTimers.delete(timerId);
            timerId = 0;
            reject(new Error(`no fix within ${GEOCLUE_TIMEOUT_SEC}s`));
            return GLib.SOURCE_REMOVE;
        });
        client._detectTimers.add(timerId);
        const settle = fn => {
            if (timerId) {
                GLib.source_remove(timerId);
                client._detectTimers.delete(timerId);
                timerId = 0;
            }
            fn();
        };
        simple.init_async(GLib.PRIORITY_DEFAULT, null, (c, res) => {
            let location = null;
            try {
                c.init_finish(res);
                location = c.get_location();
            } catch (err) {
                settle(() => reject(new Error(`access denied (${err.message})`)));
                return;
            }
            const take = loc => settle(() => resolve({
                latitude: loc.latitude,
                longitude: loc.longitude,
                name: '',
            }));
            if (location)
                take(location);
            else
                c.connect('location-updated', (_c, loc) => take(loc));
        });
    });
}

export function fixFromIp(raw) {
    const [lat, lon] = raw.loc
        ? String(raw.loc).split(',').map(Number)
        : [Number(raw.latitude), Number(raw.longitude)];
    if (!Number.isFinite(lat) || !Number.isFinite(lon))
        throw new Error('IP geolocation failed');
    return {latitude: lat, longitude: lon, name: raw.city || raw.country || ''};
}

export function geoRetryDelaySec(failures) {
    return Math.min(GEOCLUE_RETRY_SEC * 4 ** failures, GEOCLUE_RETRY_MAX_SEC);
}

export function cityFromReverseGeocode(raw) {
    return raw.city || raw.locality || '';
}

async function labelFix(fix, lang = 'en') {
    try {
        const raw = await get(`${REVERSE_GEOCODE_API}?${buildQueryString({
            latitude: fix.latitude.toFixed(4),
            longitude: fix.longitude.toFixed(4),
            localityLanguage: lang || 'en',
        })}`);
        const localizedCity = cityFromReverseGeocode(raw);
        if (localizedCity)
            return {...fix, name: localizedCity};
    } catch {
        // Fallback to IP city name if reverse geocoder is unreachable
    }
    return fix;
}

export function desktopEntryName() {
    return `${GEOCLUE_DESKTOP_ID}.desktop`;
}

export function desktopEntryText() {
    return [
        '[Desktop Entry]',
        'Type=Application',
        'Name=GnomeMeteo',
        'Comment=Weather for the GNOME panel',
        'Icon=weather-overcast',
        'NoDisplay=true',
        'Terminal=false',
        'X-Geoclue-Reason=Show the weather for where you are',
        '',
    ].join('\n');
}

function makeDirectoryPath(dir) {
    const missing = [];
    for (let d = dir; d && !d.query_exists(null); d = d.get_parent())
        missing.push(d);
    for (const d of missing.reverse())
        d.make_directory(null);
}

function desktopEntryFile() {
    return Gio.File.new_for_path(GLib.build_filenamev(
        [GLib.get_user_data_dir(), 'applications', desktopEntryName()]
    ));
}

function readConsentStub(done) {
    const file = desktopEntryFile();
    file.load_contents_async(null, (obj, res) => {
        try {
            const [, bytes] = obj.load_contents_finish(res);
            done({file, text: new TextDecoder().decode(bytes)});
        } catch (err) {
            if (!err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                logError(err, 'GnomeMeteo: consent entry unreadable');
            done({file, text: null});
        }
    });
}

export function ensureDesktopEntry() {
    readConsentStub(({file, text}) => {
        if (text !== null && text.includes('X-Geoclue-Reason'))
            return;
        try {
            makeDirectoryPath(file.get_parent());
            file.replace_contents(desktopEntryText(), null, false, Gio.FileCreateFlags.NONE, null);
        } catch (err) {
            logError(err, 'GnomeMeteo: consent entry not installed');
        }
    });
}

export function removeDesktopEntry() {
    readConsentStub(({file, text}) => {
        if (text === null || !text.includes('NoDisplay=true'))
            return;
        try {
            file.delete(null);
        } catch (err) {
            logError(err, 'GnomeMeteo: consent entry not removable');
        }
    });
}

/* -- Client ---------------------------------------------------------------- */

export class WeatherClient {
    constructor(providerId = 'open-meteo', model = null) {
        this.providerId = providerId;
        this.model = model;
        this._fix = null;       // cached {latitude, longitude, name, lang, at}
        this._geoRetryAt = 0;
        this._geoFailures = 0;
        this._detectTimers = new Set();
    }

    destroy() {
        for (const id of this._detectTimers)
            GLib.source_remove(id);
        this._detectTimers.clear();
    }

    get provider() {
        return providerFor(this.providerId);
    }

    async detectLocation(lang = 'en') {
        const nowSec = GLib.get_monotonic_time() / 1000000;
        if (this._fix && (nowSec - this._fix.at < DETECT_TTL_SEC) && this._fix.lang === lang)
            return this._fix;

        let fix = null;
        if (nowSec >= this._geoRetryAt) {
            try {
                fix = await detectViaGeoClue(this);
                this._geoFailures = 0;
                this._geoRetryAt = 0;
            } catch (err) {
                this._geoRetryAt = nowSec + geoRetryDelaySec(this._geoFailures);
                this._geoFailures++;
                log(`GnomeMeteo: GeoClue unusable (${err.message}); using IP lookup`);
            }
        }
        if (!fix) {
            try {
                fix = fixFromIp(await get(IPINFO_API));
            } catch {
                fix = fixFromIp(await get(IPAPI_API));
            }
        }
        fix = await labelFix(fix, lang);
        this._fix = {
            latitude: fix.latitude,
            longitude: fix.longitude,
            name: fix.name,
            lang,
            at: nowSec,
        };
        return this._fix;
    }

    async fetch({latitude, longitude, auto, days = 8, lang = 'en'}) {
        let lat = latitude;
        let lon = longitude;
        let detectedName = null;
        if (auto) {
            const detectedLocation = await this.detectLocation(lang);
            lat = detectedLocation.latitude;
            lon = detectedLocation.longitude;
            detectedName = detectedLocation.name || null;
        }
        const data = await this.provider.forecast({
            latitude: lat,
            longitude: lon,
            days,
            model: this.model,
        });

        // Ensure today's sunrise/sunset are always populated using astronomical calculation if missing
        if (Array.isArray(data.daily) && data.daily.length > 0) {
            if (!data.daily[0].sunrise || !data.daily[0].sunset) {
                const sun = sunGeometry(lat, lon);
                if (sun.sunrise && sun.sunset) {
                    data.daily[0].sunrise = new Date(sun.sunrise).toISOString();
                    data.daily[0].sunset = new Date(sun.sunset).toISOString();
                }
            }
        }

        return {...data, detectedName, latitude: lat, longitude: lon};
    }

    async geocode(query, lang = 'en') {
        const raw = await get(`${OPEN_METEO_GEOCODING_API}?${buildQueryString({
            name: query,
            count: 6,
            language: lang,
            format: 'json',
        })}`);
        return (raw.results ?? []).map(result => ({
            name: result.name,
            admin: result.admin1 ?? '',
            country: result.country ?? '',
            latitude: result.latitude,
            longitude: result.longitude,
        }));
    }
}
