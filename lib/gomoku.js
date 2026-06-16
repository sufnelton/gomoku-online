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
    if (line.length >= 5) return line;
  }
  return null;
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
