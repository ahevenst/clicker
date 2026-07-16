import { ClickEngine, trackToBeats, trackDuration } from "./audio.js";
import { trackToMidi, downloadMidi } from "./midi.js";
import { loadTracks, getTrack, saveTrack, deleteTrack, newTrackId } from "./storage.js";

const engine = new ClickEngine();

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const BPM_MIN = 20;
const BPM_MAX = 300;

/* ================= Helpers ================= */

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function formatDuration(seconds) {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

let toastTimer = null;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ================= Screen routing ================= */

const screens = {
  metronome: $("#screen-metronome"),
  tracks: $("#screen-tracks"),
  editor: $("#screen-editor"),
};

let activeScreen = "metronome";

function showScreen(name) {
  stopEverything();
  activeScreen = name;
  Object.entries(screens).forEach(([key, el]) =>
    el.classList.toggle("active", key === name)
  );
  $$(".tab").forEach((tab) => {
    const isActive =
      tab.dataset.screen === name || (name === "editor" && tab.dataset.screen === "tracks");
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  if (name === "tracks") renderTrackList();
}

$$(".tab").forEach((tab) =>
  tab.addEventListener("click", () => showScreen(tab.dataset.screen))
);

function stopEverything() {
  engine.stop();
  metroPlaying = false;
  previewPlaying = false;
  screens.metronome.classList.remove("playing");
  $("#editor-play").classList.remove("playing");
  $("#editor-play-label").textContent = "Preview";
  $("#editor-progress").classList.add("hidden");
  $$(".section-card").forEach((c) => c.classList.remove("active-playing"));
  clearMetroDots();
}

/* ================= Mode 1: Metronome ================= */

const bpmInput = $("#bpm-input");
const bpmSlider = $("#bpm-slider");
const metroNum = $("#metro-num");
const metroDen = $("#metro-den");
const metroBeatsEl = $("#metro-beats");

let metroPlaying = false;

for (let i = 1; i <= 16; i++) {
  const opt = document.createElement("option");
  opt.value = i;
  opt.textContent = i;
  if (i === 4) opt.selected = true;
  metroNum.appendChild(opt);
}

function getBpm() {
  return clamp(parseInt(bpmInput.value, 10) || 120, BPM_MIN, BPM_MAX);
}

function setBpm(value) {
  const bpm = clamp(Math.round(value), BPM_MIN, BPM_MAX);
  bpmInput.value = bpm;
  bpmSlider.value = bpm;
  updateSliderFill();
}

function updateSliderFill() {
  const pct = ((bpmSlider.value - BPM_MIN) / (BPM_MAX - BPM_MIN)) * 100;
  bpmSlider.style.setProperty("--fill", `${pct}%`);
}

bpmSlider.addEventListener("input", () => setBpm(bpmSlider.value));
bpmInput.addEventListener("change", () => setBpm(bpmInput.value));
$("#bpm-up").addEventListener("click", () => setBpm(getBpm() + 1));
$("#bpm-down").addEventListener("click", () => setBpm(getBpm() - 1));

function renderMetroDots() {
  const count = parseInt(metroNum.value, 10);
  metroBeatsEl.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const dot = document.createElement("div");
    dot.className = "beat-dot" + (i === 0 ? " first" : "");
    metroBeatsEl.appendChild(dot);
  }
}

function clearMetroDots() {
  $$("#metro-beats .beat-dot").forEach((d) => d.classList.remove("on", "accent"));
}

metroNum.addEventListener("change", renderMetroDots);
renderMetroDots();

function toggleMetronome() {
  if (metroPlaying) {
    stopEverything();
    return;
  }
  metroPlaying = true;
  screens.metronome.classList.add("playing");
  engine.startLoop(
    () => ({ bpm: getBpm(), beatsPerBar: parseInt(metroNum.value, 10) }),
    ({ beat, accent }) => {
      const dots = $$("#metro-beats .beat-dot");
      dots.forEach((d) => d.classList.remove("on", "accent"));
      const dot = dots[beat];
      if (dot) {
        dot.classList.add("on");
        if (accent) dot.classList.add("accent");
      }
    }
  );
}

$("#metro-play").addEventListener("click", toggleMetronome);

/* Tap tempo */
let taps = [];
$("#tap-tempo").addEventListener("click", (e) => {
  const now = performance.now();
  taps = taps.filter((t) => now - t < 2500);
  taps.push(now);
  const btn = e.currentTarget;
  btn.classList.add("tapping");
  setTimeout(() => btn.classList.remove("tapping"), 120);
  if (taps.length >= 2) {
    const intervals = taps.slice(1).map((t, i) => t - taps[i]);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    setBpm(60000 / avg);
  }
});

/* Keyboard shortcuts */
document.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  if (e.code === "Space") {
    e.preventDefault();
    if (activeScreen === "metronome") toggleMetronome();
    else if (activeScreen === "editor") togglePreview();
  } else if (activeScreen === "metronome" && e.code === "ArrowUp") {
    e.preventDefault();
    setBpm(getBpm() + (e.shiftKey ? 10 : 1));
  } else if (activeScreen === "metronome" && e.code === "ArrowDown") {
    e.preventDefault();
    setBpm(getBpm() - (e.shiftKey ? 10 : 1));
  }
});

