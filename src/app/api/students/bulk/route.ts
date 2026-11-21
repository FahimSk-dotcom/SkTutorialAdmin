import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedAdmin } from "@/lib/auth";
import {
  buildStudentArchiveUpdate,
  buildStudentReactivationUpdate,
} from "@/lib/student-archive";
import { revokeParentSessionsForAffectedStudentsIfNoActive } from "@/lib/parent-auth";

export async function POST(req: Request) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { action, studentIds } = await req.json();

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json({ error: "No students selected" }, { status: 400 });
    }

    const db = await getDb();
    const filter = { studentId: { $in: studentIds } };

    if (action === "delete" || action === "archive" || action === "deactivate") {
      const result = await db
        .collection("students")
        .updateMany(filter, buildStudentArchiveUpdate());

      await revokeParentSessionsForAffectedStudentsIfNoActive(db, studentIds).catch(() => undefined);

      return NextResponse.json({
        success: true,
        archivedCount: result.modifiedCount,
        message: "Selected students archived successfully. Payment and attendance history preserved.",
      });
    }

    if (action === "activate") {
      const result = await db
        .collection("students")
        .updateMany(filter, buildStudentReactivationUpdate());

      // Reactivation may restore access for parents who previously had no active students,
      // but sessions were revoked; they must log in again (expected). No session creation here.

      return NextResponse.json({
        success: true,
        updatedCount: result.modifiedCount,
        message: "Students reactivated successfully",
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("POST /api/students/bulk error:", error);
    return NextResponse.json({ error: "Failed to perform bulk operation" }, { status: 500 });
  }
}
