import { NextResponse } from "next/server";
import {
  createLobby, joinLobby, moveInLobby, rematchLobby, resignLobby, chatMessage, getState,
} from "../../../lib/lobby.js";
import { bump } from "../../../lib/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* There is deliberately no GET.
 *
 * It used to return a whole lobby to anyone holding the code, with no
 * passphrase check and no way to prove membership. Codes are four characters
 * from a 24-letter alphabet -- 331,776 of them -- so the whole space was
 * sweepable, and what came back included both players' ids, which are the only
 * credential any write action checks. Reading a game now requires being in it,
 * and the id travels in a POST body rather than a URL that lands in logs. */

const ERR_STATUS = {
  not_found: 404,
  full: 409,
  not_your_turn: 409,
  occupied: 409,
  forbidden: 409,
  bad_pass: 403,
  game_over: 409,
  no_opponent: 409,
  not_a_player: 403,
  bad_request: 400,
  rate_limited: 429,
};

function out(result) {
  if (result && result.error) {
    return NextResponse.json({ error: result.error }, { status: ERR_STATUS[result.error] || 400 });
  }
  return NextResponse.json(result);
}

/* Two buckets per minute. The wide one is sized for real play -- a poll every
 * 1.2s is 50/min, so a few tabs still fit. The narrow one covers the only two
 * actions that accept a code you have not been given, which is what a sweep
 * has to use; at 30/min, walking the code space takes about a week per IP. */
const WINDOW = 60;
const LIMIT_ALL = 300;
const LIMIT_GUESS = 30;

function clientIp(req) {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : "") || req.headers.get("x-real-ip") || "unknown";
}

async function limited(req, action) {
  const ip = clientIp(req);
  if (await bump(`rl:lobby:${ip}`, WINDOW) > LIMIT_ALL) return true;
  if ((action === "join" || action === "create")
    && await bump(`rl:guess:${ip}`, WINDOW) > LIMIT_GUESS) return true;
  return false;
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

  if (await limited(req, action)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  switch (action) {
    case "create": return out(await createLobby(playerId, body.name, body.pass));
    case "join": return out(await joinLobby(playerId, body.name, code, body.pass));
    case "move": return out(await moveInLobby(playerId, code, body.r, body.c));
    case "rematch": return out(await rematchLobby(playerId, code));
    case "resign": return out(await resignLobby(playerId, code));
    case "chat": return out(await chatMessage(playerId, code, body.text));
    case "state": {
      if (!code) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      const result = await getState(code, playerId);
      if (result.error) return out(result);
      // Unchanged since the version the client already has: say so cheaply.
      const v = Number(body.v || 0);
      if (v && result.state.version === v) return new NextResponse(null, { status: 204 });
      return NextResponse.json(result);
    }
    default: return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
}
