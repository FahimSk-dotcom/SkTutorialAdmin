import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAttendanceUpsertOps,
  buildAttendanceUpdateOp,
  computeAttendanceSummary,
  computeConsecutiveCounts,
  filterValidAttendance,
} from "../src/lib/attendance.ts";
import {
  formatClassDisplay,
  getClassSortRank,
  getEffectiveBatch,
  isClassInList,
  normalizeClass,
} from "../src/lib/class-utils.ts";
import { getContactMobile, generateTelLink } from "../src/lib/phone.ts";
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  hasAttendanceSettings,
  pickAttendanceSettings,
} from "../src/lib/app-settings.ts";
import {
  attendanceSubmitSchema,
  holidaySchema,
  singleAttendanceUpdateSchema,
  unifiedSettingsUpdateSchema,
} from "../src/schemas/index.ts";

test("attendance upsert creates records scoped to attendance docType", () => {
  const now = "2026-11-10T10:00:00.000Z";
  const ops = buildAttendanceUpsertOps(
    "2026-11-10",
    "5-7",
    [
      { studentId: "SK-1001", status: "present" },
      { studentId: "SK-1002", status: "absent" },
    ],
    now
  );

  assert.equal(ops.length, 2);
  assert.deepEqual(ops[0].updateOne.filter, {
    docType: "attendance",
    date: "2026-11-10",
    batch: "5-7",
    studentId: "SK-1001",
  });
  assert.equal(ops[0].updateOne.upsert, true);
  assert.equal(ops[0].updateOne.update.$set.status, "present");
  assert.equal(ops[0].updateOne.update.$setOnInsert.markedAt, now);
  assert.equal(ops[1].updateOne.update.$set.status, "absent");
});

test("single attendance update is an upsert for the same date, batch and student", () => {
  const now = "2026-11-10T10:00:00.000Z";
  const op = buildAttendanceUpdateOp("2026-11-10", "7-9", "SK-1003", "absent", now);

  assert.deepEqual(op.filter, {
    docType: "attendance",
    date: "2026-11-10",
    batch: "7-9",
    studentId: "SK-1003",
  });
  assert.equal(op.update.$set.status, "absent");
  assert.equal(op.update.$setOnInsert.markedAt, now);
  assert.deepEqual(op.options, { upsert: true });
});

test("attendance summary excludes holidays and future dates", () => {
  const records = [
    { date: "2026-11-10", status: "present" },
    { date: "2026-11-09", status: "absent" },
    { date: "2026-11-08", status: "absent" },
    { date: "2026-11-07", status: "present" },
    { date: "2026-11-05", status: "present" },
    { date: "2026-11-11", status: "present" },
  ];

  const summary = computeAttendanceSummary(
    records,
    ["2026-11-05"],
    "2026-11-10"
  );

  assert.equal(summary.totalConducted, 4);
  assert.equal(summary.presentCount, 2);
  assert.equal(summary.absentCount, 2);
  assert.equal(summary.percentage, 50);
  assert.equal(summary.currentMonthConducted, 4);
  assert.equal(summary.consecutiveAbsences, 0);
  assert.equal(summary.consecutivePresence, 1);
});

test("consecutive absence and presence counters stop at the first different status", () => {
  assert.deepEqual(
    computeConsecutiveCounts([
      { date: "2026-11-10", status: "absent" },
      { date: "2026-11-09", status: "absent" },
      { date: "2026-11-08", status: "present" },
    ]),
    { consecutiveAbsences: 2, consecutivePresence: 0 }
  );

  assert.deepEqual(
    computeConsecutiveCounts([
      { date: "2026-11-10", status: "present" },
      { date: "2026-11-09", status: "present" },
      { date: "2026-11-08", status: "absent" },
    ]),
    { consecutiveAbsences: 0, consecutivePresence: 2 }
  );
});

