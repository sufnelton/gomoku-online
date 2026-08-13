import {
  getLobby, setLobby, hincrby, hset, hgetall, zincrby,
} from "./store.js";
import { applyMove, freshGameState, isForbidden, other, SIZE } from "./gomoku.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O to avoid ambiguity
const CODE_LEN = 4;
const CHAT_MAX = 50;
const TEXT_MAX = 200;
const NAME_MAX = 16;

function randomCode() {
  let s = "";
  for (let i = 0; i < CODE_LEN; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

function now() {
  return new Date().toISOString();
}

export function cleanName(name) {
  const t = String(name || "").trim().slice(0, NAME_MAX);
  return t || "Guest";
}

const lower = (s) => String(s).toLowerCase();

function cleanPass(p) {
  return String(p || "").trim().slice(0, 32);
}

/* What a client is allowed to see.
 *
 * `pass` never leaves the server. Neither do `players`, and that one was the
 * real hole: a playerId IS the credential -- every write action authenticates
 * on nothing else -- so handing both of them out with the board let anyone
 * holding a 4-letter code move, chat and resign as either player. The
 * passphrase did not help, because it gates `join` and this was readable
 * without joining.
 *
 * Seat occupancy is all the UI ever needed from `players`; who you are comes
 * back as `youAre`, and only to a caller who proved the id. */
const publicView = (lobby, playerId = null) => {
  const { pass, players, ...rest } = lobby;
  return {
    ...rest,
    locked: !!pass,
    seats: { black: !!players.black, white: !!players.white },
    youAre: playerId ? colorOf(lobby, playerId) : null,
  };
};

function colorOf(lobby, playerId) {
  if (lobby.players.black === playerId) return "black";
  if (lobby.players.white === playerId) return "white";
  return null;
}

function pairKey(a, b) {
  return [lower(a), lower(b)].sort().join("|");
}

async function save(code, lobby) {
  lobby.version += 1;
  lobby.updatedAt = now();
  await setLobby(code, lobby);
  return lobby;
}

async function loadH2H(lobby) {
  const bN = lobby.names.black, wN = lobby.names.white;
  if (!bN || !wN) return { black: 0, white: 0, draws: 0 };
  const h = await hgetall(`h2h:${pairKey(bN, wN)}`);
  return {
    black: Number(h[lower(bN)] || 0),
    white: Number(h[lower(wN)] || 0),
    draws: Number(h.draws || 0),
  };
}

// Update persistent stats + the lobby's head-to-head record. Fires once per game end.
async function recordResult(lobby, outcome) {
  const bN = lobby.names.black, wN = lobby.names.white;
  if (!lobby.players.white || !bN || !wN) return; // need two named players
  const bL = lower(bN), wL = lower(wN);

  // Keep latest display casing.
  const at = now();
  await hset(`player:${bL}`, { name: bN, lastAt: at });
  await hset(`player:${wL}`, { name: wN, lastAt: at });

  if (outcome === "draw") {
    await hincrby(`player:${bL}`, "draws", 1);
    await hincrby(`player:${wL}`, "draws", 1);
    await hincrby(`h2h:${pairKey(bN, wN)}`, "draws", 1);
  } else {
    const winColor = outcome; // "black" | "white"
    const winN = winColor === "black" ? bN : wN;
    const loseN = winColor === "black" ? wN : bN;
    await hincrby(`player:${lower(winN)}`, "wins", 1);
    await hincrby(`player:${lower(loseN)}`, "losses", 1);
    await zincrby("lb:wins", lower(winN), 1);
    await hincrby(`h2h:${pairKey(bN, wN)}`, lower(winN), 1);
  }

  lobby.record = await loadH2H(lobby);
}

export async function createLobby(playerId, name, pass) {
  let code = randomCode();
  for (let i = 0; i < 10 && (await getLobby(code)); i++) code = randomCode();
  const lobby = {
    code,
    ...freshGameState("black"),
    players: { black: playerId, white: null },
    names: { black: cleanName(name), white: null },
    record: { black: 0, white: 0, draws: 0 },
    chat: [],
    chatSeq: 0,
    pass: cleanPass(pass),
    version: 1,
    createdAt: now(),
    updatedAt: now(),
  };
  await setLobby(code, lobby);
  return { code, color: "black", state: publicView(lobby, playerId) };
}

export async function joinLobby(playerId, name, code, pass) {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "not_found" };
  const existing = colorOf(lobby, playerId);
  if (existing) return { color: existing, state: publicView(lobby, playerId) };
  if (lobby.players.white) return { error: "full" };
  if (lobby.pass && cleanPass(pass) !== lobby.pass) return { error: "bad_pass" };
  lobby.players.white = playerId;
  lobby.names.white = cleanName(name);
  lobby.record = await loadH2H(lobby);
  await save(code, lobby);
  return { color: "white", state: publicView(lobby, playerId) };
}

export async function moveInLobby(playerId, code, r, c) {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "not_found" };
  const color = colorOf(lobby, playerId);
  if (!color) return { error: "not_a_player" };
  if (lobby.winner) return { error: "game_over" };
  if (!lobby.players.white) return { error: "no_opponent" };
  if (lobby.turn !== color) return { error: "not_your_turn" };
  if (
    !Number.isInteger(r) || !Number.isInteger(c) ||
    r < 0 || c < 0 || r >= SIZE || c >= SIZE || lobby.board[r][c]
  ) return { error: "occupied" };
  if (isForbidden(lobby.board, r, c, color)) return { error: "forbidden" };
  const next = applyMove(lobby, r, c);
  Object.assign(lobby, next);
  if (next.winner) await recordResult(lobby, next.winner === "draw" ? "draw" : next.winner);
  await save(code, lobby);
  return { state: publicView(lobby, playerId) };
}

