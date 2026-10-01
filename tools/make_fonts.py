#!/usr/bin/env python3
"""Build src/fonts.css: EB Garamond 12 Regular + Bold subsets with lining figures baked into the
cmap (so SVG text and every browser shows lining digits without relying on font-feature-settings),
plus a tiny FreeSerif subset for the sharp, flat and natural signs that EB Garamond lacks."""
import base64, io, pathlib
from fontTools.ttLib import TTFont
from fontTools import subset

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEXT = ''.join(chr(c) for c in range(32, 127)) + '°·½×øΔ–—‘’“”•…‹›←→◑▶■♪'
DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']


def woff2(path, text, lining=False):
    f = TTFont(path)
    if lining:
        order = set(f.getGlyphOrder())
        for t in f['cmap'].tables:
            if not t.isUnicode():
                continue
            for i, name in enumerate(DIGITS):
                for cand in (name + '.lnum', name + '.tablining'):
                    if cand in order:
                        t.cmap[0x30 + i] = cand
                        break
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['kern', 'liga', 'tnum', 'lnum']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    s = subset.Subsetter(opts)
    s.populate(unicodes=[ord(c) for c in text])
    s.subset(f)
    buf = io.BytesIO()
    f.flavor = 'woff2'
    f.save(buf)
    return base64.b64encode(buf.getvalue()).decode()


def face(family, weight, b64, urange=None):
    ur = f'unicode-range:{urange};' if urange else ''
    return (f"@font-face{{font-family:'{family}';font-style:normal;font-weight:{weight};font-display:swap;{ur}"
            f"src:url(data:font/woff2;base64,{b64}) format('woff2');}}\n")


G = '/usr/share/fonts/truetype/ebgaramond/'
css = face('EB Garamond', 400, woff2(G + 'EBGaramond12-Regular.ttf', TEXT, True))
css += face('EB Garamond', 700, woff2(G + 'EBGaramond12-Bold.ttf', TEXT, True))
# EB Garamond 12 Bold has no lining figures, so all digits come from the Regular lining set
# (synthesized bold where needed) through a digits-only face that sits first in the stack.
css += face('CE Figures', 400, woff2(G + 'EBGaramond12-Regular.ttf', '0123456789', True), 'U+0030-0039')
acc = '♭♮♯'
css += face('CE Accidentals', 400, woff2('/usr/share/fonts/truetype/freefont/FreeSerif.ttf', acc), 'U+266D-266F')
css += face('CE Accidentals', 700, woff2('/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf', acc), 'U+266D-266F')
(ROOT / 'src' / 'fonts.css').write_text(css)
print('fonts.css', len(css), 'bytes')
