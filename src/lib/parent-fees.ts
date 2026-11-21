import type { Payment, PendingMonthDetail, Student } from "@/types";
import {
  calculateStudentDueStatus,
  getFeeMonthDueDate,
} from "./due-calculator.ts";
import { validateNewPayment } from "./payment-rules.ts";

export const PARENT_RECEIPT_CONTENT_TYPE = "application/pdf";

export interface ParentFeeStudentSummary {
  studentId: string;
  name: string;
  class: string;
  admissionDate: string;
}

export interface ParentFeeMonth {
  month: string;
  amount: number;
  status: "Paid" | "Pending";
  dueDate: string | null;
  paidDate: string | null;
  receiptNo: string | null;
  isPaymentEligible: boolean;
}

export interface ParentFeeSummary {
  monthlyFee: number;
  totalPaid: number;
  totalPending: number;
  paidMonths: number;
  pendingMonths: number;
}

export interface ParentFeeOverview {
  student: ParentFeeStudentSummary;
  year: number;
  summary: ParentFeeSummary;
  months: ParentFeeMonth[];
}

export interface ParentPaymentHistoryItem {
  receiptNo: string;
  studentId: string;
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  month: string;
}

interface FeeStudentInput {
  studentId?: unknown;
  name?: unknown;
  class?: unknown;
  monthlyFee?: unknown;
  admissionDate?: unknown;
  status?: unknown;
}

interface FeePaymentInput {
  studentId?: unknown;
  receiptNo?: unknown;
  paymentDate?: unknown;
  month?: unknown;
  year?: unknown;
  amount?: unknown;
  mode?: unknown;
  createdAt?: unknown;
}

interface NormalizedPayment {
  month: number;
  year: number;
  amount: number;
  receiptNo: string;
  paymentDate: string;
  mode: string;
  createdAtTime: number;
}

function toSafeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toFiniteNumber(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function toCalendarMonth(value: unknown): number | null {
  const numeric = toFiniteNumber(value);
  if (numeric === null || !Number.isInteger(numeric)) return null;
  return numeric >= 1 && numeric <= 12 ? numeric : null;
}

function toCalendarYear(value: unknown): number | null {
  const numeric = toFiniteNumber(value);
  if (numeric === null || !Number.isInteger(numeric)) return null;
  return numeric >= 1900 && numeric <= 2200 ? numeric : null;
}

function getRecordTime(payment: FeePaymentInput): number {
  const created = payment.createdAt;
  if (created instanceof Date) return created.getTime();
  if (typeof created === "string" || typeof created === "number") {
    const parsed = new Date(created).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }

  const paymentDate = toSafeString(payment.paymentDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    const parsed = new Date(`${paymentDate}T00:00:00Z`).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }

  return 0;
}

function normalizePayment(
  payment: FeePaymentInput
): NormalizedPayment | null {
  const month = toCalendarMonth(payment.month);
  const year = toCalendarYear(payment.year);
  if (month === null || year === null) return null;

  return {
    month,
    year,
    amount: toFiniteNumber(payment.amount) ?? 0,
    receiptNo: toSafeString(payment.receiptNo),
    paymentDate: toSafeString(payment.paymentDate),
    mode: toSafeString(payment.mode),
    createdAtTime: getRecordTime(payment),
  };
}

export function isValidFeeYear(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}$/.test(value)) return false;
  const year = Number(value);
  return year >= 2000 && year <= 2100;
}

