export const ATTENDANCE_STATUS_DISPLAY: Record<string, string> = {
  present: "Present",
  absent: "Absent",
};

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface ParentAttendanceEntry {
  date: string;
  status: string;
}

export interface ParentAttendanceSummary {
  present: number;
  absent: number;
  totalMarked: number;
}

export interface ParentAttendanceResult {
  summary: ParentAttendanceSummary;
  records: ParentAttendanceEntry[];
}

export interface ParentAttendanceSourceRecord {
  date?: unknown;
  status?: unknown;
  updatedAt?: unknown;
  markedAt?: unknown;
}

export interface ParentAttendanceStudent {
  studentId?: unknown;
  name?: unknown;
  class?: unknown;
}

export interface ParentAttendanceResponse {
  success: true;
  student: {
    studentId: string;
    name: string;
    class: string;
  };
  month: string;
  summary: ParentAttendanceSummary;
  records: ParentAttendanceEntry[];
}

export interface MonthDateRange {
  start: string;
  endExclusive: string;
  lastDay: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function daysInMonth(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return days[month - 1];
}

/**
 * Validates a `YYYY-MM` value without constructing a Date. Building Dates from
 * bare date strings is timezone sensitive, so the attendance date range is
 * assembled from plain calendar parts instead.
 */
export function parseMonth(month: string): { year: number; month: number } | null {
  const match = MONTH_PATTERN.exec(month);
  if (!match) return null;

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);

  if (year < 1 || year > 9999) return null;
  if (monthNumber < 1 || monthNumber > 12) return null;

  return { year, month: monthNumber };
}

export function isValidMonth(month: string): boolean {
  return parseMonth(month) !== null;
}

/**
 * Returns a lexicographic date-string range for the selected month. Attendance
 * dates are stored as `YYYY-MM-DD` strings in the Asia/Kolkata calendar, so
 * string comparison preserves the same day boundaries without UTC shifts.
 */
export function getMonthDateRange(month: string): MonthDateRange | null {
  const parsed = parseMonth(month);
  if (!parsed) return null;

  const prefix = `${parsed.year}-${pad2(parsed.month)}`;
  const lastDayNumber = daysInMonth(parsed.year, parsed.month);

  const nextYear = parsed.month === 12 ? parsed.year + 1 : parsed.year;
  const nextMonth = parsed.month === 12 ? 1 : parsed.month + 1;

  return {
    start: `${prefix}-01`,
    endExclusive: `${nextYear}-${pad2(nextMonth)}-01`,
    lastDay: `${prefix}-${pad2(lastDayNumber)}`,
  };
}

/**
 * Checks whether a requested student is in the parent's stored link list. This
 * mirrors normalizeLinkedStudentIds in parent-auth.ts without pulling the
 * database/auth layer into this pure module.
 */
export function isStudentLinkedToParent(
  linkedStudentIds: unknown,
  studentId: string
): boolean {
  if (!Array.isArray(linkedStudentIds)) return false;

  for (const item of linkedStudentIds) {
    const id = String(item ?? "").trim();
    if (id && id === studentId) return true;
  }

  return false;
}

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const match = DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;

  return true;
}

/**
 * Maps stored attendance statuses to parent-facing display values. Present and
 * absent are the only statuses written by the attendance application. Any
 * unexpected status is passed through unchanged (never invented) and is still
 * counted in totalMarked.
 */
export function toDisplayStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (!normalized) return null;

  return ATTENDANCE_STATUS_DISPLAY[normalized.toLowerCase()] ?? normalized;
}

function toTimestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function recordTimestamp(record: ParentAttendanceSourceRecord): number {
  const updated = toTimestamp(record.updatedAt);
  return updated > 0 ? updated : toTimestamp(record.markedAt);
}

/**
 * Normalizes monthly attendance into one entry per marked date.
 *
 * The existing attendance app upserts one document per date + batch + student,
 * so duplicate dates can only appear if a student was marked under more than
 * one batch on the same day. The most recently updated document wins, which
 * matches the latest write made by the admin attendance screen.
 *
 * Future-dated records are ignored, holidays are not inferred, and missing
 * dates are never treated as absences.
 */
export function resolveMonthlyAttendance(
  records: ParentAttendanceSourceRecord[],
  month: string,
  today: string
): ParentAttendanceResult {
  const prefix = `${month}-`;
  const byDate = new Map<string, { status: string; timestamp: number }>();

  for (const record of records) {
    const date = record.date;
    if (!isValidDateString(date) || !date.startsWith(prefix)) continue;
    if (today && date > today) continue;

    const status = toDisplayStatus(record.status);
    if (!status) continue;

    const timestamp = recordTimestamp(record);
    const existing = byDate.get(date);

    if (!existing || timestamp >= existing.timestamp) {
      byDate.set(date, { status, timestamp });
    }
  }

  const entries: ParentAttendanceEntry[] = [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({ date, status: value.status }));

  const present = entries.filter((entry) => entry.status === "Present").length;
  const absent = entries.filter((entry) => entry.status === "Absent").length;

  return {
    summary: {
      present,
      absent,
      totalMarked: entries.length,
    },
    records: entries,
  };
}

export function buildParentAttendanceResponse(input: {
  student: ParentAttendanceStudent;
  month: string;
  records: ParentAttendanceSourceRecord[];
  today: string;
}): ParentAttendanceResponse {
  const { summary, records } = resolveMonthlyAttendance(
    input.records,
    input.month,
    input.today
  );

  return {
    success: true,
    student: {
      studentId: String(input.student.studentId ?? "").trim(),
      name: String(input.student.name ?? "").trim(),
      class: String(input.student.class ?? "").trim(),
    },
    month: input.month,
    summary,
    records,
  };
}
