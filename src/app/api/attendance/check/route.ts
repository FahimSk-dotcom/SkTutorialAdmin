import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedAdmin } from "@/lib/auth";
import { loadAttendanceSettings } from "@/lib/app-settings";
import { isFutureDate } from "@/lib/date";
import { getEffectiveBatch, formatClassDisplay } from "@/lib/class-utils";
import type { BatchType } from "@/types";

const VALID_BATCHES: BatchType[] = ["5-7", "7-9"];

export async function GET(req: Request) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    const batch = searchParams.get("batch") as BatchType | null;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Date must be YYYY-MM-DD" }, { status: 400 });
    }
    if (!batch || !VALID_BATCHES.includes(batch)) {
      return NextResponse.json(
        { error: "Batch must be one of 5-7 or 7-9" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const settings = await loadAttendanceSettings(db);

    const holiday = await db.collection("attendance").findOne({
      docType: "holiday",
      date,
      batch: { $in: ["ALL", batch] },
    });

    const records = await db
      .collection("attendance")
      .find({ docType: "attendance", date, batch })
      .toArray();

    const activeStudents = await db
      .collection("students")
      .find({ status: "Active" })
      .sort({ class: 1, name: 1 })
      .toArray();

    const students = activeStudents.filter(
      (s: any) =>
        getEffectiveBatch(s, settings.batch1Classes, settings.batch2Classes) === batch
    );

    const recordMap = new Map(records.map((r: any) => [r.studentId, r]));

    const studentsWithStatus = students.map((s: any) => {
      const rec = recordMap.get(s.studentId) as any;
      return {
        ...s,
        class: formatClassDisplay(s.class),
        attendanceStatus: rec?.status || null,
        attendanceMarkedAt: rec?.markedAt || null,
      };
    });

    const currentRecords = students
      .map((s: any) => recordMap.get(s.studentId))
      .filter(Boolean) as any[];
    const markedCount = currentRecords.length;
    const presentCount = currentRecords.filter((r: any) => r.status === "present").length;
    const absentCount = currentRecords.filter((r: any) => r.status === "absent").length;

    return NextResponse.json({
      date,
      batch,
      batchName: batch === "5-7" ? settings.batch1Name : settings.batch2Name,
      batchTiming: batch === "5-7" ? settings.batch1Timing : settings.batch2Timing,
      students: studentsWithStatus,
      records,
      isHoliday: Boolean(holiday),
      holiday: holiday || null,
      isFuture: isFutureDate(date),
      stats: {
        totalStudents: students.length,
        marked: markedCount,
        unmarked: Math.max(students.length - markedCount, 0),
        present: presentCount,
        absent: absentCount,
      },
    });
  } catch (error: any) {
    console.error("GET attendance check error:", error);
    return NextResponse.json({ error: "Failed to load attendance" }, { status: 500 });
  }
}
