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

describe("lobby core", () => {
  it("create assigns black + a 4-letter code and stores the name", async () => {
    const r = await createLobby(P1, "Alice");
    expect(r.code).toMatch(/^[A-Z]{4}$/);
    expect(r.color).toBe("black");
    expect(r.state.players.black).toBe(P1);
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
    const r = await getState(code);
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
