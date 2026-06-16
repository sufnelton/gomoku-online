import { describe, it, expect, beforeEach } from "vitest";
import {
  _resetMemory, hincrby, hgetall, hset, zincrby, zrevrangeWithScores,
} from "./store.js";

beforeEach(() => _resetMemory());

describe("in-memory store ops", () => {
  it("hincrby accumulates and hgetall returns fields", async () => {
    await hincrby("player:a", "wins", 1);
    await hincrby("player:a", "wins", 2);
    await hincrby("player:a", "losses", 1);
    const h = await hgetall("player:a");
    expect(Number(h.wins)).toBe(3);
    expect(Number(h.losses)).toBe(1);
  });

  it("hgetall returns {} for missing key", async () => {
    expect(await hgetall("nope")).toEqual({});
  });

  it("hset writes display fields alongside counters", async () => {
    await hincrby("player:a", "wins", 1);
    await hset("player:a", { name: "Alice" });
    const h = await hgetall("player:a");
    expect(h.name).toBe("Alice");
    expect(Number(h.wins)).toBe(1);
  });

  it("zincrby + zrevrangeWithScores returns descending by score", async () => {
    await zincrby("lb", "alice", 3);
    await zincrby("lb", "bob", 5);
    await zincrby("lb", "cara", 1);
    const top = await zrevrangeWithScores("lb", 2);
    expect(top.map((x) => x.member)).toEqual(["bob", "alice"]);
    expect(top[0].score).toBe(5);
  });
});
