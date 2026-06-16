# Gomoku Online Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the existing single-file Gomoku game on Vercel so two friends on different devices can play 1v1 through a shared lobby code, while keeping the vs-Computer and same-device modes.

**Architecture:** Next.js (App Router, JavaScript) app. Pure game logic lives in `lib/gomoku.js`, shared by the client UI and an authoritative serverless referee at `/api/lobby`. Lobby state is stored in Upstash Redis in production, with an in-memory fallback for local dev (no account needed). Clients poll the referee ~1×/sec; turn-based play makes this feel instant.

**Tech Stack:** Next.js 15, React 19, `@upstash/redis`, Vitest (tests). No TypeScript.

**Source material:** The original component is at `/Users/elton/Downloads/gomoku-ai.jsx`. Its AI engine (lines 22–129) and game logic are reused.

---

## File structure

| File | Responsibility |
|---|---|
| `package.json`, `next.config.mjs`, `jsconfig.json`, `vitest.config.mjs` | Project + tooling config |
| `app/layout.jsx` | Root HTML shell |
| `app/page.jsx` | Client game UI: lobby / waiting / game screens; vs-AI, local, online |
| `lib/gomoku.js` | Pure shared logic: board, `findWin`, `applyMove`, `freshGameState` |
| `lib/ai.js` | Client-only AI engine + `LEVELS` (imports from `gomoku.js`) |
| `lib/store.js` | Lobby persistence: Upstash Redis or in-memory fallback |
| `lib/lobby.js` | Server lobby ops: create/join/move/rematch/resign/state |
| `app/api/lobby/route.js` | HTTP wrapper over `lib/lobby.js` |
| `lib/gomoku.test.js`, `lib/lobby.test.js` | Unit tests |
| `README.md` | Deploy steps |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `next.config.mjs`, `jsconfig.json`, `vitest.config.mjs`, `app/layout.jsx`, `app/page.jsx`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "gomoku-online",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run"
  },
  "dependencies": {
    "@upstash/redis": "^1.34.0",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

- [ ] **Step 3: Create `jsconfig.json`**

```json
{
  "compilerOptions": {
    "baseUrl": "."
  }
}
```

- [ ] **Step 4: Create `vitest.config.mjs`**

```js
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node" },
});
```

- [ ] **Step 5: Create `app/layout.jsx`**

```jsx
export const metadata = {
  title: "Gomoku",
  description: "Five in a row — play a friend online",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: Create a placeholder `app/page.jsx`** (replaced in Task 6)

```jsx
"use client";
export default function Page() {
  return <div>Gomoku</div>;
}
```

- [ ] **Step 7: Install dependencies**

Run: `cd ~/Desktop/gomoku-online && npm install`
Expected: dependencies install, `node_modules/` created, no errors.

- [ ] **Step 8: Verify dev server boots**

Run: `cd ~/Desktop/gomoku-online && (npm run dev &) && sleep 6 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 && pkill -f "next dev"`
Expected: prints `200`.

- [ ] **Step 9: Commit**

```bash
cd ~/Desktop/gomoku-online
git add -A
git commit -m "Scaffold Next.js project"
```

---

## Task 2: Shared game logic (`lib/gomoku.js`) — TDD

**Files:**
- Create: `lib/gomoku.js`
- Test: `lib/gomoku.test.js`

- [ ] **Step 1: Write the failing tests** — `lib/gomoku.test.js`

```js
import { describe, it, expect } from "vitest";
import { SIZE, emptyBoard, findWin, applyMove, freshGameState, other } from "./gomoku.js";

describe("gomoku logic", () => {
  it("emptyBoard is 15x15 of null", () => {
    const b = emptyBoard();
    expect(b.length).toBe(15);
    expect(b[0].length).toBe(15);
    expect(b[7][7]).toBe(null);
  });

  it("other flips color", () => {
    expect(other("black")).toBe("white");
    expect(other("white")).toBe("black");
  });

  it("findWin detects a horizontal five", () => {
    const b = emptyBoard();
    for (let c = 3; c <= 7; c++) b[5][c] = "black";
    expect(findWin(b, 5, 5)).not.toBe(null);
    expect(findWin(b, 5, 5).length).toBe(5);
  });

  it("findWin detects a diagonal five", () => {
    const b = emptyBoard();
    for (let i = 0; i < 5; i++) b[i][i] = "white";
    expect(findWin(b, 2, 2)).not.toBe(null);
  });

  it("findWin returns null for four in a row", () => {
    const b = emptyBoard();
    for (let c = 0; c < 4; c++) b[0][c] = "black";
    expect(findWin(b, 0, 0)).toBe(null);
  });

  it("applyMove places a stone and flips turn", () => {
    const s = freshGameState("black");
    const n = applyMove(s, 7, 7);
    expect(n.board[7][7]).toBe("black");
    expect(n.turn).toBe("white");
    expect(n.history.length).toBe(1);
  });

  it("applyMove sets winner on a winning move", () => {
    let s = freshGameState("black");
    // black plays a column of 5 with white answering elsewhere
    const blacks = [[0,0],[1,0],[2,0],[3,0],[4,0]];
    const whites = [[0,5],[1,5],[2,5],[3,5]];
    for (let i = 0; i < 4; i++) {
      s = applyMove(s, blacks[i][0], blacks[i][1]); // black
      s = applyMove(s, whites[i][0], whites[i][1]); // white
    }
    s = applyMove(s, blacks[4][0], blacks[4][1]); // black completes five
    expect(s.winner).toBe("black");
    expect(s.endReason).toBe("five");
    expect(s.winLine.length).toBeGreaterThanOrEqual(5);
  });

  it("applyMove is a no-op on an occupied cell or finished game", () => {
    let s = freshGameState("black");
    s = applyMove(s, 7, 7);
    const same = applyMove(s, 7, 7); // occupied
    expect(same).toBe(s);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Desktop/gomoku-online && npx vitest run lib/gomoku.test.js`
Expected: FAIL — cannot resolve `./gomoku.js`.

- [ ] **Step 3: Implement `lib/gomoku.js`**

```js
export const SIZE = 15;
export const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

export const emptyBoard = () =>
  Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

export const other = (c) => (c === "black" ? "white" : "black");

export function findWin(board, r, c) {
  const color = board[r][c];
  if (!color) return null;
  for (const [dr, dc] of DIRS) {
    const line = [[r, c]];
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr][cc] === color) { line.push([rr, cc]); rr += dr; cc += dc; }
    rr = r - dr; cc = c - dc;
    while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr][cc] === color) { line.unshift([rr, cc]); rr -= dr; cc -= dc; }
    if (line.length >= 5) return line;
  }
  return null;
}

export const freshGameState = (turn = "black") => ({
  board: emptyBoard(),
  turn,
  history: [],
  winner: null,
  winLine: [],
  endReason: null,
});

export function applyMove(state, r, c) {
  if (state.winner || state.board[r][c]) return state;
  const board = state.board.map((row) => row.slice());
  board[r][c] = state.turn;
  const line = findWin(board, r, c);
  const full = state.history.length + 1 === SIZE * SIZE;
  const history = [...state.history, { r, c, color: state.turn }];
  return {
    ...state,
    board,
    history,
    winLine: line || [],
    winner: line ? state.turn : full ? "draw" : null,
    endReason: line ? "five" : full ? "draw" : null,
    turn: line ? state.turn : other(state.turn),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Desktop/gomoku-online && npx vitest run lib/gomoku.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/gomoku-online
git add lib/gomoku.js lib/gomoku.test.js
git commit -m "Add shared gomoku logic with tests"
```

---

## Task 3: Lobby store (`lib/store.js`)

**Files:**
- Create: `lib/store.js`

This module abstracts persistence. In-memory map when no Upstash env vars (local dev); Upstash Redis otherwise. No dedicated test (covered via `lib/lobby.test.js` using the in-memory path).

- [ ] **Step 1: Implement `lib/store.js`**

```js
import { Redis } from "@upstash/redis";

const TTL_SECONDS = 6 * 60 * 60;
const mem = new Map();

function url() {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
}
function token() {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
}
function hasRedis() {
  return Boolean(url() && token());
}

let _redis = null;
function redis() {
  if (!_redis) _redis = new Redis({ url: url(), token: token() });
  return _redis;
}

export async function getLobby(code) {
  if (hasRedis()) return (await redis().get(`lobby:${code}`)) || null;
  return mem.get(code) || null;
}

export async function setLobby(code, lobby) {
  if (hasRedis()) {
    await redis().set(`lobby:${code}`, lobby, { ex: TTL_SECONDS });
    return;
  }
  mem.set(code, lobby);
}

// Test-only helper.
export function _resetMemory() {
  mem.clear();
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/Desktop/gomoku-online
git add lib/store.js
git commit -m "Add lobby store with in-memory fallback"
```

---

## Task 4: Server lobby operations (`lib/lobby.js`) — TDD

**Files:**
- Create: `lib/lobby.js`
- Test: `lib/lobby.test.js`

- [ ] **Step 1: Write the failing tests** — `lib/lobby.test.js`

```js
import { describe, it, expect, beforeEach } from "vitest";
import { _resetMemory } from "./store.js";
import {
  createLobby, joinLobby, moveInLobby, rematchLobby, resignLobby, getState,
} from "./lobby.js";

const P1 = "player-one";
const P2 = "player-two";
const P3 = "player-three";

beforeEach(() => _resetMemory());

describe("lobby operations", () => {
  it("create assigns the creator to black and returns a 4-letter code", async () => {
    const r = await createLobby(P1);
    expect(r.code).toMatch(/^[A-Z]{4}$/);
    expect(r.color).toBe("black");
    expect(r.state.players.black).toBe(P1);
    expect(r.state.players.white).toBe(null);
    expect(r.state.version).toBe(1);
  });

  it("join assigns the second player to white", async () => {
    const { code } = await createLobby(P1);
    const r = await joinLobby(P2, code);
    expect(r.color).toBe("white");
    expect(r.state.players.white).toBe(P2);
  });

  it("join the same player twice rejoins, not full", async () => {
    const { code } = await createLobby(P1);
    const r = await joinLobby(P1, code);
    expect(r.color).toBe("black");
  });

  it("join rejects a full lobby and a missing code", async () => {
    const { code } = await createLobby(P1);
    await joinLobby(P2, code);
    expect((await joinLobby(P3, code)).error).toBe("full");
    expect((await joinLobby(P3, "ZZZZ")).error).toBe("not_found");
  });

  it("move enforces turn order and ownership", async () => {
    const { code } = await createLobby(P1);
    await joinLobby(P2, code);
    expect((await moveInLobby(P2, code, 7, 7)).error).toBe("not_your_turn"); // white can't start
    const r = await moveInLobby(P1, code, 7, 7); // black starts
    expect(r.state.board[7][7]).toBe("black");
    expect(r.state.turn).toBe("white");
    expect((await moveInLobby(P1, code, 8, 8)).error).toBe("not_your_turn"); // not black's turn now
    expect((await moveInLobby(P2, code, 7, 7)).error).toBe("occupied");
  });

  it("move rejects when there is no opponent yet", async () => {
    const { code } = await createLobby(P1);
    expect((await moveInLobby(P1, code, 7, 7)).error).toBe("no_opponent");
  });

  it("resign makes the opponent win", async () => {
    const { code } = await createLobby(P1);
    await joinLobby(P2, code);
    const r = await resignLobby(P1, code);
    expect(r.state.winner).toBe("white");
    expect(r.state.endReason).toBe("resign");
  });

  it("rematch resets the board and swaps colors", async () => {
    const { code } = await createLobby(P1);
    await joinLobby(P2, code);
    await moveInLobby(P1, code, 7, 7);
    const r = await rematchLobby(P1, code);
    expect(r.state.board[7][7]).toBe(null);
    expect(r.state.winner).toBe(null);
    expect(r.state.players.black).toBe(P2); // swapped
    expect(r.state.players.white).toBe(P1);
    expect(r.state.turn).toBe("black");
  });

  it("getState returns current lobby or not_found", async () => {
    const { code } = await createLobby(P1);
    expect((await getState(code)).state.code).toBe(code);
    expect((await getState("ZZZZ")).error).toBe("not_found");
  });

  it("every mutation bumps version", async () => {
    const { code, state } = await createLobby(P1);
    let v = state.version;
    const j = await joinLobby(P2, code);
    expect(j.state.version).toBeGreaterThan(v);
    v = j.state.version;
    const m = await moveInLobby(P1, code, 7, 7);
    expect(m.state.version).toBeGreaterThan(v);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Desktop/gomoku-online && npx vitest run lib/lobby.test.js`
Expected: FAIL — cannot resolve `./lobby.js`.

- [ ] **Step 3: Implement `lib/lobby.js`**

```js
import { getLobby, setLobby } from "./store.js";
import { applyMove, freshGameState, other, SIZE } from "./gomoku.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O to avoid ambiguity
const CODE_LEN = 4;

function randomCode() {
  let s = "";
  for (let i = 0; i < CODE_LEN; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

function now() {
  return new Date().toISOString();
}

function colorOf(lobby, playerId) {
  if (lobby.players.black === playerId) return "black";
  if (lobby.players.white === playerId) return "white";
  return null;
}

async function save(code, lobby) {
  lobby.version += 1;
  lobby.updatedAt = now();
  await setLobby(code, lobby);
  return lobby;
}

export async function createLobby(playerId) {
  let code = randomCode();
  for (let i = 0; i < 10 && (await getLobby(code)); i++) code = randomCode();
  const lobby = {
    code,
    ...freshGameState("black"),
    players: { black: playerId, white: null },
    version: 1,
    createdAt: now(),
    updatedAt: now(),
  };
  await setLobby(code, lobby);
  return { code, color: "black", state: lobby };
}

export async function joinLobby(playerId, code) {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "not_found" };
  const existing = colorOf(lobby, playerId);
  if (existing) return { color: existing, state: lobby };
  if (lobby.players.white) return { error: "full" };
  lobby.players.white = playerId;
  await save(code, lobby);
  return { color: "white", state: lobby };
}

export async function moveInLobby(playerId, code, r, c) {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "not_found" };
  const color = colorOf(lobby, playerId);
  if (!color) return { error: "not_a_player" };
  if (lobby.winner) return { error: "game_over" };
  if (!lobby.players.white) return { error: "no_opponent" };
  if (lobby.turn !== color) return { error: "not_your_turn" };
  if (
    !Number.isInteger(r) || !Number.isInteger(c) ||
    r < 0 || c < 0 || r >= SIZE || c >= SIZE || lobby.board[r][c]
  ) return { error: "occupied" };
  const next = applyMove(lobby, r, c);
  Object.assign(lobby, next);
  await save(code, lobby);
  return { state: lobby };
}

export async function resignLobby(playerId, code) {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "not_found" };
  const color = colorOf(lobby, playerId);
  if (!color) return { error: "not_a_player" };
  if (lobby.winner) return { error: "game_over" };
  lobby.winner = other(color);
  lobby.winLine = [];
  lobby.endReason = "resign";
  await save(code, lobby);
  return { state: lobby };
}

export async function rematchLobby(playerId, code) {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "not_found" };
  if (!colorOf(lobby, playerId)) return { error: "not_a_player" };
  const swapped = { black: lobby.players.white, white: lobby.players.black };
  Object.assign(lobby, freshGameState("black"));
  lobby.players = swapped;
  await save(code, lobby);
  return { state: lobby };
}

export async function getState(code) {
  const lobby = await getLobby(code);
  if (!lobby) return { error: "not_found" };
  return { state: lobby };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Desktop/gomoku-online && npx vitest run lib/lobby.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/gomoku-online
git add lib/lobby.js lib/lobby.test.js
git commit -m "Add server lobby operations with tests"
```

---

## Task 5: HTTP API route (`app/api/lobby/route.js`)

**Files:**
- Create: `app/api/lobby/route.js`

- [ ] **Step 1: Implement the route**

```js
import { NextResponse } from "next/server";
import {
  createLobby, joinLobby, moveInLobby, rematchLobby, resignLobby, getState,
} from "../../../lib/lobby.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ERR_STATUS = {
  not_found: 404,
  full: 409,
  not_your_turn: 409,
  occupied: 409,
  game_over: 409,
  no_opponent: 409,
  not_a_player: 403,
  bad_request: 400,
};

function out(result) {
  if (result && result.error) {
    return NextResponse.json({ error: result.error }, { status: ERR_STATUS[result.error] || 400 });
  }
  return NextResponse.json(result);
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = (searchParams.get("code") || "").toUpperCase();
  const v = Number(searchParams.get("v") || 0);
  if (!code) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const result = await getState(code);
  if (result.error) return out(result);
  if (v && result.state.version === v) return new NextResponse(null, { status: 204 });
  return NextResponse.json(result);
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const { action, playerId } = body || {};
  const code = (body.code || "").toUpperCase();
  if (!playerId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  switch (action) {
    case "create": return out(await createLobby(playerId));
    case "join": return out(await joinLobby(playerId, code));
    case "move": return out(await moveInLobby(playerId, code, body.r, body.c));
    case "rematch": return out(await rematchLobby(playerId, code));
    case "resign": return out(await resignLobby(playerId, code));
    default: return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
}
```

- [ ] **Step 2: Smoke-test the API end to end**

Run:
```bash
cd ~/Desktop/gomoku-online
(npm run dev &) && sleep 6
CREATE=$(curl -s -X POST http://localhost:3000/api/lobby -H "Content-Type: application/json" -d '{"action":"create","playerId":"p1"}')
echo "CREATE: $CREATE"
CODE=$(echo "$CREATE" | sed -E 's/.*"code":"([A-Z]{4})".*/\1/')
echo "CODE: $CODE"
curl -s -X POST http://localhost:3000/api/lobby -H "Content-Type: application/json" -d "{\"action\":\"join\",\"playerId\":\"p2\",\"code\":\"$CODE\"}" | sed -E 's/.*("color":"white").*/JOIN_OK \1/'
curl -s -X POST http://localhost:3000/api/lobby -H "Content-Type: application/json" -d "{\"action\":\"move\",\"playerId\":\"p1\",\"code\":\"$CODE\",\"r\":7,\"c\":7}" | sed -E 's/.*("turn":"white").*/MOVE_OK \1/'
pkill -f "next dev"
```
Expected: CREATE shows a 4-letter `code`; `JOIN_OK "color":"white"`; `MOVE_OK "turn":"white"`.

> Note: in `next dev` the in-memory store persists across requests because it's one process. This smoke test confirms the full create→join→move path.

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/gomoku-online
git add app/api/lobby/route.js
git commit -m "Add /api/lobby HTTP route"
```

---

## Task 6: Client AI engine module (`lib/ai.js`)

**Files:**
- Create: `lib/ai.js`

The AI engine is copied from `/Users/elton/Downloads/gomoku-ai.jsx` (lines 22–129) plus the `LEVELS` array (lines 146–152), refactored to import shared helpers and export `chooseMove` + `LEVELS`. Full content below.

- [ ] **Step 1: Implement `lib/ai.js`**

```js
import { SIZE, findWin, other } from "./gomoku.js";

const PATTERNS = [
  ["11111", 100000],
  ["011110", 15000],
  ["011112", 2600], ["211110", 2600],
  ["11011", 2600], ["10111", 2600], ["11101", 2600],
  ["01110", 1500],
  ["010110", 1500], ["011010", 1500],
  ["001112", 350], ["211100", 350], ["001110", 350], ["011100", 350],
  ["001100", 200], ["011000", 100], ["000110", 100], ["010100", 100], ["001010", 100],
];

function linesFor(board, player) {
  const opp = other(player);
  const code = (v) => (v === player ? "1" : v === opp ? "2" : "0");
  const out = [];
  for (let r = 0; r < SIZE; r++) { let s = ""; for (let c = 0; c < SIZE; c++) s += code(board[r][c]); out.push(s); }
  for (let c = 0; c < SIZE; c++) { let s = ""; for (let r = 0; r < SIZE; r++) s += code(board[r][c]); out.push(s); }
  for (let k = -(SIZE - 1); k <= SIZE - 1; k++) { let s = ""; for (let r = 0; r < SIZE; r++) { const c = r - k; if (c >= 0 && c < SIZE) s += code(board[r][c]); } if (s.length >= 5) out.push(s); }
  for (let k = 0; k <= 2 * (SIZE - 1); k++) { let s = ""; for (let r = 0; r < SIZE; r++) { const c = k - r; if (c >= 0 && c < SIZE) s += code(board[r][c]); } if (s.length >= 5) out.push(s); }
  return out;
}

const countOcc = (s, sub) => { let n = 0, i = 0; while ((i = s.indexOf(sub, i)) !== -1) { n++; i++; } return n; };

function scoreFor(board, player) {
  let total = 0;
  for (const raw of linesFor(board, player)) { const s = "2" + raw + "2"; for (const [p, w] of PATTERNS) { const n = countOcc(s, p); if (n) total += n * w; } }
  return total;
}

const evaluateBoard = (board, ai) => scoreFor(board, ai) - 1.15 * scoreFor(board, other(ai));

function getCandidates(board, dist = 1) {
  const seen = new Set(); const out = []; let any = false;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (!board[r][c]) continue; any = true;
    for (let dr = -dist; dr <= dist; dr++) for (let dc = -dist; dc <= dist; dc++) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && !board[nr][nc]) { const k = nr * SIZE + nc; if (!seen.has(k)) { seen.add(k); out.push([nr, nc]); } }
    }
  }
  return any ? out : [[7, 7]];
}

function neighborScore(board, r, c) {
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue; const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc]) n++;
  }
  return n;
}

function findImmediate(board, color) {
  for (const [r, c] of getCandidates(board, 1)) { board[r][c] = color; const w = findWin(board, r, c); board[r][c] = null; if (w) return [r, c]; }
  return null;
}

function scoredTop(board, ai, k) {
  const moves = getCandidates(board, 1).map(([r, c]) => { board[r][c] = ai; const v = evaluateBoard(board, ai); board[r][c] = null; return { r, c, v }; });
  moves.sort((a, b) => b.v - a.v);
  return moves.slice(0, k).map((m) => [m.r, m.c]);
}

function minimax(board, depth, alpha, beta, maxing, ai, opp, branch) {
  const score = evaluateBoard(board, ai);
  if (depth <= 0 || Math.abs(score) >= 90000) return score;
  let cands = getCandidates(board, 1);
  if (!cands.length) return score;
  cands.sort((a, b) => neighborScore(board, b[0], b[1]) - neighborScore(board, a[0], a[1]));
  cands = cands.slice(0, branch);
  if (maxing) {
    let best = -Infinity;
    for (const [r, c] of cands) { board[r][c] = ai; best = Math.max(best, minimax(board, depth - 1, alpha, beta, false, ai, opp, branch)); board[r][c] = null; alpha = Math.max(alpha, best); if (beta <= alpha) break; }
    return best;
  } else {
    let best = Infinity;
    for (const [r, c] of cands) { board[r][c] = opp; best = Math.min(best, minimax(board, depth - 1, alpha, beta, true, ai, opp, branch)); board[r][c] = null; beta = Math.min(beta, best); if (beta <= alpha) break; }
    return best;
  }
}

function searchMove(board, depth, branch, ai) {
  const opp = other(ai);
  const win = findImmediate(board, ai); if (win) return win;
  const block = findImmediate(board, opp); if (block) return block;
  let cands = getCandidates(board, 1).map(([r, c]) => { board[r][c] = ai; const v = evaluateBoard(board, ai); board[r][c] = null; return { r, c, v }; });
  cands.sort((a, b) => b.v - a.v);
  cands = cands.slice(0, branch);
  let best = cands.length ? [cands[0].r, cands[0].c] : null, bestV = -Infinity, alpha = -Infinity;
  for (const { r, c } of cands) { board[r][c] = ai; const v = minimax(board, depth - 1, alpha, Infinity, false, ai, opp, branch); board[r][c] = null; if (v > bestV) { bestV = v; best = [r, c]; } alpha = Math.max(alpha, v); }
  return best;
}

export function chooseMove(board, level, ai) {
  const opp = other(ai);
  const cands = getCandidates(board, 1);
  if (level === 1) {
    const win = findImmediate(board, ai); if (win) return win;
    if (Math.random() < 0.5) { const blk = findImmediate(board, opp); if (blk) return blk; }
    return cands[Math.floor(Math.random() * cands.length)];
  }
  if (level === 2) {
    const win = findImmediate(board, ai); if (win) return win;
    const blk = findImmediate(board, opp); if (blk) return blk;
    const top = scoredTop(board, ai, 3);
    return top[Math.floor(Math.random() * top.length)];
  }
  if (level === 3) {
    const win = findImmediate(board, ai); if (win) return win;
    const blk = findImmediate(board, opp); if (blk) return blk;
    return scoredTop(board, ai, 1)[0];
  }
  if (level === 4) return searchMove(board, 2, 12, ai);
  return searchMove(board, 4, 8, ai);
}

export const LEVELS = [
  { id: 1, name: "Beginner", blurb: "Plays loosely, misses threats" },
  { id: 2, name: "Easy", blurb: "Blocks the obvious stuff" },
  { id: 3, name: "Medium", blurb: "Solid attack & defense" },
  { id: 4, name: "Hard", blurb: "Looks ahead, sets traps" },
  { id: 5, name: "Expert", blurb: "Deep search, punishes errors" },
];
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `cd ~/Desktop/gomoku-online && node --input-type=module -e "import('./lib/ai.js').then(m => console.log(typeof m.chooseMove, m.LEVELS.length))"`
Expected: prints `function 5`.

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/gomoku-online
git add lib/ai.js
git commit -m "Extract client AI engine into lib/ai.js"
```

---

## Task 7: Client UI with online play (`app/page.jsx`)

**Files:**
- Modify (replace placeholder): `app/page.jsx`

This is the full client. It ports the original UI (vs-AI + local) and adds online create/join/waiting/play/resign/rematch/reconnect. Online color is **derived** from `players` + `playerId` on every render, so a rematch's color swap is reflected on both clients via polling.

- [ ] **Step 1: Write the full `app/page.jsx`**

```jsx
"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";
import { SIZE, emptyBoard, findWin, other, applyMove, freshGameState } from "../lib/gomoku.js";
import { chooseMove, LEVELS } from "../lib/ai.js";

const freshGame = () => freshGameState("black");

async function postLobby(body) {
  const res = await fetch("/api/lobby", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "error");
  return data;
}

export default function GomokuAI() {
  const [screen, setScreen] = useState("lobby"); // lobby | waiting | game
  const [mode, setMode] = useState("ai");        // ai | local | online
  const [level, setLevel] = useState(3);
  const [humanColor, setHumanColor] = useState("black");
  const [g, setG] = useState(freshGame);
  const [thinking, setThinking] = useState(false);

  // online
  const [code, setCode] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [netError, setNetError] = useState("");
  const [copied, setCopied] = useState(false);
  const playerIdRef = useRef("");
  const versionRef = useRef(0);

  const aiColor = other(humanColor);
  const onlineColor = g.players
    ? (g.players.black === playerIdRef.current ? "black"
      : g.players.white === playerIdRef.current ? "white" : null)
    : null;

  useEffect(() => { versionRef.current = g.version || 0; }, [g.version]);

  const api = useCallback((body) => postLobby({ ...body, playerId: playerIdRef.current }), []);

  const reconnect = useCallback(async (c) => {
    try {
      const res = await fetch(`/api/lobby?code=${c}`);
      if (!res.ok) { localStorage.removeItem("gomoku_code"); return; }
      const data = await res.json();
      const pid = playerIdRef.current;
      const color = data.state.players.black === pid ? "black"
        : data.state.players.white === pid ? "white" : null;
      if (!color) { localStorage.removeItem("gomoku_code"); return; }
      setMode("online"); setCode(c); setG(data.state);
      setScreen(data.state.players.white ? "game" : "waiting");
    } catch { /* offline; ignore */ }
  }, []);

  // identity + reconnect on first load
  useEffect(() => {
    let id = localStorage.getItem("gomoku_pid");
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("gomoku_pid", id);
    }
    playerIdRef.current = id;
    const savedCode = localStorage.getItem("gomoku_code");
    if (savedCode) reconnect(savedCode);
  }, [reconnect]);

  // AI turn handler (vs-computer only)
  useEffect(() => {
    if (screen !== "game" || mode !== "ai" || g.winner) return;
    if (g.turn !== aiColor) return;
    let cancelled = false;
    setThinking(true);
    const t = setTimeout(() => {
      const boardCopy = g.board.map((row) => row.slice());
      const mv = chooseMove(boardCopy, level, aiColor);
      if (!cancelled) { if (mv) setG((s) => applyMove(s, mv[0], mv[1])); setThinking(false); }
    }, 140);
    return () => { cancelled = true; clearTimeout(t); };
  }, [screen, mode, g, aiColor, level]);

  // online polling
  useEffect(() => {
    if (mode !== "online" || (screen !== "game" && screen !== "waiting")) return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/lobby?code=${code}&v=${versionRef.current}`);
        if (res.status === 204) return;
        if (res.status === 404) { if (active) setNetError("Lobby expired or not found"); return; }
        const data = await res.json();
        if (active && data.state) {
          setG(data.state);
          if (data.state.players.white) setScreen("game");
        }
      } catch { /* transient; retry next tick */ }
    };
    tick();
    const iv = setInterval(tick, 1200);
    return () => { active = false; clearInterval(iv); };
  }, [mode, screen, code]);

  const human = useCallback((r, c) => {
    if (g.winner || g.board[r][c]) return;
    if (mode === "ai") { if (thinking || g.turn !== humanColor) return; setG((s) => applyMove(s, r, c)); return; }
    if (mode === "local") { setG((s) => applyMove(s, r, c)); return; }
    if (mode === "online") {
      if (g.turn !== onlineColor || !g.players?.white) return;
      api({ action: "move", code, r, c }).then((d) => d && setG(d.state)).catch(() => {});
    }
  }, [thinking, g, mode, humanColor, onlineColor, code, api]);

  const start = (m) => { setMode(m); setG(freshGame()); setThinking(false); setScreen("game"); };

  const undo = useCallback(() => {
    if (thinking || mode === "online") return;
    setG((s) => {
      let h = [...s.history];
      if (mode === "ai") { while (h.length && h[h.length - 1].color === aiColor) h.pop(); if (h.length && h[h.length - 1].color === humanColor) h.pop(); }
      else h.pop();
      const board = emptyBoard(); h.forEach(({ r, c, color }) => (board[r][c] = color));
      return { ...freshGameState("black"), board, history: h, turn: h.length % 2 === 0 ? "black" : "white" };
    });
  }, [thinking, mode, aiColor, humanColor]);

  const rematch = () => { setG(freshGame()); setThinking(false); };
  const swapSides = () => { setHumanColor((c) => other(c)); setG(freshGame()); setThinking(false); };

  // online actions
  const createOnline = async () => {
    setNetError("");
    try {
      const data = await api({ action: "create" });
      setMode("online"); setCode(data.code); setG(data.state);
      localStorage.setItem("gomoku_code", data.code);
      setScreen("waiting");
    } catch { setNetError("Could not create a game. Try again."); }
  };

  const joinOnline = async () => {
    const c = joinInput.trim().toUpperCase();
    if (c.length < 4) { setNetError("Enter the 4-letter code"); return; }
    setNetError("");
    try {
      const data = await api({ action: "join", code: c });
      setMode("online"); setCode(c); setG(data.state);
      localStorage.setItem("gomoku_code", c);
      setScreen(data.state.players.white ? "game" : "waiting");
    } catch (e) {
      setNetError(
        e.message === "full" ? "That game already has two players"
        : e.message === "not_found" ? "No game with that code"
        : "Could not join. Try again."
      );
    }
  };

  const leaveOnline = () => {
    localStorage.removeItem("gomoku_code");
    setCode(""); setJoinInput(""); setNetError(""); setMode("ai");
    setG(freshGame()); setScreen("lobby");
  };

  const resignOnline = () => api({ action: "resign", code }).then((d) => d && setG(d.state)).catch(() => {});
  const rematchOnline = () => api({ action: "rematch", code }).then((d) => d && setG(d.state)).catch(() => {});

  const copyCode = () => {
    navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  // ---------- LOBBY ----------
  if (screen === "lobby") {
    return (
      <div style={wrap}>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 4px" }}>Gomoku</h1>
        <p style={{ fontSize: 13, color: "#9b948a", margin: "0 0 26px" }}>Five in a row</p>

        <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <div style={label}>Play online</div>
            <button onClick={createOnline} style={primaryBtn}>Create game · get a code</button>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value.toUpperCase().slice(0, 4))}
                onKeyDown={(e) => e.key === "Enter" && joinOnline()}
                placeholder="CODE"
                maxLength={4}
                style={{ flex: 1, padding: "10px 12px", borderRadius: 9, border: "1px solid #3a3530", background: "#262320", color: "#f2ede4", fontSize: 15, letterSpacing: "0.2em", textAlign: "center", fontWeight: 700 }}
              />
              <button onClick={joinOnline} style={{ ...secondaryBtn, padding: "10px 18px", fontSize: 14 }}>Join</button>
            </div>
            {netError && <div style={{ color: "#e0533a", fontSize: 12, marginTop: 8 }}>{netError}</div>}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#5a544c", fontSize: 12 }}>
            <div style={{ flex: 1, height: 1, background: "#3a3530" }} /> OR <div style={{ flex: 1, height: 1, background: "#3a3530" }} />
          </div>

          <div>
            <div style={label}>Computer level</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {LEVELS.map((l) => (
                <button key={l.id} onClick={() => setLevel(l.id)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left",
                    padding: "11px 14px", borderRadius: 9, cursor: "pointer",
                    border: `1px solid ${level === l.id ? "#1AFF8C" : "#3a3530"}`,
                    background: level === l.id ? "rgba(26,255,140,0.08)" : "#262320",
                    color: "#f2ede4",
                  }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, width: 18, color: level === l.id ? "#1AFF8C" : "#6b645b" }}>{l.id}</span>
                    <span>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{l.name}</div>
                      <div style={{ fontSize: 11, color: "#9b948a" }}>{l.blurb}</div>
                    </span>
                  </span>
                  {level === l.id && <span style={{ color: "#1AFF8C", fontSize: 16 }}>✓</span>}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={label}>You play</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[["black", "Black (first)"], ["white", "White (second)"]].map(([c, t]) => (
                <button key={c} onClick={() => setHumanColor(c)}
                  style={{ flex: 1, padding: "10px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 600,
                    border: `1px solid ${humanColor === c ? "#1AFF8C" : "#3a3530"}`,
                    background: humanColor === c ? "rgba(26,255,140,0.08)" : "#262320", color: "#f2ede4" }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <button onClick={() => start("ai")} style={secondaryBtn}>Play vs Computer</button>
          <button onClick={() => start("local")} style={secondaryBtn}>Two players (same device)</button>
        </div>
      </div>
    );
  }

  // ---------- WAITING (online, no opponent yet) ----------
  if (screen === "waiting") {
    return (
      <div style={wrap}>
        <button onClick={leaveOnline} style={{ ...ghostBtn, alignSelf: "flex-start" }}>← Cancel</button>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 }}>
          <div style={label}>Share this code</div>
          <button onClick={copyCode} style={{ fontSize: 48, fontWeight: 800, letterSpacing: "0.15em", color: "#1AFF8C", background: "transparent", border: "none", cursor: "pointer" }}>
            {code}
          </button>
          <div style={{ fontSize: 13, color: "#9b948a" }}>{copied ? "Copied!" : "Tap the code to copy"}</div>
          <div style={{ fontSize: 14, color: "#f2ede4", marginTop: 10 }}>Waiting for your opponent to join…</div>
          {netError && <div style={{ color: "#e0533a", fontSize: 12 }}>{netError}</div>}
        </div>
      </div>
    );
  }

  // ---------- GAME ----------
  const lastMove = g.history[g.history.length - 1] || null;
  const winSet = new Set(g.winLine.map(([r, c]) => `${r},${c}`));
  let status;
  if (mode === "online") {
    if (!g.players?.white) status = "Waiting for opponent…";
    else if (g.winner === "draw") status = "Draw — board full";
    else if (g.winner) status = g.endReason === "resign"
      ? (g.winner === onlineColor ? "Opponent resigned — you win!" : "You resigned")
      : (g.winner === onlineColor ? "You win!" : "Opponent wins");
    else status = g.turn === onlineColor ? "Your move" : "Opponent's move";
  } else if (g.winner === "draw") status = "Draw — board full";
  else if (g.winner) status = mode === "ai" ? (g.winner === humanColor ? "You win!" : "Computer wins") : `${g.winner === "black" ? "Black" : "White"} wins!`;
  else if (thinking) status = "Computer thinking…";
  else if (mode === "ai") status = g.turn === humanColor ? "Your move" : "Computer's move";
  else status = `${g.turn === "black" ? "Black" : "White"} to move`;

  const canClick = !g.winner && (
    mode === "local" ? true
    : mode === "ai" ? (!thinking && g.turn === humanColor)
    : (g.turn === onlineColor && !!g.players?.white)
  );

  return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", maxWidth: 472, marginBottom: 14 }}>
        <button onClick={mode === "online" ? leaveOnline : () => setScreen("lobby")} style={ghostBtn}>← Menu</button>
        <div style={{ fontSize: 12, color: "#9b948a" }}>
          {mode === "ai" ? <>You: <b style={{ color: "#f2ede4" }}>{humanColor === "black" ? "Black" : "White"}</b> · <b style={{ color: "#1AFF8C" }}>L{level}</b></>
            : mode === "online" ? <>Code <b style={{ color: "#1AFF8C", letterSpacing: "0.1em" }}>{code}</b> · You: <b style={{ color: "#f2ede4" }}>{onlineColor === "black" ? "Black" : "White"}</b></>
            : "Two players"}
        </div>
        <div style={{ width: 52 }} />
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderRadius: 999,
        background: "#262320", border: `1px solid ${g.winner ? "#1AFF8C" : "#3a3530"}`, marginBottom: 16, minWidth: 200, justifyContent: "center",
      }}>
        {!g.winner && (
          <span style={{ width: 16, height: 16, borderRadius: "50%", background: g.turn === "black" ? "#15110d" : "#f2ede4", border: "1px solid #6b645b" }} />
        )}
        <span style={{ fontWeight: 600, fontSize: 15, color: g.winner ? "#1AFF8C" : "#f2ede4" }}>{status}</span>
      </div>

      <div style={{ background: "#d8b878", padding: 14, borderRadius: 8, boxShadow: "0 8px 30px rgba(0,0,0,.5)", opacity: thinking ? 0.85 : 1 }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${SIZE}, 1fr)`, position: "relative" }}>
          {g.board.map((row, r) =>
            row.map((cell, c) => {
              const key = `${r},${c}`;
              const isLast = lastMove && lastMove.r === r && lastMove.c === c;
              const isWin = winSet.has(key);
              return (
                <button key={key} onClick={() => human(r, c)}
                  style={{ width: 30, height: 30, padding: 0, border: "none", background: "transparent",
                    cursor: canClick && !cell ? "pointer" : "default", position: "relative" }}
                  aria-label={`row ${r + 1} column ${c + 1}`}>
                  <span style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1, background: "#8a6f43", transform: "translateY(-50%)",
                    clipPath: c === 0 ? "inset(0 0 0 50%)" : c === SIZE - 1 ? "inset(0 50% 0 0)" : "none" }} />
                  <span style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "#8a6f43", transform: "translateX(-50%)",
                    clipPath: r === 0 ? "inset(50% 0 0 0)" : r === SIZE - 1 ? "inset(0 0 50% 0)" : "none" }} />
                  {[3, 7, 11].includes(r) && [3, 7, 11].includes(c) && !cell && (
                    <span style={{ position: "absolute", top: "50%", left: "50%", width: 6, height: 6, borderRadius: "50%", background: "#8a6f43", transform: "translate(-50%, -50%)" }} />
                  )}
                  {cell && (
                    <span style={{
                      position: "absolute", top: "50%", left: "50%", width: 24, height: 24, borderRadius: "50%", transform: "translate(-50%, -50%)",
                      background: cell === "black" ? "radial-gradient(circle at 35% 30%, #4a443c, #15110d)" : "radial-gradient(circle at 35% 30%, #ffffff, #cfc7ba)",
                      boxShadow: isWin ? "0 0 0 2px #1AFF8C, 0 0 8px #1AFF8C" : "0 1px 3px rgba(0,0,0,.5)",
                      outline: isLast && !isWin ? "2px solid #e0533a" : "none", outlineOffset: -2, zIndex: 2,
                    }} />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 22 }}>
        {mode === "online" ? (
          g.winner ? (
            <button onClick={rematchOnline} style={primaryBtnSm}>Rematch</button>
          ) : (
            <button onClick={resignOnline} disabled={!g.players?.white}
              style={{ ...secondaryBtn, padding: "10px 20px", fontSize: 14, opacity: g.players?.white ? 1 : 0.5 }}>
              Resign
            </button>
          )
        ) : g.winner ? (
          <button onClick={rematch} style={primaryBtnSm}>New game</button>
        ) : (
          <button onClick={undo} disabled={g.history.length === 0 || thinking}
            style={{ ...secondaryBtn, padding: "10px 20px", fontSize: 14, opacity: g.history.length === 0 || thinking ? 0.5 : 1 }}>
            Undo
          </button>
        )}
        {mode === "ai" && (g.winner || g.history.length === 0) && (
          <button onClick={swapSides} style={{ ...secondaryBtn, padding: "10px 20px", fontSize: 14 }}>
            Swap sides
          </button>
        )}
      </div>

      <p style={{ fontSize: 12, color: "#6b645b", marginTop: 18, maxWidth: 360, textAlign: "center" }}>
        Move {g.history.length} · Freestyle rules · Black moves first
      </p>
    </div>
  );
}

const wrap = { minHeight: "100vh", background: "#1a1816", color: "#f2ede4", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 16px", boxSizing: "border-box" };
const label = { fontSize: 11, color: "#9b948a", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 };
const primaryBtn = { width: "100%", padding: "14px 20px", borderRadius: 10, border: "1px solid #1AFF8C", background: "#1AFF8C", color: "#15110d", fontSize: 16, fontWeight: 700, cursor: "pointer" };
const primaryBtnSm = { ...primaryBtn, width: "auto", padding: "10px 20px", fontSize: 14 };
const secondaryBtn = { width: "100%", padding: "12px 20px", borderRadius: 10, border: "1px solid #3a3530", background: "#262320", color: "#f2ede4", fontSize: 15, fontWeight: 600, cursor: "pointer" };
const ghostBtn = { padding: "8px 12px", borderRadius: 8, border: "1px solid #3a3530", background: "transparent", color: "#9b948a", fontSize: 13, fontWeight: 600, cursor: "pointer" };
```

- [ ] **Step 2: Verify the app builds**

Run: `cd ~/Desktop/gomoku-online && npm run build`
Expected: build completes with no errors; route `/api/lobby` and `/` are listed.

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/gomoku-online
git add app/page.jsx
git commit -m "Add full client UI with online play"
```

---

## Task 8: Local two-tab manual verification

**Files:** none (manual test)

- [ ] **Step 1: Start the dev server**

Run: `cd ~/Desktop/gomoku-online && npm run dev`
Leave it running. Open `http://localhost:3000`.

- [ ] **Step 2: Full online round-trip (two browser tabs/windows)**

1. Tab A → "Create game · get a code" → note the 4-letter code → "Waiting…" screen.
2. Tab B → type the code → "Join" → both tabs show the board.
3. Tab A (Black) plays; within ~1s Tab B shows the stone and "Your move".
4. Play to a win → both show win/lose.
5. Click "Rematch" in one tab → board resets in both; colors swap (the previous White now moves first / shows "Your move").
6. Start a new game, click "Resign" in Tab A → Tab B shows "Opponent resigned — you win!".
7. Reload Tab B mid-game → it returns to the same game (reconnect).

Expected: all seven behaviors hold. Stop the server with Ctrl-C when done.

- [ ] **Step 3: Regression — vs Computer + local still work**

1. From the lobby, pick a level, "Play vs Computer" → computer responds.
2. Back to menu → "Two players (same device)" → alternating black/white works, Undo works.

Expected: both classic modes behave as before.

- [ ] **Step 4: Run the unit suite**

Run: `cd ~/Desktop/gomoku-online && npm test`
Expected: all tests pass.

---

## Task 9: Deploy documentation (`README.md`)

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# Gomoku Online

Five-in-a-row. Play the computer, two players on one device, or a friend online with a shared 4-letter code.

## Run locally

```bash
npm install
npm run dev   # http://localhost:3000  (online play uses an in-memory store — open two tabs)
```

## Deploy to Vercel (online play for real friends)

1. **Push to GitHub**

   ```bash
   git remote add origin https://github.com/<you>/gomoku-online.git
   git push -u origin main
   ```

2. **Import to Vercel** — vercel.com → Add New → Project → pick the repo → Deploy.

3. **Add the database** — In the Vercel project → **Storage** → **Create Database** → **Upstash for Redis** (free tier) → connect it to the project. This injects `KV_REST_API_URL` / `KV_REST_API_TOKEN` automatically.

4. **Redeploy** — Vercel → Deployments → Redeploy (so the new env vars apply).

5. **Share** — open the deployed URL, "Create game", send the code to a friend.

> Without Upstash the app still runs, but online play won't work across devices in production (serverless instances don't share memory). The in-memory store is for local dev only.
```

- [ ] **Step 2: Commit**

```bash
cd ~/Desktop/gomoku-online
git add README.md
git commit -m "Add deploy README"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** create/join/move/state/rematch/resign (Task 4/5); polling + 204 (Task 5/7); authoritative referee (Task 4); derived online color for rematch swap (Task 7); reconnect via localStorage (Task 7); in-memory dev fallback (Task 3); unit tests (Task 2/4); deploy steps (Task 9). All spec sections map to a task.
- **Naming consistency:** `players.{black,white}`, `version`, `endReason`, `winLine`, error codes (`not_found`/`full`/`not_your_turn`/`occupied`/`game_over`/`no_opponent`/`not_a_player`/`bad_request`) are identical across `lib/lobby.js`, `route.js`, and `app/page.jsx`.
- **No online Undo** by design; Undo button only renders for ai/local.
```
