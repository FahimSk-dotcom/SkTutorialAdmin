export interface AttendancePDFStudent {
  studentId: string;
  name: string;
  class: string;
  batch: string;
  conducted: number;
  present: number;
  absent: number;
  percentage: number;
  consecutiveAbsences: number;
}

export interface AttendancePDFClassStat {
  className: string;
  count: number;
  cond: number;
  pres: number;
  abs: number;
  rate: number;
  absRate: number;
}

/**
 * Normalizes the attendance report payload into the row shape used by the PDF.
 * Supports both the monthly matrix (`studentRows`) and the summary
 * (`students`) response shapes.
 */
export function normalizeAttendanceStudents(
  reportData: any
): AttendancePDFStudent[] {
  const rawList: any[] = reportData?.studentRows || reportData?.students || [];

  return rawList.map((st: any) => ({
    studentId: st.studentId,
    name: st.name,
    class: st.class,
    batch: st.batch,
    conducted: st.conducted ?? st.totalConducted ?? 0,
    present: st.present ?? st.presentCount ?? 0,
    absent: st.absent ?? st.absentCount ?? 0,
    percentage: st.percentage ?? 0,
    consecutiveAbsences: st.consecutiveAbsences ?? 0,
  }));
}

/**
 * Aggregates attendance totals per class for the Key Insights cards.
 */
export function buildAttendanceClassStats(
  studentList: AttendancePDFStudent[]
): AttendancePDFClassStat[] {
  const classMap = new Map<
    string,
    { count: number; cond: number; pres: number; abs: number }
  >();

  studentList.forEach((s) => {
    const cls = s.class || "Other";
    if (!classMap.has(cls)) {
      classMap.set(cls, { count: 0, cond: 0, pres: 0, abs: 0 });
    }
    const item = classMap.get(cls)!;
    item.count += 1;
    item.cond += s.conducted;
    item.pres += s.present;
    item.abs += s.absent;
  });

  return Array.from(classMap.entries()).map(([cls, stat]) => {
    const rate = stat.cond > 0 ? (stat.pres / stat.cond) * 100 : 0;
    const absRate = stat.cond > 0 ? (stat.abs / stat.cond) * 100 : 0;
    return {
      className: cls,
      ...stat,
      rate,
      absRate,
    };
  });
}
