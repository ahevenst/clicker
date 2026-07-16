# Clicker

A low-latency metronome webapp. Dark, clean, no build step, no dependencies.

## Features

**Metronome mode** — pick a tempo (slider, +/- buttons, tap tempo, or arrow
keys), pick a time signature, and hit play. The first beat of every bar is
accented, and the beat dots pulse in sync with the audio.

**Tracks mode** — build finite click tracks out of sections. Each section has
its own tempo, time signature, and bar count. Tracks can be previewed,
named, and saved (localStorage), and exported as standard MIDI files with
tempo and time-signature meta events (clicks land on the percussion channel:
High Wood Block on downbeats, Low Wood Block elsewhere). The tracks screen
lists every saved track with its duration, section count, and total bars.

## Low latency

Clicks are scheduled on the Web Audio clock with a lookahead scheduler
(the "tale of two clocks" pattern): a coarse timer wakes every 25 ms and
schedules all clicks in the next 120 ms sample-accurately on the
`AudioContext`, so timing is immune to main-thread jitter. The context is
created with `latencyHint: "interactive"`. Visuals sync back to the audio
clock via `requestAnimationFrame`.

Note: BPM refers to the beat unit of the time signature (e.g. 6/8 at 120
means 120 eighth notes per minute), both in playback and in MIDI export.

## Run it

It's a static site — serve the repo root with any web server:

```sh
npx serve .        # or
python3 -m http.server 8080
```

Then open http://localhost:8080. (Modules require http://, not file://.)

## Layout

- `index.html` — all three screens (metronome, track list, track editor)
- `css/style.css` — dark theme
- `js/audio.js` — Web Audio lookahead scheduler (`ClickEngine`), track → beat expansion
- `js/midi.js` — Standard MIDI File (format 0) writer + download
- `js/storage.js` — localStorage persistence
- `js/app.js` — UI wiring and screen routing
