/* prefs.js -- GnomeMeteo preferences dialog. */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { WeatherClient } from './weather.js';

const UNITS = ['metric', 'imperial'];
const HOURS = ['auto', '12h', '24h'];
const LANGUAGES = ['auto', 'uk', 'ru', 'en'];
const PROVIDER_IDS = ['open-meteo', 'met-norway', 'noaa-nws'];
const MODEL_IDS = [
    'best_match', 'ecmwf_ifs', 'ecmwf_ifs025',
    'icon_seamless', 'gfs_seamless', 'gem_global',
    'jma_seamless', 'ukmo_global_deterministic_10km',
];

function locationLabel(result) {
    return [result.name, result.admin, result.country].filter(Boolean).join(', ');
}

const ResultRow = GObject.registerClass(class ResultRow extends Adw.ActionRow {
    _init(title, onActivated) {
        super._init({ title, activatable: true });
        const iconImage = new Gtk.Image({
            icon_name: 'go-next-symbolic',
            pixel_size: 16,
        });
        this.add_suffix(iconImage);
        this.connect('activated', () => onActivated());
    }
});

export default class GnomeMeteoPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const client = new WeatherClient();
        window.set_default_size(580, 700);

        // Single clean scrollable page
        const page = new Adw.PreferencesPage();

        // 1. Location Group
        const manual = this._buildManualLocationGroup(settings);
        const searchGroups = this._buildSearchLocationGroup(settings, client, selectedResult => {
            manual.setLocation(selectedResult.latitude, selectedResult.longitude, selectedResult.name);
        });
        const autoGroup = this._buildAutoLocationGroup(settings, auto => {
            for (const g of [...searchGroups, manual.group])
                g.visible = !auto;
        });
        page.add(autoGroup);
        searchGroups.forEach(group => page.add(group));
        page.add(manual.group);

        // 2. Panel indicator
        page.add(this._buildIndicatorGroup(settings));

        // 3. Units & Language
        page.add(this._buildUnitsGroup(settings));

        // 4. Data & Provider
        page.add(this._buildProviderGroup(settings));
        page.add(this._buildUpdatesGroup(settings));

        window.add(page);

        // Header bar button (i) -> Adw.AboutDialog
        this._setupAboutButton(window);
    }

    _buildAutoLocationGroup(settings, onToggled) {
        const autoGroup = new Adw.PreferencesGroup({
            title: _('Location'),
            description: _('Uses system location when available, otherwise your public IP address'),
        });
        const autoRow = new Adw.SwitchRow({
            title: _('Detect location automatically'),
            subtitle: _('Disable to search and pick your city manually'),
        });
        settings.bind('auto-location', autoRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        autoRow.connect('notify::active', () => onToggled(autoRow.active));
        onToggled(autoRow.active);
        autoGroup.add(autoRow);
        return autoGroup;
    }

    _buildSearchLocationGroup(settings, client, onSelect) {
        const searchGroup = new Adw.PreferencesGroup({ title: _('Search a city') });
        const searchEntry = new Adw.EntryRow({
            title: _('City name — press Enter to search'),
        });
        searchGroup.add(searchEntry);

        const resultsGroup = new Adw.PreferencesGroup({
            title: _('Results'),
            visible: false,
        });

        const resultRows = [];
        const clearResults = () => {
            for (const row of resultRows.splice(0)) {
                resultsGroup.remove(row);
                row.destroy();
            }
            resultsGroup.visible = false;
        };

        const choose = result => {
            settings.set_boolean('auto-location', false);
            settings.set_double('location-latitude', result.latitude);
            settings.set_double('location-longitude', result.longitude);
            settings.set_string('location-name', result.name);
            onSelect(result);
            clearResults();
        };

        searchEntry.connect('entry-activated', () => {
            const query = searchEntry.get_text().trim();
            if (query.length < 2)
                return;

            const langSetting = settings.get_string('language');
            const lang = (langSetting && langSetting !== 'auto')
                ? langSetting
                : (GLib.get_language_names()[0]?.slice(0, 2) || 'en');

            client.geocode(query, lang).then(results => {
                clearResults();
                if (results.length === 0) {
                    const noneRow = new Adw.ActionRow({
                        title: _('No matches'),
                        sensitive: false,
                    });
                    resultRows.push(noneRow);
                    resultsGroup.add(noneRow);
                    resultsGroup.visible = true;
                    return;
                }
                for (const result of results) {
                    const row = new ResultRow(locationLabel(result), () => choose(result));
                    resultRows.push(row);
                    resultsGroup.add(row);
                }
                resultsGroup.visible = true;
            }).catch(err => {
                searchEntry.add_css_class('error');
                logError(err, 'GnomeMeteo prefs geocode');
            });
        });
        searchEntry.connect('changed', () => searchEntry.remove_css_class('error'));

        return [searchGroup, resultsGroup];
    }

    _buildManualLocationGroup(settings) {
        const manualGroup = new Adw.PreferencesGroup({
            title: _('Selected coordinates'),
            description: _('Coordinates used for the weather forecast'),
        });

        const nameEntry = new Adw.EntryRow({ title: _('Display name') });
        const latEntry = new Adw.EntryRow({ title: _('Latitude') });
        const lonEntry = new Adw.EntryRow({ title: _('Longitude') });

        nameEntry.set_text(settings.get_string('location-name'));
        latEntry.set_text(settings.get_double('location-latitude').toFixed(4));
        lonEntry.set_text(settings.get_double('location-longitude').toFixed(4));

        nameEntry.connect('entry-activated', () => {
            const val = nameEntry.get_text().trim();
            if (val)
                settings.set_string('location-name', val);
        });
        latEntry.connect('entry-activated', () => {
            const val = parseFloat(latEntry.get_text());
            if (Number.isFinite(val) && val >= -90 && val <= 90) {
                settings.set_double('location-latitude', val);
                settings.set_boolean('auto-location', false);
                latEntry.remove_css_class('error');
            } else
                latEntry.add_css_class('error');
        });
        lonEntry.connect('entry-activated', () => {
            const val = parseFloat(lonEntry.get_text());
            if (Number.isFinite(val) && val >= -180 && val <= 180) {
                settings.set_double('location-longitude', val);
                settings.set_boolean('auto-location', false);
                lonEntry.remove_css_class('error');
            } else
                lonEntry.add_css_class('error');
        });

        manualGroup.add(nameEntry);
        manualGroup.add(latEntry);
        manualGroup.add(lonEntry);

        return {
            group: manualGroup,
            setLocation(lat, lon, name) {
                latEntry.set_text(String(lat));
                lonEntry.set_text(String(lon));
                nameEntry.set_text(name);
            },
        };
    }

    _buildIndicatorGroup(settings) {
        const lookGroup = new Adw.PreferencesGroup({
            title: _('Panel indicator'),
            description: _('What appears in the GNOME top bar'),
        });
        const tempRow = new Adw.SwitchRow({
            title: _('Show temperature'),
            subtitle: _('Display current temperature number in the panel'),
        });
        const iconRow = new Adw.SwitchRow({
            title: _('Show weather icon'),
            subtitle: _('Display symbolic weather icon in the panel'),
        });

        settings.bind('show-temperature', tempRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('show-icon', iconRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        lookGroup.add(tempRow);
        lookGroup.add(iconRow);
        return lookGroup;
    }

    _buildUnitsGroup(settings) {
        const unitsGroup = new Adw.PreferencesGroup({ title: _('Units and Format') });

        const langRow = new Adw.ComboRow({
            title: _('Language'),
            subtitle: _('Interface display language'),
            model: new Gtk.StringList({
                strings: ['Авто (Системна / System)', 'Українська', 'Русский', 'English'],
            }),
        });
        const currentLang = settings.get_string('language');
        langRow.set_selected(Math.max(0, LANGUAGES.indexOf(currentLang)));
        langRow.connect('notify::selected', () =>
            settings.set_string('language', LANGUAGES[langRow.get_selected()] ?? 'auto'));
        unitsGroup.add(langRow);

        const unitsRow = new Adw.ComboRow({
            title: _('Measurement system'),
            subtitle: _('Temperature, wind and precipitation units'),
            model: new Gtk.StringList({
                strings: [_('Metric (°C, km/h)'), _('Imperial (°F, mph)')],
            }),
        });
        unitsRow.set_selected(Math.max(0, UNITS.indexOf(settings.get_string('units'))));
        unitsRow.connect('notify::selected', () =>
            settings.set_string('units', UNITS[unitsRow.get_selected()] ?? 'metric'));
        unitsGroup.add(unitsRow);

        const hoursRow = new Adw.ComboRow({
            title: _('Hour format'),
            subtitle: _('Clock format in hourly forecast'),
            model: new Gtk.StringList({
                strings: [_('Automatic (system)'), _('12-hour'), _('24-hour')],
            }),
        });
        hoursRow.set_selected(Math.max(0, HOURS.indexOf(settings.get_string('hour-format'))));
        hoursRow.connect('notify::selected', () =>
            settings.set_string('hour-format', HOURS[hoursRow.get_selected()] ?? 'auto'));
        unitsGroup.add(hoursRow);

        return unitsGroup;
    }

    _buildProviderGroup(settings) {
        const dataGroup = new Adw.PreferencesGroup({
            title: _('Weather forecast provider'),
            description: _('Free, keyless weather forecasters'),
        });
        const provRow = new Adw.ComboRow({
            title: _('Provider'),
            subtitle: _('Forecast data source'),
            model: new Gtk.StringList({
                strings: [
                    _('Open-Meteo (Worldwide)'),
                    _('MET Norway'),
                    _('NOAA NWS (US)'),
                ],
            }),
        });
        const selectedProviderIndex = PROVIDER_IDS.indexOf(settings.get_string('provider'));
        provRow.set_selected(selectedProviderIndex < 0 ? 0 : selectedProviderIndex);
        provRow.connect('notify::selected', () =>
            settings.set_string('provider', PROVIDER_IDS[provRow.get_selected()] ?? 'open-meteo'));
        dataGroup.add(provRow);

        const modelRow = new Adw.ComboRow({
            title: _('Forecast model'),
            subtitle: _('Prediction model (Open-Meteo)'),
            model: new Gtk.StringList({
                strings: [
                    _('Best match (Recommended)'),
                    _('ECMWF IFS (High resolution)'),
                    _('ECMWF IFS (0.25° grid)'),
                    _('DWD ICON (Germany)'),
                    _('NOAA GFS (US)'),
                    _('GEM (Canada)'),
                    _('JMA (Japan)'),
                    _('UK Met Office (10 km)'),
                ],
            }),
        });
        const selectedModelIndex = MODEL_IDS.indexOf(settings.get_string('om-model'));
        modelRow.set_selected(Math.max(selectedModelIndex, 0));
        modelRow.connect('notify::selected', () =>
            settings.set_string('om-model', MODEL_IDS[modelRow.get_selected()] ?? 'best_match'));

        const syncModelRow = () =>
            modelRow.set_visible(provRow.get_selected() === 0);
        provRow.connect('notify::selected', syncModelRow);
        syncModelRow();
        dataGroup.add(modelRow);

        return dataGroup;
    }

    _buildUpdatesGroup(settings) {
        const updGroup = new Adw.PreferencesGroup({ title: _('Data updates') });
        const refreshRow = new Adw.SpinRow({
            title: _('Refresh interval (minutes)'),
            subtitle: _('How often weather is fetched in the background'),
            adjustment: new Gtk.Adjustment({
                lower: 5, upper: 120, step_increment: 5, value: 15,
            }),
        });
        settings.bind('refresh-minutes', refreshRow.get_adjustment(), 'value',
            Gio.SettingsBindFlags.DEFAULT);
        updGroup.add(refreshRow);
        return updGroup;
    }

    _setupAboutButton(window) {
        const findHeaderBar = widget => {
            if (widget instanceof Adw.HeaderBar) return widget;
            let child = widget.get_first_child();
            while (child) {
                const res = findHeaderBar(child);
                if (res) return res;
                child = child.get_next_sibling();
            }
            return null;
        };

        const headerBar = findHeaderBar(window);
        if (headerBar) {
            const aboutBtn = new Gtk.Button({
                icon_name: 'help-about-symbolic',
                tooltip_text: _('About GnomeMeteo'),
                has_frame: false,
                valign: Gtk.Align.CENTER,
            });
            aboutBtn.connect('clicked', () => {
                const AboutClass = Adw.AboutDialog ?? Adw.AboutWindow;
                const dialog = new AboutClass({
                    application_name: 'GnomeMeteo',
                    application_icon: 'org.gnome.Weather-symbolic',
                    version: String(this.metadata.version || '1.0.0'),
                    developer_name: 'OleksiyM',
                    developers: [
                        'OleksiyM',
                        'Vijay Bala (original Weatherglass codebase)',
                    ],
                    website: 'https://github.com/OleksiyM/GnomeMeteo',
                    issue_url: 'https://github.com/OleksiyM/GnomeMeteo/issues',
                    copyright: '© 2026 OleksiyM\nBased on Weatherglass by Vijay Bala',
                    license_type: Gtk.License.GPL_2_0,
                    comments: _('Clean, modern weather indicator and forecast for GNOME Shell'),
                });
                dialog.present(window);
            });
            headerBar.pack_end(aboutBtn);
        }
    }
}
