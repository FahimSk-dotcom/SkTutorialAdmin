import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { connectToDatabase, getDb } from "@/lib/mongodb";
import { getAuthenticatedAdmin } from "@/lib/auth";
import { studentSchema } from "@/schemas";
import { calculateStudentDueStatus } from "@/lib/due-calculator";
import { buildStudentArchiveUpdate, isArchivedStudent } from "@/lib/student-archive";
import { loadAttendanceSettings } from "@/lib/app-settings";
import { getEffectiveBatch, formatClassDisplay } from "@/lib/class-utils";
import { getKolkataToday } from "@/lib/date";
import { computeAttendanceSummary, filterValidAttendance } from "@/lib/attendance";
import { Student, Payment } from "@/types";
import {
  normalizeParentMobile,
  reassignStudentParentLinks,
  revokeParentSessionsIfNoActiveLinkedStudents,
  revokeParentSessionsIfNoActiveLinkedStudentsForParents,
} from "@/lib/parent-auth";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const db = await getDb();

    const students = db.collection<{ _id: ObjectId | string } & Record<string, unknown>>("students");
    let s: any = null;
    if (ObjectId.isValid(id)) {
      s = await students.findOne({ _id: new ObjectId(id) });
      // Some imported student records may store an ObjectId-shaped value as a
      // string. Keep detail retrieval compatible with either MongoDB _id type.
      if (!s) s = await students.findOne({ _id: id });
    }
    if (!s) s = await students.findOne({ studentId: id });

    if (!s) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const attendanceSettings = await loadAttendanceSettings(db);
    const effectiveBatch = getEffectiveBatch(
      s as any,
      attendanceSettings.batch1Classes,
      attendanceSettings.batch2Classes
    );

    const student: Student = {
      _id: s._id.toString(),
      studentId: s.studentId,
      name: s.name,
      class: s.class,
      batch: s.batch,
      effectiveBatch,
      formattedClass: formatClassDisplay(s.class),
      monthlyFee: s.monthlyFee,
      parentName: s.parentName,
      parentMobile: s.parentMobile,
      alternateMobile: s.alternateMobile,
      admissionDate: s.admissionDate,
      status: s.status,
      archivedAt:
        s.archivedAt instanceof Date ? s.archivedAt.toISOString() : s.archivedAt,
      address: s.address,
      remarks: s.remarks,
      createdAt: s.createdAt?.toISOString(),
      updatedAt: s.updatedAt?.toISOString(),
    };

    // Fetch payments for this student
    const paymentsRaw = await db
      .collection("payments")
      .find({ studentId: student.studentId })
      .sort({ year: -1, month: -1 })
      .toArray();

    const payments: Payment[] = paymentsRaw.map((p: any) => ({
      _id: p._id.toString(),
      studentId: p.studentId,
      paymentDate: p.paymentDate,
      month: p.month,
      year: p.year,
      amount: p.amount,
      mode: p.mode,
      receiptNo: p.receiptNo,
      collectedBy: p.collectedBy,
      remarks: p.remarks,
    }));

    const dueInfo = calculateStudentDueStatus(student, payments);

    // Find siblings (students with same parentMobile)
    const siblingsRaw = await db
      .collection("students")
      .find({ parentMobile: student.parentMobile, studentId: { $ne: student.studentId } })
      .toArray();

    const siblings = await Promise.all(
      siblingsRaw.map(async (sib: any) => {
        const sibPaymentsRaw = await db
          .collection("payments")
          .find({ studentId: sib.studentId })
          .toArray();

        const sibPayments: Payment[] = sibPaymentsRaw.map((p: any) => ({
          _id: p._id.toString(),
          studentId: p.studentId,
          paymentDate: p.paymentDate,
          month: p.month,
          year: p.year,
          amount: p.amount,
          mode: p.mode,
          receiptNo: p.receiptNo,
          collectedBy: p.collectedBy,
        }));

        const sibStudent: Student = {
          _id: sib._id.toString(),
          studentId: sib.studentId,
          name: sib.name,
          class: sib.class,
          monthlyFee: sib.monthlyFee,
          parentName: sib.parentName,
          parentMobile: sib.parentMobile,
          admissionDate: sib.admissionDate,
          status: sib.status,
          archivedAt:
            sib.archivedAt instanceof Date ? sib.archivedAt.toISOString() : sib.archivedAt,
        };

        const sibDueInfo = calculateStudentDueStatus(sibStudent, sibPayments);

        return {
          student: sibStudent,
          dueInfo: sibDueInfo,
        };
      })
    );

    const todayStr = getKolkataToday();

    const attendanceRaw = await db
      .collection("attendance")
      .find({
        docType: "attendance",
        studentId: student.studentId,
        date: { $lte: todayStr },
      })
      .sort({ date: -1 })
      .toArray();

    const holidays = await db
      .collection("attendance")
      .find({ docType: "holiday" })
      .toArray();

    const holidayDates = holidays.map((h: any) => h.date);
    const attendanceRecords = filterValidAttendance(
      attendanceRaw as any,
      holidayDates,
      todayStr
    );
    const attendanceSummary = computeAttendanceSummary(
      attendanceRaw as any,
      holidayDates,
      todayStr
    );

    return NextResponse.json({
      student,
      payments,
      dueInfo,
      siblings,
      attendanceSummary,
      attendanceRecords,
    });
  } catch (error: any) {
    console.error("GET /api/students/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch student details" }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const parsed = studentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const rawClass = parsed.data.class;
    const cleanClassNumber = rawClass.replace(/^class\s+/i, "").trim();
    const formattedClass = cleanClassNumber ? `Class ${cleanClassNumber}` : rawClass;

    const { client, db } = await connectToDatabase();
    const filter = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { studentId: id };

    const existingStudent = await db.collection("students").findOne(filter);
    if (!existingStudent) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const now = new Date();
    const updateDoc: Record<string, any> = {
      $set: {
        ...parsed.data,
        class: formattedClass,
        updatedAt: now,
      },
    };

    if (parsed.data.status === "Inactive") {
      updateDoc.$set.archivedAt = existingStudent.archivedAt || now;
    } else {
      updateDoc.$unset = { archivedAt: "" };
    }

    const session = client.startSession();
    let previousParentIds: string[] = [];
    const studentId = String((existingStudent as any).studentId || "");
    const previousParentMobile = String((existingStudent as any).parentMobile || "");
    const nextParentMobile = normalizeParentMobile(parsed.data.parentMobile);
    const transactionFilter = {
      ...filter,
      parentMobile: (existingStudent as any).parentMobile,
    };

    try {
      await session.withTransaction(async () => {
        const updateResult = await db.collection("students").updateOne(transactionFilter, updateDoc, { session });
        if (updateResult.matchedCount !== 1) {
          throw new Error("STUDENT_UPDATE_CONFLICT");
        }

        if (studentId) {
          previousParentIds = await reassignStudentParentLinks(db, session, {
            studentId,
            previousParentMobile,
            nextParentMobile,
            now,
          });
        }
      });
    } finally {
      await session.endSession();
    }

    // Relationship changes are already committed atomically. Revoking sessions
    // is defense in depth; student ownership checks also enforce the new mobile.
    await revokeParentSessionsIfNoActiveLinkedStudentsForParents(db, previousParentIds)
      .catch(() => console.error("Parent session reconciliation failed after student reassignment"));

    // If the student became inactive/archived, ensure parent access is revoked when no active siblings remain.
    if (parsed.data.status === "Inactive" && studentId) {
      await revokeParentSessionsIfNoActiveLinkedStudents(db, studentId).catch(() => undefined);
    }

    return NextResponse.json({ success: true, message: "Student updated successfully" });
  } catch (error: any) {
    console.error("PUT /api/students/[id] error:", error);
    return NextResponse.json({ error: "Failed to update student" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const db = await getDb();

    const filter = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { studentId: id };
    const student = await db.collection("students").findOne(filter);

    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    if (isArchivedStudent({ status: student.status as string })) {
      return NextResponse.json({
        success: true,
        archived: true,
        alreadyArchived: true,
        message: "Student is already archived. Payment history preserved.",
      });
    }

    await db
      .collection("students")
      .updateOne(filter, buildStudentArchiveUpdate());

    const sid = String((student as any).studentId || "");
    if (sid) {
      await revokeParentSessionsIfNoActiveLinkedStudents(db, sid).catch(() => undefined);
    }

    return NextResponse.json({
      success: true,
      archived: true,
      alreadyArchived: false,
      message: "Student archived successfully. Payment history preserved.",
    });
  } catch (error: any) {
    console.error("DELETE /api/students/[id] error:", error);
    return NextResponse.json({ error: "Failed to archive student" }, { status: 500 });
  }
}
