import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildStudentRelatedDeleteFilters,
  buildStudentDeleteMessage,
} from "../src/lib/student-delete.ts";

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("payments filter matches only the studentId", () => {
  const filters = buildStudentRelatedDeleteFilters("SK-001");

  assert.deepEqual(filters.payments, { studentId: "SK-001" });
  assert.deepEqual(Object.keys(filters.payments), ["studentId"]);
});

test("attendance filter is scoped to attendance documents only", () => {
  const filters = buildStudentRelatedDeleteFilters("SK-001");

  assert.deepEqual(filters.attendance, {
    docType: "attendance",
    studentId: "SK-001",
  });
  assert.deepEqual(
    Object.keys(filters.attendance).sort(),
    ["docType", "studentId"].sort()
  );
});

test("both related filters use the same studentId", () => {
  const filters = buildStudentRelatedDeleteFilters("SK-123");

  assert.equal(filters.payments.studentId, "SK-123");
  assert.equal(filters.attendance.studentId, "SK-123");
});

test("delete message reports the removed payment and attendance counts", () => {
  const message = buildStudentDeleteMessage("Ayaan Khan", {
    payments: 5,
    attendance: 12,
  });

  assert.equal(
    message,
    "Ayaan Khan permanently deleted along with 5 payment record(s) and 12 attendance record(s)."
  );
});

test("delete message handles a student with no related records", () => {
  const message = buildStudentDeleteMessage("New Student", {
    payments: 0,
    attendance: 0,
  });

  assert.match(message, /0 payment record\(s\)/);
  assert.match(message, /0 attendance record\(s\)/);
  assert.match(message, /permanently deleted/);
});

test("permanent delete route removes student, payments and attendance", () => {
  const source = readSource("../src/app/api/students/[id]/permanent/route.ts");

  assert.match(source, /buildStudentRelatedDeleteFilters/);
  assert.match(source, /collection\("students"\)\.deleteOne/);
  assert.match(source, /collection\("payments"\)\.deleteMany/);
  assert.match(source, /collection\("attendance"\)\.deleteMany/);
  assert.match(source, /withTransaction/);
});

test("permanent delete route never touches non-attendance attendance documents", () => {
  const source = readSource("../src/app/api/students/[id]/permanent/route.ts");

  assert.match(source, /buildStudentRelatedDeleteFilters/);
  assert.doesNotMatch(source, /collection\("attendance"\)\.deleteMany\(\s*\{\s*\}/);
});

test("archive route is preserved and does not hard delete students", () => {
  const source = readSource("../src/app/api/students/[id]/route.ts");

  assert.match(source, /buildStudentArchiveUpdate/);
  assert.doesNotMatch(source, /collection\("students"\)\.deleteOne/);
  assert.doesNotMatch(source, /collection\("payments"\)\.deleteMany/);
  assert.doesNotMatch(source, /collection\("attendance"\)\.deleteMany/);
});
