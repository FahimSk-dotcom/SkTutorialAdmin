import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildMonthlyFeeOverview,
  formatFeeMonth,
  kolkataDateToCalendarDate,
  parseFeeMonth,
  resolveFeePaymentPeriod,
} from "../src/lib/parent-fees.ts";
import {
  calculateStudentDueStatus,
  getFeeMonthDueDate,
} from "../src/lib/due-calculator.ts";

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const student = {
  studentId: "SK-1001",
  name: "Student Name",
  class: "Class 9",
  monthlyFee: 750,
  admissionDate: "2026-07-01",
  status: "Active",
};

const today = (value) => kolkataDateToCalendarDate(value);

test("July fee remains July with an 1 August due date", () => {
  assert.equal(getFeeMonthDueDate("2026-07-01", 2026, 7), "2026-08-01");
  assert.equal(getFeeMonthDueDate("2026-07-01", 2026, 8), "2026-09-01");
  assert.equal(getFeeMonthDueDate("2026-07-01", 2026, 9), "2026-10-01");
  assert.equal(
    getFeeMonthDueDate("2026-07-27", 2026, 7),
    "2026-08-27"
  );
  assert.equal(getFeeMonthDueDate("2026-07-01", 2026, 6), null);
});

test("existing due calculator output and due dates are unchanged", () => {
  const due = calculateStudentDueStatus(
    { ...student, admissionDate: "2026-01-10", monthlyFee: 1500 },
    [],
    new Date(2026, 2, 15)
  );

  assert.equal(due.status, "OVERDUE");
  assert.equal(due.totalDueMonths, 2);
  assert.equal(due.totalPendingAmount, 3000);
  assert.deepEqual(
    due.pendingMonths.map((month) => [month.month, month.dueDate]),
    [
      [1, "2026-02-10"],
      [2, "2026-03-10"],
    ]
  );
});

test("upcoming unpaid July fee is exposed before its due date", () => {
  const result = buildMonthlyFeeOverview({
    student,
    payments: [],
    year: 2026,
    today: today("2026-07-25"),
  });

  assert.deepEqual(result.student, {
    studentId: "SK-1001",
    name: "Student Name",
    class: "Class 9",
    admissionDate: "2026-07-01",
  });
  assert.deepEqual(result.summary, {
    monthlyFee: 750,
    totalPaid: 0,
    totalPending: 0,
    paidMonths: 0,
    pendingMonths: 0,
  });
  assert.deepEqual(result.months, [
    {
      month: "2026-07",
      amount: 750,
      status: "Pending",
      dueDate: "2026-08-01",
      paidDate: null,
      receiptNo: null,
      isPaymentEligible: true,
    },
  ]);
});

test("upcoming payment eligibility follows the existing payment rules", () => {
  const upcoming = resolveFeePaymentPeriod({
    student,
    year: 2026,
    month: 7,
    today: today("2026-07-25"),
  });

  assert.deepEqual(upcoming, {
    ok: true,
    period: {
      year: 2026,
      month: 7,
      dueDate: "2026-08-01",
      amount: 750,
    },
  });

  const beforeAdmission = resolveFeePaymentPeriod({
    student,
    year: 2026,
    month: 6,
    today: today("2026-07-25"),
  });
  assert.equal(beforeAdmission.ok, false);
  assert.match(beforeAdmission.reason, /before the student's admission month/);

  const futureMonth = resolveFeePaymentPeriod({
    student,
    year: 2026,
    month: 8,
    today: today("2026-07-25"),
  });
  assert.equal(futureMonth.ok, false);
  assert.match(futureMonth.reason, /Advance payments/);

  const inactive = resolveFeePaymentPeriod({
    student: { ...student, status: "Inactive" },
    year: 2026,
    month: 7,
    today: today("2026-07-25"),
  });
  assert.equal(inactive.ok, false);
  assert.match(inactive.reason, /Archived students/);

  const unsupportedAmount = resolveFeePaymentPeriod({
    student: { ...student, monthlyFee: 750.555 },
    year: 2026,
    month: 7,
    today: today("2026-07-25"),
  });
  assert.equal(unsupportedAmount.ok, false);
  assert.match(unsupportedAmount.reason, /Monthly fee amount is invalid/);
});

test("overdue and upcoming months can both be eligible without changing pending summary", () => {
  const result = buildMonthlyFeeOverview({
    student,
    payments: [
      {
        studentId: "SK-1001",
        receiptNo: "REC-202607-1001",
        paymentDate: "2026-07-10",
        month: 7,
        year: 2026,
        amount: 750,
        mode: "Cash",
      },
    ],
    year: 2026,
    today: today("2026-09-15"),
  });

  assert.deepEqual(result.summary, {
    monthlyFee: 750,
    totalPaid: 750,
    totalPending: 750,
    paidMonths: 1,
    pendingMonths: 1,
  });
  assert.deepEqual(
    result.months.map((month) => [
      month.month,
      month.status,
      month.dueDate,
      month.isPaymentEligible,
    ]),
    [
      ["2026-07", "Paid", "2026-08-01", false],
      ["2026-08", "Pending", "2026-09-01", true],
      ["2026-09", "Pending", "2026-10-01", true],
    ]
  );
});

test("inactive students never receive eligible upcoming fees", () => {
  const result = buildMonthlyFeeOverview({
    student: { ...student, status: "Inactive" },
    payments: [],
    year: 2026,
    today: today("2026-07-25"),
  });

  assert.deepEqual(result.months, []);
  assert.equal(result.summary.pendingMonths, 0);
});

test("fee month parsing rejects invalid formats and ranges", () => {
  assert.deepEqual(parseFeeMonth("2026-07"), { year: 2026, month: 7 });
  for (const value of ["2026-7", "2026-13", "1999-12", "2101-01", "", null, 202607]) {
    assert.equal(parseFeeMonth(value), null, `${value} should be invalid`);
  }
  assert.equal(formatFeeMonth(2026, 7), "2026-07");
});

test("obsolete VPA payment generation configuration is removed", () => {
  const proxy = readSource("../src/proxy.ts");
  const envExample = readSource("../.env.example");
  const env = readSource("../src/lib/env.ts");

  assert.ok(!proxy.includes("/api/parent/fees/payment-intent"));
  assert.doesNotMatch(envExample, /SK_TUTORIALS_UPI_VPA/);
  assert.doesNotMatch(envExample, /SK_TUTORIALS_UPI_PAYEE_NAME/);
  assert.doesNotMatch(env, /SK_TUTORIALS_UPI_VPA/);
  assert.doesNotMatch(env, /SK_TUTORIALS_UPI_PAYEE_NAME/);
});

test("existing admin payment and receipt flows are untouched", () => {
  const paymentsSource = readSource("../src/app/api/payments/route.ts");
  const receiptSource = readSource(
    "../src/app/api/parent/receipt/[receiptNo]/route.ts"
  );

  assert.match(paymentsSource, /validateNewPayment/);
  assert.match(paymentsSource, /nextReceiptNo/);
  assert.match(paymentsSource, /insertOne/);
  assert.match(receiptSource, /buildReceiptPdf/);
});
