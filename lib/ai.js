import { SIZE, DIRS, other, makesDoubleThree, blocksThreat } from "./gomoku.js";

/* ---------------------------------------------------------------------------
 * Engine
 *
 * Board is a flat Int8Array: 0 empty, 1 black, 2 white.
 *
 * Evaluation is a sliding 6-cell window sum over a precomputed weight table,
 * maintained INCREMENTALLY: placing or lifting a stone only rescores the 24
 * windows that pass through it (6 per direction), rather than rescanning the
 * whole board. That is what buys the search depth.
 * ------------------------------------------------------------------------- */

const N = SIZE * SIZE;
const WIN = 1e7;

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

// W[i] = total weight of every pattern that matches as a PREFIX of the 6-cell
// window encoded by i (base 3, least-significant digit = first cell). Summing
// prefix matches over all window starts reproduces "count every occurrence".
const WIN_W = 7;               // scoring window width
const TOP = 3 ** (WIN_W - 1);  // place value of the window's last cell

const W = (() => {
  const t = new Float64Array(3 ** WIN_W);
  for (let i = 0; i < t.length; i++) {
    let s = "", x = i;
    for (let k = 0; k < WIN_W; k++) { s += x % 3; x = (x / 3) | 0; }
    let w = 0;
    for (const [p, v] of PATTERNS) if (s.startsWith(p)) w += v;
    t[i] = w;
  }
  return t;
})();

const codeOf = (b, r, c, me) => {
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return 2;
  const v = b[r * SIZE + c];
  return v === 0 ? 0 : v === me ? 1 : 2;
};

// raw line reads: -1 off-board, 0 empty, 1 black, 2 white
const rawAt = (b, r, c) => (r < 0 || r >= SIZE || c < 0 || c >= SIZE ? -1 : b[r * SIZE + c]);
const asCode = (v, me) => (v === 0 ? 0 : v === me ? 1 : 2);

const MID = WIN_W - 1;                    // index of the moved cell within RAW
const RAW = new Int8Array(2 * WIN_W - 1); // scratch: offsets -6..+6 along one direction

// Sum of W over every window covering RAW[MID], scored for `me`.
// Window j spans RAW[j..j+WIN_W-1]; the index rolls instead of being rebuilt.
function windowSum(me) {
  let idx = 0, p = 1;
  for (let k = 0; k < WIN_W; k++) { idx += asCode(RAW[k], me) * p; p *= 3; }
  let sum = W[idx];
  for (let j = 1; j <= MID; j++) {
    idx = (idx - asCode(RAW[j - 1], me)) / 3 + asCode(RAW[j + MID], me) * TOP;
    sum += W[idx];
  }
  return sum;
}

const loadLine = (b, r, c, dr, dc) => {
  for (let i = 0; i < RAW.length; i++) RAW[i] = rawAt(b, r + (i - MID) * dr, c + (i - MID) * dc);
};

function touch(st, r, c, sign) {
  for (let d = 0; d < 4; d++) {
    loadLine(st.b, r, c, DIRS[d][0], DIRS[d][1]);
    st.sc[1] += sign * windowSum(1);
    st.sc[2] += sign * windowSum(2);
  }
}

function place(st, idx, color) {
  const r = (idx / SIZE) | 0, c = idx % SIZE;
  touch(st, r, c, -1);
  st.b[idx] = color;
  touch(st, r, c, 1);
}

function unplace(st, idx) {
  const r = (idx / SIZE) | 0, c = idx % SIZE;
  touch(st, r, c, -1);
  st.b[idx] = 0;
  touch(st, r, c, 1);
}

const newState = (board2d) => {
  const st = { b: new Int8Array(N), sc: [0, 0, 0] };
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const v = board2d[r][c];
    if (v) place(st, r * SIZE + c, v === "black" ? 1 : 2);
  }
  return st;
};