test("valid attendance is sorted newest first", () => {
  const valid = filterValidAttendance(
    [
      { date: "2026-11-08", status: "present" },
      { date: "2026-11-10", status: "absent" },
      { date: "2026-11-09", status: "present" },
    ],
    [],
    "2026-11-10"
  );

  assert.deepEqual(
    valid.map((rec) => rec.date),
    ["2026-11-10", "2026-11-09", "2026-11-08"]
  );
});

test("student class mapping resolves effective batch", () => {
  assert.equal(getEffectiveBatch({ batch: "7-9", class: "Class 3" }, ["Class 3"], []), "7-9");
  assert.equal(getEffectiveBatch({ class: "Class 3" }, ["Class 3"], ["Class 9"]), "5-7");
  assert.equal(getEffectiveBatch({ class: "Class 9" }, ["Class 3"], ["Class 9"]), "7-9");
  assert.equal(getEffectiveBatch({ class: "Class 11" }, ["Class 3"], ["Class 9"]), "Unassigned");
});

test("class display and matching normalizes existing prefixes", () => {
  assert.equal(normalizeClass("Class 6"), "6");
  assert.equal(formatClassDisplay("6"), "Class 6");
  assert.equal(formatClassDisplay("Class 6"), "Class 6");
  assert.equal(isClassInList("Class 6", ["6"]), true);
  assert.ok(getClassSortRank("Jr.Kg") < getClassSortRank("Class 10"));
});

test("phone helpers fall back to alternate mobile and build tel links", () => {
  assert.equal(
    getContactMobile({ parentMobile: "9876543210", alternateMobile: "9123456780" }),
    "9876543210"
  );
  assert.equal(
    getContactMobile({ parentMobile: "", alternateMobile: "9123456780" }),
    "9123456780"
  );
  assert.equal(generateTelLink("9876543210"), "tel:+919876543210");
  assert.equal(generateTelLink("+91 98765 43210"), "tel:+919876543210");
});

test("attendance settings fall back to defaults and legacy fields", () => {
  assert.equal(hasAttendanceSettings(null), false);
  assert.equal(hasAttendanceSettings({ instituteName: "SK Tutorials" }), false);
  assert.equal(hasAttendanceSettings({ teacherName: "Teacher" }), true);

  const picked = pickAttendanceSettings({ teacherName: "Teacher" });
  assert.equal(picked.teacherName, "Teacher");
  assert.deepEqual(picked.batch1Classes, DEFAULT_ATTENDANCE_SETTINGS.batch1Classes);
  assert.equal(picked.attendanceThreshold, DEFAULT_ATTENDANCE_SETTINGS.attendanceThreshold);
});

test("attendance schemas accept valid payloads and reject invalid ones", () => {
  assert.equal(
    attendanceSubmitSchema.safeParse({
      date: "2026-11-10",
      batch: "5-7",
      records: [{ studentId: "SK-1001", status: "present" }],
    }).success,
    true
  );
  assert.equal(
    attendanceSubmitSchema.safeParse({
      date: "10-11-2026",
      batch: "5-7",
      records: [{ studentId: "SK-1001", status: "present" }],
    }).success,
    false
  );
  assert.equal(
    attendanceSubmitSchema.safeParse({
      date: "2026-11-10",
      batch: "5-7",
      records: [],
    }).success,
    false
  );
  assert.equal(
    singleAttendanceUpdateSchema.safeParse({
      date: "2026-11-10",
      batch: "7-9",
      studentId: "SK-1001",
      status: "absent",
    }).success,
    true
  );
  assert.equal(
    holidaySchema.safeParse({
      date: "2026-11-10",
      batch: "ALL",
      reason: "Holiday",
    }).success,
    true
  );
  assert.equal(
    holidaySchema.safeParse({
      date: "2026-11-10",
      batch: "ALL",
      reason: "Invalid",
    }).success,
    false
  );
  assert.equal(
    unifiedSettingsUpdateSchema.safeParse({ teacherName: "Teacher" }).success,
    true
  );
});
