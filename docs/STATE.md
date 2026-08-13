# State record

Live: https://gomoku-online-kappa.vercel.app · repo `sufnelton/gomoku-online` · `main` auto-deploys.

**Status:** shipped and playable. Elton + Joey are playing it on phones.

Sound (move / start / win / lose, 🔔 toggle), two music tracks behind a player,
a game archive, and an engine rebuild are all in.

---

## Rules in force

Not a standard ruleset — a hybrid arrived at over several rounds of play.

| | |
|---|---|
| Win | **Five or more** in a row. Overline wins. |
| Double three | **Banned, both colours.** Legal only if the move also stops the opponent completing five. Making a four of your own does **not** unlock it. |
| Double four | Allowed. With double three banned, this and the four-three are the main winning weapons. |
| Illegal moves | Blocked, not a loss. Marked with a red ✕ and explained on tap. |

Enforced in `applyMove` (all three modes funnel through it) plus an independent
server-side reject, so an online client can't post past it. The bot reads the
same `forbiddenByRule` / `blocksThreat` pair, so it cannot play by a different
rulebook than the human.

Closest named ruleset is MapleStory Omok, but this diverges: MapleStory requires
*exactly* five, and its exemption is looser.

## Engine (`lib/ai.js`)

One opponent only — the level picker is gone. `chooseMove` keeps a `level`
parameter internally because the strength tests pit configurations against each
other, but nothing offers a choice.

- Incremental evaluation: placing a stone rescores only the windows through it, not the board.
- Gain cache: `ordered()` scores every neighbour and keeps 4–12, so scores are cached against a content hash of each cell's neighbourhood — XORed in on place, out on unplace, so a sibling move still hits after a round-trip.
- Lines load once as two ready-made colour views (`C1`/`C2`) rather than being re-converted per colour inside the scoring loop.
- VCF, then VCT (Allis threat-space search) for forced wins. **Defence now runs VCT too**, not just VCF — a threat sequence built on threes used to be invisible.
- Iterative deepening alpha-beta, killer moves, Zobrist transposition table **that survives across moves** (probe ignores generation; an entry from an older move is always free to evict).
- Runs in a Web Worker (`app/ai.worker.js`) with a main-thread fallback and a 15s watchdog.
- Budget 2200ms, depth ceiling 16.

**Measured, not asserted.** Two harnesses, and neither replaces the other:

- `scripts/bench.mjs` — nodes and completed depth in a fixed budget. Wall-clock is the wrong instrument: the engine spends a budget rather than racing a clock, so a faster engine finishes in the same seconds having searched more.
- `scripts/tourney.mjs` — 16 paired games, colours swapped. The only thing that measures *strength*. `--vs-base` scores a whole engine against a copy at `lib/_baseline_ai.js` instead of a config flag.
- `scripts/profile.mjs` — `--cpu-prof` self-time per function, for finding what is actually hot.

Past results: VCT on/off **8–5**, transposition table on/off **10–5**.

A straight head-to-head is worthless here — black's first-move advantage decides it.

### 2026-08-12: the speed rebuild bought depth and **no strength**

This is the important entry in this file. The rebuild is real and measured:
**+123% nodes/sec and +1.67 ply** at an identical depth ceiling, **+2.33 ply**
with the ceiling lifted 10 → 16. Then 16 paired games against the shipped
engine, each change isolated:

| config | vs shipped baseline |
|---|---|
| speed work only (2× nodes, +1.67 ply) | **6–8** |
| + depth ceiling 16 | **6–8** |
| + defensive VCT | **6–8** |
| + transposition table across moves | **7–7** |
| all three at once | **4–8** |

Not one of them is an improvement. All are within noise of even at this sample
size — 14 decisive games cannot resolve a small edge, and none of these is a
large one — but there is **no evidence that any amount of extra depth makes
this bot harder**.

That is the answer to "how do we make it as hard as possible", and it is not
the answer that was expected going in. The evaluation function is the binding
constraint. Every leaf trusts nineteen hand-picked pattern weights and a `1.12`
defence multiplier, so searching deeper only computes their errors more
precisely. Depth is not the lever. **Weights are.**

What shipped: the speed work, at the proven defaults (`depth: 10`, defensive
VCT off, table cleared per move). It is free, it is transparent — `gains`
returns identical numbers cached or cold, and there is a test that says so —
and it is what makes weight-tuning runs affordable. The three behavioural
changes stay behind `opts.depth`, `opts.counterVct` and `opts.ttPersist` with
their results recorded above, so nobody re-runs these experiments by accident.

## Game archive (`lib/archive.js`)

The last 5 finished games, in `localStorage` on the device. A game **is** its
move list, so archiving is a JSON write and replay is the same reconstruction
loop `undo()` already used, with an index.

Three rules that are load-bearing rather than cosmetic:

- **The archived result is frozen.** Continuing a game forks a new one that earns its own row. Undoing a loss into a win would make the record mean nothing.
- **A forked game never reports to the leaderboard**, or "beat the computer" becomes "undo until you beat the computer".
- **An online game replays but cannot resume as an online game** — the lobby is gone and the opponent is not there, so it continues against the computer.

