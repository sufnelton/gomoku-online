import { chooseMove } from "../lib/ai.js";

/* Runs the engine off the main thread so a long search never freezes the
 * board. Messages carry a plain board array in and a [r, c] move out; the id
 * lets the page ignore replies for a position it has already moved on from. */
self.onmessage = (e) => {
  const { id, board, level, color, opts } = e.data || {};
  try {
    self.postMessage({ id, mv: chooseMove(board, level, color, opts || {}) });
  } catch (err) {
    self.postMessage({ id, mv: null, error: String(err && err.message ? err.message : err) });
  }
};
