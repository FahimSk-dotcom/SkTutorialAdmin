import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ATTENDANCE_STATUS_DISPLAY,
  buildParentAttendanceResponse,
  getMonthDateRange,
  isStudentLinkedToParent,
  isValidDateString,
  isValidMonth,
  resolveMonthlyAttendance,
  toDisplayStatus,
} from "../src/lib/parent-attendance.ts";

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const routeSource = () =>
  readSource("../src/app/api/parent/attendance/route.ts");

test("valid YYYY-MM months are accepted", () => {
  assert.equal(isValidMonth("2026-11"), true);
  assert.equal(isValidMonth("2026-01"), true);
  assert.equal(isValidMonth("2024-02"), true);
  assert.equal(isValidMonth("9999-12"), true);
});

test("invalid months are rejected", () => {
  for (const month of [
    "2026-00",
    "2026-13",
    "2026-1",
    "26-11",
    "2026-11-01",
    "2026/11",
    "abcd-ef",
    "",
  ]) {
    assert.equal(isValidMonth(month), false, `${month} should be invalid`);
  }
});

test("month ranges use string boundaries without timezone shifts", () => {
  assert.deepEqual(getMonthDateRange("2026-11"), {
    start: "2026-11-01",
    endExclusive: "2026-12-01",
    lastDay: "2026-11-30",
  });
  assert.deepEqual(getMonthDateRange("2026-12"), {
    start: "2026-12-01",
    endExclusive: "2027-01-01",
    lastDay: "2026-12-31",
  });
  assert.deepEqual(getMonthDateRange("2024-02"), {
    start: "2024-02-01",
    endExclusive: "2024-03-01",
    lastDay: "2024-02-29",
  });
  assert.deepEqual(getMonthDateRange("2025-02"), {
    start: "2025-02-01",
    endExclusive: "2025-03-01",
    lastDay: "2025-02-28",
  });
  assert.equal(getMonthDateRange("2026-13"), null);
});

test("date strings are validated against the real calendar", () => {
  assert.equal(isValidDateString("2026-11-01"), true);
  assert.equal(isValidDateString("2024-02-29"), true);
  assert.equal(isValidDateString("2025-02-29"), false);
  assert.equal(isValidDateString("2026-11-31"), false);
  assert.equal(isValidDateString("2026-11-00"), false);
  assert.equal(isValidDateString("2026-11-1"), false);
  assert.equal(isValidDateString(20261101), false);
});

test("stored statuses map to parent display statuses", () => {
  assert.equal(toDisplayStatus("present"), "Present");
  assert.equal(toDisplayStatus("absent"), "Absent");
  assert.equal(toDisplayStatus("PRESENT"), "Present");
  assert.equal(toDisplayStatus(" Absent "), "Absent");
  assert.equal(ATTENDANCE_STATUS_DISPLAY.present, "Present");
  assert.equal(ATTENDANCE_STATUS_DISPLAY.absent, "Absent");
});

test("unknown statuses are passed through, not invented", () => {
  assert.equal(toDisplayStatus("late"), "late");
  assert.equal(toDisplayStatus(""), null);
  assert.equal(toDisplayStatus(null), null);
  assert.equal(toDisplayStatus(42), null);
});

test("month with attendance returns records and summary counts", () => {
  const result = resolveMonthlyAttendance(
    [
      { date: "2026-11-03", status: "absent" },
      { date: "2026-11-01", status: "present" },
      { date: "2026-11-02", status: "present" },
    ],
    "2026-11",
    "2026-11-14"
  );

  assert.deepEqual(result.records, [
    { date: "2026-11-01", status: "Present" },
    { date: "2026-11-02", status: "Present" },
    { date: "2026-11-03", status: "Absent" },
  ]);
  assert.deepEqual(result.summary, {
    present: 2,
    absent: 1,
    totalMarked: 3,
  });
});

