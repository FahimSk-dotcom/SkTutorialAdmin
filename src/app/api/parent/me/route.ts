import { getDb } from "@/lib/mongodb";
import { parentJson, parentOptions } from "@/lib/parent-cors";
import {
  getActiveLinkedStudents,
  getAuthenticatedParent,
  parentAccessRestrictedBody,
  ParentAuthConfigError,
} from "@/lib/parent-auth";

export async function GET(request: Request) {
  try {
    const auth = await getAuthenticatedParent(request, { requireActiveStudents: true });
    if (!auth.ok) {
      if (auth.restriction) {
        return parentJson(request, parentAccessRestrictedBody(auth.restriction), auth.status);
      }
      return parentJson(
        request,
        { success: false, error: auth.error ?? "Authentication failed" },
        auth.status
      );
    }

    const db = await getDb();
    const students = await getActiveLinkedStudents(db, auth.parent.linkedStudentIds, auth.parent.parentMobile);

    return parentJson(request, {
      success: true,
      parent: {
        name: auth.parent.parentName,
        mobile: auth.parent.parentMobile,
        status: "ACTIVE",
      },
      access: {
        status: "ACTIVE",
        activeStudentCount: students.length,
      },
      students: students.map((s) => ({
        studentId: s.studentId,
        name: s.name,
        status: "ACTIVE",
      })),
    });
  } catch (error) {
    if (error instanceof ParentAuthConfigError) {
      console.error(
        "GET /api/parent/me configuration error:",
        error instanceof Error ? error.message : String(error)
      );
      return parentJson(
        request,
        { success: false, error: "Parent service is temporarily unavailable" },
        503
      );
    }

    console.error(
      "GET /api/parent/me failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    );
    return parentJson(
      request,
      { success: false, error: "Unable to load parent session" },
      500
    );
  }
}

export function OPTIONS(request: Request) {
  return parentOptions(request);
}
