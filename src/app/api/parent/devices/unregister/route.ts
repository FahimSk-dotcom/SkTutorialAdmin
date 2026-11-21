import { getDb } from "@/lib/mongodb";
import { parentJson, parentOptions } from "@/lib/parent-cors";
import { getAuthenticatedParent, ParentAuthConfigError } from "@/lib/parent-auth";
import { parentDeviceUnregisterSchema } from "@/schemas";
import { unregisterParentDevice } from "@/lib/announcements";

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || /ECONNRESET|aborted/i.test(error.message);
}

export async function POST(request: Request) {
  try {
    if (request.signal.aborted) {
      return parentJson(request, { success: false, error: "Request aborted" }, 499);
    }

    const auth = await getAuthenticatedParent(request);
    if (!auth.ok) {
      return parentJson(request, { success: false, error: auth.error ?? "Authentication failed" }, auth.status);
    }

    let body: unknown = {};
    try { body = await request.json(); } catch { body = {}; }
    const parsed = parentDeviceUnregisterSchema.safeParse(body);
    if (!parsed.success) {
      return parentJson(request, { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
    }

    const db = await getDb();
    const result = await unregisterParentDevice({
      db,
      parentId: auth.parent._id.toString(),
      fcmToken: parsed.data.fcmToken,
      deviceId: parsed.data.deviceId,
    });

    return parentJson(request, { success: true, ...result });
  } catch (error) {
    if (error instanceof ParentAuthConfigError) {
      return parentJson(request, { success: false, error: "Parent service is temporarily unavailable" }, 503);
    }
    if (request.signal.aborted || isAbortError(error)) {
      return parentJson(request, { success: false, error: "Request aborted" }, 499);
    }
    console.error("POST /api/parent/devices/unregister error:", error);
    return parentJson(request, { success: false, error: "Failed to unregister device" }, 500);
  }
}

export function OPTIONS(request: Request) {
  return parentOptions(request);
}
