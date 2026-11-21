export type DueStatus = "PAID" | "DUE_TODAY" | "OVERDUE";

export interface Student {
  _id?: string;
  studentId: string; // Auto generated short code (e.g. SK-1001)
  name: string;
  class: string;
  batch?: string;
  effectiveBatch?: BatchType | "Unassigned";
  formattedClass?: string;
  monthlyFee: number;
  parentName: string;
  parentMobile: string;
  alternateMobile?: string;
  admissionDate: string; // YYYY-MM-DD or ISO string
  status: "Active" | "Inactive";
  archivedAt?: string;
  address?: string;
  remarks?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Payment {
  _id?: string;
  studentId: string;
  studentName?: string;
  class?: string;
  paymentDate: string; // YYYY-MM-DD
  month: number; // 1-12
  year: number; // e.g. 2026
  amount: number;
  mode: "Cash" | "UPI";
  receiptNo: string; // e.g. REC-202607-1001
  collectedBy: string;
  remarks?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Expense {
  _id?: string;
  name: string;
  category: string;
  amount: number;
  date: string; // YYYY-MM-DD
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Settings {
  _id?: string;
  instituteName: string;
  logoUrl?: string;
  upiId?: string;
  upiQrUrl?: string;
  receiptFooter?: string;
  updatedAt?: string;
}

export interface Admin {
  _id?: string;
  email: string;
  passwordHash: string;
  name: string;
  createdAt?: string;
}

export interface PendingMonthDetail {
  month: number; // 1-12
  year: number;
  monthName: string;
  dueDate: string; // YYYY-MM-DD
  amount: number;
  isDueToday: boolean;
  isOverdue: boolean;
}

export interface DynamicDueResult {
  status: DueStatus; // "PAID" | "DUE_TODAY" | "OVERDUE"
  totalDueMonths: number;
  totalPendingAmount: number;
  pendingMonths: PendingMonthDetail[];
  nextDueDate?: string;
  paidMonthsCount: number;
}

export interface SiblingGroupInfo {
  parentMobile: string;
  parentName: string;
  students: Student[];
  siblingCount: number;
  totalGroupPendingAmount: number;
}

export type BatchType = "5-7" | "7-9";
export type AttendanceStatus = "present" | "absent";

export const ALL_CLASSES = [
  "Jr.Kg",
  "Sr.Kg",
  "Class 1",
  "Class 2",
  "Class 3",
  "Class 4",
  "Class 5",
  "Class 6",
  "Class 7",
  "Class 8",
  "Class 9",
  "Class 10",
] as const;

export interface AttendanceRecord {
  _id?: string;
  docType: "attendance";
  date: string;
  batch: BatchType;
  studentId: string;
  status: AttendanceStatus;
  markedAt: string;
  updatedAt: string;
}

export interface HolidayDoc {
  _id?: string;
  docType: "holiday";
  date: string;
  batch?: "ALL" | BatchType;
  reason: "Holiday" | "Vacation" | "Personal" | "Other";
  description?: string;
  createdAt?: string;
}

export interface AttendanceSettingsConfig {
  teacherName: string;
  batch1Name: string;
  batch1Timing: string;
  batch1Classes: string[];
  batch2Name: string;
  batch2Timing: string;
  batch2Classes: string[];
  attendanceThreshold: number;
  consecutiveAbsenceThreshold: number;
}

export interface BatchStats {
  batch: BatchType;
  batchName: string;
  batchTiming: string;
  assignedClasses: string[];
  totalStudents: number;
  present: number;
  absent: number;
  attendancePercentage: number;
  status: "Completed" | "Pending";
  isHoliday?: boolean;
  holidayReason?: string;
}

export interface AbsenteeInfo {
  studentId: string;
  name: string;
  class: string;
  batch: BatchType;
  parentName: string;
  parentMobile: string;
  alternateMobile?: string;
  contactMobile: string;
  telLink: string;
  consecutiveAbsences: number;
}

export interface StudentAttendanceSummary {
  totalConducted: number;
  presentCount: number;
  absentCount: number;
  percentage: number;
  currentMonthConducted: number;
  currentMonthPresent: number;
  currentMonthAbsent: number;
  currentMonthPercentage: number;
  consecutiveAbsences: number;
  consecutivePresence: number;
}
