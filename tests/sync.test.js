// Sync engine tests against an in-memory mock of the GitHub contents API. Public-domain text only.
const test = require('node:test');
const assert = require('node:assert');
const Store = require('../src/store.js');
const Sync = require('../src/sync.js');

function mockGitHub(opts = {}) {
  const files = new Map(); let n = 0;
  const log = [];
  const sha = () => 'sha' + (++n);
  const res = (status, json, headers = {}) => ({ status, json: async () => json, headers: { get: (k) => headers[k.toLowerCase()] ?? null } });
  async function fetch(url, init) {
    if (opts.offline) throw new TypeError('Failed to fetch');
    const u = new URL(url); const m = /^\/repos\/[^/]+\/[^/]+(?:\/contents\/(.*))?$/.exec(u.pathname);
    const path = m[1] ? decodeURIComponent(m[1]) : '';
    log.push(init.method + ' ' + path);
    assert.strictEqual(u.host, 'api.github.com');
    assert.match(init.headers.Authorization, /^Bearer /);
    if (opts.rate) return res(403, { message: 'rate' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(opts.rate / 1000)) });
    if (opts.badToken) return res(401, { message: 'Bad credentials' });
    if (init.method === 'GET' && path === '') return res(200, { private: opts.public ? false : true, permissions: { push: true } });
    if (init.method === 'GET' && path === 'songs') {
      const list = [...files].filter(([p]) => p.startsWith('songs/')).map(([p, f]) => ({ type: 'file', name: p.slice(6), path: p, sha: f.sha }));
      return list.length ? res(200, list) : res(404, { message: 'Not Found' });
    }
    if (init.method === 'GET') { const f = files.get(path); return f ? res(200, { content: Buffer.from(f.text).toString('base64'), sha: f.sha }) : res(404, {}); }
    const body = JSON.parse(init.body);
    const cur = files.get(path);
    if (init.method === 'PUT') {
      if ((cur && body.sha !== cur.sha) || (!cur && body.sha)) return res(cur ? 409 : 422, { message: 'sha mismatch' });
      const s = sha(); files.set(path, { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: s });
      return res(cur ? 200 : 201, { content: { sha: s } });
    }
    if (init.method === 'DELETE') {
      if (!cur) return res(404, {});
      if (body.sha !== cur.sha) return res(409, {});
      files.delete(path); return res(200, {});
    }
  }
  return { fetch, files, log, opts, put: (p, text) => files.set(p, { text, sha: sha() }) };
}
function device(gh, t = { v: 1700000000000 }) {
  const store = Store.createStore(Store.memoryStorage(), () => t.v);
  const eng = Sync.createEngine({ fetch: gh.fetch, store, Store, now: () => t.v, auth: () => ({ token: 'test-token', repo: 'o/r' }) });
  return { store, eng, t };
}
const AG = '{title: Amazing Grace}\n{artist: John Newton}\n[G]Amazing [C]grace\n';

test('base64 round trip with accents and sharps', () => {
  const s = 'Be Thou My Vision \u266F caf\u00e9 \u2014 ok';
  assert.strictEqual(Sync.b64decode(Sync.b64encode(s)), s);
});

test('push new song, then second device pulls it', async () => {
  const gh = mockGitHub(); const a = device(gh); const b = device(gh);
  a.store.put('songs/john-newton--amazing-grace.cho', AG);
  const r = await a.eng.run();
  assert.strictEqual(r.pushed, 1);
  assert.strictEqual(gh.files.get('songs/john-newton--amazing-grace.cho').text, AG);
  assert.strictEqual(a.store.queue().length, 0);
  await b.eng.run();
  assert.strictEqual(b.store.get('songs/john-newton--amazing-grace.cho').text, AG);
});

test('edit with matching sha updates in place', async () => {
  const gh = mockGitHub(); const a = device(gh);
  a.store.put('songs/x.cho', AG); await a.eng.run();
  a.store.put('songs/x.cho', AG + 'more\n'); await a.eng.run();
  assert.strictEqual(gh.files.get('songs/x.cho').text, AG + 'more\n');
  assert.ok(gh.log.includes('PUT songs/x.cho'));
});

test('conflict keeps both versions', async () => {
  const gh = mockGitHub(); const a = device(gh); const b = device(gh);
  a.store.put('songs/x.cho', AG); await a.eng.run(); await b.eng.run();
  a.store.put('songs/x.cho', AG + 'from A\n'); await a.eng.run();
  b.store.put('songs/x.cho', AG + 'from B\n');
  const r = await b.eng.run();
  assert.strictEqual(r.conflicts.length, 1);
  assert.strictEqual(gh.files.get('songs/x.cho').text, AG + 'from A\n');
  const copy = [...gh.files.keys()].find((p) => p.includes('.conflict-'));
  assert.ok(copy && /^songs\/x\.conflict-\d{8}-\d{4}-\w+\.cho$/.test(copy), copy);
  assert.strictEqual(gh.files.get(copy).text, AG + 'from B\n');
  assert.strictEqual(b.store.get('songs/x.cho').text, AG + 'from A\n');
  assert.strictEqual(b.store.get(copy).text, AG + 'from B\n');
});

