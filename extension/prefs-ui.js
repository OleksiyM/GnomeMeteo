/* prefs-ui.js -- GnomeMeteo preferences dialog (hot-reloaded by prefs.js). */

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup?version=3.0';
import Cairo from 'cairo';
import Gettext from 'gettext';

// Sibling modules share the cache-busting query from prefs.js (`prefs-ui.js?t=...`).
const reloadStamp = import.meta.url.includes('?') ? `?${import.meta.url.split('?')[1]}` : '';
const { WeatherClient } = await import(`./weather.js${reloadStamp}`);
const { SCALE_MIN_C, SCALE_MAX_C, TEMP_BAR_STYLES, getScaleStops } =
    await import(`./thermal.js${reloadStamp}`);

if (!('_meteoInitialLanguageEnv' in globalThis))
    globalThis._meteoInitialLanguageEnv = GLib.getenv('LANGUAGE');
const INITIAL_LANGUAGE_ENV = globalThis._meteoInitialLanguageEnv;

let _ = str => str;

const UNITS = ['metric', 'imperial'];
const HOURS = ['auto', '12h', '24h'];
const LANGUAGES = ['auto', 'uk', 'ru', 'en'];
const PROVIDER_IDS = ['open-meteo', 'met-norway', 'noaa-nws'];
const MODEL_IDS = [
    'best_match', 'ecmwf_ifs', 'icon_seamless', 'gfs_seamless', 'gem_global',
];
const WEBSITE_URL = 'https://oleksiym.github.io/GnomeMeteo/';
const REPO_URL = 'https://github.com/OleksiyM/GnomeMeteo';
const RELEASES_URL = 'https://github.com/OleksiyM/GnomeMeteo/releases';
const LATEST_RELEASE_API = 'https://api.github.com/repos/OleksiyM/GnomeMeteo/releases/latest';
const X_URL = 'https://x.com/oleksiyML';
const UPDATE_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/OleksiyM/GnomeMeteo/main/install.sh | bash';

function ensureAboutCss() {
    const display = Gdk.Display.get_default();
    if (!display)
        return;
    if (globalThis._meteoAboutCssProvider)
        Gtk.StyleContext.remove_provider_for_display(display, globalThis._meteoAboutCssProvider);
    const provider = new Gtk.CssProvider();
    const css = `
        .meteo-version-pill {
            padding: 2px 10px;
            border-radius: 999px;
            background-color: alpha(currentColor, 0.09);
            font-size: 0.85em;
            font-weight: 600;
        }
        .meteo-update-box {
            padding: 6px 12px;
            border-radius: 10px;
            background-color: alpha(currentColor, 0.06);
        }
        .meteo-about-link {
            padding: 4px 6px;
            min-height: 0;
            min-width: 0;
        }
    `;
    if (provider.load_from_string)
        provider.load_from_string(css);
    else
        provider.load_from_data(css, -1);
    Gtk.StyleContext.add_provider_for_display(
        display,
        provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
    );
    globalThis._meteoAboutCssProvider = provider;
}

function parseSemver(str) {
    const clean = String(str ?? '').trim().replace(/^v/, '');
    const parts = clean.split('.');
    if (parts.length !== 3)
        return null;
    const nums = parts.map(p => (/^\d+$/.test(p) ? Number(p) : NaN));
    return nums.every(Number.isFinite) ? nums : null;
}

function compareVersions(latestTag, currentVersion) {
    const latest = parseSemver(latestTag);
    const cur = parseSemver(currentVersion);
    if (!latest || !cur)
        return { status: 'unknown', tag: null };
    for (let i = 0; i < 3; i++) {
        if (latest[i] > cur[i])
            return { status: 'available', tag: String(latestTag).trim() };
        if (latest[i] < cur[i])
            return { status: 'up-to-date', tag: null };
    }
    return { status: 'up-to-date', tag: null };
}

function checkLatestRelease(currentVersion, cancellable) {
    return new Promise(resolve => {
        const session = new Soup.Session({
            user_agent: `GnomeMeteo/${currentVersion}`,
            timeout: 8,
        });
        const msg = Soup.Message.new('GET', LATEST_RELEASE_API);
        if (!msg) {
            resolve({ status: 'unknown', tag: null });
            return;
        }
        msg.get_request_headers().append('Accept', 'application/vnd.github+json');
        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable, (sess, res) => {
            try {
                const bytes = sess.send_and_read_finish(res);
                if (msg.get_status() !== 200) {
                    resolve({ status: 'unknown', tag: null });
                    return;
                }
                const payload = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                if (typeof payload?.tag_name !== 'string') {
                    resolve({ status: 'unknown', tag: null });
                    return;
                }
                resolve(compareVersions(payload.tag_name, currentVersion));
            } catch {
                resolve({ status: 'unknown', tag: null });
            } finally {
                session.abort();
            }
        });
    });
}

