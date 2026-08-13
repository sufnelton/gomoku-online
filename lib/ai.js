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

/* Instrumentation for playtests.
 *  vct    moves that came from the threat search
 *  nodes  alpha-beta nodes visited
 *  depth  deepest iteration COMPLETED, summed over moves, with `moves` to
 *         divide by -- the honest measure of a speed change, since the search
 *         spends a time budget rather than racing a clock. */
export const STATS = { vct: 0, nodes: 0, depth: 0, moves: 0 };

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

const MID = WIN_W - 1; // index of the moved cell within a loaded line

/* Scratch line buffers, offsets -6..+6 along one direction. Every caller wants
 * the line scored for BOTH colours, so it is loaded as two ready-made code
 * arrays -- 0 empty, 1 own, 2 enemy-or-off-board -- rather than as raw values
 * converted per colour inside the scoring loop. Measured: that per-colour
 * conversion was 12.7% of all thinking time on its own. */
const C1 = new Int8Array(2 * WIN_W - 1); // line as black sees it
const C2 = new Int8Array(2 * WIN_W - 1); // line as white sees it

function loadLine(b, r, c, dr, dc) {
  for (let i = 0; i < C1.length; i++) {
    const k = i - MID;
    const rr = r + k * dr, cc = c + k * dc;
    const v = (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) ? -1 : b[rr * SIZE + cc];
    // Off-board blocks a run exactly as an enemy stone does, so it codes as 2.
    C1[i] = v === 0 ? 0 : v === 1 ? 1 : 2;
    C2[i] = v === 0 ? 0 : v === 2 ? 1 : 2;
  }
}

// Sum of W over every window covering C[MID]. Window j spans C[j..j+WIN_W-1];
// the index rolls instead of being rebuilt.
function windowSum(C) {
  let idx = 0, p = 1;
  for (let k = 0; k < WIN_W; k++) { idx += C[k] * p; p *= 3; }
  let sum = W[idx];
  for (let j = 1; j <= MID; j++) {
    idx = (idx - C[j - 1]) / 3 + C[j + MID] * TOP;
    sum += W[idx];
  }
  return sum;
}

function touch(st, r, c, sign) {
  for (let d = 0; d < 4; d++) {
    loadLine(st.b, r, c, DIRS[d][0], DIRS[d][1]);
    st.sc[1] += sign * windowSum(C1);
    st.sc[2] += sign * windowSum(C2);
  }
}

/* Gain cache.
 *
 * ordered() scores every neighbouring point and then keeps four to twelve of
 * them, so most of that scoring is thrown away -- and it was the single
 * largest cost in the search.
 *
 * CELL_V[q] is a hash of the stones that can reach q: every stone within six
 * cells along one of q's four lines, which is exactly the set that can change
 * q's gain. It is XORed in on place and out on unplace, so it is a function of
 * board CONTENT, not of how many operations have run. That is the point --
 * after place(m) then unplace(m) the hash returns to what it was, so the
 * sibling moves at that node still hit their cached scores instead of being
 * recomputed once per sibling. */
const CELL_V = new Int32Array(N);
const GAIN_V = new Int32Array(N);
const GAIN_OK = new Uint8Array(N);
const GAIN_1 = new Float64Array(N);
const GAIN_2 = new Float64Array(N);

// Stamp idx's stone into every cell whose gain it can reach. Self-inverse, so
// the same call undoes it.
function stamp(idx, z) {
  const r = (idx / SIZE) | 0, c = idx % SIZE;
  for (let d = 0; d < 4; d++) {
    const dr = DIRS[d][0], dc = DIRS[d][1];
    for (let k = -MID; k <= MID; k++) {
      if (!k) continue; // idx itself is only ever scored while empty
      const rr = r + k * dr, cc = c + k * dc;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
      CELL_V[rr * SIZE + cc] ^= z;
    }
  }
}

function place(st, idx, color) {
  const r = (idx / SIZE) | 0, c = idx % SIZE;
  touch(st, r, c, -1);
  st.b[idx] = color;
  touch(st, r, c, 1);
  const z = idx * 2 + (color - 1);
  st.h1 ^= Z1[z]; st.h2 ^= Z2[z];
  stamp(idx, Z1[z]);
}

function unplace(st, idx) {
  const r = (idx / SIZE) | 0, c = idx % SIZE;
  const z = idx * 2 + (st.b[idx] - 1);
  st.h1 ^= Z1[z]; st.h2 ^= Z2[z];
  stamp(idx, Z1[z]);
  touch(st, r, c, -1);
  st.b[idx] = 0;
  touch(st, r, c, 1);
}

