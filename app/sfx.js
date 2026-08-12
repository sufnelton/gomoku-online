"use client";

/* One-shot sound effects, kept apart from the looping theme in SceneLayer.
 * The theme needs a click before it can start because browsers block autoplay
 * with sound; effects never fire before one, so they default on.
 *
 * Module state rather than React state: page.jsx fires the sounds and
 * SceneLayer owns the mute button, and threading a provider through the tree
 * to move one boolean costs more than it buys. */

const KEY = "gomoku_sfx_muted";

const SRC = {
  start: "/audio/start.mp3",
  black: "/audio/move-black.mp3",
  white: "/audio/move-white.mp3",
  win: "/audio/win.mp3",
  lose: "/audio/lose.mp3",
};

// The clips are within a few dB of each other, so these are about role, not
// levelling: a move fires every turn and should sit under a result, and both
// sit above the 0.35 theme bed rather than fighting it.
const VOLUME = { start: 0.6, black: 0.45, white: 0.45, win: 0.7, lose: 0.7 };

let muted = false;
let els = null;

// Built on first use, not at import: the module is pulled in during SSR where
// Audio does not exist, and 20KB of clips shouldn't load before a screen that
// might never make a sound.
function pool() {
  if (els || typeof Audio === "undefined") return els;
  els = {};
  for (const [name, src] of Object.entries(SRC)) {
    const a = new Audio(src);
    a.preload = "auto";
    a.volume = VOLUME[name];
    els[name] = a;
  }
  return els;
}

export function play(name) {
  if (muted) return;
  const a = pool()?.[name];
  if (!a) return;
  // Re-firing before the last one ends is normal — two players tapping fast, or
  // a rematch straight off a win. Rewinding beats stacking clones, and a
  // missing file just resolves to a rejected play() rather than breaking a move.
  try { a.currentTime = 0; } catch { /* not seekable yet */ }
  a.play().catch(() => {});
}

export function isMuted() {
  return muted;
}

export function setMuted(v) {
  muted = v;
  if (v) for (const a of Object.values(pool() || {})) a.pause();
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private mode */ }
}

// Called once on mount so the module picks up the saved choice before the first
// sound can fire.
export function loadMuted() {
  try { muted = localStorage.getItem(KEY) === "1"; } catch { /* private mode */ }
  return muted;
}
