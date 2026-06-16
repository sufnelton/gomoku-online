import { getLobby, setLobby } from "./store.js";
import { applyMove, freshGameState, other, SIZE } from "./gomoku.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O to avoid ambiguity
const CODE_LEN = 4;

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

function colorOf(lobby, playerId) {
  if (lobby.players.black === playerId) return "black";
  if (lobby.players.white === playerId) return "white";
  return null;
}

async function save(code, lobby) {
  lobby.version += 1;
  lobby.updatedAt = now();
  await setLobby(code, lobby);
  return lobby;
}

export async function createLobby(playerId) {
  let code = randomCode();
  for (let i = 0; i < 10 && (await getLobby(code)); i++) code = randomCode();
  const lobby = {
    code,
    ...freshGameState("black"),
    players: { black: playerId, white: null },
    version: 1,
    createdAt: now(),
    updatedAt: now(),
  };
  await setLobby(code, lobby);
  return { code, color: "black", state: lobby };
}

export async function joinLobby(playerId, code) {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "not_found" };
  const existing = colorOf(lobby, playerId);
  if (existing) return { color: existing, state: lobby };
  if (lobby.players.white) return { error: "full" };
  lobby.players.white = playerId;
  await save(code, lobby);
  return { color: "white", state: lobby };
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
  const next = applyMove(lobby, r, c);
  Object.assign(lobby, next);
  await save(code, lobby);
  return { state: lobby };
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
  await save(code, lobby);
  return { state: lobby };
}

export async function rematchLobby(playerId, code) {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "not_found" };
  if (!colorOf(lobby, playerId)) return { error: "not_a_player" };
  const swapped = { black: lobby.players.white, white: lobby.players.black };
  Object.assign(lobby, freshGameState("black"));
  lobby.players = swapped;
  await save(code, lobby);
  return { state: lobby };
}

export async function getState(code) {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "not_found" };
  return { state: lobby };
}