const newState = (board2d) => {
  // The caches are module-level and outlive a search, so a new position starts
  // by dropping them: a cell far from every stone here may have been next to
  // one in the last game, and nothing in this position would invalidate it.
  CELL_V.fill(0);
  GAIN_OK.fill(0);
  const st = { b: new Int8Array(N), sc: [0, 0, 0], h1: 0, h2: 0 };
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
  if (GAIN_OK[idx] && GAIN_V[idx] === CELL_V[idx]) {
    GAIN[1] = GAIN_1[idx]; GAIN[2] = GAIN_2[idx];
    return GAIN;
  }
  const r = (idx / SIZE) | 0, c = idx % SIZE;
  GAIN[1] = 0; GAIN[2] = 0;
  for (let d = 0; d < 4; d++) {
    loadLine(st.b, r, c, DIRS[d][0], DIRS[d][1]);
    const b1 = windowSum(C1), b2 = windowSum(C2);
    // The centre is empty in both views; setting it to 1 makes it that
    // colour's OWN stone, which is what the gain is asking about.
    C1[MID] = 1; GAIN[1] += windowSum(C1) - b1; C1[MID] = 0;
    C2[MID] = 1; GAIN[2] += windowSum(C2) - b2; C2[MID] = 0;
  }
  GAIN_1[idx] = GAIN[1]; GAIN_2[idx] = GAIN[2];
  GAIN_V[idx] = CELL_V[idx]; GAIN_OK[idx] = 1;
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

/* Zobrist hashing. Two independent keys: one picks the slot, the other
 * verifies it, which makes a collision need both to clash rather than one. */
const [Z1, Z2] = (() => {
  let x = 0x9e3779b9; // fixed seed: the table must be identical every run
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x | 0; };
  const a = new Int32Array(N * 2), b = new Int32Array(N * 2);
  for (let i = 0; i < N * 2; i++) { a[i] = rnd(); b[i] = rnd(); }
  return [a, b];
})();
const SIDE_KEY = 0x5bf03635 | 0;
// Stored values are evalFor(st, ai) -- signed from the AI's point of view. The
// table now outlives a single move, and swapping sides (or a tourney game where
// both colours call chooseMove) would otherwise read them back inverted.
const AI_KEY = 0x2545f491 | 0;

const TT_BITS = 18;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const TT_KEY = new Int32Array(TT_SIZE);
const TT_VAL = new Float64Array(TT_SIZE);
const TT_DEPTH = new Int8Array(TT_SIZE);
const TT_FLAG = new Int8Array(TT_SIZE); // 0 exact, 1 lower bound, 2 upper bound
const TT_GEN = new Int32Array(TT_SIZE);
/* The table used to be thrown away between moves. It no longer is: after the
 * opponent replies, most of the tree just searched is still on the board, and
 * the two-key Zobrist verify identifies a POSITION rather than a search, so a
 * surviving entry is as sound as a fresh one.
 *
 * ttGen still counts moves, but it no longer gates the PROBE -- only the
 * replacement decision. One search very nearly fills the table, so if depth
 * alone decided replacement, last move's deep entries would lock this move's
 * out and the reuse would cost more than it saved. Measured: it did, -0.33 ply.
 * An entry from an older move is therefore always free to take. */
let ttGen = 0;
let ttPersist = false; // opts.ttPersist -- measured, see docs/STATE.md
let ttOn = true; // test hook: lets a playtest run the search without it

// Two killers per ply: quiet moves that caused a cutoff at the same depth are
// overwhelmingly likely to cause one again in a sibling line.
const KILLER = new Int32Array(64 * 2).fill(-1);

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

function ordered(st, turn, cap, dist, ply = -1) {
  const opp = 3 - turn;
  const k0 = ttOn && ply >= 0 && ply < 64 ? KILLER[ply * 2] : -1;
  const k1 = ttOn && ply >= 0 && ply < 64 ? KILLER[ply * 2 + 1] : -1;
  const scored = [];
  for (const m of neighbors(st, dist)) {
    const g = gains(st, m);
    let v = g[turn] + 0.9 * g[opp];
    // Searching a known cutoff move first prunes the rest of the list.
    if (m === k0) v += 1e6;
    else if (m === k1) v += 5e5;
    scored.push({ m, v });
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
  STATS.nodes++;
  if (Date.now() > deadline) throw TIMEOUT;
  if (depth <= 0) return evalFor(st, ai);

  // Transposition probe. Move orders converge on the same positions constantly,
  // so most of this tree has already been searched under a different sequence.
  const slot = (st.h1 >>> 0) & TT_MASK;
  const verify = (maxing ? st.h2 : (st.h2 ^ SIDE_KEY)) ^ (ai === 1 ? 0 : AI_KEY);
  const alpha0 = alpha, beta0 = beta;
  if (ttOn && (ttPersist ? TT_GEN[slot] !== 0 : TT_GEN[slot] === ttGen)
      && TT_KEY[slot] === verify && TT_DEPTH[slot] >= depth) {
    const v = TT_VAL[slot], f = TT_FLAG[slot];
    if (f === 0) return v;
    if (f === 1 && v > alpha) alpha = v;
    else if (f === 2 && v < beta) beta = v;
    if (alpha >= beta) return v;
  }

  const turn = maxing ? ai : 3 - ai;
  const cap = Math.max(4, branch - ply);
  const moves = ordered(st, turn, cap, 1, ply);
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
    if (beta <= alpha) {
      if (ply < 64 && KILLER[ply * 2] !== m) {
        KILLER[ply * 2 + 1] = KILLER[ply * 2];
        KILLER[ply * 2] = m;
      }
      break;
    }
  }

  // Mate scores carry the ply they were found at, so storing them would hand a
  // wrong distance to a different depth. Everything else is safe to keep.
  // Take the slot if it is from an older move, holds a different position, or
  // is shallower than what we just proved.
  if (ttOn && Math.abs(best) < WIN / 2
      && (TT_GEN[slot] !== ttGen || TT_KEY[slot] !== verify || TT_DEPTH[slot] <= depth)) {
    TT_GEN[slot] = ttGen;
    TT_KEY[slot] = verify;
    TT_VAL[slot] = best;
    TT_DEPTH[slot] = Math.min(depth, 127);
    TT_FLAG[slot] = best <= alpha0 ? 2 : best >= beta0 ? 1 : 0;
  }
  return best;
}

