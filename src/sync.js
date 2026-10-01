/* Songbook sync: GitHub REST contents API, SHA-checked, keep-both on conflict, offline queue.
   The engine takes fetch, store and auth by injection so node tests can mock the API.
   Only https://api.github.com is ever contacted, and only after a token is saved. */
(function (global) {
  'use strict';

  const API = 'https://api.github.com';
  const AUTH_KEY = 'songbook.auth';

  function b64encode(text) {
    if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
    const bytes = new TextEncoder().encode(text); let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64decode(b64) {
    const clean = String(b64 || '').replace(/\s+/g, '');
    if (typeof Buffer !== 'undefined') return Buffer.from(clean, 'base64').toString('utf8');
    const bin = atob(clean); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

  class SyncError extends Error {
    constructor(kind, message, extra) { super(message); this.kind = kind; Object.assign(this, extra || {}); }
  }

  function titleOf(path, text) {
    const m = /\{\s*(?:title|t)\s*:\s*([^}]*)\}/i.exec(text || '');
    if (m && m[1].trim()) return m[1].trim();
    return path.replace(/^.*\//, '').replace(/\.cho$/, '');
  }
  function stamp(t) {
    const d = new Date(t); const z = (n) => String(n).padStart(2, '0');
    return d.getUTCFullYear() + z(d.getUTCMonth() + 1) + z(d.getUTCDate()) + '-' + z(d.getUTCHours()) + z(d.getUTCMinutes());
  }
  function conflictPath(path, device, t) {
    return path.replace(/(\.[a-z]+)$/, '') + '.conflict-' + stamp(t) + '-' + (device || 'dev') + (/\.[a-z]+$/.exec(path) || ['.cho'])[0];
  }

  function createEngine(opts) {
    const fetchFn = opts.fetch;
    const store = opts.store;
    const now = opts.now || (() => Date.now());
    const Store = opts.Store || global.Store;
    const auth = () => opts.auth();
    let running = null;
    let status = { state: 'idle', message: '', conflicts: 0, waitUntil: 0 };

    async function call(method, path, body) {
      const a = auth();
      if (!a || !a.token || !a.repo) throw new SyncError('setup', 'Sync is not set up');
      const t = now();
      if (status.waitUntil && t < status.waitUntil) throw new SyncError('rate', 'GitHub rate limit, waiting', { until: status.waitUntil });
      let res;
      try {
        res = await fetchFn(API + '/repos/' + a.repo + (path ? '/contents/' + encPath(path) : ''), {
          method,
          headers: { Authorization: 'Bearer ' + a.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          cache: 'no-store',
        });
      } catch (e) {
        throw new SyncError('offline', 'Offline');
      }
      if (res.status === 401) throw new SyncError('auth', 'Token rejected');
      const remaining = res.headers && res.headers.get ? res.headers.get('x-ratelimit-remaining') : null;
      if ((res.status === 403 || res.status === 429) && (remaining === '0' || res.status === 429 || (res.headers && res.headers.get && res.headers.get('retry-after')))) {
        const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
        const after = Number(res.headers.get('retry-after')) * 1000;
        status.waitUntil = reset > t ? reset : t + (after > 0 ? after : 60000);
        throw new SyncError('rate', 'GitHub rate limit', { until: status.waitUntil });
      }
      if (res.status === 403) throw new SyncError('auth', 'Token does not have access to this repository');
      let json = null;
      try { json = await res.json(); } catch (e) { json = null; }
      return { status: res.status, json };
    }

    async function listRemote() {
      const out = new Map();
      const songs = await call('GET', 'songs');
      if (songs.status === 200 && Array.isArray(songs.json)) {
        for (const f of songs.json) if (f.type === 'file' && /\.cho$/.test(f.name)) out.set(f.path, f.sha);
      } else if (songs.status !== 404) throw httpError(songs);
      const todo = await call('GET', 'todo.md');
      if (todo.status === 200 && todo.json && todo.json.sha) out.set('todo.md', { sha: todo.json.sha, content: todo.json.content });
      else if (todo.status !== 404) throw httpError(todo);
      return out;
    }
    function httpError(r) {
      if (r.status >= 500) return new SyncError('server', 'GitHub is having trouble (' + r.status + ')');
      return new SyncError('http', 'Unexpected response ' + r.status);
    }
    const shaOf = (v) => (v && typeof v === 'object' ? v.sha : v);

    async function getText(path) {
      const r = await call('GET', path);
      if (r.status === 404) return null;
      if (r.status !== 200 || !r.json) throw httpError(r);
      return { text: b64decode(r.json.content), sha: r.json.sha };
    }
    async function putText(path, text, sha, message) {
      const body = { message, content: b64encode(text) };
      if (sha) body.sha = sha;
      const r = await call('PUT', path, body);
      if (r.status === 200 || r.status === 201) return { ok: true, sha: r.json.content.sha };
      if (r.status === 409 || r.status === 422) return { ok: false, stale: true };
      throw httpError(r);
    }

    async function pushDirty(path, remote, report) {
      const f = store.raw(path);
      const remoteSha = shaOf(remote.get(path)) || null;
      const title = titleOf(path, f.text);
      if (remoteSha === (f.baseSha || null)) {
        const r = await putText(path, f.text, f.baseSha, (f.baseSha ? 'Update ' : 'Add ') + title);
        if (r.ok) { store.setClean(path, f.text, r.sha); remote.set(path, r.sha); return; }
      }
      // remote moved on (or the PUT was stale): keep both
      const theirs = await getText(path);
      if (theirs && theirs.text === f.text) { store.setClean(path, theirs.text, theirs.sha); remote.set(path, theirs.sha); return; }
      if (path === 'todo.md' && Store) {
        const merged = Store.writeTodo(Store.mergeTodo(Store.parseTodo(theirs ? theirs.text : ''), Store.parseTodo(f.text)));
        const r = await putText(path, merged, theirs ? theirs.sha : null, 'Merge to-add list');
        if (r.ok) { store.setClean(path, merged, r.sha); remote.set(path, r.sha); return; }
        throw new SyncError('server', 'To-add list changed during sync, will retry');
      }
      if (!theirs) { // deleted remotely while edited here: put it back
        const r = await putText(path, f.text, null, 'Add ' + title);
        if (r.ok) { store.setClean(path, f.text, r.sha); remote.set(path, r.sha); return; }
        throw new SyncError('server', 'Could not save ' + title);
      }
      const cpath = conflictPath(path, store.device(), now());
      const r = await putText(cpath, f.text, null, 'Conflict copy of ' + title);
      if (!r.ok) throw new SyncError('server', 'Could not save conflict copy of ' + title);
      store.setClean(cpath, f.text, r.sha); remote.set(cpath, r.sha);
      store.setClean(path, theirs.text, theirs.sha); remote.set(path, theirs.sha);
      report.conflicts.push({ path, copy: cpath, title });
    }

    async function pushDelete(path, remote) {
      const f = store.raw(path);
      const remoteSha = shaOf(remote.get(path)) || null;
      if (!remoteSha) { store.forget(path); return; }
      if (remoteSha !== f.baseSha) { store.forget(path); return; } // changed elsewhere: keep theirs, it is pulled below
      const r = await call('DELETE', path, { message: 'Delete ' + titleOf(path, f.text), sha: f.baseSha });
      if (r.status === 200 || r.status === 404) { store.forget(path); remote.delete(path); return; }
      if (r.status === 409 || r.status === 422) { store.forget(path); return; }
      throw httpError(r);
    }

    async function runOnce() {
      const report = { pushed: 0, pulled: 0, removed: 0, conflicts: [] };
      const remote = await listRemote();
      for (const path of store.queue()) {
        const f = store.raw(path);
        if (f.deleted) await pushDelete(path, remote);
        else { await pushDirty(path, remote, report); report.pushed++; }
      }
      for (const [path, v] of remote) {
        const sha = shaOf(v);
        const f = store.raw(path);
        if (f && (f.dirty || f.deleted)) continue;
        if (f && f.baseSha === sha) continue;
        if (v && typeof v === 'object' && v.content) store.setClean(path, b64decode(v.content), sha);
        else { const t = await getText(path); if (t) store.setClean(path, t.text, t.sha); }
        report.pulled++;
      }
      const all = Object.keys(store.data().files);
      for (const path of all) {
        const f = store.raw(path);
        if (f && !f.dirty && !f.deleted && f.baseSha && !remote.has(path)) { store.forget(path); report.removed++; }
      }
      store.lastSync(now());
      return report;
    }

    function run() {
      if (running) return running.then(() => run());
      running = (async () => {
        status = Object.assign(status, { state: 'syncing', message: '' });
        try {
          const report = await runOnce();
          status = { state: 'ok', message: '', conflicts: report.conflicts.length, waitUntil: 0 };
          return report;
        } catch (e) {
          status.state = e.kind || 'error';
          status.message = e.message;
          throw e;
        } finally { running = null; }
      })();
      return running;
    }

    async function test() {
      const r = await call('GET', '');
      if (r.status === 404) throw new SyncError('auth', 'Repository not found, or the token cannot see it');
      if (r.status !== 200 || !r.json) throw httpError(r);
      if (!r.json.private) throw new SyncError('public', 'That repository is public. Use a private repository for your songs.');
      if (r.json.permissions && r.json.permissions.push === false) throw new SyncError('auth', 'The token can read but not write. Give it Contents: Read and write.');
      return r.json;
    }

    function statusLine() {
      const waiting = store.queue().length;
      const w = waiting ? ', ' + waiting + (waiting === 1 ? ' change' : ' changes') + ' waiting' : '';
      if (status.state === 'syncing') return 'Syncing\u2026';
      if (status.state === 'offline') return 'Offline' + w + '.';
      if (status.state === 'auth') return status.message + '. Check Sync setup.';
      if (status.state === 'rate') return 'GitHub asked us to slow down. Next sync after ' + new Date(status.waitUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + w + '.';
      if (status.state === 'server' || status.state === 'http' || status.state === 'error') return 'Sync problem: ' + status.message + w + '.';
      const last = store.lastSync();
      if (!last) return 'Not synced yet' + w + '.';
      const mins = Math.round((now() - last) / 60000);
      return 'Synced ' + (mins < 1 ? 'just now' : mins === 1 ? '1 min ago' : mins < 60 ? mins + ' min ago' : new Date(last).toLocaleString()) + w + '.';
    }

    return { run, test, statusLine, status: () => status, call };
  }

  const SongSync = { createEngine, b64encode, b64decode, conflictPath, titleOf, SyncError, AUTH_KEY, API };
  if (typeof module !== 'undefined' && module.exports) module.exports = SongSync;
  else global.SongSyncCore = SongSync;
})(typeof globalThis !== 'undefined' ? globalThis : this);
