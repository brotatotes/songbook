/* Songbook local store: song cache keyed by repo path, the to-add list (todo.md) and device settings.
   Storage is injected (localStorage in the browser, a Map-backed shim in node tests). */
(function (global) {
  'use strict';

  const KEY = 'songbook.v1';

  function memoryStorage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  }

  // ---------- todo.md ----------
  const TODO_HEADER = '# Songs to add';
  const ITEM_RE = /^\s*[-*]\s+\[( |x|X)\]\s+(.*?)\s*$/;

  function parseTodo(text) {
    const items = [];
    const extra = [];
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
      const m = ITEM_RE.exec(line);
      if (m) {
        const parts = m[2].split(/\s+\|\s+|\s*\|\s*/);
        items.push({ done: m[1] !== ' ', title: (parts[0] || '').trim(), artist: (parts.slice(1).join(' | ') || '').trim() });
      } else if (line.trim() && line.trim() !== TODO_HEADER) extra.push(line);
    });
    return { items, extra };
  }
  function writeTodo(todo) {
    const out = [TODO_HEADER, ''];
    for (const it of todo.items) out.push('- [' + (it.done ? 'x' : ' ') + '] ' + it.title + (it.artist ? ' | ' + it.artist : ''));
    if (todo.extra && todo.extra.length) { out.push(''); out.push(...todo.extra); }
    return out.join('\n') + '\n';
  }
  const normTitle = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const itemKey = (it) => normTitle(it.title) + '|' + normTitle(it.artist);

  // Union of two todo lists; checked wins. Order follows a, then new items from b.
  function mergeTodo(a, b) {
    const map = new Map();
    const order = [];
    for (const it of a.items.concat(b.items)) {
      const k = itemKey(it);
      if (!map.has(k)) { map.set(k, Object.assign({}, it)); order.push(k); } else if (it.done) map.get(k).done = true;
    }
    const extra = Array.from(new Set((a.extra || []).concat(b.extra || [])));
    return { items: order.map((k) => map.get(k)), extra };
  }
  // Tick the first unchecked item whose title matches. Returns true if one was ticked.
  function tickMatching(todo, title) {
    const t = normTitle(title);
    if (!t) return false;
    const it = todo.items.find((x) => !x.done && normTitle(x.title) === t);
    if (it) { it.done = true; return true; }
    return false;
  }

  // ---------- cache ----------
  function createStore(storage, now) {
    storage = storage || memoryStorage();
    now = now || (() => Date.now());
    let data;
    try { data = JSON.parse(storage.getItem(KEY) || 'null'); } catch (e) { data = null; }
    if (!data || typeof data !== 'object' || !data.files) data = { files: {}, settings: {}, lastSync: 0, device: '' };
    if (!data.device) data.device = Math.random().toString(36).slice(2, 6);
    const save = () => storage.setItem(KEY, JSON.stringify(data));

    const api = {
      data: () => data,
      device: () => data.device,
      get: (path) => { const f = data.files[path]; return f && !f.deleted ? f : null; },
      raw: (path) => data.files[path] || null,
      paths: () => Object.keys(data.files).filter((p) => !data.files[p].deleted),
      songPaths: () => api.paths().filter((p) => /^songs\/.+\.cho$/.test(p)).sort(),
      // local edit: marks dirty for the offline queue
      put(path, text) {
        const f = data.files[path] || { baseSha: null };
        data.files[path] = { text, baseSha: f.baseSha || null, dirty: true, deleted: false, updatedAt: now() };
        save();
      },
      remove(path) {
        const f = data.files[path];
        if (!f) return;
        if (!f.baseSha) delete data.files[path];
        else data.files[path] = Object.assign({}, f, { deleted: true, dirty: false, updatedAt: now() });
        save();
      },
      // state from the server: clean copy at sha
      setClean(path, text, sha) { data.files[path] = { text, baseSha: sha, dirty: false, deleted: false, updatedAt: now() }; save(); },
      forget(path) { delete data.files[path]; save(); },
      queue() {
        return Object.keys(data.files).filter((p) => data.files[p].dirty || data.files[p].deleted)
          .sort((a, b) => data.files[a].updatedAt - data.files[b].updatedAt);
      },
      setting(k, v) { if (v === undefined) return data.settings[k]; data.settings[k] = v; save(); return v; },
      lastSync(t) { if (t === undefined) return data.lastSync; data.lastSync = t; save(); return t; },
      todo() { const f = api.get('todo.md'); return parseTodo(f ? f.text : ''); },
      setTodo(todo) { api.put('todo.md', writeTodo(todo)); },
      clear() { data = { files: {}, settings: data.settings, lastSync: 0, device: data.device }; save(); },
      uniquePath(base) {
        if (!data.files[base] || data.files[base].deleted) return base;
        for (let i = 2; i < 1000; i++) { const p = base.replace(/\.cho$/, '-' + i + '.cho'); if (!data.files[p] || data.files[p].deleted) return p; }
        return base.replace(/\.cho$/, '-' + now() + '.cho');
      },
    };
    save();
    return api;
  }

  const Store = { createStore, memoryStorage, parseTodo, writeTodo, mergeTodo, tickMatching, normTitle, KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
  else global.Store = Store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