function deepen(st, ai, maxDepth, branch, deadline) {
  const opp = 3 - ai;
  let roots = ordered(st, ai, branch, 2);
  if (!roots.length) return null;
  let best = roots[0];
  let completed = 0;
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
      STATS.depth += completed; STATS.moves++;
      return best;
    }
    best = localBest;
    completed = depth;
    // Re-order the root by the completed depth's insight: search the winner first.
    roots = [best, ...roots.filter((m) => m !== best)];
    if (localVal >= WIN / 2 || localVal <= -WIN / 2) break;
    if (Date.now() > deadline) break;
  }
  STATS.depth += completed; STATS.moves++;
  return best;
}

/* --- level policies ------------------------------------------------------- */

const toIdx = (m) => (m === null || m === undefined ? null : [(m / SIZE) | 0, m % SIZE]);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function greedy(st, ai, topK) {
  const top = ordered(st, ai, topK, 1);
  return top.length ? pick(top) : anyLegal(st, ai);
}

function strong(st, ai, { depth, branch, budget, vcfDepth, vctDepth, counterVcf, counterVct }) {
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
    if (t !== null) { STATS.vct++; return t; }
  }

  /* If the opponent has a forced win on the board, prefer a move that kills it.
   *
   * This used to look for their four-chains only, which left the obvious hole:
   * a threat sequence built on open threes was invisible, so the bot neither
   * saw it coming nor spent a move on it. That is how a human beats this
   * engine. Fours are still checked first because they are cheap and more
   * urgent; the wider threat search only runs when there is no four to find. */
  if (counterVcf) {
    const threatDeadline = Math.min(deadline, Date.now() + budget * 0.25);
    const fourD = Math.min(vcfDepth, 8);
    let threat = vcf(st, opp, fourD, threatDeadline);
    let survives = (dl) => vcf(st, opp, fourD, dl);

    if (threat === null && vctDepth && counterVct) {
      // Shallower than the attacking search: a defensive miss costs one game,
      // a defensive search that eats the budget costs every game.
      const threeD = Math.min(vctDepth, 5);
      threat = vct(st, opp, threeD, threatDeadline);
      survives = (dl) => vct(st, opp, threeD, dl);
    }

    if (threat !== null) {
      // Their own key point goes first. Taking the square they were going to
      // build on is the most likely refutation, and it will not always rank
      // highly by pattern gain -- which is why it is added rather than hoped for.
      const cands = [threat, ...ordered(st, ai, 8, 1).filter((m) => m !== threat)];
      for (const m of cands) {
        if (Date.now() > threatDeadline) break;
        if (st.b[m] || forbidden(st, m, ai)) continue;
        place(st, m, ai);
        const stillLost = isFive(st, m, ai) ? null : survives(threatDeadline);
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
  // A new position: bump the generation so nothing from the previous search is
  // trusted, and forget killers, which are tied to a tree that no longer exists.
  ttOn = opts.tt !== false;
  ttPersist = opts.ttPersist === true;
  ttGen++;
  KILLER.fill(-1); // ply-indexed, and the tree they came from has shifted
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

  return toIdx(strong(st, me, {
    depth: opts.depth ?? 10, branch: 12, budget: budgetOf(2200),
    vcfDepth: 14, vctDepth: opts.vctDepth ?? 7,
    counterVcf: true, counterVct: opts.counterVct === true,
  }));
}

// Exposed for tests only.
export const _internals = {
  STATS, newState, place, unplace, evalFor, vcf, winMove, completions, forbidden,
  // For the cache-transparency test: gains must return the same numbers whether
  // or not it is allowed to answer from the cache.
  gains,
  dropGainCache: () => GAIN_OK.fill(0),
};

export const LEVELS = [
  { id: 1, name: "Beginner", blurb: "Plays loosely, misses threats" },
  { id: 2, name: "Easy", blurb: "Blocks the obvious stuff" },
  { id: 3, name: "Medium", blurb: "Solid attack & defense" },
  { id: 4, name: "Hard", blurb: "Searches ahead, hunts forced wins" },
  { id: 5, name: "Expert", blurb: "Deep search + forcing-line solver" },
];
