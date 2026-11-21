import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedAdmin } from "@/lib/auth";
import { loadAttendanceSettings } from "@/lib/app-settings";
import { getKolkataToday, formatKolkataFullDate, getKolkataGreeting } from "@/lib/date";
import { getContactMobile, generateTelLink } from "@/lib/phone";
import { getEffectiveBatch, formatClassDisplay } from "@/lib/class-utils";
import type { AbsenteeInfo, BatchStats } from "@/types";

export async function GET() {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getDb();
    const todayStr = getKolkataToday();
    const formattedDate = formatKolkataFullDate(todayStr);
    const greeting = getKolkataGreeting();

    const settings = await loadAttendanceSettings(db);

    const rawActiveStudents = await db
      .collection("students")
      .find({ status: "Active" })
      .toArray();

    const activeStudents = rawActiveStudents.map((st: any) => {
      const effectiveBatch = getEffectiveBatch(
        st,
        settings.batch1Classes,
        settings.batch2Classes
      );
      return {
        ...st,
        class: formatClassDisplay(st.class),
        batch: effectiveBatch === "Unassigned" ? "" : effectiveBatch,
      };
    });

    const batch57Students = activeStudents.filter((s: any) => s.batch === "5-7");
    const batch79Students = activeStudents.filter((s: any) => s.batch === "7-9");

    const holidays = await db
      .collection("attendance")
      .find({ docType: "holiday", date: { $lte: todayStr } })
      .toArray();
    const holidayDateSet = new Set(holidays.map((h: any) => h.date));
    const todaysHolidays = holidays.filter((h: any) => h.date === todayStr);

    const holiday57 = todaysHolidays.find(
      (h: any) => h.batch === "ALL" || h.batch === "5-7"
    );
    const holiday79 = todaysHolidays.find(
      (h: any) => h.batch === "ALL" || h.batch === "7-9"
    );
    const isHoliday57 = Boolean(holiday57);
    const isHoliday79 = Boolean(holiday79);

    const todaysAttendance = await db
      .collection("attendance")
      .find({ docType: "attendance", date: todayStr })
      .toArray();

    const records57 = todaysAttendance.filter((r: any) => r.batch === "5-7");
    const records79 = todaysAttendance.filter((r: any) => r.batch === "7-9");

    const p57 = records57.filter((r: any) => r.status === "present").length;
    const a57 = records57.filter((r: any) => r.status === "absent").length;
    const pct57 = records57.length > 0 ? Math.round((p57 / records57.length) * 100) : 0;

    const stats57: BatchStats = {
      batch: "5-7",
      batchName: settings.batch1Name,
      batchTiming: settings.batch1Timing,
      assignedClasses: settings.batch1Classes,
      totalStudents: batch57Students.length,
      present: p57,
      absent: a57,
      attendancePercentage: pct57,
      status: records57.length > 0 ? "Completed" : "Pending",
      isHoliday: isHoliday57,
      holidayReason: holiday57?.reason,
    };

    const p79 = records79.filter((r: any) => r.status === "present").length;
    const a79 = records79.filter((r: any) => r.status === "absent").length;
    const pct79 = records79.length > 0 ? Math.round((p79 / records79.length) * 100) : 0;

    const stats79: BatchStats = {
      batch: "7-9",
      batchName: settings.batch2Name,
      batchTiming: settings.batch2Timing,
      assignedClasses: settings.batch2Classes,
      totalStudents: batch79Students.length,
      present: p79,
      absent: a79,
      attendancePercentage: pct79,
      status: records79.length > 0 ? "Completed" : "Pending",
      isHoliday: isHoliday79,
      holidayReason: holiday79?.reason,
    };

    const absentStudentIds = todaysAttendance
      .filter((r: any) => r.status === "absent")
      .map((r: any) => r.studentId);

    const allStudentsMap = new Map<string, any>(
      activeStudents.map((s: any) => [s.studentId, s])
    );

    const rawPastAttendance = await db
      .collection("attendance")
      .find({ docType: "attendance", date: { $lte: todayStr } })
      .sort({ date: -1 })
      .toArray();
    const allPastAttendance = rawPastAttendance.filter(
      (rec: any) => !holidayDateSet.has(rec.date)
    );

    const studentPastRecordsMap = new Map<string, any[]>();
    for (const rec of allPastAttendance) {
      if (!studentPastRecordsMap.has(rec.studentId)) {
        studentPastRecordsMap.set(rec.studentId, []);
      }
      studentPastRecordsMap.get(rec.studentId)!.push(rec);
    }

    const todaysAbsentees: AbsenteeInfo[] = [];

    for (const studentId of absentStudentIds) {
      const student = allStudentsMap.get(studentId);
      if (!student) continue;

      const contactMobile = getContactMobile(student);

      let consecutive = 0;
      const past = studentPastRecordsMap.get(studentId) || [];
      for (const rec of past) {
        if (rec.status === "absent") consecutive++;
        else break;
      }

      todaysAbsentees.push({
        studentId: student.studentId,
        name: student.name,
        class: student.class,
        batch: student.batch || "5-7",
        parentName: student.parentName,
        parentMobile: student.parentMobile,
        alternateMobile: student.alternateMobile,
        contactMobile,
        telLink: generateTelLink(contactMobile),
        consecutiveAbsences: consecutive,
      });
    }

    const consecutiveAbsenceAlerts: any[] = [];
    const lowAttendanceAlerts: any[] = [];

    for (const student of activeStudents) {
      const past = studentPastRecordsMap.get(student.studentId) || [];
      if (past.length === 0) continue;

      let cons = 0;
      for (const rec of past) {
        if (rec.status === "absent") cons++;
        else break;
      }

      if (cons >= settings.consecutiveAbsenceThreshold) {
        const contactMobile = getContactMobile(student);
        consecutiveAbsenceAlerts.push({
          student,
          consecutiveAbsences: cons,
          contactMobile,
          telLink: generateTelLink(contactMobile),
        });
      }

      const totalCond = past.length;
      const presCount = past.filter((r) => r.status === "present").length;
      const pct = totalCond > 0 ? Math.round((presCount / totalCond) * 100) : 100;

      if (totalCond >= 3 && pct < settings.attendanceThreshold) {
        const contactMobile = getContactMobile(student);
        lowAttendanceAlerts.push({
          student,
          percentage: pct,
          totalConducted: totalCond,
          presentCount: presCount,
          contactMobile,
          telLink: generateTelLink(contactMobile),
        });
      }
    }

    return NextResponse.json({
      todayStr,
      formattedDate,
      greeting,
      teacherName: settings.teacherName,
      stats57,
      stats79,
      todaysAbsentees,
      consecutiveAbsenceAlerts,
      lowAttendanceAlerts,
      totalActiveStudents: activeStudents.length,
    });
  } catch (error: any) {
    console.error("GET attendance dashboard error:", error);
    return NextResponse.json({ error: "Failed to load dashboard data" }, { status: 500 });
  }
}
