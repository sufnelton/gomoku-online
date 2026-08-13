/* The last few finished games, kept on this device.
 *
 * A game IS its move list -- freshGameState carries `history` as {r,c,color}
 * and the board is rebuilt from it -- so archiving one is a JSON write and
 * replaying it is the same reconstruction loop undo already uses. A typical
 * game is 30-60 moves, about 2KB.
 *
 * This is a personal log, not a ranking. It follows the browser rather than
 * the player, and it is deliberately NOT the server leaderboard: that one is
 * cross-player and name-based, and this one has no way to verify anything. */

import { emptyBoard, freshGameState, findWin } from "./gomoku.js";

export const KEY = "gomoku_games";
export const LIMIT = 5;

const canStore = () => typeof localStorage !== "undefined";

export function loadGames() {
  if (!canStore()) return [];
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(isSane).slice(0, LIMIT) : [];
  } catch {
    return []; // corrupt or unreadable: an empty log beats a crashed lobby
  }
}

// A stored game came from a previous version of this code, or from a user
// poking at localStorage. Anything that fails here is dropped, not repaired.
function isSane(g) {
  return g && typeof g === "object"
    && Array.isArray(g.history)
    && g.history.every((m) => m && Number.isInteger(m.r) && Number.isInteger(m.c)
      && (m.color === "black" || m.color === "white"));
}

/* Called once when a game ends. `outcome` is what the archive row shows, and
 * it is frozen: continuing a game from the archive forks a NEW game rather
 * than editing this one. Undoing a loss into a win would otherwise make the
 * record mean nothing. */
export function saveGame(g, { mode, youAre, forked = false, finishedAt }) {
  if (!canStore() || !g || !g.history.length) return loadGames();
  const entry = {
    id: `${finishedAt}-${g.history.length}`,
    finishedAt,
    mode,                       // ai | local | online
    youAre,                     // black | white | null (local: no "you")
    forked,                     // continued from an earlier archived game
    winner: g.winner || null,   // black | white | draw | null
    endReason: g.endReason || null,
    history: g.history.map(({ r, c, color }) => ({ r, c, color })),
  };
  const next = [entry, ...loadGames()].slice(0, LIMIT);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* quota */ }
  return next;
}

export function clearGames() {
  if (canStore()) { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
  return [];
}

// Win / loss / draw over the archive, from the archiving player's point of
// view. Local games have no "you", so they only count toward the total.
export function tally(games) {
  let wins = 0, losses = 0, draws = 0, decidedElsewhere = 0;
  for (const g of games) {
    if (g.winner === "draw") { draws++; continue; }
    if (!g.winner) continue;
    if (!g.youAre) { decidedElsewhere++; continue; }
    if (g.winner === g.youAre) wins++; else losses++;
  }
  return { wins, losses, draws, decidedElsewhere, total: games.length };
}

/* Rebuild the position after the first `ply` moves. Same loop as undo, with an
 * index instead of always going to the end. */
export function stateAt(game, ply) {
  const moves = game.history.slice(0, Math.max(0, Math.min(ply, game.history.length)));
  const board = emptyBoard();
  for (const { r, c, color } of moves) board[r][c] = color;
  const atEnd = moves.length === game.history.length;
  const last = moves[moves.length - 1];
  // Recomputed rather than stored: the move list is the only thing worth
  // trusting in an archive that survives code changes, and findWin is the same
  // function that decided the game in the first place.
  const winLine = atEnd && last && game.winner && game.winner !== "draw"
    ? (findWin(board, last.r, last.c) || [])
    : [];
  return {
    ...freshGameState(moves.length % 2 === 0 ? "black" : "white"),
    board,
    history: moves,
    // The result belongs to the finished game, so it only shows at the end of
    // the replay -- scrubbing back mid-game must not display a winner.
    winner: atEnd ? game.winner : null,
    winLine,
    endReason: atEnd ? game.endReason : null,
  };
}

/* Resume an archived game from `ply` moves in. The caller decides the mode:
 * an online game cannot be resumed as an online game -- the lobby is gone and
 * the opponent is not there -- so it continues against the computer or as two
 * players here. Marked forked so nothing it produces is reported anywhere. */
export function resumeFrom(game, ply) {
  const s = stateAt(game, ply);
  return { ...s, winner: null, winLine: [], endReason: null };
}
