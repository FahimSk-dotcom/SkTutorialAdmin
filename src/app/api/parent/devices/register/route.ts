import { getDb } from "@/lib/mongodb";
import { parentJson, parentOptions } from "@/lib/parent-cors";
import { getAuthenticatedParent, ParentAuthConfigError } from "@/lib/parent-auth";
import { parentDeviceRegisterSchema } from "@/schemas";
import { registerParentDevice } from "@/lib/announcements";

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || /ECONNRESET|aborted/i.test(error.message);
}

export async function POST(request: Request) {
  try {
    if (request.signal.aborted) {
      return parentJson(request, { success: false, error: "Request aborted" }, 499);
    }

    const auth = await getAuthenticatedParent(request, { requireActiveStudents: true });
    if (!auth.ok) {
      return parentJson(request, { success: false, error: auth.error ?? "Authentication failed" }, auth.status);
    }

    let body: unknown;
    try { body = await request.json(); } catch {
      return parentJson(request, { success: false, error: "Invalid request body" }, 400);
    }
    const parsed = parentDeviceRegisterSchema.safeParse(body);
    if (!parsed.success) {
      return parentJson(request, { success: false, error: parsed.error.issues[0]?.message ?? "Invalid device data" }, 400);
    }

    const db = await getDb();
    const device = await registerParentDevice({
      db,
      parentId: auth.parent._id.toString(),
      parentMobile: auth.parent.parentMobile,
      fcmToken: parsed.data.fcmToken,
      platform: parsed.data.platform,
      deviceId: parsed.data.deviceId ?? null,
    });

    return parentJson(request, {
      success: true,
      device: device
        ? {
            platform: device.platform,
            deviceId: device.deviceId ?? null,
            isActive: device.isActive,
            updatedAt: device.updatedAt instanceof Date ? device.updatedAt.toISOString() : device.updatedAt,
          }
        : null,
    });
  } catch (error) {
    if (error instanceof ParentAuthConfigError) {
      return parentJson(request, { success: false, error: "Parent service is temporarily unavailable" }, 503);
    }
    if (request.signal.aborted || isAbortError(error)) {
      // The client timed out and hung up. Treat the disconnect as expected
      // instead of logging it as an unhandled server failure.
      return parentJson(request, { success: false, error: "Request aborted" }, 499);
    }
    console.error("POST /api/parent/devices/register error:", error);
    return parentJson(request, { success: false, error: "Failed to register device" }, 500);
  }
}

export function OPTIONS(request: Request) {
  return parentOptions(request);
}
