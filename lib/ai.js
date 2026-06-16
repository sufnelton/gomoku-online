import { SIZE, findWin, other } from "./gomoku.js";

const PATTERNS = [
  ["11111", 100000],
  ["011110", 15000],
  ["011112", 2600], ["211110", 2600],
  ["11011", 2600], ["10111", 2600], ["11101", 2600],
  ["01110", 1500],
  ["010110", 1500], ["011010", 1500],
  ["001112", 350], ["211100", 350], ["001110", 350], ["011100", 350],
  ["001100", 200], ["011000", 100], ["000110", 100], ["010100", 100], ["001010", 100],
];

function linesFor(board, player) {
  const opp = other(player);
  const code = (v) => (v === player ? "1" : v === opp ? "2" : "0");
  const out = [];
  for (let r = 0; r < SIZE; r++) { let s = ""; for (let c = 0; c < SIZE; c++) s += code(board[r][c]); out.push(s); }
  for (let c = 0; c < SIZE; c++) { let s = ""; for (let r = 0; r < SIZE; r++) s += code(board[r][c]); out.push(s); }
  for (let k = -(SIZE - 1); k <= SIZE - 1; k++) { let s = ""; for (let r = 0; r < SIZE; r++) { const c = r - k; if (c >= 0 && c < SIZE) s += code(board[r][c]); } if (s.length >= 5) out.push(s); }
  for (let k = 0; k <= 2 * (SIZE - 1); k++) { let s = ""; for (let r = 0; r < SIZE; r++) { const c = k - r; if (c >= 0 && c < SIZE) s += code(board[r][c]); } if (s.length >= 5) out.push(s); }
  return out;
}

const countOcc = (s, sub) => { let n = 0, i = 0; while ((i = s.indexOf(sub, i)) !== -1) { n++; i++; } return n; };

function scoreFor(board, player) {
  let total = 0;
  for (const raw of linesFor(board, player)) { const s = "2" + raw + "2"; for (const [p, w] of PATTERNS) { const n = countOcc(s, p); if (n) total += n * w; } }
  return total;
}

const evaluateBoard = (board, ai) => scoreFor(board, ai) - 1.15 * scoreFor(board, other(ai));

function getCandidates(board, dist = 1) {
  const seen = new Set(); const out = []; let any = false;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (!board[r][c]) continue; any = true;
    for (let dr = -dist; dr <= dist; dr++) for (let dc = -dist; dc <= dist; dc++) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && !board[nr][nc]) { const k = nr * SIZE + nc; if (!seen.has(k)) { seen.add(k); out.push([nr, nc]); } }
    }
  }
  return any ? out : [[7, 7]];
}

function neighborScore(board, r, c) {
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue; const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc]) n++;
  }
  return n;
}

function findImmediate(board, color) {
  for (const [r, c] of getCandidates(board, 1)) { board[r][c] = color; const w = findWin(board, r, c); board[r][c] = null; if (w) return [r, c]; }
  return null;
}

function scoredTop(board, ai, k) {
  const moves = getCandidates(board, 1).map(([r, c]) => { board[r][c] = ai; const v = evaluateBoard(board, ai); board[r][c] = null; return { r, c, v }; });
  moves.sort((a, b) => b.v - a.v);
  return moves.slice(0, k).map((m) => [m.r, m.c]);
}

function minimax(board, depth, alpha, beta, maxing, ai, opp, branch) {
  const score = evaluateBoard(board, ai);
  if (depth <= 0 || Math.abs(score) >= 90000) return score;
  let cands = getCandidates(board, 1);
  if (!cands.length) return score;
  cands.sort((a, b) => neighborScore(board, b[0], b[1]) - neighborScore(board, a[0], a[1]));
  cands = cands.slice(0, branch);
  if (maxing) {
    let best = -Infinity;
    for (const [r, c] of cands) { board[r][c] = ai; best = Math.max(best, minimax(board, depth - 1, alpha, beta, false, ai, opp, branch)); board[r][c] = null; alpha = Math.max(alpha, best); if (beta <= alpha) break; }
    return best;
  } else {
    let best = Infinity;
    for (const [r, c] of cands) { board[r][c] = opp; best = Math.min(best, minimax(board, depth - 1, alpha, beta, true, ai, opp, branch)); board[r][c] = null; beta = Math.min(beta, best); if (beta <= alpha) break; }
    return best;
  }
}

function searchMove(board, depth, branch, ai) {
  const opp = other(ai);
  const win = findImmediate(board, ai); if (win) return win;
  const block = findImmediate(board, opp); if (block) return block;
  let cands = getCandidates(board, 1).map(([r, c]) => { board[r][c] = ai; const v = evaluateBoard(board, ai); board[r][c] = null; return { r, c, v }; });
  cands.sort((a, b) => b.v - a.v);
  cands = cands.slice(0, branch);
  let best = cands.length ? [cands[0].r, cands[0].c] : null, bestV = -Infinity, alpha = -Infinity;
  for (const { r, c } of cands) { board[r][c] = ai; const v = minimax(board, depth - 1, alpha, Infinity, false, ai, opp, branch); board[r][c] = null; if (v > bestV) { bestV = v; best = [r, c]; } alpha = Math.max(alpha, v); }
  return best;
}

export function chooseMove(board, level, ai) {
  const opp = other(ai);
  const cands = getCandidates(board, 1);
  if (level === 1) {
    const win = findImmediate(board, ai); if (win) return win;
    if (Math.random() < 0.5) { const blk = findImmediate(board, opp); if (blk) return blk; }
    return cands[Math.floor(Math.random() * cands.length)];
  }
  if (level === 2) {
    const win = findImmediate(board, ai); if (win) return win;
    const blk = findImmediate(board, opp); if (blk) return blk;
    const top = scoredTop(board, ai, 3);
    return top[Math.floor(Math.random() * top.length)];
  }
  if (level === 3) {
    const win = findImmediate(board, ai); if (win) return win;
    const blk = findImmediate(board, opp); if (blk) return blk;
    return scoredTop(board, ai, 1)[0];
  }
  if (level === 4) return searchMove(board, 2, 12, ai);
  return searchMove(board, 4, 8, ai);
}

export const LEVELS = [
  { id: 1, name: "Beginner", blurb: "Plays loosely, misses threats" },
  { id: 2, name: "Easy", blurb: "Blocks the obvious stuff" },
  { id: 3, name: "Medium", blurb: "Solid attack & defense" },
  { id: 4, name: "Hard", blurb: "Looks ahead, sets traps" },
  { id: 5, name: "Expert", blurb: "Deep search, punishes errors" },
];
