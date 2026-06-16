# Username + Chat + Head-to-Head + Leaderboard — Combined Design Spec

**Date:** 2026-06-15
**Goal:** Add to the online Gomoku game: a player username, in-game chat, an all-time head-to-head record between the two players, and a universal leaderboard.

**Builds on:** `2026-06-15-gomoku-online-design.md`. Reuses the Redis lobby + the existing ~1.2s poll. Adds persistent stats keys in Redis.

## Decisions (locked)

- **Identity:** the typed username, case-insensitive, **honor system** (no login). Name collisions merge; stats are spoofable — acceptable for a friends' game, documented.
- **Leaderboard ranking:** by total **wins**, displaying W / L / win% (win% = wins/(wins+losses)).
- **Chat latency:** rides the existing ~1s poll (no separate channel).
- **Build:** all in one pass; ship to a Vercel **preview** URL first, merge to prod on approval.

## Username

- Client `name` state, persisted as `localStorage["gomoku_name"]`, max 16 chars.
- "Your name" input on the lobby (above "Play online").
- Sent in `create`/`join` bodies; stored on lobby as `names: { black, white }`.
- Server `cleanName()`: trim → slice 16 → empty becomes `"Guest"`.
- Used in online status line (`"<opp> to move"`, `"<opp> resigned — you win!"`) and chat labels. Your own side reads `"Your move"`, `"You win!"`.

## Storage (extend `lib/store.js`; both Redis + in-memory)

New ops, implemented for Upstash Redis and the in-memory fallback so local dev still works:
- `hincrby(key, field, n)`
- `hgetall(key)` → object or `{}`
- `hset(key, obj)`
- `zincrby(key, member, n)`
- `zrevrangeWithScores(key, count)` → `[{ member, score }]` (score numeric, descending)

Stats keys (no TTL — permanent):
- `player:{lower}` (hash): `name`, `wins`, `losses`, `draws`.
- `lb:wins` (sorted set): member=`{lower}`, score=wins.
- `h2h:{lowerA}|{lowerB}` (hash, names sorted): one field per name = win count, plus `draws`.

All counts coerced with `Number(...)` on read (Redis hashes return strings).

## Lobby object additions

```
names:   { black: string, white: string|null },
record:  { black: number, white: number, draws: number },   // all-time h2h of the two current names
chat:    [ { seq, color, name, text, ts } ],                // capped to last 50
chatSeq: number,
```

## Server ops (`lib/lobby.js`)

- `createLobby(playerId, name)` — sets `names.black`, `record={0,0,0}`, `chat=[]`, `chatSeq=0`.
- `joinLobby(playerId, name, code)` — sets `names.white`, then loads `h2h` for the pair into `record`.
- `chatMessage(playerId, code, text)` — validates player; trims text, rejects empty (`bad_request`), caps 200; appends `{seq:++chatSeq, color, name, text, ts}`; keeps last 50; bumps version. Allowed any game state.
- `recordResult(lobby, outcome)` — `outcome ∈ {"black","white","draw"}`. **No-op unless both players present and both names set.** Updates: player stats (`HINCRBY` wins/losses/draws + `HSET name`), `lb:wins` (`ZINCRBY` on the winner), `h2h` (winner field or `draws`). Then reloads `h2h` to refresh `lobby.record`.
- `rematchLobby` — swaps `players` **and** `names`; retains `chat`; recomputes nothing else (record already current).

Result hooks (fire **once** per game end):
- In `moveInLobby`, after applying a move that sets `winner`: call `recordResult(winner==="draw" ? "draw" : winner)`.
- In `resignLobby`: call `recordResult(other(resigner))`.

## Leaderboard (`lib/leaderboard.js` + route)

- `getLeaderboard(top=20)`: `zrevrangeWithScores("lb:wins", top)` → for each member `hgetall("player:"+member)` → rows `{ name, wins, losses, draws, winRate }`, already win-sorted. (Only players with ≥1 win appear — that's inherent to a wins-ranked board; documented.)
- `GET /api/leaderboard?top=20` → `{ leaderboard: rows }`.

## Client (`app/page.jsx` + `app/ChatPanel.jsx`)

- **`useIsWide(820)`** hook via `matchMedia` to switch layout.
- **Lobby:** "Your name" input; a **🏆 Leaderboard** button → `screen="leaderboard"`.
- **Leaderboard screen:** fetches the route, renders a ranked table (rank, name, W, L, win%), Back button.
- **Online game screen:** status line + header use opponent name from `g.names`; a **head-to-head line** `"You {record[me]} – {record[opp]} {oppName}"`; layout wraps board + `<ChatPanel>` in a flex container (`row` wide → chat right ~300px; `column` narrow → chat below). Chat only in online mode.
- **`sendChat(text)`** → `api({action:"chat", code, text})` → `setG(state)`.
- **`app/ChatPanel.jsx`** (`"use client"`): props `{messages, myColor, names, onSend, disabled}`; header, auto-scrolling list (own messages accent/right, opponent grey/left), input + Send, Enter-to-send. Text rendered as a child → auto-escaped.

## Tests (`lib/store.test.js`, `lib/lobby.test.js`)

- Store: in-memory `hincrby`/`hgetall`/`hset`/`zincrby`/`zrevrangeWithScores` behave (increment, sort desc, coercion).
- Lobby: names on create/join (+`Guest` fallback); chat append/empty-reject/200-cap/50-cap; a black win records wins/losses + leaderboard + h2h; draw records draws for both; resign records opponent win; rematch swaps names + keeps chat; `recordResult` no-op without an opponent; AI/local never call record (they don't go through these ops).
- Leaderboard: ranks by wins, computes win%.

## Risks / decisions

- **Honor-system identity** — spoofable/collision-prone; acceptable for friends, surfaced in UI copy lightly ("names are not verified").
- **Wins-ranked board** excludes win-less players; intentional.
- **Same name both sides** (self-play) double-counts onto one player; honor system, not special-cased.
- **Atomic increments** (`HINCRBY`/`ZINCRBY`) avoid lost-update clobber on concurrent game-ends.
