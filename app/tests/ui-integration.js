// Live UI integration test: boots the real app, waits for the first fetch
// cycle, asserts state through public handles. Run with no other instance.
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import { WeatherGlassApp } from '../src/application.js';

let failures = 0;
function check(name, cond, extra = '') {
    if (cond) {
        print(`PASS ${name}`);
    } else {
        failures++;
        print(`FAIL ${name} ${extra}`);
    }
}

const TestApp = GObject.registerClass({ gTypeName: 'WTestApp' },
class TestApp extends WeatherGlassApp {
    vfunc_activate() {
        super.vfunc_activate();
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 14, () => {
            const bus = this.bus;
            const before = bus.config.cities.slice();
            try {
                const cities = bus.config.cities;
                check('seeded 4 cities', cities.length === 4, `got ${cities.length}`);
                check('default units metric', bus.config.units === 'metric');
                check('default refresh 15', bus.config.refreshMinutes === 15);

                let withData = 0;
                for (const c of cities)
                    if (bus.forecasts.getState(c.id)?.data) withData++;
                check('forecasts fetched for all cities', withData === cities.length,
                    `${withData}/${cities.length}`);

                const st0 = bus.forecasts.getState(cities[0].id);
                if (st0?.data) {
                    const d = st0.data;
                    check('normalized current shape',
                        typeof d.current.temp === 'number'
                        && typeof d.current.code === 'number'
                        && d.hourly.time.length > 24
                        && d.daily.length >= 8,
                        `t=${d.current.temp} h=${d.hourly.time.length} d=${d.daily.length}`);
                    check('city clock offset sane',
                        Math.abs(d.cityClockOffsetMs) < 14 * 3600e3, `${d.cityClockOffsetMs}`);
                }

                bus.config.setUnits('imperial');
                check('units mutation', bus.config.units === 'imperial');
                bus.config.setUnits('metric');

                bus.config.addCity({
                    name: 'Testville', latitude: 1.35, longitude: 103.82,
                    country: 'Singapore', countryCode: 'SG',
                });
                check('add city appends + activates',
                    bus.config.cities.length === before.length + 1
                    && bus.config.activeCityId === bus.config.cities.at(-1).id);
                bus.config.removeCity(bus.config.cities.at(-1).id);
                check('remove city', bus.config.cities.length === before.length);

                bus.config.moveCity(before[1].id, -1);
                check('move city reorder', bus.config.cities[0].id === before[1].id);
                bus.config.moveCity(before[1].id, 1);
                check('move city restores', bus.config.cities[0].id === before[0].id);

                check('window exists', !!this.window);
                const cfgPath = `${GLib.getenv('XDG_CONFIG_HOME') || GLib.build_filenamev([GLib.get_home_dir(), '.config'])}/weatherglass/config.json`;
                const parsed = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(cfgPath)[1]));
                check('config flushed to disk', parsed.cities.length === before.length,
                    `disk=${parsed.cities.length}`);
            } catch (e) {
                failures++;
                print(`FAIL harness: ${e.stack ?? e}`);
            }
            print(failures ? `${failures} UI FAILURE(S)` : 'UI INTEGRATION PASSED');
            this.quit();
            return GLib.SOURCE_REMOVE;
        });
    }
});

const app = new TestApp();
app.run(null);
