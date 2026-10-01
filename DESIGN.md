# Songbook design

A calm, fast chord and lyric viewer. One self-contained `index.html`, no build-time network, no runtime network until the owner sets up sync. No ads, trackers, auto-scroll, audio or play-along. The public app ships with no song content.

## Screens

All screens live in one page with hash routing so the back button works and nothing reloads.

- **Library** (`#/`). Title "Songbook", a single search box, and a plain list of songs sorted by title. Each row shows the title in the body serif and the artist in a quieter tone. Search matches title, artist and lyric text (case and accent insensitive). Two quiet text actions sit in the header: "Add song" and "To add (n)". A small sync line at the bottom shows "Synced 2 min ago", "3 changes waiting" or "Sync not set up".
- **Song view** (`#/song/<id>`). Title, artist and a one-line key/capo summary, then the sheet. A single compact toolbar holds transpose down/up with the current key, capo, text size, dark mode, print and edit. On phones the toolbar collapses to one row of icon-sized text buttons. Nothing else is on screen. Tapping a chord opens a small diagram sheet (guitar shape by default, ukulele and piano switchable) from the Chord Explorer engine, closed with Escape, the close button or a tap outside.
- **Add / edit** (`#/new`, `#/edit/<id>`). A large paste box on the left, a live preview on the right (stacked on phones, preview below). Title, artist and key fields are filled from the paste and are editable. Key shows the best guess with a "guessed" hint. Save writes the ChordPro file and returns to the song. Edit opens the stored ChordPro text, which is also accepted by the same box.
- **Songs to add** (`#/todo`). A checklist of title and artist pairs with an add row, search filter, and for each item two quiet links, "Search chords" and "Search YouTube", that open a normal web search in a new tab (`target=_blank`, `rel=noopener noreferrer`). The app never fetches any third-party page. Saving a song whose title matches an unchecked item (normalized) ticks it off.
- **Sync setup** (`#/sync`). Plain numbered steps to create a fine-grained token, fields for repository (default `brotatotes/songbook-songs`) and token, "Test and save", the current status, "Sync now" and "Sign out on this device".

## Paste and import flow

1. The user pastes any text. Line endings are normalized (CRLF, CR to LF), tabs expanded to spaces at 8-column stops, trailing spaces trimmed and non-breaking spaces converted.
2. If the text contains ChordPro directives (`{title:` etc.) or inline `[C]` chords inside lyric lines, it is read as ChordPro.
3. Otherwise each line is classified:
   - **Section header**: `[Verse 1]`, `[Chorus]`, `Chorus:`, `VERSE 2`, `Pre-Chorus`, `Intro:`, `Bridge`, `Outro`, `Interlude`, `Solo`, `Tag`, `Instrumental`, `Refrain`, `Hook`, optionally followed by chords on the same line (`[Intro] G D Em C`).
   - **Chord line**: every token is a chord, `N.C.`, `|`, `/`, `-`, `%`, a repeat mark (`x2`, `(x4)`, `2x`), or a parenthesized chord. At least one real chord is required.
   - **Tab line**: matches `e|---` style string lines or is inside a block of them. Contiguous tab lines are kept verbatim.
   - **Lyric line**: anything else.
4. A chord line directly followed by a lyric line is merged: each chord is anchored at its column in the lyric. Chords past the end of the lyric are appended with padding. A chord line not followed by lyrics stays a chord-only line (intros, turnarounds).
5. Blank lines are kept as paragraph breaks. Leading and trailing junk such as "Tabbed by", page numbers and "Ultimate Guitar" boilerplate is not removed automatically, since the user can edit the paste.
6. Title and artist are guessed from the first non-chord lines ("Title by Artist", "Title - Artist", "Artist - Title Chords") and are always editable. The key is guessed from the chords.

## Internal model

A song is `{ meta: {title, artist, key, capo, ...}, sections: [{ kind, label, lines }] }`. A line is one of `{type:'lyric', segs:[{chord, text}]}`, `{type:'chords', items:[...]}`, `{type:'tab', text}`, `{type:'comment', text}`, `{type:'blank'}`. A segment's chord sits above the first character of its text, which is what keeps chords on syllables when lines wrap.

## ChordPro subset

Read and written:

- Metadata: `{title: }` (`{t: }`), `{artist: }`, `{key: }`, `{capo: }`, `{tempo: }`, `{time: }`, `{album: }`, `{year: }`, `{x_source: }` (where the paste came from, free text), `{x_added: YYYY-MM-DD}`.
- Sections: `{start_of_verse: Label}` / `{end_of_verse}`, the same for chorus, bridge and tab, plus `{start_of_part: Label}` / `{end_of_part}` for Intro, Outro, Pre-Chorus, Solo and other labels. Short forms `{sov}`, `{soc}`, `{sob}`, `{sot}` and their ends are accepted.
- `{comment: }` and `{c: }` for notes, `{chorus}` to recall a chorus. Unknown directives are kept as they are and written back unchanged.
- Inline chords `[G]` before the syllable. Chord-only lines are written as `[G] [D] [Em] [C]` with spacing kept. Repeat marks are written as plain text after the chords.

Writing then reading a song gives the same model (tested). Files are UTF-8 with LF endings and end with a newline.

## Files in the songs repo

```
README.md
todo.md
songs/<artist-slug>--<title-slug>.cho
```

