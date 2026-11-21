import { NextResponse } from "next/server";
import { getAuthenticatedAdmin } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import {
  PARENTS_COLLECTION,
  STUDENTS_COLLECTION,
  normalizeParentMobile,
  isValidParentMobile,
  normalizeLinkedStudentIds,
} from "@/lib/parent-auth";

export async function GET(req: Request) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const rawMobile = searchParams.get("mobile") || "";
    const parentMobile = normalizeParentMobile(rawMobile);

    if (!isValidParentMobile(parentMobile)) {
      return NextResponse.json(
        { error: "Parent mobile number must be exactly 10 digits" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const parent = await db
      .collection(PARENTS_COLLECTION)
      .findOne({ parentMobile }, { projection: { passwordHash: 0 } });

    if (!parent) {
      return NextResponse.json({
        found: false,
        status: "NOT_FOUND",
        parentMobile,
      });
    }

    const linkedIds = normalizeLinkedStudentIds((parent as any).linkedStudentIds);
    const studentsRaw = linkedIds.length
      ? await db
          .collection(STUDENTS_COLLECTION)
          .find(
            { studentId: { $in: linkedIds } },
            { projection: { _id: 0, studentId: 1, name: 1, class: 1, status: 1 } }
          )
          .toArray()
      : [];

    const activeStudents = studentsRaw
      .filter((s: any) => String(s.status).toLowerCase() === "active")
      .map((s: any) => ({
        studentId: String(s.studentId),
        name: String(s.name || ""),
        class: String(s.class || ""),
      }))
      .sort((a, b) => a.studentId.localeCompare(b.studentId));

    const archivedStudents = studentsRaw
      .filter((s: any) => String(s.status).toLowerCase() !== "active")
      .map((s: any) => ({
        studentId: String(s.studentId),
        name: String(s.name || ""),
        class: String(s.class || ""),
        status: String(s.status || ""),
      }))
      .sort((a, b) => a.studentId.localeCompare(b.studentId));

    // Check if parent has a password hash set (without exposing it)
    const parentWithHash = await db
      .collection(PARENTS_COLLECTION)
      .findOne({ parentMobile }, { projection: { passwordHash: 1 } });
    const hasPassword =
      typeof (parentWithHash as any)?.passwordHash === "string" &&
      (parentWithHash as any).passwordHash.length > 0;

    const hasActiveStudents = activeStudents.length > 0;

    return NextResponse.json({
      found: true,
      status: hasPassword ? "FOUND_CONFIGURED" : "FOUND_NO_PASSWORD",
      parent: {
        _id: (parent as any)._id.toString(),
        parentName: String((parent as any).parentName || ""),
        parentMobile: String((parent as any).parentMobile || parentMobile),
        isActive: (parent as any).isActive === true,
        hasPassword,
      },
      activeStudents,
      archivedStudents,
      hasActiveStudents,
      hasArchivedOnly: !hasActiveStudents && archivedStudents.length > 0,
      hasMixedActiveArchived: hasActiveStudents && archivedStudents.length > 0,
    });
  } catch (error) {
    console.error("GET /api/admin/parents/lookup error:", error);
    return NextResponse.json(
      { error: "Failed to lookup parent account" },
      { status: 500 }
    );
  }
}