test("month without attendance returns empty records and zero summary", () => {
  const result = resolveMonthlyAttendance([], "2026-11", "2026-11-14");
  assert.deepEqual(result.records, []);
  assert.deepEqual(result.summary, {
    present: 0,
    absent: 0,
    totalMarked: 0,
  });
});

test("future dates are never counted", () => {
  const result = resolveMonthlyAttendance(
    [
      { date: "2026-11-09", status: "present" },
      { date: "2026-11-10", status: "absent" },
      { date: "2026-11-11", status: "absent" },
      { date: "2026-11-30", status: "present" },
    ],
    "2026-11",
    "2026-11-10"
  );

  assert.deepEqual(
    result.records.map((record) => record.date),
    ["2026-11-09", "2026-11-10"]
  );
  assert.deepEqual(result.summary, {
    present: 1,
    absent: 1,
    totalMarked: 2,
  });
});

test("records outside the selected month are ignored", () => {
  const result = resolveMonthlyAttendance(
    [
      { date: "2026-10-31", status: "present" },
      { date: "2026-11-01", status: "absent" },
      { date: "2026-11-30", status: "present" },
      { date: "2026-12-01", status: "absent" },
    ],
    "2026-11",
    "2026-12-15"
  );

  assert.deepEqual(
    result.records.map((record) => record.date),
    ["2026-11-01", "2026-11-30"]
  );
  assert.equal(result.summary.totalMarked, 2);
});

test("duplicate records for one student and date are de-duplicated by latest update", () => {
  const result = resolveMonthlyAttendance(
    [
      {
        date: "2026-11-05",
        status: "present",
        updatedAt: "2026-11-05T10:00:00.000Z",
      },
      {
        date: "2026-11-05",
        status: "absent",
        updatedAt: "2026-11-05T12:00:00.000Z",
      },
    ],
    "2026-11",
    "2026-11-14"
  );

  assert.deepEqual(result.records, [{ date: "2026-11-05", status: "Absent" }]);
  assert.deepEqual(result.summary, {
    present: 0,
    absent: 1,
    totalMarked: 1,
  });
});

test("duplicate records fall back to markedAt when updatedAt is absent", () => {
  const result = resolveMonthlyAttendance(
    [
      {
        date: "2026-11-06",
        status: "absent",
        markedAt: "2026-11-06T09:00:00.000Z",
      },
      {
        date: "2026-11-06",
        status: "present",
        markedAt: "2026-11-06T11:00:00.000Z",
      },
    ],
    "2026-11",
    "2026-11-14"
  );

  assert.deepEqual(result.records, [{ date: "2026-11-06", status: "Present" }]);
  assert.equal(result.summary.present, 1);
  assert.equal(result.summary.totalMarked, 1);
});

test("unknown and invalid records do not corrupt counters", () => {
  const result = resolveMonthlyAttendance(
    [
      { date: "2026-11-01", status: "present" },
      { date: "2026-11-02", status: "late" },
      { date: "2026-11-03", status: "" },
      { date: "not-a-date", status: "present" },
    ],
    "2026-11",
    "2026-11-14"
  );

  assert.deepEqual(result.records, [
    { date: "2026-11-01", status: "Present" },
    { date: "2026-11-02", status: "late" },
  ]);
  assert.deepEqual(result.summary, {
    present: 1,
    absent: 0,
    totalMarked: 2,
  });
});

test("linked student authorization accepts only the parent's own students", () => {
  const linked = ["SK-1001", " SK-1002 ", "", null];

  assert.equal(isStudentLinkedToParent(linked, "SK-1001"), true);
  assert.equal(isStudentLinkedToParent(linked, "SK-1002"), true);
  assert.equal(isStudentLinkedToParent(linked, "SK-1003"), false);
  assert.equal(isStudentLinkedToParent(linked, "SK-9999"), false);
  assert.equal(isStudentLinkedToParent([], "SK-1001"), false);
  assert.equal(isStudentLinkedToParent(null, "SK-1001"), false);
  assert.equal(isStudentLinkedToParent("SK-1001", "SK-1001"), false);
});

