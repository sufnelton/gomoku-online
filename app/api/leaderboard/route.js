import { NextResponse } from "next/server";
import { getLeaderboard } from "../../../lib/leaderboard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const top = Math.min(Math.max(Number(searchParams.get("top") || 20), 1), 100);
  const leaderboard = await getLeaderboard(top);
  return NextResponse.json({ leaderboard });
}
