import { describe, it, expect, beforeEach } from "vitest";
import { _resetMemory } from "./store.js";
import {
  createLobby, joinLobby, moveInLobby, rematchLobby, resignLobby, chatMessage, getState,
} from "./lobby.js";
import { getLeaderboard } from "./leaderboard.js";

const P1 = "player-one";
const P2 = "player-two";
const P3 = "player-three";

beforeEach(() => _resetMemory());

// Play black to a vertical five down column 0, white answering in column 5.
// Returns the final move result (black wins).
async function blackWins(code, blackId, whiteId) {
  let last;
  for (let i = 0; i < 4; i++) {
    last = await moveInLobby(blackId, code, i, 0);
    await moveInLobby(whiteId, code, i, 5);
  }
  last = await moveInLobby(blackId, code, 4, 0); // completes five
  return last;
}

/* The hole this suite exists to keep shut.
 *
 * A playerId IS the credential -- every write action authenticates on nothing
 * else -- and the state used to ship both of them to anyone holding a code.
 * With 331,776 codes that was a sweepable, unauthenticated impersonation of
 * every live game, and the passphrase did not help because it gates `join` and
 * this was readable without joining. */
describe("what a client is allowed to see", () => {
  it("never returns a player id, in any reply", async () => {
    const c = await createLobby(P1, "Alice", "hunter2");
    const j = await joinLobby(P2, "Bob", c.code, "hunter2");
    const m = await moveInLobby(P1, c.code, 7, 7);
    const ch = await chatMessage(P2, c.code, "hi");
    const st = await getState(c.code, P1);
    for (const r of [c, j, m, ch, st]) {
      const blob = JSON.stringify(r.state);
      expect(blob).not.toContain(P1);
      expect(blob).not.toContain(P2);
      expect(r.state.players).toBeUndefined();
    }
  });

  it("never returns the passphrase, only that there is one", async () => {
    const { code, state } = await createLobby(P1, "Alice", "hunter2");
    expect(JSON.stringify(state)).not.toContain("hunter2");
    expect(state.locked).toBe(true);
    expect((await createLobby(P3, "Carol")).state.locked).toBe(false);
    expect(code).toMatch(/^[A-Z]{4}$/);
  });

  it("holding the code is not enough to read the game", async () => {
    const { code } = await createLobby(P1, "Alice");
    await joinLobby(P2, "Bob", code);
    await chatMessage(P1, code, "something private");
    expect(await getState(code, "a-stranger")).toEqual({ error: "not_a_player" });
    expect(await getState(code, undefined)).toEqual({ error: "not_a_player" });
  });

  it("tells each player their own colour and nobody else's identity", async () => {
    const { code } = await createLobby(P1, "Alice");
    await joinLobby(P2, "Bob", code);
    expect((await getState(code, P1)).state.youAre).toBe("black");
    expect((await getState(code, P2)).state.youAre).toBe("white");
  });

  it("reports the new colour after a rematch swaps sides", async () => {
    const { code } = await createLobby(P1, "Alice");
    await joinLobby(P2, "Bob", code);
    await rematchLobby(P1, code);
    expect((await getState(code, P1)).state.youAre).toBe("white");
    expect((await getState(code, P2)).state.youAre).toBe("black");
  });

  it("exposes seat occupancy without exposing who is in the seat", async () => {
    const { code } = await createLobby(P1, "Alice");
    expect((await getState(code, P1)).state.seats).toEqual({ black: true, white: false });
    await joinLobby(P2, "Bob", code);
    expect((await getState(code, P1)).state.seats).toEqual({ black: true, white: true });
  });
});

describe("lobby core", () => {
  it("create assigns black + a 4-letter code and stores the name", async () => {
    const r = await createLobby(P1, "Alice");
    expect(r.code).toMatch(/^[A-Z]{4}$/);
    expect(r.color).toBe("black");
    expect(r.state.seats).toEqual({ black: true, white: false });
    expect(r.state.youAre).toBe("black");
    expect(r.state.names.black).toBe("Alice");
    expect(r.state.record).toEqual({ black: 0, white: 0, draws: 0 });
  });

  it("blank name falls back to Guest", async () => {
    const r = await createLobby(P1, "   ");
    expect(r.state.names.black).toBe("Guest");
  });

  it("join assigns white + stores the joiner name", async () => {
    const { code } = await createLobby(P1, "Alice");
    const r = await joinLobby(P2, "Bob", code);
    expect(r.color).toBe("white");
    expect(r.state.names.white).toBe("Bob");
  });

  it("join rejects a full lobby and a missing code", async () => {
    const { code } = await createLobby(P1, "Alice");
    await joinLobby(P2, "Bob", code);
    expect((await joinLobby(P3, "Cara", code)).error).toBe("full");
    expect((await joinLobby(P3, "Cara", "ZZZZ")).error).toBe("not_found");
  });

  it("move enforces turn order and ownership", async () => {
    const { code } = await createLobby(P1, "Alice");
    await joinLobby(P2, "Bob", code);
    expect((await moveInLobby(P2, code, 7, 7)).error).toBe("not_your_turn");
    const r = await moveInLobby(P1, code, 7, 7);
    expect(r.state.board[7][7]).toBe("black");
    expect((await moveInLobby(P2, code, 7, 7)).error).toBe("occupied");
  });

  it("move rejects when there is no opponent yet", async () => {
    const { code } = await createLobby(P1, "Alice");
    expect((await moveInLobby(P1, code, 7, 7)).error).toBe("no_opponent");
  });
});

