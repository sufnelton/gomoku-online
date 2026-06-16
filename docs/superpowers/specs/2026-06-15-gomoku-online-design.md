# Gomoku Online — Design Spec

**Date:** 2026-06-15
**Goal:** Take the existing single-file `gomoku-ai.jsx` (vs-Computer + same-device 2-player) and ship it on Vercel so two friends on different devices can play 1v1 via a shared lobby code.

## Scope

- **Keep** all existing modes: vs Computer (5 AI levels) and two-players-same-device.
- **Add** a third path on the lobby screen: **Play online** → *Create game* / *Join with code*.
- Free to run. Everything hosted from one Vercel project. No third-party account beyond a free Upstash Redis store added through Vercel's dashboard.
- **Out of scope (YAGNI):** accounts/login, matchmaking, spectators, chat, ELO/ranking, persistent game history, online Undo.

## Architecture

A **Next.js (App Router) app** in JavaScript (matches the existing JSX; no TypeScript, to minimize friction). Deployed on Vercel.

- **Client UI** (`app/page.jsx`): the current Gomoku component, extended with the online flow. AI engine stays 100% client-side.
- **Serverless API** (`app/api/lobby/route.js`): the move relay + referee.
- **Shared game logic** (`lib/gomoku.js`): pure functions `emptyBoard`, `findWin`, `applyMove`, `other`, `SIZE` — imported by **both** client and server so the referee and the UI agree exactly.
- **State store**: Upstash Redis (via `@upstash/redis` REST client — works in Vercel serverless). One JSON value per lobby, keyed by code, with a TTL.

### Why this shape
Gomoku is turn-based and low-frequency, so HTTP polling against a serverless KV is robust, free, and has no long-lived-socket requirements that Vercel serverless can't hold. ~1s latency reads as instant for a board game.

## Online game flow

1. **Create** → `POST /api/lobby {action:'create'}`. Server generates a unique 4-letter code (A–Z, ambiguity-free alphabet, no O/I/0/1), creates a fresh lobby, assigns the creator to **Black (first)**, returns `{code, color:'black', playerId}`. Client shows a "Waiting for opponent…" screen with the code displayed large and tap-to-copy.
2. **Share** the code out-of-band (text/Discord/etc.).
3. **Join** → `POST /api/lobby {action:'join', code}`. If the lobby exists and White is open, assign joiner to **White**, return state; game starts for both. Errors: `not_found`, `full` (a third person tries to join), already-a-player → rejoin.
4. **Play**: each device polls `GET /api/lobby?code=…&v=<version>`. Server returns the lobby only if its version changed since `v` (else 204) to keep polling cheap. Poll interval ~1.2s.
5. **Move** → `POST /api/lobby {action:'move', code, r, c}`. **Server is authoritative**: it verifies the requester's `playerId` owns the side whose turn it is, that the cell is empty and no winner yet, then applies the move with shared logic, bumps version, returns new state. Invalid moves are rejected (`not_your_turn`, `occupied`, `game_over`).
6. **End**: server sets `winner` + `winLine` on the winning move. Both clients show win/lose.
7. **Rematch** → `POST {action:'rematch'}` resets the board to a fresh game and **swaps colors** (previous White goes first). Either player can trigger it; it just resets the shared lobby.
8. **Resign** → `POST {action:'resign'}` mid-game → opponent immediately wins (`winner` = other color, reason `resign`).

### Player identity & reconnect
- On first load the client generates a random `playerId` and stores it in `localStorage`.
- The current `code` is also persisted in `localStorage`. On reload, the client re-fetches that lobby and, matching its `playerId` to a stored side, drops back into the same game. If the lobby is gone/expired, it returns to the lobby screen.
- Identity is a bearer secret in the request body — enough to stop casual cheating (can't move for the other color), not a hardened auth system (acceptable for a friends' game).

## Data model (Redis value at key `lobby:{CODE}`)

```
{
  code:        "WXYZ",
  board:       string[15][15] | null,    // "black" | "white" | null per cell
  turn:        "black" | "white",
  history:     [{ r, c, color }],
  winner:      null | "black" | "white" | "draw",
  winLine:     [[r,c], ...],
  endReason:   null | "five" | "resign" | "draw",
  players:     { black: playerId|null, white: playerId|null },
  version:     number,                    // bumped every mutation; drives cheap polling
  createdAt:   ISO string,
  updatedAt:   ISO string
}
```
TTL: ~6 hours, refreshed on each mutation, so abandoned codes self-clean.

## API surface (`/api/lobby`)

| Method | Action | Body / Query | Returns |
|---|---|---|---|
| POST | create | `{playerId}` | `{code, color, state}` |
| POST | join | `{playerId, code}` | `{color, state}` or error |
| POST | move | `{playerId, code, r, c}` | `{state}` or error |
| POST | rematch | `{playerId, code}` | `{state}` |
| POST | resign | `{playerId, code}` | `{state}` |
| GET | state | `?code&v=<version>` | `{state}` or 204 if unchanged |

Errors return `{error: <code>}` with appropriate HTTP status; client maps to friendly messages.

### Concurrency
Mutations read-modify-write the lobby JSON. To avoid two near-simultaneous writes clobbering each other, mutations use a short optimistic check: re-read inside the handler and reject a move if `version` advanced unexpectedly, or use a Redis `SET` with a small per-lobby lock. Low contention (turn-based, one active mover) makes this simple in practice.

## Client UI additions

- **Lobby screen**: existing "Play vs Computer" / "Two players (same device)" plus a new **Play online** group: *Create game* button and a *Join* row (code input + Join button). Visual language matches the current dark/green theme.
- **Waiting screen**: large code, copy button, "Share this code", spinner; auto-advances when opponent joins.
- **Online game screen**: reuses the existing board render. Status line gains online states: "Waiting for opponent…", "Your move", "Opponent's move", "You win!/Opponent wins", "Opponent resigned". Buttons: **Resign** (mid-game), **Rematch** + **Menu** (post-game). No Undo. A small "Code: WXYZ" label stays visible.
- Network/edge states surfaced inline: lobby full, lobby not found/expired, transient fetch error (retry quietly).

## Local development & testing

- **In-memory fallback store**: when Upstash env vars are absent (i.e. `npm run dev` locally), the API uses a module-level in-memory map instead of Redis. Two browser tabs on `localhost:3000` can create + join + play a full game with no account. This lets the change be eyeballed locally before any deploy.
- **Unit tests** for `lib/gomoku.js`: `findWin` (horizontal/vertical/both diagonals, <5 no-win, edge lines), `applyMove` (turn flip, win sets winner, occupied/finished no-op). Run with the project's test runner (Vitest).
- Note: the in-memory store is per-serverless-instance and does NOT work in production (instances don't share memory) — it is dev-only; production requires Upstash.

## Deployment (you run it; I provide exact steps)

1. I build + test locally and commit to the git repo at `~/Desktop/gomoku-online/`.
2. You create a GitHub repo and push (I provide commands; interactive `gh auth`/login is yours via `!`).
3. Import the repo in Vercel.
4. In Vercel → Storage, add **Upstash for Redis** (free) — this auto-injects the REST env vars into the project.
5. Deploy. Share the URL + a lobby code with a friend.

## Risks / decisions

- **Polling cost**: bounded by versioned 204 responses + a single active game; Upstash free tier comfortably covers a friends' game. If it ever matters, the realtime-push option (Ably/Pusher) is the documented upgrade path.
- **No hardened auth**: acceptable for sharing with friends; documented, not hidden.
- **Serverless cold starts**: first request after idle may take ~1s; harmless for a board game.