Slugs are lowercase ASCII, accents folded, non-alphanumerics collapsed to `-`, trimmed to 60 characters. Missing artist uses `unknown`. A name clash on a new song appends `-2`, `-3`. A conflict copy is `songs/<slug>.conflict-<YYYYMMDD-HHMM>-<device>.cho`, where device is a short random id stored in the browser. Conflict copies show in the library with a "conflict copy" label so they can be merged by hand and deleted.

## To-add list format (`todo.md`)

```
# Songs to add

- [ ] Title | Artist
- [x] Another title | Artist
```

Unknown lines are preserved. The app rewrites the file in this order when the list changes. It syncs like a song, with the same SHA and conflict rules. A conflict on `todo.md` is merged automatically as the union of items, with checked winning.

## Sync protocol

GitHub REST contents API at `https://api.github.com`, with `Authorization: Bearer <token>`, `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2022-11-28`. No other host is ever contacted.

Local state in `localStorage` (`songbook.v1`): for each path `{ text, baseSha, dirty, deleted, updatedAt }`, plus `lastSync`. The offline queue is simply the set of dirty or deleted entries, so it survives reloads and is replayed in order of `updatedAt`.

A sync run (on open, after save, after delete and on "Sync now"), one at a time:

1. `GET /repos/{o}/{r}/contents/songs` lists remote files and SHAs (404 means empty). `todo.md` is fetched by path.
2. For every local dirty entry:
   - Remote SHA equals `baseSha` (or both absent): `PUT` with `sha: baseSha`. Store the returned SHA and clear dirty.
   - Remote differs: `GET` the remote text. If identical, adopt it. Otherwise keep both: `PUT` the local text to a new conflict path, then adopt the remote text at the original path. The user sees a notice.
   - `PUT` returns 409 or 422 for a stale SHA: same keep-both path.
3. For every local deleted entry: `DELETE` with `baseSha`. If the remote changed since, the delete is dropped and the remote version comes back (nothing is lost).
4. For every remote file whose SHA differs from the clean local `baseSha`, or which is new: `GET` and store it. A clean local entry missing remotely is removed locally.
5. Network failure stops the run and leaves the queue intact ("Offline, 2 changes waiting"). 401 shows "Token rejected" and links to setup. 403/429 with rate-limit headers waits until the reset time shown and does not retry in a loop. 5xx retries once on the next trigger.

File content is base64-encoded UTF-8 both ways. Commit messages are "Add <title>", "Update <title>", "Delete <title>" and "Conflict copy of <title>".

## Token setup and storage

The setup screen explains, in four steps, how to create a fine-grained token at `https://github.com/settings/personal-access-tokens/new` with access to only `brotatotes/songbook-songs` and Repository permissions Contents: Read and write. The token is stored only in this browser's `localStorage` under `songbook.auth`, is never logged, never placed in a URL and is sent only to `api.github.com`. "Test and save" calls `GET /repos/{o}/{r}` and confirms the repo is reachable and private before saving. "Sign out on this device" deletes the token and, after a confirm, optionally the local song cache.

## Transpose and spelling

- The song key (stored or guessed) is transposed by the chosen number of semitones. The target key is spelled from the standard set: major C, Db, D, Eb, E, F, F#, G, Ab, A, Bb, B; minor Am, Bbm, Bm, Cm, C#m, Dm, Ebm, Em, Fm, F#m, Gm, G#m. Gb and F# keep the original's side when the original was sharp or flat.
- Each chord root and slash bass is moved by interval and then respelled for the target key. A pitch in the target key's scale takes the key's spelling. Otherwise the key's side wins (flats in flat keys, sharps in sharp keys), with B#, E#, Cb and Fb avoided unless they are diatonic.
- The chord suffix (`m7`, `sus4`, `add9`, `7b9`) is kept verbatim.
- Capo shows shapes: with capo c, displayed chords are moved down c semitones and the summary reads "Capo 3, shapes in G, sounds in Bb".
- Unrecognized tokens in chord lines are left untouched.

## Visual style

- EB Garamond (embedded subset) for everything, with a FreeSerif fallback subset for sharp and flat signs. Chords are shown with real ♯ and ♭ signs, in a semibold weight and a muted warm accent (deep rust in light mode, soft amber in dark mode), 0.9 of lyric size.
- Light mode is warm paper (#fbf8f1) with ink (#22201c). Dark mode is a warm charcoal (#1a1917) with parchment text (#e8e2d4). Both meet WCAG AA for body text and chords.
- One reading column, max 42em, generous line height. Section labels are small caps in a quiet tone. Tab blocks are monospace and scroll horizontally rather than wrapping.
- Each lyric line is a row of inline-block segments, chord above text, so a long line wraps between words and chords stay over their syllables. Chords wider than their syllable push the text apart slightly rather than overlapping.
- Print view hides all controls, uses black on white, keeps sections together where possible and fits two columns on wide paper when the song is long.
- Motion is limited to a 120 ms fade for the chord sheet, disabled under `prefers-reduced-motion`.

## Code layout

```
src/index.html      page shell
src/style.css       styles, including print
src/fonts.css       embedded fonts (copied from Chord Explorer)
src/vendor/theory.js, shapes.js   Chord Explorer engine, copied with attribution
src/songparse.js    paste detection, ChordPro read/write, key guess, transpose
src/store.js        local cache and to-add list
src/sync.js         GitHub contents sync (fetch injected for tests)
src/app.js          screens and interaction
tools/build.js      inlines everything into dist/index.html
tests/*.test.js     node tests
```
