import { normalizeClass } from "@/lib/class-utils";
import { getDb } from "@/lib/mongodb";
import {
  getAuthenticatedParent, parentAccessRestrictedBody, ParentAuthConfigError, verifyParentStudentAccess,
} from "@/lib/parent-auth";
import { parentJson, parentOptions } from "@/lib/parent-cors";
import { getTimetable } from "@/lib/timetables";

export async function GET(request: Request) {
  function json(body: unknown, status = 200) {
    const response = parentJson(request, body, status);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  try {
    const auth = await getAuthenticatedParent(request, { requireActiveStudents: true });
    if (!auth.ok) return json(auth.restriction ? parentAccessRestrictedBody(auth.restriction)
      : { success: false, message: auth.error ?? "Authentication required." }, auth.status);

    const studentId = new URL(request.url).searchParams.get("studentId") ?? "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(studentId)) return json({ success: false, message: "Select a linked student." }, 400);
    const db = await getDb();
    const access = await verifyParentStudentAccess(db, auth.parent, studentId);
    if (!access.ok) return json(access.failure.body, access.failure.status);
    const studentClass = typeof access.student.class === "string" ? access.student.class : "";
    const classId = normalizeClass(studentClass);
    const timetable = classId ? await getTimetable(db, classId, true) : null;
    return json({
      studentId, studentClass,
      timetable: timetable ? { layout: timetable.layout, days: timetable.days, updatedAt: timetable.updatedAt } : null,
    });
  } catch (error) {
    if (error instanceof ParentAuthConfigError) return json({ message: "The parent service is temporarily unavailable." }, 503);
    console.error("Parent timetable request failed", error);
    return json({ message: "Unable to load the timetable." }, 500);
  }
}

export const OPTIONS = parentOptions;