/* ================= Mode 2: Track list ================= */

function trackMeta(track) {
  const seconds = trackDuration(track.sections);
  const bars = track.sections.reduce((n, s) => n + s.measures, 0);
  const sections = track.sections.length;
  return {
    duration: formatDuration(seconds),
    detail: `${sections} section${sections === 1 ? "" : "s"} · ${bars} bar${bars === 1 ? "" : "s"}`,
  };
}

function renderTrackList() {
  const tracks = loadTracks();
  const list = $("#track-list");
  const empty = $("#tracks-empty");
  list.innerHTML = "";
  empty.classList.toggle("hidden", tracks.length > 0);

  for (const track of tracks) {
    const meta = trackMeta(track);
    const card = document.createElement("div");
    card.className = "track-card";
    card.innerHTML = `
      <div class="track-card-main">
        <p class="track-card-name"></p>
        <div class="track-card-meta">
          <span class="pill">${meta.duration}</span>
          <span class="dot"></span>
          <span>${meta.detail}</span>
        </div>
      </div>
      <div class="track-card-actions">
        <button class="icon-btn" data-action="export" title="Export MIDI" aria-label="Export MIDI">&#8681;</button>
        <button class="icon-btn danger" data-action="delete" title="Delete" aria-label="Delete track">&#10005;</button>
      </div>`;
    card.querySelector(".track-card-name").textContent = track.name || "Untitled track";
    card.addEventListener("click", (e) => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (action === "export") {
        downloadMidi(track);
        toast("MIDI exported");
      } else if (action === "delete") {
        if (confirm(`Delete "${track.name || "Untitled track"}"?`)) {
          deleteTrack(track.id);
          renderTrackList();
          toast("Track deleted");
        }
      } else {
        openEditor(track.id);
      }
    });
    list.appendChild(card);
  }
}

$("#new-track").addEventListener("click", () => openEditor(null));
$("#empty-new-track").addEventListener("click", () => openEditor(null));

/* ================= Mode 2: Track editor ================= */

const DEFAULT_SECTION = { bpm: 120, num: 4, den: 4, measures: 4 };

let editing = null; // { id, name, sections }
let previewPlaying = false;
let progressRaf = 0;

function openEditor(trackId) {
  const existing = trackId ? getTrack(trackId) : null;
  editing = existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: newTrackId(), name: "", sections: [{ ...DEFAULT_SECTION }] };
  $("#track-name").value = editing.name;
  showScreen("editor");
  renderSections();
}

$("#editor-back").addEventListener("click", () => showScreen("tracks"));
$("#track-name").addEventListener("input", (e) => {
  editing.name = e.target.value;
});

function updateEditorDuration() {
  $("#editor-duration").textContent = formatDuration(trackDuration(editing.sections));
}

function sectionSummary(section) {
  const secs = section.measures * section.num * (60 / section.bpm);
  return `${section.num}/${section.den} · ${section.bpm} BPM · ${section.measures} bar${section.measures === 1 ? "" : "s"} · ${formatDuration(secs)}`;
}

function numberField(labelText, value, min, max, onChange) {
  const field = document.createElement("div");
  field.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.className = "boxed";
  input.min = min;
  input.max = max;
  input.value = value;
  input.addEventListener("change", () => {
    const v = clamp(parseInt(input.value, 10) || min, min, max);
    input.value = v;
    onChange(v);
  });
  field.append(label, input);
  return field;
}

