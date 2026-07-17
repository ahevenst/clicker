// Track persistence in localStorage.
//
// Track shape:
// { id, name, sections: [{ bpm, num, den, measures }], createdAt, updatedAt }

const STORAGE_KEY = "clicker.tracks.v1";

export function loadTracks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(tracks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tracks));
}

export function getTrack(id) {
  return loadTracks().find((t) => t.id === id) || null;
}

export function saveTrack(track) {
  const tracks = loadTracks();
  const now = Date.now();
  const index = tracks.findIndex((t) => t.id === track.id);
  if (index >= 0) {
    tracks[index] = { ...track, updatedAt: now };
  } else {
    tracks.unshift({ ...track, createdAt: now, updatedAt: now });
  }
  persist(tracks);
  return getTrack(track.id);
}

export function deleteTrack(id) {
  persist(loadTracks().filter((t) => t.id !== id));
}

export function newTrackId() {
  return (
    (crypto.randomUUID && crypto.randomUUID()) ||
    `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}
