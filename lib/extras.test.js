import { describe, it, expect, beforeEach } from "vitest";
import { _resetMemory } from "./store.js";
import { createLobby, joinLobby, getState } from "./lobby.js";
import { recordCpuWin, getCpuLeaderboard, getLeaderboard } from "./leaderboard.js";

const P1 = "player-one";
const P2 = "player-two";

beforeEach(() => _resetMemory());

describe("passphrase gate", () => {
  it("lets anyone in when no passphrase was set", async () => {
    const { code } = await createLobby(P1, "Alice");
    const r = await joinLobby(P2, "Bob", code);
    expect(r.color).toBe("white");
  });

  it("refuses a join with the wrong passphrase, and accepts the right one", async () => {
    const { code } = await createLobby(P1, "Alice", "mushroom");
    expect((await joinLobby(P2, "Bob", code, "slime")).error).toBe("bad_pass");
    expect((await joinLobby(P2, "Bob", code)).error).toBe("bad_pass");
    expect((await joinLobby(P2, "Bob", code, "mushroom")).color).toBe("white");
  });

  it("never sends the passphrase to a client", async () => {
    const created = await createLobby(P1, "Alice", "mushroom");
    expect(created.state.pass).toBeUndefined();
    expect(created.state.locked).toBe(true);

    // A lobby code is guessable, so the public read must not leak it either.
    const seen = await getState(created.code);
    expect(seen.state.pass).toBeUndefined();
    expect(JSON.stringify(seen)).not.toContain("mushroom");
  });

  it("marks an open lobby as unlocked", async () => {
    const created = await createLobby(P1, "Alice");
    expect(created.state.locked).toBe(false);
  });
});

describe("level 5 computer leaderboard", () => {
  it("records a level 5 win", async () => {
    expect(await recordCpuWin("Elton", 5)).toEqual({ ok: true });
    const rows = await getCpuLeaderboard();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Elton", wins: 1 });
  });

  it("refuses anything below level 5", async () => {
    for (const lvl of [1, 2, 3, 4]) {
      expect((await recordCpuWin("Elton", lvl)).error).toBe("not_level_5");
    }
    expect(await getCpuLeaderboard()).toHaveLength(0);
  });

  it("accumulates wins and ranks by them", async () => {
    await recordCpuWin("Elton", 5);
    await recordCpuWin("Elton", 5);
    await recordCpuWin("Keith", 5);
    const rows = await getCpuLeaderboard();
    expect(rows[0]).toMatchObject({ name: "Elton", wins: 2 });
    expect(rows[1]).toMatchObject({ name: "Keith", wins: 1 });
  });

  it("stays out of the head-to-head board", async () => {
    await recordCpuWin("Elton", 5);
    expect(await getLeaderboard()).toHaveLength(0);
  });

  it("stamps a time on the result", async () => {
    await recordCpuWin("Elton", 5);
    const [row] = await getCpuLeaderboard();
    expect(row.lastAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(row.lastAt))).toBe(false);
  });
});
