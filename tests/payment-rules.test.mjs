import test from "node:test";
import assert from "node:assert/strict";
import { validateNewPayment } from "../src/lib/payment-rules.ts";

const currentDate = new Date(2026, 5, 15);
const activeStudent = {
  status: "Active",
  monthlyFee: 1500,
  admissionDate: "2026-01-10",
};

test("accepts an exact monthly fee for the current month", () => {
  assert.equal(
    validateNewPayment({
      student: activeStudent,
      month: 6,
      year: 2026,
      amount: 1500,
      currentDate,
    }),
    null
  );
});

test("accepts a due month from before the current month", () => {
  assert.equal(
    validateNewPayment({
      student: activeStudent,
      month: 3,
      year: 2026,
      amount: 1500,
      currentDate,
    }),
    null
  );
});

test("rejects archived students", () => {
  assert.match(
    validateNewPayment({
      student: { ...activeStudent, status: "Inactive" },
      month: 6,
      year: 2026,
      amount: 1500,
      currentDate,
    }),
    /Archived students/
  );
});

test("rejects partial and overpayments", () => {
  for (const amount of [500, 1000, 1501]) {
    assert.match(
      validateNewPayment({
        student: activeStudent,
        month: 6,
        year: 2026,
        amount,
        currentDate,
      }),
      /must equal the student's monthly fee/
    );
  }
});

test("rejects future-month advance payments", () => {
  assert.match(
    validateNewPayment({
      student: activeStudent,
      month: 7,
      year: 2026,
      amount: 1500,
      currentDate,
    }),
    /Advance payments/
  );
});

test("rejects payments before the admission month", () => {
  assert.match(
    validateNewPayment({
      student: activeStudent,
      month: 12,
      year: 2025,
      amount: 1500,
      currentDate,
    }),
    /before the student's admission month/
  );
});

test("rejects invalid months and invalid admission dates", () => {
  assert.match(
    validateNewPayment({
      student: activeStudent,
      month: 13,
      year: 2026,
      amount: 1500,
      currentDate,
    }),
    /month is invalid/
  );

  assert.match(
    validateNewPayment({
      student: { ...activeStudent, admissionDate: "not-a-date" },
      month: 6,
      year: 2026,
      amount: 1500,
      currentDate,
    }),
    /admission date is invalid/
  );
});
