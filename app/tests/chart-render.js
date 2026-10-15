import Cairo from 'gi://cairo?version=1.0';
import { paintChart } from '../src/chart.js';
import { daySlice } from '../src/weather.js';

// synthetic 72-hour forecast
const times = [], temp = [], pp = [], wind = [], code = [], isDay = [];
for (let d = 0; d < 3; d++) for (let h = 0; h < 24; h++) {
    times.push(`2026-10-${String(14 + d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00`);
    temp.push(18 + 8 * Math.sin((h - 6) / 24 * 2 * Math.PI) + d);
    pp.push(h > 8 && h < 16 ? 30 + 60 * Math.sin((h - 8) / 8 * Math.PI) : Math.random() * 12);
    wind.push(8 + 6 * Math.sin(h / 5));
    code.push(h >= 9 && h <= 14 ? 61 : (h % 6 === 0 ? 3 : 2));
    isDay.push(h >= 6 && h <= 18 ? 1 : 0);
}
const hourly = { time: times, temp, precipProb: pp, wind, code, isDay };
const daily = [{ date: '2026-10-14' }, { date: '2026-10-15' }];
const cityWall = Date.UTC(2026, 9, 14, 14, 30);

const W = 900, H = 210;
const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, W, H * 3);
const cr = new Cairo.Context(surf);
[['temp', 0], ['precip', 1], ['wind', 2]].forEach(([m, row]) => {
    cr.save();
    cr.translate(0, row * H);
    cr.rectangle(0, 0, W, H);
    cr.clip();
    cr.setSourceRGBA(row === 2 ? 0.13 : 0.95, row === 2 ? 0.14 : 0.95, row === 2 ? 0.17 : 0.97, 1);
    cr.paint();
    const slice = daySlice(hourly, daily, 0, cityWall);
    paintChart(cr, W, H, { slice, metric: m, dark: row === 2 });
    cr.restore();
});
surf.writeToPNG('charts-preview.png');
print('rendered charts-preview.png');
