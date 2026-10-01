/* Songbook app: screens and interaction. Needs SongParse, Store, Shapes and Theory. Sync is optional (added by src/sync.js). */
(function () {
  'use strict';
  const P = window.SongParse;
  const St = window.Store;
  const store = St.createStore(window.localStorage);
  window.songStore = store;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const main = $('#main');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pretty = (s) => String(s).replace(/([A-G])#/g, '$1\u266F').replace(/([A-G])b/g, '$1\u266D');
  const norm = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // ---------- settings ----------
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  function applyTheme() {
    const d = store.setting('dark');
    document.documentElement.classList.toggle('dark', d == null ? prefersDark : !!d);
  }
  applyTheme();
  const isDark = () => document.documentElement.classList.contains('dark');
  const SIZES = [0.95, 1.05, 1.15, 1.3, 1.45, 1.65, 1.85];
  function sizeIdx() { const v = store.setting('size'); return v == null ? 2 : Math.max(0, Math.min(SIZES.length - 1, v)); }
  function songPrefs(path) { return Object.assign({ semis: 0, capo: 0 }, store.setting('song:' + path) || {}); }
  function setSongPrefs(path, p) { store.setting('song:' + path, p); }

  // ---------- parse cache ----------
  const parsed = new Map();
  function songAt(path) {
    const f = store.get(path);
    if (!f) return null;
    const c = parsed.get(path);
    if (c && c.text === f.text) return c.song;
    const song = P.parseSong(f.text);
    parsed.set(path, { text: f.text, song, plain: norm(P.plainText(song)) });
    return song;
  }
  function plainAt(path) { songAt(path); const c = parsed.get(path); return c ? c.plain : ''; }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
  }
  window.songbookToast = toast;

  function syncApi() { return window.SongSync && window.SongSync.ready ? window.SongSync : null; }
  function kickSync(reason) { const s = syncApi(); if (s && s.configured()) s.run(reason).then(() => { if (window.songbookRefresh) window.songbookRefresh(); }).catch(() => {}); }

  // ---------- routing ----------
  function route() {
    const h = location.hash.replace(/^#/, '') || '/';
    const parts = h.split('/').filter(Boolean);
    document.querySelectorAll('.nav a').forEach((a) => a.removeAttribute('aria-current'));
    main.classList.remove('wide');
    closeSheet();
    const r = parts[0] || '';
    if (r === 'song' && parts[1]) return viewSong(decodeURIComponent(parts.slice(1).join('/')));
    if (r === 'new') { mark('new'); return viewEdit(null); }
    if (r === 'edit' && parts[1]) return viewEdit(decodeURIComponent(parts.slice(1).join('/')));
    if (r === 'todo') { mark('todo'); return viewTodo(); }
    if (r === 'sync') { mark('sync'); return viewSync(); }
    return viewLibrary();
  }
  function mark(k) { const a = document.querySelector('[data-nav="' + k + '"]'); if (a) a.setAttribute('aria-current', 'page'); }
  window.addEventListener('hashchange', () => { route(); main.focus({ preventScroll: true }); window.scrollTo(0, 0); });
  window.songbookRefresh = () => { updateCounts(); const h = location.hash; if (!/^#\/(new|edit)/.test(h)) route(); };

  function updateCounts() {
    const open = store.todo().items.filter((i) => !i.done).length;
    $('#todoCount').textContent = open ? '(' + open + ')' : '';
  }

  // ---------- library ----------
  let libQuery = '';
  function viewLibrary() {
    document.title = 'Songbook';
    const paths = store.songPaths();
    main.innerHTML = '<h1 class="sr-only" style="position:absolute;left:-999px">Library</h1>' +
      '<div class="search"><input type="search" id="q" placeholder="Search titles, artists or lyrics" aria-label="Search songs" autocomplete="off" value="' + esc(libQuery) + '"></div>' +
      '<ul class="songs" id="list"></ul><p class="syncline" id="syncline"></p>';
    const q = $('#q');
    q.addEventListener('input', () => { libQuery = q.value; renderList(); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = $('#list a'); if (a) a.click(); } });
    function renderList() {
      const list = $('#list');
      const nq = norm(libQuery).trim();
      const rows = [];
      for (const p of paths) {
        const s = songAt(p);
        const title = s.meta.title || 'Untitled';
        const artist = s.meta.artist || '';
        let hit = '';
        if (nq) {
          const inMeta = norm(title + ' ' + artist).includes(nq);
          if (!inMeta) {
            const plain = plainAt(p);
            const i = plain.indexOf(nq);
            if (i < 0) continue;
            const ls = plain.lastIndexOf('\n', i) + 1; let le = plain.indexOf('\n', i); if (le < 0) le = plain.length;
            hit = P.plainText(s).slice(ls, le).trim();
          }
        }
        rows.push({ p, title, artist, hit, conflict: /\.conflict-/.test(p) });
      }
      rows.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
      if (!paths.length) {
        list.innerHTML = '<li class="empty" style="border:none">No songs yet. <a href="#/new">Paste your first song</a>' + (syncApi() && !syncApi().configured() ? ', or <a href="#/sync">set up sync</a> to load your collection.' : '.') + '</li>';
      } else if (!rows.length) {
        list.innerHTML = '<li class="empty" style="border:none">Nothing matches \u201c' + esc(libQuery) + '\u201d.</li>';
      } else {
        list.innerHTML = rows.map((r) => '<li><a href="#/song/' + encodeURIComponent(r.p) + '"><span><span class="t">' + esc(r.title) + '</span>' +
          (r.conflict ? '<span class="tag">conflict copy</span>' : '') + (r.hit ? '<span class="hit">' + esc(r.hit) + '</span>' : '') +
          '</span><span class="a">' + esc(r.artist) + '</span></a></li>').join('');
      }
    }
    renderList();
    $('#syncline').textContent = syncLine();
    if (!matchMedia('(pointer: coarse)').matches) q.focus({ preventScroll: true });
  }
  function syncLine() {
    const s = syncApi();
    if (!s || !s.configured()) return 'Songs are saved in this browser. Sync is not set up.';
    return s.statusLine();
  }

  // ---------- song rendering ----------
  function chordBtn(sym) {
    const real = P.isChordToken(sym.replace(/^\(|\)$/g, ''));
    if (!real) return '<span class="mark">' + esc(pretty(sym)) + '</span>';
    return '<button type="button" class="ch" data-chord="' + esc(sym.replace(/^\(|\)$|\*+$/g, '')) + '">' + esc(pretty(sym)) + '</button>';
  }
  function renderLyric(line) {
    // pieces: split each segment into words; the chord rides on the first piece.
    const pieces = [];
    for (const sg of line.segs) {
      const toks = sg.text.match(/\s+|\S+\s*/g) || [''];
      toks.forEach((t, i) => pieces.push({ chord: i === 0 ? sg.chord : null, text: t }));
    }
    // group pieces into unbreakable words: a new word starts after whitespace.
    const words = []; let cur = null; let prevEndsSpace = true;
    for (const pc of pieces) {
      if (!cur || prevEndsSpace) { cur = []; words.push(cur); }
      cur.push(pc);
      prevEndsSpace = /\s$/.test(pc.text) || pc.text === '';
    }
    const has = line.segs.some((s) => s.chord);
    // A chord floats over its syllable without widening it. Only when the lyric text before the next chord is shorter
    // than the chord itself does the last piece of that segment get padding, so chords never collide.
    let need = 0; let pending = null;
    const pad = new Map();
    for (const pc of pieces) {
      if (pc.chord) { if (pending && need > 0) pad.set(pending, need); need = pc.chord.length + 1; }
      need -= pc.text.length; pending = pc;
    }
    if (pending && need > 0 && pending.chord == null) pad.set(pending, need);
    const html = words.map((w) => '<span class="wd' + (w.some((pc) => pc.chord) ? '' : ' nc') + '">' + w.map((pc) => '<span class="sg"><span class="c">' + (pc.chord ? chordBtn(pc.chord) : '') +
      '</span><span class="w"' + (pad.has(pc) ? ' style="padding-right:' + (pad.get(pc) * 0.56).toFixed(2) + 'em"' : '') + '>' + (esc(pc.text) || (pc.chord ? '\u00a0' : '')) + '</span></span>').join('') + '</span>').join('');
    return '<div class="ln' + (has ? ' has-chords' : '') + '">' + html + '</div>';
  }
  function renderChordRow(line) {
    let out = ''; let col = 0;
    for (const it of line.items) {
      if (it.col > col) out += ' '.repeat(it.col - col);
      else if (out) out += ' ';
      out += chordBtn(it.tok);
      col = Math.max(it.col, col) + it.tok.length + (it.col < col ? 1 : 0);
    }
    return '<div class="chordrow">' + out + '</div>';
  }
  function renderSong(song) {
    let lines = 0;
    const html = song.sections.map((s) => {
      const out = [];
      let tab = null;
      for (const l of s.lines) {
        lines++;
        if (l.type === 'tab') { if (tab) tab.push(l.text); else { tab = [l.text]; out.push(tab); } continue; }
        tab = null;
        if (l.type === 'lyric') out.push(renderLyric(l));
        else if (l.type === 'chords') out.push(renderChordRow(l));
        else if (l.type === 'comment') out.push('<div class="cmt">' + esc(l.text) + '</div>');
        else if (l.type === 'blank') out.push('<div class="blank"></div>');
      }
      const body = out.map((x) => (Array.isArray(x) ? '<div class="tab">' + esc(x.join('\n')) + '</div>' : x)).join('');
      const label = s.label ? '<div class="sec-label">' + esc(s.label) + '</div>' : '';
      return '<section class="sec">' + label + body + '</section>';
    }).join('');
    return { html, lines };
  }

  function viewSong(path) {
    const song0 = songAt(path);
    if (!song0) { main.innerHTML = '<p class="empty">That song is not in this browser. <a href="#/">Back to the library</a></p>'; return; }
    const prefs = songPrefs(path);
    document.title = (song0.meta.title || 'Song') + ' \u00b7 Songbook';
    const key0 = P.songKey(song0);
    function draw() {
      const shown = prefs.semis - prefs.capo;
      const song = P.transposeSong(song0, prefs.semis);
      const disp = prefs.capo ? P.transposeSong(song0, shown) : song;
      const soundKey = P.songKey(song);
      const shapeKey = P.songKey(disp);
      const r = renderSong(disp);
      let summary = '';
      if (soundKey && !song0.meta.key) summary = 'Key guessed from the chords';
      if (prefs.capo) summary = 'Capo ' + prefs.capo + (shapeKey ? ', shapes in ' + pretty(shapeKey) : '') + (soundKey ? ', sounds in ' + pretty(soundKey) : '');
      const extra = [song0.meta.tempo ? song0.meta.tempo + ' bpm' : '', song0.meta.time || ''].filter(Boolean).join(' \u00b7 ');
      main.innerHTML = '<div class="songhead"><h1>' + esc(song0.meta.title || 'Untitled') + '</h1>' +
        '<p class="sub">' + esc(song0.meta.artist || '') + '</p></div>' +
        '<div class="tools" role="toolbar" aria-label="Song controls">' +
        '<span class="tool"><span class="lbl">Key</span><button class="step" data-act="down" aria-label="Transpose down">\u2212</button><span class="val" aria-live="polite" id="keyval">' + esc(pretty(soundKey || (prefs.semis > 0 ? '+' : '') + prefs.semis)) + '</span><button class="step" data-act="up" aria-label="Transpose up">+</button></span>' +
        '<span class="tool"><span class="lbl">Capo</span><button class="step" data-act="capodown" aria-label="Capo down">\u2212</button><span class="val" id="capoval">' + (prefs.capo || 'off') + '</span><button class="step" data-act="capoup" aria-label="Capo up">+</button></span>' +
        '<span class="tool"><span class="lbl">Size</span><button class="step" data-act="smaller" aria-label="Smaller text">A\u2212</button><button class="step" data-act="bigger" aria-label="Larger text">A+</button></span>' +
        '<span class="right"><button class="btn link" data-act="dark" aria-pressed="' + isDark() + '">' + (isDark() ? 'Light' : 'Dark') + '</button>' +
        '<button class="btn link" data-act="print">Print</button><a class="btn link" href="#/edit/' + encodeURIComponent(path) + '">Edit</a></span></div>' +
        '<p class="sub small summary" id="summary">' + esc(summary) + (extra ? ' \u00b7 ' + esc(extra) : '') + (prefs.semis ? ' \u00b7 <button class="btn link" data-act="reset">original key ' + esc(pretty(key0 || '')) + '</button>' : '') + '</p>' +
        '<div class="sheetbody' + (r.lines > 48 ? ' long' : '') + '" id="sheetbody" style="--size:' + SIZES[sizeIdx()] + 'rem">' + r.html + '</div>';
      sheetKey = shapeKey;
    }
    draw();
    main.onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (b) {
        const a = b.dataset.act;
        if (a === 'up') prefs.semis = (prefs.semis + 1 + 12) % 12 > 6 ? ((prefs.semis + 1) % 12) - 12 : (prefs.semis + 1) % 12;
        if (a === 'down') prefs.semis = (prefs.semis - 1 + 12) % 12 > 6 ? ((prefs.semis - 1 + 12) % 12) - 12 : (prefs.semis - 1 + 12) % 12;
        if (a === 'reset') prefs.semis = 0;
        if (a === 'capoup') prefs.capo = Math.min(11, prefs.capo + 1);
        if (a === 'capodown') prefs.capo = Math.max(0, prefs.capo - 1);
        if (a === 'smaller') store.setting('size', Math.max(0, sizeIdx() - 1));
        if (a === 'bigger') store.setting('size', Math.min(SIZES.length - 1, sizeIdx() + 1));
        if (a === 'dark') { store.setting('dark', !isDark()); applyTheme(); }
        if (a === 'print') { window.print(); return; }
        setSongPrefs(path, { semis: prefs.semis, capo: prefs.capo });
        const focusAct = a;
        draw();
        const again = main.querySelector('[data-act="' + focusAct + '"]');
        if (again) again.focus();
        return;
      }
      const c = e.target.closest('button.ch');
      if (c) openSheet(c.dataset.chord, c);
    };
  }

  // ---------- chord diagram sheet ----------
  let sheetKey = null; let sheetState = null; let sheetReturn = null;
  function openSheet(sym, from) {
    sheetReturn = from || null;
    const inst = store.setting('inst') || 'guitar';
    sheetState = { sym, inst, idx: 0 };
    drawSheet();
    $('#toast').classList.remove('on');
    $('#sheet').hidden = false; $('#sheetBack').hidden = false;
    const f = $('#sheet button'); if (f) f.focus();
  }
  function closeSheet() {
    const s = $('#sheet'); if (!s || s.hidden) return;
    s.hidden = true; $('#sheetBack').hidden = true;
    if (sheetReturn && document.body.contains(sheetReturn)) sheetReturn.focus();
    sheetReturn = null;
  }
  function drawSheet() {
    const { sym, inst } = sheetState;
    const T = window.Theory; const Sh = window.Shapes;
    let body = ''; let nav = ''; let notes = '';
    const chord = T.parseChord(sym);
    if (!chord) body = '<p class="muted">No diagram for this chord.</p>';
    else if (inst === 'piano') {
      const v = Sh.pianoVoicing(chord);
      body = pianoSvg(v);
      notes = v.map((n) => pretty(n.name)).join(' \u00b7 ');
    } else {
      const shapes = Sh.findShapes(chord, inst, 8);
      if (!shapes.length) body = '<p class="muted">No playable shape found.</p>';
      else {
        const i = Math.min(sheetState.idx, shapes.length - 1);
        const sh = shapes[i];
        body = fretSvg(sh, Sh.INSTRUMENTS[inst].strings.length);
        notes = sh.notes.map((n, k) => (sh.frets[k] < 0 ? '' : pretty(n))).filter(Boolean).join(' \u00b7 ');
        nav = '<div class="nav2"><button class="btn link" data-sh="prev" ' + (i ? '' : 'disabled') + ' aria-label="Previous shape">\u2039 Prev</button><span>' + (i + 1) + ' of ' + shapes.length + (sh.difficulty ? ' \u00b7 ' + esc(sh.difficulty) : '') + '</span><button class="btn link" data-sh="next" ' + (i < shapes.length - 1 ? '' : 'disabled') + ' aria-label="Next shape">Next \u203a</button></div>';
      }
    }
    const tabs = ['guitar', 'ukulele', 'piano'].map((k) => '<button class="btn" data-inst="' + k + '" aria-pressed="' + (k === inst) + '">' + k[0].toUpperCase() + k.slice(1) + '</button>').join('');
    $('#sheet').innerHTML = '<div class="hd"><span class="nm" id="sheetTitle">' + esc(pretty(sym)) + '</span><button class="btn link" data-sh="close">Close</button></div>' +
      '<div class="tabs">' + tabs + '</div>' + body + (notes ? '<div class="notes">' + esc(notes) + '</div>' : '') + nav;
  }
  document.addEventListener('click', (e) => {
    if (e.target.id === 'sheetBack') return closeSheet();
    const s = e.target.closest('#sheet [data-sh], #sheet [data-inst]');
    if (!s) return;
    if (s.dataset.inst) { sheetState.inst = s.dataset.inst; sheetState.idx = 0; store.setting('inst', s.dataset.inst); drawSheet(); $('#sheet [data-inst="' + s.dataset.inst + '"]').focus(); return; }
    const a = s.dataset.sh;
    if (a === 'close') return closeSheet();
    if (a === 'next') sheetState.idx++;
    if (a === 'prev') sheetState.idx = Math.max(0, sheetState.idx - 1);
    drawSheet();
    const again = $('#sheet [data-sh="' + a + '"]:not([disabled])') || $('#sheet [data-sh="close"]'); again.focus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
    if (e.key === 'Tab' && !$('#sheet').hidden) { // keep focus inside the sheet
      const f = Array.from($('#sheet').querySelectorAll('button:not([disabled])'));
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  function fretSvg(sh, n) {
    const W = 180; const H = 200; const left = 30; const top = 40; const gap = (W - 2 * left + 20) / (n - 1); const fh = 30; const rows = 5;
    const played = sh.frets.filter((f) => f > 0);
    const minF = played.length ? Math.min(...played) : 1;
    const maxF = played.length ? Math.max(...played) : 1;
    const base = maxF <= 5 ? 1 : minF;
    const ink = 'currentColor';
    let s = '<svg viewBox="0 0 ' + (W + 20) + ' ' + H + '" width="200" height="200" role="img" aria-label="Chord shape ' + sh.frets.map((f) => (f < 0 ? 'x' : f)).join(' ') + '" style="color:var(--ink)">';
    const x = (i) => left + i * gap;
    s += base === 1 ? '<rect x="' + x(0) + '" y="' + (top - 4) + '" width="' + (x(n - 1) - x(0)) + '" height="5" fill="' + ink + '"/>' : '<text x="' + (x(0) - 8) + '" y="' + (top + fh * 0.65) + '" font-size="15" text-anchor="end" fill="' + ink + '">' + base + 'fr</text>';
    for (let r = 0; r <= rows; r++) s += '<line x1="' + x(0) + '" x2="' + x(n - 1) + '" y1="' + (top + r * fh) + '" y2="' + (top + r * fh) + '" stroke="' + ink + '" stroke-opacity="0.55"/>';
    for (let i = 0; i < n; i++) s += '<line x1="' + x(i) + '" x2="' + x(i) + '" y1="' + top + '" y2="' + (top + rows * fh) + '" stroke="' + ink + '" stroke-opacity="0.7"/>';
    for (const b of sh.barres || []) {
      const y = top + (b.fret - base + 0.5) * fh;
      s += '<rect x="' + (x(b.from) - 9) + '" y="' + (y - 9) + '" width="' + (x(b.to) - x(b.from) + 18) + '" height="18" rx="9" fill="var(--chord)"/>';
    }
    sh.frets.forEach((f, i) => {
      if (f < 0) s += '<text x="' + x(i) + '" y="' + (top - 12) + '" font-size="15" text-anchor="middle" fill="' + ink + '">\u00d7</text>';
      else if (f === 0) s += '<circle cx="' + x(i) + '" cy="' + (top - 17) + '" r="5.5" fill="none" stroke="' + ink + '" stroke-width="1.4"/>';
      else {
        const y = top + (f - base + 0.5) * fh;
        s += '<circle cx="' + x(i) + '" cy="' + y + '" r="9.5" fill="var(--chord)"/>';
        const fg = sh.fingers && sh.fingers[i];
        if (fg && fg !== 0) s += '<text x="' + x(i) + '" y="' + (y + 4.5) + '" font-size="13" text-anchor="middle" fill="var(--paper)">' + fg + '</text>';
      }
    });
    return s + '</svg>';
  }
  function pianoSvg(v) {
    if (!v.length) return '';
    const lo = Math.floor(Math.min(...v.map((n) => n.midi)) / 12) * 12;
    const hi = lo + 24 + (Math.max(...v.map((n) => n.midi)) >= lo + 24 ? 12 : 0);
    const on = new Set(v.map((n) => n.midi));
    const whites = []; for (let m = lo; m < hi; m++) if ([0, 2, 4, 5, 7, 9, 11].includes(m % 12)) whites.push(m);
    const ww = 240 / whites.length; let s = '<svg viewBox="0 0 244 110" width="260" height="117" role="img" aria-label="Piano voicing">';
    whites.forEach((m, i) => { s += '<rect x="' + (2 + i * ww) + '" y="2" width="' + ww + '" height="100" fill="' + (on.has(m) ? 'var(--chord)' : 'var(--field)') + '" stroke="var(--quiet)"/>'; });
    whites.forEach((m, i) => {
      if ([0, 2, 5, 7, 9].includes(m % 12) && m + 1 < hi) s += '<rect x="' + (2 + (i + 1) * ww - ww * 0.32) + '" y="2" width="' + ww * 0.64 + '" height="62" fill="' + (on.has(m + 1) ? 'var(--chord)' : 'var(--ink)') + '" stroke="var(--quiet)"/>';
    });
    return s + '</svg>';
  }

  // ---------- add / edit ----------
  function viewEdit(path) {
    const existing = path ? store.get(path) : null;
    if (path && !existing) { main.innerHTML = '<p class="empty">That song is not in this browser.</p>'; return; }
    main.classList.add('wide');
    document.title = (path ? 'Edit' : 'Add a song') + ' \u00b7 Songbook';
    const s0 = existing ? songAt(path) : null;
    main.innerHTML = '<h1>' + (path ? 'Edit song' : 'Add a song') + '</h1>' +
      '<p class="sub small">Paste chords over lyrics, or ChordPro. Chords, sections and tabs are picked up as you paste.</p>' +
      '<div class="fields"><div><label for="ft">Title</label><input type="text" id="ft" autocomplete="off"></div>' +
      '<div><label for="fa">Artist</label><input type="text" id="fa" autocomplete="off"></div>' +
      '<div class="k"><label for="fk">Key <span id="kguess" class="hint"></span></label><input type="text" id="fk" autocomplete="off" placeholder="G"></div></div>' +
      '<div class="editor"><div><label for="paste" class="sr-only" style="position:absolute;left:-999px">Song text</label>' +
      '<textarea id="paste" class="paste" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="Paste a song here"></textarea>' +
      '<div class="actions"><button class="btn primary" id="save">Save</button><a class="btn link" href="' + (path ? '#/song/' + encodeURIComponent(path) : '#/') + '">Cancel</a>' +
      (path ? '<button class="btn link danger" id="del">Delete song</button>' : '') + '</div></div>' +
      '<div class="preview" aria-label="Preview"><div class="hint" id="pvhint">Preview</div><div class="sheetbody" id="pv"></div></div></div>';
    const ta = $('#paste'); const ft = $('#ft'); const fa = $('#fa'); const fk = $('#fk');
    const touched = { t: false, a: false, k: false };
    if (existing) { ta.value = existing.text; ft.value = s0.meta.title || ''; fa.value = s0.meta.artist || ''; fk.value = s0.meta.key || ''; touched.t = touched.a = touched.k = true; }
    let last = null;
    function update() {
      const song = P.parseSong(ta.value);
      last = song;
      if (!touched.t) ft.value = song.meta.title || '';
      if (!touched.a) fa.value = song.meta.artist || '';
      if (!touched.k) fk.value = song.meta.key || '';
      $('#kguess').textContent = !fk.value && song.guessedKey ? '(guess: ' + pretty(song.guessedKey) + ')' : '';
      fk.placeholder = song.guessedKey || 'G';
      const r = renderSong(song);
      $('#pv').innerHTML = ta.value.trim() ? r.html : '<p class="muted">Nothing pasted yet.</p>';
    }
    ft.addEventListener('input', () => { touched.t = !!ft.value; });
    fa.addEventListener('input', () => { touched.a = !!fa.value; });
    fk.addEventListener('input', () => { touched.k = !!fk.value; update(); });
    ta.addEventListener('input', update);
    update();
    $('#pv').addEventListener('click', (e) => { const c = e.target.closest('button.ch'); if (c) openSheet(c.dataset.chord, c); });
    $('#save').addEventListener('click', () => {
      if (!ta.value.trim()) { toast('Paste a song first.'); ta.focus(); return; }
      const song = last || P.parseSong(ta.value);
      song.meta.title = ft.value.trim() || song.meta.title || 'Untitled';
      song.meta.artist = fa.value.trim() || '';
      if (!song.meta.artist) delete song.meta.artist;
      const k = fk.value.trim();
      if (k && P.parseKey(k)) song.meta.key = P.keyStr(P.parseKey(k));
      else if (!k && song.guessedKey) song.meta.key = song.guessedKey;
      if (!existing && !song.meta.x_added) song.meta.x_added = new Date().toISOString().slice(0, 10);
      const text = P.writeChordPro(song);
      const dest = path || store.uniquePath(P.songPath(song.meta));
      store.put(dest, text);
      const todo = store.todo();
      if (St.tickMatching(todo, song.meta.title)) { store.setTodo(todo); toast('Saved, and ticked off your to-add list.'); } else toast('Saved.');
      updateCounts();
      location.hash = '#/song/' + encodeURIComponent(dest);
      kickSync('save');
    });
    const del = $('#del');
    if (del) del.addEventListener('click', () => {
      if (!confirm('Delete \u201c' + (s0.meta.title || 'this song') + '\u201d? It stays in your repo history.')) return;
      store.remove(path); parsed.delete(path); toast('Deleted.'); location.hash = '#/'; kickSync('delete');
    });
    if (!existing) ta.focus();
  }

  // ---------- songs to add ----------
  let todoQuery = '';
  function viewTodo() {
    document.title = 'Songs to add \u00b7 Songbook';
    main.innerHTML = '<h1>Songs to add</h1><p class="sub small">Your wish list. The links open a normal web search in a new tab. Saving a song with the same title ticks it off.</p>' +
      '<form class="todoadd" id="tf"><input type="text" id="tt" placeholder="Title" aria-label="Title" autocomplete="off" required><input type="text" id="ta" placeholder="Artist" aria-label="Artist" autocomplete="off"><button class="btn" type="submit">Add</button></form>' +
      '<input type="search" id="tq" placeholder="Filter the list" aria-label="Filter the list" value="' + esc(todoQuery) + '">' +
      '<ul class="todos" id="todos"></ul>';
    function draw() {
      const todo = store.todo(); const nq = norm(todoQuery).trim();
      const rows = todo.items.map((it, i) => ({ it, i })).filter((r) => !nq || norm(r.it.title + ' ' + r.it.artist).includes(nq));
      rows.sort((a, b) => (a.it.done - b.it.done) || (a.i - b.i));
      $('#todos').innerHTML = rows.length ? rows.map(({ it, i }) => {
        const q = encodeURIComponent((it.title + ' ' + (it.artist || '')).trim());
        return '<li class="' + (it.done ? 'done' : '') + '"><input type="checkbox" data-i="' + i + '" id="td' + i + '" ' + (it.done ? 'checked' : '') + '>' +
          '<label for="td' + i + '"><span class="tt">' + esc(it.title) + '</span>' + (it.artist ? ' <span class="muted">' + esc(it.artist) + '</span>' : '') + '</label>' +
          '<button class="btn link del" data-del="' + i + '" aria-label="Remove ' + esc(it.title) + '">Remove</button>' +
          '<span class="links"><a href="https://www.google.com/search?q=' + q + '+chords" target="_blank" rel="noopener noreferrer">Search chords</a>' +
          '<a href="https://www.youtube.com/results?search_query=' + q + '" target="_blank" rel="noopener noreferrer">Search YouTube</a>' +
          (it.done ? '' : '<a href="#/new">Paste it</a>') + '</span></li>';
      }).join('') : '<li class="empty" style="display:block;border:none">' + (todo.items.length ? 'Nothing matches.' : 'The list is empty. Add a title above.') + '</li>';
    }
    draw();
    $('#tq').addEventListener('input', (e) => { todoQuery = e.target.value; draw(); });
    $('#tf').addEventListener('submit', (e) => {
      e.preventDefault();
      const t = $('#tt').value.trim(); if (!t) return;
      const todo = store.todo(); todo.items.push({ done: false, title: t, artist: $('#ta').value.trim() });
      store.setTodo(todo); $('#tt').value = ''; $('#ta').value = ''; draw(); updateCounts(); $('#tt').focus(); kickSync('todo');
    });
    $('#todos').addEventListener('change', (e) => {
      const i = e.target.dataset.i; if (i == null) return;
      const todo = store.todo(); todo.items[+i].done = e.target.checked; store.setTodo(todo); draw(); updateCounts(); kickSync('todo');
      const again = $('#td' + i); if (again) again.focus();
    });
    $('#todos').addEventListener('click', (e) => {
      const d = e.target.closest('[data-del]'); if (!d) return;
      const todo = store.todo(); todo.items.splice(+d.dataset.del, 1); store.setTodo(todo); draw(); updateCounts(); kickSync('todo');
    });
  }

  // ---------- sync setup (filled in by src/sync.js when present) ----------
  function viewSync() {
    document.title = 'Sync \u00b7 Songbook';
    const s = syncApi();
    if (s) return s.renderSetup(main);
    main.innerHTML = '<h1>Sync</h1><p class="sub">Songs are saved in this browser only.</p>';
  }

  window.songbookApp = { store, renderSong, songAt, toast, route };
  updateCounts();
  route();
  kickSync('open');
})();