/**
 * Flat "(i)" button that opens a popover with a short help text.
 * `lines` is a list of [name, description] pairs, `note` an optional highlighted line.
 */
function buildHelpButton(lines, note) {
    const esc = GLib.markup_escape_text;
    const body = lines
        .map(([name, text]) => `<b>${esc(name, -1)}</b> — ${esc(text, -1)}`)
        .join('\n\n');
    const markup = note ? `${body}\n\n${esc(note, -1)}` : body;
    const label = new Gtk.Label({
        use_markup: true,
        label: markup,
        wrap: true,
        xalign: 0,
        max_width_chars: 52,
        margin_top: 12,
        margin_bottom: 12,
        margin_start: 12,
        margin_end: 12,
    });
    return new Gtk.MenuButton({
        icon_name: 'help-about-symbolic',
        tooltip_text: _('What is the difference?'),
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
        popover: new Gtk.Popover({ child: label }),
    });
}

function locationLabel(result) {
    return [result.name, result.admin, result.country].filter(Boolean).join(', ');
}

function locationCoordsSubtitle(result) {
    const lat = Number(result.latitude).toFixed(4);
    const lon = Number(result.longitude).toFixed(4);
    return `${lat}, ${lon}`;
}

const reloadSeq = (globalThis._meteoPrefsSeq = (globalThis._meteoPrefsSeq ?? 0) + 1);
const ResultRow = GObject.registerClass(
    { GTypeName: `MeteoResultRow_${Date.now()}_${reloadSeq}` },
    class ResultRow extends Adw.ActionRow {
        _init(result, onActivated) {
            super._init({
                title: locationLabel(result),
                subtitle: locationCoordsSubtitle(result),
                activatable: true,
            });
            const useButton = new Gtk.Button({
                label: _('Select'),
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
            });
            useButton.connect('clicked', () => onActivated());
            this.add_suffix(useButton);
            this.connect('activated', () => onActivated());
        }
    }
);

class PreferencesController {
    constructor(ext) {
        this._ext = ext;
        _ = str => ext.gettext(str);
    }

    _syncLocale(settings) {
        const pref = settings.get_string('language');
        if (pref === 'uk' || pref === 'ru') {
            GLib.setenv('LANGUAGE', pref, true);
        } else if (pref === 'en') {
            GLib.setenv('LANGUAGE', 'C', true);
        } else if (INITIAL_LANGUAGE_ENV !== null && INITIAL_LANGUAGE_ENV !== undefined) {
            GLib.setenv('LANGUAGE', INITIAL_LANGUAGE_ENV, true);
        } else {
            GLib.unsetenv('LANGUAGE');
        }

        const domain = this._ext.metadata['gettext-domain'] ?? this._ext.uuid;
        this._ext.initTranslations(domain);
        Gettext.textdomain(domain);
    }

    _buildPage(settings, client, registerCleanup) {
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

        // 2. Panel indicator & 7-day forecast bars
        page.add(this._buildIndicatorGroup(settings));
        page.add(this._buildForecastGroup(settings, registerCleanup));

        // 3. Units & Language
        page.add(this._buildUnitsGroup(settings));

        // 4. Data & Provider
        page.add(this._buildProviderGroup(settings));
        page.add(this._buildUpdatesGroup(settings));

        return page;
    }

