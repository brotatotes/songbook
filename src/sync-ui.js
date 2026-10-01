/* Songbook sync UI: token setup screen, sign-out, and wiring the engine to the app (sync on open and save). */
(function () {
  'use strict';
  const Core = window.SongSyncCore;
  if (!Core) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEFAULT_REPO = 'brotatotes/songbook-songs';
  function readAuth() { try { return JSON.parse(localStorage.getItem(Core.AUTH_KEY) || 'null'); } catch (e) { return null; } }
  function writeAuth(a) { if (a) localStorage.setItem(Core.AUTH_KEY, JSON.stringify(a)); else localStorage.removeItem(Core.AUTH_KEY); }
  let pending = null;
  let engine = null;
  function eng() {
    if (!engine) engine = Core.createEngine({ fetch: (u, i) => window.fetch(u, i), store: window.songStore, Store: window.Store, auth: () => pending || readAuth() });
    return engine;
  }
  const toast = (m) => window.songbookToast && window.songbookToast(m);

  async function run(reason) {
    if (!readAuth()) return null;
    const p = eng().run();
    refreshLine();
    try {
      const r = await p;
      if (r.conflicts.length) toast('Edited on two devices. Both versions were kept: look for \u201cconflict copy\u201d.');
      else if (reason === 'manual') toast('Synced.');
      return r;
    } catch (e) {
      if (reason === 'manual' || reason === 'save') toast(eng().statusLine());
      throw e;
    } finally { refreshLine(); }
  }
  function refreshLine() {
    const line = eng().statusLine();
    const l = document.getElementById('syncline'); if (l) l.textContent = line;
    const s = document.getElementById('syncstatus'); if (s && readAuth()) s.textContent = line;
    const b = document.getElementById('syncnow'); if (b) b.disabled = eng().status().state === 'syncing';
  }

  function renderSetup(main) {
    const a = readAuth();
    const steps = '<ol class="steps">' +
      '<li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">GitHub\u2019s new fine-grained token page</a>.</li>' +
      '<li>Name it \u201cSongbook\u201d. Under Repository access choose <b>Only select repositories</b> and pick your songs repository.</li>' +
      '<li>Under Repository permissions set <b>Contents</b> to <b>Read and write</b>. Leave everything else as it is.</li>' +
      '<li>Generate the token, copy it and paste it below. Do this once on each device.</li></ol>';
    if (a) {
      main.innerHTML = '<h1>Sync</h1><p class="sub">Songs sync with <b>' + esc(a.repo) + '</b>. The token stays in this browser and is only sent to GitHub.</p>' +
        '<p class="status" id="syncstatus" aria-live="polite">' + esc(eng().statusLine()) + '</p>' +
        '<div class="actions"><button class="btn" id="syncnow"' + (eng().status().state === 'syncing' ? ' disabled' : '') + '>Sync now</button><button class="btn link danger" id="signout">Sign out on this device</button></div>';
      document.getElementById('syncnow').onclick = () => run('manual').then(() => window.songbookRefresh && window.songbookRefresh()).catch(() => {});
      document.getElementById('signout').onclick = () => {
        if (!confirm('Sign out of sync on this device? The token is removed from this browser.')) return;
        writeAuth(null);
        const waiting = window.songStore.queue().length;
        if (confirm('Also remove the songs saved in this browser?' + (waiting ? ' ' + waiting + ' unsynced changes would be lost.' : ' They are safe in your repository.'))) window.songStore.clear();
        toast('Signed out.'); renderSetup(main); window.songbookRefresh && window.songbookRefresh();
      };
      return;
    }
    main.innerHTML = '<h1>Sync</h1><p class="sub">Songs are saved in this browser. Connect your private GitHub repository to keep them on every device.</p>' + steps +
      '<form id="authf"><div class="field"><label for="repo">Repository</label><input id="repo" autocomplete="off" spellcheck="false" value="' + DEFAULT_REPO + '"></div>' +
      '<div class="field"><label for="tok">Token</label><input id="tok" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_\u2026"></div>' +
      '<div class="actions"><button class="btn" type="submit">Test and save</button></div></form><p class="status" id="syncstatus" aria-live="polite" hidden></p>';
    document.getElementById('authf').onsubmit = async (e) => {
      e.preventDefault();
      const repo = document.getElementById('repo').value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '');
      const token = document.getElementById('tok').value.trim();
      const st = document.getElementById('syncstatus'); st.hidden = false;
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) { st.textContent = 'Enter the repository as owner/name and paste the token.'; return; }
      st.textContent = 'Checking\u2026';
      pending = { repo, token };
      try { await eng().test(); writeAuth(pending); pending = null; } catch (err) { pending = null; st.textContent = err.message + '.'; return; }
      st.textContent = 'Connected. Syncing\u2026';
      try { await run('manual'); } catch (err) { /* status line explains */ }
      renderSetup(main); window.songbookRefresh && window.songbookRefresh();
    };
  }

  window.SongSync = { ready: true, configured: () => !!readAuth(), run, renderSetup, statusLine: () => eng().statusLine() };
  window.addEventListener('online', () => { run('online').then(() => window.songbookRefresh && window.songbookRefresh()).catch(() => {}); });
})();