// Exact rise in a color's OWN score if it plays the (empty) cell idx.
// Same number a place/unplace round-trip would give, at a tenth of the cost.
const GAIN = [0, 0, 0];
function gains(st, idx) {
  const r = (idx / SIZE) | 0, c = idx % SIZE;
  GAIN[1] = 0; GAIN[2] = 0;
  for (let d = 0; d < 4; d++) {
    loadLine(st.b, r, c, DIRS[d][0], DIRS[d][1]);
    const b1 = windowSum(1), b2 = windowSum(2);
    RAW[MID] = 1; GAIN[1] += windowSum(1) - b1;
    RAW[MID] = 2; GAIN[2] += windowSum(2) - b2;
    RAW[MID] = 0;
  }
  return GAIN;
}

const evalFor = (st, me) => st.sc[me] - 1.12 * st.sc[3 - me];

/* --- tactics ------------------------------------------------------------- */

function isFive(st, idx, color) {
  const r = (idx / SIZE) | 0, c = idx % SIZE;
  for (const [dr, dc] of DIRS) {
    let run = 1;
    for (let k = 1; codeOf(st.b, r + dr * k, c + dc * k, color) === 1; k++) run++;
    for (let k = 1; codeOf(st.b, r - dr * k, c - dc * k, color) === 1; k++) run++;
    if (run >= 5) return true; // five or more wins
  }
  return false;
}

function forbidden(st, idx, color) {
  if (st.b[idx]) return false;
  const r = (idx / SIZE) | 0, c = idx % SIZE;
  const opp = 3 - color;
  st.b[idx] = color;
  const double = makesDoubleThree((rr, cc) => codeOf(st.b, rr, cc, color), r, c);
  st.b[idx] = 0;
  if (!double) return false;
  st.b[idx] = opp;
  const blocks = blocksThreat((rr, cc) => codeOf(st.b, rr, cc, opp), r, c);
  st.b[idx] = 0;
  return !blocks;
}

// Empty points that would complete five for `color`, given its stone at idx.
function completions(st, idx, color) {
  const r = (idx / SIZE) | 0, c = idx % SIZE, pts = [];
  for (const [dr, dc] of DIRS) {
    for (let o = -4; o <= 0; o++) {
      let ones = 0, gap = -1, ok = true;
      for (let k = 0; k < 5; k++) {
        const v = codeOf(st.b, r + (o + k) * dr, c + (o + k) * dc, color);
        if (v === 1) ones++;
        else if (v === 0 && gap < 0) gap = o + k;
        else { ok = false; break; }
      }
      if (ok && ones === 4 && gap >= -4) {
        const p = (r + gap * dr) * SIZE + (c + gap * dc);
        if (!pts.includes(p)) pts.push(p);
      }
    }
  }
  return pts;
}

const SEEN = new Int32Array(N);
let seenTag = 0;

function neighbors(st, dist) {
  const out = [];
  const tag = ++seenTag;
  let any = false;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (!st.b[r * SIZE + c]) continue;
    any = true;
    for (let dr = -dist; dr <= dist; dr++) for (let dc = -dist; dc <= dist; dc++) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
      const i = nr * SIZE + nc;
      if (!st.b[i] && SEEN[i] !== tag) { SEEN[i] = tag; out.push(i); }
    }
  }
  return any ? out : [((SIZE / 2) | 0) * SIZE + ((SIZE / 2) | 0)];
}

const legal = (st, moves, color) => moves.filter((m) => !forbidden(st, m, color));

function winMove(st, color) {
  for (const m of neighbors(st, 1)) {
    st.b[m] = color;
    const five = isFive(st, m, color);
    st.b[m] = 0;
    if (five) return m;
  }
  return null;
}

// Moves that create at least one four (a forcing move), double fours first.
function fourMoves(st, color) {
  const out = [];
  for (const m of neighbors(st, 1)) {
    st.b[m] = color;
    const n = completions(st, m, color).length;
    st.b[m] = 0;
    if (n && !forbidden(st, m, color)) out.push({ m, n });
  }
  out.sort((a, b) => b.n - a.n);
  return out.map((o) => o.m);
}

