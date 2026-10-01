# Songbook

A calm, minimal chord and lyric viewer. Paste a song, read it with chords above the words, transpose it, print it. There are no ads, trackers, auto-scroll or audio. Your songs sync to your own private GitHub repository.

Use it here: https://brotatotes.github.io/songbook/

This site ships with no songs. Everything you add lives in your browser and, once sync is set up, in your private songs repository.

## Adding a song

1. Tap **Add**.
2. Paste a song written as chords above lyrics, or in ChordPro. The preview updates as you paste.
3. Check the title, artist and key, then save.

Section labels such as `[Verse]` and `[Chorus]`, slash chords, `N.C.`, repeat marks and tab blocks are understood. Each song is stored as one ChordPro text file.

## One-time sync setup on each device

1. Create a private repository for your songs, for example `songbook-songs`.
2. Open https://github.com/settings/personal-access-tokens/new and create a fine-grained token.
3. Under **Repository access**, choose **Only select repositories** and pick your songs repository.
4. Under **Repository permissions**, set **Contents** to **Read and write**. Leave everything else unchanged.
5. Generate the token, open **Sync** in Songbook, check the repository name (it defaults to `brotatotes/songbook-songs`) and paste the token.

The token is stored only in that browser and is only sent to `api.github.com`. **Sign out** on the Sync screen removes it. Songbook makes no network requests until sync is set up.

Sync runs when the app opens and when you save. Changes made offline are queued and sent later. If the same song was changed on two devices, both versions are kept and git history is the backup.

## Songs to add

The **Songs to add** list is a checklist of titles and artists. Each item has search links that open in a new tab. Songbook never fetches or scrapes other sites. Saving a pasted song ticks off the matching item. The list is stored as `todo.md` in your songs repository.

## How it is built

Plain JavaScript with no dependencies.

- `src/songparse.js` detects chord lines, aligns chords to lyrics, reads and writes ChordPro, guesses the key and transposes with correct spelling.
- `src/store.js` is the local library. `src/sync.js` and `src/sync-ui.js` handle GitHub sync.
- `src/vendor/theory.js` and `src/vendor/shapes.js` are copied from [Chord Explorer](https://github.com/brotatotes/chord-explorer) and draw the chord diagrams.
- `node tools/build.js` inlines everything into one self-contained `dist/index.html`. The published `index.html` is a copy of that file.
- Run the unit tests with `node --test tests/*.test.js`. The Python files in `tools/` are Playwright browser checks.

`DESIGN.md` describes the screens, song format and sync protocol. `ACCEPTANCE.md` lists the checks the app was tested against.

## Font notices

- EB Garamond by Georg Duffner is embedded as a subset under the SIL Open Font License 1.1. See `fonts/EB-Garamond-OFL.txt`.
- The sharp, flat and natural signs come from a tiny subset of GNU FreeSerif, which is licensed under the GPL version 3 or later with the font exception that permits embedding in documents.
