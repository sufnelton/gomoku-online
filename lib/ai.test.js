import { describe, it, expect } from "vitest";
import { SIZE, emptyBoard, isForbidden, applyMove, freshGameState, other } from "./gomoku.js";
import { chooseMove, _internals } from "./ai.js";

const { newState, place, unplace } = _internals;

const put = (b, color, cells) => { for (const [r, c] of cells) b[r][c] = color; return b; };

/* Reference scorer: the straightforward whole-board string scan the engine's
 * incremental window sum is supposed to be equivalent to. */
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

function refScore(board, player) {
  const opp = other(player);
  const code = (v) => (v === player ? "1" : v === opp ? "2" : "0");
  const lines = [];
  for (let r = 0; r < SIZE; r++) { let s = ""; for (let c = 0; c < SIZE; c++) s += code(board[r][c]); lines.push(s); }
  for (let c = 0; c < SIZE; c++) { let s = ""; for (let r = 0; r < SIZE; r++) s += code(board[r][c]); lines.push(s); }
  for (let k = -(SIZE - 1); k <= SIZE - 1; k++) { let s = ""; for (let r = 0; r < SIZE; r++) { const c = r - k; if (c >= 0 && c < SIZE) s += code(board[r][c]); } if (s.length >= 5) lines.push(s); }
  for (let k = 0; k <= 2 * (SIZE - 1); k++) { let s = ""; for (let r = 0; r < SIZE; r++) { const c = k - r; if (c >= 0 && c < SIZE) s += code(board[r][c]); } if (s.length >= 5) lines.push(s); }
  let total = 0;
  for (const raw of lines) {
    const s = "2" + raw + "2";
    for (const [p, w] of PATTERNS) { let i = 0, n = 0; while ((i = s.indexOf(p, i)) !== -1) { n++; i++; } total += n * w; }
  }
  return total;
}

function randomBoard(seed) {
  let x = seed;
  const rnd = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  const b = emptyBoard();
  for (let i = 0; i < 40; i++) {
    const r = Math.floor(rnd() * SIZE), c = Math.floor(rnd() * SIZE);
    if (!b[r][c]) b[r][c] = rnd() < 0.5 ? "black" : "white";
  }
  return b;
}

describe("incremental evaluation", () => {
  it("matches a full rescan on random positions", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const b = randomBoard(seed);
      const st = newState(b);
      expect(Math.round(st.sc[1])).toBe(refScore(b, "black"));
      expect(Math.round(st.sc[2])).toBe(refScore(b, "white"));
    }
  });

  it("place then unplace restores the score exactly", () => {
    const st = newState(randomBoard(7));
    const before = [st.sc[1], st.sc[2]];
    const empty = [];
    for (let i = 0; i < SIZE * SIZE; i++) if (!st.b[i]) empty.push(i);
    for (const idx of empty.slice(0, 30)) {
      place(st, idx, 1); unplace(st, idx);
      place(st, idx, 2); unplace(st, idx);
    }
    expect(st.sc[1]).toBeCloseTo(before[0], 6);
    expect(st.sc[2]).toBeCloseTo(before[1], 6);
  });
});

