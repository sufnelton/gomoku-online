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

/* --- VCT: forced win by any chain of threats, not just fours -------------
 * Allis's threat-space search. A four forces one reply so VCF is shallow but
 * easy; an open three also forces a reply, just several possible ones, and
 * nearly every real forced win runs through threes. */

// A straight (open) four: exactly four in a row with BOTH ends empty.
function makesOpenFourAt(st, idx, color) {
  const r = (idx / SIZE) | 0, c = idx % SIZE;
  for (const [dr, dc] of DIRS) {
    let run = 1, f = 1, b = 1;
    while (codeOf(st.b, r + dr * f, c + dc * f, color) === 1) { run++; f++; }
    while (codeOf(st.b, r - dr * b, c - dc * b, color) === 1) { run++; b++; }
    if (run === 4
      && codeOf(st.b, r + dr * f, c + dc * f, color) === 0
      && codeOf(st.b, r - dr * b, c - dc * b, color) === 0) return true;
  }
  return false;
}

// Empty points within four cells of idx along its four lines.
function lineCells(idx) {
  const r = (idx / SIZE) | 0, c = idx % SIZE, out = [];
  for (const [dr, dc] of DIRS) {
    for (let k = -4; k <= 4; k++) {
      if (!k) continue;
      const rr = r + dr * k, cc = c + dc * k;
      if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE) out.push(rr * SIZE + cc);
    }
  }
  return out;
}

// Points that would hand `color` a straight four -- i.e. the payoff of a three.
function openFourGains(st, idx, color) {
  const out = [];
  for (const q of lineCells(idx)) {
    if (st.b[q]) continue;
    st.b[q] = color;
    const of = makesOpenFourAt(st, q, color);
    st.b[q] = 0;
    if (of && !out.includes(q)) out.push(q);
  }
  return out;
}

// Moves creating an open three. Fours are excluded: they are more forcing and
// are generated separately.
function threeMoves(st, color, cap) {
  const out = [];
  for (const m of neighbors(st, 1)) {
    if (st.b[m]) continue;
    st.b[m] = color;
    const four = completions(st, m, color).length > 0;
    const gains = four ? [] : openFourGains(st, m, color);
    st.b[m] = 0;
    if (gains.length && !forbidden(st, m, color)) out.push({ m, n: gains.length });
  }
  out.sort((a, b) => b.n - a.n);
  return out.slice(0, cap).map((o) => o.m);
}

// Defender replies that stop the three from becoming a straight four.
function threeDefenses(st, m, attacker) {
  const defender = 3 - attacker;
  const gains = openFourGains(st, m, attacker);
  if (!gains.length) return [];
  const cands = new Set(gains);
  for (const q of lineCells(m)) if (!st.b[q]) cands.add(q);
  const defs = [];
  for (const d of cands) {
    if (st.b[d] || forbidden(st, d, defender)) continue;
    st.b[d] = defender;
    let stillOpen = false;
    for (const q of gains) {
      if (st.b[q]) continue;
      st.b[q] = attacker;
      if (makesOpenFourAt(st, q, attacker)) stillOpen = true;
      st.b[q] = 0;
      if (stillOpen) break;
    }
    st.b[d] = 0;
    if (!stillOpen) defs.push(d);
  }
  return defs;
}

function vct(st, me, depth, deadline) {
  if (depth <= 0 || Date.now() > deadline) return null;
  const opp = 3 - me;
  const w = winMove(st, me);
  if (w !== null) return w;

  const threats = [...fourMoves(st, me), ...threeMoves(st, me, 10)];
  for (const m of threats) {
    if (Date.now() > deadline) return null;
    place(st, m, me);
    let ok = false;
    if (winMove(st, opp) === null) {
      const comp = completions(st, m, me);
      if (comp.length >= 2) {
        ok = true; // double four: no single reply covers both
      } else {
        // A four forces the block; a three lets the defender choose, and they
        // may also ignore it and throw a four of their own.
        const replies = comp.length === 1
          ? (forbidden(st, comp[0], opp) ? [] : [comp[0]])
          : [...new Set([...threeDefenses(st, m, me), ...fourMoves(st, opp)])];
        if (!replies.length) {
          ok = true; // nothing legal stops it
        } else {
          ok = true;
          for (const d of replies) {
            place(st, d, opp);
            const sub = vct(st, me, depth - 1, deadline);
            unplace(st, d);
            if (sub === null) { ok = false; break; } // one refutation is enough
          }
        }
      }
    }
    unplace(st, m);
    if (ok) return m;
  }
  return null;
}

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

function strong(st, ai, { depth, branch, budget, vcfDepth, vctDepth, counterVcf }) {
  const opp = 3 - ai;
  const deadline = Date.now() + budget;

  const win = winMove(st, ai);
  if (win !== null) return win;

  const theirWin = winMove(st, opp);
  if (theirWin !== null && !forbidden(st, theirWin, ai)) return theirWin;

  // Cheap forcing win first, then the wider threat search.
  const forced = vcf(st, ai, vcfDepth, Math.min(deadline, Date.now() + budget * 0.15));
  if (forced !== null) return forced;

  if (vctDepth) {
    const t = vct(st, ai, vctDepth, Math.min(deadline, Date.now() + budget * 0.25));
    if (t !== null) return t;
  }

  // If the opponent has a forced win on the board, prefer a move that kills it.
  if (counterVcf) {
    const threatDeadline = Math.min(deadline, Date.now() + budget * 0.25);
    // Detect with the wide search, but refute with the cheap one: running a
    // full VCT per candidate move burns the whole budget and leaves nothing
    // for the main search, which costs more strength than it buys.
    const threat = vcf(st, opp, Math.min(vcfDepth, 8), threatDeadline);
    if (threat !== null) {
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
    return toIdx(strong(st, me, { depth: 4, branch: 8, budget: budgetOf(500), vcfDepth: 6, vctDepth: 0, counterVcf: false }));
  }

  return toIdx(strong(st, me, { depth: 10, branch: 12, budget: budgetOf(2200), vcfDepth: 14, vctDepth: opts.vctDepth ?? 7, counterVcf: true }));
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
