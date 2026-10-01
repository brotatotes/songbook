"""Live end-to-end sync check against the private songs repo.
Usage: python3 tools/live_sync_check.py OUTDIR TOKEN_FILE [REPO]
The token is read from TOKEN_FILE at runtime, injected into the browser only for this run and never written anywhere.
Uses a public-domain song (Amazing Grace) with invented test edits. All test files are removed at the end."""
import base64, json, pathlib, sys, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
TOKEN = pathlib.Path(sys.argv[2]).expanduser().read_text().strip()
REPO = sys.argv[3] if len(sys.argv) > 3 else 'brotatotes/songbook-songs'
URL = (ROOT / 'dist' / 'index.html').as_uri()
PATH = 'songs/songbook-sync-test--sync-test-amazing-grace.cho'

SONG = """{title: Sync Test Amazing Grace}
{artist: Songbook Sync Test}
{key: G}
{start_of_verse: Verse 1}
A[G]mazing [G7]grace, how [C]sweet the [G]sound
That [G]saved a wretch like [D]me
{end_of_verse}
"""

def api(method, path, body=None):
    url = 'https://api.github.com/repos/' + REPO + (('/contents/' + path) if path is not None else '')
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None,
        headers={'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        return e.code, None

def remote_text(path):
    s, j = api('GET', path)
    return base64.b64decode(j['content']).decode() if s == 200 else None

def listing():
    s, root = api('GET', '')
    s2, songs = api('GET', 'songs')
    files = [f['path'] for f in (root or []) if f['type'] == 'file']
    if s2 == 200: files += [f['path'] for f in songs if f['type'] == 'file']
    return sorted(files)

res = {'repo': REPO, 'url': URL, 'checks': [], 'errors': [], 'foreignRequests': [], 'apiRequests': 0}
def check(name, ok, detail=''):
    res['checks'].append({'name': name, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print(('PASS ' if ok else 'FAIL ') + name, flush=True)

s, repo = api('GET', None)
check('repo exists and is private before test', s == 200 and repo['private'] is True, repo and repo.get('visibility'))
def cleanup():
    removed = []
    for f in listing():
        if f == 'README.md': continue
        s, j = api('GET', f)
        if s == 200 and isinstance(j, dict):
            ds, _ = api('DELETE', f, {'message': 'Remove sync test file', 'sha': j['sha']})
            removed.append([f, ds])
    return removed
res['leftoverFromEarlierRun'] = cleanup()
res['before'] = listing()
check('repo starts with only README.md', res['before'] == ['README.md'], res['before'])

INIT = "(() => { if (!localStorage.getItem('songbook.auth')) localStorage.setItem('songbook.auth', JSON.stringify({repo: %s, token: %s})); })()" % (json.dumps(REPO), json.dumps(TOKEN))
SYNCED = "() => window.songStore && window.songStore.queue().length === 0 && window.songStore.lastSync() > %d"

def ctx_page(b, label, vp, mobile):
    ctx = b.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile)
    ctx.add_init_script(INIT)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: res['errors'].append(label + ': ' + str(e)))
    pg.on('dialog', lambda d: d.accept())
    def req(r):
        if r.url.startswith('https://api.github.com/'): res['apiRequests'] += 1
        elif not r.url.startswith(('file:', 'data:')): res['foreignRequests'].append(r.url)
    pg.on('request', req)
    return ctx, pg

def wait_sync(pg, since):
    pg.wait_for_function(SYNCED % since, timeout=45000)

def ms(): return int(time.time() * 1000)

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ca, A = ctx_page(b, 'A-desktop', {'width': 1440, 'height': 900}, False)
        A.goto(URL); A.wait_for_selector('#q')
        t = ms(); A.goto(URL + '#/new'); A.fill('#paste', SONG); A.click('#save'); A.wait_for_selector('#sheetbody')
        wait_sync(A, t)
        txt = remote_text(PATH)
        check('A: new song pushed to repo', txt is not None and 'Sync Test Amazing Grace' in txt, PATH)
        A.evaluate("location.hash = '#/sync'"); A.wait_for_selector('#syncstatus')
        A.wait_for_function("() => /Synced/.test(document.getElementById('syncstatus').textContent) && !document.getElementById('syncnow').disabled", timeout=30000)
        check('A: sync screen shows repo and synced status', REPO in A.inner_text('main') and 'Synced' in A.inner_text('#syncstatus'), A.inner_text('#syncstatus'))
        A.screenshot(path=str(OUT / 'A-sync-connected.png'))
        check('A: token not rendered in page', TOKEN not in A.content())
        A.goto(URL + '#/song/' + PATH.replace('/', '%2F')); A.wait_for_selector('#sheetbody')

        cb, B = ctx_page(b, 'B-phone', {'width': 390, 'height': 844}, True)
        t = ms(); B.goto(URL); wait_sync(B, t); B.evaluate('window.songbookRefresh()')
        check('B: sync on open pulled the song', 'Sync Test Amazing Grace' in B.inner_text('#list'), B.inner_text('#list')[:200])
        B.goto(URL + '#/todo'); B.fill('#tt', 'Be Thou My Vision'); B.fill('#ta', 'Traditional Irish')
        t = ms(); B.click('#tf button'); wait_sync(B, t)
        check('B: to-add list pushed as todo.md', 'Be Thou My Vision | Traditional Irish' in (remote_text('todo.md') or ''))
        B.evaluate("location.hash = '#/edit/' + encodeURIComponent(%s)" % json.dumps(PATH)); B.wait_for_selector('#paste')
        B.fill('#paste', B.input_value('#paste').replace('{end_of_verse}', 'Line added on the phone\n{end_of_verse}'))
        t = ms(); B.click('#save'); B.wait_for_selector('#sheetbody'); wait_sync(B, t)
        check('B: edit pushed (SHA-checked update)', 'Line added on the phone' in (remote_text(PATH) or ''))

        # A still holds the old copy. Editing it now must keep both versions.
        A.evaluate("location.hash = '#/edit/' + encodeURIComponent(%s)" % json.dumps(PATH)); A.wait_for_selector('#paste')
        check('A: still has stale local copy', 'Line added on the phone' not in A.input_value('#paste'))
        A.fill('#paste', A.input_value('#paste').replace('{end_of_verse}', 'Line added on the desktop\n{end_of_verse}'))
        t = ms(); A.click('#save'); A.wait_for_selector('#sheetbody'); wait_sync(A, t)
        A.wait_for_selector('#toast.on', timeout=5000)
        check('A: conflict toast shown', 'Both versions were kept' in A.inner_text('#toast'), A.inner_text('#toast'))
        files = listing()
        copies = [f for f in files if '.conflict-' in f]
        main_txt = remote_text(PATH) or ''
        copy_txt = remote_text(copies[0]) if copies else ''
        check('conflict: original keeps phone edit', 'Line added on the phone' in main_txt and 'Line added on the desktop' not in main_txt)
        check('conflict: copy holds desktop edit', len(copies) == 1 and 'Line added on the desktop' in copy_txt, copies)
        A.goto(URL + '#/'); A.wait_for_selector('#list li')
        lib = A.inner_text('#list')
        check('A: library shows both versions locally', lib.count('Sync Test Amazing Grace') >= 2, lib[:300])
        check('A: to-add item pulled from phone', '(1)' in A.inner_text('#todoCount'), A.inner_text('#todoCount'))
        A.screenshot(path=str(OUT / 'A-library-conflict.png'))

        # Delete the conflict copy from the phone through the app (SHA-checked DELETE).
        B.goto(URL + '#/'); t = ms(); B.reload(); wait_sync(B, t)
        B.evaluate("location.hash = '#/edit/' + encodeURIComponent(%s)" % json.dumps(copies[0] if copies else PATH)); B.wait_for_selector('#del')
        t = ms(); B.click('#del'); wait_sync(B, t)
        check('B: app delete removed conflict copy from repo', copies and remote_text(copies[0]) is None)
        t = ms(); A.reload(); wait_sync(A, t); A.evaluate('window.songbookRefresh()')
        check('A: deletion propagated on next open', A.inner_text('#list').count('Sync Test Amazing Grace') == 1, A.inner_text('#list')[:200])

        # Sign-out clears the token from the browser.
        A.goto(URL + '#/sync'); A.wait_for_selector('#signout'); A.click('#signout')
        check('A: sign-out removes token from browser', A.evaluate("localStorage.getItem('songbook.auth')") is None)
        ca.close(); cb.close(); b.close()
finally:
    # Clean up every test file through the API.
    res['cleanup'] = cleanup()
    res['after'] = listing()
    s, repo = api('GET', None)
    check('cleanup: only README.md remains', res['after'] == ['README.md'], res['after'])
    check('repo still private after test', s == 200 and repo['private'] is True and repo['visibility'] == 'private', repo and repo.get('visibility'))

check('no page errors', not res['errors'], res['errors'][:3])
check('only api.github.com contacted', not res['foreignRequests'], res['foreignRequests'][:3])
res['passed'] = all(c['ok'] for c in res['checks'])
out = json.dumps(res, indent=2)
assert TOKEN not in out
(OUT / 'sync-check.json').write_text(out)
print(json.dumps({'passed': res['passed'], 'apiRequests': res['apiRequests'], 'failed': [c['name'] for c in res['checks'] if not c['ok']]}))
