import { NextResponse } from "next/server";
import { getLeaderboard, getCpuLeaderboard, recordCpuWin } from "../../../lib/leaderboard.js";
import { bump } from "../../../lib/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const top = Math.min(Math.max(Number(searchParams.get("top") || 20), 1), 100);
  const [leaderboard, cpu] = await Promise.all([getLeaderboard(top), getCpuLeaderboard(top)]);
  return NextResponse.json({ leaderboard, cpu });
}

/* The board is spoofable by design -- nothing here can verify a claimed win --
 * but "spoofable" should still mean one name at a time, not a script writing a
 * thousand rows a minute. */
export async function POST(req) {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0].trim() : "") || req.headers.get("x-real-ip") || "unknown";
  if (await bump(`rl:lb:${ip}`, 60) > 20) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const result = await recordCpuWin(body?.name, body?.level);
  if (result.error) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
