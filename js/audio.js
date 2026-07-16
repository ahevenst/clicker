// Low-latency click engine built on the Web Audio API.
//
// Timing strategy (the classic "tale of two clocks" lookahead scheduler):
// a coarse setInterval wakes up every SCHEDULER_INTERVAL_MS and schedules
// every click that falls within the next LOOKAHEAD_S seconds directly on the
// AudioContext clock. Audio timing is therefore sample-accurate and immune
// to main-thread jitter; the JS timer only has to wake up "soon enough".

const SCHEDULER_INTERVAL_MS = 25;
const LOOKAHEAD_S = 0.12;
const CLICK_LENGTH_S = 0.045;

export class ClickEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.timer = null;
    this.running = false;
    this.visualQueue = []; // { time, payload } consumed by a rAF loop
    this.rafId = 0;
    this.onVisualBeat = null;
    this._mode = null; // 'loop' | 'sequence'
  }

  _ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: "interactive",
      });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  // Two-oscillator click: a pitched blip plus a tiny noise-like transient
  // from a fast frequency sweep. Accented beats are higher and louder.
  _scheduleClick(time, accent) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    const freq = accent ? 1760 : 1175;
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, time + CLICK_LENGTH_S);

    const peak = accent ? 0.85 : 0.5;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + CLICK_LENGTH_S);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(time);
    osc.stop(time + CLICK_LENGTH_S + 0.01);
  }

  _startVisualLoop() {
    const tick = () => {
      if (!this.running && this.visualQueue.length === 0) {
        this.rafId = 0;
        return;
      }
      const now = this.ctx.currentTime;
      while (this.visualQueue.length && this.visualQueue[0].time <= now) {
        const evt = this.visualQueue.shift();
        if (this.onVisualBeat) this.onVisualBeat(evt.payload);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    if (!this.rafId) this.rafId = requestAnimationFrame(tick);
  }

  /**
   * Mode 1: endless loop. `getState` is read live on every scheduled beat so
   * tempo / time-signature changes take effect within one beat.
   * getState() -> { bpm, beatsPerBar }
   */
  startLoop(getState, onVisualBeat) {
    this.stop();
    this._ensureContext();
    this._mode = "loop";
    this.onVisualBeat = onVisualBeat;
    this.running = true;

    let nextTime = this.ctx.currentTime + 0.06;
    let beatInBar = 0;

    const schedule = () => {
      const horizon = this.ctx.currentTime + LOOKAHEAD_S;
      while (nextTime < horizon) {
        const { bpm, beatsPerBar } = getState();
        const accent = beatInBar === 0;
        this._scheduleClick(nextTime, accent);
        this.visualQueue.push({
          time: nextTime,
          payload: { beat: beatInBar, beatsPerBar, accent },
        });
        nextTime += 60 / bpm;
        beatInBar = (beatInBar + 1) % Math.max(1, beatsPerBar);
      }
    };

    schedule();
    this.timer = setInterval(schedule, SCHEDULER_INTERVAL_MS);
    this._startVisualLoop();
  }

  /**
   * Mode 2: finite sequence playback.
   * `beats` is a sorted array of { offset, accent, ...payload } where offset
   * is seconds from sequence start. Calls onDone once the last beat has
   * actually sounded.
   */
  startSequence(beats, onVisualBeat, onDone) {
    this.stop();
    if (!beats.length) {
      if (onDone) onDone();
      return;
    }
    this._ensureContext();
    this._mode = "sequence";
    this.onVisualBeat = onVisualBeat;
    this.running = true;

    const startTime = this.ctx.currentTime + 0.08;
    this.sequenceStartTime = startTime;
    let index = 0;

    const schedule = () => {
      const horizon = this.ctx.currentTime + LOOKAHEAD_S;
      while (index < beats.length && startTime + beats[index].offset < horizon) {
        const beat = beats[index];
        const when = startTime + beat.offset;
        this._scheduleClick(when, beat.accent);
        this.visualQueue.push({ time: when, payload: beat });
        index++;
      }
      if (index >= beats.length) {
        clearInterval(this.timer);
        this.timer = null;
        const last = beats[beats.length - 1];
        const endsAt = startTime + last.offset + CLICK_LENGTH_S;
        const waitMs = Math.max(0, (endsAt - this.ctx.currentTime) * 1000) + 60;
        this.endTimeout = setTimeout(() => {
          if (this._mode === "sequence" && this.running) {
            this.running = false;
            if (onDone) onDone();
          }
        }, waitMs);
      }
    };

    schedule();
    if (index < beats.length) {
      this.timer = setInterval(schedule, SCHEDULER_INTERVAL_MS);
    }
    this._startVisualLoop();
  }

  /** Seconds elapsed since the current sequence started (for progress UI). */
  sequenceElapsed() {
    if (!this.ctx || this.sequenceStartTime == null) return 0;
    return Math.max(0, this.ctx.currentTime - this.sequenceStartTime);
  }

  stop() {
    this.running = false;
    this._mode = null;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.endTimeout) {
      clearTimeout(this.endTimeout);
      this.endTimeout = null;
    }
    this.visualQueue.length = 0;
    this.sequenceStartTime = null;
  }
}

/**
 * Expand a track's sections into a flat list of beat events for playback.
 * The BPM of a section refers to its beat unit (the denominator note),
 * e.g. 6/8 at 120 means 120 eighth notes per minute.
 */
export function trackToBeats(sections) {
  const beats = [];
  let offset = 0;
  sections.forEach((section, sectionIndex) => {
    const beatDur = 60 / section.bpm;
    for (let m = 0; m < section.measures; m++) {
      for (let b = 0; b < section.num; b++) {
        beats.push({
          offset,
          accent: b === 0,
          sectionIndex,
          measure: m,
          beat: b,
          beatsPerBar: section.num,
        });
        offset += beatDur;
      }
    }
  });
  return { beats, duration: offset };
}

/** Total duration of a track in seconds. */
export function trackDuration(sections) {
  return sections.reduce(
    (total, s) => total + s.measures * s.num * (60 / s.bpm),
    0
  );
}
