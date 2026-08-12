"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";

/* The music player. Two long mixes rather than one, picked at random on load
 * and switchable, so neither the track nor the point you drop into it is the
 * same twice.
 *
 * Owns the audio element outright: SceneLayer used to, back when music was a
 * single corner button, and a player with transport controls is no longer
 * something the background layer should be reasoning about. */

const TRACKS = [
  { id: "lofi", name: "Lofi", src: "/audio/theme.m4a" },
  { id: "ost", name: "2006 OST", src: "/audio/ost.m4a" },
];

const VOLUME = 0.35;

// Drop in at a random point of a very long mix rather than the same opening
// bars every visit. Duration is unknown until metadata arrives, which with
// preload="none" only happens once a load is under way.
function seekRandom(a) {
  const jump = () => {
    if (a.duration && isFinite(a.duration)) a.currentTime = Math.random() * a.duration * 0.97;
  };
  if (a.readyState >= 1) jump();
  else a.addEventListener("loadedmetadata", jump, { once: true });
}

export default function MusicPlayer() {
  // null until mount: picking on the server would hand the client different
  // markup than it rendered.
  const [i, setI] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [broken, setBroken] = useState(() => new Set());
  const audioRef = useRef(null);

  useEffect(() => { setI(Math.floor(Math.random() * TRACKS.length)); }, []);

  // src is set imperatively rather than as a prop so the load, the seek and the
  // play stay in one ordered place instead of racing a re-render.
  const startTrack = useCallback((idx) => {
    const a = audioRef.current;
    if (!a) return;
    a.src = TRACKS[idx].src;
    a.volume = VOLUME;
    seekRandom(a);
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, []);

  // Music only ever starts from a click: browsers block autoplay with sound,
  // and a game that makes noise on load without being asked is obnoxious.
  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || i == null) return;
    if (playing) { a.pause(); setPlaying(false); return; }
    // Resuming keeps your place; only a first play or a switch re-rolls it.
    if (a.src) { a.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); return; }
    startTrack(i);
  }, [playing, i, startTrack]);

  const skip = useCallback(() => {
    if (i == null) return;
    const next = (i + 1) % TRACKS.length;
    setI(next);
    startTrack(next);
  }, [i, startTrack]);

  // Read through a ref rather than a setI updater: the error fires from the
  // media element, outside any render, and an updater is no place for a side effect.
  const iRef = useRef(null);
  useEffect(() => { iRef.current = i; }, [i]);
  const onError = useCallback(() => {
    setPlaying(false);
    const cur = iRef.current;
    if (cur != null) setBroken((s) => new Set(s).add(TRACKS[cur].id));
  }, []);

  // Nothing to offer if both files are missing.
  if (i == null || broken.size >= TRACKS.length) {
    return <audio ref={audioRef} loop preload="none" onError={onError} />;
  }

  const track = TRACKS[i];
  const dead = broken.has(track.id);

  return (
    <>
      <audio ref={audioRef} loop preload="none" onError={onError} />
      <div className="glass player">
        <span className="eq" data-on={playing ? "1" : "0"} aria-hidden="true"><i /><i /><i /></span>
        <span className="player-name">{dead ? "Unavailable" : track.name}</span>
        <button className="player-btn" onClick={toggle} disabled={dead}
          title={playing ? "Pause music" : "Play music"}
          aria-label={playing ? "Pause music" : "Play music"}>
          {playing ? (
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
              <rect x="3" y="2.5" width="3.6" height="11" rx="1.2" />
              <rect x="9.4" y="2.5" width="3.6" height="11" rx="1.2" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
              <path d="M4.4 2.9c0-.9 1-1.5 1.8-1L13 6.1c.7.5.7 1.4 0 1.8l-6.8 4.2c-.8.5-1.8-.1-1.8-1V2.9Z" />
            </svg>
          )}
        </button>
        <button className="player-btn" onClick={skip}
          title={`Switch to ${TRACKS[(i + 1) % TRACKS.length].name}`}
          aria-label={`Switch to ${TRACKS[(i + 1) % TRACKS.length].name}`}>
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
            <path d="M3 3.6c0-.8.9-1.3 1.6-.9l6 4.4c.6.4.6 1.3 0 1.7l-6 4.4c-.7.5-1.6 0-1.6-.8V3.6Z" />
            <rect x="11.6" y="2.6" width="2.4" height="10.8" rx="1.2" />
          </svg>
        </button>
      </div>
    </>
  );
}
