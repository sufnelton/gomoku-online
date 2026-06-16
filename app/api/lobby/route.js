import { NextResponse } from "next/server";
import {
  createLobby, joinLobby, moveInLobby, rematchLobby, resignLobby, chatMessage, getState,
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
    case "create": return out(await createLobby(playerId, body.name));
    case "join": return out(await joinLobby(playerId, body.name, code));
    case "move": return out(await moveInLobby(playerId, code, body.r, body.c));
    case "rematch": return out(await rematchLobby(playerId, code));
    case "resign": return out(await resignLobby(playerId, code));
    case "chat": return out(await chatMessage(playerId, code, body.text));
    default: return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
}