export function parseFeeMonth(
  value: unknown
): { year: number; month: number } | null {
  if (typeof value !== "string") return null;

  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match || !isValidFeeYear(match[1])) return null;

  const month = Number(match[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;

  return { year: Number(match[1]), month };
}

export interface FeePaymentPeriod {
  year: number;
  month: number;
  dueDate: string;
  amount: number;
}

export type FeePaymentPeriodResult =
  | { ok: true; period: FeePaymentPeriod }
  | { ok: false; reason: string };

/**
 * Resolves an unpaid fee period using the same admission-based schedule and
 * payment rules as the admin payment workflow. The fee period is the requested
 * month itself; only its due date moves into the following month.
 */
export function resolveFeePaymentPeriod(params: {
  student: FeeStudentInput;
  year: number;
  month: number;
  today: Date;
}): FeePaymentPeriodResult {
  const { student, year, month, today } = params;

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return { ok: false, reason: "Fee month is invalid." };
  }

  const monthlyFee = toFiniteNumber(student.monthlyFee);
  if (monthlyFee === null || monthlyFee <= 0) {
    return { ok: false, reason: "Monthly fee is not configured." };
  }

  const feeInPaise = monthlyFee * 100;
  if (Math.abs(feeInPaise - Math.round(feeInPaise)) > 1e-6) {
    return { ok: false, reason: "Monthly fee amount is invalid." };
  }

  const admissionDate = toSafeString(student.admissionDate);

  const ruleError = validateNewPayment({
    student: {
      status: toSafeString(student.status),
      monthlyFee,
      admissionDate,
    },
    month,
    year,
    amount: monthlyFee,
    currentDate: today,
  });

  if (ruleError) {
    return { ok: false, reason: ruleError };
  }

  if (!kolkataDateToCalendarDate(admissionDate)) {
    return { ok: false, reason: "Student fee schedule is invalid." };
  }

  const dueDate = getFeeMonthDueDate(admissionDate, year, month);
  if (!dueDate) {
    return { ok: false, reason: "Student fee schedule is invalid." };
  }

  return {
    ok: true,
    period: {
      year,
      month,
      dueDate,
      amount: monthlyFee,
    },
  };
}

export function formatFeeMonth(year: unknown, month: unknown): string {
  const y = toCalendarYear(year);
  const m = toCalendarMonth(month);
  if (y === null || m === null) return "";
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function isValidReceiptNo(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^REC-\d{6}-\d{1,10}$/.test(value) &&
    value.length <= 24
  );
}

export function buildReceiptContentDisposition(receiptNo: string): string {
  const safeReceiptNo = isValidReceiptNo(receiptNo)
    ? receiptNo
    : "receipt";
  return `inline; filename="Receipt_${safeReceiptNo}.pdf"`;
}

/**
 * Converts an Asia/Kolkata calendar date string into a local Date carrying the
 * same calendar components. `calculateStudentDueStatus` compares local calendar
 * fields, so this keeps fee due dates consistent regardless of server timezone.
 */
export function kolkataDateToCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function calculateOutstandingFees(
  student: FeeStudentInput,
  payments: Pick<Payment, "month" | "year">[],
  today: Date
) {
  const admissionDate = toSafeString(student.admissionDate);
  if (!kolkataDateToCalendarDate(admissionDate)) return [];
  return calculateStudentDueStatus(
    { admissionDate, monthlyFee: toFiniteNumber(student.monthlyFee) ?? 0 } as Student,
    payments as Payment[],
    today
  ).pendingMonths;
}

