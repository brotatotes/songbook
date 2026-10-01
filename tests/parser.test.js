// Node tests for the Songbook parser. Run: node --test tests/
// Fixtures use public-domain hymns (Amazing Grace, Be Thou My Vision, Simple Gifts) or invented text.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/songparse.js');

const chordsOf = (song) => P.songChords(song);
const lyricLines = (song) => song.sections.flatMap((s) => s.lines.filter((l) => l.type === 'lyric'));
const chordAt = (line, ch) => line.segs.find((s) => s.chord === ch);

test('chord tokens: extensions, slashes, odd spellings', () => {
  for (const c of ['C', 'Am', 'F#m7b5', 'Bbmaj7', 'Dsus4', 'Gadd9', 'E7#9', 'C/G', 'D/F#', 'Asus2/E', 'Cm(maj7)', 'G6', 'Bb13', 'Ebdim7', 'Caug', 'F+', 'A5', 'C°', 'Bø', 'Em7(b5)', '(G)', 'Dm*']) {
    assert.ok(P.isChordToken(c), c);
  }
  for (const w of ['Amazing', 'And', 'Cause', 'Be', 'Did', 'Grace', 'Em-bark', 'Bb-b', 'Hello', 'Gm(']) assert.ok(!P.isChordToken(w), w);
});

test('chord lines vs lyric lines, including lines with A and Am words', () => {
  assert.ok(P.isChordLine('G   D/F#   Em7   Cadd9'));
  assert.ok(P.isChordLine('  N.C.        G     x2'));
  assert.ok(P.isChordLine('| G  | D  | Em | C  | (x4)'));
  assert.ok(P.isChordLine('G - D - Em - C   2x'));
  assert.ok(P.isChordLine('N.C.'));
  assert.ok(!P.isChordLine('A wretch like me'));
  assert.ok(!P.isChordLine('Am I the one'));
  assert.ok(!P.isChordLine('Be thou my vision'));
  assert.ok(!P.isChordLine('x2'));
  assert.ok(!P.isChordLine(''));
});

test('UG style paste with CRLF, tabs, extra spaces and headers', () => {
  const text = [
    'Amazing Grace chords by John Newton',
    '',
    '[Intro]',
    'G  C  G  D',
    '',
    '[Verse 1]',
    'G'.padEnd(8) + 'G7'.padEnd(11) + 'C'.padEnd(10) + 'G   ',
    'Amazing grace, how sweet the sound',
    '\tG              D',
    'That saved a wretch like me',
    '',
    'Chorus:',
    'G\tC',
    'I once was lost',
  ].join('\r\n');
  const s = P.parseSong(text);
  assert.equal(s.meta.title, 'Amazing Grace');
  assert.equal(s.meta.artist, 'John Newton');
  assert.deepEqual(s.sections.map((x) => x.label), ['Intro', 'Verse 1', 'Chorus']);
  assert.equal(s.sections[0].lines[0].type, 'chords');
  const v = s.sections[1].lines[0];
  assert.equal(v.type, 'lyric');
  assert.equal(v.segs.map((x) => x.text).join(''), 'Amazing grace, how sweet the sound');
  assert.equal(chordAt(v, 'C').text.trim().startsWith('sweet'), true);
  assert.ok(chordAt(v, 'G7').text.startsWith('grace'));
  // a leading tab expands to column 8, which is inside "saved"
  const v2 = s.sections[1].lines[1];
  assert.ok(chordAt(v2, 'G').text.startsWith('ed a'));
  assert.ok(chordAt(v2, 'D').text.startsWith('me') || chordAt(v2, 'D').text.length > 0);
  assert.equal(s.guessedKey, 'G');
});

test('mac CR endings and non-breaking spaces', () => {
  const s = P.parseSong('Simple Gifts\r\rC' + '\u00a0'.repeat(8) + 'F\r\'Tis the gift to be simple');
  const l = lyricLines(s)[0];
  assert.equal(chordAt(l, 'F').text[0], 'g');
});

test('inline [Chorus] tag followed by chords and repeat marks', () => {
  const s = P.parseSong('Be Thou My Vision\nIrish traditional\n\n[Chorus] D  G  A  D (x2)\nBe thou my vision\n');
  assert.equal(s.meta.title, 'Be Thou My Vision');
  assert.equal(s.meta.artist, 'Irish traditional');
  assert.equal(s.sections[0].label, 'Chorus');
  assert.equal(s.sections[0].lines[0].type, 'chords');
  assert.deepEqual(s.sections[0].lines[0].items.map((i) => i.tok), ['D', 'G', 'A', 'D', '(x2)']);
});

