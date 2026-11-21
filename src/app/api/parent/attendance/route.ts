import { getDb } from "@/lib/mongodb";
import { parentJson, parentOptions } from "@/lib/parent-cors";
import {
  getAuthenticatedParent,
  parentAccessRestrictedBody,
  ParentAuthConfigError,
  verifyParentStudentAccess,
} from "@/lib/parent-auth";
import {
  buildParentAttendanceResponse,
  getMonthDateRange,
  isValidMonth,
  type ParentAttendanceSourceRecord,
  type ParentAttendanceStudent,
} from "@/lib/parent-attendance";
import { getKolkataToday } from "@/lib/date";

const ATTENDANCE_COLLECTION = "attendance";
const STUDENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

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

    const { searchParams } = new URL(request.url);
    const studentId = (searchParams.get("studentId") ?? "").trim();
    const month = (searchParams.get("month") ?? "").trim();

    if (!studentId) {
      return parentJson(
        request,
        { success: false, error: "studentId is required" },
        400
      );
    }

    if (!STUDENT_ID_PATTERN.test(studentId)) {
      return parentJson(
        request,
        { success: false, error: "Invalid studentId" },
        400
      );
    }

    if (!isValidMonth(month)) {
      return parentJson(
        request,
        { success: false, error: "month must be in YYYY-MM format" },
        400
      );
    }

    const db = await getDb();
    const access = await verifyParentStudentAccess(db, auth.parent, studentId);
    if (!access.ok) {
      return parentJson(request, access.failure.body, access.failure.status);
    }

    const student = access.student as unknown as ParentAttendanceStudent;
    const range = getMonthDateRange(month);
    if (!range) {
      return parentJson(
        request,
        { success: false, error: "month must be in YYYY-MM format" },
        400
      );
    }

    const sourceRecords = await db
      .collection(ATTENDANCE_COLLECTION)
      .find({
        docType: "attendance",
        studentId,
        date: { $gte: range.start, $lte: range.lastDay },
      })
      .project({ _id: 0, date: 1, status: 1, updatedAt: 1, markedAt: 1 })
      .toArray();

    const response = buildParentAttendanceResponse({
      student,
      month,
      today: getKolkataToday(),
      records: sourceRecords as ParentAttendanceSourceRecord[],
    });

    return parentJson(request, response);
  } catch (error) {
    if (error instanceof ParentAuthConfigError) {
      console.error(
        "GET /api/parent/attendance configuration error:",
        error instanceof Error ? error.message : String(error)
      );
      return parentJson(
        request,
        { success: false, error: "Parent service is temporarily unavailable" },
        503
      );
    }

    console.error(
      "GET /api/parent/attendance failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    );
    return parentJson(
      request,
      { success: false, error: "Unable to load attendance right now" },
      500
    );
  }
}

export function OPTIONS(request: Request) {
  return parentOptions(request);
}
