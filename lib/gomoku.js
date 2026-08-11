export const SIZE = 15;
export const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

export const emptyBoard = () =>
  Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

export const other = (c) => (c === "black" ? "white" : "black");

export function findWin(board, r, c) {
  const color = board[r][c];
  if (!color) return null;
  for (const [dr, dc] of DIRS) {
    const line = [[r, c]];
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr][cc] === color) { line.push([rr, cc]); rr += dr; cc += dc; }
    rr = r - dr; cc = c - dc;
    while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr][cc] === color) { line.unshift([rr, cc]); rr -= dr; cc -= dc; }
    if (line.length >= 5) return line; // five or more; an overline wins too
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Forbidden moves: no double three.
 *
 * A "three" is a formation that can be turned into a straight (open) four by
 * adding one stone. Placing a stone that creates two such threes at once is
 * illegal for BOTH colors here. Completing five always wins and is never
 * forbidden.
 *
 * The core takes a codeAt(r, c) reader returning 0 empty / 1 the mover's stone
 * / 2 opponent-or-off-board, with (r, c) already reading as 1. That keeps one
 * copy of the rule usable over both the 2D string board and the AI's typed
 * array board.
 * ------------------------------------------------------------------------- */

function hasOpenFourCovering(codes, p, q) {
  for (let i = 0; i + 5 < codes.length; i++) {
    if (codes[i] !== 0 || codes[i + 5] !== 0) continue;
    if (codes[i + 1] !== 1 || codes[i + 2] !== 1 || codes[i + 3] !== 1 || codes[i + 4] !== 1) continue;
    if (p >= i + 1 && p <= i + 4 && q >= i + 1 && q <= i + 4) return true;
  }
  return false;
}

function isOpenThreeDir(codeAt, r, c, dr, dc) {
  const codes = new Array(11);
  for (let i = 0; i < 11; i++) codes[i] = codeAt(r + (i - 5) * dr, c + (i - 5) * dc);
  let run = 1;
  for (let i = 6; i < 11 && codes[i] === 1; i++) run++;
  for (let i = 4; i >= 0 && codes[i] === 1; i--) run++;
  if (run >= 4) return false; // already a four in this direction, not a three
  for (let q = 1; q < 10; q++) {
    if (q === 5 || codes[q] !== 0) continue;
    codes[q] = 1;
    const open = hasOpenFourCovering(codes, 5, q);
    codes[q] = 0;
    if (open) return true;
  }
  return false;
}

export function makesDoubleThree(codeAt, r, c) {
  // Cheap exact prefilter: a three needs two more friendly stones on that line
  // within four cells, so two threes need two such directions. Skips the full
  // scan for the overwhelming majority of points.
  let live = 0;
  for (const [dr, dc] of DIRS) {
    let n = 0;
    for (let k = -4; k <= 4; k++) if (k && codeAt(r + dr * k, c + dc * k) === 1) n++;
    if (n >= 2) live++;
  }
  if (live < 2) return false;

  for (const [dr, dc] of DIRS) {
    let run = 1;
    for (let k = 1; codeAt(r + dr * k, c + dc * k) === 1; k++) run++;
    for (let k = 1; codeAt(r - dr * k, c - dc * k) === 1; k++) run++;
    if (run >= 5) return false; // a winning five is always legal
  }
  let threes = 0;
  for (const [dr, dc] of DIRS) {
    if (isOpenThreeDir(codeAt, r, c, dr, dc) && ++threes >= 2) return true;
  }
  return false;
}

/* Would the OPPONENT playing this same point WIN there?
 * Only stopping an actual five buys you a double three. Blocking a four or a
 * split three does not: those still leave you a move, so you were never forced
 * onto the square. This also covers an open four, since both of its ends are
 * five-making points. */
export function blocksThreat(codeAt, r, c) {
  for (const [dr, dc] of DIRS) {
    let run = 1;
    for (let k = 1; codeAt(r + dr * k, c + dc * k) === 1; k++) run++;
    for (let k = 1; codeAt(r - dr * k, c - dc * k) === 1; k++) run++;
    if (run >= 5) return true;
  }
  return false;
}

// A double three is illegal UNLESS it also blocks a real opponent threat.
export function forbiddenByRule(mineAt, oppAt, r, c) {
  if (!makesDoubleThree(mineAt, r, c)) return false;
  return !blocksThreat(oppAt, r, c);
}

export function isForbidden(board, r, c, color) {
  if (board[r][c]) return false;
  const readerFor = (who) => (rr, cc) =>
    rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE ? 2
      : board[rr][cc] === who ? 1 : board[rr][cc] ? 2 : 0;

  board[r][c] = color;
  const double = makesDoubleThree(readerFor(color), r, c);
  board[r][c] = null;
  if (!double) return false;

  const opp = other(color);
  board[r][c] = opp;
  const blocks = blocksThreat(readerFor(opp), r, c);
  board[r][c] = null;
  return !blocks;
}

export function forbiddenPoints(board, color) {
  const out = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (board[r][c]) continue;
    let near = false;
    for (let dr = -2; dr <= 2 && !near; dr++) for (let dc = -2; dc <= 2; dc++) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc]) { near = true; break; }
    }
    if (near && isForbidden(board, r, c, color)) out.push([r, c]);
  }
  return out;
}

export const freshGameState = (turn = "black") => ({
  board: emptyBoard(),
  turn,
  history: [],
  winner: null,
  winLine: [],
  endReason: null,
});

export function applyMove(state, r, c) {
  if (state.winner || state.board[r][c]) return state;
  if (isForbidden(state.board, r, c, state.turn)) return state;
  const board = state.board.map((row) => row.slice());
  board[r][c] = state.turn;
  const line = findWin(board, r, c);
  const full = state.history.length + 1 === SIZE * SIZE;
  const history = [...state.history, { r, c, color: state.turn }];
  return {
    ...state,
    board,
    history,
    winLine: line || [],
    winner: line ? state.turn : full ? "draw" : null,
    endReason: line ? "five" : full ? "draw" : null,
    turn: line ? state.turn : other(state.turn),
  };
}