describe("bot tactics", () => {
  for (const level of [2, 3, 4, 5]) {
    it(`level ${level} takes an immediate win`, () => {
      const b = put(emptyBoard(), "white", [[7, 3], [7, 4], [7, 5], [7, 6]]);
      put(b, "black", [[9, 3], [9, 4], [10, 8]]);
      const mv = chooseMove(b, level, "white", { budget: 200 });
      expect([[7, 2], [7, 7]]).toContainEqual(mv);
    });

    it(`level ${level} blocks an immediate loss`, () => {
      const b = put(emptyBoard(), "black", [[7, 3], [7, 4], [7, 5], [7, 6]]);
      put(b, "white", [[9, 9], [10, 10]]);
      const mv = chooseMove(b, level, "white", { budget: 200 });
      expect([[7, 2], [7, 7]]).toContainEqual(mv);
    });
  }

  for (const level of [3, 4, 5]) {
    it(`level ${level} wins by running the group into six`, () => {
      // Both (7,1) and (7,6) win: five, and six through the stone at (7,7).
      const b = put(emptyBoard(), "white", [[7, 2], [7, 3], [7, 4], [7, 5], [7, 7]]);
      put(b, "black", [[10, 10], [11, 11]]);
      expect([[7, 1], [7, 6]]).toContainEqual(chooseMove(b, level, "white", { budget: 400 }));
    });
  }

  it("counts a six-making point as a winning completion", () => {
    const b = put(emptyBoard(), "white", [[7, 2], [7, 3], [7, 4], [7, 5], [7, 7]]);
    const st = newState(b);
    const pts = _internals.completions(st, 7 * SIZE + 5, 2);
    expect(pts).toContain(7 * SIZE + 1); // makes five
    expect(pts).toContain(7 * SIZE + 6); // makes six, which also wins
  });

  it("never returns a forbidden point", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const b = randomBoard(seed);
      for (const level of [1, 2, 3, 4, 5]) {
        const mv = chooseMove(b, level, "white", { budget: 120 });
        if (!mv) continue;
        expect(b[mv[0]][mv[1]]).toBe(null);
        expect(isForbidden(b, mv[0], mv[1], "white")).toBe(false);
      }
    }
  });

  it("level 5 plays the double four", () => {
    // (7,6) completes a four on the row AND on column 6 -> two five-points at
    // once, which no single block can stop.
    const b = emptyBoard();
    put(b, "white", [[7, 3], [7, 4], [7, 5], [4, 6], [5, 6], [6, 6]]);
    put(b, "black", [[7, 2], [3, 6]]);
    expect(chooseMove(b, 5, "white", { budget: 800 })).toEqual([7, 6]);
  });

  it("vcf reports no forced win when there is none", () => {
    const b = put(emptyBoard(), "white", [[7, 7], [8, 8]]);
    put(b, "black", [[7, 8], [8, 7]]);
    expect(_internals.vcf(newState(b), 2, 8, Date.now() + 500)).toBe(null);
  });

  it("takes a double three when it is the only block on a five", () => {
    // (3,7) is a double three for black, but white plays there for five, so
    // the blocking exemption makes it legal -- and it is the only move.
    const b = emptyBoard();
    put(b, "white", [[3, 3], [3, 4], [3, 5], [3, 6]]);
    put(b, "black", [[3, 2], [1, 7], [2, 7], [1, 5], [2, 6]]);
    expect(isForbidden(b, 3, 7, "black")).toBe(false);
    expect(chooseMove(b, 5, "black", { budget: 400 })).toEqual([3, 7]);
  });

  it("refuses the double three that started this: a split three is not a five", () => {
    // Reconstructed from a real game. White (4,7) blocks black's split three
    // and hands white two open threes -- legal under the old four-based
    // exemption, illegal now. (6,5) blocks the same threat cleanly.
    const b = emptyBoard();
    put(b, "white", [[2,8],[3,6],[4,6],[4,8],[5,4],[5,5],[5,7],[5,8],[6,4],[6,8],[7,3],[7,8],[8,4],[8,9],[9,6],[10,9],[10,10]]);
    put(b, "black", [[3,5],[3,7],[3,8],[5,6],[5,9],[6,6],[6,7],[7,4],[7,5],[7,6],[7,7],[8,2],[8,5],[8,6],[8,7],[8,8],[9,8],[9,9]]);
    expect(isForbidden(b, 4, 7, "white")).toBe(true);
    expect(isForbidden(b, 6, 5, "white")).toBe(false);
    expect(chooseMove(b, 5, "white", { budget: 600 })).not.toEqual([4, 7]);
  });
});

describe("bot strength", () => {
  const playGame = (levelBlack, levelWhite, budget) => {
    let s = freshGameState("black");
    for (let ply = 0; ply < 120 && !s.winner; ply++) {
      const lvl = s.turn === "black" ? levelBlack : levelWhite;
      const mv = chooseMove(s.board, lvl, s.turn, { budget });
      if (!mv) break;
      const next = applyMove(s, mv[0], mv[1]);
      if (next === s) break; // engine offered an illegal move: fail loudly below
      s = next;
    }
    return s.winner;
  };

  it("level 5 beats level 2 from both colors", () => {
    expect(playGame(5, 2, 400)).toBe("black");
    expect(playGame(2, 5, 400)).toBe("white");
  }, 180000);

  // The search is wall-clock budgeted, so how deep it gets depends on how fast
  // the host is -- and black's first-move advantage decides close games. A
  // single game per color is therefore too noisy to assert on directly against
  // a near-peer. Assert the robust form and let the deterministic tactics tests
  // above carry the real regression cover.
  const wins = (level, other) => {
    const a = playGame(level, other, undefined) === "black" ? 1 : 0;
    const b = playGame(other, level, undefined) === "white" ? 1 : 0;
    return a + b;
  };

  it("level 5 wins at least one of two against level 3", () => {
    expect(wins(5, 3)).toBeGreaterThanOrEqual(1);
  }, 300000);

  it("level 5 wins at least one of two against level 4", () => {
    expect(wins(5, 4)).toBeGreaterThanOrEqual(1);
  }, 300000);
});
