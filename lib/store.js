import { Redis } from "@upstash/redis";

const TTL_SECONDS = 6 * 60 * 60;

// In-memory fallback stores (used when no Upstash env vars are set — local dev).
// Held on globalThis so all route bundles + HMR reloads share one instance in dev.
const _g = globalThis;
_g.__gomokuMem ??= { mem: new Map(), memHash: new Map(), memZset: new Map(), memCount: new Map() };
const mem = _g.__gomokuMem.mem;          // code -> lobby JSON
const memHash = _g.__gomokuMem.memHash;  // key -> Map(field -> number/string)
const memZset = _g.__gomokuMem.memZset;  // key -> Map(member -> number score)
const memCount = _g.__gomokuMem.memCount; // key -> { n, until }

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

// ---------------- Lobby JSON ----------------

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

// ---------------- Hash ops ----------------

export async function hincrby(key, field, n) {
  if (hasRedis()) return await redis().hincrby(key, field, n);
  const h = memHash.get(key) || new Map();
  const next = Number(h.get(field) || 0) + n;
  h.set(field, next);
  memHash.set(key, h);
  return next;
}

export async function hset(key, obj) {
  if (hasRedis()) return await redis().hset(key, obj);
  const h = memHash.get(key) || new Map();
  for (const [k, v] of Object.entries(obj)) h.set(k, v);
  memHash.set(key, h);
}

export async function hgetall(key) {
  if (hasRedis()) return (await redis().hgetall(key)) || {};
  const h = memHash.get(key);
  if (!h) return {};
  return Object.fromEntries(h.entries());
}

// ---------------- Sorted-set ops ----------------

export async function zincrby(key, member, n) {
  if (hasRedis()) return await redis().zincrby(key, n, member);
  const z = memZset.get(key) || new Map();
  const next = Number(z.get(member) || 0) + n;
  z.set(member, next);
  memZset.set(key, z);
  return next;
}

// Returns [{ member, score }] sorted by score descending, top `count`.
export async function zrevrangeWithScores(key, count) {
  if (hasRedis()) {
    const arr = await redis().zrange(key, 0, count - 1, { rev: true, withScores: true });
    const out = [];
    for (let i = 0; i < arr.length; i += 2) out.push({ member: arr[i], score: Number(arr[i + 1]) });
    return out;
  }
  const z = memZset.get(key);
  if (!z) return [];
  return [...z.entries()]
    .map(([member, score]) => ({ member, score: Number(score) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

// ---------------- Counters (rate limiting) ----------------

/* Increment `key`, setting a TTL on the first hit, and return the new count.
 * Redis-backed so the limit is shared across serverless instances -- a
 * per-instance counter would be trivially sidestepped by fanning requests out. */
export async function bump(key, ttlSeconds) {
  if (hasRedis()) {
    const n = await redis().incr(key);
    if (n === 1) await redis().expire(key, ttlSeconds);
    return n;
  }
  const rec = memCount.get(key);
  const t = Date.now();
  if (!rec || t > rec.until) { memCount.set(key, { n: 1, until: t + ttlSeconds * 1000 }); return 1; }
  rec.n += 1;
  return rec.n;
}

// Test-only helper.
export function _resetMemory() {
  mem.clear();
  memHash.clear();
  memZset.clear();
  memCount.clear();
}
