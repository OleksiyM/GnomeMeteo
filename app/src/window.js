// window.js — AdwApplicationWindow with a city sidebar (split view):
// per-city rows (glyph · name · local clock · temperature), row menus for
// move/remove, header menu for units / refresh interval / motion / about.

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import { CityPage } from './citypage.js';
import { AddCityDialog } from './addcity.js';
import { makeWeatherIcon } from './glyph.js';
import { fmtTemp, cityWallMs, fmtClock, sceneFor, brandTexture } from './weather.js';

function cityRowMenu() {
    const menu = new Gio.Menu();
    menu.append('Move Up', 'row.move::-1');
    menu.append('Move Down', 'row.move::1');
    menu.append('Remove…', 'row.remove');
    return menu;
}

const CityRow = GObject.registerClass({ gTypeName: 'WCityRow' },
class CityRow extends Gtk.ListBoxRow {
    city;

    #bus;
    #glyphState = { scene: 'partly', night: false };
    #nameLabel; #tempLabel; #timeLabel; #revealer;
    #ticker = 0;

    constructor(bus, city) {
        super();
        this.city = city;
        this.#bus = bus;

        const outer = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });

        const row = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            margin_top: 6, margin_bottom: 6,
            margin_start: 8, margin_end: 4,
        });

        const glyph = makeWeatherIcon(26, () => this.#glyphState,
            () => bus.config.animate);
        row.append(glyph);

        const text = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            valign: Gtk.Align.CENTER,
            hexpand: true,
        });
        this.#nameLabel = new Gtk.Label({ label: city.name, xalign: 0 });
        this.#nameLabel.set_ellipsize(3);
        text.append(this.#nameLabel);
        const subtitle = [city.admin1, city.countryCode].filter(Boolean).join(' · ');
        if (subtitle) {
            const sub = new Gtk.Label({ label: subtitle, xalign: 0, css_classes: ['dim-label', 'caption'] });
            sub.set_ellipsize(3);
            text.append(sub);
        }
        row.append(text);

        const trailing = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            valign: Gtk.Align.CENTER,
        });
        this.#tempLabel = new Gtk.Label({ label: '', css_classes: ['city-temp'] });
        this.#timeLabel = new Gtk.Label({ label: '', css_classes: ['dim-label', 'caption'] });
        trailing.append(this.#tempLabel);
        trailing.append(this.#timeLabel);
        row.append(trailing);

        const menuBtn = new Gtk.MenuButton({
            valign: Gtk.Align.CENTER,
            icon_name: 'view-more-symbolic',
            tooltip_text: 'City options',
            primary: false,
        });
        menuBtn.set_menu_model(cityRowMenu());
        row.append(menuBtn);

        outer.append(row);

        // inline confirm-before-delete
        this.#revealer = new Gtk.Revealer({
            transition_type: Gtk.RevealerTransitionType.SLIDE_DOWN,
        });
        const confirmBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            margin_start: 12, margin_end: 12, margin_bottom: 8,
        });
        const del = new Gtk.Button({ label: 'Confirm Remove', hexpand: true });
        del.add_css_class('destructive-action');
        del.connect('clicked', () => bus.emit('remove-city', city.id));
        const cancel = new Gtk.Button({ label: 'Keep' });
        cancel.connect('clicked', () => this.#revealer.set_reveal_child(false));
        confirmBox.append(del);
        confirmBox.append(cancel);
        this.#revealer.set_child(confirmBox);
        outer.append(this.#revealer);

        this.set_child(outer);

        // widget-local actions powering the popover menu
        const group = new Gio.SimpleActionGroup();
        const moveAct = new Gio.SimpleAction({
            name: 'move',
            parameter_type: new GLib.VariantType('i'),
        });
        moveAct.connect('activate', (_a, p) => bus.emit('move-city', city.id, p.get_int32()));
        group.add_action(moveAct);
        const removeAct = new Gio.SimpleAction({ name: 'remove' });
        removeAct.connect('activate', () => this.#revealer.set_reveal_child(true));
        group.add_action(removeAct);
        this.insert_action_group('row', group);

        bus.on('forecast-updated', (id, data) => {
            if (id !== city.id) return;
            this.#hydrate(data);
        });
        bus.on('units-changed', () => this.#relabel());
        bus.on('locale-props', () => this.#refreshTime());
        bus.on('config-changed', kind => { if (kind === 'animate') glyph.queue_draw(); });

        const cached = bus.forecasts?.getState(city.id);
        if (cached?.data) this.#hydrate(cached.data);
    }

    #hydrate(data) {
        const s = sceneFor(data.current.code, data.current.isDay);
        this.#glyphState = { scene: s.scene, night: s.night };
        this.#relabel();
    }

    #relabel() {
        const state = this.#bus.forecasts?.getState(this.city.id);
        if (state?.data)
            this.#tempLabel.label = fmtTemp(state.data.current.temp, this.#bus.config.units);
        this.#refreshTime();
    }

    #refreshTime() {
        const state = this.#bus.forecasts?.getState(this.city.id);
        this.#timeLabel.label = state?.data
            ? fmtClock(cityWallMs(state.data), this.#bus.locale.h12)
            : '';
    }

    vfunc_map() {
        super.vfunc_map();
        if (!this.#ticker) {
            this.#ticker = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 20, () => {
                this.#refreshTime();
                return GLib.SOURCE_CONTINUE;
            });
            this.#refreshTime();
        }
    }

    vfunc_unmap() {
        if (this.#ticker) {
            GLib.Source.remove(this.#ticker);
            this.#ticker = 0;
        }
        super.vfunc_unmap();
    }
});

