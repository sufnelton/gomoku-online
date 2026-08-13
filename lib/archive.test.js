import { describe, it, expect, beforeEach } from "vitest";
import { SIZE, applyMove, freshGameState } from "./gomoku.js";
import { loadGames, saveGame, clearGames, tally, stateAt, resumeFrom, LIMIT, KEY } from "./archive.js";

// Minimal localStorage: the archive is the one part of this codebase whose
// whole job is talking to it.
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
});

// A real finished game: black runs five down column 7.
function playedGame() {
  let s = freshGameState("black");
  const moves = [[7, 7], [0, 0], [8, 7], [0, 1], [9, 7], [0, 2], [10, 7], [0, 3], [11, 7]];
  for (const [r, c] of moves) s = applyMove(s, r, c);
  return s;
}

const save = (s, over = {}) =>
  saveGame(s, { mode: "ai", youAre: "black", finishedAt: 1000, ...over });

describe("game archive", () => {
  it("stores a finished game and reads it back", () => {
    const s = playedGame();
    expect(s.winner).toBe("black");
    save(s);
    const [g] = loadGames();
    expect(g.winner).toBe("black");
    expect(g.history).toHaveLength(9);
    expect(g.history[0]).toEqual({ r: 7, c: 7, color: "black" });
  });

  it("keeps only the last five, newest first", () => {
    for (let i = 0; i < LIMIT + 3; i++) save(playedGame(), { finishedAt: 1000 + i });
    const games = loadGames();
    expect(games).toHaveLength(LIMIT);
    expect(games[0].finishedAt).toBe(1000 + LIMIT + 2);
    expect(games[LIMIT - 1].finishedAt).toBe(1000 + 3);
  });

  it("ignores a game with no moves", () => {
    save(freshGameState("black"));
    expect(loadGames()).toHaveLength(0);
  });

  it("survives corrupt storage instead of taking the lobby down", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadGames()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify([{ history: [{ r: "x", c: 1, color: "black" }] }]));
    expect(loadGames()).toEqual([]);
  });

  it("counts wins and losses from the archiving player's side", () => {
    save(playedGame(), { youAre: "black", finishedAt: 1 });
    save(playedGame(), { youAre: "white", finishedAt: 2 });
    save(playedGame(), { youAre: null, mode: "local", finishedAt: 3 });
    const t = tally(loadGames());
    expect(t).toMatchObject({ wins: 1, losses: 1, decidedElsewhere: 1, total: 3 });
  });

  describe("replay", () => {
    it("rebuilds the position at any ply", () => {
      save(playedGame());
      const [g] = loadGames();
      expect(stateAt(g, 0).history).toHaveLength(0);
      expect(stateAt(g, 0).board[7][7]).toBe(null);
      const mid = stateAt(g, 3);
      expect(mid.board[7][7]).toBe("black");
      expect(mid.board[9][7]).toBe(null);
      expect(mid.turn).toBe("white"); // 3 moves played, white to move
    });

    it("only shows the winner at the end of the replay", () => {
      save(playedGame());
      const [g] = loadGames();
      expect(stateAt(g, 5).winner).toBe(null);
      expect(stateAt(g, g.history.length).winner).toBe("black");
    });

    it("highlights the winning five, and only at the end", () => {
      save(playedGame());
      const [g] = loadGames();
      expect(stateAt(g, 7).winLine).toEqual([]);
      const end = stateAt(g, g.history.length);
      expect(end.winLine).toHaveLength(5);
      // black ran 7..11 down column 7
      expect(end.winLine.every(([, c]) => c === 7)).toBe(true);
    });

    it("clamps a ply outside the game", () => {
      save(playedGame());
      const [g] = loadGames();
      expect(stateAt(g, -5).history).toHaveLength(0);
      expect(stateAt(g, 999).history).toHaveLength(9);
    });
  });

  describe("resuming", () => {
    it("takes the last move back and hands over a live, winnerless game", () => {
      save(playedGame());
      const [g] = loadGames();
      const s = resumeFrom(g, g.history.length - 1);
      expect(s.winner).toBe(null);
      expect(s.winLine).toEqual([]);
      expect(s.history).toHaveLength(8);
      expect(s.turn).toBe("black"); // 8 played, black to move -- the move it lost to
    });

    it("the resumed game is playable and can be won again", () => {
      save(playedGame());
      const [g] = loadGames();
      let s = resumeFrom(g, g.history.length - 1);
      s = applyMove(s, 11, 7); // replay the winning move
      expect(s.winner).toBe("black");
    });

    it("resuming leaves the archived result untouched", () => {
      save(playedGame());
      const [g] = loadGames();
      resumeFrom(g, 2);
      const [again] = loadGames();
      expect(again.winner).toBe("black");
      expect(again.history).toHaveLength(9);
    });
  });

  it("clears", () => {
    save(playedGame());
    expect(clearGames()).toEqual([]);
    expect(loadGames()).toEqual([]);
  });
});
