/* Where does a move's thinking time actually go?
 *
 * Run: node --cpu-prof --cpu-prof-dir=.prof scripts/profile.mjs
 *      node scripts/profile.mjs --report      (reads the newest .cpuprofile)
 *
 * Optimising the engine by eye has a bad record here -- the thing that looks
 * hot and the thing that is hot keep turning out to be different functions.
 */
import { chooseMove } from "../lib/ai.js";
import { applyMove, freshGameState } from "../lib/gomoku.js";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

if (process.argv.includes("--report")) {
  const dir = ".prof";
  const files = readdirSync(dir).filter((f) => f.endsWith(".cpuprofile"))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) { console.log("no profile found; run the profiling command first"); process.exit(1); }
  const p = JSON.parse(readFileSync(join(dir, files[0].f), "utf8"));

  // Self time per node, from the sample stream rather than the tree: a
  // recursive search shows the same function at many depths.
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const self = new Map();
  for (let i = 0; i < p.samples.length; i++) {
    const dt = p.timeDeltas[i] || 0;
    const n = byId.get(p.samples[i]);
    if (!n) continue;
    const name = n.callFrame.functionName || "(anonymous)";
    self.set(name, (self.get(name) || 0) + dt);
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
  console.log(`\nself time, ${(total / 1000).toFixed(0)}ms sampled\n`);
  for (const [name, t] of rows) {
    const pct = (t / total) * 100;
    console.log(`  ${pct.toFixed(1).padStart(5)}%  ${(t / 1000).toFixed(0).padStart(5)}ms  ${name}`);
  }
  process.exit(0);
}

// Representative mid-game positions rather than an empty board: the empty
// board is the one position the engine never has to think hard about.
const OPENINGS = [
  [[7, 7], [7, 8], [8, 7], [6, 8], [8, 8]],
  [[7, 7], [8, 8], [6, 8], [8, 6], [7, 9], [7, 6]],
  [[6, 6], [7, 7], [8, 7], [6, 7], [7, 6], [8, 8], [5, 6]],
];

let moves = 0;
const t0 = Date.now();
for (const op of OPENINGS) {
  let s = freshGameState("black");
  for (const [r, c] of op) s = applyMove(s, r, c);
  for (let i = 0; i < 4 && !s.winner; i++) {
    const mv = chooseMove(s.board, 5, s.turn);
    if (!mv) break;
    s = applyMove(s, mv[0], mv[1]);
    moves++;
  }
}
console.log(`${moves} moves in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
