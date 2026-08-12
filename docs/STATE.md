# State record

Live: https://gomoku-online-kappa.vercel.app · repo `sufnelton/gomoku-online` · `main` auto-deploys.

**Status:** shipped and playable. Elton + Joey are playing it on phones.

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
- VCF, then VCT (Allis threat-space search) for forced wins.
- Iterative deepening alpha-beta, killer moves, Zobrist transposition table.
- Runs in a Web Worker (`app/ai.worker.js`) with a main-thread fallback and a 15s watchdog.
- Budget 2200ms.

**Measured, not asserted.** `scripts/tourney.mjs`, 16 paired games with colours
swapped: VCT on/off **8–5**, transposition table on/off **10–5**. A straight
head-to-head is worthless here — black's first-move advantage decides it.

## Left off

Everything asked for is shipped. Open threads, most valuable first:

1. **Re-test the thinking budget.** The worker means a longer search costs nothing in UI smoothness, and the table multiplies what extra time buys. An early 4-game test said 5000ms was *worse*; the 16-game harness later showed that test was noise. Unsettled, and cheap to settle: `node scripts/tourney.mjs` with NEW/OLD as budgets.
2. **Evaluation function.** The pattern weights are hand-picked guesses. Every leaf trusts them, so they cap what depth is worth.
3. **Opening book.** No book, and the eval is weakest before patterns exist — the first ~6 moves are the same every game and learnable by a human.
4. **Proof-number search**, the other half of Allis's method.

Deliberately not done: rebalancing levels 1–3 (removed instead), game review UI.

## Unresolved

- **Strangers are finishing games on the public URL** — `PreflightAlice`, `Guest`, `Matt` on the leaderboard. Nothing identifying is stored; the app records no IP, no user agent. Lobbies now take an optional passphrase, but only ones created since.
- **Whether the background video costs mobile performance** was never confirmed. The 🌿 toggle exists to test it.

## Hard-won details worth not rediscovering

- React registers `touchstart`/`touchmove` as **passive**, so `preventDefault` in `onTouchMove` is silently ignored. The board's touch handlers are attached natively with `passive: false`.
- The "board bounces on drag" bug was **not** overscroll — the hint line above the board swapped between one and two lines of text as the ghost cleared, and the layout reflowed. It now reserves two lines' height.
- Four separate browser defaults fight a drag gesture: image dragging, text selection, the iOS long-press callout, and page scroll. All four are handled.
- Stripping opaque fills from shared button styles broke every button that takes them by **spread** rather than by reference — they fell back to white browser chrome.
- Mate scores must never enter the transposition table: they carry the ply they were found at.