test("multiple students under one parent are independently authorized", () => {
  const linked = ["SK-1001", "SK-1002", "SK-1003"];

  for (const studentId of linked) {
    assert.equal(isStudentLinkedToParent(linked, studentId), true);
  }
  assert.equal(isStudentLinkedToParent(linked, "SK-2001"), false);
});

test("response matches the agreed Android contract exactly", () => {
  const response = buildParentAttendanceResponse({
    student: { studentId: "SK-1001", name: "Student Name", class: "Class 9" },
    month: "2026-11",
    today: "2026-11-14",
    records: [
      { date: "2026-11-02", status: "absent" },
      { date: "2026-11-01", status: "present" },
    ],
  });

  assert.deepEqual(response, {
    success: true,
    student: {
      studentId: "SK-1001",
      name: "Student Name",
      class: "Class 9",
    },
    month: "2026-11",
    summary: { present: 1, absent: 1, totalMarked: 2 },
    records: [
      { date: "2026-11-01", status: "Present" },
      { date: "2026-11-02", status: "Absent" },
    ],
  });

  assert.deepEqual(Object.keys(response).sort(), [
    "month",
    "records",
    "student",
    "success",
    "summary",
  ]);
  assert.deepEqual(Object.keys(response.records[0]).sort(), ["date", "status"]);
});

test("route requires the existing parent bearer authentication", () => {
  const source = routeSource();
  assert.match(source, /getAuthenticatedParent/);
  assert.match(source, /auth\.status/);
  assert.doesNotMatch(source, /request\.json/);
  assert.doesNotMatch(source, /searchParams\.get\("parentId"\)/);
});

test("route enforces ownership and active-student access without leaking other parents' students", () => {
  const source = routeSource();
  assert.match(source, /verifyParentStudentAccess/);
  assert.match(source, /access\.failure\.body|access\.failure\.status/);
  assert.match(source, /access\.failure\.status/);
  assert.match(source, /requireActiveStudents/);
});

test("route validates studentId and month before querying", () => {
  const source = routeSource();
  assert.match(source, /studentId is required/);
  assert.match(source, /Invalid studentId/);
  assert.match(source, /month must be in YYYY-MM format/);
  assert.match(source, /STUDENT_ID_PATTERN/);
});

test("route queries only attendance docs by student and a date range", () => {
  const source = routeSource();
  assert.match(source, /docType: "attendance"/);
  assert.match(source, /studentId/);
  assert.match(source, /\$gte: range\.start/);
  assert.match(source, /\$lte: range\.lastDay/);
  assert.match(source, /getKolkataToday/);
  assert.match(source, /project\(|projection/);
  assert.doesNotMatch(source, /\$regex/);
});

test("route is read-only and never exposes sensitive parent data", () => {
  const source = routeSource();
  assert.doesNotMatch(source, /insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|bulkWrite/);
  assert.doesNotMatch(source, /passwordHash/);
  assert.doesNotMatch(source, /parentMobile/);
  assert.doesNotMatch(source, /linkedStudentIds:\s*1/);
});

test("route returns empty successful payloads through the shared builder", () => {
  const source = routeSource();
  assert.match(source, /buildParentAttendanceResponse/);
  assert.match(source, /parentJson/);
  assert.match(source, /export function OPTIONS/);
});

test("parent auth rejects inactive parents and parents with no active students using reason-coded responses", () => {
  const source = readSource("../src/lib/parent-auth.ts");
  assert.match(source, /PARENT_ACCOUNT_INACTIVE/);
  assert.match(source, /NO_ACTIVE_STUDENTS/);
  assert.match(source, /revokeAllParentSessions/);
  assert.match(source, /getActiveLinkedStudents/);
});

test("Next.js proxy lets the parent attendance endpoint reach handler auth", () => {
  const source = readSource("../src/proxy.ts");
  assert.ok(source.includes('pathname === "/api/parent/attendance"'));
  assert.match(source, /!isParentApiRoute/);
});
