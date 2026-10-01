/* Songbook song parser: UG-style paste detection, ChordPro read/write, key guess and transposition.
   Pure JS, no DOM. CommonJS in node, global SongParse in the browser. */
(function (global) {
  'use strict';

  const mod = (n, m) => ((n % m) + m) % m;
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];

  // ---------- notes and keys ----------
  function parseNote(s) {
    const m = /^([A-G])([#b♯♭]?)$/.exec(s || '');
    if (!m) return null;
    const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
    return { letter: LETTERS.indexOf(m[1]), acc };
  }
  const notePc = (n) => mod(NATURAL_PC[n.letter] + n.acc, 12);
  const noteStr = (n) => LETTERS[n.letter] + (n.acc > 0 ? '#'.repeat(n.acc) : 'b'.repeat(-n.acc));

  const MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const MINOR_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
  const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
  const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

  function parseKey(k) {
    const m = /^\s*([A-G][#b♯♭]?)\s*(m|min|minor|-)?\s*$/.exec(k || '');
    if (!m) return null;
    const tonic = parseNote(m[1]);
    return tonic ? { tonic, minor: !!m[2] } : null;
  }
  const keyStr = (k) => noteStr(k.tonic) + (k.minor ? 'm' : '');

  // Seven scale notes spelled with one letter each.
  function keyScale(k) {
    const steps = k.minor ? MINOR_STEPS : MAJOR_STEPS;
    const pc0 = notePc(k.tonic);
    return steps.map((s, i) => {
      const letter = (k.tonic.letter + i) % 7;
      let acc = mod(pc0 + s - NATURAL_PC[letter], 12);
      if (acc > 6) acc -= 12;
      return { letter, acc };
    });
  }
  // -1 flat side, +1 sharp side, 0 neutral (C major, A minor)
  function keySide(k) {
    const sc = keyScale(k);
    const flats = sc.filter((n) => n.acc < 0).length;
    const sharps = sc.filter((n) => n.acc > 0).length;
    return flats > sharps ? -1 : sharps > flats ? 1 : 0;
  }
  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const NEUTRAL_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  // Spell a pitch class for a key (key may be null).
  function spellPc(pc, k) {
    pc = mod(pc, 12);
    if (!k) return NEUTRAL_NAMES[pc];
    const sc = keyScale(k);
    const hit = sc.find((n) => notePc(n) === pc);
    if (hit && Math.abs(hit.acc) < 2) return noteStr(hit);
    if (k.minor) { // raised 7th and 6th of melodic/harmonic minor
      for (const deg of [6, 5]) {
        const n = sc[deg];
        if (mod(notePc(n) + 1, 12) === pc && n.acc < 1) return noteStr({ letter: n.letter, acc: n.acc + 1 });
      }
    }
    const side = keySide(k);
    return (side < 0 ? FLAT_NAMES : side > 0 ? SHARP_NAMES : NEUTRAL_NAMES)[pc];
  }

  function transposeKey(key, semis, preferSide) {
    const k = typeof key === 'string' ? parseKey(key) : key;
    if (!k) return null;
    const pc = mod(notePc(k.tonic) + semis, 12);
    let name = (k.minor ? MINOR_KEYS : MAJOR_KEYS)[pc];
    if (!k.minor && pc === 6) name = (preferSide != null ? preferSide : keySide(k)) < 0 ? 'Gb' : 'F#';
    if (k.minor && pc === 3) name = (preferSide != null ? preferSide : keySide(k)) > 0 ? 'D#' : 'Eb';
    return name + (k.minor ? 'm' : '');
  }

  // ---------- chord tokens ----------
  const CHORD_RE = /^([A-G][#b♯♭]?)((?:maj|Maj|min|mi|m|M|dim|aug|sus|add|no|omit|alt|ø|°|o|\+|-|[0-9]|#|b|♯|♭|\(|\)|\/(?=[0-9]))*)(?:\/([A-G][#b♯♭]?))?$/;
  const MARK_RE = /^(?:\|+|\/+|-+|%|\.+|\*+|:?\|\|?:?|->|→|N\.?C\.?|\(N\.?C\.?\)|n\.c\.|\(?x\s?\d+\)?|\(?\d+x\)?|\(?\d+\)?)$/i;

  function isChordToken(tok) {
    if (!tok) return false;
    let t = tok.replace(/\*+$/, '');
    if (/^\(.*\)$/.test(t)) t = t.slice(1, -1);
    const cm = CHORD_RE.exec(t);
    if (!cm) return false;
    if (cm[2].indexOf('-', 1) > 0 || (cm[2] !== '-' && /[#b♯♭(-]$/.test(cm[2]))) return false;
    // reject stray suffix shapes such as "Bb-b" or unbalanced parentheses
    const opens = (t.match(/\(/g) || []).length;
    const closes = (t.match(/\)/g) || []).length;
    return opens === closes;
  }
  const isMarkToken = (tok) => MARK_RE.test(tok);
  const isNoChord = (tok) => /^\(?n\.?c\.?\)?$/i.test(tok);

  function tokenize(line) {
    const out = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(line))) out.push({ col: m.index, tok: m[0] });
    return out;
  }

  function isChordLine(line) {
    const toks = tokenize(line);
    if (!toks.length) return false;
    let chords = 0;
    for (const t of toks) {
      if (isChordToken(t.tok)) chords++;
      else if (!isMarkToken(t.tok)) return false;
    }
    return chords > 0 || toks.some((t) => isNoChord(t.tok));
  }

  function transposeChord(tok, semis, key) {
    if (!semis && !key) return tok;
    const m = /^(\(?)(.*?)(\*?)(\)?)$/.exec(tok);
    let inner = m[2];
    if (m[1] && !m[4]) { inner = tok.slice(1); }
    if (!isChordToken(inner)) return tok;
    const cm = CHORD_RE.exec(inner);
    if (!cm) return tok;
    const k = typeof key === 'string' ? parseKey(key) : key;
    const root = spellPc(notePc(parseNote(cm[1])) + semis, k);
    const bass = cm[3] ? '/' + spellPc(notePc(parseNote(cm[3])) + semis, k) : '';
    const rebuilt = root + cm[2] + bass;
    return (m[1] && m[4] ? '(' + rebuilt + m[3] + ')' : (m[1] ? '(' : '') + rebuilt + m[3] + (m[4] || ''));
  }

  // ---------- sections ----------
  const SECTION_WORDS = 'intro|verse|chorus|pre[- ]?chorus|post[- ]?chorus|bridge|outro|interlude|solo|tag|instrumental|refrain|hook|ending|coda|breakdown|riff|turnaround|vamp|break|middle 8|pre';
  const HEADER_BRACKET = /^\s*\[([^\]]{1,40})\]\s*:?\s*(.*)$/;
  const HEADER_PLAIN = new RegExp('^\\s*\\(?((?:' + SECTION_WORDS + ')(?:\\s*\\d+)?(?:\\s*\\([^)]{0,20}\\))?)\\)?\\s*(:?)\\s*(.*)$', 'i');

  function sectionKind(label) {
    const l = label.toLowerCase();
    if (/^(pre|post)/.test(l)) return 'part';
    if (/^verse/.test(l)) return 'verse';
    if (/^(chorus|refrain)/.test(l)) return 'chorus';
    if (/^bridge/.test(l)) return 'bridge';
    return 'part';
  }
  const tidyLabel = (s) => s.replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());

  // Returns {label, rest} or null.
  function matchHeader(line) {
    let m = HEADER_BRACKET.exec(line);
    if (m && !isChordToken(m[1].trim()) && !/^\s*$/.test(m[1])) {
      if (!m[2] || isChordLine(m[2])) return { label: tidyLabel(m[1]), rest: m[2] || '' };
    }
    m = HEADER_PLAIN.exec(line);
    if (m) {
      const rest = m[3] || '';
      if (!rest) return { label: tidyLabel(m[1]), rest: '' };
      if ((m[2] || /\)\s*$/.test(m[1])) && isChordLine(rest)) return { label: tidyLabel(m[1]), rest };
      if (m[2] && /^x?\s?\d+x?$/i.test(rest.replace(/[()]/g, ''))) return { label: tidyLabel(m[1] + ' ' + rest), rest: '' };
    }
    return null;
  }

  const TAB_RE = /^\s*[A-Ga-g][#b]?\s*[|:][-0-9a-z|/\\~()^.<>*= ]*-[-0-9a-z|/\\~()^.<>*= ]*$/;
  const isTabLine = (line) => TAB_RE.test(line) && (line.match(/-/g) || []).length >= 4;

  // ---------- text normalization ----------
  function expandTabs(line, size) {
    size = size || 8;
    let out = '';
    for (const ch of line) {
      if (ch === '\t') out += ' '.repeat(size - (out.length % size));
      else out += ch;
    }
    return out;
  }
  function normalizeText(text) {
    return String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/[\u00a0\u2007\u202f]/g, ' ')
      .replace(/[\u200b\u200e\u200f]/g, '')
      .split('\n').map((l) => expandTabs(l).replace(/\s+$/, ''));
  }

  // ---------- model helpers ----------
  function newSection(kind, label) { return { kind, label, lines: [] }; }
  function cleanSections(sections) {
    const out = [];
    for (const s of sections) {
      const lines = [];
      for (const l of s.lines) {
        if (l.type === 'blank' && (!lines.length || lines[lines.length - 1].type === 'blank')) continue;
        lines.push(l);
      }
      while (lines.length && lines[lines.length - 1].type === 'blank') lines.pop();
      if (!lines.length && s.kind === 'none') continue;
      out.push({ kind: s.kind, label: s.label, lines });
    }
    return out;
  }

  function mergeChordsLyric(chordLine, lyric) {
    const toks = tokenize(chordLine);
    let text = lyric;
    const last = toks[toks.length - 1];
    if (last.col > text.length) text = text + ' '.repeat(last.col - text.length);
    const segs = [];
    if (toks[0].col > 0) segs.push({ chord: null, text: text.slice(0, toks[0].col) });
    toks.forEach((t, i) => {
      const end = i + 1 < toks.length ? toks[i + 1].col : text.length;
      segs.push({ chord: t.tok, text: text.slice(t.col, Math.max(t.col, end)) });
    });
    return { type: 'lyric', segs };
  }
  const chordsLine = (line) => ({ type: 'chords', items: tokenize(line) });

  // ---------- UG-style plain text ----------
  const META_LINE = /^\s*(title|artist|song|by|key|capo|tuning|tempo|bpm|time|album|year)\s*[:=-]\s*(.+)$/i;

  function parsePlain(lines) {
    const meta = {};
    const sections = [];
    let cur = newSection('none', '');
    sections.push(cur);
    let i = 0;
    // header block: metadata and title before the first chord, header or tab line
    const pre = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; if (pre.length) break; else continue; }
      if (isChordLine(l) || matchHeader(l) || isTabLine(l)) break;
      const mm = META_LINE.exec(l);
      if (mm) { assignMeta(meta, mm[1], mm[2]); i++; continue; }
      if (pre.length >= 2) break;
      pre.push(l.trim()); i++;
    }
    let consumed = guessTitleArtist(pre, meta);
    // unconsumed preface lines go back as lyrics
    for (const p of pre.slice(consumed)) cur.lines.push({ type: 'lyric', segs: [{ chord: null, text: p }] });
    for (; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) { cur.lines.push({ type: 'blank' }); continue; }
      const mm = META_LINE.exec(l);
      if (mm && /^(key|capo|tuning)$/i.test(mm[1]) && !meta[mm[1].toLowerCase()]) { assignMeta(meta, mm[1], mm[2]); continue; }
      const h = matchHeader(l);
      if (h) {
        cur = newSection(sectionKind(h.label), h.label);
        sections.push(cur);
        if (h.rest) {
          // "[Intro] G D" stays a chord-only line keeping its columns relative to the chords
          const off = l.length - l.replace(/^.*?\]\s*:?\s*|^.*?:\s*/, '').length;
          cur.lines.push({ type: 'chords', items: tokenize(h.rest).map((t) => ({ col: t.col, tok: t.tok })) });
          void off;
        }
        continue;
      }
      if (isTabLine(l)) {
        const block = [];
        while (i < lines.length && (isTabLine(lines[i]) || (lines[i].trim() && block.length && i + 1 < lines.length && isTabLine(lines[i + 1]) && !isChordLine(lines[i])))) { block.push(lines[i]); i++; }
        i--;
        if (cur.lines.every((x) => x.type === 'blank') && cur.kind !== 'none') {
          cur.kind = 'tab';
        } else if (cur.kind !== 'tab') {
          cur = newSection('tab', '');
          sections.push(cur);
        }
        for (const b of block) cur.lines.push({ type: 'tab', text: b });
        if (cur.label === '') { cur = newSection('none', ''); sections.push(cur); }
        continue;
      }
      if (cur.kind === 'tab') { cur = newSection('none', ''); sections.push(cur); }
      if (isChordLine(l)) {
        const next = lines[i + 1];
        if (next && next.trim() && !isChordLine(next) && !matchHeader(next) && !isTabLine(next)) {
          cur.lines.push(mergeChordsLyric(l, next));
          i++;
        } else {
          cur.lines.push(chordsLine(l));
        }
        continue;
      }
      cur.lines.push({ type: 'lyric', segs: [{ chord: null, text: l }] });
    }
    return { meta, sections: cleanSections(sections) };
  }

  function assignMeta(meta, k, v) {
    k = k.toLowerCase(); v = v.trim();
    if (k === 'song') k = 'title';
    if (k === 'by') k = 'artist';
    if (k === 'bpm') k = 'tempo';
    if (k === 'capo') { const n = /(\d+)/.exec(v); if (/no capo/i.test(v)) v = '0'; else if (n) v = n[1]; }
    if (k === 'key') { const km = /([A-G][#b♯♭]?\s*(?:m(?!aj)|min(?:or)?)?)/.exec(v); if (km) v = keyStr(parseKey(km[1].replace(/min(or)?/, 'm'))); }
    meta[k] = v;
  }

  function guessTitleArtist(pre, meta) {
    if (!pre.length) return 0;
    const first = pre[0].replace(/\s+(chords|tab|tabs|lyrics|ver(sion)?\.?\s*\d+|\(ver \d+\))\s*$/i, '').trim();
    let m = /^(.+?)\s+(?:chords\s+|tab\s+)?by\s+(.+)$/i.exec(first);
    if (m) { meta.title = meta.title || m[1].trim(); meta.artist = meta.artist || m[2].replace(/\s+(chords|tab)$/i, '').trim(); return 1; }
    m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(first);
    if (m) {
      const chordsWord = /\b(chords|tab)\b/i.test(pre[0]);
      if (chordsWord) { meta.artist = meta.artist || m[1].trim(); meta.title = meta.title || m[2].trim(); }
      else { meta.title = meta.title || m[1].trim(); meta.artist = meta.artist || m[2].trim(); }
      return 1;
    }
    if (!meta.title && first.length <= 60) {
      meta.title = first;
      if (pre[1] && !meta.artist && pre[1].length <= 60) {
        meta.artist = pre[1].replace(/^(by|words by|music by)\s+/i, '').trim();
        return 2;
      }
      return 1;
    }
    return 0;
  }

  // ---------- ChordPro ----------
  const KNOWN_META = ['title', 'subtitle', 'artist', 'key', 'capo', 'tempo', 'time', 'album', 'year', 'x_source', 'x_added'];
  const META_ALIASES = { t: 'title', st: 'subtitle' };
  const ENV = { verse: ['start_of_verse', 'sov', 'end_of_verse', 'eov'], chorus: ['start_of_chorus', 'soc', 'end_of_chorus', 'eoc'], bridge: ['start_of_bridge', 'sob', 'end_of_bridge', 'eob'], tab: ['start_of_tab', 'sot', 'end_of_tab', 'eot'], part: ['start_of_part', 'sop', 'end_of_part', 'eop'] };
  const DEFAULT_LABEL = { verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', tab: '', part: '' };

  function looksLikeChordPro(lines) {
    let score = 0;
    for (const l of lines) {
      if (/^\s*\{[a-z_]+(?:[:\s][^}]*)?\}\s*$/i.test(l)) score += 2;
      const inl = l.match(/\[([^\]\s]+)\]/g) || [];
      if (inl.length && inl.some((b) => isChordToken(b.slice(1, -1))) && l.replace(/\[[^\]]*\]/g, '').trim().length > 0) score += 1;
      if (score >= 2) return true;
    }
    return false;
  }

  function parseChordProLine(l) {
    const re = /\[([^\]]*)\]/g;
    if (!re.test(l)) return { type: 'lyric', segs: [{ chord: null, text: l }] };
    re.lastIndex = 0;
    const plain = l.replace(/\[[^\]]*\]/g, '');
    if (!plain.trim() || tokenize(plain).every((t) => isMarkToken(t.tok))) {
      // chord-only line, columns count chord text without brackets
      const items = [];
      let col = 0; let k = 0;
      while (k < l.length) {
        if (l[k] === '[') {
          const end = l.indexOf(']', k);
          const tok = l.slice(k + 1, end);
          items.push({ col, tok }); col += tok.length; k = end + 1;
        } else if (l[k] === ' ') { col++; k++; }
        else {
          const m = /^\S+/.exec(l.slice(k).replace(/\[.*$/, '')) || [l[k]];
          items.push({ col, tok: m[0] }); col += m[0].length; k += m[0].length;
        }
      }
      return { type: 'chords', items };
    }
    const segs = [];
    let last = 0; let chord = null; let m;
    while ((m = re.exec(l))) {
      const text = l.slice(last, m.index);
      if (chord !== null || text) segs.push({ chord, text });
      chord = m[1]; last = re.lastIndex;
    }
    segs.push({ chord, text: l.slice(last) });
    return { type: 'lyric', segs };
  }

  function parseChordPro(lines) {
    const meta = {};
    const sections = [];
    let cur = newSection('none', '');
    sections.push(cur);
    let inEnv = null;
    for (const l of lines) {
      const d = /^\s*\{\s*([a-zA-Z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/.exec(l);
      if (d) {
        let name = d[1].toLowerCase();
        const val = d[2] == null ? '' : d[2];
        name = META_ALIASES[name] || name;
        if (KNOWN_META.includes(name) && !inEnv) { meta[name] = val; continue; }
        const envKind = Object.keys(ENV).find((k) => ENV[k].includes(name));
        if (envKind) {
          const isStart = ENV[envKind].indexOf(name) < 2;
          if (isStart) {
            cur = newSection(envKind, val || DEFAULT_LABEL[envKind]);
            sections.push(cur); inEnv = envKind;
          } else {
            inEnv = null; cur = newSection('none', ''); sections.push(cur);
          }
          continue;
        }
        if (name === 'comment' || name === 'c' || name === 'ci' || name === 'comment_italic') { cur.lines.push({ type: 'comment', text: val }); continue; }
        cur.lines.push({ type: 'directive', raw: l.trim() });
        continue;
      }
      if (/^\s*#/.test(l)) { cur.lines.push({ type: 'directive', raw: l }); continue; }
      if (!l.trim()) { cur.lines.push({ type: 'blank' }); continue; }
      if (inEnv === 'tab') { cur.lines.push({ type: 'tab', text: l }); continue; }
      cur.lines.push(parseChordProLine(l));
    }
    return { meta, sections: cleanSections(sections) };
  }

  function writeLine(line) {
    switch (line.type) {
      case 'blank': return '';
      case 'tab': return line.text;
      case 'comment': return '{comment: ' + line.text + '}';
      case 'directive': return line.raw;
      case 'chords': {
        let out = ''; let col = 0;
        for (const it of line.items) {
          const pad = Math.max(it === line.items[0] ? 0 : 1, it.col - col);
          out += ' '.repeat(pad);
          out += isChordToken(it.tok) || isNoChord(it.tok) ? '[' + it.tok + ']' : it.tok;
          col += pad + it.tok.length;
        }
        return out;
      }
      case 'lyric': return line.segs.map((s) => (s.chord != null ? '[' + s.chord + ']' : '') + s.text).join('');
      default: return '';
    }
  }

  function writeChordPro(song) {
    const out = [];
    const meta = song.meta || {};
    for (const k of KNOWN_META) if (meta[k] != null && meta[k] !== '') out.push('{' + k + ': ' + meta[k] + '}');
    for (const s of song.sections) {
      if (out.length) out.push('');
      if (s.kind === 'none') { for (const l of s.lines) out.push(writeLine(l)); continue; }
      const env = ENV[s.kind];
      out.push('{' + env[0] + (s.label ? ': ' + s.label : '') + '}');
      for (const l of s.lines) out.push(writeLine(l));
      out.push('{' + env[2] + '}');
    }
    return out.join('\n') + '\n';
  }

  // ---------- top-level ----------
  function parseSong(text) {
    const lines = normalizeText(text);
    const song = looksLikeChordPro(lines) ? parseChordPro(lines) : parsePlain(lines);
    song.format = looksLikeChordPro(lines) ? 'chordpro' : 'plain';
    if (!song.meta.key) {
      const g = guessKey(song);
      if (g) { song.guessedKey = g; }
    }
    return song;
  }

  function songChords(song) {
    const out = [];
    for (const s of song.sections) for (const l of s.lines) {
      if (l.type === 'lyric') for (const sg of l.segs) { if (sg.chord && isChordToken(sg.chord)) out.push(sg.chord); }
      if (l.type === 'chords') for (const it of l.items) if (isChordToken(it.tok)) out.push(it.tok);
    }
    return out.map((c) => c.replace(/^\(|\)$|\*+$/g, ''));
  }

  function chordInfo(sym) {
    const m = CHORD_RE.exec(sym);
    if (!m) return null;
    const suf = m[2];
    const minor = /^(m(?!aj)|min|mi|-)/.test(suf) && !/^m(aj|M)/.test(suf);
    const dim = /^(dim|o|°|ø)/.test(suf) || /m7b5/.test(suf);
    return { pc: notePc(parseNote(m[1])), minor: minor || dim, dim };
  }

  function guessKey(song) {
    const chords = songChords(song);
    if (!chords.length) return null;
    const infos = chords.map(chordInfo).filter(Boolean);
    let best = null; let bestScore = -Infinity;
    for (let pc = 0; pc < 12; pc++) for (const minor of [false, true]) {
      const k = { tonic: parseNote((minor ? MINOR_KEYS : MAJOR_KEYS)[pc]), minor };
      const steps = minor ? MINOR_STEPS : MAJOR_STEPS;
      const qual = minor ? [1, 2, 0, 1, 1, 0, 0] : [0, 1, 1, 0, 0, 1, 2]; // 0 major, 1 minor, 2 dim
      let score = 0;
      infos.forEach((c) => {
        const deg = steps.findIndex((s) => mod(pc + s, 12) === c.pc);
        if (deg < 0) { score -= 1; return; }
        const q = c.dim ? 2 : c.minor ? 1 : 0;
        if (q === qual[deg] || (qual[deg] === 2 && q === 1)) score += 1;
        else if (minor && deg === 4 && q === 0) score += 0.8; // major V in minor
        else score += 0.2;
      });
      const first = infos[0]; const last = infos[infos.length - 1];
      const isTonic = (c) => c.pc === pc && (c.minor === minor);
      if (isTonic(first)) score += 2;
      if (isTonic(last)) score += 1.5;
      const tonicCount = infos.filter(isTonic).length;
      score += tonicCount * 0.3;
      if (minor) score -= 0.25;
      if (score > bestScore) { bestScore = score; best = k; }
    }
    return keyStr(best);
  }

  function songKey(song) { return (song.meta && song.meta.key) || song.guessedKey || null; }

  // Transpose every chord; returns a new song. targetKey spelling is derived from the song key.
  function transposeSong(song, semis) {
    const key = songKey(song);
    const pk = key ? parseKey(key) : null;
    const target = pk ? transposeKey(pk, semis, keySide(pk) || (semis < 0 ? -1 : 1)) : null;
    const tk = target ? parseKey(target) : null;
    const tc = (c) => (c && semis ? transposeChord(c, semis, tk) : c);
    const sections = song.sections.map((s) => ({
      kind: s.kind, label: s.label,
      lines: s.lines.map((l) => {
        if (l.type === 'lyric') return { type: 'lyric', segs: l.segs.map((sg) => ({ chord: sg.chord == null ? null : tc(sg.chord), text: sg.text })) };
        if (l.type === 'chords') return { type: 'chords', items: respace(l.items.map((it) => ({ col: it.col, tok: tc(it.tok) })), l.items) };
        return l;
      }),
    }));
    const out = { meta: Object.assign({}, song.meta), sections };
    if (song.meta && song.meta.key && target) out.meta.key = target;
    if (song.guessedKey) out.guessedKey = target;
    return out;
  }
  // keep at least one space between chords whose names grew
  function respace(items) {
    let end = 0;
    return items.map((it, i) => {
      const col = i === 0 ? it.col : Math.max(it.col, end + 1);
      end = col + it.tok.length;
      return { col, tok: it.tok };
    });
  }

  function slugify(s) {
    return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  }
  function songPath(meta) {
    return 'songs/' + (slugify(meta.artist) || 'unknown') + '--' + (slugify(meta.title) || 'untitled') + '.cho';
  }

  function plainText(song) {
    const out = [];
    for (const s of song.sections) for (const l of s.lines) {
      if (l.type === 'lyric') out.push(l.segs.map((x) => x.text).join(''));
    }
    return out.join('\n');
  }

  const SongParse = {
    normalizeText, isChordToken, isMarkToken, isChordLine, isTabLine, matchHeader, tokenize,
    parseSong, parsePlain, parseChordPro, writeChordPro, looksLikeChordPro,
    parseKey, keyStr, keyScale, keySide, spellPc, transposeKey, transposeChord, transposeSong,
    guessKey, songKey, songChords, slugify, songPath, plainText,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = SongParse;
  else global.SongParse = SongParse;
})(typeof globalThis !== 'undefined' ? globalThis : this);
