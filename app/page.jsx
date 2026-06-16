"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";
import { SIZE, emptyBoard, findWin, other, applyMove, freshGameState } from "../lib/gomoku.js";
import { chooseMove, LEVELS } from "../lib/ai.js";
import ChatPanel from "./ChatPanel.jsx";

const freshGame = () => freshGameState("black");

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
  const [level, setLevel] = useState(3);
  const [humanColor, setHumanColor] = useState("black");
  const [g, setG] = useState(freshGame);
  const [thinking, setThinking] = useState(false);

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

  // AI turn handler (vs-computer only)
  useEffect(() => {
    if (screen !== "game" || mode !== "ai" || g.winner) return;
    if (g.turn !== aiColor) return;
    let cancelled = false;
    setThinking(true);
    const t = setTimeout(() => {
      const boardCopy = g.board.map((row) => row.slice());
      const mv = chooseMove(boardCopy, level, aiColor);
      if (!cancelled) { if (mv) setG((s) => applyMove(s, mv[0], mv[1])); setThinking(false); }
    }, 140);
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
    if (mode === "ai") { if (thinking || g.turn !== humanColor) return; setG((s) => applyMove(s, r, c)); return; }
    if (mode === "local") { setG((s) => applyMove(s, r, c)); return; }
    if (mode === "online") {
      if (g.turn !== onlineColor || !g.players?.white) return;
      api({ action: "move", code, r, c }).then((d) => d && setG(d.state)).catch(() => {});
    }
  }, [thinking, g, mode, humanColor, onlineColor, code, api]);

  const start = (m) => { setMode(m); setG(freshGame()); setThinking(false); setScreen("game"); };

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
      const data = await api({ action: "create", name });
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
      const data = await api({ action: "join", code: c, name });
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
    } catch { setLeaderboard([]); }
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
        <p style={{ fontSize: 13, color: "#9b948a", margin: "0 0 26px" }}>Five in a row</p>

        <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <div style={label}>Your name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 16))}
              placeholder="Your name"
              maxLength={16}
              style={{ width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 9, border: "1px solid #3a3530", background: "#262320", color: "#f2ede4", fontSize: 15, fontWeight: 600 }}
            />
          </div>

          <div>
            <div style={label}>Play online</div>
            <button onClick={createOnline} style={primaryBtn}>Create game · get a code</button>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value.toUpperCase().slice(0, 4))}
                onKeyDown={(e) => e.key === "Enter" && joinOnline()}
                placeholder="CODE"
                maxLength={4}
                style={{ flex: 1, padding: "10px 12px", borderRadius: 9, border: "1px solid #3a3530", background: "#262320", color: "#f2ede4", fontSize: 15, letterSpacing: "0.2em", textAlign: "center", fontWeight: 700 }}
              />
              <button onClick={joinOnline} style={{ ...secondaryBtn, padding: "10px 18px", fontSize: 14 }}>Join</button>
            </div>
            {netError && <div style={{ color: "#e0533a", fontSize: 12, marginTop: 8 }}>{netError}</div>}
          </div>

          <button onClick={openLeaderboard} style={secondaryBtn}>🏆 Leaderboard</button>

          <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#5a544c", fontSize: 12 }}>
            <div style={{ flex: 1, height: 1, background: "#3a3530" }} /> OR <div style={{ flex: 1, height: 1, background: "#3a3530" }} />
          </div>

          <div>
            <div style={label}>Computer level</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {LEVELS.map((l) => (
                <button key={l.id} onClick={() => setLevel(l.id)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left",
                    padding: "11px 14px", borderRadius: 9, cursor: "pointer",
                    border: `1px solid ${level === l.id ? "#1AFF8C" : "#3a3530"}`,
                    background: level === l.id ? "rgba(26,255,140,0.08)" : "#262320",
                    color: "#f2ede4",
                  }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, width: 18, color: level === l.id ? "#1AFF8C" : "#6b645b" }}>{l.id}</span>
                    <span>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{l.name}</div>
                      <div style={{ fontSize: 11, color: "#9b948a" }}>{l.blurb}</div>
                    </span>
                  </span>
                  {level === l.id && <span style={{ color: "#1AFF8C", fontSize: 16 }}>✓</span>}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={label}>You play</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[["black", "Black (first)"], ["white", "White (second)"]].map(([c, t]) => (
                <button key={c} onClick={() => setHumanColor(c)}
                  style={{ flex: 1, padding: "10px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 600,
                    border: `1px solid ${humanColor === c ? "#1AFF8C" : "#3a3530"}`,
                    background: humanColor === c ? "rgba(26,255,140,0.08)" : "#262320", color: "#f2ede4" }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <button onClick={() => start("ai")} style={secondaryBtn}>Play vs Computer</button>
          <button onClick={() => start("local")} style={secondaryBtn}>Two players (same device)</button>
        </div>
      </div>
    );
  }

  // ---------- LEADERBOARD ----------
  if (screen === "leaderboard") {
    return (
      <div style={wrap}>
        <div style={{ width: "100%", maxWidth: 440, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <button onClick={() => setScreen("lobby")} style={ghostBtn}>← Menu</button>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>🏆 Leaderboard</h1>
          <div style={{ width: 52 }} />
        </div>
        <div style={{ width: "100%", maxWidth: 440 }}>
          {lbLoading ? (
            <div style={{ color: "#9b948a", fontSize: 14, textAlign: "center", padding: 30 }}>Loading…</div>
          ) : leaderboard.length === 0 ? (
            <div style={{ color: "#9b948a", fontSize: 14, textAlign: "center", padding: 30 }}>
              No games yet — play someone online to get on the board.
            </div>
          ) : (
            <div style={{ border: "1px solid #3a3530", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ display: "flex", padding: "10px 14px", background: "#262320", fontSize: 11, color: "#9b948a", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                <span style={{ width: 32 }}>#</span>
                <span style={{ flex: 1 }}>Player</span>
                <span style={{ width: 44, textAlign: "right" }}>W</span>
                <span style={{ width: 44, textAlign: "right" }}>L</span>
                <span style={{ width: 56, textAlign: "right" }}>Win%</span>
              </div>
              {leaderboard.map((p, i) => (
                <div key={p.name + i} style={{ display: "flex", alignItems: "center", padding: "11px 14px", borderTop: "1px solid #2a2723", fontSize: 14, color: "#f2ede4" }}>
                  <span style={{ width: 32, fontWeight: 700, color: i === 0 ? "#1AFF8C" : "#6b645b" }}>{i + 1}</span>
                  <span style={{ flex: 1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span style={{ width: 44, textAlign: "right", color: "#1AFF8C", fontWeight: 700 }}>{p.wins}</span>
                  <span style={{ width: 44, textAlign: "right", color: "#9b948a" }}>{p.losses}</span>
                  <span style={{ width: 56, textAlign: "right", color: "#9b948a" }}>{p.winRate}%</span>
                </div>
              ))}
            </div>
          )}
          <p style={{ fontSize: 11, color: "#5a544c", marginTop: 14, textAlign: "center" }}>
            Ranked by wins. Names aren't verified — friendly bragging rights only.
          </p>
        </div>
      </div>
    );
  }

  // ---------- WAITING (online, no opponent yet) ----------
  if (screen === "waiting") {
    return (
      <div style={wrap}>
        <button onClick={leaveOnline} style={{ ...ghostBtn, alignSelf: "flex-start" }}>← Cancel</button>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 }}>
          <div style={label}>Share this code</div>
          <button onClick={copyCode} style={{ fontSize: 48, fontWeight: 800, letterSpacing: "0.15em", color: "#1AFF8C", background: "transparent", border: "none", cursor: "pointer" }}>
            {code}
          </button>
          <div style={{ fontSize: 13, color: "#9b948a" }}>{copied ? "Copied!" : "Tap the code to copy"}</div>
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

  const rec = g.record || { black: 0, white: 0, draws: 0 };
  const myWins = onlineColor === "black" ? rec.black : rec.white;
  const oppWins = onlineColor === "black" ? rec.white : rec.black;

  const boardEl = (
    <div style={{ background: "#d8b878", padding: 14, borderRadius: 8, boxShadow: "0 8px 30px rgba(0,0,0,.5)", opacity: thinking ? 0.85 : 1 }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${SIZE}, 1fr)`, position: "relative" }}>
        {g.board.map((row, r) =>
          row.map((cell, c) => {
            const key = `${r},${c}`;
            const isLast = lastMove && lastMove.r === r && lastMove.c === c;
            const isWin = winSet.has(key);
            return (
              <button key={key} onClick={() => human(r, c)}
                style={{ width: 30, height: 30, padding: 0, border: "none", background: "transparent",
                  cursor: canClick && !cell ? "pointer" : "default", position: "relative" }}
                aria-label={`row ${r + 1} column ${c + 1}`}>
                <span style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1, background: "#8a6f43", transform: "translateY(-50%)",
                  clipPath: c === 0 ? "inset(0 0 0 50%)" : c === SIZE - 1 ? "inset(0 50% 0 0)" : "none" }} />
                <span style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "#8a6f43", transform: "translateX(-50%)",
                  clipPath: r === 0 ? "inset(50% 0 0 0)" : r === SIZE - 1 ? "inset(0 0 50% 0)" : "none" }} />
                {[3, 7, 11].includes(r) && [3, 7, 11].includes(c) && !cell && (
                  <span style={{ position: "absolute", top: "50%", left: "50%", width: 6, height: 6, borderRadius: "50%", background: "#8a6f43", transform: "translate(-50%, -50%)" }} />
                )}
                {cell && (
                  <span style={{
                    position: "absolute", top: "50%", left: "50%", width: 24, height: 24, borderRadius: "50%", transform: "translate(-50%, -50%)",
                    background: cell === "black" ? "radial-gradient(circle at 35% 30%, #4a443c, #15110d)" : "radial-gradient(circle at 35% 30%, #ffffff, #cfc7ba)",
                    boxShadow: isWin ? "0 0 0 2px #1AFF8C, 0 0 8px #1AFF8C" : "0 1px 3px rgba(0,0,0,.5)",
                    outline: isLast && !isWin ? "2px solid #e0533a" : "none", outlineOffset: -2, zIndex: 2,
                  }} />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", maxWidth: 472, marginBottom: 14 }}>
        <button onClick={mode === "online" ? leaveOnline : () => setScreen("lobby")} style={ghostBtn}>← Menu</button>
        <div style={{ fontSize: 12, color: "#9b948a" }}>
          {mode === "ai" ? <>You: <b style={{ color: "#f2ede4" }}>{humanColor === "black" ? "Black" : "White"}</b> · <b style={{ color: "#1AFF8C" }}>L{level}</b></>
            : mode === "online" ? <>Code <b style={{ color: "#1AFF8C", letterSpacing: "0.1em" }}>{code}</b> · You: <b style={{ color: "#f2ede4" }}>{onlineColor === "black" ? "Black" : "White"}</b></>
            : "Two players"}
        </div>
        <div style={{ width: 52 }} />
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderRadius: 999,
        background: "#262320", border: `1px solid ${g.winner ? "#1AFF8C" : "#3a3530"}`, marginBottom: 8, minWidth: 200, justifyContent: "center",
      }}>
        {!g.winner && (
          <span style={{ width: 16, height: 16, borderRadius: "50%", background: g.turn === "black" ? "#15110d" : "#f2ede4", border: "1px solid #6b645b" }} />
        )}
        <span style={{ fontWeight: 600, fontSize: 15, color: g.winner ? "#1AFF8C" : "#f2ede4" }}>{status}</span>
      </div>

      {mode === "online" && g.players?.white && (
        <div style={{ fontSize: 12, color: "#9b948a", marginBottom: 14 }}>
          You <b style={{ color: "#f2ede4" }}>{myWins}</b> – <b style={{ color: "#f2ede4" }}>{oppWins}</b> {oppName}
          {rec.draws ? <span style={{ color: "#6b645b" }}> · {rec.draws} draw{rec.draws > 1 ? "s" : ""}</span> : null}
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
            <button onClick={rematchOnline} style={primaryBtnSm}>Rematch</button>
          ) : (
            <button onClick={resignOnline} disabled={!g.players?.white}
              style={{ ...secondaryBtn, width: "auto", padding: "10px 20px", fontSize: 14, opacity: g.players?.white ? 1 : 0.5 }}>
              Resign
            </button>
          )
        ) : g.winner ? (
          <button onClick={rematch} style={primaryBtnSm}>New game</button>
        ) : (
          <button onClick={undo} disabled={g.history.length === 0 || thinking}
            style={{ ...secondaryBtn, width: "auto", padding: "10px 20px", fontSize: 14, opacity: g.history.length === 0 || thinking ? 0.5 : 1 }}>
            Undo
          </button>
        )}
        {mode === "ai" && (g.winner || g.history.length === 0) && (
          <button onClick={swapSides} style={{ ...secondaryBtn, width: "auto", padding: "10px 20px", fontSize: 14 }}>
            Swap sides
          </button>
        )}
      </div>

      <p style={{ fontSize: 12, color: "#6b645b", marginTop: 18, maxWidth: 360, textAlign: "center" }}>
        Move {g.history.length} · Freestyle rules · Black moves first
      </p>
    </div>
  );
}

const wrap = { minHeight: "100vh", background: "#1a1816", color: "#f2ede4", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 16px", boxSizing: "border-box" };
const label = { fontSize: 11, color: "#9b948a", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 };
const primaryBtn = { width: "100%", padding: "14px 20px", borderRadius: 10, border: "1px solid #1AFF8C", background: "#1AFF8C", color: "#15110d", fontSize: 16, fontWeight: 700, cursor: "pointer" };
const primaryBtnSm = { ...primaryBtn, width: "auto", padding: "10px 20px", fontSize: 14 };
const secondaryBtn = { width: "100%", padding: "12px 20px", borderRadius: 10, border: "1px solid #3a3530", background: "#262320", color: "#f2ede4", fontSize: 15, fontWeight: 600, cursor: "pointer" };
const ghostBtn = { padding: "8px 12px", borderRadius: 8, border: "1px solid #3a3530", background: "transparent", color: "#9b948a", fontSize: 13, fontWeight: 600, cursor: "pointer" };
