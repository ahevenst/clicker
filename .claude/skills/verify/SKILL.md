---
name: verify
description: Build/launch/drive recipe for verifying the Clicker metronome webapp end-to-end.
---

# Verifying Clicker

Static site, no build step. Serve the repo root and drive with Playwright.

## Launch

```sh
http-server -p 8734 -s &          # or python3 -m http.server 8734
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8734/index.html   # expect 200
```

ES modules require http://, not file://.

## Drive (Playwright)

Global playwright is at `/opt/node22/lib/node_modules/playwright` in this
environment; import it by absolute path in an .mjs script (`NODE_PATH`
doesn't apply to ESM). Launch chromium with
`--autoplay-policy=no-user-gesture-required`.

Flows worth driving:

- **Metronome**: click `#metro-play`, poll for `#metro-beats .beat-dot.on`
  (dots light in sync with scheduled audio). Space toggles play when focus
  is not in an input. `#bpm-input` clamps to 20–300 on change.
- **Editor**: open via Tracks tab → `#new-track`. Section fields are
  `input[type=number]` — fill then press Enter to fire `change`.
  "+ Add section" **copies the previous section's settings** (including the
  denominator) — set every field you care about. `#editor-duration` updates
  live.
- **Preview**: `#editor-play`; assert `.section-card.active-playing` index
  advances and `#progress-fill` width grows.
- **MIDI export**: `page.waitForEvent("download")` + click `#editor-export`,
  then parse the .mid bytes: `MThd`, format 0, division 480, tempo meta
  scaled by den/4 (BPM = beat unit), timesig metas per section, note-ons on
  channel 10 (76 accent / 77 beat).
- **Persistence**: save, reload page, track survives (localStorage key
  `clicker.tracks.v1`).

## Gotchas

- Don't `page.click("body")` to blur — the centered play button sits at the
  page midline and can swallow the click. Use `document.activeElement.blur()`.
- Deleting the last section auto-inserts one default section (by design).
- Tap tempo under Playwright reads slightly low (~111 for 500 ms waits) —
  timer jitter, not a bug.