describe("chat", () => {
  it("appends messages with color + name; rejects empty", async () => {
    const { code } = await createLobby(P1, "Alice");
    await joinLobby(P2, "Bob", code);
    expect((await chatMessage(P1, code, "   ")).error).toBe("bad_request");
    const r = await chatMessage(P1, code, "hi there");
    const msg = r.state.chat[0];
    expect(msg.color).toBe("black");
    expect(msg.name).toBe("Alice");
    expect(msg.text).toBe("hi there");
    expect(msg.seq).toBe(1);
  });

  it("trims to 200 chars and caps history at 50", async () => {
    const { code } = await createLobby(P1, "Alice");
    await joinLobby(P2, "Bob", code);
    const long = "x".repeat(500);
    const r1 = await chatMessage(P1, code, long);
    expect(r1.state.chat[0].text.length).toBe(200);
    for (let i = 0; i < 60; i++) await chatMessage(P1, code, `m${i}`);
    const r = await getState(code, P1);
    expect(r.state.chat.length).toBe(50);
    expect(r.state.chat[r.state.chat.length - 1].text).toBe("m59");
  });

  it("rejects a non-player", async () => {
    const { code } = await createLobby(P1, "Alice");
    await joinLobby(P2, "Bob", code);
    expect((await chatMessage("stranger", code, "hi")).error).toBe("not_a_player");
  });
});

describe("results, head-to-head, leaderboard", () => {
  it("a win records stats, leaderboard, and head-to-head", async () => {
    const { code } = await createLobby(P1, "Alice");
    await joinLobby(P2, "Bob", code);
    const r = await blackWins(code, P1, P2);
    expect(r.state.winner).toBe("black");
    expect(r.state.record).toEqual({ black: 1, white: 0, draws: 0 });

    const lb = await getLeaderboard(10);
    const alice = lb.find((x) => x.name === "Alice");
    expect(alice.wins).toBe(1);
    expect(alice.winRate).toBe(100);
    // Bob has 0 wins so does not appear on a wins-ranked board.
    expect(lb.find((x) => x.name === "Bob")).toBeUndefined();
  });

  it("resign records the opponent as winner", async () => {
    const { code } = await createLobby(P1, "Alice");
    await joinLobby(P2, "Bob", code);
    const r = await resignLobby(P1, code);
    expect(r.state.winner).toBe("white");
    expect(r.state.record).toEqual({ black: 0, white: 1, draws: 0 });
    const lb = await getLeaderboard(10);
    expect(lb.find((x) => x.name === "Bob").wins).toBe(1);
  });

  it("recordResult is a no-op without an opponent", async () => {
    const { code } = await createLobby(P1, "Alice");
    const r = await resignLobby(P1, code); // no white joined
    expect(r.state.winner).toBe("white");
    expect(r.state.record).toEqual({ black: 0, white: 0, draws: 0 });
    expect(await getLeaderboard(10)).toEqual([]);
  });

  it("rematch swaps names, keeps chat, and the h2h record persists", async () => {
    const { code } = await createLobby(P1, "Alice");
    await joinLobby(P2, "Bob", code);
    await chatMessage(P1, code, "gg");
    await blackWins(code, P1, P2); // Alice (black) wins game 1
    const rm = await rematchLobby(P1, code);
    expect(rm.state.names.black).toBe("Bob");   // swapped
    expect(rm.state.names.white).toBe("Alice");
    expect(rm.state.chat.length).toBe(1);       // chat kept
    // record reflects the same two people regardless of which side they're on now.
    expect(rm.state.record).toEqual({ black: 0, white: 1, draws: 0 }); // Alice(now white) has the win
  });
});
