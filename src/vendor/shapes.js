/* Copied from Chord Explorer (https://github.com/brotatotes/chord-explorer), src/shapes.js, by the same author. Unmodified engine code reused by Songbook. */
/* Chord Explorer shape finder. Pure JS, no DOM. Needs Theory (src/theory.js). */
(function (global) {
  'use strict';
  const T = (typeof module !== 'undefined' && module.exports) ? require('./theory.js') : global.Theory;
  const mod = (n, m) => ((n % m) + m) % m;

  const INSTRUMENTS = {
    guitar: { key: 'guitar', name: 'Guitar', strings: ['E', 'A', 'D', 'G', 'B', 'E'], midi: [40, 45, 50, 55, 59, 64], minSounding: 4, bassRule: true },
    ukulele: { key: 'ukulele', name: 'Ukulele', strings: ['G', 'C', 'E', 'A'], midi: [67, 60, 64, 69], minSounding: 4, bassRule: false },
  };
  const MAX_FRET = 15;
  const GRIP_BONUS = 3.5;

  // Which chord tones a shape must contain. The perfect 5th is always optional.
  function requiredTokens(chord, inst) {
    const toks = chord.intervals.map((i) => i.token);
    const optional = new Set(chord.parts.sus || chord.parts.power ? [] : ['5']);
    if (toks.includes('13')) { optional.add('11'); optional.add('9'); }
    else if (toks.includes('11') && toks.includes('b7')) { optional.add('9'); optional.add('3'); }
    let req = toks.filter((t) => !optional.has(t));
    const room = inst.strings.length - (chord.bass && !samePcAsChordTone(chord) ? 1 : 0);
    // On a four-string instrument drop the 9th, then the root, if the chord has too many tones.
    const dropOrder = ['9', '1'];
    for (const d of dropOrder) { if (req.length > room && req.includes(d) && !(d === '1' && chord.bass)) req = req.filter((t) => t !== d); }
    return req;
  }
  function samePcAsChordTone(chord) {
    const b = T.notePc(chord.bass);
    return chord.notes.some((n) => T.notePc(n) === b);
  }

  // Map pitch class -> {name, role}
  function pcMap(chord) {
    const m = new Map();
    chord.intervals.forEach((iv, i) => {
      const pc = T.notePc(chord.notes[i]);
      if (!m.has(pc)) m.set(pc, { name: T.noteName(chord.notes[i]), token: iv.token, role: T.roleOf(iv.token) });
    });
    if (chord.bass) {
      const pc = T.notePc(chord.bass);
      if (!m.has(pc)) m.set(pc, { name: T.noteName(chord.bass), token: 'bass', role: 'bass' });
    }
    return m;
  }

  // Finger assignment. Returns {fingers, barres, count} or null if it needs more than four fingers.
  function assignFingers(frets) {
    const fretted = [];
    frets.forEach((f, s) => { if (f > 0) fretted.push({ s, f }); });
    const n = frets.length;
    const fingers = frets.map(() => 0);
    if (!fretted.length) return { fingers, barres: [], count: 0 };
    const minF = Math.min(...fretted.map((x) => x.f));
    const options = [];
    // Option A: one finger per note.
    options.push({ barre: null, groups: fretted.map((x) => [x]) });
    // Option B: index-finger barre on the lowest fret, from the lowest string at that fret up to the highest.
    const atMin = fretted.filter((x) => x.f === minF);
    if (atMin.length >= 2) {
      const from = atMin[0].s; const to = atMin[atMin.length - 1].s;
      let ok = true;
      for (let s = from; s <= to; s++) if (frets[s] < minF) ok = false; // open or muted string under the barre
      if (ok) {
        const rest = fretted.filter((x) => !(x.f === minF && x.s >= from && x.s <= to));
        options.push({ barre: { fret: minF, from, to }, groups: rest.map((x) => [x]) });
      }
    }
    // Option C: also collapse a run of adjacent strings at one higher fret into a single finger (a small ring-finger barre).
    for (const base of options.slice()) {
      const g = base.groups.map((x) => x[0]).sort((a, b) => a.s - b.s);
      for (let i = 0; i < g.length; i++) {
        let j = i;
        while (j + 1 < g.length && g[j + 1].s === g[j].s + 1 && g[j + 1].f === g[i].f) j++;
        if (j > i) {
          const run = g.slice(i, j + 1);
          const others = g.filter((x) => !run.includes(x)).map((x) => [x]);
          options.push({ barre: base.barre, groups: others.concat([run]), mini: { fret: run[0].f, from: run[0].s, to: run[run.length - 1].s } });
        }
      }
    }
    // Thumb option on six strings: the thumb frets the lowest string at the lowest fret (as in 2x0232 for D/F#).
    if (n === 6 && frets[0] > 0 && frets[0] === minF) {
      const rest = fretted.filter((x) => x.s !== 0);
      options.push({ barre: null, groups: rest.map((x) => [x]), thumb: true });
    }
    let best = null;
    for (const o of options) {
      const count = (o.barre ? 1 : 0) + o.groups.length;
      if (count > 4) continue;
      const lay = layout(o, frets, minF, n);
      if (!lay) continue;
      const rank = count + (o.barre ? 1 : 0) + (o.mini ? 1.25 : 0) + (o.thumb ? 2 : 0);
      if (!best || rank < best.rank) best = { o, count, rank, lay };
    }
    if (!best) return null;
    return { fingers: best.lay.fingers, barres: best.lay.barres, count: best.count, n, mini: !!best.o.mini, thumb: !!best.o.thumb };
  }

  // Finger numbers for one option. Returns null when two fingers would have to cross.
  function layout(o, frets, minF, n) {
    const fingers = frets.map(() => 0);
    const groups = o.groups.slice().sort((a, b) => (a[0].f - b[0].f) || (a[0].s - b[0].s));
    let start = 1;
    if (o.barre) { for (let s = o.barre.from; s <= o.barre.to; s++) if (frets[s] === o.barre.fret) fingers[s] = 1; start = 2; }
    if (o.thumb) fingers[0] = 'T';
    const gMin = o.thumb ? Math.min(...groups.map((g) => g[0].f)) : minF;
    let nums = []; let prev = start - 1;
    for (const g of groups) { const want = Math.max(prev + 1, g[0].f - gMin + 1); nums.push(want); prev = want; }
    if (nums.some((x) => x > 4)) { nums = groups.map((_, i) => start + i); }
    groups.forEach((g, i) => g.forEach((x) => { fingers[x.s] = nums[i]; }));
    const barres = [];
    if (o.barre) barres.push(o.barre);
    if (o.mini) barres.push({ fret: o.mini.fret, from: o.mini.from, to: o.mini.to, finger: fingers[o.mini.from] });
    // Crossing: two separate fingers on the same fret, three or more strings apart, with a higher-fret note between them.
    for (let a = 0; a < n; a++) for (let b = a + 3; b < n; b++) {
      if (frets[a] > 0 && frets[a] === frets[b] && fingers[a] !== fingers[b] && fingers[a] !== 'T') {
        for (let c = a + 1; c < b; c++) if (frets[c] > frets[a]) return null;
      }
    }
    return { fingers, barres };
  }

  // Human-reachability check for any shown shape.
  function isReachable(frets, instKey) {
    const inst = INSTRUMENTS[instKey] || instKey;
    if (frets.length !== inst.strings.length) return false;
    if (frets.some((f) => f > MAX_FRET || f < -1)) return false;
    const fr = frets.filter((f) => f > 0);
    const sounding = frets.filter((f) => f >= 0).length;
    if (sounding < Math.min(2, inst.minSounding) || sounding < 2) return false;
    if (fr.length) {
      const lo = Math.min(...fr); const hi = Math.max(...fr);
      const maxSpan = lo >= 7 ? 4 : 3;
      if (hi - lo > maxSpan) return false;
      // Open strings with a hand far up the neck are fine, but not with a stretch.
    }
    const first = frets.findIndex((f) => f >= 0);
    let last = -1; frets.forEach((f, i) => { if (f >= 0) last = i; });
    let inner = 0; for (let i = first; i <= last; i++) if (frets[i] < 0) inner++;
    if (inner > 1) return false;
    return !!assignFingers(frets);
  }

  // Familiar movable grips (E-shape and A-shape barres, power chords). Offsets are frets relative to the root
  // fret on the lowest string; null means muted. A shape that matches a familiar grip for its chord quality gets
  // a bonus, because a musician reads it instantly and it moves to every key.
  const X = null;
  const GRIPS = {
    guitar: [
      ['maj', [0, 2, 2, 1, 0, 0]], ['maj', [X, 0, 2, 2, 2, 0]],
      ['m', [0, 2, 2, 0, 0, 0]], ['m', [X, 0, 2, 2, 1, 0]],
      ['7', [0, 2, 0, 1, 0, 0]], ['7', [X, 0, 2, 0, 2, 0]],
      ['m7', [0, 2, 0, 0, 0, 0]], ['m7', [X, 0, 2, 0, 1, 0]],
      ['maj7', [0, X, 1, 1, 0, X]], ['maj7', [X, 0, 2, 1, 2, 0]],
      ['sus4', [0, 2, 2, 2, 0, 0]], ['sus4', [X, 0, 2, 2, 3, 0]], ['sus2', [X, 0, 2, 2, 0, 0]],
      ['7sus4', [0, 2, 0, 2, 0, 0]], ['7sus4', [X, 0, 2, 0, 3, 0]],
      ['m7b5', [0, X, 0, 0, -1, X]], ['m7b5', [X, 0, 1, 0, 1, X]],
      ['dim7', [0, X, -1, 0, -1, X]], ['dim7', [X, 0, 1, -1, 1, X]],
      ['9', [X, 0, -1, 0, 0, X]], ['7#9', [X, 0, -1, 0, 1, X]],
      ['6', [X, 0, 2, 2, 2, 2]], ['m6', [X, 0, 2, -1, 1, X]],
      ['5', [0, 2, 2, X, X, X]], ['5', [X, 0, 2, 2, X, X]],
    ],
    ukulele: [],
  };
  function gripQuality(chord) {
    if (chord.bass) return null;
    const t = chord.intervals.map((i) => i.token).join(' ');
    const Q = { '1 3 5': 'maj', '1 b3 5': 'm', '1 3 5 b7': '7', '1 b3 5 b7': 'm7', '1 3 5 7': 'maj7', '1 4 5': 'sus4', '1 2 5': 'sus2',
      '1 4 5 b7': '7sus4', '1 b3 b5 b7': 'm7b5', '1 b3 b5 bb7': 'dim7', '1 3 5 b7 9': '9', '1 3 5 b7 #9': '7#9', '1 3 5 6': '6', '1 b3 5 6': 'm6', '1 5': '5' };
    return Q[t] || null;
  }
  function matchesGrip(frets, chord, inst) {
    const q = gripQuality(chord); if (!q) return false;
    const rootPc = T.notePc(chord.root);
    for (const [gq, off] of (GRIPS[inst.key] || [])) {
      if (gq !== q) continue;
      const s0 = off.findIndex((o) => o === 0);
      const r = mod(rootPc - inst.midi[s0], 12);
      for (const base of [r, r + 12]) {
        if (off.every((o, i) => (o === null ? frets[i] < 0 : frets[i] === base + o))) return true;
      }
    }
    return false;
  }

  function enumerate(chord, inst) {
    const map = pcMap(chord);
    const pcs = new Set(map.keys());
    const out = new Map();
    const nStr = inst.midi.length;
    for (let b = 1; b <= 12; b++) {
      const width = b >= 7 ? 5 : 4;
      const opts = inst.midi.map((open) => {
        const o = [-1];
        if (pcs.has(mod(open, 12))) o.push(0);
        for (let f = b; f < b + width && f <= MAX_FRET; f++) if (pcs.has(mod(open + f, 12))) o.push(f);
        return o;
      });
      const cur = new Array(nStr);
      const rec = (i) => {
        if (i === nStr) { const key = cur.join(','); if (!out.has(key)) out.set(key, cur.slice()); return; }
        for (const f of opts[i]) { cur[i] = f; rec(i + 1); }
      };
      rec(0);
    }
    return { cands: [...out.values()], map };
  }

  function evaluate(frets, chord, inst, map, req) {
    const n = frets.length;
    const sounding = []; frets.forEach((f, s) => { if (f >= 0) sounding.push(s); });
    if (sounding.length < (chord.parts.power ? 2 : inst.minSounding)) return null;
    const midi = frets.map((f, s) => (f >= 0 ? inst.midi[s] + f : null));
    const toks = new Set(); const roles = frets.map(() => null); let thirds = 0;
    for (const s of sounding) {
      const info = map.get(mod(midi[s], 12)); roles[s] = info; toks.add(info.token);
      if (info.token === '3' || info.token === 'b3') thirds++;
    }
    for (const t of req) if (!toks.has(t)) return null;
    const rootPc = T.notePc(chord.root);
    const wantBass = chord.bass ? T.notePc(chord.bass) : rootPc;
    if (chord.bass && !toks.has('bass') && !sounding.some((s) => mod(midi[s], 12) === wantBass)) return null;
    // Lowest pitch
    let lowS = sounding[0]; for (const s of sounding) if (midi[s] < midi[lowS]) lowS = s;
    const lowPc = mod(midi[lowS], 12);
    let score = 0;
    if (inst.bassRule) { if (lowPc !== wantBass) return null; }
    else if (chord.bass && lowPc !== wantBass) score += 6;
    if (!isReachable(frets, inst)) return null;
    const fing = assignFingers(frets);
    const fr = frets.filter((f) => f > 0);
    const minF = fr.length ? Math.min(...fr) : 0; const maxF = fr.length ? Math.max(...fr) : 0;
    const span = fr.length ? maxF - minF : 0;
    score += span * 2 + Math.max(0, minF - 1) * 0.9 + fing.count * 1.5;
    const bar = fing.barres.find((b) => b.finger === undefined);
    if (bar) { score += 3; for (let s = bar.to + 1; s < n; s++) if (frets[s] === 0) score += 3; }
    if (fing.mini) score += 1;
    const opens = frets.filter((f) => f === 0).length;
    if (maxF <= 3) score -= opens + 1; else if (maxF <= 5) score -= opens * 0.4; else score += opens * 0.75;
    const first = sounding[0]; const last = sounding[sounding.length - 1];
    for (let s = 0; s < n; s++) {
      if (frets[s] >= 0) continue;
      if (s > first && s < last) score += (n === 6 ? 10 : 4); else if (s < first) score += 1; else score += chord.parts.power ? 0.5 : (n === 6 ? 4 : 2);
    }
    if (!toks.has('5') && chord.intervals.some((i) => i.token === '5')) score += 1.5;
    if (thirds > 1) score += 1.5 * (thirds - 1);
    // Doubled colour tones (not root, 5th or 3rd) and exact unison doublings sound heavy.
    const tokCount = {}; const midiSeen = new Set(); let unisons = 0;
    for (const s of sounding) { const t = roles[s].token; tokCount[t] = (tokCount[t] || 0) + 1; if (midiSeen.has(midi[s])) unisons++; midiSeen.add(midi[s]); }
    for (const t in tokCount) if (!['1', '5', '3', 'b3', 'bass'].includes(t) && tokCount[t] > 1) score += 1.5 * (tokCount[t] - 1);
    score += unisons * 1.5;
    // A colour tone squeezed just above a low bass sounds muddy.
    const byPitch = sounding.slice().sort((a, b) => midi[a] - midi[b]);
    if (byPitch.length > 1) { const s2 = byPitch[1]; const t2 = roles[s2].token; const gap = midi[s2] - midi[byPitch[0]];
      if (midi[byPitch[0]] < 52 && gap < 7 && !['3', 'b3', '5', '1', 'bass'].includes(t2)) score += 3; }
    if (n === 6 && sounding.length < 5 && !chord.parts.power) score += 1.5 * (5 - sounding.length);
    if (n === 6 && sounding.length === 6) score -= 1;
    const familiar = matchesGrip(frets, chord, inst);
    if (familiar) score -= GRIP_BONUS;
    return {
      frets: frets.slice(), fingers: fing.fingers, barres: fing.barres, fingerCount: fing.count,
      baseFret: minF > 3 ? minF : 1, span, score: Math.round(score * 100) / 100,
      notes: roles.map((r) => (r ? r.name : null)), roles: roles.map((r) => (r ? r.role : null)), tokens: roles.map((r) => (r ? r.token : null)),
      midi, familiar,
    };
  }

  const cache = new Map();
  function findShapes(chordOrSymbol, instKey, limit) {
    const inst = INSTRUMENTS[instKey || 'guitar'];
    const chord = typeof chordOrSymbol === 'string' ? T.parseChord(chordOrSymbol) : chordOrSymbol;
    if (!chord || !inst) return [];
    const key = inst.key + '|' + chord.symbol + '|' + (limit || 8);
    if (cache.has(key)) return cache.get(key);
    const req = requiredTokens(chord, inst);
    const { cands, map } = enumerate(chord, inst);
    const shapes = [];
    for (const f of cands) { const e = evaluate(f, chord, inst, map, req); if (e) shapes.push(e); }
    shapes.sort((a, b) => a.score - b.score || a.frets.join(',').localeCompare(b.frets.join(',')));
    // Keep variety: drop shapes identical to a better one except for an extra muted or open string.
    const kept = [];
    for (const s of shapes) {
      if (kept.some((k) => similar(k.frets, s.frets))) continue;
      kept.push(s);
      if (kept.length >= (limit || 8)) break;
    }
    kept.forEach((s, i) => { s.rank = i + 1; s.difficulty = s.score < 9 ? 'Easy' : s.score < 15 ? 'Medium' : 'Hard'; });
    if (cache.size > 400) cache.clear();
    cache.set(key, kept);
    return kept;
  }
  function similar(a, b) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { if (a[i] >= 0 && b[i] >= 0) return false; diff++; }
    return diff <= 1;
  }

  function fretString(frets) { return frets.map((f) => (f < 0 ? 'x' : f > 9 ? '(' + f + ')' : String(f))).join(''); }
  function parseFretString(str) {
    const out = []; const re = /\((\d+)\)|x|X|\d/g; let m;
    while ((m = re.exec(str))) out.push(m[1] ? +m[1] : (m[0] === 'x' || m[0] === 'X') ? -1 : +m[0]);
    return out;
  }

  // A sensible piano voicing: close position from the root around C3-B3, slash bass an octave below.
  function pianoVoicing(chordOrSymbol) {
    const chord = typeof chordOrSymbol === 'string' ? T.parseChord(chordOrSymbol) : chordOrSymbol;
    if (!chord) return [];
    const rootPc = T.notePc(chord.root);
    const rootMidi = 48 + rootPc + (rootPc < 5 ? 12 : 0);
    const notes = chord.intervals.map((iv, i) => ({ midi: rootMidi + iv.semis, name: T.noteName(chord.notes[i]), token: iv.token, role: T.roleOf(iv.token) }));
    if (chord.bass) {
      const bpc = T.notePc(chord.bass);
      let bm = rootMidi - mod(rootPc - bpc, 12); if (bm === rootMidi) bm -= 12; if (rootMidi - bm < 5) bm -= 12;
      const isTone = notes.find((x) => mod(x.midi, 12) === bpc);
      notes.unshift({ midi: bm, name: T.noteName(chord.bass), token: isTone ? isTone.token : 'bass', role: isTone ? isTone.role : 'bass' });
    }
    return notes;
  }

  const Shapes = { INSTRUMENTS, MAX_FRET, findShapes, assignFingers, isReachable, requiredTokens, fretString, parseFretString, pianoVoicing };
  if (typeof module !== 'undefined' && module.exports) module.exports = Shapes;
  else global.Shapes = Shapes;
})(typeof globalThis !== 'undefined' ? globalThis : this);
