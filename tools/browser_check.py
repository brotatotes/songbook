"""Browser check for the library stage: file:// load, paste, view, transpose, capo, dark, chord sheet, to-add list.
Usage: python3 tools/browser_check.py OUTDIR. Writes OUTDIR/browser-check.json and screenshots. Public-domain text only."""
import json, sys, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'out')
OUT.mkdir(parents=True, exist_ok=True)
URL = (ROOT / 'dist' / 'index.html').as_uri()

AMAZING = """Amazing Grace - John Newton

[Verse 1]
G      G7            C         G
Amazing grace, how sweet the sound
G                      D
That saved a wretch like me
G         G7          C          G
I once was lost, but now am found
G         Em    D       G
Was blind, but now I see

[Verse 2]
G          G7                 C         G
'Twas grace that taught my heart to fear, and grace my fears relieved
"""
SIMPLE = """{title: Simple Gifts}
{artist: Joseph Brackett}
{key: F}
{start_of_part: Intro}
[F] [C/E] [Dm] [Bb]  x2
{end_of_part}
{start_of_verse: Verse}
'Tis the [F]gift to be simple, 'tis the [C]gift to be free
'Tis the [F]gift to come down where we [C]ought to [F]be
{end_of_verse}
{start_of_tab: Riff}
e|-----1-0-------|
B|---1-----3-1---|
{end_of_tab}
"""

results = {'url': URL, 'checks': [], 'errors': [], 'requests': []}
def check(name, ok, detail=''):
    results['checks'].append({'name': name, 'ok': bool(ok), 'detail': detail})

