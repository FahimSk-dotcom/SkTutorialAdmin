import type { StudentArchiveState } from "./student-archive";

export interface PaymentRuleStudent extends StudentArchiveState {
  monthlyFee: number;
  admissionDate: string;
}

export interface NewPaymentRuleInput {
  student: PaymentRuleStudent;
  month: number;
  year: number;
  amount: number;
  currentDate?: Date;
}

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

export function validateNewPayment(input: NewPaymentRuleInput): string | null {
  const { student, month, year, amount } = input;

  if (student.status !== "Active") {
    return "Archived students cannot receive new payments.";
  }

  if (!Number.isFinite(amount) || amount !== student.monthlyFee) {
    return "Payment amount must equal the student's monthly fee. Partial and advance payments are not supported.";
  }

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return "Payment month is invalid.";
  }

  const currentDate = input.currentDate ?? new Date();
  const paymentMonthIndex = monthIndex(year, month);
  const currentMonthIndex = monthIndex(currentDate.getFullYear(), currentDate.getMonth() + 1);

  if (paymentMonthIndex > currentMonthIndex) {
    return "Advance payments are not supported.";
  }

  const admissionDate = new Date(student.admissionDate);
  if (Number.isNaN(admissionDate.getTime())) {
    return "Student admission date is invalid.";
  }

  const admissionMonthIndex = monthIndex(
    admissionDate.getFullYear(),
    admissionDate.getMonth() + 1
  );

  if (paymentMonthIndex < admissionMonthIndex) {
    return "Payment month cannot be before the student's admission month.";
  }

  return null;
}