export async function resignLobby(playerId, code) {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "not_found" };
  const color = colorOf(lobby, playerId);
  if (!color) return { error: "not_a_player" };
  if (lobby.winner) return { error: "game_over" };
  lobby.winner = other(color);
  lobby.winLine = [];
  lobby.endReason = "resign";
  await recordResult(lobby, other(color));
  await save(code, lobby);
  return { state: publicView(lobby, playerId) };
}

export async function rematchLobby(playerId, code) {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "not_found" };
  if (!colorOf(lobby, playerId)) return { error: "not_a_player" };
  const swappedPlayers = { black: lobby.players.white, white: lobby.players.black };
  const swappedNames = { black: lobby.names.white, white: lobby.names.black };
  const keepChat = lobby.chat;
  const keepSeq = lobby.chatSeq;
  Object.assign(lobby, freshGameState("black"));
  lobby.players = swappedPlayers;
  lobby.names = swappedNames;
  lobby.chat = keepChat;
  lobby.chatSeq = keepSeq;
  lobby.record = await loadH2H(lobby);
  await save(code, lobby);
  return { state: publicView(lobby, playerId) };
}

export async function chatMessage(playerId, code, text) {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "not_found" };
  const color = colorOf(lobby, playerId);
  if (!color) return { error: "not_a_player" };
  const t = String(text || "").trim().slice(0, TEXT_MAX);
  if (!t) return { error: "bad_request" };
  lobby.chatSeq = (lobby.chatSeq || 0) + 1;
  lobby.chat = lobby.chat || [];
  lobby.chat.push({ seq: lobby.chatSeq, color, name: lobby.names[color] || "Guest", text: t, ts: now() });
  if (lobby.chat.length > CHAT_MAX) lobby.chat = lobby.chat.slice(-CHAT_MAX);
  await save(code, lobby);
  return { state: publicView(lobby, playerId) };
}

/* Polling. Requires the caller to be a player: a code alone is no longer
 * enough to read a game, so sweeping the 331,776-code space returns nothing. */
export async function getState(code, playerId) {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "not_found" };
  if (!colorOf(lobby, playerId)) return { error: "not_a_player" };
  return { state: publicView(lobby, playerId) };
}
