import { createHash } from "node:crypto";
import { getEnv } from "./env";

const RESET_WINDOW_SECONDS = 15 * 60;
const RESET_MAX_ATTEMPTS = 5;
const LOCAL_LIMITS = new Map<string, { count: number; expiresAt: number }>();

export class PasswordResetRateLimitUnavailableError extends Error {
  constructor() {
    super("Password reset throttling is unavailable");
    this.name = "PasswordResetRateLimitUnavailableError";
  }
}

function hashKeyPart(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function consumeLocalLimit(keys: string[], now: number): boolean {
  for (const [key, entry] of LOCAL_LIMITS) {
    if (entry.expiresAt <= now) LOCAL_LIMITS.delete(key);
  }

  let allowed = true;
  for (const key of keys) {
    const entry = LOCAL_LIMITS.get(key);
    if (!entry || entry.expiresAt <= now) {
      LOCAL_LIMITS.set(key, { count: 1, expiresAt: now + RESET_WINDOW_SECONDS * 1000 });
      continue;
    }
    entry.count += 1;
    if (entry.count > RESET_MAX_ATTEMPTS) allowed = false;
  }
  return allowed;
}

export async function consumeParentPasswordResetLimit(
  adminId: string,
  parentId: string
): Promise<boolean> {
  const adminKey = hashKeyPart(adminId);
  const parentKey = hashKeyPart(parentId);
  const env = getEnv();

  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    if (env.APP_ENV === "production" || env.APP_ENV === "staging") {
      throw new PasswordResetRateLimitUnavailableError();
    }
    return consumeLocalLimit(
      [`parent-reset:admin:${adminKey}`, `parent-reset:parent:${parentKey}`],
      Date.now()
    );
  }

  const redisScript = [
    "local adminCount = redis.call('INCR', KEYS[1])",
    "if adminCount == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end",
    "local parentCount = redis.call('INCR', KEYS[2])",
    "if parentCount == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end",
    "if adminCount > tonumber(ARGV[2]) or parentCount > tonumber(ARGV[2]) then return 0 end",
    "return 1",
  ].join("\n");

  try {
    const response = await fetch(`${env.UPSTASH_REDIS_REST_URL.replace(/\/+$/, "")}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([[
        "EVAL",
        redisScript,
        "2",
        `parent-password-reset:admin:${adminKey}`,
        `parent-password-reset:parent:${parentKey}`,
        String(RESET_WINDOW_SECONDS),
        String(RESET_MAX_ATTEMPTS),
      ]]),
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("Redis command failed");
    const result = await response.json();
    if (!Array.isArray(result) || result[0]?.error) throw new Error("Redis response was invalid");
    return Number(result[0]?.result) === 1;
  } catch {
    throw new PasswordResetRateLimitUnavailableError();
  }
}