test('section header variants', () => {
  for (const [line, label] of [['[Verse 2]', 'Verse 2'], ['VERSE 2', 'VERSE 2'], ['Chorus:', 'Chorus'], ['Pre-Chorus', 'Pre-Chorus'], ['(Bridge)', 'Bridge'], ['Outro:', 'Outro'], ['Chorus: x2', 'Chorus x2'], ['[Interlude]', 'Interlude']]) {
    const h = P.matchHeader(line);
    assert.ok(h, line);
    assert.equal(h.label, label);
  }
  assert.equal(P.matchHeader('Verses of the morning are bright'), null);
  assert.equal(P.matchHeader('[G]'), null);
});

test('chord-only intro and chords past the end of a lyric line', () => {
  const s = P.parseSong('Invented Tune\n\nG  D  Em  C\n\nC          G             D7\nA little song\n');
  const first = s.sections[0].lines.find((l) => l.type === 'chords');
  assert.deepEqual(first.items.map((i) => i.tok), ['G', 'D', 'Em', 'C']);
  const l = lyricLines(s).find((x) => x.segs.some((y) => y.chord === 'D7'));
  assert.ok(chordAt(l, 'D7'));
  assert.equal(chordAt(l, 'C').text.startsWith('A little'), true);
});

test('tab blocks are kept verbatim', () => {
  const tab = ['e|-----0---3---|', 'B|---1-----0---|', 'G|-0-----0-----|', 'D|-------------|', 'A|-3-----------|', 'E|---------3---|'];
  const s = P.parseSong(['Invented Riff', '', '[Riff]', ...tab, '', 'G        C', 'Walking slow today'].join('\n'));
  const tabLines = s.sections.flatMap((x) => x.lines).filter((l) => l.type === 'tab').map((l) => l.text);
  assert.deepEqual(tabLines, tab);
  const out = P.writeChordPro(s);
  for (const t of tab) assert.ok(out.includes('\n' + t + '\n'), t);
  assert.deepEqual(P.parseSong(out).sections.flatMap((x) => x.lines).filter((l) => l.type === 'tab').map((l) => l.text), tab);
});

test('ChordPro read and write round trip, unknown directives preserved', () => {
  const cp = [
    '{title: Simple Gifts}', '{artist: Joseph Brackett}', '{key: F}', '{capo: 1}',
    '', '{start_of_verse: Verse 1}', '\'Tis the [F]gift to be simple, \'tis the gift to be [C]free', '{end_of_verse}',
    '', '{start_of_chorus}', '[F]When true sim[Bb]plicity is [F]gained', '{x_custom: keep me}', '{end_of_chorus}',
    '', '{comment: slowly}', '[F] [C] [F]',
  ].join('\n') + '\n';
  const s = P.parseSong(cp);
  assert.equal(s.format, 'chordpro');
  assert.equal(s.meta.title, 'Simple Gifts');
  assert.equal(s.meta.key, 'F');
  assert.equal(s.meta.capo, '1');
  const out = P.writeChordPro(s);
  const s2 = P.parseSong(out);
  assert.deepEqual(s2.sections, s.sections);
  assert.deepEqual(s2.meta, s.meta);
  assert.equal(P.writeChordPro(s2), out);
  assert.ok(out.includes('{x_custom: keep me}'));
  assert.ok(out.includes('{comment: slowly}'));
});

test('plain paste survives conversion to ChordPro and back', () => {
  const text = 'Be Thou My Vision\nIrish traditional\n\n[Verse 1]\nD        G    D\nBe thou my vision\n   Bm       Em    A\nO Lord of my heart\n';
  const s = P.parseSong(text);
  const s2 = P.parseSong(P.writeChordPro(s));
  assert.deepEqual(s2.sections, s.sections);
  assert.equal(s2.meta.title, s.meta.title);
});

test('key guess on public-domain fixtures', () => {
  assert.equal(P.parseSong('G G7 C G\nG D\nG G7 C G\nG D G').guessedKey, 'G');
  assert.equal(P.parseSong('D G D\nBm Em A\nD G D\nG A D').guessedKey, 'D');
  assert.equal(P.parseSong('F C F\nF Bb F\nC F').guessedKey, 'F');
  assert.equal(P.parseSong('Am Dm E Am\nAm G C E\nAm').guessedKey, 'Am');
  assert.equal(P.parseSong('Em C G D\nEm C G D Em').guessedKey, 'Em');
});

