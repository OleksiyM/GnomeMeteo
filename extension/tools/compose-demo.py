#!/usr/bin/env python3
"""tools/compose-demo.py -- compose animated weather-transition GIFs.

Film mode captures one fixture per run. This composer turns several of
those real, nested-shell captures into one uploadable sequence: it
samples every segment on a shared timeline, crossfades adjacent
segments while both keep playing, encodes a compact palette GIF
(shared palette + transparent per-frame deltas by default), and
writes a contact sheet plus a JSON manifest for QA/provenance.

The default sequence is the one-day Berlin arc registered by
film-mode: sunny afternoon -> rain -> golden hour -> full-moon night.
Without --compose-only it shoots any missing segments through the
existing tools/film.sh entry point.

Examples (run from extension/):
    python3 tools/compose-demo.py
    python3 tools/compose-demo.py --compose-only
    python3 tools/compose-demo.py --fps 15 --segment-seconds 2
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WORKDIR = ROOT / 'tools' / 'out' / 'demo-transitions'
DEFAULT_SEGMENTS = (
    ('sunny', 'demo-berlin-sunny'),
    ('rain', 'demo-berlin-rain'),
    ('golden', 'demo-berlin-golden'),
    ('fullmoon', 'demo-berlin-fullmoon'),
)


@dataclass
class Segment:
    name: str
    fixture: str
    directory: Path
    report_base: Path
    source_dir: Path
    frames: list
    rect: list

    @property
    def report_path(self):
        return Path(f'{self.report_base}.final')

    @property
    def last_ms(self):
        return self.frames[-1][0] if self.frames else -1


@dataclass
class Sample:
    # a == -1 means black; b is always a segment index. alpha is b's weight.
    a: int
    a_ms: float
    b: int
    b_ms: float
    alpha: float


def parse_segments(values):
    if not values:
        return list(DEFAULT_SEGMENTS)
    out = []
    seen = set()
    for value in values:
        if '=' not in value:
            raise SystemExit(f'--segment expects NAME=FIXTURE, got {value!r}')
        name, fixture = (part.strip() for part in value.split('=', 1))
        if not name or not fixture:
            raise SystemExit(f'--segment expects NAME=FIXTURE, got {value!r}')
        if name in seen:
            raise SystemExit(f'duplicate segment name: {name}')
        seen.add(name)
        out.append((name, fixture))
    if len(out) < 2:
        raise SystemExit('at least two segments are required for a transition demo')
    return out


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description='Compose a Weatherglass weather-transition GIF from film-mode segments.')
    p.add_argument('--workdir', type=Path, default=DEFAULT_WORKDIR,
                   help='segment captures, intermediate frames, and default outputs')
    p.add_argument('--output', type=Path,
                   help='GIF path (default: <workdir>/weatherglass-demo-transitions.gif)')
    p.add_argument('--segment', action='append', metavar='NAME=FIXTURE',
                   help='segment in sequence order; repeat to replace the default arc')
    p.add_argument('--fps', type=int, default=12, help='GIF frames per second')
    p.add_argument('--width', type=int, default=300,
                   help='output width in pixels (0 keeps the capture width)')
    p.add_argument('--segment-seconds', type=float, default=2.5,
                   help='full-strength playback seconds per segment')
    p.add_argument('--transition-seconds', type=float, default=0.8,
                   help='crossfade seconds between adjacent segments')
    p.add_argument('--intro-seconds', type=float, default=0.4,
                   help='opening fade from black')
    p.add_argument('--outro-seconds', type=float, default=0.5,
                   help='closing fade to black')
    p.add_argument('--start-seconds', type=float, default=0.35,
                   help='skip this much of each capture (the open fade)')
    p.add_argument('--shoot-seconds', type=float,
                   help='close beat for newly shot segments (default: computed)')
    p.add_argument('--timezone', default='Europe/Berlin',
                   help='TZ for film shoots, so card clocks read fixture-local')
    p.add_argument('--encoder', choices=('delta', 'ffmpeg'), default='delta',
                   help='delta: shared palette + transparent frame deltas; '
                        'ffmpeg: palettegen/paletteuse archival encode')
    p.add_argument('--max-colors', type=int, default=224,
                   help='total GIF palette entries (delta reserves one for transparency)')
    p.add_argument('--delta-threshold', type=int, default=16,
                   help='delta encoder: max per-channel error treated as unchanged')
    mode = p.add_mutually_exclusive_group()
    mode.add_argument('--compose-only', action='store_true',
                      help='fail instead of shooting missing segment captures')
    mode.add_argument('--force-shoot', action='store_true',
                      help='recapture every segment even if frames exist')
    args = p.parse_args(argv)
    args.segments = parse_segments(args.segment)
    if not 5 <= args.fps <= 30:
        p.error('--fps must be between 5 and 30')
    if args.width != 0 and args.width < 120:
        p.error('--width must be 0 (native) or at least 120')
    if not 0 <= args.delta_threshold <= 254:
        p.error('--delta-threshold must be between 0 and 254')
    for name in ('segment_seconds', 'transition_seconds'):
        if getattr(args, name) <= 0:
            p.error(f'--{name.replace("_", "-")} must be positive')
    for name in ('intro_seconds', 'outro_seconds', 'start_seconds'):
        if getattr(args, name) < 0:
            p.error(f'--{name.replace("_", "-")} must not be negative')
    if not 2 <= args.max_colors <= 256:
        p.error('--max-colors must be between 2 and 256')
    if args.output is None:
        args.output = args.workdir / 'weatherglass-demo-transitions.gif'
    return args


def segment_shell(workdir, name, fixture):
    return Segment(
        name=name,
        fixture=fixture,
        directory=workdir / 'segments' / name,
        report_base=workdir / 'reports' / f'{name}.json',
        source_dir=workdir / 'src' / name,
        frames=[],
        rect=[],
    )


def needed_seconds(args):
    """Latest source instant sampled from any segment."""
    edge = max(args.intro_seconds + args.transition_seconds,
               2 * args.transition_seconds,
               args.transition_seconds + args.outro_seconds)
    return args.start_seconds + args.segment_seconds + edge


def shoot_segment(seg, args):
    seg.directory.mkdir(parents=True, exist_ok=True)
    seg.report_base.parent.mkdir(parents=True, exist_ok=True)
    seg.source_dir.mkdir(parents=True, exist_ok=True)
    shoot_seconds = args.shoot_seconds or needed_seconds(args) + 1.0
    beats = json.dumps([
        {'t': 0, 'do': 'open'},
        {'t': shoot_seconds, 'do': 'close'},
    ])
    env = dict(os.environ)
    env.update({
        'TZ': args.timezone,
        'WG_FILM_FIXTURE': seg.fixture,
        'WG_FILM_BEATS': beats,
        'WG_FILM_DIR': str(seg.directory),
        'WG_FILM_OUT': str(seg.report_base),
        'WG_FILM_SRC': str(seg.source_dir),
    })
    print(f"shoot {seg.name}: fixture={seg.fixture} close@{shoot_seconds:.1f}s")
    result = subprocess.run(['bash', 'tools/film.sh'], cwd=ROOT, env=env)
    if result.returncode != 0:
        # Film mode's smoke lock is calibrated for the standalone demo,
        # including a 120-frame floor. A segment capture is still good
        # when its final report and required frame window are present;
        # load_segment() is the authority for that narrower contract.
        print(f"warning: film.sh exited {result.returncode} for {seg.name}; "
              'checking captured frames before deciding', file=sys.stderr)


def load_segment(seg, args):
    if not seg.report_path.exists():
        raise SystemExit(f"missing capture report for {seg.name}: {seg.report_path}")
    report = json.loads(seg.report_path.read_text())
    if report.get('fixture') != seg.fixture:
        raise SystemExit(
            f"{seg.name}: report fixture {report.get('fixture')!r} != {seg.fixture!r}; "
            'recapture with --force-shoot')
    frames = []
    for item in report.get('frames', []):
        path = seg.directory / f"frame_{item['f']:03d}.png"
        if path.exists():
            frames.append((float(item['t']), path))
    if len(frames) < 10:
        raise SystemExit(f'{seg.name}: only {len(frames)} captured frames in {seg.directory}')
    seg.frames = sorted(frames)
    seg.rect = report.get('rect') or []
    required = needed_seconds(args) * 1000
    if seg.last_ms < required - 100:
        raise SystemExit(
            f'{seg.name}: capture ends at {seg.last_ms:.0f}ms, composer needs '
            f'{required:.0f}ms; recapture with --force-shoot or more --shoot-seconds')
    return seg


def ensure_segments(args):
    segments = [segment_shell(args.workdir, name, fixture)
                for name, fixture in args.segments]
    for seg in segments:
        if args.force_shoot or not seg.report_path.exists():
            if args.compose_only:
                raise SystemExit(
                    f'missing segment {seg.name} ({seg.fixture}); rerun without '
                    '--compose-only to shoot it')
            shoot_segment(seg, args)
        load_segment(seg, args)
    rects = {tuple(seg.rect) for seg in segments}
    if len(rects) != 1 or not next(iter(rects)):
        raise SystemExit(f'segment capture rectangles differ: {sorted(rects)}')
    return segments


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def frame_count(seconds, fps):
    return max(0, int(round(seconds * fps)))


def build_timeline(args, segment_count):
    """Return (samples, labeled contact-sheet picks). Cursors are ms."""
    step = 1000.0 / args.fps
    start = args.start_seconds * 1000
    cursors = [start] * segment_count
    samples = []
    picks = []

    intro = frame_count(args.intro_seconds, args.fps)
    if intro:
        picks.append(('intro', len(samples) + intro // 2))
    for i in range(intro):
        samples.append(Sample(-1, 0, 0, cursors[0], smooth(i / intro)))
        cursors[0] += step

    content = frame_count(args.segment_seconds, args.fps)
    transition = frame_count(args.transition_seconds, args.fps)
    for seg in range(segment_count):
        picks.append((f'{seg}-mid', len(samples) + content // 2))
        for _ in range(content):
            samples.append(Sample(seg, cursors[seg], seg, cursors[seg], 1.0))
            cursors[seg] += step
        if seg + 1 < segment_count:
            picks.append((f'{seg}-to-{seg + 1}', len(samples) + transition // 2))
            for i in range(transition):
                alpha = smooth((i + 1) / (transition + 1))
                samples.append(Sample(seg, cursors[seg], seg + 1,
                                      cursors[seg + 1], alpha))
                cursors[seg] += step
                cursors[seg + 1] += step

    outro = frame_count(args.outro_seconds, args.fps)
    if outro:
        picks.append(('outro', len(samples) + outro // 2))
    last = segment_count - 1
    for i in range(outro):
        samples.append(Sample(last, cursors[last], -1, 0,
                              smooth(i / outro) if outro else 1.0))
        cursors[last] += step
    samples.append(Sample(-1, 0, -1, 0, 1.0))
    return samples, picks


class FrameSource:
    def __init__(self, segments):
        self.segments = segments
        self.cache = {}
        first = self.frame_at(0, segments[0].frames[0][0])
        self.size = first.size
        self.black = Image.new('RGB', self.size, (0, 0, 0))
        # Validate every segment's raster size without loading all frames.
        for idx, seg in enumerate(segments):
            if self.frame_at(idx, seg.frames[0][0]).size != self.size:
                raise SystemExit(f'{seg.name}: frame size differs from first segment')

    def frame_at(self, seg_idx, t_ms):
        if seg_idx < 0:
            return self.black
        frames = self.segments[seg_idx].frames
        _, path = min(frames, key=lambda item: abs(item[0] - t_ms))
        if path not in self.cache:
            # A timeline can touch a few hundred unique captures; keep
            # the cache bounded while retaining hot neighbors.
            if len(self.cache) > 80:
                self.cache.clear()
            self.cache[path] = Image.open(path).convert('RGB')
        return self.cache[path]

    def render(self, sample):
        if sample.a < 0 and sample.b < 0:
            return self.black.copy()
        if sample.a < 0:
            return Image.blend(self.black, self.frame_at(sample.b, sample.b_ms),
                                sample.alpha)
        if sample.b < 0:
            return Image.blend(self.frame_at(sample.a, sample.a_ms), self.black,
                                sample.alpha)
        if sample.a == sample.b:
            return self.frame_at(sample.b, sample.b_ms).copy()
        return Image.blend(self.frame_at(sample.a, sample.a_ms),
                            self.frame_at(sample.b, sample.b_ms), sample.alpha)


def mean_luminance(image):
    return ImageStat.Stat(image.convert('L')).mean[0]


def check_output_frames(frames, picks):
    if mean_luminance(frames[0]) > 2:
        raise SystemExit('composed timeline does not start from black')
    if mean_luminance(frames[-1]) > 2:
        raise SystemExit('composed timeline does not end on black')
    for label, idx in picks:
        if 'mid' not in label:
            continue
        image = frames[idx]
        stat = ImageStat.Stat(image.convert('L'))
        if stat.mean[0] < 8 or stat.stddev[0] < 8:
            raise SystemExit(f'{label}: segment midpoint looks blank '
                             f'(mean={stat.mean[0]:.1f}, stddev={stat.stddev[0]:.1f})')


def write_contact_sheet(path, frames, picks, segment_names):
    labels = []
    for label, idx in picks:
        if label.endswith('-mid'):
            label = f"{segment_names[int(label.split('-')[0])]}-mid"
        elif '-to-' in label:
            a, b = (int(part) for part in label.split('-to-'))
            label = f'{segment_names[a]}-to-{segment_names[b]}'
        labels.append((label, idx))
    cols = 4
    rows = (len(labels) + cols - 1) // cols
    w, h = frames[0].size
    sheet = Image.new('RGB', (cols * w, rows * h), (0, 0, 0))
    for slot, (_, idx) in enumerate(labels):
        sheet.paste(frames[idx], ((slot % cols) * w, (slot // cols) * h))
    sheet.save(path)
    return labels


def run_checked(command, **kwargs):
    result = subprocess.run(command, text=True, capture_output=True, **kwargs)
    if result.returncode != 0:
        raise SystemExit(
            f"command failed ({result.returncode}): {' '.join(map(str, command))}\n"
            f'{result.stdout}\n{result.stderr}'.strip())
    return result


def probe_gif(output):
    probe = run_checked([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,avg_frame_rate,nb_frames,duration',
        '-of', 'json', str(output),
    ])
    return json.loads(probe.stdout)['streams'][0]


def encode_gif_ffmpeg(frame_dir, output, args):
    output.parent.mkdir(parents=True, exist_ok=True)
    vf = (f'split[s0][s1];[s0]palettegen=max_colors={args.max_colors}:'
          'stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle')
    run_checked([
        'ffmpeg', '-y', '-v', 'error', '-framerate', str(args.fps),
        '-i', str(frame_dir / 'frame_%04d.png'), '-vf', vf,
        '-loop', '0', str(output),
    ])
    return probe_gif(output)


def delta_palette(frame_dir, args):
    """One ffmpeg-derived palette for the whole timeline.

    palettegen's full-sequence quantization allocates the scarce
    entries to sky gradients far better than a median-cut contact
    sheet. Index 255 is reserved transparent; unused slots duplicate
    palette entry 0 during mapping, so any pixel the quantizer lands
    on 255 can be remapped to 0 losslessly before 255 is given its
    transparent meaning in the output.
    """
    palette_path = args.workdir / 'delta-palette.png'
    run_checked([
        'ffmpeg', '-y', '-v', 'error', '-framerate', str(args.fps),
        '-i', str(frame_dir / 'frame_%04d.png'),
        '-vf', (f'palettegen=max_colors={args.max_colors - 1}:'
                'reserve_transparent=0:stats_mode=diff'),
        '-frames:v', '1', str(palette_path),
    ])
    with Image.open(palette_path) as palette_image:
        # palettegen writes an RGBA 16x16 swatch, not a P-mode image:
        # its pixels in row-major order are the palette entries.
        seen = set()
        unique = []
        raw = palette_image.convert('RGB').tobytes()
        for offset in range(0, len(raw), 3):
            rgb = tuple(raw[offset:offset + 3])
            if rgb not in seen:
                seen.add(rgb)
                unique.extend(rgb)
            if len(unique) >= (args.max_colors - 1) * 3:
                break
    palette = unique[:(args.max_colors - 1) * 3]
    if len(palette) < 3:
        raise SystemExit('could not derive a GIF palette from the composed frames')
    palette += palette[:3] * (256 - len(palette) // 3)
    holder = Image.new('P', (1, 1))
    holder.putpalette(palette)
    return holder, palette


def frame_durations(count, fps):
    """Centisecond-exact per-frame durations averaging to 1/fps."""
    durations = []
    previous = 0
    for idx in range(count):
        boundary = round((idx + 1) * 100 / fps)
        durations.append((boundary - previous) * 10)
        previous = boundary
    return durations


def encode_gif_delta(frames, frame_dir, output, args):
    """Shared-palette GIF whose later frames store only changed pixels.

    A pixel whose quantized color is within --delta-threshold of the
    displayed color (max channel error) is left transparent, so the
    reconstruction error stays bounded per frame while static UI and
    slow gradients stop costing bytes every frame.
    """
    output.parent.mkdir(parents=True, exist_ok=True)
    holder, palette = delta_palette(frame_dir, args)
    transparent = Image.new('P', frames[0].size, 255)
    transparent.putpalette(palette)
    remap_255 = [0 if idx == 255 else idx for idx in range(256)]
    change_lut = ([0] * (args.delta_threshold + 1) +
                  [255] * (255 - args.delta_threshold))
    encoded = []
    displayed = None
    for frame in frames:
        quantized = frame.quantize(palette=holder, dither=Image.Dither.NONE)
        if quantized.getextrema()[1] == 255:
            quantized = quantized.point(remap_255)
            quantized.putpalette(palette)
        desired = quantized.convert('RGB')
        if displayed is None:
            encoded.append(quantized)
            displayed = desired
            continue
        red, green, blue = ImageChops.difference(desired, displayed).split()
        max_diff = ImageChops.lighter(ImageChops.lighter(red, green), blue)
        changed = max_diff.point(change_lut)
        delta = Image.composite(quantized, transparent, changed)
        delta.putpalette(palette)
        encoded.append(delta)
        displayed = Image.composite(desired, displayed, changed)
    encoded[0].save(
        output, save_all=True, append_images=encoded[1:],
        duration=frame_durations(len(encoded), args.fps), loop=0,
        transparency=255, disposal=1, optimize=True)
    return probe_gif(output)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def rel(path):
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def main(argv=None):
    args = parse_args(argv)
    args.workdir.mkdir(parents=True, exist_ok=True)
    segments = ensure_segments(args)
    samples, picks = build_timeline(args, len(segments))

    source = FrameSource(segments)
    frames = [source.render(sample) for sample in samples]
    capture_size = source.size
    if args.width and args.width != capture_size[0]:
        output_size = (args.width,
                       max(1, round(capture_size[1] * args.width / capture_size[0])))
        frames = [frame.resize(output_size, Image.LANCZOS) for frame in frames]
    else:
        output_size = capture_size
    check_output_frames(frames, picks)

    frame_dir = args.workdir / 'frames'
    frame_dir.mkdir(parents=True, exist_ok=True)
    for stale in frame_dir.glob('frame_*.png'):
        stale.unlink()
    for idx, frame in enumerate(frames):
        frame.save(frame_dir / f'frame_{idx:04d}.png')

    contact = args.output.with_name(f'{args.output.stem}-contact.png')
    labels = write_contact_sheet(contact, frames, picks,
                                 [seg.name for seg in segments])
    if args.encoder == 'delta':
        probe = encode_gif_delta(frames, frame_dir, args.output, args)
    else:
        probe = encode_gif_ffmpeg(frame_dir, args.output, args)
    if int(probe['width']) != output_size[0] or int(probe['height']) != output_size[1]:
        raise SystemExit(f'encoded GIF dimensions changed: {probe}')
    if int(probe['nb_frames']) != len(frames):
        raise SystemExit(
            f"encoded GIF has {probe['nb_frames']} frames, composed {len(frames)}")

    manifest = {
        'format': 2,
        'output': rel(args.output),
        'contact_sheet': rel(contact),
        'sha256': sha256(args.output),
        'bytes': args.output.stat().st_size,
        'fps': args.fps,
        'frames': len(frames),
        'duration_seconds': round(len(frames) / args.fps, 3),
        'size': list(output_size),
        'capture_size': list(capture_size),
        'encoding': {
            'encoder': args.encoder,
            'max_colors': args.max_colors,
            'delta_threshold': args.delta_threshold if args.encoder == 'delta' else None,
        },
        'ffprobe': probe,
        'timeline': {
            'start_seconds': args.start_seconds,
            'intro_seconds': args.intro_seconds,
            'segment_seconds': args.segment_seconds,
            'transition_seconds': args.transition_seconds,
            'outro_seconds': args.outro_seconds,
        },
        'segments': [{
            'name': seg.name,
            'fixture': seg.fixture,
            'capture_dir': rel(seg.directory),
            'report': rel(seg.report_path),
            'rect': seg.rect,
            'captured_frames': len(seg.frames),
            'capture_first_ms': seg.frames[0][0],
            'capture_last_ms': seg.frames[-1][0],
        } for seg in segments],
        'contact_picks': [{'label': label, 'frame': idx}
                          for label, idx in labels],
    }
    manifest_path = args.output.with_name(f'{args.output.name}.manifest.json')
    manifest_path.write_text(json.dumps(manifest, indent=1) + '\n')
    print(f"gif: {args.output} ({manifest['bytes']} bytes, sha256 {manifest['sha256']})")
    print(f'contact: {contact}')
    print(f'manifest: {manifest_path}')
    print(f"frames: {len(frames)} @ {args.fps}fps = {manifest['duration_seconds']}s, "
          f"{output_size[0]}x{output_size[1]}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
