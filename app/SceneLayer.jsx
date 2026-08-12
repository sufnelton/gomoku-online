"use client";
import React, { useState, useEffect, useCallback } from "react";
import * as sfx from "./sfx.js";
import MusicPlayer from "./MusicPlayer.jsx";

/* Animated background + the sound controls, shared by every screen. Keeps its
 * own state so it can live in the layout rather than being threaded through the
 * game component. The page reads --app-bg, which turns into a translucent scrim
 * while the scene is on so the UI stays readable.
 *
 * Music itself lives in MusicPlayer: it went from one toggle to a player with
 * transport controls and two tracks, which is no longer this layer's business. */

const VIDEO = "/bg/room.mp4";
const POSTER = "/bg/room-poster.jpg";

export default function SceneLayer() {
  const [sceneOn, setSceneOn] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [sfxOn, setSfxOn] = useState(true);

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

  // Effects are separate from the music: the theme is a bed you opt into, the
  // move and result sounds are the game telling you what happened, so they
  // default on and get their own switch.
  useEffect(() => { setSfxOn(!sfx.loadMuted()); }, []);
  const toggleSfx = useCallback(() => {
    setSfxOn((on) => { sfx.setMuted(on); return !on; });
  }, []);

  const btn = (active) => ({
    width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: 12, cursor: "pointer", fontSize: 15, lineHeight: 1,
    borderColor: active ? "rgba(26,255,140,.6)" : undefined,
    background: active ? "rgba(26,255,140,0.16)" : undefined,
    color: active ? "#1AFF8C" : "#e7e2d8",
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

      <div style={{ position: "fixed", top: 12, right: 12, zIndex: 20, display: "flex", gap: 8 }}>
        <button className="glass glass-btn" onClick={() => setSceneOn((v) => !v)} style={btn(sceneOn)}
          title={sceneOn ? "Hide background" : "Show background"}
          aria-label={sceneOn ? "Hide background" : "Show background"}>
          {sceneOn ? "🌿" : "▢"}
        </button>
        <button className="glass glass-btn" onClick={toggleSfx} style={btn(sfxOn)}
          title={sfxOn ? "Mute sound effects" : "Unmute sound effects"}
          aria-label={sfxOn ? "Mute sound effects" : "Unmute sound effects"}>
          {sfxOn ? "🔔" : "🔕"}
        </button>
      </div>

      <MusicPlayer />
    </>
  );
}
