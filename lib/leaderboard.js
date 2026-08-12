import { zrevrangeWithScores, hgetall, hset, hincrby, zincrby } from "./store.js";
import { cleanName } from "./lobby.js";

export async function getLeaderboard(top = 20) {
  const ranked = await zrevrangeWithScores("lb:wins", top);
  const rows = [];
  for (const { member } of ranked) {
    const p = await hgetall(`player:${member}`);
    const wins = Number(p.wins || 0);
    const losses = Number(p.losses || 0);
    const draws = Number(p.draws || 0);
    const decided = wins + losses;
    rows.push({
      name: p.name || member,
      wins,
      losses,
      draws,
      winRate: decided > 0 ? Math.round((100 * wins) / decided) : 0,
      lastAt: p.lastAt || null,
    });
  }
  return rows;
}

/* Wins against the computer, level 5 only. Kept in its own list so an
 * unverifiable claim never sits in the head-to-head table beside real games
 * between two people. Spoofable by design, like the rest of the board. */
export async function recordCpuWin(name, level) {
  if (Number(level) !== 5) return { error: "not_level_5" };
  const display = cleanName(name);
  const key = display.toLowerCase();
  await hset(`cpu:${key}`, { name: display, lastAt: new Date().toISOString() });
  await hincrby(`cpu:${key}`, "wins", 1);
  await zincrby("lb:cpu5", key, 1);
  return { ok: true };
}

export async function getCpuLeaderboard(top = 20) {
  const ranked = await zrevrangeWithScores("lb:cpu5", top);
  const rows = [];
  for (const { member } of ranked) {
    const p = await hgetall(`cpu:${member}`);
    rows.push({ name: p.name || member, wins: Number(p.wins || 0), lastAt: p.lastAt || null });
  }
  return rows;
}