It is a personal log, not a ranking: it follows the browser, not the player, and
it is deliberately not the server leaderboard, which is cross-player and
name-based. That makes three separate records in the app; they will not agree.

## Left off

Open threads, most valuable first:

1. **Evaluation function — this is now the only thread that matters.** The measurements above rule out depth as the lever and point squarely here. Nineteen pattern weights and a `1.12` defence multiplier, all guessed. `tourney.mjs` scores a weight set exactly the way it scores a flag, and the speed work makes each run cheaper. Start by perturbing the four largest weights and the multiplier one at a time.
2. **A bigger harness before trusting any of this.** 16 paired games cannot separate engines that are close, which is why five runs above all landed 6–8 / 7–7. Anything that looks like a small edge needs 48+ games before it is a result rather than a coin flip.
3. **Opening book.** No book, and the eval is weakest before patterns exist — the first ~6 moves are the same every game and learnable by a human. The archive is now a free source of real openings for it.
4. **Proof-number search**, the other half of Allis's method.
5. **`branch: 12` and the `cap = max(4, branch - ply)` narrowing** were never measured. They were plausible numbers, and everything plausible in this engine has now been wrong at least once.

Deliberately not done: rebalancing levels 1–3 (removed instead).

## Unresolved

- ~~**Strangers are finishing games on the public URL**~~ — **cause found and fixed 2026-08-13.** `publicView` stripped the passphrase but kept `players`, and a `playerId` is the *only* credential any write action checks. `GET /api/lobby?code=XXXX` needed no authentication, so anyone holding a code — 331,776 of them, sweepable, no rate limit — could read both ids and then move, chat, resign or rematch as either player. The passphrase did not help: it gates `join`, and none of this required joining. Verified against production before the fix by posting chat and resigning a locked lobby with nothing but its code.

  The fix: `players` never leaves the server (occupancy comes back as `seats`, your own side as `youAre`), the unauthenticated `GET` is gone entirely and polling is an authenticated `POST` so the id never lands in a URL or a log, and both routes carry Redis-backed per-IP limits — 300/min overall, 30/min on `create`/`join`, which are the only actions that accept a code you were never given. A sweep now takes about a week per IP. `lib/lobby.test.js` has a `what a client is allowed to see` block that fails if any id ever appears in a payload again.

  Still true: names are whatever people type, chat is readable by the other player, and the leaderboard is name-keyed and unverifiable. Nothing identifying beyond that is stored — no IP, no user agent — though Vercel's own platform logs exist independently of this code.
- **Whether the background video costs mobile performance** was never confirmed. The 🌿 toggle exists to test it.
- **`public/audio/ost.m4a` is 76MB**, past GitHub's 50MB warning line. Deliberate — the full 2h42m compilation at the same 64k AAC as the lofi mix — but it is permanent in history now, and a third long track would be the point to move audio out of the repo.

## Hard-won details worth not rediscovering

- React registers `touchstart`/`touchmove` as **passive**, so `preventDefault` in `onTouchMove` is silently ignored. The board's touch handlers are attached natively with `passive: false`.
- The "board bounces on drag" bug was **not** overscroll — the hint line above the board swapped between one and two lines of text as the ghost cleared, and the layout reflowed. It now reserves two lines' height.
- Four separate browser defaults fight a drag gesture: image dragging, text selection, the iOS long-press callout, and page scroll. All four are handled.
- Stripping opaque fills from shared button styles broke every button that takes them by **spread** rather than by reference — they fell back to white browser chrome.
- **Optimising this engine by eye has a bad record.** "The candidate rescan is the bottleneck" was wrong — `neighbors()` was 2.4% of thinking time and `windowSum` plus its helpers were 73%. Profile first (`scripts/profile.mjs`), and measure the fix in nodes and depth, never in seconds.
- **Faster is not stronger.** Doubling the nodes and adding 1.67 ply changed nothing a tourney could see. A speed win is a means to cheaper experiments here, not a strength win, and it must never be reported as one.
- **A persistent transposition table needs the AI colour in its key.** Stored values are `evalFor(st, ai)`, signed from the AI's side; without `AI_KEY` a swapped-sides game reads them back inverted.
- **Depth-preferred replacement alone made the persistent table *worse*** (−0.33 ply). One search nearly fills the 262k slots, so last move's deep entries locked this move's out. An entry from an older move must always be free to evict.
- The shared button styles carry `width: 100%`, and that keeps biting. A spread that forgot to override it made Join claim the whole row and squeeze the code field to a sliver **on Safari only** — Chrome resolves the squeeze against the input's min-content width, Safari doesn't. Any `...secondaryBtn` inside a flex row needs `width: "auto"`.
- Text greys tuned against the flat `#1a1816` background wash out over the scene, which is a photograph rather than a dark field. Lifting the greys is not enough on its own (a lifted grey still measures ~2.3:1 on the bright sky); the per-glyph dark halo on `body[data-scene="on"]` is what carries them. Both live in `themeCss` as `--txt-2/3/4`.
- Mate scores must never enter the transposition table: they carry the ply they were found at.