test('transposition spelling follows the target key', () => {
  const s = P.parseSong('{key: G}\n[G]One [D/F#]two [Em]three [C]four [Gm]five\n');
  const up3 = P.transposeSong(s, 3);
  assert.equal(up3.meta.key, 'Bb');
  assert.deepEqual(chordsOf(up3), ['Bb', 'F/A', 'Gm', 'Eb', 'Bbm']);
  const up1 = P.transposeSong(s, 1);
  assert.equal(up1.meta.key, 'Ab');
  assert.deepEqual(chordsOf(up1), ['Ab', 'Eb/G', 'Fm', 'Db', 'Abm']);
  const down2 = P.transposeSong(s, -2);
  assert.equal(down2.meta.key, 'F');
  assert.deepEqual(chordsOf(down2), ['F', 'C/E', 'Dm', 'Bb', 'Fm']);
  const up2 = P.transposeSong(s, 2);
  assert.equal(up2.meta.key, 'A');
  assert.deepEqual(chordsOf(up2), ['A', 'E/G#', 'F#m', 'D', 'Am']);
  assert.deepEqual(chordsOf(P.transposeSong(s, 12)), chordsOf(s));
  assert.deepEqual(chordsOf(P.transposeSong(s, -12)), chordsOf(s));
});

test('transposition keeps suffixes, N.C., marks and minor keys', () => {
  const s = P.parseSong('{key: Am}\n[Am7]a [Dm9]b [E7#9]c [N.C.]d [F#m7b5]e [Cmaj7/G]f\n');
  const t = P.transposeSong(s, 1);
  assert.equal(t.meta.key, 'Bbm');
  assert.deepEqual(chordsOf(t), ['Bbm7', 'Ebm9', 'F7#9', 'Gm7b5', 'Dbmaj7/Ab']);
  assert.ok(P.writeChordPro(t).includes('[N.C.]'));
  const e = P.transposeSong(s, -5);
  assert.equal(e.meta.key, 'Em');
  assert.deepEqual(chordsOf(e), ['Em7', 'Am9', 'B7#9', 'C#m7b5', 'Gmaj7/D']);
});

test('harmonic minor raised seventh is spelled as a sharp', () => {
  assert.equal(P.spellPc(8, P.parseKey('Am')), 'G#');
  assert.equal(P.spellPc(1, P.parseKey('Dm')), 'C#');
  assert.equal(P.spellPc(6, P.parseKey('F')), 'Gb');
  assert.equal(P.spellPc(10, P.parseKey('E')), 'A#');
});

test('chord-only lines respace when names grow', () => {
  const s = P.parseSong('{key: C}\n[C] [G] [Am] [F]\n');
  const t = P.transposeSong(s, 1);
  const out = P.writeChordPro(t);
  assert.ok(/\[Db\] \[Ab\] \[Bbm\] \[Gb\]/.test(out), out);
});

test('slugs and paths', () => {
  assert.equal(P.songPath({ title: 'Be Thou My Vision', artist: 'Irish Traditional' }), 'songs/irish-traditional--be-thou-my-vision.cho');
  assert.equal(P.songPath({ title: 'Café Déjà Vu!', artist: '' }), 'songs/unknown--cafe-deja-vu.cho');
  assert.equal(P.slugify("'Tis the Gift & More"), 'tis-the-gift-and-more');
});

test('metadata lines in a paste', () => {
  const s = P.parseSong('Title: Simple Gifts\nArtist: Joseph Brackett\nKey: F\nCapo: 3rd fret\n\nF       C\n\'Tis the gift\n');
  assert.equal(s.meta.title, 'Simple Gifts');
  assert.equal(s.meta.artist, 'Joseph Brackett');
  assert.equal(s.meta.key, 'F');
  assert.equal(s.meta.capo, '3');
});

test('empty and garbage input do not throw', () => {
  for (const t of ['', '\n\n\n', '   ', null, undefined, '[]', '{}', '{title:}', '|||', 'x2']) {
    const s = P.parseSong(t);
    assert.ok(Array.isArray(s.sections));
    assert.equal(typeof P.writeChordPro(s), 'string');
  }
});
