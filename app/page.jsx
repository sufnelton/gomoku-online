"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";
import { SIZE, emptyBoard, findWin, other, applyMove, freshGameState, isForbidden, forbiddenPoints } from "../lib/gomoku.js";
import { chooseMove } from "../lib/ai.js";
import ChatPanel from "./ChatPanel.jsx";

const freshGame = () => freshGameState("black");

// Piece skins. "maple" swaps the stones for image pieces; if either file is
// missing the board falls back to classic stones rather than rendering blanks.
const SKINS = {
  classic: { id: "classic", name: "Classic", black: null, white: null },
  maple: { id: "maple", name: "Maple", black: "/pieces/slime.png", white: "/pieces/mushroom.png" },
};

/* One intersection. Memoised on primitives so a move re-renders the two cells
 * that actually changed instead of all 225 -- that whole-grid rebuild is what
 * made taps feel laggy on a phone. */
const Cell = React.memo(function Cell({ r, c, cell, isLast, isWin, isBanned, canClick, skinSrc, ghostColor, ghostSrc, onPick, onSkinError }) {
  const isStar = (r === 3 || r === 7 || r === 11) && (c === 3 || c === 7 || c === 11);
  return (
    <button onClick={() => onPick(r, c)}
      style={{ width: "100%", aspectRatio: "1 / 1", padding: 0, border: "none", background: "transparent", touchAction: "manipulation",
        cursor: canClick && !cell ? "pointer" : "default", position: "relative" }}
      aria-label={`row ${r + 1} column ${c + 1}`}>
      <span style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1, background: "#8a6f43", transform: "translateY(-50%)",
        clipPath: c === 0 ? "inset(0 0 0 50%)" : c === SIZE - 1 ? "inset(0 50% 0 0)" : "none" }} />
      <span style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "#8a6f43", transform: "translateX(-50%)",
        clipPath: r === 0 ? "inset(50% 0 0 0)" : r === SIZE - 1 ? "inset(0 0 50% 0)" : "none" }} />
      {isBanned && (
        <span aria-label="forbidden: double three" style={{
          position: "absolute", top: "50%", left: "50%", width: "47%", aspectRatio: "1 / 1", transform: "translate(-50%, -50%)",
          borderRadius: "50%", border: "1.5px solid rgba(196,58,42,.85)", background: "rgba(196,58,42,.14)", zIndex: 1,
        }}>
          <span style={{ position: "absolute", top: "50%", left: "50%", width: 12, height: 1.5, background: "rgba(196,58,42,.95)", transform: "translate(-50%,-50%) rotate(45deg)" }} />
          <span style={{ position: "absolute", top: "50%", left: "50%", width: 12, height: 1.5, background: "rgba(196,58,42,.95)", transform: "translate(-50%,-50%) rotate(-45deg)" }} />
        </span>
      )}
      {!cell && ghostColor && (
        <span style={{ position: "absolute", top: "50%", left: "50%", width: "112%", aspectRatio: "1 / 1", transform: "translate(-50%, -50%)",
          borderRadius: "50%", border: "2px solid #1AFF8C", boxShadow: "0 0 10px rgba(26,255,140,.55)", zIndex: 3 }} />
      )}
      {!cell && ghostColor && (ghostSrc ? (
        <img src={ghostSrc} alt="" aria-hidden="true" draggable={false}
          style={{ position: "absolute", top: "50%", left: "50%", width: "93%", aspectRatio: "1 / 1", transform: "translate(-50%, -50%)",
            objectFit: "contain", opacity: 0.6, zIndex: 2 }} />
      ) : (
        <span aria-hidden="true" style={{ position: "absolute", top: "50%", left: "50%", width: "80%", aspectRatio: "1 / 1", borderRadius: "50%",
          transform: "translate(-50%, -50%)", opacity: 0.6, zIndex: 2,
          background: ghostColor === "black" ? "radial-gradient(circle at 35% 30%, #4a443c, #15110d)" : "radial-gradient(circle at 35% 30%, #ffffff, #cfc7ba)" }} />
      ))}
      {isStar && !cell && !ghostColor && !isBanned && (
        <span style={{ position: "absolute", top: "50%", left: "50%", width: "20%", aspectRatio: "1 / 1", borderRadius: "50%", background: "#8a6f43", transform: "translate(-50%, -50%)" }} />
      )}
      {cell && (skinSrc ? (
        <img className="pc" src={skinSrc} alt={cell} draggable={false} onError={onSkinError}
          style={{
            position: "absolute", top: "50%", left: "50%", width: "93%", aspectRatio: "1 / 1", transform: "translate(-50%, -50%)",
            objectFit: "contain", zIndex: 2,
            filter: isWin ? "drop-shadow(0 0 4px #1AFF8C) drop-shadow(0 0 2px #1AFF8C)" : "drop-shadow(0 1px 2px rgba(0,0,0,.55))",
            outline: isLast && !isWin ? "2px solid #e0533a" : "none", outlineOffset: -1, borderRadius: 4,
          }} />
      ) : (
        <span className="pc" style={{
          position: "absolute", top: "50%", left: "50%", width: "80%", aspectRatio: "1 / 1", borderRadius: "50%", transform: "translate(-50%, -50%)",
          background: cell === "black" ? "radial-gradient(circle at 35% 30%, #4a443c, #15110d)" : "radial-gradient(circle at 35% 30%, #ffffff, #cfc7ba)",
          boxShadow: isWin ? "0 0 0 2px #1AFF8C, 0 0 8px #1AFF8C" : "0 1px 3px rgba(0,0,0,.5)",
          outline: isLast && !isWin ? "2px solid #e0533a" : "none", outlineOffset: -2, zIndex: 2,
        }} />
      ))}
    </button>
  );
});