    fillPreferencesWindow(window) {
        window.title = 'GnomeMeteo';
        const settings = this._ext.getSettings();
        const client = new WeatherClient();
        window.set_default_size(580, 780);

        this._syncLocale(settings);

        let pageCleanups = [];
        const registerCleanup = fn => pageCleanups.push(fn);
        const runPageCleanups = () => {
            for (const fn of pageCleanups.splice(0))
                fn();
        };

        let currentPage = this._buildPage(settings, client, registerCleanup);
        window.add(currentPage);

        // Header bar button (i) -> Custom About dialog
        const aboutBtn = this._setupAboutButton(window);

        let rebuildIdleId = 0;
        const langChangedId = settings.connect('changed::language', () => {
            if (rebuildIdleId)
                return;
            rebuildIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                rebuildIdleId = 0;
                runPageCleanups();
                this._syncLocale(settings);
                const nextPage = this._buildPage(settings, client, registerCleanup);
                window.remove(currentPage);
                currentPage = nextPage;
                window.add(currentPage);
                if (aboutBtn)
                    aboutBtn.tooltip_text = _('About GnomeMeteo');
                return GLib.SOURCE_REMOVE;
            });
        });

        window.connect('close-request', () => {
            if (rebuildIdleId) {
                GLib.source_remove(rebuildIdleId);
                rebuildIdleId = 0;
            }
            settings.disconnect(langChangedId);
            runPageCleanups();
            return false;
        });
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

        const spinner = new Gtk.Spinner({
            valign: Gtk.Align.CENTER,
            visible: false,
        });
        const searchBtn = new Gtk.Button({
            icon_name: 'system-search-symbolic',
            tooltip_text: _('Search a city'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        searchEntry.add_suffix(spinner);
        searchEntry.add_suffix(searchBtn);
        searchGroup.add(searchEntry);

        const resultsGroup = new Adw.PreferencesGroup({
            title: _('Results'),
            visible: false,
        });

        const resultRows = [];
        const clearResults = () => {
            // GTK4 widgets have no .destroy(): removing unparents the row cleanly
            for (const row of resultRows.splice(0))
                resultsGroup.remove(row);
            resultsGroup.visible = false;
        };

        const choose = result => {
            settings.set_boolean('auto-location', false);
            settings.set_double('location-latitude', result.latitude);
            settings.set_double('location-longitude', result.longitude);
            settings.set_string('location-name', result.name);
            onSelect(result);
            searchEntry.set_text('');
            clearResults();
        };

        const runSearch = () => {
            const query = searchEntry.get_text().trim();
            if (query.length < 2)
                return;

            searchEntry.remove_css_class('error');
            spinner.visible = true;
            spinner.start();
            searchBtn.sensitive = false;

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
                    const row = new ResultRow(result, () => choose(result));
                    resultRows.push(row);
                    resultsGroup.add(row);
                }
                resultsGroup.visible = true;
            }).catch(err => {
                searchEntry.add_css_class('error');
                logError(err, 'GnomeMeteo prefs geocode');
            }).finally(() => {
                spinner.stop();
                spinner.visible = false;
                searchBtn.sensitive = true;
            });
        };

        searchEntry.connect('entry-activated', runSearch);
        searchBtn.connect('clicked', runSearch);
        searchEntry.connect('changed', () => searchEntry.remove_css_class('error'));

        return [searchGroup, resultsGroup];
    }

    _buildManualLocationGroup(settings) {
        const manualGroup = new Adw.PreferencesGroup({
            title: _('Selected coordinates'),
            description: _('Coordinates used for the weather forecast'),
        });

        const nameEntry = new Adw.EntryRow({
            title: _('Display name'),
            show_apply_button: true,
        });
        const latEntry = new Adw.EntryRow({
            title: _('Latitude'),
            show_apply_button: true,
        });
        const lonEntry = new Adw.EntryRow({
            title: _('Longitude'),
            show_apply_button: true,
        });

        nameEntry.set_text(settings.get_string('location-name'));
        latEntry.set_text(settings.get_double('location-latitude').toFixed(4));
        lonEntry.set_text(settings.get_double('location-longitude').toFixed(4));

        const applyName = () => {
            const val = nameEntry.get_text().trim();
            if (val)
                settings.set_string('location-name', val);
        };
        const applyLat = () => {
            const val = parseFloat(latEntry.get_text().replace(',', '.'));
            if (Number.isFinite(val) && val >= -90 && val <= 90) {
                settings.set_double('location-latitude', val);
                settings.set_boolean('auto-location', false);
                latEntry.remove_css_class('error');
            } else {
                latEntry.add_css_class('error');
            }
        };
        const applyLon = () => {
            const val = parseFloat(lonEntry.get_text().replace(',', '.'));
            if (Number.isFinite(val) && val >= -180 && val <= 180) {
                settings.set_double('location-longitude', val);
                settings.set_boolean('auto-location', false);
                lonEntry.remove_css_class('error');
            } else {
                lonEntry.add_css_class('error');
            }
        };

        nameEntry.connect('apply', applyName);
        nameEntry.connect('entry-activated', applyName);
        latEntry.connect('apply', applyLat);
        latEntry.connect('entry-activated', applyLat);
        lonEntry.connect('apply', applyLon);
        lonEntry.connect('entry-activated', applyLon);

        manualGroup.add(nameEntry);
        manualGroup.add(latEntry);
        manualGroup.add(lonEntry);

        return {
            group: manualGroup,
            setLocation(lat, lon, name) {
                latEntry.set_text(Number(lat).toFixed(4));
                lonEntry.set_text(Number(lon).toFixed(4));
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

        // Prevent disabling both toggles simultaneously: if one is turned off while the other is off,
        // automatically enable the other so UI toggles always match the actual panel state.
        let syncing = false;
        tempRow.connect('notify::active', () => {
            if (syncing) return;
            if (!tempRow.active && !iconRow.active) {
                syncing = true;
                iconRow.active = true;
                syncing = false;
            }
        });
        iconRow.connect('notify::active', () => {
            if (syncing) return;
            if (!iconRow.active && !tempRow.active) {
                syncing = true;
                tempRow.active = true;
                syncing = false;
            }
        });

        lookGroup.add(tempRow);
        lookGroup.add(iconRow);
        return lookGroup;
    }

    _buildForecastGroup(settings, registerCleanup) {
        const forecastGroup = new Adw.PreferencesGroup({
            title: _('7-day forecast'),
            description: _('Range and intensity bars in the forecast popup'),
        });

        const styleRow = new Adw.ComboRow({
            title: _('Bar color style'),
            subtitle: _('Color palette for temperature, precipitation and wind'),
            model: new Gtk.StringList({
                strings: [_('Thermal spectrum'), _('Minimalist')],
            }),
        });
        const currentStyle = settings.get_string('temp-bar-style');
        styleRow.set_selected(Math.max(0, TEMP_BAR_STYLES.indexOf(currentStyle)));
        styleRow.connect('notify::selected', () =>
            settings.set_string('temp-bar-style', TEMP_BAR_STYLES[styleRow.get_selected()] ?? 'spectrum'));
        forecastGroup.add(styleRow);

        const drawRoundedRect = (cr, x, y, w, h, r) => {
            const rad = Math.min(r, w / 2, h / 2);
            cr.newSubPath();
            cr.arc(x + w - rad, y + rad, rad, -Math.PI / 2, 0);
            cr.arc(x + w - rad, y + h - rad, rad, 0, Math.PI / 2);
            cr.arc(x + rad, y + h - rad, rad, Math.PI / 2, Math.PI);
            cr.arc(x + rad, y + rad, rad, Math.PI, 3 * Math.PI / 2);
            cr.closePath();
        };

        const formatScaleTemp = (celsius, isImperial) => {
            if (isImperial)
                return `${Math.round(celsius * 9 / 5 + 32)}°`;
            if (celsius > 0)
                return `+${celsius}°`;
            return `${celsius}°`;
        };

        const previewArea = new Gtk.DrawingArea({
            content_height: 58,
            hexpand: true,
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 12,
            margin_end: 12,
        });

        previewArea.set_draw_func((area, cr, width, height) => {
            if (width <= 0 || height <= 0)
                return;

            const style = settings.get_string('temp-bar-style');
            const showZero = settings.get_boolean('show-zero-mark');
            const showDot = settings.get_boolean('show-current-temp-dot');
            const isImperial = settings.get_string('units') === 'imperial';

            // Dark popup-matching card backdrop so palette, 0° tick, and dot read accurately
            drawRoundedRect(cr, 0.5, 0.5, width - 1, height - 1, 10);
            cr.setSourceRGB(0.145, 0.157, 0.192);
            cr.fillPreserve();
            cr.setSourceRGBA(1, 1, 1, 0.09);
            cr.setLineWidth(1);
            cr.stroke();

            const barX = 24;
            const barW = Math.max(40, width - 48);
            const barY = 14;
            const barH = 6;
            const span = SCALE_MAX_C - SCALE_MIN_C;

            const stops = getScaleStops(style);
            const grad = new Cairo.LinearGradient(barX, 0, barX + barW, 0);
            for (const [tempC, [r, g, b]] of stops) {
                const offset = Math.max(0, Math.min(1, (tempC - SCALE_MIN_C) / span));
                grad.addColorStopRGB(offset, r / 255, g / 255, b / 255);
            }

            drawRoundedRect(cr, barX, barY, barW, barH, 3);
            cr.setSource(grad);
            cr.fill();

            if (showZero) {
                const zeroX = Math.round(barX + ((0 - SCALE_MIN_C) / span) * barW);
                cr.setSourceRGBA(0.06, 0.075, 0.10, 0.58);
                cr.rectangle(zeroX - 1.5, barY - 3, 3, barH + 6);
                cr.fill();

                cr.setSourceRGBA(1, 1, 1, 0.88);
                cr.rectangle(zeroX - 0.5, barY - 2, 1, barH + 4);
                cr.fill();
            }

            if (showDot) {
                const dotX = Math.round(barX + ((15 - SCALE_MIN_C) / span) * barW);
                const dotY = barY + barH / 2;

                cr.setSourceRGBA(0.07, 0.086, 0.118, 0.92);
                cr.arc(dotX, dotY, 5, 0, Math.PI * 2);
                cr.fill();

                cr.setSourceRGB(1, 1, 1);
                cr.arc(dotX, dotY, 2.75, 0, Math.PI * 2);
                cr.fill();
            }

            const ticks = [-20, -10, 0, 10, 20, 35];
            cr.selectFontFace('Cantarell', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
            cr.setFontSize(10.5);

            for (const tC of ticks) {
                const tx = Math.round(barX + ((tC - SCALE_MIN_C) / span) * barW);
                const isZero = tC === 0;

                cr.setSourceRGBA(1, 1, 1, isZero && showZero ? 0.72 : 0.25);
                cr.rectangle(tx - 0.5, barY + barH + 4, 1, 3);
                cr.fill();

                const label = formatScaleTemp(tC, isImperial);
                cr.selectFontFace(
                    'Cantarell',
                    Cairo.FontSlant.NORMAL,
                    isZero && showZero ? Cairo.FontWeight.BOLD : Cairo.FontWeight.NORMAL
                );
                const ext = cr.textExtents(label);
                let textX = tx - (ext.width / 2 + ext.xBearing);
                textX = Math.max(8, Math.min(width - ext.width - 8, textX));

                cr.setSourceRGBA(1, 1, 1, isZero && showZero ? 0.95 : 0.65);
                cr.moveTo(textX, barY + barH + 20);
                cr.showText(label);
            }
        });

        const previewRow = new Adw.PreferencesRow({
            activatable: false,
            focusable: false,
        });
        previewRow.set_child(previewArea);
        forecastGroup.add(previewRow);

        const dotRow = new Adw.SwitchRow({
            title: _('Current temperature dot'),
            subtitle: _('Mark current temperature on Today’s range bar'),
        });
        settings.bind('show-current-temp-dot', dotRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        forecastGroup.add(dotRow);

        const zeroRow = new Adw.SwitchRow({
            title: _('Freezing point mark (0°)'),
            subtitle: _('Show 0° threshold on Today’s bar when in range'),
        });
        settings.bind('show-zero-mark', zeroRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        forecastGroup.add(zeroRow);

        const previewChangedId = settings.connect('changed', (_s, key) => {
            if (['temp-bar-style', 'show-current-temp-dot', 'show-zero-mark', 'units'].includes(key))
                previewArea.queue_draw();
        });
        registerCleanup(() => settings.disconnect(previewChangedId));

        return forecastGroup;
    }

    _buildUnitsGroup(settings) {
        const unitsGroup = new Adw.PreferencesGroup({ title: _('Units and Format') });

        const langRow = new Adw.ComboRow({
            title: _('Language'),
            subtitle: _('Interface display language'),
            model: new Gtk.StringList({
                strings: [_('Automatic (system)'), 'Українська', 'Русский', 'English'],
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
        provRow.add_suffix(buildHelpButton([
            ['Open-Meteo', _('Full data set: humidity, pressure, UV, visibility, rain probability. The best choice almost everywhere.')],
            ['MET Norway', _('Strong in Europe. Publishes no rain probability and no visibility: these are shown as “—”.')],
            ['NOAA NWS', _('United States only. Other regions return an error.')],
        ], '🇺🇦 ' + _('Ukraine: use Open-Meteo with “Best match”.')));
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
                    _('DWD ICON (Germany)'),
                    _('NOAA GFS (US)'),
                    _('GEM (Canada)'),
                ],
            }),
        });
        modelRow.add_suffix(buildHelpButton([
            [_('Best match (Recommended)'), _('Picks the best local models automatically (ICON and ECMWF in Europe). Full data set.')],
            [_('ECMWF IFS (High resolution)'), _('Often the most accurate for days 3–7 in Europe. No UV index.')],
            [_('DWD ICON (Germany)'), _('Strong for Central and Eastern Europe. No UV index.')],
            [_('NOAA GFS (US)'), _('Global model, best suited for North America. Full data set.')],
            [_('GEM (Canada)'), _('Best suited for North America. No UV index, visibility or CAPE.')],
        ], '🇺🇦 ' + _('Ukraine: “Best match”, or ECMWF IFS for the longer range.')));
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

    _createAppIcon() {
        const assetsDir = this._ext.dir.get_child('assets');
        for (const name of ['gnome-meteo-512.png', 'gnome-meteo-icon.svg', 'gnome-meteo-128.png']) {
            try {
                const file = assetsDir.get_child(name);
                const texture = Gdk.Texture.new_from_file(file);
                return new Gtk.Image({
                    paintable: texture,
                    pixel_size: 76,
                    halign: Gtk.Align.CENTER,
                    margin_bottom: 4,
                });
            } catch {
                // Try next bundled asset fallback
            }
        }
        return new Gtk.Image({
            icon_name: 'weather-clear-symbolic',
            pixel_size: 64,
            halign: Gtk.Align.CENTER,
            margin_bottom: 4,
        });
    }

    _presentAboutDialog(window) {
        ensureAboutCss();

        const currentVersion = this._ext.metadata['version-name'] ?? '1.3.0';
        const cancellable = new Gio.Cancellable();
        let alive = true;
        let copyResetId = 0;

        const contentBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            margin_top: 0,
            margin_bottom: 22,
            margin_start: 22,
            margin_end: 22,
            halign: Gtk.Align.FILL,
        });

        contentBox.append(this._createAppIcon());

        contentBox.append(new Gtk.Label({
            label: 'GnomeMeteo',
            css_classes: ['title-2'],
            halign: Gtk.Align.CENTER,
        }));

        contentBox.append(new Gtk.Label({
            label: `v${currentVersion}`,
            css_classes: ['meteo-version-pill', 'dim-label'],
            halign: Gtk.Align.CENTER,
        }));

        // Live GitHub release update check block
        const updateBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            halign: Gtk.Align.CENTER,
            margin_top: 2,
            margin_bottom: 2,
        });

        const statusRow = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });

        const spinner = new Gtk.Spinner({
            spinning: true,
            valign: Gtk.Align.CENTER,
        });
        const statusIcon = new Gtk.Image({
            visible: false,
            pixel_size: 14,
            valign: Gtk.Align.CENTER,
        });
        const statusLabel = new Gtk.Label({
            label: _('Checking for updates…'),
            css_classes: ['dim-label', 'caption'],
            valign: Gtk.Align.CENTER,
        });

        statusRow.append(spinner);
        statusRow.append(statusIcon);
        statusRow.append(statusLabel);
        updateBox.append(statusRow);

        const actionRow = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 4,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            visible: false,
        });

        const siteUpdateBtn = Gtk.LinkButton.new_with_label(WEBSITE_URL, _('Open website to update'));
        siteUpdateBtn.add_css_class('meteo-about-link');

        const copyBtn = new Gtk.Button({
            icon_name: 'edit-copy-symbolic',
            tooltip_text: _('Copy update command'),
            css_classes: ['flat', 'circular'],
            valign: Gtk.Align.CENTER,
        });
        copyBtn.connect('clicked', () => {
            try {
                const bytes = new GLib.Bytes(new TextEncoder().encode(UPDATE_COMMAND));
                copyBtn.get_clipboard().set_content(
                    Gdk.ContentProvider.new_for_bytes('text/plain;charset=utf-8', bytes)
                );
                copyBtn.icon_name = 'object-select-symbolic';
                copyBtn.add_css_class('success');
                copyBtn.tooltip_text = _('Copied!');
                if (copyResetId)
                    GLib.source_remove(copyResetId);
                copyResetId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1600, () => {
                    copyResetId = 0;
                    if (alive) {
                        copyBtn.icon_name = 'edit-copy-symbolic';
                        copyBtn.remove_css_class('success');
                        copyBtn.tooltip_text = _('Copy update command');
                    }
                    return GLib.SOURCE_REMOVE;
                });
            } catch (err) {
                logError(err, 'GnomeMeteo copy update command');
            }
        });

        actionRow.append(siteUpdateBtn);
        actionRow.append(copyBtn);
        updateBox.append(actionRow);
        contentBox.append(updateBox);

        checkLatestRelease(currentVersion, cancellable).then(result => {
            if (!alive)
                return;
            spinner.stop();
            spinner.visible = false;
            if (result.status === 'up-to-date') {
                statusIcon.icon_name = 'object-select-symbolic';
                statusIcon.css_classes = ['success'];
                statusIcon.visible = true;
                statusLabel.label = _('You are up to date');
            } else if (result.status === 'available') {
                statusIcon.icon_name = 'software-update-available-symbolic';
                statusIcon.css_classes = ['accent'];
                statusIcon.visible = true;
                statusLabel.label = _('Update available: %s').replace('%s', result.tag);
                statusLabel.css_classes = ['heading', 'caption'];
                updateBox.add_css_class('meteo-update-box');
                actionRow.visible = true;
            } else {
                statusLabel.label = _('Could not check for updates');
            }
        });

        contentBox.append(new Gtk.Label({
            label: _('Clean, modern weather indicator and forecast for GNOME Shell'),
            justify: Gtk.Justification.CENTER,
            wrap: true,
            max_width_chars: 38,
            margin_top: 4,
        }));

        contentBox.append(new Gtk.Separator({
            orientation: Gtk.Orientation.HORIZONTAL,
            margin_top: 6,
            margin_bottom: 2,
        }));

        const linksBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 2,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });

        const links = [
            [_('Website'), WEBSITE_URL],
            [_('Releases'), RELEASES_URL],
            ['GitHub', REPO_URL],
            ['X (@oleksiyML)', X_URL],
        ];
        links.forEach(([label, uri], idx) => {
            if (idx > 0) {
                linksBox.append(new Gtk.Label({
                    label: '|',
                    css_classes: ['dim-label'],
                }));
            }
            const btn = Gtk.LinkButton.new_with_label(uri, label);
            btn.add_css_class('meteo-about-link');
            linksBox.append(btn);
        });
        contentBox.append(linksBox);

        contentBox.append(new Gtk.Label({
            label: `© 2026 OleksiyM · GPL-3.0\n${_('Based on Weatherglass by Vijay Bala')}`,
            justify: Gtk.Justification.CENTER,
            css_classes: ['dim-label', 'caption'],
            margin_top: 4,
        }));

        const cleanup = () => {
            alive = false;
            cancellable.cancel();
            if (copyResetId) {
                GLib.source_remove(copyResetId);
                copyResetId = 0;
            }
        };

        if (Adw.Dialog) {
            const dialog = new Adw.Dialog({
                title: _('About GnomeMeteo'),
                content_width: 400,
            });
            const headerBar = new Adw.HeaderBar({
                show_title: false,
                css_classes: ['flat'],
            });
            if (Adw.ToolbarView) {
                const toolbarView = new Adw.ToolbarView();
                toolbarView.add_top_bar(headerBar);
                toolbarView.set_content(contentBox);
                dialog.set_child(toolbarView);
            } else {
                const rootBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
                rootBox.append(headerBar);
                rootBox.append(contentBox);
                dialog.set_child(rootBox);
            }
            dialog.connect('closed', cleanup);
            dialog.present(window);
        } else {
            const win = new Adw.Window({
                title: _('About GnomeMeteo'),
                default_width: 400,
                resizable: false,
                modal: true,
                transient_for: window,
            });
            const rootBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
            rootBox.append(new Adw.HeaderBar({
                show_title: false,
                css_classes: ['flat'],
            }));
            rootBox.append(contentBox);
            win.set_content(rootBox);

            const keyCtrl = new Gtk.EventControllerKey();
            keyCtrl.connect('key-pressed', (_ctrl, keyval) => {
                if (keyval === Gdk.KEY_Escape) {
                    win.close();
                    return true;
                }
                return false;
            });
            win.add_controller(keyCtrl);

            win.connect('close-request', () => {
                cleanup();
                return false;
            });
            win.present();
        }
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
            aboutBtn.connect('clicked', () => this._presentAboutDialog(window));
            headerBar.pack_end(aboutBtn);
            return aboutBtn;
        }
        return null;
    }
}

export function fillPreferencesWindow(ext, window) {
    const controller = new PreferencesController(ext);
    controller.fillPreferencesWindow(window);
}
