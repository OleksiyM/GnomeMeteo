// addcity.js — geocoder-powered "add city" dialog plus a manual lat/lon
// escape hatch (mirrors the extension prefs' search + manual entry rows).

import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import { geocode, locationLabel } from './weather.js';

const IDLE_HINT = 'Type at least two letters — try “Berlin”, “Bengaluru”, or “Provence”.';

export const AddCityDialog = GObject.registerClass({ gTypeName: 'WAddCityDialog' },
class AddCityDialog extends Adw.Dialog {
    #onPick;
    #entry; #results; #hint; #spinner; #debounce = 0;
    #latEntry; #lonEntry; #nameEntry; #manualAddBtn;
    #searchToken = 0;

    constructor(onPick) {
        super({ title: 'Add a City or Region', content_width: 380, content_height: 460 });
        this.#onPick = onPick;

        const root = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });

        const toolbar = new Adw.HeaderBar();
        toolbar.pack_start(new Gtk.Button({
            icon_name: 'window-close-symbolic',
            action_name: 'dialog.close',
        }));
        root.append(toolbar);

        const clamp = new Adw.Clamp({
            maximum_size: 460,
            margin_top: 8, margin_bottom: 8,
            margin_start: 12, margin_end: 12,
        });
        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });

        // search row with inline spinner
        const searchOverlay = new Gtk.Overlay();
        this.#entry = new Adw.EntryRow({ title: 'Search cities or regions', show_clear_icon: true });
        searchOverlay.set_child(this.#entry);
        this.#spinner = new Gtk.Spinner({
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.END,
            margin_end: 10,
            visible: false,
        });
        searchOverlay.add_overlay(this.#spinner);
        searchOverlay.set_measure_child(this.#entry, true);
        box.append(searchOverlay);

        this.#hint = new Gtk.Label({
            label: IDLE_HINT,
            css_classes: ['dim-label', 'caption'],
            wrap: true,
            xalign: 0,
        });
        box.append(this.#hint);

        this.#results = new Gtk.ListBox({ vexpand: true });
        this.#results.add_css_class('boxed-list');
        const scroller = new Gtk.ScrolledWindow({ vexpand: true });
        scroller.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        scroller.set_child(this.#results);
        box.append(scroller);

        // manual coordinates
        const manual = new Adw.ExpanderRow({ title: 'Add by coordinates' });
        this.#nameEntry = new Adw.EntryRow({ title: 'Name (optional)' });
        this.#latEntry = new Adw.EntryRow({ title: 'Latitude (-90 … 90)' });
        this.#lonEntry = new Adw.EntryRow({ title: 'Longitude (-180 … 180)' });
        for (const r of [this.#nameEntry, this.#latEntry, this.#lonEntry])
            manual.add_row(r);
        this.#manualAddBtn = new Gtk.Button({ label: 'Add this point', margin_top: 6 });
        this.#manualAddBtn.add_css_class('suggested-action');
        const btnWrap = new Gtk.Box({ margin_start: 12 });
        btnWrap.append(this.#manualAddBtn);
        manual.add_row(btnWrap);
        box.append(manual);

        clamp.set_child(box);
        root.append(clamp);
        this.set_child(root);

        this.#entry.connect('changed', () => this.#scheduleSearch());
        this.#entry.connect('activated', () => this.#runSearch());
        this.#manualAddBtn.connect('clicked', () => this.#addManual());
        this.#results.connect('row-activated', (_l, row) => {
            if (row.result) this.#pick(row.result);
        });
    }

    #scheduleSearch() {
        if (this.#debounce) GLib.Source.remove(this.#debounce);
        this.#debounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
            this.#debounce = 0;
            this.#runSearch();
            return GLib.SOURCE_REMOVE;
        });
    }

    async #runSearch() {
        const text = this.#entry.get_text().trim();
        if (this.#debounce) {
            GLib.Source.remove(this.#debounce);
            this.#debounce = 0;
        }
        const token = ++this.#searchToken;
        while (this.#results.get_first_child())
            this.#results.remove(this.#results.get_first_child());

        if (text.length < 2) {
            this.#hint.label = IDLE_HINT;
            this.#spinner.visible = false;
            return;
        }
        this.#spinner.visible = true;
        this.#hint.label = `Searching for “${text}”…`;
        try {
            const hits = await geocode(text);
            if (token !== this.#searchToken) return; // a newer query won
            this.#hint.label = hits.length
                ? `${hits.length} match${hits.length > 1 ? 'es' : ''} — pick one:`
                : 'No matches. Try another spelling, or add coordinates below.';
            for (const r of hits) {
                const row = new Adw.ActionRow({
                    title: r.countryCode ? `${r.name} · ${r.countryCode}` : r.name,
                });
                row.subtitle = [
                    locationLabel(r),
                    `${r.latitude.toFixed(2)}, ${r.longitude.toFixed(2)}`,
                ].filter(Boolean).join(' · ');
                row.result = r;
                this.#results.append(row);
            }
        } catch (e) {
            if (token === this.#searchToken)
                this.#hint.label = `Search failed: ${e.message}`;
        } finally {
            if (token === this.#searchToken) this.#spinner.visible = false;
        }
    }

    #addManual() {
        const lat = parseFloat(this.#latEntry.get_text().replace(',', '.'));
        const lon = parseFloat(this.#lonEntry.get_text().replace(',', '.'));
        if (!Number.isFinite(lat) || lat < -90 || lat > 90
            || !Number.isFinite(lon) || lon < -180 || lon > 180) {
            this.#hint.label = 'Enter valid latitude (-90…90) and longitude (-180…180).';
            return;
        }
        const name = this.#nameEntry.get_text().trim()
            || `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
        this.#pick({
            name, admin1: '', country: '', countryCode: '', latitude: lat, longitude: lon,
        });
    }

    #pick(result) {
        this.#onPick(result);
        this.dismiss();
    }
});
