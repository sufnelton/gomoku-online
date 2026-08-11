"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";

/* Animated background + looping music, shared by every screen.
 * Keeps its own state so it can live in the layout rather than being threaded
 * through the game component. The page reads --app-bg, which turns into a
 * translucent scrim while the scene is on so the UI stays readable. */

const VIDEO = "/bg/room.mp4";
const POSTER = "/bg/room-poster.jpg";
const MUSIC = "/audio/theme.m4a";

export default function SceneLayer() {
  const [sceneOn, setSceneOn] = useState(true);
  const [musicOn, setMusicOn] = useState(false);
  const [musicMissing, setMusicMissing] = useState(false);
  const [reduced, setReduced] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(m.matches);
    on();
    m.addEventListener ? m.addEventListener("change", on) : m.addListener(on);
    return () => (m.removeEventListener ? m.removeEventListener("change", on) : m.removeListener(on));
  }, []);

  useEffect(() => {
    const s = localStorage.getItem("gomoku_scene");
    if (s !== null) setSceneOn(s === "1");
  }, []);

  useEffect(() => {
    document.body.dataset.scene = sceneOn ? "on" : "off";
    localStorage.setItem("gomoku_scene", sceneOn ? "1" : "0");
  }, [sceneOn]);

  // Music only ever starts from a click: browsers block autoplay with sound,
  // and a game that makes noise on load without being asked is obnoxious.
  const toggleMusic = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (musicOn) { a.pause(); setMusicOn(false); return; }
    a.volume = 0.35;
    a.play().then(() => setMusicOn(true)).catch(() => setMusicMissing(true));
  }, [musicOn]);

  const btn = (active) => ({
    width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: 9, cursor: "pointer", fontSize: 15, lineHeight: 1,
    border: `1px solid ${active ? "#1AFF8C" : "#3a3530"}`,
    background: active ? "rgba(26,255,140,0.10)" : "rgba(38,35,32,0.82)",
    color: active ? "#1AFF8C" : "#9b948a", backdropFilter: "blur(6px)",
  });

  return (
    <>
      {sceneOn && (
        <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
          {reduced ? (
            <img src={POSTER} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <video
              src={VIDEO}
              poster={POSTER}
              autoPlay
              loop
              muted
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
        </div>
      )}

      <audio ref={audioRef} src={MUSIC} loop preload="none" onError={() => setMusicMissing(true)} />

      <div style={{ position: "fixed", top: 12, right: 12, zIndex: 20, display: "flex", gap: 8 }}>
        <button onClick={() => setSceneOn((v) => !v)} style={btn(sceneOn)}
          title={sceneOn ? "Hide background" : "Show background"}
          aria-label={sceneOn ? "Hide background" : "Show background"}>
          {sceneOn ? "🌿" : "▢"}
        </button>
        {!musicMissing && (
          <button onClick={toggleMusic} style={btn(musicOn)}
            title={musicOn ? "Mute music" : "Play music"}
            aria-label={musicOn ? "Mute music" : "Play music"}>
            {musicOn ? "♪" : "🔇"}
          </button>
        )}
      </div>
    </>
  );
}
