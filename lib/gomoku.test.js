import { describe, it, expect } from "vitest";
import { SIZE, emptyBoard, findWin, applyMove, freshGameState, other } from "./gomoku.js";

describe("gomoku logic", () => {
  it("emptyBoard is 15x15 of null", () => {
    const b = emptyBoard();
    expect(b.length).toBe(15);
    expect(b[0].length).toBe(15);
    expect(b[7][7]).toBe(null);
  });

  it("other flips color", () => {
    expect(other("black")).toBe("white");
    expect(other("white")).toBe("black");
  });

  it("findWin detects a horizontal five", () => {
    const b = emptyBoard();
    for (let c = 3; c <= 7; c++) b[5][c] = "black";
    expect(findWin(b, 5, 5)).not.toBe(null);
    expect(findWin(b, 5, 5).length).toBe(5);
  });

  it("findWin detects a diagonal five", () => {
    const b = emptyBoard();
    for (let i = 0; i < 5; i++) b[i][i] = "white";
    expect(findWin(b, 2, 2)).not.toBe(null);
  });

  it("findWin returns null for four in a row", () => {
    const b = emptyBoard();
    for (let c = 0; c < 4; c++) b[0][c] = "black";
    expect(findWin(b, 0, 0)).toBe(null);
  });

  it("applyMove places a stone and flips turn", () => {
    const s = freshGameState("black");
    const n = applyMove(s, 7, 7);
    expect(n.board[7][7]).toBe("black");
    expect(n.turn).toBe("white");
    expect(n.history.length).toBe(1);
  });

  it("applyMove sets winner on a winning move", () => {
    let s = freshGameState("black");
    const blacks = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
    const whites = [[0, 5], [1, 5], [2, 5], [3, 5]];
    for (let i = 0; i < 4; i++) {
      s = applyMove(s, blacks[i][0], blacks[i][1]); // black
      s = applyMove(s, whites[i][0], whites[i][1]); // white
    }
    s = applyMove(s, blacks[4][0], blacks[4][1]); // black completes five
    expect(s.winner).toBe("black");
    expect(s.endReason).toBe("five");
    expect(s.winLine.length).toBeGreaterThanOrEqual(5);
  });

  it("six in a row is not a win", () => {
    const b = emptyBoard();
    for (let c = 3; c <= 8; c++) b[7][c] = "black";
    expect(findWin(b, 7, 5)).toBe(null);
    expect(findWin(b, 7, 3)).toBe(null);
  });

  it("still wins on a five that sits next to an unrelated stone", () => {
    const b = emptyBoard();
    for (let c = 3; c <= 7; c++) b[7][c] = "black";
    b[7][8] = "white";
    expect(findWin(b, 7, 5).length).toBe(5);
  });

  it("applyMove does not end the game when a move makes six", () => {
    let s = freshGameState("black");
    const board = emptyBoard();
    [[7, 3], [7, 4], [7, 5], [7, 6], [7, 8]].forEach(([r, c]) => (board[r][c] = "black"));
    s = { ...s, board };
    const after = applyMove(s, 7, 7); // joins into a run of six
    expect(after.board[7][7]).toBe("black");
    expect(after.winner).toBe(null);
    expect(after.turn).toBe("white");
  });

  it("applyMove is a no-op on an occupied cell or finished game", () => {
    let s = freshGameState("black");
    s = applyMove(s, 7, 7);
    const same = applyMove(s, 7, 7); // occupied
    expect(same).toBe(s);
  });
});
