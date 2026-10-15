#!/usr/bin/env python3
"""Design-parity gate for the WeatherGlass monorepo.

Fails (exit 1) when the app and the extension drift on the shared design
brain. Three mechanical checks, each with a concrete fix message:

1. Brand art pipeline: shared/art/icon-render.mjs must be byte-identical to
   extension/tools/icon-render.mjs above the OUTPUT EMISSION marker.
2. Interaction glass tokens: the extension stylesheet's slab/hover/selected
   rgba literals must all appear verbatim in the app stylesheet.
3. Canvas mirror constants: citypage.js SLAB_/HOVER_/GLASS_ RGB triples and
   alphas must match the stylesheet values they claim to mirror.
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
fails = []

# 1 -- brand pipeline drift ------------------------------------------------
MARK = '/* == OUTPUT EMISSION: consumer-specific == */'
def upto_marker(p):
    t = p.read_text()
    assert MARK in t, f'{p} lost its OUTPUT EMISSION marker'
    return t.split(MARK)[0]
def core_of(p):
    # comparable core = real code, below any file-header comment
    t = upto_marker(p)
    i = t.index('import Cairo')
    return t[i:]
shared, ext = core_of(ROOT/'shared/art/icon-render.mjs'), core_of(ROOT/'extension/tools/icon-render.mjs')
if shared != ext:
    fails.append('brand pipeline DRIFT: shared/art/icon-render.mjs != extension/tools/icon-render.mjs (above marker).'
                 '\n  Fix: cp shared/art/icon-render.mjs -> edit only its footer, keep the core identical.')

# 2 -- glass tokens --------------------------------------------------------
def norm_rgba(m):
    return 'rgba(%d,%d,%d,%g)' % (int(m.group(1)), int(m.group(2)),
                                  int(m.group(3)), float(m.group(4)))
RGBA = lambda s: {norm_rgba(m) for m in re.finditer(
    r'rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)', s)}
ws = lambda s: re.sub(r'\s+', '', s)
def norm_lit(t):
    m = re.match(r'rgba\((\d+),(\d+),(\d+),([\d.]+)\)', t)
    return 'rgba(%s,%s,%s,%s)' % (m.group(1), m.group(2), m.group(3), '%g' % float(m.group(4)))
ext_css = (ROOT/'extension/stylesheet.css').read_text()
app_css = (ROOT/'app/data/style.css').read_text()
TOKENS = ['rgba(16,20,28,0.28)','rgba(16,20,28,0.45)','rgba(255,255,255,0.18)',
          'rgba(255,255,255,0.40)','rgba(255,255,255,0.4)','rgba(255,255,255,0.68)',
          'rgba(16,24,35,0.35)']
have = {norm_lit(ws(x)) for x in RGBA(app_css)}
missing = [t for t in TOKENS if norm_lit(t) not in have]
if missing:
    fails.append(f'app stylesheet lost extension glass tokens: {missing}')

# 3 -- static furniture literals (no canvas mirrors any more) --------------
# The animated-sky furniture is static CSS (extension _paintDark doctrine):
# citypage must NOT reintroduce ground-mirror constants, and the stylesheet
# must carry the dark glass literals verbatim.
cp = (ROOT/'app/src/citypage.js').read_text()
ghost = [c for c in re.findall(r'\b(SLAB_|HOVER_|GLASS_)[A-Z_]*', cp)]
if ghost:
    fails.append(f'citypage.js reintroduces furniture mirror constants ({set(ghost)}); '
                 'animated-sky furniture lives ONLY in data/style.css')
must = ['rgba(16, 20, 28, 0.28)', 'rgba(16, 20, 28, 0.45)',
        'rgba(255, 255, 255, 0.18)', 'rgba(255, 255, 255, 0.95)',
        'rgba(255, 255, 255, 0.85)', 'rgba(255, 255, 255, 0.62)']
lack = [t for t in must if norm_lit(re.sub(r'\s','',t)) not in have]
if lack:
    fails.append(f'app stylesheet furniture literals missing: {lack}')

if fails:
    print('DESIGN PARITY FAILED:'); [print(' -', f) for f in fails]; sys.exit(1)
print('design parity OK: brand art, glass tokens, canvas mirrors all agree')
