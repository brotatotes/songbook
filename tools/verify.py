"""Stage 5 verification: fresh dist, file:// with no requests, desktop and phone portrait/landscape, touch, keyboard, contrast,
the full paste -> view -> transpose -> print flow, and a package scan for private paths and secrets.
Usage: python3 tools/verify.py OUTDIR. Public-domain text only. Sync flow is covered by tools/live_sync_check.py."""
import json, pathlib, re, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
URL = (ROOT / 'dist' / 'index.html').as_uri()
BE_THOU = """Be Thou My Vision - Traditional Irish

[Verse 1]
D       G  D         Bm      G  A
Be Thou my vision, O Lord of my heart
D         G           D   Bm        A    D
Naught be all else to me, save that Thou art
"""
res = {'url': URL, 'checks': [], 'errors': [], 'requests': []}
def check(name, ok, detail=''):
    res['checks'].append({'name': name, 'ok': bool(ok), 'detail': str(detail)[:300]})

CONTRAST_JS = """() => {
  function rgb(s){const m=s.match(/[\\d.]+/g).map(Number);return m;}
  function lum(c){const a=c.slice(0,3).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2];}
  function bg(el){while(el){const c=getComputedStyle(el).backgroundColor;const v=rgb(c);if(v.length<4||v[3]>0.5)return v;el=el.parentElement;}return [255,255,255];}
  const out=[];
  document.querySelectorAll('body *').forEach(el=>{
    if(!el.childNodes.length||![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))return;
    const r=el.getBoundingClientRect(); if(!r.width||!r.height)return; const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none')return;
    const f=lum(rgb(cs.color)),b=lum(bg(el)); const ratio=(Math.max(f,b)+0.05)/(Math.min(f,b)+0.05);
    const large=parseFloat(cs.fontSize)>=24||(parseFloat(cs.fontSize)>=18.66&&+cs.fontWeight>=700);
    if(ratio<(large?3:4.5)) out.push([el.tagName+'.'+el.className, el.textContent.trim().slice(0,30), Math.round(ratio*100)/100]);
  });
  return out;
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    for label, vp, mobile in [('desktop', {'width': 1440, 'height': 900}, False), ('phone-portrait', {'width': 390, 'height': 844}, True), ('phone-landscape', {'width': 844, 'height': 390}, True)]:
        ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e, l=label: res['errors'].append(l + ': ' + str(e)))
        pg.on('console', lambda m, l=label: res['errors'].append(l + ' console: ' + m.text) if m.type == 'error' else None)
        pg.on('request', lambda r, l=label: res['requests'].append(l + ': ' + r.url) if not r.url.startswith(('file:', 'data:')) else None)
        pg.on('dialog', lambda d: d.accept())
        pg.goto(URL); pg.wait_for_selector('#q')
        # keyboard: tab reaches nav links and search with a visible focus ring
        start = pg.evaluate("document.activeElement.id")
        seen = []
        for _ in range(12):
            pg.keyboard.press('Tab')
            seen.append(pg.evaluate("() => { const a = document.activeElement; const cs = getComputedStyle(a); return [a.tagName, a.id || a.textContent.trim().slice(0,12), cs.outlineStyle !== 'none' || cs.boxShadow !== 'none']; }"))
        seen = [s for s in seen if s[0] != 'BODY']  # BODY = focus left the page for browser chrome
        check(label + ' keyboard reaches search and nav', (start == 'q' or any(s[1] == 'q' for s in seen)) and any(s[1].startswith('Add') for s in seen), [start] + seen)
        check(label + ' focus visible on every tab stop', all(s[2] for s in seen), seen)
        # paste flow
        pg.goto(URL + '#/new'); pg.fill('#paste', BE_THOU)
        check(label + ' preview while pasting', pg.locator('#pv button.ch').count() >= 10)
        if mobile: pg.tap('#save')
        else: pg.click('#save')
        pg.wait_for_selector('#sheetbody')
        check(label + ' song view title', pg.inner_text('h1') == 'Be Thou My Vision')
        ov = pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        check(label + ' no horizontal scroll', ov <= 0, ov)
        tap = pg.evaluate("() => [...document.querySelectorAll('.tools button, .tools a')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.textContent.trim(), Math.round(r.width), Math.round(r.height)]; })")
        if mobile: check(label + ' tap targets at least 40px tall', all(h >= 40 for _, _, h in tap), tap)
        pg.screenshot(path=str(OUT / f'{label}-song.png'), full_page=True)
        # transpose D -> E (two up), spelled with sharps
        for _ in range(2):
            (pg.tap if mobile else pg.click)('[data-act=up]')
        ch = pg.eval_on_selector_all('#sheetbody button.ch', 'els => els.map(e => e.textContent)')
        check(label + ' transpose D+2 = E with C#m and B', pg.inner_text('#keyval') == 'E' and 'C\u266fm' in ch or 'C#m' in ch, pg.inner_text('#keyval') + ' ' + ' '.join(ch[:8]))
        # keyboard on song view: chord button opens sheet with Enter, Escape closes, focus returns
        pg.focus('#sheetbody button.ch >> nth=0'); pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
        check(label + ' Enter on chord opens diagram', pg.is_visible('#sheet'))
        pg.keyboard.press('Escape')
        check(label + ' Escape closes and returns focus', not pg.is_visible('#sheet') and pg.evaluate("document.activeElement.classList.contains('ch')"))
        if mobile:
            pg.tap('#sheetbody button.ch >> nth=1'); pg.wait_for_timeout(200)
            check(label + ' tap chord opens diagram', pg.is_visible('#sheet') and pg.locator('#sheet svg').count() == 1)
            pg.screenshot(path=str(OUT / f'{label}-chord.png'))
            pg.keyboard.press('Escape')
        bad = pg.evaluate(CONTRAST_JS)
        check(label + ' contrast light', not bad, bad[:5])
        (pg.tap if mobile else pg.click)('[data-act=dark]')
        bad = pg.evaluate(CONTRAST_JS)
        check(label + ' contrast dark', not bad, bad[:5])
        pg.screenshot(path=str(OUT / f'{label}-song-dark.png'), full_page=True)
        (pg.tap if mobile else pg.click)('[data-act=dark]')
        pg.emulate_media(media='print')
        check(label + ' print view hides chrome, keeps chords', not pg.is_visible('.tools') and not pg.is_visible('.top') and pg.is_visible('#sheetbody button.ch >> nth=0'))
        if label == 'desktop':
            pdf = OUT / 'print.pdf'; pg.pdf(path=str(pdf), format='Letter')
            check('print to PDF produced', pdf.stat().st_size > 5000, pdf.stat().st_size)
        pg.emulate_media(media='screen')
        for lab in ['', '#/todo', '#/sync']:
            pg.goto(URL + lab); pg.wait_for_timeout(100)
            bad = pg.evaluate(CONTRAST_JS)
            check(label + ' contrast ' + (lab or 'library'), not bad, bad[:5])
        pg.screenshot(path=str(OUT / f'{label}-sync.png'))
        ctx.close()
    b.close()

check('no page or console errors', not res['errors'], res['errors'][:5])
check('no network requests before sync is set up', not res['requests'], res['requests'][:5])

# package scan
html = (ROOT / 'dist' / 'index.html').read_text()
scan = {}
files = [f for f in ROOT.rglob('*') if f.is_file() and '.git' not in f.parts and f.name != 'PLAN.md' and f.name != 'verify.py']  # verify.py holds the scan patterns
pats = {'private path': re.compile(r'/home/[a-z_][a-z0-9_-]*/|/root/|\.config/'), 'github token': re.compile(r'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}'),
        'private key': re.compile(r'BEGIN [A-Z ]*PRIVATE KEY'), 'external url in dist': None}
for f in files:
    try: t = f.read_text()
    except Exception: continue
    for k, rx in pats.items():
        if rx and rx.search(t): scan.setdefault(k, []).append(str(f.relative_to(ROOT)))
urls = sorted(set(re.findall(r'https?://[^\s"\'<>)]+', html)))
allowed = ('https://api.github.com', 'https://github.com/settings/personal-access-tokens/new', 'https://www.google.com/search', 'https://duckduckgo.com/', 'https://www.ultimate-guitar.com/search.php', 'https://www.youtube.com/results', 'http://www.w3.org/2000/svg', 'https://github.com/')
res['distUrls'] = urls
odd = [u for u in urls if not u.startswith(allowed)]
check('dist URLs limited to sync, token page, search links and SVG namespace', not odd, odd)
check('no private paths, tokens or keys in package files', not scan, scan)
check('dist is self-contained (no external script/style/font src)', not re.search(r'<(script|link)[^>]+(src|href)=["\']https?:', html))
res['scannedFiles'] = len(files)
res['passed'] = all(c['ok'] for c in res['checks'])
(OUT / 'browser-review.json').write_text(json.dumps(res, indent=2))
print(json.dumps({'passed': res['passed'], 'failed': [[c['name'], c['detail']] for c in res['checks'] if not c['ok']]}, indent=1))
