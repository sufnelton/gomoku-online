/* Speed bench: nodes and completed depth in a FIXED time budget.
 *
 * Wall-clock is the wrong measure for this engine -- it spends a budget rather
 * than racing a clock, so a faster engine finishes in the same seconds having
 * searched more. Nodes per second and average completed depth are what a speed
 * change actually moves.
 *
 * Run: node scripts/bench.mjs            (current engine)
 *      node scripts/bench.mjs --vs-base  (also runs lib/_baseline_ai.js)
 *
 * Strength is NOT measured here. That is scripts/tourney.mjs, and nothing is a
 * result until it has run.
 */
import { applyMove, freshGameState } from "../lib/gomoku.js";

const POSITIONS = [
  [[7, 7], [7, 8], [8, 7], [6, 8], [8, 8]],
  [[7, 7], [8, 8], [6, 8], [8, 6], [7, 9], [7, 6]],
  [[6, 6], [7, 7], [8, 7], [6, 7], [7, 6], [8, 8], [5, 6]],
  [[7, 7], [6, 6], [8, 8], [6, 8], [6, 7], [7, 6], [5, 7], [9, 7]],
];
const BUDGET = 2200;
const MOVES_PER = 3;

async function run(modPath, label) {
  const { chooseMove, STATS } = await import(modPath);
  STATS.nodes = 0; STATS.depth = 0; STATS.moves = 0; STATS.vct = 0;
  const t0 = Date.now();
  for (const op of POSITIONS) {
    let s = freshGameState("black");
    for (const [r, c] of op) s = applyMove(s, r, c);
    for (let i = 0; i < MOVES_PER && !s.winner; i++) {
      const mv = chooseMove(s.board, 5, s.turn, { budget: BUDGET });
      if (!mv) break;
      s = applyMove(s, mv[0], mv[1]);
    }
  }
  const secs = (Date.now() - t0) / 1000;
  return {
    label, secs,
    nodes: STATS.nodes,
    nps: STATS.nodes / secs,
    depth: STATS.moves ? STATS.depth / STATS.moves : 0,
    searched: STATS.moves,
    vct: STATS.vct,
  };
}

const show = (r) =>
  `${r.label.padEnd(10)} ${(r.nodes / 1000).toFixed(0).padStart(8)}k nodes  ` +
  `${(r.nps / 1000).toFixed(0).padStart(6)}k nps  ` +
  `depth ${r.depth.toFixed(2).padStart(5)}  ` +
  `(${r.searched} searched moves, ${r.vct} vct, ${r.secs.toFixed(1)}s)`;

const now = await run("../lib/ai.js", "current");
if (process.argv.includes("--vs-base")) {
  const base = await run("../lib/_baseline_ai.js", "baseline");
  console.log("\n" + show(base));
  console.log(show(now));
  const nps = ((now.nps / base.nps - 1) * 100);
  const dep = now.depth - base.depth;
  console.log(`\nnodes/sec  ${nps >= 0 ? "+" : ""}${nps.toFixed(1)}%`);
  console.log(`avg depth  ${dep >= 0 ? "+" : ""}${dep.toFixed(2)} ply\n`);
} else {
  console.log("\n" + show(now) + "\n");
}