test('identical concurrent edit is adopted without a copy', async () => {
  const gh = mockGitHub(); const a = device(gh); const b = device(gh);
  a.store.put('songs/x.cho', AG); await a.eng.run(); await b.eng.run();
  a.store.put('songs/x.cho', AG + 'same\n'); await a.eng.run();
  b.store.put('songs/x.cho', AG + 'same\n');
  const r = await b.eng.run();
  assert.strictEqual(r.conflicts.length, 0);
  assert.ok(![...gh.files.keys()].some((p) => p.includes('conflict')));
});

test('delete with sha removes remotely; other device drops it', async () => {
  const gh = mockGitHub(); const a = device(gh); const b = device(gh);
  a.store.put('songs/x.cho', AG); await a.eng.run(); await b.eng.run();
  a.store.remove('songs/x.cho'); await a.eng.run();
  assert.ok(!gh.files.has('songs/x.cho'));
  const r = await b.eng.run();
  assert.strictEqual(r.removed, 1);
  assert.strictEqual(b.store.get('songs/x.cho'), null);
});

test('delete loses to a remote edit: nothing is lost', async () => {
  const gh = mockGitHub(); const a = device(gh); const b = device(gh);
  a.store.put('songs/x.cho', AG); await a.eng.run(); await b.eng.run();
  a.store.put('songs/x.cho', AG + 'edited\n'); await a.eng.run();
  b.store.remove('songs/x.cho'); await b.eng.run();
  assert.strictEqual(gh.files.get('songs/x.cho').text, AG + 'edited\n');
  assert.strictEqual(b.store.get('songs/x.cho').text, AG + 'edited\n');
});

test('offline keeps the queue and reports it; later run flushes', async () => {
  const gh = mockGitHub({ offline: true }); const a = device(gh);
  a.store.put('songs/x.cho', AG);
  await assert.rejects(a.eng.run(), (e) => e.kind === 'offline');
  assert.strictEqual(a.store.queue().length, 1);
  assert.match(a.eng.statusLine(), /Offline, 1 change waiting/);
  gh.opts.offline = false;
  await a.eng.run();
  assert.strictEqual(a.store.queue().length, 0);
  assert.ok(gh.files.has('songs/x.cho'));
});

test('rate limit waits until reset without hammering', async () => {
  const t = { v: 1700000000000 };
  const gh = mockGitHub({ rate: t.v + 120000 }); const a = device(gh, t);
  a.store.put('songs/x.cho', AG);
  await assert.rejects(a.eng.run(), (e) => e.kind === 'rate');
  const calls = gh.log.length;
  await assert.rejects(a.eng.run(), (e) => e.kind === 'rate');
  assert.strictEqual(gh.log.length, calls, 'no request before reset');
  assert.match(a.eng.statusLine(), /slow down/);
  gh.opts.rate = 0; t.v += 121000;
  await a.eng.run();
  assert.ok(gh.files.has('songs/x.cho'));
});

test('bad token is reported, queue intact', async () => {
  const gh = mockGitHub({ badToken: true }); const a = device(gh);
  a.store.put('songs/x.cho', AG);
  await assert.rejects(a.eng.run(), (e) => e.kind === 'auth');
  assert.match(a.eng.statusLine(), /Token rejected/);
  assert.strictEqual(a.store.queue().length, 1);
});

test('test() refuses a public repo', async () => {
  await assert.rejects(device(mockGitHub({ public: true })).eng.test(), (e) => e.kind === 'public');
  const ok = await device(mockGitHub()).eng.test();
  assert.strictEqual(ok.private, true);
});

test('to-add list conflict merges as a union', async () => {
  const gh = mockGitHub(); const a = device(gh); const b = device(gh);
  a.store.setTodo(Store.parseTodo('- [ ] Amazing Grace | John Newton\n')); await a.eng.run(); await b.eng.run();
  a.store.setTodo(Store.parseTodo('- [ ] Amazing Grace | John Newton\n- [ ] Simple Gifts | Joseph Brackett\n')); await a.eng.run();
  b.store.setTodo(Store.parseTodo('- [x] Amazing Grace | John Newton\n- [ ] Be Thou My Vision | Traditional\n')); await b.eng.run();
  const t = Store.parseTodo(gh.files.get('todo.md').text);
  assert.deepStrictEqual(t.items.map((i) => i.title).sort(), ['Amazing Grace', 'Be Thou My Vision', 'Simple Gifts']);
  assert.ok(t.items.find((i) => i.title === 'Amazing Grace').done);
  assert.ok(![...gh.files.keys()].some((p) => p.includes('conflict')));
});

test('remote deleted while edited locally: local edit is restored', async () => {
  const gh = mockGitHub(); const a = device(gh); const b = device(gh);
  a.store.put('songs/x.cho', AG); await a.eng.run(); await b.eng.run();
  a.store.remove('songs/x.cho'); await a.eng.run();
  b.store.put('songs/x.cho', AG + 'keep me\n'); await b.eng.run();
  assert.strictEqual(gh.files.get('songs/x.cho').text, AG + 'keep me\n');
});
