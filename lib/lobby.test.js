import { describe, it, expect, beforeEach } from "vitest";
import { _resetMemory } from "./store.js";
import {
  createLobby, joinLobby, moveInLobby, rematchLobby, resignLobby, getState,
} from "./lobby.js";

const P1 = "player-one";
const P2 = "player-two";
const P3 = "player-three";

beforeEach(() => _resetMemory());

describe("lobby operations", () => {
  it("create assigns the creator to black and returns a 4-letter code", async () => {
    const r = await createLobby(P1);
    expect(r.code).toMatch(/^[A-Z]{4}$/);
    expect(r.color).toBe("black");
    expect(r.state.players.black).toBe(P1);
    expect(r.state.players.white).toBe(null);
    expect(r.state.version).toBe(1);
  });

  it("join assigns the second player to white", async () => {
    const { code } = await createLobby(P1);
    const r = await joinLobby(P2, code);
    expect(r.color).toBe("white");
    expect(r.state.players.white).toBe(P2);
  });

  it("join the same player twice rejoins, not full", async () => {
    const { code } = await createLobby(P1);
    const r = await joinLobby(P1, code);
    expect(r.color).toBe("black");
  });

  it("join rejects a full lobby and a missing code", async () => {
    const { code } = await createLobby(P1);
    await joinLobby(P2, code);
    expect((await joinLobby(P3, code)).error).toBe("full");
    expect((await joinLobby(P3, "ZZZZ")).error).toBe("not_found");
  });

  it("move enforces turn order and ownership", async () => {
    const { code } = await createLobby(P1);
    await joinLobby(P2, code);
    expect((await moveInLobby(P2, code, 7, 7)).error).toBe("not_your_turn"); // white can't start
    const r = await moveInLobby(P1, code, 7, 7); // black starts
    expect(r.state.board[7][7]).toBe("black");
    expect(r.state.turn).toBe("white");
    expect((await moveInLobby(P1, code, 8, 8)).error).toBe("not_your_turn"); // not black's turn now
    expect((await moveInLobby(P2, code, 7, 7)).error).toBe("occupied");
  });

  it("move rejects when there is no opponent yet", async () => {
    const { code } = await createLobby(P1);
    expect((await moveInLobby(P1, code, 7, 7)).error).toBe("no_opponent");
  });

  it("resign makes the opponent win", async () => {
    const { code } = await createLobby(P1);
    await joinLobby(P2, code);
    const r = await resignLobby(P1, code);
    expect(r.state.winner).toBe("white");
    expect(r.state.endReason).toBe("resign");
  });

  it("rematch resets the board and swaps colors", async () => {
    const { code } = await createLobby(P1);
    await joinLobby(P2, code);
    await moveInLobby(P1, code, 7, 7);
    const r = await rematchLobby(P1, code);
    expect(r.state.board[7][7]).toBe(null);
    expect(r.state.winner).toBe(null);
    expect(r.state.players.black).toBe(P2); // swapped
    expect(r.state.players.white).toBe(P1);
    expect(r.state.turn).toBe("black");
  });

  it("getState returns current lobby or not_found", async () => {
    const { code } = await createLobby(P1);
    expect((await getState(code)).state.code).toBe(code);
    expect((await getState("ZZZZ")).error).toBe("not_found");
  });

  it("every mutation bumps version", async () => {
    const { code, state } = await createLobby(P1);
    let v = state.version;
    const j = await joinLobby(P2, code);
    expect(j.state.version).toBeGreaterThan(v);
    v = j.state.version;
    const m = await moveInLobby(P1, code, 7, 7);
    expect(m.state.version).toBeGreaterThan(v);
  });
});