with sync_playwright() as p:
    b = p.chromium.launch()
    for label, vp, mobile in [('desktop', {'width': 1440, 'height': 900}, False), ('phone', {'width': 390, 'height': 844}, True)]:
        ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1)
        page = ctx.new_page()
        page.on('pageerror', lambda e, l=label: results['errors'].append(l + ': ' + str(e)))
        page.on('console', lambda m, l=label: results['errors'].append(l + ' console: ' + m.text) if m.type == 'error' else None)
        page.on('request', lambda r, l=label: results['requests'].append(l + ': ' + r.url) if not r.url.startswith(('file:', 'data:')) else None)
        page.goto(URL)
        page.wait_for_selector('#q')
        check(label + ' library empty state', 'No songs yet' in page.inner_text('#list'))
        page.screenshot(path=str(OUT / f'{label}-library-empty.png'))
        # add a todo item
        page.goto(URL + '#/todo')
        page.fill('#tt', 'Amazing Grace'); page.fill('#ta', 'John Newton'); page.click('#tf button')
        page.fill('#tt', 'Be Thou My Vision'); page.fill('#ta', 'Traditional Irish'); page.click('#tf button')
        links = page.eval_on_selector_all('.todos a[target=_blank]', 'els => els.map(e => [e.href, e.rel])')
        check(label + ' todo links new tab noopener', len(links) == 4 and all('noopener' in r and 'noreferrer' in r for _, r in links), json.dumps(links[:2]))
        check(label + ' todo count', page.inner_text('#todoCount') == '(2)', page.inner_text('#todoCount'))
        page.screenshot(path=str(OUT / f'{label}-todo.png'))
        # paste
        page.goto(URL + '#/new')
        page.fill('#paste', AMAZING)
        check(label + ' prefill title', page.input_value('#ft') == 'Amazing Grace', page.input_value('#ft'))
        check(label + ' prefill artist', page.input_value('#fa') == 'John Newton', page.input_value('#fa'))
        check(label + ' key guess', 'G' in page.inner_text('#kguess'), page.inner_text('#kguess'))
        check(label + ' live preview chords', page.locator('#pv button.ch').count() >= 10, str(page.locator('#pv button.ch').count()))
        page.screenshot(path=str(OUT / f'{label}-add.png'), full_page=True)
        page.click('#save')
        page.wait_for_selector('#sheetbody')
        page.wait_for_timeout(3000)
        check(label + ' saved to song view', page.inner_text('h1') == 'Amazing Grace')
        check(label + ' todo ticked', page.inner_text('#todoCount') == '(1)', page.inner_text('#todoCount'))
        # chord alignment: each chord's left edge sits at its syllable's left edge
        bad = page.evaluate("""() => { let bad = 0, n = 0; document.querySelectorAll('#sheetbody .sg').forEach(sg => {
            const c = sg.querySelector('.c button'); const w = sg.querySelector('.w'); if (!c) return; n++;
            if (Math.abs(c.getBoundingClientRect().left - w.getBoundingClientRect().left) > 1.5) bad++; }); return [bad, n]; }""")
        check(label + ' chords on syllables', bad[0] == 0 and bad[1] > 0, str(bad))
        overflow = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        check(label + ' no horizontal page scroll', overflow <= 0, str(overflow))
        overlap = page.evaluate("""() => { const r = Array.from(document.querySelectorAll('#sheetbody .c button')).map(b => b.getBoundingClientRect());
            let o = 0; for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) { const a = r[i], c = r[j];
            if (Math.abs(a.top - c.top) < 2 && a.left < c.right - 0.5 && c.left < a.right - 0.5) o++; } return o; }""")
        check(label + ' no chord overlap', overlap == 0, str(overlap))
        page.screenshot(path=str(OUT / f'{label}-song.png'), full_page=True)
        page.click('[data-act=up]'); page.click('[data-act=up]'); page.click('[data-act=up]')
        chords = page.eval_on_selector_all('#sheetbody button.ch', 'els => els.map(e => e.textContent)')
        check(label + ' transpose G+3 to B\u266d', page.inner_text('#keyval') == 'B\u266d' and 'E\u266d' in chords and 'A#' not in ''.join(chords), page.inner_text('#keyval') + ' ' + ' '.join(chords[:6]))
        page.click('[data-act=capoup]'); page.click('[data-act=capoup]'); page.click('[data-act=capoup]')
        check(label + ' capo summary', 'Capo 3, shapes in G, sounds in B\u266d' in page.inner_text('#summary'), page.inner_text('#summary'))
        page.click('[data-act=bigger]')
        page.click('[data-act=dark]')
        check(label + ' dark mode', page.evaluate("document.documentElement.classList.contains('dark')"))
        page.screenshot(path=str(OUT / f'{label}-song-dark-capo.png'), full_page=True)
        page.click('#sheetbody button.ch >> nth=0')
        page.wait_for_timeout(250)
        check(label + ' chord sheet opens', page.is_visible('#sheet') and page.locator('#sheet svg').count() == 1)
        page.screenshot(path=str(OUT / f'{label}-chord-sheet.png'))
        page.keyboard.press('Escape')
        check(label + ' sheet closes on Escape', not page.is_visible('#sheet'))
        page.click('#sheetbody button.ch >> nth=1'); page.click('#sheetBack', position={'x': 5, 'y': 5})
        check(label + ' sheet closes on tap outside', not page.is_visible('#sheet'))
        page.click('[data-act=dark]'); page.click('[data-act=capodown]'); page.click('[data-act=capodown]'); page.click('[data-act=capodown]')
        page.click('[data-act=down]'); page.click('[data-act=down]'); page.click('[data-act=down]')
        # print
        page.emulate_media(media='print')
        check(label + ' print hides controls', not page.is_visible('.tools') and not page.is_visible('.top'))
        page.screenshot(path=str(OUT / f'{label}-print.png'), full_page=True)
        page.emulate_media(media='screen')
        # chordpro paste
        page.goto(URL + '#/new')
        page.fill('#paste', SIMPLE); page.click('#save'); page.wait_for_selector('#sheetbody')
        check(label + ' chordpro saved', page.inner_text('h1') == 'Simple Gifts' and page.locator('.tab').count() == 1)
        page.screenshot(path=str(OUT / f'{label}-simple-gifts.png'), full_page=True)
        # library search
        page.goto(URL + '#/')
        page.fill('#q', 'wretch')
        check(label + ' lyric search', page.locator('#list li').count() == 1 and 'wretch' in page.inner_text('#list'), page.inner_text('#list'))
        page.fill('#q', 'brackett')
        check(label + ' artist search', 'Simple Gifts' in page.inner_text('#list'))
        page.fill('#q', '')
        page.screenshot(path=str(OUT / f'{label}-library.png'))
        ctx.close()
    b.close()

check('no page or console errors', not results['errors'], '; '.join(results['errors'][:5]))
check('no network requests', not results['requests'], '; '.join(results['requests'][:5]))
results['passed'] = all(c['ok'] for c in results['checks'])
(OUT / 'browser-check.json').write_text(json.dumps(results, indent=2))
print(json.dumps({'passed': results['passed'], 'failed': [c for c in results['checks'] if not c['ok']]}, indent=1))
