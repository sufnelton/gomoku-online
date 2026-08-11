import { describe, it, expect } from "vitest";
import { emptyBoard, isForbidden, forbiddenPoints, applyMove, freshGameState } from "./gomoku.js";

const put = (b, color, cells) => { for (const [r, c] of cells) b[r][c] = color; return b; };

describe("no double three", () => {
  it("forbids a move creating two open threes", () => {
    const b = put(emptyBoard(), "black", [[7, 5], [7, 6], [5, 7], [6, 7]]);
    expect(isForbidden(b, 7, 7, "black")).toBe(true);
  });

  it("allows a move creating only one open three", () => {
    const b = put(emptyBoard(), "black", [[7, 5], [7, 6]]);
    expect(isForbidden(b, 7, 7, "black")).toBe(false);
  });

  it("binds white too", () => {
    const b = put(emptyBoard(), "white", [[7, 5], [7, 6], [5, 7], [6, 7]]);
    expect(isForbidden(b, 7, 7, "white")).toBe(true);
  });

  it("does not count a three blocked on one side", () => {
    // horizontal three is walled in by white, so only the vertical three is real
    const b = put(emptyBoard(), "black", [[7, 5], [7, 6], [5, 7], [6, 7]]);
    b[7][4] = "white";
    b[7][8] = "white";
    expect(isForbidden(b, 7, 7, "black")).toBe(false);
  });

  it("counts broken threes (_XX_X_)", () => {
    // playing (7,7) makes 7,5 7,6 _ 7,8 -> no; use gap form: 7,5 7,7 7,8
    const b = put(emptyBoard(), "black", [[7, 5], [7, 8], [5, 7], [6, 7]]);
    // horizontal after (7,7): X . X X  with room both sides -> a three
    expect(isForbidden(b, 7, 7, "black")).toBe(true);
  });

  it("never forbids a move that completes five", () => {
    const b = put(emptyBoard(), "black", [
      [7, 3], [7, 4], [7, 5], [7, 6], // four in a row, (7,7) makes five
      [5, 7], [6, 7],                 // vertical three
      [5, 5], [6, 6],                 // diagonal three
    ]);
    expect(isForbidden(b, 7, 7, "black")).toBe(false);
  });

  it("applyMove refuses a forbidden point and leaves the game untouched", () => {
    let s = freshGameState("black");
    s = { ...s, board: put(emptyBoard(), "black", [[7, 5], [7, 6], [5, 7], [6, 7]]) };
    const after = applyMove(s, 7, 7);
    expect(after).toBe(s);
    expect(after.board[7][7]).toBe(null);
    expect(after.turn).toBe("black");
  });

  it("applyMove still accepts a legal point next to a forbidden one", () => {
    let s = freshGameState("black");
    s = { ...s, board: put(emptyBoard(), "black", [[7, 5], [7, 6], [5, 7], [6, 7]]) };
    const after = applyMove(s, 7, 4);
    expect(after.board[7][4]).toBe("black");
    expect(after.turn).toBe("white");
  });

  it("forbiddenPoints lists the intersection and ignores far-away empties", () => {
    const b = put(emptyBoard(), "black", [[7, 5], [7, 6], [5, 7], [6, 7]]);
    const pts = forbiddenPoints(b, "black").map(([r, c]) => `${r},${c}`);
    expect(pts).toContain("7,7");
    expect(pts).not.toContain("0,0");
  });

  it("an empty board has no forbidden points", () => {
    expect(forbiddenPoints(emptyBoard(), "black")).toEqual([]);
  });
});

describe("blocking exemption", () => {
  // Black's double three at (7,7): threes up column 7 and along row 7.
  const doubleThreeSetup = () => put(emptyBoard(), "black", [[7, 5], [7, 6], [5, 7], [6, 7]]);

  it("still forbids a double three that blocks nothing", () => {
    expect(isForbidden(doubleThreeSetup(), 7, 7, "black")).toBe(true);
  });

  it("allows it when it blocks a four", () => {
    const b = doubleThreeSetup();
    put(b, "white", [[4, 4], [5, 5], [6, 6], [3, 3]]); // white four, (7,7) makes five
    expect(isForbidden(b, 7, 7, "black")).toBe(false);
  });

  it("allows it when it blocks an open three", () => {
    const b = doubleThreeSetup();
    put(b, "white", [[4, 4], [5, 5], [6, 6]]); // (7,7) would give white an open four
    expect(isForbidden(b, 7, 7, "black")).toBe(false);
  });

  it("does not treat a lone opponent stone as a threat worth blocking", () => {
    const b = doubleThreeSetup();
    put(b, "white", [[5, 5]]);
    expect(isForbidden(b, 7, 7, "black")).toBe(true);
  });

  it("drops the point from forbiddenPoints once it becomes a block", () => {
    const b = doubleThreeSetup();
    const before = forbiddenPoints(b, "black").map(([r, c]) => `${r},${c}`);
    expect(before).toContain("7,7");
    put(b, "white", [[4, 4], [5, 5], [6, 6]]);
    const after = forbiddenPoints(b, "black").map(([r, c]) => `${r},${c}`);
    expect(after).not.toContain("7,7");
  });
});
