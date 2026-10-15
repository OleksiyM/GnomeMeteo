#!/usr/bin/gjs
// app/tools/branding-icon.mjs — the app icon ladder, drawn by the ONE
// canonical brand pipeline at ../../shared/art/icon-render.mjs (no vendored
// copy; scripts/check-design-parity.py guards the extension's synced twin).
//     cd app && gjs -m tools/branding-icon.mjs [outDir]
import GLib from 'gi://GLib';
import { render } from '../../shared/art/icon-render.mjs';

const root = ARGV[0] ?? GLib.build_filenamev([GLib.get_current_dir(), 'data', 'icons']);
GLib.mkdir_with_parents(root, 0o755);
for (const size of [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024])
    render(size, GLib.build_filenamev(
        [root, 'dev.vijaybala.weatherglassapp-' + size + '.png']));
