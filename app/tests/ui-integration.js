// Live UI integration test: boots the real app, waits for the first fetch
// cycle, asserts state through public handles. Run with no other instance.
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { WeatherGlassApp } from '../src/application.js';
const HERE = GLib.filename_from_uri(import.meta.url)[0]
    .replace(/[^/]+$/, '');

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
        let closeWidget = null; // captured for the close-request verb check
        // generous window: a cold Open-Meteo hiccup costs a retry cycle, not a FAIL
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
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

                check('moveCityTo exists for drag reorder',
                    typeof bus.config.moveCityTo === 'function');
                if (typeof bus.config.moveCityTo === 'function') {
                    bus.config.moveCityTo(before[2].id, 0);
                    check('moveCityTo lands on final index',
                        bus.config.cities[0].id === before[2].id);
                    // Leave this net reorder in place until the delayed
                    // allocation check below has had frames to settle.
                }

                const organizeAct = this.window?.lookup_action('organize');
                check('organize action exists and starts off',
                    !!organizeAct && organizeAct.state?.get_boolean() === false);
                if (organizeAct) {
                    organizeAct.activate(null);
                    check('organize action toggles on',
                        organizeAct.state?.get_boolean() === true);
                }

                check('window exists', !!this.window);

                // ---- furniture plumbing regression locks ---------------------
                // A depth-first walk of the live widget tree. These caught-or-
                // would-have-caught three real regressions: an overlay casting
                // an input shadow over tiles (hover dies), scenery claiming
                // hit-test targets (hover slows), the close button missing.
                const seen = {
                    close: null, tiles: [], scenery: [],
                    organizeHandles: [], organizeRemoves: [], cityRows: [],
                    heroTemps: [], heroCities: [], sectionTitles: [],
                    metricTabs: [], detailsToggles: [], menuButtons: [],
                    nowBadges: [], currentStrips: [], currentGrids: [],
                };
                const collect = (w) => {
                    if (!w) return;
                    const cls = w.get_css_classes ? w.get_css_classes() : [];
                    if (cls.includes('win-close')) { seen.close = w; closeWidget = w; }
                    if (cls.includes('city-organize-handle'))
                        seen.organizeHandles.push(w);
                    if (cls.includes('city-remove-pill'))
                        seen.organizeRemoves.push(w);
                    if (w instanceof Gtk.ListBoxRow && w.city?.id)
                        seen.cityRows.push(w);
                    if (cls.includes('day-tile')) seen.tiles.push(w);
                    if (w.get_mapped?.() && cls.includes('hero-temp'))
                        seen.heroTemps.push(w);
                    if (w.get_mapped?.() && cls.includes('hero-city'))
                        seen.heroCities.push(w);
                    if (w.get_mapped?.() && cls.includes('section-title'))
                        seen.sectionTitles.push(w);
                    if (w.get_mapped?.() && cls.includes('metric-tab'))
                        seen.metricTabs.push(w);
                    if (w.get_mapped?.() && cls.includes('details-toggle'))
                        seen.detailsToggles.push(w);
                    if (w instanceof Gtk.MenuButton) seen.menuButtons.push(w);
                    if (cls.includes('now-badge')) seen.nowBadges.push(w);
                    if (cls.includes('current-strip')) seen.currentStrips.push(w);
                    if (cls.includes('current-grid')) seen.currentGrids.push(w);
                    if (w instanceof Gtk.DrawingArea
                        && !(w.get_css_classes ?? (() => [])).call(w)
                            .includes('hourly-chart'))
                        seen.scenery.push(w); // charts ARE interactive (crosshair); rest is scenery
                    for (let c = w.get_first_child(); c; c = c.get_next_sibling())
                        collect(c);
                };
                collect(this.window);

                check('close button exists', !!seen.close);
                if (seen.close) {
                    check('close button sensitive + mapped',
                        seen.close.get_sensitive() && seen.close.get_mapped());
                    const a = seen.close.get_allocation();
                    const winA = this.window.get_content().get_allocation();
                    check('close button is TOP-RIGHT furniture',
                        a.y < 80 && (a.x + a.width) > winA.width - 90,
                        `x=${a.x} y=${a.y} winw=${winA.width}`);
                }
                check('day tiles present and clickable',
                    seen.tiles.length >= 5 && seen.tiles.every(t =>
                        t.get_sensitive() && t.get_can_target()),
                    `n=${seen.tiles.length}`);
                check('scenery never takes pointer targets',
                    seen.scenery.length > 0 && seen.scenery.every(d =>
                        !d.get_can_target()),
                    `${seen.scenery.filter(d => d.get_can_target()).length}/${seen.scenery.length} claim targets`);
                {
                    const titles = seen.sectionTitles.map(w => w.label);
                    const tabs = seen.metricTabs.map(w => w.label);
                    check('Sky-first panel sections are present',
                        seen.heroTemps.length === 1
                        && seen.heroCities.length === 1
                        && !!seen.heroCities[0].label
                        && titles.includes('8-day forecast')
                        && titles.some(t => t.endsWith("'s details"))
                        && titles.includes('Current conditions')
                        && tabs.join('|') === 'Temperature|Precipitation|Wind'
                        && seen.detailsToggles.length === 1,
                        `titles=${titles.join('|')} tabs=${tabs.join('|')}`);
                    const content = this.window.get_content();
                    const yOf = w => w?.translate_coordinates(content, 0, 0)?.[2] ?? null;
                    const firstTile = seen.tiles.find(t => t.get_mapped());
                    const ys = [yOf(seen.heroTemps[0]), yOf(seen.heroCities[0]),
                        yOf(firstTile), yOf(seen.metricTabs[0])];
                    check('Sky-first order is hero, city, days, then chart tabs',
                        ys.every(y => y != null)
                        && ys[0] < ys[1] && ys[1] < ys[2] && ys[2] < ys[3],
                        `ys=${ys.join(',')}`);
                    check('whole-window sky class follows the sky preference',
                        this.window.get_css_classes().includes('sky-window')
                            === bus.config.sky,
                        `sky=${bus.config.sky}`);
                }
                check('city rows have no three-dot menu (only the app menu remains)',
                    seen.menuButtons.length === 1,
                    `menuButtons=${seen.menuButtons.length}`);
                check('organize mode shows a grip and remove pill per city',
                    seen.organizeHandles.length === before.length
                    && seen.organizeRemoves.length === before.length
                    && [...seen.organizeHandles, ...seen.organizeRemoves]
                        .every(w => w.get_visible() && w.get_mapped()),
                    `grips=${seen.organizeHandles.length} removes=${seen.organizeRemoves.length}`);
                if (organizeAct) {
                    organizeAct.activate(null);
                    check('organize action toggles off and hides affordances',
                        organizeAct.state?.get_boolean() === false
                        && [...seen.organizeHandles, ...seen.organizeRemoves]
                            .every(w => !w.get_visible()));
                }
                {
                    const mappedTiles = seen.tiles.filter(t => t.get_mapped());
                    if (mappedTiles.length > 1) mappedTiles[1].set_active(true);
                    check('future day swaps live grid for the Now strip',
                        mappedTiles.length > 1
                        && seen.nowBadges.some(w => w.get_visible())
                        && seen.currentStrips.some(w => w.get_visible())
                        && seen.currentGrids.some(w => !w.get_visible())
                        && seen.sectionTitles.some(w =>
                            w.label.endsWith("'s details") && w.label !== "Today's details"),
                        `tiles=${mappedTiles.length}`);
                    if (mappedTiles.length > 0) mappedTiles[0].set_active(true);
                    check('returning to Today restores the live grid',
                        seen.currentStrips.every(w => !w.get_visible())
                        && seen.currentGrids.some(w => w.get_visible()));
                }
                { // Shared-sky ownership has no GTK getter: source lock
                    const pageSrc = new TextDecoder().decode(GLib.file_get_contents(
                        `${HERE}/../src/citypage.js`)[1]);
                    const winSrc = new TextDecoder().decode(GLib.file_get_contents(
                        `${HERE}/../src/window.js`)[1]);
                    check('window owns the shared sky; pages stay transparent',
                        winSrc.includes('makeSkyBackdrop')
                        && winSrc.includes('#activeSkyView')
                        && pageSrc.includes('skyView()')
                        && !pageSrc.includes('makeSkyBackdrop')
                        && !pageSrc.includes('#updRow'));
                }

                const cfgPath = `${GLib.getenv('XDG_CONFIG_HOME') || GLib.build_filenamev([GLib.get_home_dir(), '.config'])}/weatherglass/config.json`;
                const parsed = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(cfgPath)[1]));
                check('config flushed to disk', parsed.cities.length === before.length,
                    `disk=${parsed.cities.length}`);
                // sky backdrop preference persists like everything else
                bus.config.setSky(false);
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 900, () => { // beat the 400 ms debounce
                    try {
                        const parsed2 = JSON.parse(new TextDecoder().decode(
                            GLib.file_get_contents(cfgPath)[1]));
                        check('sky=false persisted', parsed2.sky === false, JSON.stringify(parsed2.sky));
                    } catch (e) {
                        failures++;
                        print(`FAIL sky persist: ${e.stack ?? e}`);
                    }
                    {
                        const measured = seen.cityRows.map(row => {
                            const allocation = row.get_allocation();
                            const [, natural] = row.measure(
                                Gtk.Orientation.VERTICAL, allocation.width || -1);
                            return { allocation, natural };
                        }).sort((a, b) => a.allocation.y - b.allocation.y);
                        const allocations = measured.map(({ allocation }) => allocation);
                        const gaps = allocations.slice(1).map((a, i) =>
                            a.y - (allocations[i].y + allocations[i].height));
                        const excess = measured.map(({ allocation, natural }) =>
                            allocation.height - natural);
                        check('reordered city rows allocate compactly from the top',
                            allocations.length === before.length
                            && allocations[0].y >= 0 && allocations[0].y <= 2
                            && gaps.every(gap => gap >= 0 && gap <= 2)
                            && excess.every(extra => extra >= 0 && extra <= 2),
                            `top=${allocations[0]?.y} gaps=${gaps.join(',')} `
                            + `extra-height=${excess.join(',')}`);
                    }
                    if (typeof bus.config.moveCityTo === 'function') {
                        bus.config.moveCityTo(before[2].id, 2);
                        check('moveCityTo restore preserves city order',
                            bus.config.cities.map(c => c.id).join(',')
                                === before.map(c => c.id).join(','));
                    }
                    bus.config.setSky(true);
                    // verb check: pressing the furniture really requests close.
                    // Handler returns TRUE (intercepted) so the window lives
                    // long enough to finish teardown cleanly.
                    if (closeWidget) {
                        let requested = false;
                        const hid = this.window.connect('close-request', () => {
                            requested = true;
                            return true;
                        });
                        closeWidget.emit('clicked');
                        this.window.disconnect(hid);
                        check('clicking close requests window close', requested);
                    } else {
                        check('clicking close requests window close', false,
                            'close button was never found');
                    }
                    print(failures ? `${failures} UI FAILURE(S)` : 'UI INTEGRATION PASSED');
                    this.quit();
                    return GLib.SOURCE_REMOVE;
                });
                return GLib.SOURCE_REMOVE;
            } catch (e) {
                failures++;
                print(`FAIL harness: ${e.stack ?? e}`);
                print(`${failures} UI FAILURE(S)`);
                this.quit();
                return GLib.SOURCE_REMOVE;
            }
        });
    }
});

const app = new TestApp();
app.run(null);