/* --- VCF: forced win by an unbroken chain of fours ------------------------ */

function vcf(st, me, depth, deadline) {
  if (depth <= 0 || Date.now() > deadline) return null;
  const w = winMove(st, me);
  if (w !== null) return w;
  const opp = 3 - me;
  for (const m of fourMoves(st, me)) {
    place(st, m, me);
    let ok = false;
    if (winMove(st, opp) === null) {
      const pts = completions(st, m, me);
      if (pts.length >= 2) ok = true; // double four, unstoppable
      else if (pts.length === 1) {
        const blk = pts[0];
        if (forbidden(st, blk, opp)) ok = true; // the only block is illegal
        else {
          place(st, blk, opp);
          ok = vcf(st, me, depth - 1, deadline) !== null;
          unplace(st, blk);
        }
      }
    }
    unplace(st, m);
    if (ok) return m;
  }
  return null;
}

/* --- ordered move generation --------------------------------------------- */

function ordered(st, turn, cap, dist) {
  const opp = 3 - turn;
  const scored = [];
  for (const m of neighbors(st, dist)) {
    const g = gains(st, m);
    scored.push({ m, v: g[turn] + 0.9 * g[opp] });
  }
  scored.sort((x, y) => y.v - x.v);
  // Rule check only on the moves we might actually return, not the whole board.
  const out = [];
  for (const s of scored) {
    if (out.length >= cap) break;
    if (!forbidden(st, s.m, turn)) out.push(s.m);
  }
  return out;
}

/* --- alpha-beta ----------------------------------------------------------- */

const TIMEOUT = Symbol("timeout");

function ab(st, depth, alpha, beta, maxing, ai, ply, deadline, branch) {
  if (Date.now() > deadline) throw TIMEOUT;
  if (depth <= 0) return evalFor(st, ai);
  const turn = maxing ? ai : 3 - ai;
  const cap = Math.max(4, branch - ply);
  const moves = ordered(st, turn, cap, 1);
  if (!moves.length) return evalFor(st, ai);
  let best = maxing ? -Infinity : Infinity;
  for (const m of moves) {
    place(st, m, turn);
    let v;
    if (isFive(st, m, turn)) v = maxing ? WIN - ply : -WIN + ply;
    else v = ab(st, depth - 1, alpha, beta, !maxing, ai, ply + 1, deadline, branch);
    unplace(st, m);
    if (maxing) {
      if (v > best) best = v;
      if (best > alpha) alpha = best;
    } else {
      if (v < best) best = v;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) break;
  }
  return best;
}

function deepen(st, ai, maxDepth, branch, deadline) {
  const opp = 3 - ai;
  let roots = ordered(st, ai, branch, 2);
  if (!roots.length) return null;
  let best = roots[0];
  for (let depth = 2; depth <= maxDepth; depth += 2) {
    let localBest = null, localVal = -Infinity, alpha = -Infinity;
    try {
      for (const m of roots) {
        place(st, m, ai);
        const v = isFive(st, m, ai)
          ? WIN
          : ab(st, depth - 1, alpha, Infinity, false, ai, 1, deadline, branch);
        unplace(st, m);
        if (v > localVal) { localVal = v; localBest = m; }
        if (v > alpha) alpha = v;
      }
    } catch (e) {
      if (e !== TIMEOUT) throw e;
      if (localBest !== null && localVal > -Infinity) best = localBest;
      return best;
    }
    best = localBest;
    // Re-order the root by the completed depth's insight: search the winner first.
    roots = [best, ...roots.filter((m) => m !== best)];
    if (localVal >= WIN / 2 || localVal <= -WIN / 2) break;
    if (Date.now() > deadline) break;
  }
  return best;
}