export const MainWindow = GObject.registerClass({ gTypeName: 'WMainWindow' },
class MainWindow extends Adw.ApplicationWindow {
    #bus;
    #sidebarList; #contentStack; #navPage; #emptyNavPage; #split;
    #rows = new Map();
    #pages = new Map();
    #suspendSelectionSignal = false;

    constructor(app) {
        super({ application: app, default_width: 1040, default_height: 740 });
        this.#bus = app.bus;

        this.#contentStack = new Gtk.Stack({ vhomogeneous: false });
        this.#navPage = new Adw.NavigationPage({
            title: 'WeatherGlass',
            child: this.#contentStack,
        });

        const emptyBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });
        emptyBox.append(makeWeatherIcon(84, () => ({ scene: 'partly' }),
            () => this.#bus.config.animate));
        emptyBox.append(new Gtk.Label({
            label: 'No cities yet.\nAdd a city or region to see its forecast here.',
            justify: Gtk.Justification.CENTER,
            css_classes: ['dim-label'],
        }));
        const emptyAdd = new Gtk.Button({ label: 'Add a City', halign: Gtk.Align.CENTER });
        emptyAdd.add_css_class('suggested-action');
        emptyAdd.connect('clicked', () => this.offerAddCity());
        emptyBox.append(emptyAdd);
        this.#emptyNavPage = new Adw.NavigationPage({ title: 'WeatherGlass', child: emptyBox });

        // sidebar
        this.#sidebarList = new Gtk.ListBox({ vexpand: true });
        this.#sidebarList.set_selection_mode(Gtk.SelectionMode.SINGLE);
        this.#sidebarList.add_css_class('navigation-sidebar');
        this.#sidebarList.connect('row-selected', (_l, row) => {
            if (!row?.city || this.#suspendSelectionSignal) return;
            this.#bus.config.setActiveCity(row.city.id);
        });

        const sidebarBottom = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            margin_top: 6, margin_bottom: 8,
            margin_start: 8, margin_end: 8,
        });
        const addBtn = new Gtk.Button({ label: 'Add City', hexpand: true });
        addBtn.add_css_class('flat');
        addBtn.connect('clicked', () => this.offerAddCity());
        sidebarBottom.append(addBtn);

        const sidebarToolbar = new Adw.HeaderBar();
        const menuBtn = new Gtk.MenuButton({ icon_name: 'open-menu-symbolic' });
        menuBtn.set_menu_model(this.#buildAppMenu());
        sidebarToolbar.pack_end(menuBtn);
        sidebarToolbar.set_title_widget(new Gtk.Label({
            label: 'WeatherGlass',
            css_classes: ['title'],
        }));

        const sidebarBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
        sidebarBox.append(sidebarToolbar);
        const listScroll = new Gtk.ScrolledWindow();
        listScroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        listScroll.set_child(this.#sidebarList);
        sidebarBox.append(listScroll);
        sidebarBox.append(sidebarBottom);

        this.#split = new Adw.NavigationSplitView({
            sidebar: new Adw.NavigationPage({ title: 'Cities', child: sidebarBox }),
            content: this.#navPage,
            collapsed: false,
        });
        // Permanent ✕ furniture, top-right. Doctrine says chrome over the
        // animated sky is ALWAYS dark glass with white ink (menu.js
        // THEME_CONFIG), so unlike the day tiles this one needs no .sky-on
        // variant: the plate itself carries the contrast on any ground.
        const rootOverlay = new Gtk.Overlay();
        rootOverlay.set_child(this.#split);
        const closeButton = new Gtk.Button({
            iconName: 'window-close-symbolic',
            valign: Gtk.Align.START,
            halign: Gtk.Align.END,
            marginTop: 7,
            marginEnd: 7,
            tooltipText: 'Close (Ctrl+W)',
            cssClasses: ['win-close'],
        });
        closeButton.connect('clicked', () => this.close());
        rootOverlay.add_overlay(closeButton);
        this.set_content(rootOverlay);

        this.#registerActions(app);

        this.application.set_accels_for_action('win.close', ['<Primary>W']);
        this.application.set_accels_for_action('win.refresh', ['<Primary>R']);
        this.application.set_accels_for_action('win.add-city', ['<Primary>N']);

        this.#hookBus();
        this.sync();
    }

    #buildAppMenu() {
        const menu = new Gio.Menu();
        const units = new Gio.Menu();
        units.append('Metric (°C · km/h)', 'win.units::metric');
        units.append('Imperial (°F · mph)', 'win.units::imperial');
        menu.append_submenu('Units', units);

        const refresh = new Gio.Menu();
        for (const m of this.#bus.config.refreshChoices)
            refresh.append(`${m} min`, `win.interval::${m}`);
        menu.append_submenu('Refresh every', refresh);

        const misc = new Gio.Menu();
        misc.append('Sky Background', 'win.sky');
        misc.append('Animated Icons', 'win.animate');
        misc.append('Keyboard Shortcuts', 'win.shortcuts');
        misc.append('About WeatherGlass', 'win.about');
        menu.append_section(null, misc);
        return menu;
    }

    #registerActions(app) {
        const cfg = this.#bus.config;

        const unitsAct = new Gio.SimpleAction({
            name: 'units',
            parameter_type: new GLib.VariantType('s'),
            state: new GLib.Variant('s', cfg.units),
        });
        unitsAct.connect('change-state', (a, v) => {
            cfg.setUnits(v.get_string()[0]);
            a.state = v;
        });
        this.add_action(unitsAct);

        const intervalAct = new Gio.SimpleAction({
            name: 'interval',
            parameter_type: new GLib.VariantType('s'),
            state: new GLib.Variant('s', String(cfg.refreshMinutes)),
        });
        intervalAct.connect('change-state', (a, v) => {
            cfg.setRefreshMinutes(parseInt(v.get_string()[0], 10));
            a.state = v;
        });
        this.add_action(intervalAct);

        const animateAct = new Gio.SimpleAction({
            name: 'animate',
            state: new GLib.Variant('b', cfg.animate),
        });
        animateAct.connect('activate', a => {
            const on = !a.state.get_boolean();
            cfg.setAnimate(on);
            a.state = new GLib.Variant('b', on);
            this.#bus.emit('config-changed', 'animate');
        });
        this.add_action(animateAct);

        const skyAct = new Gio.SimpleAction({
            name: 'sky',
            state: new GLib.Variant('b', cfg.sky),
        });
        skyAct.connect('activate', a => {
            const on = !a.state.get_boolean();
            cfg.setSky(on); // emits config-changed 'sky'; pages react
            a.state = new GLib.Variant('b', on);
        });
        this.add_action(skyAct);

        const simple = (name, cb) => {
            const a = new Gio.SimpleAction({ name });
            a.connect('activate', cb);
            this.add_action(a);
        };
        simple('close', () => this.close());
        simple('refresh',
            () => this.#bus.forecasts.kick(this.#bus.config.activeCityId, true));
        simple('add-city', () => this.offerAddCity());
        simple('about', () => showAbout(this));
        simple('shortcuts', () => showShortcuts(this));
    }

    #hookBus() {
        const bus = this.#bus;
        bus.on('config-changed', kind => {
            if (kind === 'active-city' || kind === 'units') this.sync();
        });
        bus.on('cities-changed', () => this.sync());
        bus.on('remove-city', id => bus.config.removeCity(id));
        bus.on('move-city', (id, delta) => bus.config.moveCity(id, delta));
        bus.on('request-refresh', id => bus.forecasts.kick(id, true));

        Adw.StyleManager.get_default().connect('notify::dark', sm => {
            for (const page of this.#pages.values())
                page.dark = sm.dark;
        });
    }

    #rowIndexOf(row) {
        let i = 0;
        for (let c = this.#sidebarList.get_first_child(); c; c = c.get_next_sibling()) {
            if (c === row) return i;
            i++;
        }
        return -1;
    }

    offerAddCity() {
        const dlg = new AddCityDialog(loc => this.#bus.config.addCity(loc));
        this.present_dialog(null, null, dlg, () => {});
    }

    sync() {
        const bus = this.#bus;
        const cities = bus.config.cities;

        for (const city of cities) {
            if (!this.#rows.has(city.id)) {
                const row = new CityRow(bus, city);
                this.#sidebarList.append(row);
                this.#rows.set(city.id, row);
            }
            if (!this.#pages.has(city.id)) {
                const page = new CityPage(bus, city);
                page.dark = Adw.StyleManager.get_default().dark;
                this.#contentStack.add_named(page, city.id);
                this.#pages.set(city.id, page);
            }
        }
        for (const [id, row] of [...this.#rows]) {
            if (cities.some(c => c.id === id)) continue;
            row.parent?.remove(row);
            this.#rows.delete(id);
            const pg = this.#pages.get(id);
            if (pg) {
                this.#contentStack.remove(pg);
                this.#pages.delete(id);
            }
        }
        cities.forEach((c, i) => {
            const row = this.#rows.get(c.id);
            if (row && this.#rowIndexOf(row) !== i)
                this.#sidebarList.insert(row, i); // insert() moves existing rows
        });

        if (!cities.length) {
            this.#split.set_content(this.#emptyNavPage);
            return;
        }
        this.#split.set_content(this.#navPage);
        const activeId = cities.some(c => c.id === bus.config.activeCityId)
            ? bus.config.activeCityId : cities[0].id;
        this.#contentStack.set_visible_child_name(activeId);
        this.#suspendSelectionSignal = true;
        this.#sidebarList.select_row(this.#rows.get(activeId) ?? null);
        this.#suspendSelectionSignal = false;

        const city = cities.find(c => c.id === activeId);
        if (city) {
            this.#navPage.title = city.name;
            this.title = `${city.name} — WeatherGlass`;
        }
    }
});

function showAbout(window) {
    const about = new Adw.AboutDialog({
        application_name: 'WeatherGlass',
        application_icon: 'dev.vijaybala.weatherglassapp',
        version: '0.1.0',
        developer_name: 'vijaybala',
        license: Gtk.License.GPL_3_0,
        website: 'https://github.com/vsbala/weatherglass',
        comments: 'A standalone weather app for GNOME — multiple cities, '
            + 'procedural animated icons, powered by Open-Meteo. '
            + 'Companion to the WeatherGlass GNOME Shell extension.',
        copyright: '© 2026 vijaybala',
    });
    const brand = brandTexture(256);
    if (brand)
        about.set_logo(brand);
    about.present(window);
}

function buildShortcutsGroup(title, keys) {
    const grp = new Gtk.ShortcutsGroup({ visible: true, title });
    for (const [accel, text] of keys)
        grp.append(new Gtk.ShortcutsShortcut({ visible: true, accelerator: accel, title: text }));
    return grp;
}

function showShortcuts(window) {
    const win = new Gtk.ShortcutsWindow({ title: 'Keyboard Shortcuts', modal: true });
    const section = new Gtk.ShortcutsSection({
        visible: true,
        section_name: 'shortcuts',
        max_height: 10,
    });
    section.append(buildShortcutsGroup('WeatherGlass', [
        ['<ctrl>R', 'Refresh forecast'],
        ['<ctrl>N', 'Add a city'],
        ['<ctrl>Q', 'Quit'],
    ]));
    win.append(section);
    win.present(window);
}
