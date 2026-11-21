import type { Student, Payment, DynamicDueResult, PendingMonthDetail, DueStatus } from "@/types";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export function getMonthName(month: number): string {
  return MONTH_NAMES[month - 1] || "";
}

interface FeeCycle {
  year: number;
  month: number;
  dueYear: number;
  dueMonth: number;
  dueDay: number;
  dueDate: Date;
  dueDateString: string;
}

/**
 * Resolves the fee period and due date for a cycle offset from admission.
 * This is the single source of truth for admission-based fee scheduling:
 * cycle k is the tuition month k months after admission, and its due date is
 * the same admission day in the following calendar month.
 */
function resolveFeeCycle(
  admissionYear: number,
  admissionMonth: number,
  admissionDay: number,
  k: number
): FeeCycle {
  let month = admissionMonth + k;
  let year = admissionYear;
  while (month > 12) {
    month -= 12;
    year += 1;
  }

  let dueYear = admissionYear;
  let dueMonth = admissionMonth + (k + 1);
  while (dueMonth > 12) {
    dueMonth -= 12;
    dueYear += 1;
  }

  const maxDaysInDueMonth = new Date(dueYear, dueMonth, 0).getDate();
  const dueDay = Math.min(admissionDay, maxDaysInDueMonth);
  const dueDate = new Date(dueYear, dueMonth - 1, dueDay);

  return {
    year,
    month,
    dueYear,
    dueMonth,
    dueDay,
    dueDate,
    dueDateString: `${dueYear}-${String(dueMonth).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`,
  };
}

/**
 * Returns the existing admission-based due date for a specific tuition month.
 * A July fee always stays July even when its due date falls in August.
 */
export function getFeeMonthDueDate(
  admissionDate: string,
  feeYear: number,
  feeMonth: number
): string | null {
  if (
    !Number.isInteger(feeYear) ||
    !Number.isInteger(feeMonth) ||
    feeMonth < 1 ||
    feeMonth > 12
  ) {
    return null;
  }

  const admission = new Date(admissionDate);
  if (Number.isNaN(admission.getTime())) return null;

  const admissionYear = admission.getFullYear();
  const admissionMonth = admission.getMonth() + 1;
  const admissionDay = admission.getDate();

  const k = (feeYear - admissionYear) * 12 + (feeMonth - admissionMonth);
  if (k < 0) return null;

  const cycle = resolveFeeCycle(
    admissionYear,
    admissionMonth,
    admissionDay,
    k
  );

  if (cycle.year !== feeYear || cycle.month !== feeMonth) return null;
  return cycle.dueDateString;
}

/**
 * Calculates dynamic fee due status for a student given their payments.
 * 
 * Logic:
 * - When a student takes admission on a date (e.g., 27-07-2026):
 * - The 1st tuition month is July 2026 (Month 7).
 * - The fee for July 2026 becomes DUE 1 month later on 27-08-2026.
 * - Before 27-08-2026, July 2026 is NOT due yet.
 * - On/After 27-08-2026, July 2026 is Due/Overdue until paid.
 * - The 2nd tuition month (August 2026) becomes DUE on 27-09-2026, and so on.
 */
export function calculateStudentDueStatus(
  student: Student,
  payments: Payment[],
  currentDateObj: Date = new Date()
): DynamicDueResult {
  if (!student.admissionDate) {
    return {
      status: "PAID",
      totalDueMonths: 0,
      totalPendingAmount: 0,
      pendingMonths: [],
      paidMonthsCount: 0,
    };
  }

  const admission = new Date(student.admissionDate);
  const admissionYear = admission.getFullYear();
  const admissionMonth = admission.getMonth() + 1; // 1-indexed (1-12)
  const admissionDay = admission.getDate();

  // Reset time portions for exact date comparison
  const curDate = new Date(currentDateObj.getFullYear(), currentDateObj.getMonth(), currentDateObj.getDate());

  // Create a set of paid year-months
  const paidSet = new Set<string>();
  payments.forEach((p) => {
    paidSet.add(`${p.year}-${p.month}`);
  });

  const pendingMonths: PendingMonthDetail[] = [];
  let paidMonthsCount = 0;

  // Iterate tuition cycles starting from admission month (k = 0)
  let k = 0;
  while (true) {
    // Determine tuition month and its due date for cycle index k
    const cycle = resolveFeeCycle(
      admissionYear,
      admissionMonth,
      admissionDay,
      k
    );
    const m = cycle.month;
    const y = cycle.year;
    const dueDate = cycle.dueDate;

    // If due date for this tuition month is in the future beyond today, stop checking
    if (dueDate > curDate) {
      break;
    }

    const key = `${y}-${m}`;
    const isPaid = paidSet.has(key);

    if (isPaid) {
      paidMonthsCount++;
    } else {
      // Due date has arrived or passed and fee for month (m, y) is unpaid
      const isDueToday =
        curDate.getFullYear() === dueDate.getFullYear() &&
        curDate.getMonth() === dueDate.getMonth() &&
        curDate.getDate() === dueDate.getDate();
      const isOverdue = curDate > dueDate;

      const monthName = getMonthName(m);

      pendingMonths.push({
        month: m,
        year: y,
        monthName: `${monthName} ${y}`,
        dueDate: cycle.dueDateString,
        amount: student.monthlyFee,
        isDueToday,
        isOverdue,
      });
    }

    k++;
  }

  // Status determination
  let status: DueStatus = "PAID";
  if (pendingMonths.length > 0) {
    const hasOverdue = pendingMonths.some((p) => p.isOverdue);
    if (hasOverdue) {
      status = "OVERDUE";
    } else {
      status = "DUE_TODAY";
    }
  }

  const totalPendingAmount = pendingMonths.length * student.monthlyFee;

  return {
    status,
    totalDueMonths: pendingMonths.length,
    totalPendingAmount,
    pendingMonths,
    paidMonthsCount,
  };
}
