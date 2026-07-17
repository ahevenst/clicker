// Minimal Standard MIDI File (format 0) writer for click tracks.
//
// Each section emits a tempo meta event and a time-signature meta event,
// followed by its clicks on the percussion channel (10): High Wood Block for
// the downbeat, Low Wood Block for the other beats.

const TICKS_PER_QUARTER = 480;
const PERCUSSION_CHANNEL = 9; // 0-indexed channel 10
const NOTE_ACCENT = 76; // High Wood Block
const NOTE_BEAT = 77; // Low Wood Block

function varLen(value) {
  // MIDI variable-length quantity, 7 bits per byte, MSB-first.
  const bytes = [value & 0x7f];
  value >>= 7;
  while (value > 0) {
    bytes.unshift((value & 0x7f) | 0x80);
    value >>= 7;
  }
  return bytes;
}

function u32(value) {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function u16(value) {
  return [(value >> 8) & 0xff, value & 0xff];
}

/**
 * Build a .mid file for a track.
 * Section BPM is always quarter-note BPM, mapping directly onto the MIDI
 * tempo (microseconds per quarter note). Clicks land on denominator notes.
 */
export function trackToMidi(track) {
  const events = []; // flat byte list for the track chunk
  let pendingDelta = 0;

  const push = (deltaTicks, bytes) => {
    events.push(...varLen(deltaTicks), ...bytes);
  };

  // Track name meta event
  const nameBytes = Array.from(new TextEncoder().encode(track.name || "Click track"));
  push(0, [0xff, 0x03, ...varLen(nameBytes.length), ...nameBytes]);

  for (const section of track.sections) {
    // Tempo: microseconds per quarter note (BPM is quarter-note BPM).
    const usPerQuarter = Math.max(1, Math.round(60000000 / section.bpm));
    push(pendingDelta, [
      0xff, 0x51, 0x03,
      (usPerQuarter >> 16) & 0xff,
      (usPerQuarter >> 8) & 0xff,
      usPerQuarter & 0xff,
    ]);
    pendingDelta = 0;

    // Time signature: numerator, denominator as power of two,
    // MIDI clocks per metronome click, 32nd notes per quarter.
    const denPow = Math.round(Math.log2(section.den));
    const clocksPerClick = Math.round(24 * (4 / section.den));
    push(0, [0xff, 0x58, 0x04, section.num, denPow, clocksPerClick, 8]);

    const ticksPerBeat = Math.round(TICKS_PER_QUARTER * (4 / section.den));
    const noteLen = Math.min(60, Math.max(1, ticksPerBeat >> 2));
    const totalBeats = section.measures * section.num;

    for (let i = 0; i < totalBeats; i++) {
      const accent = i % section.num === 0;
      const note = accent ? NOTE_ACCENT : NOTE_BEAT;
      const velocity = accent ? 112 : 84;
      push(pendingDelta, [0x90 | PERCUSSION_CHANNEL, note, velocity]); // note on
      push(noteLen, [0x80 | PERCUSSION_CHANNEL, note, 0]); // note off
      pendingDelta = ticksPerBeat - noteLen;
    }
  }

  // End of track
  push(pendingDelta, [0xff, 0x2f, 0x00]);

  const header = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    ...u32(6),
    ...u16(0), // format 0
    ...u16(1), // one track
    ...u16(TICKS_PER_QUARTER),
  ];
  const trackChunk = [
    0x4d, 0x54, 0x72, 0x6b, // "MTrk"
    ...u32(events.length),
    ...events,
  ];

  return new Uint8Array([...header, ...trackChunk]);
}

/** Trigger a browser download of the track as a .mid file. */
export function downloadMidi(track) {
  const bytes = trackToMidi(track);
  const blob = new Blob([bytes], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName = (track.name || "click-track")
    .trim()
    .replace(/[^\w\- ]+/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase() || "click-track";
  a.href = url;
  a.download = `${safeName}.mid`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
