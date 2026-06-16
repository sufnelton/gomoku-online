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
