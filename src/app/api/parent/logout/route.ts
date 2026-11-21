import { getDb } from "@/lib/mongodb";
import { parentJson, parentOptions } from "@/lib/parent-cors";
import {
  getAuthenticatedParent,
  ParentAuthConfigError,
  revokeParentSession,
} from "@/lib/parent-auth";

export async function POST(request: Request) {
  try {
    const auth = await getAuthenticatedParent(request);
    if (!auth.ok) {
      if (auth.restriction) {
        // sessions may already be revoked by enforcement; treat as logged out from client perspective
        return parentJson(request, { success: true, message: "Logged out successfully" });
      }
      return parentJson(
        request,
        { success: false, error: auth.error ?? "Authentication failed" },
        auth.status
      );
    }

    const db = await getDb();
    await revokeParentSession(db, auth.token.jti, auth.token.parentId);

    return parentJson(request, {
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    if (error instanceof ParentAuthConfigError) {
      console.error(
        "POST /api/parent/logout configuration error:",
        error instanceof Error ? error.message : String(error)
      );
      return parentJson(
        request,
        { success: false, error: "Parent service is temporarily unavailable" },
        503
      );
    }

    console.error(
      "POST /api/parent/logout failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    );
    return parentJson(
      request,
      { success: false, error: "Unable to log out right now" },
      500
    );
  }
}

export function OPTIONS(request: Request) {
  return parentOptions(request);
}
