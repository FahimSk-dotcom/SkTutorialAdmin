import { getEnv } from "./env";

export type FcmSendResult = {
  ok: boolean;
  token: string;
  messageId?: string;
  errorCode?: string;
  errorMessage?: string;
  invalidToken?: boolean;
};

type FirebaseAdminModule = typeof import("firebase-admin");

let adminMod: FirebaseAdminModule | null = null;
let adminLoadAttempted = false;
let initialized = false;
let initError: string | null = null;

function loadAdmin(): FirebaseAdminModule | null {
  if (adminLoadAttempted) return adminMod;
  adminLoadAttempted = true;
  try {
    // Use runtime require so missing dependency/config does not break module compilation.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    adminMod = require("firebase-admin") as FirebaseAdminModule;
  } catch (error) {
    adminMod = null;
    initError =
      error instanceof Error
        ? `firebase-admin is not installed (${error.message})`
        : "firebase-admin is not installed";
  }
  return adminMod;
}

function getServiceAccount(): Record<string, unknown> | null {
  const raw = getEnv().FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Support env-escaped newlines in private_key
    if (typeof parsed.private_key === "string") {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }
    return parsed;
  } catch {
    initError = "FIREBASE_SERVICE_ACCOUNT is not valid JSON";
    return null;
  }
}

function ensureInitialized(): boolean {
  if (initialized) return Boolean(adminMod && adminMod.apps.length > 0);
  initialized = true;
  if (!initError) initError = null;

  const admin = loadAdmin();
  if (!admin) {
    if (!initError) initError = "firebase-admin is not installed";
    return false;
  }

  try {
    if (admin.apps.length > 0) return true;
    const serviceAccount = getServiceAccount();
    if (!serviceAccount) {
      if (!initError) initError = "FIREBASE_SERVICE_ACCOUNT is not configured";
      return false;
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as any),
    });
    return true;
  } catch (error) {
    initError = error instanceof Error ? error.message : "Failed to initialize Firebase Admin";
    return false;
  }
}

export function getFcmStatus(): { configured: boolean; ready: boolean; error?: string } {
  const configured = Boolean(getEnv().FIREBASE_SERVICE_ACCOUNT);
  const ready = ensureInitialized();
  return { configured, ready, ...(initError ? { error: initError } : {}) };
}

const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

export async function sendFcmToTokens(input: {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
  retryOnMulticastError?: boolean;
}): Promise<{ ready: boolean; error?: string; uncertain?: boolean; results: FcmSendResult[] }> {
  const uniqueTokens = Array.from(new Set(input.tokens.filter(Boolean)));
  if (uniqueTokens.length === 0) {
    return { ready: ensureInitialized(), ...(initError ? { error: initError } : {}), results: [] };
  }
  if (!ensureInitialized() || !adminMod) {
    return {
      ready: false,
      ...(initError ? { error: initError } : {}),
      results: uniqueTokens.map((token) => ({
        ok: false,
        token,
        errorCode: "FCM_NOT_CONFIGURED",
        errorMessage: initError ?? "FCM not configured",
      })),
    };
  }

  const messageBase = {
    notification: { title: input.title, body: input.body },
    data: input.data ?? {},
    android: {
      priority: "high" as const,
      notification: {
        channelId: "announcements_default",
        sound: "default",
      },
    },
  };

  // firebase-admin supports sendEachForMulticast; fall back per-token for compatibility
  const messaging = adminMod.messaging();
  try {
    if (typeof (messaging as any).sendEachForMulticast === "function") {
      const resp = await (messaging as any).sendEachForMulticast({ ...messageBase, tokens: uniqueTokens });
      return {
        ready: true,
        results: (resp.responses as Array<{ success: boolean; messageId?: string; error?: { code?: string; message?: string } }>).map((r, i) => {
          const code = r.error?.code;
          return {
            ok: r.success,
            token: uniqueTokens[i],
            messageId: r.messageId,
            errorCode: code,
            errorMessage: r.error?.message,
            invalidToken: code ? INVALID_TOKEN_CODES.has(code) : false,
          };
        }),
      };
    }
  } catch {
    if (input.retryOnMulticastError === false) {
      return { ready: true, uncertain: true, results: [] };
    }
    // fall through to per-token
  }

  const results: FcmSendResult[] = [];
  for (const token of uniqueTokens) {
    try {
      const messageId = await messaging.send({ ...messageBase, token } as any);
      results.push({ ok: true, token, messageId });
    } catch (error: any) {
      const code = typeof error?.code === "string" ? error.code : undefined;
      results.push({
        ok: false,
        token,
        errorCode: code ?? "FCM_SEND_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
        invalidToken: code ? INVALID_TOKEN_CODES.has(code) : false,
      });
    }
  }
  return { ready: true, results };
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
