# Username + In-Game Chat — Design Spec

**Date:** 2026-06-15
**Goal:** Add a player username and a chat box (right of the board on desktop, below it on phones) to online games in the existing Gomoku app.

**Builds on:** `2026-06-15-gomoku-online-design.md`. Reuses the Redis lobby object and the existing ~1.2s polling channel — no new realtime transport.

## Scope

- **Username**: one "Your name" field on the lobby; remembered in `localStorage`; sent on create/join; stored on the lobby; used in chat labels and the online status line.
- **Chat**: text chat between the two players in an online game, stored in the lobby object, delivered via the existing poll.
- **Responsive layout**: chat panel right of the board on wide screens, stacked below on narrow screens. Online mode only.
- **Out of scope (YAGNI)**: chat in vs-Computer / same-device modes, emoji pickers, typing indicators, read receipts, message editing/deletion, profanity filtering, separate faster chat channel.

## Username

- New client state `name`, persisted as `localStorage["gomoku_name"]`.
- Lobby screen gains a **"Your name"** text input (max 16 chars) above the "Play online" group.
- Sent in the `create` and `join` request bodies as `name`.
- Stored on the lobby as `names: { black: string, white: string|null }`.
  - `create` sets `names.black`.
  - `join` sets `names.white`.
  - Empty/blank name → server stores `"Guest"`.
- Display:
  - Opponent's name comes from `lobby.names[other(onlineColor)]`.
  - Status line (online): `"<opponent> to move"` when it's their turn; `"Your move"` on your turn; win/lose use `"You win!"` / `"<opponent> wins"`; resign uses `"<opponent> resigned — you win!"` / `"You resigned"`.
  - Header shows `You: <yourName> (Black)` style label.

## Chat data model (added to lobby object)

```
names:   { black: string, white: string|null },
chat:    [ { seq, color, name, text, ts } ],   // capped to last 50
chatSeq: number                                 // monotonic, for stable React keys
```
- `seq`: from `chatSeq`, incremented per message (stable key even after the 50-cap trims older messages).
- `color`: sender's color at send time.
- `name`: sender's name copied at send time (so attribution survives a rematch color-swap).
- `text`: trimmed, max 200 chars.
- `ts`: ISO timestamp set by the server.

## Server op: `chatMessage(playerId, code, text)`

1. Load lobby; `not_found` if missing.
2. `not_a_player` if `playerId` isn't black or white.
3. Trim `text`; reject `bad_request` if empty after trim.
4. Truncate to 200 chars.
5. Append `{ seq: ++chatSeq, color, name: names[color], text, ts }`; keep only the last 50.
6. Bump `version`, save, return `{ state }`.

Chat is allowed regardless of game state (before opponent joins is fine — messages just wait; during play; after a win). No turn restriction.

## Rematch interaction

`rematchLobby` already swaps `players`. It must also swap `names` to match (`{ black: names.white, white: names.black }`). **Chat history is retained** across a rematch (same two people). Existing messages keep their stored `name`, so labels stay correct after the swap.

## API changes (`/api/lobby`)

- `POST create`: body adds `name` → `createLobby(playerId, name)`.
- `POST join`: body adds `name` → `joinLobby(playerId, name, code)`.
- `POST chat`: `{ playerId, code, text }` → `chatMessage(playerId, code, text)`. Errors: `not_found` (404), `not_a_player` (403), `bad_request` (400).
- `GET state`: unchanged — chat arrives as part of the lobby state on the normal poll.

## Client changes

### `app/ChatPanel.jsx` (new, self-contained)
- Props: `{ messages, myColor, names, onSend, disabled }`.
- Renders: header ("Chat"), a scrolling message list (auto-scrolls to bottom on new messages), and an input row (text field + Send button, Enter sends).
- Each message: small name label (right-aligned + accent color for your own, left for opponent) and the text. React renders `text` as a child, so it is auto-escaped.
- `onSend(text)` clears the input; ignores empty.

### `app/page.jsx`
- Add `name` state + localStorage load/save; lobby "Your name" input.
- Thread `name` into `createOnline` / `joinOnline` request bodies.
- Online status line + header use opponent name from `g.names`.
- Add `sendChat(text)` → `api({ action: "chat", code, text })` then `setG(state)`.
- Responsive layout via a `useIsWide()` hook (`matchMedia("(min-width: 820px)")` + listener):
  - online game screen wraps board and `<ChatPanel>` in a flex container: `row` when wide (chat right, ~300px), `column` when narrow (chat below).
  - ai/local screens unchanged.
- `<ChatPanel>` only mounts in online mode.

## Error handling

- Failed chat POST: swallow; the next poll reconciles state (same pattern as moves).
- Name >16 chars: clamped client-side; server also defends with `"Guest"` fallback and 200-char text cap.
- Empty message: blocked client-side and server-side.

## Testing

Add to `lib/lobby.test.js`:
- `create`/`join` store names; blank name → `"Guest"`.
- `chatMessage` appends with correct color+name; rejects empty text; trims/caps to 200 chars.
- Chat array caps at 50 (51st push drops the oldest; `seq` keeps climbing).
- `rematch` swaps names and retains chat history.
- Every chat bumps `version`.

Manual (two tabs): set names, create/join, exchange messages (appear within ~1s on the other side), verify status line shows opponent name, verify layout (wide = right, narrow = below), verify chat survives a rematch with names swapped.

## Risks / decisions

- **~1s chat latency** accepted (reuses existing poll; no extra cost). Documented.
- **Chat history in the lobby object** grows the value, bounded by the 50-message cap (well within Upstash limits).
- **No moderation** — friends-only game; acceptable and documented.