function useIsWide(bp = 820) {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(`(min-width:${bp}px)`);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener ? m.addEventListener("change", on) : m.addListener(on);
    return () => (m.removeEventListener ? m.removeEventListener("change", on) : m.removeListener(on));
  }, [bp]);
  return wide;
}

async function postLobby(body) {
  const res = await fetch("/api/lobby", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "error");
  return data;
}

export default function GomokuAI() {
  const [screen, setScreen] = useState("lobby"); // lobby | waiting | game | leaderboard
  const [mode, setMode] = useState("ai");        // ai | local | online
  const level = 5; // only the strongest engine is offered
  const [humanColor, setHumanColor] = useState("black");
  const [g, setG] = useState(freshGame);
  const [thinking, setThinking] = useState(false);
  const [ruleNote, setRuleNote] = useState("");
  const [skinId, setSkinId] = useState("classic");
  const [skinBroken, setSkinBroken] = useState(false);
  const [pending, setPending] = useState(null); // touch: ghost stone awaiting confirmation
  const [coarse, setCoarse] = useState(false);

  // online
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [netError, setNetError] = useState("");
  const [copied, setCopied] = useState(false);
  const playerIdRef = useRef("");
  const versionRef = useRef(0);

  // leaderboard
  const [leaderboard, setLeaderboard] = useState([]);
  const [cpuBoard, setCpuBoard] = useState([]);
  const [pass, setPass] = useState("");
  const [lbLoading, setLbLoading] = useState(false);

  const wide = useIsWide();
  const aiColor = other(humanColor);
  const onlineColor = g.players
    ? (g.players.black === playerIdRef.current ? "black"
      : g.players.white === playerIdRef.current ? "white" : null)
    : null;
  const oppName = (g.names ? (onlineColor === "black" ? g.names.white : g.names.black) : null) || "Opponent";

  useEffect(() => { versionRef.current = g.version || 0; }, [g.version]);

  const api = useCallback((body) => postLobby({ ...body, playerId: playerIdRef.current }), []);

  const reconnect = useCallback(async (c) => {
    try {
      const res = await fetch(`/api/lobby?code=${c}`);
      if (!res.ok) { localStorage.removeItem("gomoku_code"); return; }
      const data = await res.json();
      const pid = playerIdRef.current;
      const color = data.state.players.black === pid ? "black"
        : data.state.players.white === pid ? "white" : null;
      if (!color) { localStorage.removeItem("gomoku_code"); return; }
      setMode("online"); setCode(c); setG(data.state);
      setScreen(data.state.players.white ? "game" : "waiting");
    } catch { /* offline; ignore */ }
  }, []);

  // identity + saved name + reconnect on first load
  useEffect(() => {
    let id = localStorage.getItem("gomoku_pid");
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("gomoku_pid", id);
    }
    playerIdRef.current = id;
    const savedName = localStorage.getItem("gomoku_name");
    if (savedName) setName(savedName);
    const savedCode = localStorage.getItem("gomoku_code");
    if (savedCode) reconnect(savedCode);
  }, [reconnect]);

  useEffect(() => { if (name) localStorage.setItem("gomoku_name", name); }, [name]);

  useEffect(() => {
    const saved = localStorage.getItem("gomoku_skin");
    if (saved && SKINS[saved]) setSkinId(saved);
  }, []);

  // Confirm-tap is about pointing precision, not screen size, so key it off
  // pointer type: a finger gets the ghost, a mouse keeps single-click.
  useEffect(() => {
    const m = window.matchMedia("(pointer: coarse)");
    const on = () => setCoarse(m.matches);
    on();
    m.addEventListener ? m.addEventListener("change", on) : m.addListener(on);
    return () => (m.removeEventListener ? m.removeEventListener("change", on) : m.removeListener(on));
  }, []);

  const chooseSkin = useCallback((id) => {
    setSkinId(id);
    setSkinBroken(false);
    localStorage.setItem("gomoku_skin", id);
  }, []);

  const skin = (skinBroken ? SKINS.classic : SKINS[skinId]) || SKINS.classic;

  // The engine runs in a worker so a long search never freezes the board. If
  // the worker can't start or dies, everything falls back to running it here.
  const workerRef = useRef(null);
  const reqRef = useRef(0);
  useEffect(() => {
    if (typeof Worker === "undefined") return;
    let w;
    try {
      w = new Worker(new URL("./ai.worker.js", import.meta.url), { type: "module" });
    } catch { return; }
    w.onerror = () => { workerRef.current = null; };
    workerRef.current = w;
    return () => { workerRef.current = null; w.terminate(); };
  }, []);

  // AI turn handler (vs-computer only)
  useEffect(() => {
    if (screen !== "game" || mode !== "ai" || g.winner) return;
    if (g.turn !== aiColor) return;
    let cancelled = false;
    setThinking(true);
    const board = g.board.map((row) => row.slice());
    const finish = (mv) => {
      if (cancelled) return;
      if (mv) setG((s) => applyMove(s, mv[0], mv[1]));
      setThinking(false);
    };

    const w = workerRef.current;
    if (w) {
      const id = ++reqRef.current;
      const onMsg = (e) => {
        if (!e.data || e.data.id !== id) return;
        w.removeEventListener("message", onMsg);
        finish(e.data.mv);
      };
      w.addEventListener("message", onMsg);
      const t = setTimeout(() => w.postMessage({ id, board, level, color: aiColor }), 140);
      // If the worker never answers, play it out on this thread rather than
      // leaving the game stuck on "thinking".
      const guard = setTimeout(() => {
        if (cancelled) return;
        w.removeEventListener("message", onMsg);
        finish(chooseMove(board, level, aiColor));
      }, 15000);
      return () => {
        cancelled = true; clearTimeout(t); clearTimeout(guard);
        w.removeEventListener("message", onMsg);
      };
    }

    const t = setTimeout(() => finish(chooseMove(board, level, aiColor)), 140);
    return () => { cancelled = true; clearTimeout(t); };
  }, [screen, mode, g, aiColor, level]);

  // online polling
  useEffect(() => {
    if (mode !== "online" || (screen !== "game" && screen !== "waiting")) return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/lobby?code=${code}&v=${versionRef.current}`);
        if (res.status === 204) return;
        if (res.status === 404) { if (active) setNetError("Lobby expired or not found"); return; }
        const data = await res.json();
        if (active && data.state) {
          setG(data.state);
          if (data.state.players.white) setScreen("game");
        }
      } catch { /* transient; retry next tick */ }
    };
    tick();
    const iv = setInterval(tick, 1200);
    return () => { active = false; clearInterval(iv); };
  }, [mode, screen, code]);

  const human = useCallback((r, c) => {
    if (g.winner || g.board[r][c]) return;
    if (mode === "ai" && (thinking || g.turn !== humanColor)) return;
    if (mode === "online" && (g.turn !== onlineColor || !g.players?.white)) return;
    if (isForbidden(g.board, r, c, g.turn)) {
      setRuleNote("Double three — two open threes at once, and it isn't stopping a five.");
      return;
    }
    setRuleNote("");
    if (mode === "online") {
      api({ action: "move", code, r, c })
        .then((d) => d && setG(d.state))
        .catch((e) => { if (e.message === "forbidden") setRuleNote("Double three — not allowed."); });
      return;
    }
    setG((s) => applyMove(s, r, c));
  }, [thinking, g, mode, humanColor, onlineColor, code, api]);

  /* Touch aiming, iOS cursor-drag style. Press anywhere on the board and a
   * ghost appears with a preview floating ABOVE your finger -- the finger is
   * wider than a cell, so a preview under it would be invisible. Slide to
   * adjust, lift to place. Nothing commits until you let go. */
  const gridRef = useRef(null);
  const pendingRef = useRef(null);
  const canClickRef = useRef(false);
  const setGhost = useCallback((p) => { pendingRef.current = p; setPending(p); }, []);

  // How far above the fingertip the target sits, in cells. Expressed in cells
  // rather than pixels so it holds at any board size: the board is fluid, so a
  // fixed pixel lift would be a whole row on a phone and half of one on a
  // desktop.
  const AIM_LIFT_CELLS = 2.4;

  const cellFromTouch = useCallback((t) => {
    const el = gridRef.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const cell = box.height / SIZE;
    // A thumb is wider than a cell and sits on top of what it is aiming at, so
    // the target is lifted clear of it.
    const y = t.clientY - cell * AIM_LIFT_CELLS;
    const rawC = ((t.clientX - box.left) / box.width) * SIZE;
    const rawR = ((y - box.top) / box.height) * SIZE;
    // Slop lets you aim the top rows with the thumb below the board edge, but
    // wandering well off the board still cancels rather than snapping.
    if (rawR < -2 || rawR > SIZE + 2 || rawC < -2 || rawC > SIZE + 2) return null;
    const clamp = (v) => Math.max(0, Math.min(SIZE - 1, Math.floor(v)));
    return { r: clamp(rawR), c: clamp(rawC) };
  }, []);

  const aim = useCallback((e) => {
    const p = cellFromTouch(e.touches[0]);
    setGhost(p && canClickRef.current && !g.board[p.r][p.c] ? p : null);
  }, [cellFromTouch, g.board, setGhost]);

  const release = useCallback(() => {
    const p = pendingRef.current;
    setGhost(null);
    if (p) humanRef.current(p.r, p.c);
  }, [setGhost]);

  /* React registers touchstart/touchmove as PASSIVE listeners, so calling
   * preventDefault inside onTouchMove is silently ignored -- which is why the
   * page still rubber-banded while aiming. These are attached natively with
   * passive:false so the drag belongs to the board and not to the scroller. */
  const aimRef = useRef(aim);
  const releaseRef = useRef(release);
  useEffect(() => { aimRef.current = aim; releaseRef.current = release; });

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const stop = (e) => { if (e.cancelable) e.preventDefault(); };
    const onStart = (e) => { aimRef.current(e); stop(e); };
    const onMove = (e) => { aimRef.current(e); stop(e); };
    const onEnd = (e) => { releaseRef.current(); stop(e); };
    const onCancel = () => setGhost(null);
    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", onCancel);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, [screen, mode, setGhost]);

  // Which side's forbidden points to mark: only ever the one a human here can play.
  const markColor = g.winner ? null
    : mode === "local" ? g.turn
    : mode === "ai" ? (g.turn === humanColor && !thinking ? humanColor : null)
    : (g.turn === onlineColor && g.players?.white ? onlineColor : null);

  // Scanning the board for forbidden points is the most expensive thing per
  // move. Run it after the frame that paints the stone, so placing never waits
  // on it; the marks appear a frame later.
  const [forbidSet, setForbidSet] = useState(null);
  useEffect(() => {
    if (!markColor) { setForbidSet(null); return; }
    const id = requestAnimationFrame(() => {
      const s = new Set();
      for (const [r, c] of forbiddenPoints(g.board, markColor)) s.add(`${r},${c}`);
      setForbidSet(s);
    });
    return () => cancelAnimationFrame(id);
  }, [g.board, markColor]);

  // Stable identities so the memoised cells are not invalidated every render.
  const humanRef = useRef(human);
  useEffect(() => { humanRef.current = human; });
  const onPick = useCallback((r, c) => humanRef.current(r, c), []);
  const onSkinError = useCallback(() => setSkinBroken(true), []);

  useEffect(() => { setRuleNote(""); setPending(null); }, [g.history.length, screen, mode]);

  // Beating the computer on level 5 is the only computer result worth a board.
  const reportedRef = useRef(false);
  useEffect(() => { reportedRef.current = false; }, [g.history.length === 0]);
  useEffect(() => {
    if (mode !== "ai" || level !== 5 || g.winner !== humanColor) return;
    if (reportedRef.current || !name.trim()) return;
    reportedRef.current = true;
    fetch("/api/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, level: 5 }),
    }).catch(() => {});
  }, [g.winner, mode, level, humanColor, name]);

  const start = (m) => { setMode(m); setG(freshGame()); setThinking(false); setScreen("game"); setRuleNote(""); };

  const undo = useCallback(() => {
    if (thinking || mode === "online") return;
    setG((s) => {
      let h = [...s.history];
      if (mode === "ai") { while (h.length && h[h.length - 1].color === aiColor) h.pop(); if (h.length && h[h.length - 1].color === humanColor) h.pop(); }
      else h.pop();
      const board = emptyBoard(); h.forEach(({ r, c, color }) => (board[r][c] = color));
      return { ...freshGameState("black"), board, history: h, turn: h.length % 2 === 0 ? "black" : "white" };
    });
  }, [thinking, mode, aiColor, humanColor]);

  const rematch = () => { setG(freshGame()); setThinking(false); };
  const swapSides = () => { setHumanColor((c) => other(c)); setG(freshGame()); setThinking(false); };

  // online actions
  const createOnline = async () => {
    setNetError("");
    try {
      const data = await api({ action: "create", name, pass });
      setMode("online"); setCode(data.code); setG(data.state);
      localStorage.setItem("gomoku_code", data.code);
      setScreen("waiting");
    } catch { setNetError("Could not create a game. Try again."); }
  };

  const joinOnline = async () => {
    const c = joinInput.trim().toUpperCase();
    if (c.length < 4) { setNetError("Enter the 4-letter code"); return; }
    setNetError("");
    try {
      const data = await api({ action: "join", code: c, name, pass });
      setMode("online"); setCode(c); setG(data.state);
      localStorage.setItem("gomoku_code", c);
      setScreen(data.state.players.white ? "game" : "waiting");
    } catch (e) {
      setNetError(
        e.message === "full" ? "That game already has two players"
        : e.message === "not_found" ? "No game with that code"
        : "Could not join. Try again."
      );
    }
  };

  const leaveOnline = () => {
    localStorage.removeItem("gomoku_code");
    setCode(""); setJoinInput(""); setNetError(""); setMode("ai");
    setG(freshGame()); setScreen("lobby");
  };

  const resignOnline = () => api({ action: "resign", code }).then((d) => d && setG(d.state)).catch(() => {});
  const rematchOnline = () => api({ action: "rematch", code }).then((d) => d && setG(d.state)).catch(() => {});
  const sendChat = (text) => api({ action: "chat", code, text }).then((d) => d && setG(d.state)).catch(() => {});

  const openLeaderboard = async () => {
    setScreen("leaderboard"); setLbLoading(true);
    try {
      const res = await fetch("/api/leaderboard?top=20");
      const d = await res.json();
      setLeaderboard(d.leaderboard || []);
      setCpuBoard(d.cpu || []);
    } catch { setLeaderboard([]); setCpuBoard([]); }
    finally { setLbLoading(false); }
  };

  const copyCode = () => {
    navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  // ---------- LOBBY ----------
  if (screen === "lobby") {
    return (
      <div style={wrap}>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 4px" }}>Gomoku</h1>
        <p style={{ fontSize: 13, color: "#b5aea2", margin: "0 0 26px" }}>Five in a row</p>

        <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <div style={label}>Your name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 16))}
              placeholder="Your name"
              maxLength={16}
              className="glass" style={{ width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 12, color: "#f2ede4", fontSize: 15, fontWeight: 600, outline: "none" }}
            />
          </div>

          <div>
            <div style={label}>Play online</div>
            <input
              value={pass}
              onChange={(e) => setPass(e.target.value.slice(0, 32))}
              placeholder="Passphrase (optional) — keeps strangers out"
              className="glass" style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 12, color: "#f2ede4", fontSize: 14, marginBottom: 8, outline: "none" }}
            />
            <button onClick={createOnline} className="glass glass-btn glass-accent" style={primaryBtn}>Create game · get a code</button>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value.toUpperCase().slice(0, 4))}
                onKeyDown={(e) => e.key === "Enter" && joinOnline()}
                placeholder="CODE"
                maxLength={4}
                className="glass" style={{ flex: 1, padding: "10px 12px", borderRadius: 12, color: "#f2ede4", fontSize: 15, letterSpacing: "0.2em", textAlign: "center", fontWeight: 700, outline: "none" }}
              />
              <button onClick={joinOnline} className="glass glass-btn" style={{ ...secondaryBtn, padding: "10px 18px", fontSize: 14 }}>Join</button>
            </div>
            {netError && <div style={{ color: "#e0533a", fontSize: 12, marginTop: 8 }}>{netError}</div>}
          </div>

          <div>
            <div style={label}>Pieces</div>
            <div style={{ display: "flex", gap: 8 }}>
              {Object.values(SKINS).map((s) => (
                <button key={s.id} className="glass glass-btn" onClick={() => chooseSkin(s.id)}
                  style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    padding: "10px 12px", borderRadius: 9, cursor: "pointer",
                    borderColor: skinId === s.id ? "rgba(26,255,140,.6)" : undefined,
                    background: skinId === s.id ? "rgba(26,255,140,0.13)" : undefined,
                    color: skinId === s.id ? "#1AFF8C" : "#b5aea2", fontSize: 13, fontWeight: 600,
                  }}>
                  <span style={{ display: "flex", gap: 3 }}>
                    {["black", "white"].map((col) => s[col] ? (
                      <img key={col} src={s[col]} alt="" onError={() => setSkinBroken(true)}
                        style={{ width: 18, height: 18, objectFit: "contain" }} />
                    ) : (
                      <span key={col} style={{
                        width: 16, height: 16, borderRadius: "50%",
                        background: col === "black" ? "#15110d" : "#f2ede4", border: "1px solid #9c9488",
                      }} />
                    ))}
                  </span>
                  {s.name}
                </button>
              ))}
            </div>
            {skinBroken && <div style={{ color: "#e0533a", fontSize: 12, marginTop: 8 }}>Maple pieces missing — using classic stones.</div>}
          </div>

          <button onClick={openLeaderboard} className="glass glass-btn" style={secondaryBtn}>🏆 Leaderboard</button>

          <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#8d8579", fontSize: 12 }}>
            <div style={{ flex: 1, height: 1, background: "#3a3530" }} /> OR <div style={{ flex: 1, height: 1, background: "#3a3530" }} />
          </div>

          <div>
            <div style={label}>You play</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[["black", "Black (first)"], ["white", "White (second)"]].map(([c, t]) => (
                <button key={c} className="glass glass-btn" onClick={() => setHumanColor(c)}
                  style={{ flex: 1, padding: "10px", borderRadius: 12, cursor: "pointer", fontSize: 13, fontWeight: 600,
                    borderColor: humanColor === c ? "rgba(26,255,140,.6)" : undefined,
                    background: humanColor === c ? "rgba(26,255,140,0.08)" : "#262320", color: "#f2ede4" }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <button onClick={() => start("ai")} className="glass glass-btn" style={secondaryBtn}>Play vs Computer</button>
          <button onClick={() => start("local")} className="glass glass-btn" style={secondaryBtn}>Two players (same device)</button>
        </div>
      </div>
    );
  }

  // ---------- LEADERBOARD ----------
  if (screen === "leaderboard") {
    return (
      <div style={wrap}>
        <div style={{ width: "100%", maxWidth: 440, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <button onClick={() => setScreen("lobby")} className="glass glass-btn" style={ghostBtn}>← Menu</button>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>🏆 Leaderboard</h1>
          <div style={{ width: 52 }} />
        </div>
        <div style={{ width: "100%", maxWidth: 440 }}>
          {lbLoading ? (
            <div style={{ color: "#b5aea2", fontSize: 14, textAlign: "center", padding: 30 }}>Loading…</div>
          ) : leaderboard.length === 0 ? (
            <div style={{ color: "#b5aea2", fontSize: 14, textAlign: "center", padding: 30 }}>
              No games yet — play someone online to get on the board.
            </div>
          ) : (
            <div className="glass" style={{ borderRadius: 14, overflow: "hidden" }}>
              <div style={{ display: "flex", padding: "10px 14px", background: "rgba(255,255,255,.06)", fontSize: 11, color: "#b5aea2", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                <span style={{ width: 32 }}>#</span>
                <span style={{ flex: 1 }}>Player</span>
                <span style={{ width: 44, textAlign: "right" }}>W</span>
                <span style={{ width: 44, textAlign: "right" }}>L</span>
                <span style={{ width: 56, textAlign: "right" }}>Win%</span>
              </div>
              {leaderboard.map((p, i) => (
                <div key={p.name + i} style={{ display: "flex", alignItems: "center", padding: "11px 14px", borderTop: "1px solid #2a2723", fontSize: 14, color: "#f2ede4" }}>
                  <span style={{ width: 32, fontWeight: 700, color: i === 0 ? "#1AFF8C" : "#9c9488" }}>{i + 1}</span>
                  <span style={{ flex: 1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span style={{ width: 44, textAlign: "right", color: "#1AFF8C", fontWeight: 700 }}>{p.wins}</span>
                  <span style={{ width: 44, textAlign: "right", color: "#b5aea2" }}>{p.losses}</span>
                  <span style={{ width: 56, textAlign: "right", color: "#b5aea2" }}>{p.winRate}%</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ ...label, marginTop: 26 }}>Beat the computer</div>
          {cpuBoard.length === 0 ? (
            <div className="glass" style={{ color: "#c9c3b8", fontSize: 13, textAlign: "center", padding: 20, borderRadius: 14 }}>
              Nobody has beaten the computer yet.
            </div>
          ) : (
            <div className="glass" style={{ borderRadius: 14, overflow: "hidden" }}>
              {cpuBoard.map((p, i) => (
                <div key={p.name + i} style={{ display: "flex", alignItems: "center", padding: "11px 14px", borderTop: i ? "1px solid #2a2723" : "none", fontSize: 14, color: "#f2ede4" }}>
                  <span style={{ width: 32, fontWeight: 700, color: i === 0 ? "#1AFF8C" : "#9c9488" }}>{i + 1}</span>
                  <span style={{ flex: 1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span style={{ width: 44, textAlign: "right", color: "#1AFF8C", fontWeight: 700 }}>{p.wins}</span>
                </div>
              ))}
            </div>
          )}
          <p style={{ fontSize: 11, color: "#8d8579", marginTop: 14, textAlign: "center" }}>
            Ranked by wins. Names aren't verified — friendly bragging rights only.
            Level 5 wins are self-reported by the browser, so they're the loosest of all.
          </p>
        </div>
      </div>
    );
  }

  // ---------- WAITING (online, no opponent yet) ----------
  if (screen === "waiting") {
    return (
      <div style={wrap}>
        <button onClick={leaveOnline} className="glass glass-btn" style={{ ...ghostBtn, alignSelf: "flex-start" }}>← Cancel</button>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 }}>
          <div style={label}>Share this code</div>
          <button onClick={copyCode} style={{ fontSize: 48, fontWeight: 800, letterSpacing: "0.15em", color: "#1AFF8C", background: "transparent", border: "none", cursor: "pointer" }}>
            {code}
          </button>
          <div style={{ fontSize: 13, color: "#b5aea2" }}>{copied ? "Copied!" : "Tap the code to copy"}</div>
          <div style={{ fontSize: 14, color: "#f2ede4", marginTop: 10 }}>Waiting for your opponent to join…</div>
          {netError && <div style={{ color: "#e0533a", fontSize: 12 }}>{netError}</div>}
        </div>
      </div>
    );
  }

  // ---------- GAME ----------
  const lastMove = g.history[g.history.length - 1] || null;
  const winSet = new Set(g.winLine.map(([r, c]) => `${r},${c}`));
  let status;
  if (mode === "online") {
    if (!g.players?.white) status = "Waiting for opponent…";
    else if (g.winner === "draw") status = "Draw — board full";
    else if (g.winner) status = g.endReason === "resign"
      ? (g.winner === onlineColor ? `${oppName} resigned — you win!` : "You resigned")
      : (g.winner === onlineColor ? "You win!" : `${oppName} wins`);
    else status = g.turn === onlineColor ? "Your move" : `${oppName}'s move`;
  } else if (g.winner === "draw") status = "Draw — board full";
  else if (g.winner) status = mode === "ai" ? (g.winner === humanColor ? "You win!" : "Computer wins") : `${g.winner === "black" ? "Black" : "White"} wins!`;
  else if (thinking) status = "Computer thinking…";
  else if (mode === "ai") status = g.turn === humanColor ? "Your move" : "Computer's move";
  else status = `${g.turn === "black" ? "Black" : "White"} to move`;

  const canClick = !g.winner && (
    mode === "local" ? true
    : mode === "ai" ? (!thinking && g.turn === humanColor)
    : (g.turn === onlineColor && !!g.players?.white)
  );
  canClickRef.current = canClick;

  const rec = g.record || { black: 0, white: 0, draws: 0 };
  const myWins = onlineColor === "black" ? rec.black : rec.white;
  const oppWins = onlineColor === "black" ? rec.white : rec.black;

  const boardEl = (
    <div style={{ background: "#d8b878", padding: "min(14px, 3%)", borderRadius: 8, boxShadow: "0 8px 30px rgba(0,0,0,.5)", opacity: thinking ? 0.85 : 1,
      width: "min(478px, 100%)", boxSizing: "border-box", margin: "0 auto" }}>
      <div ref={gridRef} className="noselect"
        style={{ display: "grid", gridTemplateColumns: `repeat(${SIZE}, 1fr)`, position: "relative",
          touchAction: coarse ? "none" : "manipulation" }}>
        {g.board.map((row, r) =>
          row.map((cell, c) => {
            const key = `${r},${c}`;
            return (
              <Cell key={key} r={r} c={c} cell={cell}
                isLast={!!lastMove && lastMove.r === r && lastMove.c === c}
                isWin={winSet.has(key)}
                isBanned={!cell && !!forbidSet?.has(key)}
                canClick={canClick}
                skinSrc={cell ? skin[cell] : null}
                ghostColor={pending && pending.r === r && pending.c === c ? g.turn : null}
                ghostSrc={pending && pending.r === r && pending.c === c ? skin[g.turn] : null}
                onPick={onPick}
                onSkinError={onSkinError}
              />
            );
          })
        )}
      </div>
    </div>
  );


  return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", maxWidth: 472, marginBottom: 14 }}>
        <button onClick={mode === "online" ? leaveOnline : () => setScreen("lobby")} className="glass glass-btn" style={ghostBtn}>← Menu</button>
        <div style={{ fontSize: 12, color: "#b5aea2" }}>
          {mode === "ai" ? <>You: <b style={{ color: "#f2ede4" }}>{humanColor === "black" ? "Black" : "White"}</b> · <b style={{ color: "#1AFF8C" }}>Expert</b></>
            : mode === "online" ? <>Code <b style={{ color: "#1AFF8C", letterSpacing: "0.1em" }}>{code}</b> · You: <b style={{ color: "#f2ede4" }}>{onlineColor === "black" ? "Black" : "White"}</b></>
            : "Two players"}
        </div>
        <div style={{ width: 52 }} />
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderRadius: 999,
        marginBottom: 8, minWidth: 200, justifyContent: "center",
        borderColor: g.winner ? "rgba(26,255,140,.55)" : undefined,
      }} className="glass">
        {!g.winner && (skin[g.turn] ? (
          <img src={skin[g.turn]} alt="" onError={() => setSkinBroken(true)}
            style={{ width: 20, height: 20, objectFit: "contain" }} />
        ) : (
          <span style={{ width: 16, height: 16, borderRadius: "50%", background: g.turn === "black" ? "#15110d" : "#f2ede4", border: "1px solid #9c9488" }} />
        ))}
        <span style={{ fontWeight: 600, fontSize: 15, color: g.winner ? "#1AFF8C" : "#f2ede4" }}>{status}</span>
      </div>

      <div style={{ fontSize: 12, marginBottom: 12, maxWidth: 340, textAlign: "center", lineHeight: 1.45,
        minHeight: "2.9em", display: "flex", alignItems: "center", justifyContent: "center",
        color: ruleNote ? "#ff9d8a" : pending ? "#1AFF8C" : "#a49d92" }}>
        {ruleNote || (pending ? "Aiming above your thumb — slide, then lift to place." : "No double three, unless it blocks a five — ✕ marks a point you can't take.")}
      </div>

      {mode === "online" && g.players?.white && (
        <div style={{ fontSize: 12, color: "#b5aea2", marginBottom: 14 }}>
          You <b style={{ color: "#f2ede4" }}>{myWins}</b> – <b style={{ color: "#f2ede4" }}>{oppWins}</b> {oppName}
          {rec.draws ? <span style={{ color: "#9c9488" }}> · {rec.draws} draw{rec.draws > 1 ? "s" : ""}</span> : null}
        </div>
      )}

      <div style={{
        display: "flex", flexDirection: wide ? "row" : "column", gap: 16,
        alignItems: wide ? "flex-start" : "center", justifyContent: "center", width: "100%",
      }}>
        {boardEl}
        {mode === "online" && (
          <ChatPanel
            messages={g.chat || []}
            myColor={onlineColor}
            names={g.names}
            onSend={sendChat}
            disabled={!g.players?.white}
            height={wide ? 478 : 240}
          />
        )}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 22 }}>
        {mode === "online" ? (
          g.winner ? (
            <button onClick={rematchOnline} className="glass glass-btn glass-accent" style={primaryBtnSm}>Rematch</button>
          ) : (
            <button onClick={resignOnline} disabled={!g.players?.white}
              className="glass glass-btn" style={{ ...secondaryBtn, width: "auto", padding: "10px 20px", fontSize: 14, opacity: g.players?.white ? 1 : 0.5 }}>
              Resign
            </button>
          )
        ) : g.winner ? (
          // A finished game is still worth learning from: take the last move
          // back and keep playing rather than only being offered a reset.
          <>
            <button onClick={undo} disabled={thinking}
              className="glass glass-btn" style={{ ...secondaryBtn, width: "auto", padding: "10px 20px", fontSize: 14, opacity: thinking ? 0.5 : 1 }}>
              Undo
            </button>
            <button onClick={rematch} className="glass glass-btn glass-accent" style={primaryBtnSm}>New game</button>
          </>
        ) : (
          <button onClick={undo} disabled={g.history.length === 0 || thinking}
            className="glass glass-btn" style={{ ...secondaryBtn, width: "auto", padding: "10px 20px", fontSize: 14, opacity: g.history.length === 0 || thinking ? 0.5 : 1 }}>
            Undo
          </button>
        )}
        {mode === "ai" && (g.winner || g.history.length === 0) && (
          <button onClick={swapSides} className="glass glass-btn" style={{ ...secondaryBtn, width: "auto", padding: "10px 20px", fontSize: 14 }}>
            Swap sides
          </button>
        )}
      </div>

      <p style={{ fontSize: 12, color: "#8d8579", marginTop: 18, maxWidth: 360, textAlign: "center" }}>
        Move {g.history.length} · Five or more wins · No double three · Black moves first
      </p>
    </div>
  );
}

const wrap = { minHeight: "100vh", background: "var(--app-bg, #1a1816)", color: "#f2ede4", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 16px", boxSizing: "border-box", position: "relative", zIndex: 1 };
const label = { fontSize: 11, color: "#b5aea2", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 };
const primaryBtn = { width: "100%", padding: "14px 20px", borderRadius: 14, color: "#0d1a12", fontSize: 16, fontWeight: 700, cursor: "pointer" };
const primaryBtnSm = { ...primaryBtn, width: "auto", padding: "10px 20px", fontSize: 14 };
const secondaryBtn = { width: "100%", padding: "12px 20px", borderRadius: 14, color: "#f2ede4", fontSize: 15, fontWeight: 600, cursor: "pointer" };
const ghostBtn = { padding: "8px 12px", borderRadius: 11, color: "#e7e2d8", fontSize: 13, fontWeight: 600, cursor: "pointer" };
