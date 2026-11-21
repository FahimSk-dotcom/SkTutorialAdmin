import test from "node:test";
import assert from "node:assert/strict";
import {
  getMonthName,
  calculateStudentDueStatus,
} from "../src/lib/due-calculator.ts";

const student = {
  studentId: "SK-1001",
  name: "Test Student",
  class: "Class 6",
  monthlyFee: 1500,
  parentName: "Parent",
  parentMobile: "9876543210",
  admissionDate: "2026-01-10",
  status: "Active",
};

test("returns month names and blanks invalid months", () => {
  assert.equal(getMonthName(1), "January");
  assert.equal(getMonthName(12), "December");
  assert.equal(getMonthName(13), "");
});

test("returns paid when admission date is missing", () => {
  const result = calculateStudentDueStatus(
    { ...student, admissionDate: "" },
    [],
    new Date(2026, 5, 15)
  );

  assert.equal(result.status, "PAID");
  assert.equal(result.totalPendingAmount, 0);
});

test("does not mark the admission month due before one month has passed", () => {
  const result = calculateStudentDueStatus(student, [], new Date(2026, 0, 20));

  assert.equal(result.status, "PAID");
  assert.equal(result.totalDueMonths, 0);
});

test("marks arrived unpaid months as overdue", () => {
  const result = calculateStudentDueStatus(student, [], new Date(2026, 2, 15));

  assert.equal(result.status, "OVERDUE");
  assert.equal(result.totalDueMonths, 2);
  assert.equal(result.totalPendingAmount, 3000);
  assert.deepEqual(
    result.pendingMonths.map((m) => `${m.year}-${m.month}`),
    ["2026-1", "2026-2"]
  );
});

test("counts paid months and excludes them from pending dues", () => {
  const result = calculateStudentDueStatus(
    student,
    [
      {
        studentId: student.studentId,
        paymentDate: "2026-02-10",
        month: 1,
        year: 2026,
        amount: 1500,
        mode: "Cash",
      },
    ],
    new Date(2026, 2, 15)
  );

  assert.equal(result.status, "OVERDUE");
  assert.equal(result.totalDueMonths, 1);
  assert.equal(result.paidMonthsCount, 1);
  assert.equal(result.pendingMonths[0].month, 2);
});
