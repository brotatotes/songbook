const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/store.js');

test('todo.md parse and write keep items and unknown lines', () => {
  const text = '# Songs to add\n\n- [ ] Be Thou My Vision | Irish traditional\n- [x] Amazing Grace | John Newton\n- [ ] Simple Gifts\nnote: ask about key\n';
  const t = S.parseTodo(text);
  assert.equal(t.items.length, 3);
  assert.deepEqual(t.items[1], { done: true, title: 'Amazing Grace', artist: 'John Newton' });
  assert.equal(t.items[2].artist, '');
  assert.deepEqual(t.extra, ['note: ask about key']);
  const out = S.writeTodo(t);
  assert.deepEqual(S.parseTodo(out), t);
  assert.equal(S.writeTodo(S.parseTodo(out)), out);
});

test('todo merge is a union where checked wins', () => {
  const a = S.parseTodo('- [ ] Amazing Grace | John Newton\n- [ ] Simple Gifts | Joseph Brackett\n');
  const b = S.parseTodo('- [x] amazing grace | john newton\n- [ ] Be Thou My Vision | Irish traditional\n');
  const m = S.mergeTodo(a, b);
  assert.deepEqual(m.items.map((i) => [i.title, i.done]), [['Amazing Grace', true], ['Simple Gifts', false], ['Be Thou My Vision', false]]);
});

test('saving a matching title ticks the to-add item', () => {
  const t = S.parseTodo('- [ ] Be Thou My Vision (live) | Irish traditional\n');
  assert.equal(S.tickMatching(t, 'be thou my vision'), true);
  assert.equal(t.items[0].done, true);
  assert.equal(S.tickMatching(t, 'be thou my vision'), false);
});

test('store cache: dirty queue, deletes, clean state, persistence', () => {
  const storage = S.memoryStorage();
  let clock = 1;
  const st = S.createStore(storage, () => clock++);
  st.put('songs/a--one.cho', 'x');
  st.setClean('songs/b--two.cho', 'y', 'sha-b');
  st.remove('songs/b--two.cho');
  assert.deepEqual(st.queue(), ['songs/a--one.cho', 'songs/b--two.cho']);
  assert.deepEqual(st.songPaths(), ['songs/a--one.cho']);
  st.put('songs/c--never-synced.cho', 'z');
  st.remove('songs/c--never-synced.cho');
  assert.equal(st.raw('songs/c--never-synced.cho'), null);
  const again = S.createStore(storage);
  assert.equal(again.device(), st.device());
  assert.deepEqual(again.queue(), ['songs/a--one.cho', 'songs/b--two.cho']);
  assert.equal(again.uniquePath('songs/a--one.cho'), 'songs/a--one-2.cho');
});

test('corrupt storage starts fresh', () => {
  const storage = S.memoryStorage();
  storage.setItem(S.KEY, '{not json');
  const st = S.createStore(storage);
  assert.deepEqual(st.paths(), []);
});