export function buildMonthlyFeeOverview(params: {
  student: FeeStudentInput;
  payments: FeePaymentInput[];
  year: number;
  today: Date;
}): ParentFeeOverview {
  const { student, payments, year, today } = params;
  const monthlyFee = toFiniteNumber(student.monthlyFee) ?? 0;

  const normalizedPayments = payments
    .map((source) => normalizePayment(source))
    .filter((payment): payment is NormalizedPayment => payment !== null);

  const paymentsByMonth = new Map<number, NormalizedPayment>();
  for (const payment of normalizedPayments) {
    if (payment.year !== year) continue;

    const existing = paymentsByMonth.get(payment.month);
    if (
      !existing ||
      payment.createdAtTime > existing.createdAtTime ||
      (payment.createdAtTime === existing.createdAtTime &&
        payment.paymentDate.localeCompare(existing.paymentDate) >= 0)
    ) {
      paymentsByMonth.set(payment.month, payment);
    }
  }

  const admissionDate = toSafeString(student.admissionDate);
  const pendingForYear: PendingMonthDetail[] = calculateOutstandingFees(student, normalizedPayments, today)
    .filter((pending) => pending.year === year)
    .sort((a, b) => a.month - b.month);

  const monthsByNumber = new Map<number, ParentFeeMonth>();
  for (const [month, payment] of paymentsByMonth) {
    monthsByNumber.set(month, {
      month: formatFeeMonth(payment.year, payment.month),
      amount: payment.amount,
      status: "Paid",
      dueDate: getFeeMonthDueDate(admissionDate, payment.year, payment.month),
      paidDate: payment.paymentDate || null,
      receiptNo: payment.receiptNo || null,
      isPaymentEligible: false,
    });
  }

  for (const pending of pendingForYear) {
    if (monthsByNumber.has(pending.month)) continue;

    const eligibility = resolveFeePaymentPeriod({
      student,
      year: pending.year,
      month: pending.month,
      today,
    });

    monthsByNumber.set(pending.month, {
      month: formatFeeMonth(pending.year, pending.month),
      amount: toFiniteNumber(pending.amount) ?? monthlyFee,
      status: "Pending",
      dueDate: pending.dueDate,
      paidDate: null,
      receiptNo: null,
      isPaymentEligible: eligibility.ok,
    });
  }

  // The existing due calculator stops at the next not-yet-due month. Expose
  // unpaid periods up to the current Kolkata month so the parent can pay an
  // upcoming fee before its due date. Payment rules still reject future months.
  for (let month = 1; month <= 12; month++) {
    if (monthsByNumber.has(month)) continue;

    const eligibility = resolveFeePaymentPeriod({
      student,
      year,
      month,
      today,
    });
    if (!eligibility.ok) continue;

    monthsByNumber.set(month, {
      month: formatFeeMonth(year, month),
      amount: eligibility.period.amount,
      status: "Pending",
      dueDate: eligibility.period.dueDate,
      paidDate: null,
      receiptNo: null,
      isPaymentEligible: true,
    });
  }

  const months = Array.from(monthsByNumber.entries())
    .sort(([a], [b]) => a - b)
    .map(([, month]) => month);

  const totalPaid = Array.from(paymentsByMonth.values()).reduce(
    (sum, payment) => sum + payment.amount,
    0
  );
  const totalPending = pendingForYear.reduce(
    (sum, pending) => sum + (toFiniteNumber(pending.amount) ?? monthlyFee),
    0
  );

  return {
    student: {
      studentId: toSafeString(student.studentId),
      name: toSafeString(student.name) || "Student",
      class: toSafeString(student.class),
      admissionDate: toSafeString(student.admissionDate),
    },
    year,
    summary: {
      monthlyFee,
      totalPaid,
      totalPending,
      paidMonths: paymentsByMonth.size,
      pendingMonths: pendingForYear.length,
    },
    months,
  };
}

export function buildPaymentHistory(
  payments: FeePaymentInput[]
): ParentPaymentHistoryItem[] {
  return payments
    .map((source) => {
      const payment = normalizePayment(source);
      if (!payment || !payment.receiptNo) return null;

      return {
        receiptNo: payment.receiptNo,
        studentId: toSafeString(source.studentId),
        amount: payment.amount,
        paymentDate: payment.paymentDate,
        paymentMethod: payment.mode,
        month: formatFeeMonth(payment.year, payment.month),
        createdAtTime: payment.createdAtTime,
      };
    })
    .filter(
      (
        item
      ): item is ParentPaymentHistoryItem & { createdAtTime: number } =>
        item !== null
    )
    .sort(
      (a, b) =>
        b.paymentDate.localeCompare(a.paymentDate) ||
        b.createdAtTime - a.createdAtTime ||
        b.receiptNo.localeCompare(a.receiptNo)
    )
    .map(
      ({
        receiptNo,
        studentId,
        amount,
        paymentDate,
        paymentMethod,
        month,
      }) => ({
        receiptNo,
        studentId,
        amount,
        paymentDate,
        paymentMethod,
        month,
      })
    );
}
