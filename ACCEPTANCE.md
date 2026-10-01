# Songbook acceptance criteria

Each item is checked by an automated test or a recorded browser check. Evidence lives outside the public repo.

## Parser and transpose
- A1. UG-style chord-over-lyric text becomes chords anchored to the right lyric columns, including chords with extensions (maj7, m7b5, sus4, add9, 7#9), slash chords, N.C. and repeat marks (x2, (x4), 2x).
- A2. Messy input is handled: CRLF and CR endings, tabs, extra spaces, trailing whitespace, non-breaking spaces, chord-only intros, inline `[Chorus]` headers and headers followed by chords.
- A3. Tab blocks (`e|---`) are preserved character for character.
- A4. ChordPro read then write then read gives the same model, and directives the app does not know are preserved.
- A5. The key guess is correct on the public-domain fixtures.
- A6. Transposing respells for the target key (for example G up 3 gives Bb, F, Eb, Gm and not A#, D#), slash basses follow, and up 12 returns the original.
- A7. Lyric lines with words like "A" or "Am" in sentences are not misread as chord lines.

## Library, view and to-add
- B1. Library search filters by title, artist and lyric text as you type.
- B2. On a 390-pixel phone, long lines wrap and every chord stays above its syllable with no overlap or horizontal page scroll.
- B3. Transpose, capo, text size and dark mode work and persist per song or device as appropriate.
- B4. Print view shows only the song, black on white.
- B5. Tapping a chord shows a diagram from the Chord Explorer engine. Escape and tap-outside close it.
- B6. The add screen shows a live preview that updates on each keystroke, and fills title, artist and key.
- B7. The to-add list supports add, check, delete and filter. Search links open a new tab with `rel="noopener noreferrer"` and the app makes no request for them. Saving a matching song ticks the item.

## Sync
- C1. With a mocked API, sync covers list, get, put and delete with SHA checks, new and changed and deleted files in both directions, keep-both conflicts, offline queue replay, 401, 403/429 rate limit and 5xx handling.
- C2. The private repo `brotatotes/songbook-songs` exists, is private and has a short README.
- C3. A live browser test creates a public-domain song, edits it from a second browser context, triggers a conflict, sees both versions kept, then cleans up all test files.
- C4. The token is stored only in the browser, is never written to the product or evidence, and sign-out removes it.

## Quality and release
- D1. `dist/index.html` is self-contained, opens from `file://` with no network requests until sync is configured and no page errors or console errors.
- D2. Desktop 1440x900 and phone 390x844 in portrait and landscape look calm and uncluttered, keyboard navigation reaches every control with a visible focus ring, and text contrast meets WCAG AA in light and dark modes.
- D3. No private paths, tokens, emails or song content in the public repo. No license file.
- D4. Pages serves an `index.html` whose hash matches `dist/index.html`, and paste, view and transpose work live on desktop and phone.
- D5. The home page has a Songbook card at the top of Games & Experiments, and its checks pass live.