function renderSections() {
  const list = $("#section-list");
  list.innerHTML = "";

  editing.sections.forEach((section, i) => {
    const card = document.createElement("div");
    card.className = "section-card";
    card.dataset.index = i;

    /* header row: index, live summary, reorder / duplicate / delete */
    const top = document.createElement("div");
    top.className = "section-card-top";
    const badge = document.createElement("span");
    badge.className = "section-index";
    badge.textContent = String(i + 1);
    const summary = document.createElement("span");
    summary.className = "section-summary";
    summary.textContent = sectionSummary(section);

    const mkIconBtn = (html, title, handler, extraClass = "") => {
      const b = document.createElement("button");
      b.className = `icon-btn ${extraClass}`;
      b.innerHTML = html;
      b.title = title;
      b.setAttribute("aria-label", title);
      b.addEventListener("click", handler);
      return b;
    };

    const up = mkIconBtn("&#8593;", "Move up", () => moveSection(i, -1));
    const down = mkIconBtn("&#8595;", "Move down", () => moveSection(i, 1));
    up.disabled = i === 0;
    down.disabled = i === editing.sections.length - 1;
    up.style.opacity = up.disabled ? 0.3 : "";
    down.style.opacity = down.disabled ? 0.3 : "";
    const dup = mkIconBtn("&#10697;", "Duplicate", () => {
      editing.sections.splice(i + 1, 0, { ...section });
      renderSections();
    });
    const del = mkIconBtn("&#10005;", "Remove section", () => {
      editing.sections.splice(i, 1);
      if (editing.sections.length === 0) editing.sections.push({ ...DEFAULT_SECTION });
      renderSections();
    }, "danger");

    top.append(badge, summary, up, down, dup, del);

    /* controls row */
    const controls = document.createElement("div");
    controls.className = "section-controls";

    const refresh = () => {
      summary.textContent = sectionSummary(section);
      updateEditorDuration();
    };

    controls.appendChild(
      numberField("Tempo", section.bpm, BPM_MIN, BPM_MAX, (v) => {
        section.bpm = v;
        refresh();
      })
    );

    const sig = document.createElement("div");
    sig.className = "sig-pair";
    const numField = numberField("Time sig", section.num, 1, 32, (v) => {
      section.num = v;
      refresh();
    });
    const slash = document.createElement("span");
    slash.className = "slash";
    slash.textContent = "/";
    const denField = document.createElement("div");
    denField.className = "field";
    const denLabel = document.createElement("label");
    denLabel.innerHTML = "&nbsp;";
    const denSelect = document.createElement("select");
    for (const d of [2, 4, 8, 16]) {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      if (d === section.den) opt.selected = true;
      denSelect.appendChild(opt);
    }
    denSelect.addEventListener("change", () => {
      section.den = parseInt(denSelect.value, 10);
      refresh();
    });
    denField.append(denLabel, denSelect);
    sig.append(numField, slash, denField);
    controls.appendChild(sig);

    controls.appendChild(
      numberField("Bars", section.measures, 1, 999, (v) => {
        section.measures = v;
        refresh();
      })
    );

    card.append(top, controls);
    list.appendChild(card);
  });

  updateEditorDuration();
}

function moveSection(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= editing.sections.length) return;
  const [section] = editing.sections.splice(index, 1);
  editing.sections.splice(target, 0, section);
  renderSections();
}

$("#add-section").addEventListener("click", () => {
  const last = editing.sections[editing.sections.length - 1];
  editing.sections.push({ ...(last || DEFAULT_SECTION) });
  renderSections();
});

/* Save + export */

$("#editor-save").addEventListener("click", () => {
  editing.name = $("#track-name").value.trim();
  if (!editing.name) {
    editing.name = "Untitled track";
    $("#track-name").value = editing.name;
  }
  saveTrack(editing);
  toast("Track saved");
});

$("#editor-export").addEventListener("click", () => {
  const name = $("#track-name").value.trim() || "Untitled track";
  downloadMidi({ ...editing, name });
  toast("MIDI exported");
});

/* Preview playback */

function togglePreview() {
  if (previewPlaying) {
    stopEverything();
    return;
  }
  const { beats, duration } = trackToBeats(editing.sections);
  if (!beats.length) return;

  previewPlaying = true;
  const playBtn = $("#editor-play");
  playBtn.classList.add("playing");
  $("#editor-play-label").textContent = "Stop";
  $("#editor-progress").classList.remove("hidden");

  engine.startSequence(
    beats,
    ({ sectionIndex }) => {
      $$(".section-card").forEach((card, i) =>
        card.classList.toggle("active-playing", i === sectionIndex)
      );
    },
    () => stopEverything()
  );

  const fill = $("#progress-fill");
  const label = $("#progress-label");
  const tick = () => {
    if (!previewPlaying) return;
    const elapsed = Math.min(duration, engine.sequenceElapsed());
    fill.style.width = `${(elapsed / duration) * 100}%`;
    label.textContent = `${formatDuration(elapsed)} / ${formatDuration(duration)}`;
    progressRaf = requestAnimationFrame(tick);
  };
  tick();
}

$("#editor-play").addEventListener("click", togglePreview);

/* ================= Init ================= */

updateSliderFill();
renderTrackList();

// Expose the MIDI builder for testing in the console.
window.__clicker = { trackToMidi, trackToBeats, trackDuration };
