import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedAdmin } from "@/lib/auth";
import { attendanceSubmitSchema, singleAttendanceUpdateSchema } from "@/schemas";
import { isFutureDate } from "@/lib/date";
import {
  buildAttendanceUpsertOps,
  buildAttendanceUpdateOp,
} from "@/lib/attendance";

export async function GET(req: Request) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    const batch = searchParams.get("batch");
    const studentId = searchParams.get("studentId");
    const month = searchParams.get("month");

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Date must be YYYY-MM-DD" }, { status: 400 });
    }
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "Month must be YYYY-MM" }, { status: 400 });
    }

    const db = await getDb();
    const query: Record<string, any> = { docType: "attendance" };

    if (date) query.date = date;
    if (batch && batch !== "All") query.batch = batch;
    if (studentId) query.studentId = studentId;
    if (month) query.date = new RegExp(`^${month}`);

    const records = await db
      .collection("attendance")
      .find(query)
      .sort({ date: -1, batch: 1 })
      .toArray();

    return NextResponse.json(records);
  } catch (error: any) {
    console.error("GET attendance error:", error);
    return NextResponse.json({ error: "Failed to fetch attendance" }, { status: 500 });
  }
}

async function findMissingStudentIds(db: any, studentIds: string[]): Promise<string[]> {
  const uniqueIds = Array.from(new Set(studentIds));
  if (uniqueIds.length === 0) return [];
  const found = await db
    .collection("students")
    .find({ studentId: { $in: uniqueIds } }, { projection: { studentId: 1 } })
    .toArray();
  const foundIds = new Set(found.map((s: any) => s.studentId));
  return uniqueIds.filter((id) => !foundIds.has(id));
}

export async function POST(req: Request) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = attendanceSubmitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { date, batch, records } = parsed.data;

    if (isFutureDate(date)) {
      return NextResponse.json(
        { error: "Attendance cannot be marked for future dates" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const missingStudentIds = await findMissingStudentIds(
      db,
      records.map((rec) => rec.studentId)
    );
    if (missingStudentIds.length > 0) {
      return NextResponse.json(
        { error: `Unknown student ID(s): ${missingStudentIds.join(", ")}` },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const bulkOps = buildAttendanceUpsertOps(date, batch, records, now);

    const result = await db.collection("attendance").bulkWrite(bulkOps);

    return NextResponse.json({
      success: true,
      date,
      batch,
      modifiedCount: result.modifiedCount || 0,
      upsertedCount: result.upsertedCount || 0,
      totalStudents: records.length,
      presentCount: records.filter((r) => r.status === "present").length,
      absentCount: records.filter((r) => r.status === "absent").length,
    });
  } catch (error: any) {
    console.error("POST attendance error:", error);
    return NextResponse.json({ error: "Failed to save attendance" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = singleAttendanceUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { date, batch, studentId, status } = parsed.data;

    if (isFutureDate(date)) {
      return NextResponse.json(
        { error: "Attendance cannot be marked for future dates" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const missingStudentIds = await findMissingStudentIds(db, [studentId]);
    if (missingStudentIds.length > 0) {
      return NextResponse.json(
        { error: `Unknown student ID: ${studentId}` },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const op = buildAttendanceUpdateOp(date, batch, studentId, status, now);

    await db
      .collection("attendance")
      .updateOne(op.filter, op.update, op.options);

    return NextResponse.json({ success: true, date, batch, studentId, status });
  } catch (error: any) {
    console.error("PUT attendance error:", error);
    return NextResponse.json({ error: "Failed to update attendance status" }, { status: 500 });
  }
}
