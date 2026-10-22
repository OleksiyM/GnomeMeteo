// Meteo Indicator (clean architecture, zero legacy, hot-reloadable)

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export const MeteoIndicator = GObject.registerClass(
class MeteoIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Meteo');
        this._ext = extension;

        this._box = new St.BoxLayout({
            style_class: 'panel-status-indicators-box',
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Clean system symbolic weather icon (no emoji)
        this._icon = new St.Icon({
            icon_name: 'weather-clear-symbolic',
            style_class: 'system-status-icon',
        });

        // Clean temperature text without '+' (e.g. 13°)
        this._label = new St.Label({
            text: '13°',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._box.add_child(this._icon);
        this._box.add_child(this._label);
        this.add_child(this._box);

        this._buildMenu();
    }

    _buildMenu() {
        this.menu.removeAll();

        let headerItem = new PopupMenu.PopupMenuItem('Meteo · Apple Weather', {
            reactive: false,
        });
        headerItem.label.set_style('font-weight: bold; font-size: 15px;');
        this.menu.addMenuItem(headerItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let statusItem = new PopupMenu.PopupMenuItem('✓ Чистый старт: клик работает штатно!', {
            reactive: false,
        });
        this.menu.addMenuItem(statusItem);

        let testItem = new PopupMenu.PopupImageMenuItem(
            'Нажми меня (проверка работы меню)',
            'emblem-ok-symbolic'
        );
        testItem.connect('activate', () => {
            console.log('[METEO-TEST] Menu item clicked successfully!');
        });
        this.menu.addMenuItem(testItem);
    }
});
