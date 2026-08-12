/* Strength harness. Every engine claim this project makes is measured with
 * this, not asserted. Two configs play the same openings with colours
 * swapped, so black's first-move advantage lands on both equally -- a
 * straight head-to-head is worthless, because black just wins.
 *
 * Run: node scripts/tourney.mjs   (~15 min)
 * Edit NEW/OLD to whatever two configs you are comparing. Past results:
 *   VCT on vs off .................. 8-5
 *   transposition table on vs off .. 10-5
 */
import { chooseMove, STATS } from "../lib/ai.js";
import { applyMove, freshGameState } from "../lib/gomoku.js";

const NEW = { budget: 2200 };              // with transposition table + killers
const OLD = { budget: 2200, tt: false };   // same engine, no table, no killers

// Each opening is played twice with colours swapped, so black's first-move
// advantage lands on both configs equally.
const OPENINGS = [
  [], [[7,7],[7,8]], [[7,7],[8,8]], [[7,7],[6,8]],
  [[7,7],[7,8],[8,7]], [[7,7],[8,8],[6,8]], [[6,6],[7,7],[8,7]], [[7,6],[7,7],[8,8]],
];

function play(blackCfg, whiteCfg, opening) {
  let s = freshGameState("black");
  for (const [r, c] of opening) s = applyMove(s, r, c);
  const vctBy = { black: 0, white: 0 };
  for (let ply = 0; ply < 200 && !s.winner; ply++) {
    const before = STATS.vct;
    const mv = chooseMove(s.board, 5, s.turn, s.turn === "black" ? blackCfg : whiteCfg);
    if (STATS.vct > before) vctBy[s.turn]++;
    if (!mv) return { w: "nomove", vctBy };
    const n = applyMove(s, mv[0], mv[1]);
    if (n === s) return { w: "ILLEGAL", vctBy };
    s = n;
  }
  return { w: s.winner, vctBy };
}

let newPts = 0, oldPts = 0, draws = 0;
let vctClaims = 0, vctBroken = 0;
for (const op of OPENINGS) {
  for (const newIsBlack of [true, false]) {
    const r = play(newIsBlack ? NEW : OLD, newIsBlack ? OLD : NEW, op);
    const newSide = newIsBlack ? "black" : "white";
    if (r.w === newSide) newPts++;
    else if (r.w === "black" || r.w === "white") oldPts++;
    else draws++;
    // A side that played a "forced win" move and then did NOT win means the
    // threat search claimed a win it could not deliver.
    for (const side of ["black", "white"]) {
      if (r.vctBy[side] > 0) { vctClaims++; if (r.w !== side) vctBroken++; }
    }
    process.stdout.write(".");
  }
}
console.log(`\n\nNEW (VCT on):  ${newPts}`);
console.log(`OLD (VCT off): ${oldPts}`);
console.log(`unfinished:    ${draws}   of ${OPENINGS.length * 2} games`);
console.log(`\nVCT claimed a forced win in ${vctClaims} game-sides; ${vctBroken} of those did NOT go on to win.`);