/* --- level policies ------------------------------------------------------- */

const toIdx = (m) => (m === null || m === undefined ? null : [(m / SIZE) | 0, m % SIZE]);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function greedy(st, ai, topK) {
  const top = ordered(st, ai, topK, 1);
  return top.length ? pick(top) : anyLegal(st, ai);
}

function strong(st, ai, { depth, branch, budget, vcfDepth, counterVcf }) {
  const opp = 3 - ai;
  const deadline = Date.now() + budget;

  const win = winMove(st, ai);
  if (win !== null) return win;

  const theirWin = winMove(st, opp);
  if (theirWin !== null && !forbidden(st, theirWin, ai)) return theirWin;

  const forced = vcf(st, ai, vcfDepth, Math.min(deadline, Date.now() + budget * 0.25));
  if (forced !== null) return forced;

  // If the opponent has a forced win on the board, prefer a move that kills it.
  if (counterVcf) {
    const threatDeadline = Math.min(deadline, Date.now() + budget * 0.2);
    if (vcf(st, opp, Math.min(vcfDepth, 8), threatDeadline) !== null) {
      for (const m of ordered(st, ai, 8, 1)) {
        if (Date.now() > threatDeadline) break;
        place(st, m, ai);
        const stillLost = isFive(st, m, ai) ? null : vcf(st, opp, Math.min(vcfDepth, 8), threatDeadline);
        unplace(st, m);
        if (stillLost === null) return m;
      }
    }
  }

  return deepen(st, ai, depth, branch, deadline) ?? anyLegal(st, ai);
}

// Last resort: if every nearby point is forbidden, play any legal cell at all.
function anyLegal(st, color) {
  for (let i = 0; i < N; i++) if (!st.b[i] && !forbidden(st, i, color)) return i;
  return null;
}

export function chooseMove(board, level, ai, opts = {}) {
  const st = newState(board);
  const me = ai === "black" ? 1 : 2, opp = 3 - me;
  const budgetOf = (ms) => (opts.budget ? Math.min(ms, opts.budget) : ms);

  if (level === 1) {
    const win = winMove(st, me);
    if (win !== null) return toIdx(win);
    if (Math.random() < 0.5) {
      const blk = winMove(st, opp);
      if (blk !== null && !forbidden(st, blk, me)) return toIdx(blk);
    }
    const open = legal(st, neighbors(st, 1), me);
    return toIdx(open.length ? pick(open) : anyLegal(st, me));
  }

  if (level === 2) {
    const win = winMove(st, me);
    if (win !== null) return toIdx(win);
    const blk = winMove(st, opp);
    if (blk !== null && !forbidden(st, blk, me)) return toIdx(blk);
    return toIdx(greedy(st, me, 3));
  }

  if (level === 3) {
    const win = winMove(st, me);
    if (win !== null) return toIdx(win);
    const blk = winMove(st, opp);
    if (blk !== null && !forbidden(st, blk, me)) return toIdx(blk);
    return toIdx(greedy(st, me, 1));
  }

  if (level === 4) {
    return toIdx(strong(st, me, { depth: 4, branch: 8, budget: budgetOf(500), vcfDepth: 6, counterVcf: false }));
  }

  return toIdx(strong(st, me, { depth: 10, branch: 12, budget: budgetOf(1400), vcfDepth: 14, counterVcf: true }));
}

// Exposed for tests only.
export const _internals = { newState, place, unplace, evalFor, vcf, winMove, completions, forbidden };

export const LEVELS = [
  { id: 1, name: "Beginner", blurb: "Plays loosely, misses threats" },
  { id: 2, name: "Easy", blurb: "Blocks the obvious stuff" },
  { id: 3, name: "Medium", blurb: "Solid attack & defense" },
  { id: 4, name: "Hard", blurb: "Searches ahead, hunts forced wins" },
  { id: 5, name: "Expert", blurb: "Deep search + forcing-line solver" },
];
