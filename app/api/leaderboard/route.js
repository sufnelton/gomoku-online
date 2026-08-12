import { NextResponse } from "next/server";
import { getLeaderboard, getCpuLeaderboard, recordCpuWin } from "../../../lib/leaderboard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const top = Math.min(Math.max(Number(searchParams.get("top") || 20), 1), 100);
  const [leaderboard, cpu] = await Promise.all([getLeaderboard(top), getCpuLeaderboard(top)]);
  return NextResponse.json({ leaderboard, cpu });
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const result = await recordCpuWin(body?.name, body?.level);
  if (result.error) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
