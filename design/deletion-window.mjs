export const UNDO_WINDOW = 5000;

// Advance only eligible time. Each deletion keeps its own window.
export function advanceDeletions(entries, delta, paused = false) {
  if (paused) return [];
  const expired = [];
  for (const entry of entries) entry.remaining = Math.max(0, entry.remaining - Math.max(0, delta));
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].remaining === 0) expired.unshift(...entries.splice(i, 1));
  }
  return expired;
}

export function countdown(remaining) {
  return { seconds: Math.ceil(Math.max(0, remaining) / 1000), fraction: Math.min(1, Math.max(0, remaining / UNDO_WINDOW)) };
}
