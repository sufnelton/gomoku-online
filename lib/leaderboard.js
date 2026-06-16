import { zrevrangeWithScores, hgetall } from "./store.js";

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
    });
  }
  return rows;
}
